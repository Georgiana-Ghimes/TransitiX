/**
 * Mistral Document AI OCR — cloud API, no local sidecar.
 *
 * Env:
 *   MISTRAL_API_KEY   (required)
 *   MISTRAL_OCR_MODEL (default mistral-ocr-latest)
 *   MISTRAL_OCR_URL   (default https://api.mistral.ai/v1/ocr)
 *
 * Phase 1 returns joined page markdown as plain text for the existing extract pipeline.
 * include_blocks + block confidence are requested now for later HITL (Phase 3).
 */

import { normalizeOcrText } from './normalizeOcrText.js';
import { normalizePages } from './ocrBlocks.js';

export function mistralApiKey() {
  return String(process.env.MISTRAL_API_KEY || '').trim();
}

export function mistralOcrModel() {
  return String(process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest').trim()
    || 'mistral-ocr-latest';
}

/** Override for tests / proxies — default api.mistral.ai */
export function mistralApiBase() {
  return String(process.env.MISTRAL_API_BASE || 'https://api.mistral.ai')
    .trim()
    .replace(/\/$/, '');
}

export function mistralOcrUrl() {
  const explicit = String(process.env.MISTRAL_OCR_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  return `${mistralApiBase()}/v1/ocr`;
}

function dataUrl(buffer, mimeType) {
  const mime = mimeType || 'application/octet-stream';
  return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
}

function documentPayload(buffer, mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  const url = dataUrl(buffer, mime || 'application/octet-stream');
  if (mime.includes('pdf') || mime.includes('presentation') || mime.includes('word')) {
    return { type: 'document_url', document_url: url };
  }
  return { type: 'image_url', image_url: url };
}

/** Join page markdown into one blob for extractDocument / profiles. */
export function pagesToText(pages) {
  const list = Array.isArray(pages) ? pages : [];
  return list
    .map((p) => String(p?.markdown || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

/**
 * @returns {Promise<{
 *   text: string|null,
 *   pages: number,
 *   truncated: boolean,
 *   timedOut: boolean,
 *   blocks: object[]|null,
 *   raw: object|null,
 *   reason?: string,
 *   httpStatus?: number,
 * }>}
 */
export async function runMistralOcr(buffer, mimeType, { timeoutMs } = {}) {
  const key = mistralApiKey();
  if (!key) {
    return {
      text: null, pages: 0, truncated: false, timedOut: false, blocks: null, raw: null,
      reason: 'mistral_neconfigurat',
    };
  }
  if (!buffer?.length) {
    return {
      text: null, pages: 0, truncated: false, timedOut: false, blocks: null, raw: null,
      reason: 'buffer_gol',
    };
  }

  // Honour the caller's budget (interactive, remaining slot time, or a short OCR_TIMEOUT_MS
  // in tests). A 5s floor here made AbortSignal ignore 80ms budgets and left re-extract rows
  // stuck on `uploaded` while CI only waited 400ms for markExtractFailed.
  const parsed = Number(timeoutMs);
  const budget = Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.floor(parsed))
    : 120_000;
  const body = {
    model: mistralOcrModel(),
    document: documentPayload(buffer, mimeType),
    // Phase 3 HITL — keep requesting; Phase 1 only consumes markdown text.
    include_blocks: true,
    confidence_scores_granularity: 'block',
  };

  try {
    const res = await fetch(mistralOcrUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(budget),
    });

    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 240);
      } catch {
        /* ignore */
      }
      console.warn(`[ocr] mistral HTTP ${res.status}: ${detail}`);
      return {
        text: null,
        pages: 0,
        truncated: false,
        timedOut: false,
        blocks: null,
        raw: null,
        reason: 'mistral_http_error',
        httpStatus: res.status,
      };
    }

    const json = await res.json();
    const pages = Array.isArray(json?.pages) ? json.pages : [];
    const textRaw = pagesToText(pages);
    const text = textRaw ? normalizeOcrText(textRaw) : null;
    // Normalised here, at the provider boundary: the HITL overlay reads one shape whatever
    // the API calls its corners this quarter.
    const blocks = normalizePages(pages);

    return {
      text: text || null,
      pages: pages.length || 1,
      truncated: false,
      timedOut: false,
      blocks: blocks.length ? blocks : null,
      raw: json,
      reason: text ? undefined : 'mistral_fara_text',
    };
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    if (!timedOut) {
      console.warn('[ocr] mistral failed:', err?.message || err);
    }
    return {
      text: null,
      pages: 0,
      truncated: false,
      timedOut,
      blocks: null,
      raw: null,
      reason: timedOut ? 'mistral_timeout' : 'mistral_error',
    };
  }
}

/** Lightweight probe for /api/health — models list is cheap and auth-checked. */
export async function probeMistralApi({ timeoutMs = 3_000 } = {}) {
  const key = mistralApiKey();
  if (!key) return false;
  try {
    const res = await fetch(`${mistralApiBase()}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

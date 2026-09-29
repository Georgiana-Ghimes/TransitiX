import fs from 'fs/promises';
import path from 'path';
import { uploadRoot } from '../../uploadPath.js';
import { normalizeOcrText } from './normalizeOcrText.js';

/**
 * Gets text out of an uploaded file.
 *
 * Hybrid gates (on-prem only — images stay on this PC):
 *   1. PDF text layer — free, exact when present
 *   2. PaddleOCR classic (:8100) — fast first pass
 *   3. PaddleOCR-VL (:8101) when classic is thin / missing logistics codes
 *   4. pickBestOcrText — keep the richest candidate
 *
 * Tesseract was parked (tools/tesseract-ocr) — not called. Empty OCR still lets
 * the upload succeed; office types fields.
 */
export function ocrProvider() {
  const raw = String(process.env.OCR_PROVIDER || '').trim().toLowerCase();
  if (raw === 'paddle' || raw === 'paddleocr') return 'paddle';
  if (raw === 'none' || raw === 'off') return 'none';
  return paddleOcrUrl() ? 'paddle' : 'none';
}

/** A text layer this thin is a scan with a cover page, not a document we can read. */
export function isTextPoor(rawText, minChars = 40) {
  return String(rawText || '').trim().length < minChars;
}

export function paddleOcrUrl() {
  return String(process.env.PADDLE_OCR_URL || '').trim().replace(/\/$/, '');
}

/** Optional document-VLM sidecar (multitenant / local experiment). */
export function paddleOcrVlUrl() {
  return String(process.env.PADDLE_OCR_VL_URL || '').trim().replace(/\/$/, '');
}

const LOGISTICS_CODE_RE = /\b(?:TPO|PSL|TRO|TP0|TPQ)[\s\-._]*\d{3,}/i;
const RO_DIACRITIC_RE = /[ăâîșțĂÂÎȘȚ]/g;

/**
 * Classic OCR that produced characters but no TPO/PSL/TRO is still "weak" for avize —
 * worth spending VL. Handwriting carnets often hit this path.
 */
export function needsOcrFallback(rawText) {
  if (isTextPoor(rawText, 40)) return true;
  return !LOGISTICS_CODE_RE.test(String(rawText || ''));
}

/** @deprecated alias — same gate as needsOcrFallback */
export function needsVlFallback(rawText) {
  return needsOcrFallback(rawText);
}

function ocrCandidateScore(text) {
  const t = String(text || '');
  if (!t.trim()) return -1;
  let score = Math.min(t.length, 4000) / 10;
  if (LOGISTICS_CODE_RE.test(t)) score += 100;
  const dia = t.match(RO_DIACRITIC_RE);
  if (dia) score += Math.min(dia.length, 40);
  return score;
}

/**
 * Pick the richest OCR string among engines. Prefer logistics codes, then length,
 * then Romanian diacritics — never invent text.
 */
export function pickBestOcrText(candidates = []) {
  const usable = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && String(c.text || '').trim());
  if (!usable.length) return null;

  let best = usable[0];
  let bestScore = ocrCandidateScore(best.text);
  for (let i = 1; i < usable.length; i += 1) {
    const score = ocrCandidateScore(usable[i].text);
    if (score > bestScore) {
      best = usable[i];
      bestScore = score;
    }
  }

  const sources = [...new Set(usable.map((c) => c.source).filter(Boolean))];
  return {
    text: best.text,
    source: sources.length > 1 ? sources.join('+') : (best.source || 'ocr'),
    pages: best.pages,
    truncated: Boolean(best.truncated),
    engines: usable.map((c) => ({ source: c.source, chars: String(c.text).length, score: ocrCandidateScore(c.text) })),
  };
}

export function backgroundOcrTimeoutMs(pages = 1) {
  const base = Number(process.env.OCR_TIMEOUT_MS) || 300_000;
  const count = Math.max(1, Number(pages) || 1);
  return Math.min(base * count, base * 4);
}

export function interactiveOcrTimeoutMs(pages = 1) {
  const base = Number(process.env.OCR_INTERACTIVE_TIMEOUT_MS) || 120_000;
  const count = Math.max(1, Number(pages) || 1);
  return Math.min(base * count, base * 2);
}

export function interactiveOcrMaxPages() {
  return Number(process.env.OCR_INTERACTIVE_MAX_PAGES) || 3;
}

function assertNotTimedOut(ocr) {
  if (!ocr?.timedOut) return;
  const err = new Error('OCR a depășit timpul alocat');
  err.code = 'OCR_TIMEOUT';
  throw err;
}

let ocrProbe = { at: 0, value: null };
const OCR_PROBE_TTL_MS = 15_000;

export function resetOcrCapabilityCache() {
  ocrProbe = { at: 0, value: null };
}

/**
 * Capability string for /api/health.
 * `paddle` when classic answers; `paddle-down` when URL set but unreachable; false when off.
 */
export async function ocrCapability() {
  const base = paddleOcrUrl();
  if (ocrProvider() !== 'paddle' || !base) return false;

  const now = Date.now();
  if (ocrProbe.value !== null && now - ocrProbe.at < OCR_PROBE_TTL_MS) return ocrProbe.value;

  let value = 'paddle-down';
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2_000) });
    if (res.ok) value = 'paddle';
  } catch {
    // Unreachable is the answer.
  }
  ocrProbe = { at: now, value };
  return value;
}

export async function readDocumentText(fileUrl, { timeoutMs } = {}) {
  const name = path.basename(String(fileUrl || ''));
  if (!name) return { text: '', source: 'none', reason: 'fara_fisier' };

  const filePath = path.resolve(uploadRoot, name);
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    return { text: '', source: 'none', reason: 'fisier_negasit' };
  }

  const isPdf = /\.pdf$/i.test(name);

  if (isPdf) {
    const layer = await readPdfText(buffer);
    if (!isTextPoor(layer.text)) return { text: layer.text, source: 'pdf_text', pages: layer.pages };
    const ocr = await readWithOcr(buffer, 'application/pdf', {
      timeoutMs: timeoutMs ?? backgroundOcrTimeoutMs(layer.pages),
    });
    if (ocr?.text) {
      return {
        text: ocr.text, source: ocr.source, pages: ocr.pages, truncated: ocr.truncated,
        engines: ocr.engines,
      };
    }
    assertNotTimedOut(ocr);
    return {
      text: layer.text ?? '', source: 'pdf_text', pages: layer.pages,
      reason: ocr?.reason || 'text_slab',
    };
  }

  const ocr = await readWithOcr(buffer, 'image/jpeg', { timeoutMs });
  if (ocr?.text) {
    return {
      text: ocr.text, source: ocr.source, pages: ocr.pages, truncated: ocr.truncated,
      engines: ocr.engines,
    };
  }
  assertNotTimedOut(ocr);
  return {
    text: '',
    source: 'none',
    reason: ocr?.reason || (ocrProvider() === 'none' ? 'ocr_neconfigurat' : 'ocr_fara_rezultat'),
  };
}

async function readPdfText(buffer) {
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const parsed = await pdfParse(buffer);
    return { text: String(parsed?.text ?? ''), pages: Number(parsed?.numpages) || 0 };
  } catch {
    return { text: '', pages: 0 };
  }
}

export async function documentPageCount(fileUrl) {
  const name = path.basename(String(fileUrl || ''));
  if (!name || !/\.pdf$/i.test(name)) return 1;
  try {
    const buffer = await fs.readFile(path.resolve(uploadRoot, name));
    const { pages } = await readPdfText(buffer);
    return pages > 0 ? pages : 1;
  } catch {
    return 1;
  }
}

/**
 * Hybrid OCR: Paddle → (optional VL) → pickBest.
 * Never throws; empty text is a soft failure.
 */
async function readWithOcr(buffer, mimeType, { timeoutMs } = {}) {
  const provider = ocrProvider();
  if (provider !== 'paddle') {
    return { text: null, reason: 'ocr_neconfigurat' };
  }

  const candidates = [];
  const paddle = await readWithPaddle(buffer, mimeType, { timeoutMs });
  if (paddle.timedOut && !paddle.text) {
    return { text: null, timedOut: true, reason: 'paddle_timeout' };
  }
  if (paddle.text) candidates.push({ ...paddle, source: 'paddle' });

  let current = paddle.text || '';
  if (needsOcrFallback(current) && paddleOcrVlUrl()) {
    const vl = await readWithPaddleVl(buffer, mimeType, { timeoutMs });
    if (vl.timedOut && !current) {
      return { text: null, timedOut: true, reason: 'paddle_vl_timeout' };
    }
    if (vl.text) candidates.push({ ...vl, source: 'paddle-vl' });
  }

  const best = pickBestOcrText(candidates);
  if (best) return best;

  return {
    text: null,
    reason: paddleOcrUrl() ? 'paddle_fara_rezultat' : 'paddle_neconfigurat',
  };
}

async function postOcrJson(base, buffer, mimeType, timeoutMs) {
  if (!base) return { text: null, timedOut: false };
  try {
    const res = await fetch(`${base}/ocr/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: buffer.toString('base64'),
        mime_type: mimeType || 'image/jpeg',
      }),
      signal: AbortSignal.timeout(timeoutMs ?? backgroundOcrTimeoutMs()),
    });
    if (!res.ok) return { text: null, timedOut: false };
    const json = await res.json();
    const text = json?.text;
    return {
      text: text ? normalizeOcrText(String(text)) : null,
      timedOut: false,
      pages: Number(json?.total_pages) || Number(json?.pages) || 1,
      truncated: Boolean(json?.truncated),
    };
  } catch (err) {
    return { text: null, timedOut: err?.name === 'TimeoutError' };
  }
}

async function readWithPaddle(buffer, mimeType, { timeoutMs } = {}) {
  return postOcrJson(paddleOcrUrl(), buffer, mimeType, timeoutMs);
}

async function readWithPaddleVl(buffer, mimeType, { timeoutMs } = {}) {
  const base = paddleOcrVlUrl();
  if (!base) return { text: null, timedOut: false };
  return postOcrJson(base, buffer, mimeType, timeoutMs ?? backgroundOcrTimeoutMs());
}

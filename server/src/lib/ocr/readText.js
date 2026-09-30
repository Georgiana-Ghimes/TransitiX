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
 *   3. PaddleOCR-VL (:8101) when classic is thin / missing logistics codes, the file is short,
 *      budget remains, and VL has not just kept failing (shouldTryVl)
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

/**
 * How many OCR jobs this API process sends the sidecars at once. Both run on the VM's CPU:
 * two photos side by side take longer than two in a row, and each can outlive its caller.
 */
export function ocrConcurrency() {
  return Math.max(1, Math.floor(Number(process.env.OCR_CONCURRENCY) || 1));
}

let ocrActive = 0;
const ocrWaiters = [];

/** Resolves false when the deadline passes in the queue — that job never reaches the sidecar. */
export function acquireOcrSlot(deadline) {
  if (ocrActive < ocrConcurrency()) {
    ocrActive += 1;
    return Promise.resolve(true);
  }
  const wait = deadline - Date.now();
  if (wait <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const waiter = { resolve, timer: null };
    waiter.timer = setTimeout(() => {
      const at = ocrWaiters.indexOf(waiter);
      if (at >= 0) ocrWaiters.splice(at, 1);
      resolve(false);
    }, wait);
    ocrWaiters.push(waiter);
  });
}

export function releaseOcrSlot() {
  const next = ocrWaiters.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve(true);
    return;
  }
  ocrActive = Math.max(0, ocrActive - 1);
}

/** Jobs holding or waiting for a sidecar slot in this process. */
export function ocrQueueState() {
  return { active: ocrActive, waiting: ocrWaiters.length, limit: ocrConcurrency() };
}

/** PDFs longer than this never go to VL: it reads a page in minutes on CPU, not seconds. */
export function vlMaxPages() {
  return Math.max(1, Number(process.env.OCR_VL_MAX_PAGES) || 2);
}

/** VL is not started with less budget left than this — it would be aborted mid-page. */
export function vlMinBudgetMs() {
  return Math.max(0, Number(process.env.OCR_VL_MIN_BUDGET_MS) || 90_000);
}

const VL_MAX_MISSES = () => Math.max(1, Number(process.env.OCR_VL_MAX_MISSES) || 2);
const VL_COOLDOWN_MS = () => Math.max(0, Number(process.env.OCR_VL_COOLDOWN_MS) || 30 * 60_000);

let vlBreaker = { misses: 0, openUntil: 0 };

export function resetVlBreaker() {
  vlBreaker = { misses: 0, openUntil: 0 };
}

/** Closed means VL may be tried. It opens after VL keeps timing out or reading nothing. */
export function vlBreakerOpen(now = Date.now()) {
  return vlBreaker.openUntil > now;
}

export function recordVlOutcome(vl, now = Date.now()) {
  if (vl?.text) {
    vlBreaker = { misses: 0, openUntil: 0 };
    return;
  }
  const misses = vlBreaker.misses + 1;
  if (misses >= VL_MAX_MISSES()) {
    vlBreaker = { misses: 0, openUntil: now + VL_COOLDOWN_MS() };
    console.warn(`[ocr] PaddleOCR-VL paused for ${Math.round(VL_COOLDOWN_MS() / 60_000)} min after ${misses} empty/timed-out reads`);
    return;
  }
  vlBreaker = { ...vlBreaker, misses };
}

/**
 * Whether VL is worth its CPU for this document. The classic read has to be weak, the file
 * short, enough budget left for a whole page, and VL not recently useless.
 */
export function shouldTryVl(classicText, { pages = 1, remainingMs = Infinity, now = Date.now() } = {}) {
  if (!paddleOcrVlUrl()) return false;
  if (!needsOcrFallback(classicText)) return false;
  if ((Number(pages) || 1) > vlMaxPages()) return false;
  if (remainingMs < vlMinBudgetMs()) return false;
  return !vlBreakerOpen(now);
}

export function mimeTypeFor(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.heic' || ext === '.heif') return 'image/heic';
  return 'image/jpeg';
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
    // Unreachable is the answer — unless this process is mid-OCR on it. An older sidecar
    // cannot answer /health while it computes, and busy must not read as down: down fails
    // every pending upload.
    if (ocrActive > 0) value = 'paddle';
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

  const ocr = await readWithOcr(buffer, mimeTypeFor(name), { timeoutMs });
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
 *
 * One deadline covers the queue, classic and VL together. VL used to get a fresh full budget
 * after classic had spent its own, so a weak photo could hold the CPU for twice the timeout.
 * Never throws; empty text is a soft failure.
 */
async function readWithOcr(buffer, mimeType, { timeoutMs } = {}) {
  const provider = ocrProvider();
  if (provider !== 'paddle') {
    return { text: null, reason: 'ocr_neconfigurat' };
  }

  const startedAt = Date.now();
  const deadline = startedAt + (timeoutMs ?? backgroundOcrTimeoutMs());
  if (!(await acquireOcrSlot(deadline))) {
    return { text: null, timedOut: true, reason: 'ocr_coada_plina' };
  }

  try {
    const candidates = [];
    const paddle = await postOcrJson(paddleOcrUrl(), buffer, mimeType, deadline);
    const classicMs = Date.now() - startedAt;
    if (paddle.timedOut && !paddle.text) {
      console.warn(`[ocr] paddle timed out after ${classicMs}ms`);
      return { text: null, timedOut: true, reason: 'paddle_timeout' };
    }
    if (paddle.text) candidates.push({ ...paddle, source: 'paddle' });

    const current = paddle.text || '';
    if (shouldTryVl(current, { pages: paddle.pages, remainingMs: deadline - Date.now() })) {
      const vlStarted = Date.now();
      const vl = await postOcrJson(paddleOcrVlUrl(), buffer, mimeType, deadline, {
        max_pages: vlMaxPages(),
      });
      recordVlOutcome(vl);
      console.info(`[ocr] paddle ${classicMs}ms ${current.length}ch; vl ${Date.now() - vlStarted}ms ${vl.text?.length || 0}ch${vl.timedOut ? ' timeout' : ''}`);
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
  } finally {
    releaseOcrSlot();
  }
}

/**
 * `budget_ms` lets the sidecar drop the job once this caller has given up. Without it an
 * aborted fetch left the sidecar computing for minutes on an answer nobody would read.
 */
async function postOcrJson(base, buffer, mimeType, deadline, extra = {}) {
  if (!base) return { text: null, timedOut: false };
  const remaining = deadline - Date.now();
  if (remaining <= 0) return { text: null, timedOut: true };
  try {
    const res = await fetch(`${base}/ocr/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: buffer.toString('base64'),
        mime_type: mimeType || 'image/jpeg',
        budget_ms: remaining,
        ...extra,
      }),
      signal: AbortSignal.timeout(remaining),
    });
    // 503 = sidecar queue full until our deadline, 504 = it stopped at our deadline.
    if (res.status === 503 || res.status === 504) return { text: null, timedOut: true };
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

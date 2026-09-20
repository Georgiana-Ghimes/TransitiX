import fs from 'fs/promises';
import path from 'path';
import { uploadRoot } from '../../uploadPath.js';
import { normalizeOcrText } from './normalizeOcrText.js';

/**
 * Gets text out of an uploaded file.
 *
 * Sources, in order:
 *   1. PDF text layer, free, exact
 *   2. PaddleOCR classic (:8100)
 *   3. PaddleOCR-VL 0.9B (:8101) when classic text is thin / missing logistics codes
 *   4. nothing — upload still succeeds; office types fields
 */
export function ocrProvider() {
  const raw = String(process.env.OCR_PROVIDER || '').trim().toLowerCase();
  if (raw === 'paddle' || raw === 'paddleocr') return 'paddle';
  if (raw === 'none' || raw === 'off') return 'none';
  // Auto: the sidecar when its URL is set, otherwise nothing to call.
  return paddleOcrUrl() ? 'paddle' : 'none';
}

/** A text layer this thin is a scan with a cover page, not a document we can read. */
export function isTextPoor(rawText, minChars = 40) {
  return String(rawText || '').trim().length < minChars;
}

/** Classic line OCR — tuned handwriting knobs live on that service. */
export function paddleOcrUrl() {
  return String(process.env.PADDLE_OCR_URL || '').trim().replace(/\/$/, '');
}

/** PaddleOCR-VL 0.9B document VLM (CPU). Optional second pass. */
export function paddleOcrVlUrl() {
  return String(process.env.PADDLE_OCR_VL_URL || '').trim().replace(/\/$/, '');
}

const LOGISTICS_CODE_RE = /\b(?:TPO|PSL|TRO)[\s\-._]*\d{3,}/i;

/**
 * Classic OCR that produced characters but no TPO/PSL/TRO is still "weak" for avize —
 * worth spending a VL pass. Handwriting carnets often hit this path.
 */
export function needsVlFallback(rawText) {
  if (isTextPoor(rawText, 40)) return true;
  return !LOGISTICS_CODE_RE.test(String(rawText || ''));
}

/**
 * How long an OCR call may take, by who is waiting for it.
 *
 * Background extraction rides whatever CPU the VM has and nobody is watching a spinner, so it
 * waits. A person who pressed a button is watching one, and a request that hangs for minutes
 * reads as a broken screen, it gives up early and says so instead.
 */
export function backgroundOcrTimeoutMs(pages = 1) {
  const base = Number(process.env.OCR_TIMEOUT_MS) || 300_000;
  const count = Math.max(1, Number(pages) || 1);
  // Grows with the document, because a flat budget would fail every long scan the background
  // path exists to handle, and a failure there just leaves it to be retried forever.
  return Math.min(base * count, base * 4);
}

/**
 * @param {number} [pages] how many pages the document has, when that is known.
 *
 * One page is a photo and finishes quickly. More pages cost roughly linearly, so the budget
 * grows with them, but stays capped, because past a few pages the work belongs in the
 * background rather than under a spinner (see `interactiveOcrMaxPages`).
 */
export function interactiveOcrTimeoutMs(pages = 1) {
  // Phone notebook photos run several heavy CPU passes (ink + orientations). 45s was enough
  // for a clean printed page and too short for a hard carnet shot — the request aborted with
  // empty text before those passes finished. Background still has the long budget.
  const base = Number(process.env.OCR_INTERACTIVE_TIMEOUT_MS) || 120_000;
  const count = Math.max(1, Number(pages) || 1);
  return Math.min(base * count, base * 2);
}

/** Above this many pages, extraction runs in the background instead of blocking the request. */
export function interactiveOcrMaxPages() {
  return Number(process.env.OCR_INTERACTIVE_MAX_PAGES) || 3;
}

/**
 * Phone / carnet photos (png/jpeg) routinely exceed Cloudflare tunnel idle time when OCR + VL
 * hold the HTTP request. PDFs with a text layer finish fast; rasters always go background.
 */
export function isRasterAvizUpload(fileUrl, filename) {
  const s = `${fileUrl || ''} ${filename || ''}`.toLowerCase();
  return /\.(png|jpe?g|gif|webp)(?:\?|#|\s|$)/i.test(s);
}

/**
 * Giving up on the clock is not the same as reading a document and finding nothing in it.
 * Reported as empty text, a caller would overwrite a good extraction with this one.
 */
function assertNotTimedOut(ocr) {
  if (!ocr?.timedOut) return;
  const err = new Error('OCR a depășit timpul alocat');
  err.code = 'OCR_TIMEOUT';
  throw err;
}

/**
 * Whether the sidecar is actually answering.
 *
 * There is no fallback provider, so a sidecar that is down means every upload lands with no OCR
 * and nothing on screen says why. Reported distinctly from "not configured" for that reason.
 * Cached briefly because /api/health is polled and this crosses the network.
 */
let ocrProbe = { at: 0, value: null };
const OCR_PROBE_TTL_MS = 15_000;

/** Drop the cached health probe (tests that swap PADDLE_OCR_URL mid-suite). */
export function resetOcrCapabilityCache() {
  ocrProbe = { at: 0, value: null };
}

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
    // Unreachable is the answer, not an error to propagate into /api/health.
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
    // No usable text layer: it is a scan. The sidecar rasterizes the pages itself.
    // A caller that pinned a budget keeps it; otherwise it scales with what we just counted.
    const ocr = await readWithOcr(buffer, 'application/pdf', {
      timeoutMs: timeoutMs ?? backgroundOcrTimeoutMs(layer.pages),
    });
    if (ocr?.text) {
      return {
        text: ocr.text, source: ocr.source, pages: ocr.pages, truncated: ocr.truncated,
      };
    }
    assertNotTimedOut(ocr);
    return {
      text: layer.text ?? '', source: 'pdf_text', pages: layer.pages,
      reason: ocr?.reason || 'text_slab',
    };
  }

  const ocr = await readWithOcr(buffer, 'image/jpeg', { timeoutMs });
  if (ocr?.text) return { text: ocr.text, source: ocr.source };
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

/**
 * How many pages a stored upload has, so a caller can decide whether to wait for it.
 *
 * Costs one text-layer parse, which is negligible next to OCR and is the only way to know
 * before the work starts. Anything that is not a readable PDF counts as one page.
 */
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

/** Runs the configured provider. Never throws, a caller decides what an empty read means. */
async function readWithOcr(buffer, mimeType, { timeoutMs } = {}) {
  const provider = ocrProvider();
  if (provider === 'paddle') {
    const paddle = await readWithPaddle(buffer, mimeType, { timeoutMs });
    if (paddle.timedOut) return { text: null, timedOut: true, reason: 'paddle_timeout' };

    const classicText = paddle.text || null;
    const classicOk = classicText && !needsVlFallback(classicText);

    if (classicOk) {
      return {
        text: classicText, source: 'paddle', pages: paddle.pages, truncated: paddle.truncated,
      };
    }

    // Thin / no logistics codes → try VL when configured. Prefer the richer of the two.
    const vl = await readWithPaddleVl(buffer, mimeType, { timeoutMs });
    if (vl.timedOut && !classicText) {
      return { text: null, timedOut: true, reason: 'paddle_vl_timeout' };
    }
    if (vl.text && (!classicText || vl.text.length >= classicText.length || needsVlFallback(classicText))) {
      // Keep classic crumbs if VL somehow returned less signal with codes.
      const preferVl = !classicText
        || !LOGISTICS_CODE_RE.test(classicText)
        || LOGISTICS_CODE_RE.test(vl.text)
        || vl.text.length > classicText.length * 1.1;
      if (preferVl) {
        return {
          text: vl.text,
          source: classicText ? 'paddle+vl' : 'paddle-vl',
          pages: vl.pages || paddle.pages,
          truncated: Boolean(vl.truncated || paddle.truncated),
        };
      }
    }

    if (classicText) {
      return {
        text: classicText, source: 'paddle', pages: paddle.pages, truncated: paddle.truncated,
      };
    }
    return {
      text: null,
      reason: paddleOcrUrl() ? 'paddle_fara_rezultat' : 'paddle_neconfigurat',
    };
  }
  return { text: null, reason: 'ocr_neconfigurat' };
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
  // VL on CPU is slower than classic; allow the full background budget.
  return postOcrJson(base, buffer, mimeType, timeoutMs ?? backgroundOcrTimeoutMs());
}


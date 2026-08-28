import fs from 'fs/promises';
import path from 'path';
import { uploadRoot } from '../../uploadPath.js';
import { normalizeOcrText } from './normalizeOcrText.js';

/**
 * Gets text out of an uploaded file.
 *
 * Sources, in order:
 *   1. PDF text layer — free, exact
 *   2. PaddleOCR, the local sidecar — the only OCR provider
 *   3. nothing — upload still succeeds; office types fields
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

export function paddleOcrUrl() {
  return String(process.env.PADDLE_OCR_URL || '').trim().replace(/\/$/, '');
}

/**
 * How long an OCR call may take, by who is waiting for it.
 *
 * Background extraction rides whatever CPU the VM has and nobody is watching a spinner, so it
 * waits. A person who pressed a button is watching one, and a request that hangs for minutes
 * reads as a broken screen — it gives up early and says so instead.
 */
export function backgroundOcrTimeoutMs(pages = 1) {
  const base = Number(process.env.OCR_TIMEOUT_MS) || 300_000;
  const count = Math.max(1, Number(pages) || 1);
  // Grows with the document, because a flat budget would fail every long scan the background
  // path exists to handle — and a failure there just leaves it to be retried forever.
  return Math.min(base * count, base * 4);
}

/**
 * @param {number} [pages] how many pages the document has, when that is known.
 *
 * One page is a photo and finishes quickly. More pages cost roughly linearly, so the budget
 * grows with them — but stays capped, because past a few pages the work belongs in the
 * background rather than under a spinner (see `interactiveOcrMaxPages`).
 */
export function interactiveOcrTimeoutMs(pages = 1) {
  const base = Number(process.env.OCR_INTERACTIVE_TIMEOUT_MS) || 45_000;
  const count = Math.max(1, Number(pages) || 1);
  return Math.min(base * count, base * 2);
}

/** Above this many pages, extraction runs in the background instead of blocking the request. */
export function interactiveOcrMaxPages() {
  return Number(process.env.OCR_INTERACTIVE_MAX_PAGES) || 3;
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

/** Runs the configured provider. Never throws — a caller decides what an empty read means. */
async function readWithOcr(buffer, mimeType, { timeoutMs } = {}) {
  const provider = ocrProvider();
  if (provider === 'paddle') {
    const paddle = await readWithPaddle(buffer, mimeType, { timeoutMs });
    if (paddle.text) {
      return {
        text: paddle.text, source: 'paddle', pages: paddle.pages, truncated: paddle.truncated,
      };
    }
    if (paddle.timedOut) return { text: null, timedOut: true, reason: 'paddle_timeout' };
    return { text: null, reason: paddleOcrUrl() ? 'paddle_fara_rezultat' : 'paddle_neconfigurat' };
  }
  return { text: null, reason: 'ocr_neconfigurat' };
}

async function readWithPaddle(buffer, mimeType, { timeoutMs } = {}) {
  const base = paddleOcrUrl();
  if (!base) return { text: null, timedOut: false };

  try {
    const res = await fetch(`${base}/ocr/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: buffer.toString('base64'),
        mime_type: mimeType || 'image/jpeg',
      }),
      // Auto-rotate tries up to four orientations on CPU, so a background pass waits minutes.
      signal: AbortSignal.timeout(timeoutMs ?? backgroundOcrTimeoutMs()),
    });
    if (!res.ok) return { text: null, timedOut: false };
    const json = await res.json();
    const text = json?.text;
    return {
      text: text ? normalizeOcrText(String(text)) : null,
      timedOut: false,
      pages: Number(json?.total_pages) || Number(json?.pages) || 1,
      // The sidecar caps how many pages it will read. A partial read stored as the whole
      // document would put an understated figure on an invoice.
      truncated: Boolean(json?.truncated),
    };
  } catch (err) {
    return { text: null, timedOut: err?.name === 'TimeoutError' };
  }
}


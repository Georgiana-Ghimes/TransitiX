/**
 * Gets text out of an uploaded file.
 *
 *   1. PDF text layer — free when present
 *   2. Mistral Document AI (cloud) when MISTRAL_API_KEY / OCR_PROVIDER=mistral
 *
 * Empty OCR is a soft failure — office types fields.
 */

import fs from 'fs/promises';
import path from 'path';
import { uploadRoot } from '../../uploadPath.js';
import { parsePdf, readPdfRows } from './pdfRows.js';
import {
  mistralApiKey,
  probeMistralApi,
  runMistralOcr,
} from './mistralOcr.js';

export function ocrProvider() {
  const raw = String(process.env.OCR_PROVIDER || '').trim().toLowerCase();
  if (raw === 'mistral' || raw === 'mistralai') return 'mistral';
  if (raw === 'none' || raw === 'off') return 'none';
  if (mistralApiKey()) return 'mistral';
  return 'none';
}

export function isOcrDown(capability) {
  return capability === 'mistral-down';
}

export function isTextPoor(rawText, minChars = 40) {
  return String(rawText || '').trim().length < minChars;
}

const LOGISTICS_CODE_RE = /\b(?:TPO|PSL|TRO|TP0|TPQ)[\s\-._]*\d{3,}/i;

/** Weak OCR text — no logistics code / too short (cache skip on re-extract). */
export function needsOcrFallback(rawText) {
  if (isTextPoor(rawText, 40)) return true;
  return !LOGISTICS_CODE_RE.test(String(rawText || ''));
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

/** Concurrent Mistral calls from this process (API rate / cost control). */
export function ocrConcurrency() {
  return Math.max(1, Math.floor(Number(process.env.OCR_CONCURRENCY) || 2));
}

let ocrActive = 0;
const ocrWaiters = [];

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

export function ocrQueueState() {
  return { active: ocrActive, waiting: ocrWaiters.length, limit: ocrConcurrency() };
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

/** `mistral` | `mistral-down` | false when off. */
export async function ocrCapability() {
  const provider = ocrProvider();
  const now = Date.now();
  if (ocrProbe.value !== null && now - ocrProbe.at < OCR_PROBE_TTL_MS) {
    return ocrProbe.value;
  }

  let value = false;
  if (provider === 'mistral') {
    value = (await probeMistralApi()) ? 'mistral' : 'mistral-down';
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
    if (!isTextPoor(layer.text)) {
      return { text: layer.text, source: 'pdf_text', pages: layer.pages };
    }
    const ocr = await readWithOcr(buffer, 'application/pdf', {
      timeoutMs: timeoutMs ?? backgroundOcrTimeoutMs(layer.pages),
    });
    if (ocr?.text) {
      return {
        text: ocr.text,
        source: ocr.source,
        pages: ocr.pages,
        truncated: ocr.truncated,
        blocks: ocr.blocks,
      };
    }
    assertNotTimedOut(ocr);
    return {
      text: layer.text ?? '',
      source: 'pdf_text',
      pages: layer.pages,
      reason: ocr?.reason || 'text_slab',
    };
  }

  const ocr = await readWithOcr(buffer, mimeTypeFor(name), { timeoutMs });
  if (ocr?.text) {
    return {
      text: ocr.text,
      source: ocr.source,
      pages: ocr.pages,
      truncated: ocr.truncated,
      blocks: ocr.blocks,
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
    return await readPdfRows(buffer);
  } catch (err) {
    console.warn('[ocr] layout-aware PDF read failed, falling back to flat text:', err?.message || err);
  }
  try {
    const parsed = await parsePdf(buffer);
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

async function readWithOcr(buffer, mimeType, { timeoutMs } = {}) {
  if (ocrProvider() !== 'mistral') {
    return { text: null, reason: 'ocr_neconfigurat' };
  }

  const startedAt = Date.now();
  const deadline = startedAt + (timeoutMs ?? backgroundOcrTimeoutMs());
  if (!(await acquireOcrSlot(deadline))) {
    return { text: null, timedOut: true, reason: 'ocr_coada_plina' };
  }

  try {
    const remaining = deadline - Date.now();
    const mistral = await runMistralOcr(buffer, mimeType, { timeoutMs: remaining });
    if (mistral.timedOut && !mistral.text) {
      console.warn(`[ocr] mistral timed out after ${Date.now() - startedAt}ms`);
      return { text: null, timedOut: true, reason: 'mistral_timeout' };
    }
    if (mistral.text) {
      return {
        text: mistral.text,
        source: 'mistral',
        pages: mistral.pages,
        truncated: mistral.truncated,
        blocks: mistral.blocks,
      };
    }
    return { text: null, reason: mistral.reason || 'mistral_fara_rezultat' };
  } finally {
    releaseOcrSlot();
  }
}

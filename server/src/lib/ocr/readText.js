import fs from 'fs/promises';
import path from 'path';
import { uploadRoot } from '../../uploadPath.js';
import { isTextPoor, visionApiKey } from '../avizVision.js';
import { normalizeOcrText } from './normalizeOcrText.js';

/**
 * Gets text out of an uploaded file.
 *
 * Sources, in order:
 *   1. PDF text layer — free, exact
 *   2. Configured OCR provider (paddle local / Google Vision)
 *   3. nothing — upload still succeeds; office types fields
 */
export function ocrProvider() {
  const raw = String(process.env.OCR_PROVIDER || '').trim().toLowerCase();
  if (raw === 'paddle' || raw === 'paddleocr') return 'paddle';
  if (raw === 'vision' || raw === 'google' || raw === 'google_vision') return 'vision';
  if (raw === 'none' || raw === 'off') return 'none';
  // Auto: prefer local paddle when URL is set, else Vision key, else none.
  if (paddleOcrUrl()) return 'paddle';
  if (visionApiKey()) return 'vision';
  return 'none';
}

export function paddleOcrUrl() {
  return String(process.env.PADDLE_OCR_URL || '').trim().replace(/\/$/, '');
}

export async function readDocumentText(fileUrl) {
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
    const text = await readPdfText(buffer);
    if (!isTextPoor(text)) return { text, source: 'pdf_text' };
    const ocr = await readWithOcr(buffer, 'application/pdf');
    if (ocr?.text) return { text: ocr.text, source: ocr.source };
    return { text: text ?? '', source: 'pdf_text', reason: ocr?.reason || 'text_slab' };
  }

  const ocr = await readWithOcr(buffer, 'image/jpeg');
  if (ocr?.text) return { text: ocr.text, source: ocr.source };
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
    return String(parsed?.text ?? '');
  } catch {
    return '';
  }
}

/** Dispatches to paddle / vision based on OCR_PROVIDER. Never throws. */
async function readWithOcr(buffer, mimeType) {
  const provider = ocrProvider();
  if (provider === 'paddle') {
    const text = await readWithPaddle(buffer, mimeType);
    if (text) return { text, source: 'paddle' };
    // Optional Vision fallback when paddle is down but a key exists.
    if (visionApiKey()) {
      const vision = await readWithVision(buffer, mimeType);
      if (vision) return { text: vision, source: 'vision' };
    }
    return { text: null, reason: paddleOcrUrl() ? 'paddle_fara_rezultat' : 'paddle_neconfigurat' };
  }
  if (provider === 'vision') {
    const text = await readWithVision(buffer, mimeType);
    if (text) return { text, source: 'vision' };
    return { text: null, reason: visionApiKey() ? 'vision_fara_rezultat' : 'vision_neconfigurat' };
  }
  return { text: null, reason: 'ocr_neconfigurat' };
}

async function readWithPaddle(buffer, mimeType) {
  const base = paddleOcrUrl();
  if (!base) return null;

  // PaddleOCR image pipeline — skip raw PDFs (Node already tried the text layer).
  if (String(mimeType || '').includes('pdf')) {
    return null;
  }

  try {
    const res = await fetch(`${base}/ocr/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: buffer.toString('base64'),
        mime_type: mimeType || 'image/jpeg',
      }),
      // Auto-rotate tries up to four orientations on CPU — allow several minutes on a VM.
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json?.text;
    return text ? normalizeOcrText(String(text)) : null;
  } catch {
    return null;
  }
}

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';

async function readWithVision(buffer, mimeType) {
  const key = visionApiKey();
  if (!key) return null;
  try {
    const res = await fetch(`${VISION_URL}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: buffer.toString('base64') },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          imageContext: { languageHints: ['ro', 'en'] },
        }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json?.responses?.[0]?.fullTextAnnotation?.text;
    return text ? normalizeOcrText(String(text)) : null;
  } catch {
    return null;
  }
}

export { isTextPoor };

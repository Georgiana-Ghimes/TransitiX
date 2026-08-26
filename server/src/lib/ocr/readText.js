import fs from 'fs/promises';
import path from 'path';
import { uploadRoot } from '../../uploadPath.js';
import { isTextPoor, visionApiKey } from '../avizVision.js';

/**
 * Gets text out of an uploaded file.
 *
 * Three sources, in order of preference:
 *   1. a PDF text layer — free, exact, and what most modern avize have
 *   2. Google Vision OCR — for scans and photos, when a key is configured
 *   3. nothing, reported as such
 *
 * The source is returned alongside the text because it changes how much the extraction can
 * be trusted: a PDF text layer is transcription, an OCR pass is a guess.
 */
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
    // A scanned PDF has a near-empty text layer; fall through to OCR.
    const ocr = await readWithVision(buffer, 'application/pdf');
    if (ocr) return { text: ocr, source: 'vision' };
    return { text: text ?? '', source: 'pdf_text', reason: 'text_slab' };
  }

  const ocr = await readWithVision(buffer, 'image/jpeg');
  if (ocr) return { text: ocr, source: 'vision' };
  return { text: '', source: 'none', reason: visionApiKey() ? 'vision_fara_rezultat' : 'vision_neconfigurat' };
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
    return text ? String(text) : null;
  } catch {
    // OCR being unavailable must never take the upload down — the operator can still type.
    return null;
  }
}

export { isTextPoor };

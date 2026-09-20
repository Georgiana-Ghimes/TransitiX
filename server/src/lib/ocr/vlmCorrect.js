/**
 * Optional Qwen2.5-VL (or any Ollama vision model) corrector.
 *
 * Runs after regex extraction. Fills missing / review fields from a JSON reply.
 * Fail-open: if Ollama is down, extraction is unchanged.
 *
 * Local-only by default (VLM_URL → http://127.0.0.1:11434). GDPR: image stays on the PC.
 */

import fs from 'fs/promises';
import path from 'path';
import { uploadRoot } from '../../uploadPath.js';
import { coerceDbNumber } from './fields.js';

export function vlmUrl() {
  return String(process.env.VLM_URL || '').trim().replace(/\/$/, '');
}

export function vlmModel() {
  return String(process.env.VLM_MODEL || 'qwen2.5vl:3b').trim() || 'qwen2.5vl:3b';
}

export function vlmTimeoutMs() {
  return Number(process.env.VLM_TIMEOUT_MS) || 180_000;
}

/** Fields the VLM may propose onto an aviz extraction. */
export const VLM_AVIZ_KEYS = Object.freeze([
  'numar_tpo',
  'numar_document_marfa',
  'numar_auto',
  'data_efectuare_cursa',
  'ruta_transport',
  'tip_marfa',
  'quantity',
  'gross_weight_kg',
  'net_weight_kg',
  'delivery_street',
  'delivery_street_type',
  'delivery_house_number',
  'delivery_locality',
]);

const SYSTEM_PROMPT = `You extract fields from a Romanian logistics aviz (Baumit / transport / carnet de bord).
Return ONLY a JSON object with these keys (use null when unknown):
numar_tpo, numar_document_marfa, numar_auto, data_efectuare_cursa,
ruta_transport, tip_marfa, quantity, gross_weight_kg, net_weight_kg,
delivery_street, delivery_street_type, delivery_house_number, delivery_locality.
Dates as YYYY-MM-DD. Plates like B-330-SRS. Codes like TPO-0025803, PSL-0044362.
Prefer the delivery address (Adresa de livrare), not the billing client address.
gross_weight_kg = greutate brută in kilograms (integer or one decimal). On a handwritten carnet,
"CANT MARFA 15.744,00" / "15,744,00" means ~15744 kg weighbridge — put that in gross_weight_kg, NOT quantity.
quantity = count of sacks/buckets only (e.g. 378 saci). Never put a street house number (e.g. 600) in quantity.
net_weight_kg only when the page says greutate netă / masă netă.`;

/**
 * Pull a JSON object out of a model reply (raw or fenced).
 */
export function parseVlmJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    const direct = JSON.parse(text);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
  } catch {
    // fall through
  }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      const inner = JSON.parse(fence[1].trim());
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner;
    } catch {
      // fall through
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const slice = JSON.parse(text.slice(start, end + 1));
      if (slice && typeof slice === 'object' && !Array.isArray(slice)) return slice;
    } catch {
      return null;
    }
  }
  return null;
}

function blank(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function sameValue(a, b) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

/**
 * Merge VLM proposals into an extractDocument() result.
 *
 * - missing / review → fill from VLM (confidence 0.72, status review)
 * - ok + different → keep OCR, mark conflict on review_fields
 * - ok + same → no-op
 */
export function mergeVlmIntoExtraction(extraction, vlmFields = {}) {
  if (!extraction || typeof extraction !== 'object') return extraction;
  const fields = { ...(extraction.fields || {}) };
  const values = { ...(extraction.values || {}) };
  const review = new Set(extraction.review_fields || []);
  const conflicts = [];
  const filled = [];

  for (const key of VLM_AVIZ_KEYS) {
    let proposed = vlmFields[key];
    if (blank(proposed)) continue;
    if (typeof proposed === 'string') proposed = proposed.trim();

    if (key === 'gross_weight_kg' || key === 'net_weight_kg' || key === 'quantity') {
      const n = coerceDbNumber(proposed);
      if (n == null) continue;
      proposed = n;
    }

    // quantity may arrive as number; keep as-is for toColumns
    const current = fields[key];
    const status = current?.status || (blank(values[key]) ? 'missing' : 'ok');

    if (status === 'ok' && !blank(current?.value ?? values[key])) {
      if (!sameValue(current?.value ?? values[key], proposed)) {
        conflicts.push(key);
        review.add(key);
      }
      continue;
    }

    fields[key] = {
      value: proposed,
      confidence: 0.72,
      matched: null,
      status: 'review',
      source: 'vlm',
    };
    values[key] = proposed;
    review.add(key);
    filled.push(key);
  }

  // Pack delivery pieces for zone tax when present
  const streetName = values.delivery_street || vlmFields.delivery_street;
  if (!blank(streetName)) {
    values.delivery_address = {
      locality: values.delivery_locality || vlmFields.delivery_locality || null,
      streetName: String(streetName).toLowerCase(),
      streetType: values.delivery_street_type || vlmFields.delivery_street_type || null,
      houseNumber: values.delivery_house_number || vlmFields.delivery_house_number || null,
      street: null,
    };
  }

  const needsReview = Boolean(
    extraction.needs_review || review.size > 0 || conflicts.length > 0 || filled.length > 0
  );

  return {
    ...extraction,
    fields,
    values,
    review_fields: [...review],
    needs_review: needsReview,
    vlm: {
      filled,
      conflicts,
      model: vlmModel(),
    },
  };
}

async function readUploadBase64(fileUrl) {
  const name = path.basename(String(fileUrl || ''));
  if (!name) return null;
  try {
    const buf = await fs.readFile(path.resolve(uploadRoot, name));
    return buf.toString('base64');
  } catch {
    return null;
  }
}

/**
 * Ask Ollama for structured fields. Returns null on any failure.
 */
export async function correctWithVlm({ fileUrl, ocrText, timeoutMs } = {}) {
  const base = vlmUrl();
  if (!base) return null;

  const imageB64 = await readUploadBase64(fileUrl);
  // PDF: Ollama vision wants an image. Skip rather than send a PDF blob as jpeg.
  if (!imageB64) return null;
  if (/\.pdf$/i.test(String(fileUrl || ''))) {
    // Still try text-only correction from OCR string when no raster is available.
  }

  const isPdf = /\.pdf$/i.test(String(fileUrl || ''));
  const userText = [
    SYSTEM_PROMPT,
    '',
    'OCR text (may be noisy):',
    String(ocrText || '').slice(0, 6000) || '(empty)',
  ].join('\n');

  const message = {
    role: 'user',
    content: userText,
  };
  if (!isPdf && imageB64) {
    message.images = [imageB64];
  }

  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: vlmModel(),
        stream: false,
        format: 'json',
        messages: [message],
      }),
      signal: AbortSignal.timeout(timeoutMs ?? vlmTimeoutMs()),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const content = json?.message?.content ?? json?.response ?? '';
    return parseVlmJson(content);
  } catch {
    return null;
  }
}

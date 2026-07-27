/**
 * Google Cloud Vision OCR for CMR documents.
 * Uses DOCUMENT_TEXT_DETECTION, then maps free text → structured fields.
 */
import fs from 'fs/promises';
import path from 'path';
import { uploadRoot } from '../uploadPath.js';

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';

export function visionConfigured() {
  return Boolean(process.env.GOOGLE_VISION_API_KEY?.trim());
}

/** Resolve /uploads/xxx.jpg (or absolute URL ending with it) to a local file path. */
export function resolveUploadPath(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return null;
  try {
    let pathname = fileUrl;
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      pathname = new URL(fileUrl).pathname;
    }
    const marker = '/uploads/';
    const idx = pathname.indexOf(marker);
    if (idx === -1) return null;
    const filename = path.basename(pathname.slice(idx + marker.length));
    if (!filename || filename.includes('..')) return null;
    return path.join(uploadRoot, filename);
  } catch {
    return null;
  }
}

async function callVision(base64Content, apiKey) {
  const res = await fetch(`${VISION_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          image: { content: base64Content },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        },
      ],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || 'Vision API error';
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  const response = data.responses?.[0];
  if (response?.error) {
    throw new Error(response.error.message || 'Vision annotation failed');
  }

  return (
    response?.fullTextAnnotation?.text ||
    response?.textAnnotations?.[0]?.description ||
    ''
  );
}

function normalize(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function pickRegex(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return normalize(m[1]);
  }
  return null;
}

function lineAfterLabel(lines, labels) {
  const lowerLabels = labels.map((l) => l.toLowerCase());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    for (const label of lowerLabels) {
      if (lower.includes(label)) {
        const after = line.split(/[:：]/).slice(1).join(':').trim();
        if (after && after.length > 1) return normalize(after);
        if (lines[i + 1] && !lowerLabels.some((l) => lines[i + 1].toLowerCase().includes(l))) {
          return normalize(lines[i + 1]);
        }
      }
    }
  }
  return null;
}

/**
 * Heuristic CMR field extraction from OCR plain text.
 * Falls back to trip fields when a value is missing.
 */
export function parseCmrText(rawText, trip = null) {
  const text = normalize(rawText);
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const cmr_number =
    pickRegex(text, [
      /(?:nr\.?\s*(?:cmr|document)|cmr\s*(?:nr\.?|no\.?|#)?)\s*[:\s]*([A-Z0-9\-\/]+)/i,
      /\b(CMR[-\s]?\d{4}[-\s]?\d+)/i,
      /\b([A-Z]{2,4}[-_/]?\d{4,}[-_/]?\d*)\b/,
    ]) ||
    lineAfterLabel(lines, ['cmr', 'nr. cmr', 'document nr']) ||
    trip?.cmr_number ||
    null;

  const date =
    pickRegex(text, [
      /(?:data|date|datum)\s*[:\s]*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})/i,
      /\b(\d{4}-\d{2}-\d{2})\b/,
      /\b(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})\b/,
    ]) ||
    trip?.loading_date ||
    null;

  const shipper =
    lineAfterLabel(lines, [
      'expeditor',
      'sender',
      'shipper',
      '1. expeditor',
      'expediteur',
    ]) ||
    pickRegex(text, [/(?:expeditor|sender|shipper)\s*[:\s]+([^\n]{3,80})/i]) ||
    trip?.shipper_name ||
    null;

  const consignee =
    lineAfterLabel(lines, [
      'destinatar',
      'consignee',
      'receiver',
      '2. destinatar',
      'destinataire',
    ]) ||
    pickRegex(text, [/(?:destinatar|consignee|receiver)\s*[:\s]+([^\n]{3,80})/i]) ||
    trip?.consignee_name ||
    null;

  const goods_description =
    lineAfterLabel(lines, [
      'marfa',
      'marfă',
      'goods',
      'description',
      'natura bunurilor',
      'descriere',
    ]) ||
    pickRegex(text, [/(?:marf[aă]|goods|descriere)\s*[:\s]+([^\n]{3,120})/i]) ||
    trip?.goods_description ||
    null;

  const weight =
    pickRegex(text, [
      /(?:greutate|weight|masse|kg)\s*[:\s]*([\d.,]+)\s*(?:kg)?/i,
      /([\d.,]+)\s*kg\b/i,
    ]) ||
    (trip?.weight_kg != null ? String(trip.weight_kg) : null);

  const packages =
    pickRegex(text, [
      /(?:colete|packages?|colis|nr\.?\s*colete)\s*[:\s]*(\d+)/i,
      /(\d+)\s*(?:colete|packages?|colis)\b/i,
    ]) ||
    (trip?.package_count != null ? String(trip.package_count) : null);

  return {
    cmr_number,
    date: date ? String(date).slice(0, 32) : null,
    shipper,
    consignee,
    goods_description,
    weight,
    packages,
    _stub: false,
    _provider: 'google_vision',
    _raw_text_preview: text.slice(0, 500) || null,
  };
}

/**
 * Run Vision OCR on a local upload path or public /uploads URL.
 * @returns {Promise<object>} structured CMR fields
 */
export async function extractCmrFromImage(fileUrl, trip = null) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error('GOOGLE_VISION_API_KEY is not configured');
    err.code = 'VISION_NOT_CONFIGURED';
    throw err;
  }

  const localPath = resolveUploadPath(fileUrl);
  if (!localPath) {
    const err = new Error('Could not resolve image path for OCR');
    err.code = 'VISION_NO_FILE';
    throw err;
  }

  const buf = await fs.readFile(localPath);
  const base64 = buf.toString('base64');
  const rawText = await callVision(base64, apiKey);
  return parseCmrText(rawText, trip);
}

/** Prefill from trip only (legacy stub / fallback). */
export function stubCmrFromTrip(trip = null) {
  return {
    cmr_number: trip?.cmr_number || null,
    date: trip?.loading_date || new Date().toISOString().slice(0, 10),
    shipper: trip?.shipper_name || null,
    consignee: trip?.consignee_name || null,
    goods_description: trip?.goods_description || null,
    weight: trip?.weight_kg != null ? String(trip.weight_kg) : null,
    packages: trip?.package_count != null ? String(trip.package_count) : null,
    _stub: true,
    _note:
      'OCR stub: date precompletate din cursă. Configurează GOOGLE_VISION_API_KEY pentru extragere reală.',
  };
}

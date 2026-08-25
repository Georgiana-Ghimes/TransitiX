/**
 * ePOD helpers — persist a canvas signature data-URL as a company-scoped upload.
 */

import fs from 'fs';
import path from 'path';
import { uniqueUploadFilename } from '../concurrency.js';
import { publicUploadUrl, uploadRoot } from '../../uploadPath.js';

const MAX_BYTES = 2_000_000;

/**
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
export function saveProofDataUrl(companyId, dataUrl, { kind = 'signature' } = {}) {
  if (!dataUrl) return { ok: false, error: 'imagine lipsă' };
  const raw = String(dataUrl).trim();
  const match = raw.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return { ok: false, error: 'format imagine invalid (aștept data:image/…;base64)' };

  const mime = match[1].toLowerCase();
  const buf = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buf.length) return { ok: false, error: 'imagine goală' };
  if (buf.length > MAX_BYTES) return { ok: false, error: 'imaginea depășește 2 MB' };

  const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
  const filename = uniqueUploadFilename(`${kind}${ext}`, { companyId });
  fs.writeFileSync(path.join(uploadRoot, filename), buf);
  return { ok: true, url: publicUploadUrl(filename) };
}

export function normalizePhotoUrls(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((u) => String(u || '').trim())
    .filter((u) => u.startsWith('/uploads/') || /^https?:\/\//i.test(u))
    .slice(0, 8);
}

export const POD_OUTCOMES = new Set(['livrat', 'refuzat', 'partial']);

export function stopStatusForOutcome(outcome) {
  if (outcome === 'refuzat') return 'esuat';
  return 'finalizat';
}

export function validatePodInput(body = {}) {
  const outcome = String(body.outcome || '').trim();
  if (!POD_OUTCOMES.has(outcome)) {
    return { ok: false, error: 'outcome trebuie să fie livrat, refuzat sau partial' };
  }
  const recipient_name = String(body.recipient_name || '').trim() || null;
  const refusal_reason = String(body.refusal_reason || '').trim() || null;
  const notes = String(body.notes || '').trim() || null;

  if (outcome === 'livrat' && !recipient_name) {
    return { ok: false, error: 'Numele destinatarului e obligatoriu la livrare' };
  }
  if (outcome === 'refuzat' && !refusal_reason) {
    return { ok: false, error: 'Motivul refuzului e obligatoriu' };
  }
  if (outcome === 'livrat' && !body.signature_data_url && !body.signature_url) {
    return { ok: false, error: 'Semnătura e obligatorie la livrare' };
  }

  return {
    ok: true,
    value: {
      outcome,
      recipient_name,
      refusal_reason,
      notes,
      signature_data_url: body.signature_data_url || null,
      signature_url: body.signature_url || null,
      photo_urls: normalizePhotoUrls(body.photo_urls),
      latitude: body.latitude != null && Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : null,
      longitude: body.longitude != null && Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : null,
    },
  };
}

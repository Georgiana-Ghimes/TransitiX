/**
 * CMR text → structured fields, plus the trip prefill used when nothing has been read.
 *
 * There is no OCR here any more: photo reading is PaddleOCR's job, through
 * `lib/ocr/readText.js`. What is left is the mapping and the prefill.
 */
import path from 'path';
import { uploadRoot } from '../uploadPath.js';

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

/** What the CMR screen starts from: the trip's own fields, nothing read off a photo. */
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
    _note: 'Date precompletate din cursă. Fotografiile se citesc pe /avize, prin OCR-ul local.',
  };
}

/**
 * Hard lock: unacked low OCR on Număr TPO cannot enter the annex,
 * even with allow_unconfirmed.
 */

export const OCR_VERIFY_KEYS = ['numar_tpo', 'numar_auto', 'ruta_transport'];

function correctedSet(doc) {
  return new Set(Array.isArray(doc?.corrected_fields) ? doc.corrected_fields : []);
}

/** Resolve low/ok for a single key from stored field_confidence (+ heuristics not needed here). */
function storedConfidenceStatus(doc, key) {
  const stored = doc?.field_confidence;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
  const val = stored[key];
  if (val === 'low' || val === 'ok') return val;
  if (val && typeof val === 'object') {
    if (val.status === 'review' || val.status === 'missing') return 'low';
    if (val.status === 'ok') return 'ok';
    if (typeof val.confidence === 'number') return val.confidence >= 0.8 ? 'ok' : 'low';
  }
  return null;
}

/**
 * Docs that still have unacked low numar_tpo (not confirmed, not corrected).
 * Auto/ruta low are enforced in the UI carousel; annex hard-lock focuses on TPO
 * (wrong merge group risk).
 */
export function docsUnackedLowTpo(docs) {
  return (docs || []).filter((d) => {
    if (!d || d.status === 'confirmed') return false;
    if (correctedSet(d).has('numar_tpo')) return false;
    return storedConfidenceStatus(d, 'numar_tpo') === 'low';
  });
}

/**
 * @throws {{ status: number, code: string, blocked: object[] }}
 */
export function refuseAnnexIfUnackedLowTpo(docs) {
  const blocked = docsUnackedLowTpo(docs);
  if (!blocked.length) return;
  const n = blocked.length;
  const err = new Error(
    n === 1
      ? 'Număr TPO e OCR nesigur: verifică pe document (Verifică → Marchează verificat sau Salvează) înainte de anexă.'
      : `${n} documente au Număr TPO OCR nesigur. Verifică pe document înainte de anexă.`,
  );
  err.status = 409;
  err.code = 'OCR_VERIFY_REQUIRED';
  err.blocked = blocked.map((d) => ({
    id: d.id,
    filename: d.original_filename,
    numar_tpo: d.numar_tpo ?? null,
  }));
  throw err;
}

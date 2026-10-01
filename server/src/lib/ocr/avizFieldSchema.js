/**
 * Commercial field schema for RAI avize — not a generic invoice.
 *
 * Confidence bands drive HITL routing; REJECT in extract.js still decides whether a
 * value is written at all.
 */

export const ROUTING = Object.freeze({
  AUTO: 'auto',
  HITL_OPTIONAL: 'hitl_optional',
  HITL_REQUIRED: 'hitl_required',
});

/** Default bands for non-critical OCR fields. */
export const DEFAULT_BANDS = Object.freeze({
  auto: 0.92,
  optional: 0.70,
});

/** Stricter bands for fields that break the annex if wrong. */
export const CRITICAL_BANDS = Object.freeze({
  auto: 0.95,
  optional: 0.80,
});

/**
 * @typedef {object} AvizFieldMeta
 * @property {string} key
 * @property {string} label
 * @property {'ocr'|'manual'} source
 * @property {boolean} critical
 * @property {{ auto: number, optional: number }} bands
 */

/** @type {AvizFieldMeta[]} */
export const AVIZ_FIELD_SCHEMA = Object.freeze([
  { key: 'numar_tpo', label: 'TPO', source: 'ocr', critical: true, bands: CRITICAL_BANDS },
  { key: 'numar_document_marfa', label: 'Nr. document marfă', source: 'ocr', critical: false, bands: DEFAULT_BANDS },
  { key: 'numar_auto', label: 'Nr. auto', source: 'ocr', critical: true, bands: CRITICAL_BANDS },
  { key: 'data_efectuare_cursa', label: 'Data efectuare cursă', source: 'ocr', critical: true, bands: CRITICAL_BANDS },
  { key: 'ruta_transport', label: 'Rută transport', source: 'ocr', critical: false, bands: DEFAULT_BANDS },
  { key: 'tip_marfa', label: 'Tip marfă', source: 'ocr', critical: false, bands: DEFAULT_BANDS },
  { key: 'cantitate_marfa', label: 'Cantitate', source: 'ocr', critical: false, bands: DEFAULT_BANDS },
  { key: 'gross_weight_kg', label: 'Greutate brută', source: 'ocr', critical: false, bands: DEFAULT_BANDS },
  { key: 'net_weight_kg', label: 'Greutate netă', source: 'ocr', critical: false, bands: DEFAULT_BANDS },
  { key: 'numar_curse', label: 'Nr. curse', source: 'ocr', critical: false, bands: DEFAULT_BANDS },
  { key: 'km_parcursi', label: 'Km parcurși', source: 'manual', critical: false, bands: DEFAULT_BANDS },
  { key: 'tarif_km', label: 'Tarif km', source: 'manual', critical: false, bands: DEFAULT_BANDS },
  { key: 'valoare_tpo', label: 'Valoare TPO', source: 'manual', critical: false, bands: DEFAULT_BANDS },
  { key: 'taxe_suplimentare', label: 'Taxe suplimentare', source: 'manual', critical: false, bands: DEFAULT_BANDS },
  { key: 'observatii', label: 'Observații', source: 'manual', critical: false, bands: DEFAULT_BANDS },
]);

const BY_KEY = Object.freeze(
  Object.fromEntries(AVIZ_FIELD_SCHEMA.map((f) => [f.key, f])),
);

export function fieldMeta(key) {
  return BY_KEY[key] ?? null;
}

export function ocrFieldKeys() {
  return AVIZ_FIELD_SCHEMA.filter((f) => f.source === 'ocr').map((f) => f.key);
}

export function criticalOcrKeys() {
  return AVIZ_FIELD_SCHEMA.filter((f) => f.source === 'ocr' && f.critical).map((f) => f.key);
}

/**
 * Confidence band for HITL routing on one field.
 * @returns {'auto'|'hitl_optional'|'hitl_required'}
 */
export function confidenceBand(fieldKey, confidence) {
  const meta = fieldMeta(fieldKey);
  const bands = meta?.bands ?? DEFAULT_BANDS;
  const c = Number(confidence) || 0;
  if (c >= bands.auto) return ROUTING.AUTO;
  if (c >= bands.optional) return ROUTING.HITL_OPTIONAL;
  return ROUTING.HITL_REQUIRED;
}

/** Worst (most severe) routing among a list. */
export function worstRouting(...routings) {
  const rank = {
    [ROUTING.AUTO]: 0,
    [ROUTING.HITL_OPTIONAL]: 1,
    [ROUTING.HITL_REQUIRED]: 2,
  };
  let worst = ROUTING.AUTO;
  for (const r of routings) {
    if ((rank[r] ?? 0) > (rank[worst] ?? 0)) worst = r;
  }
  return worst;
}

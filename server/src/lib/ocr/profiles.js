/**
 * OCR profiles — one per document layout, not one per document type.
 *
 * The client was explicit: do not assume every document has the same format. A profile
 * declares how to recognise a layout and how to pull each field out of it, so supporting a
 * new supplier's aviz is a new profile object, not a change to the extraction engine.
 *
 * Every profile is data plus small pure functions; nothing here touches the database.
 */

import {
  NO_MATCH,
  extractDate,
  extractGrossWeight,
  extractNetWeight,
  extractPalletCount,
  extractPlate,
  extractQuantity,
  matchPatterns,
  parseNumber,
} from './fields.js';

/** How strongly a text looks like this layout, 0..1. */
function scoreMarkers(text, markers) {
  const blob = String(text || '').toLowerCase();
  if (!markers.length) return 0;
  const hits = markers.filter((marker) => (
    marker instanceof RegExp ? marker.test(blob) : blob.includes(String(marker).toLowerCase())
  ));
  return hits.length / markers.length;
}

const tpoField = (patterns) => (text) => matchPatterns(text, patterns, {
  transform: (raw) => String(raw).toUpperCase().replace(/\s+/g, ''),
});

const docNoField = (patterns) => (text) => matchPatterns(text, patterns, {
  transform: (raw) => String(raw).toUpperCase().replace(/\s+/g, ''),
});

const routeField = (text) => matchPatterns(text, [
  /(?:ruta|traseu|route)\s*[:\-]?\s*([A-ZĂÂÎȘȚ][^\n;]{3,80})/i,
  /\b([A-ZĂÂÎȘȚ][a-zăâîșț-]{2,}\s*(?:-|–|→|catre|către)\s*[A-ZĂÂÎȘȚ][a-zăâîșț-]{2,})\b/,
], { baseConfidence: 0.8 });

const goodsField = (text) => matchPatterns(text, [
  /(?:tip\s*marfa|denumire\s*produs|produs|marfa)\s*[:\-]?\s*([^\n;]{3,60})/i,
], { baseConfidence: 0.75 });

/**
 * The built-in profiles.
 *
 * `fields` maps a target column to an extractor. `weights` says which fields decide the
 * document's overall confidence — a missing TPO number matters far more than a missing route.
 */
export const OCR_PROFILES = [
  {
    id: 'aviz_baumit_psl',
    documentType: 'aviz',
    name: 'Aviz Baumit — PSL',
    markers: [/\bpsl\b/, /baumit/, /aviz/],
    fields: {
      numar_tpo: tpoField([/\b(TPO[\s\-.]*\d[\d./-]*)\b/i, /\b(\d{4,}\/\d{2,4})\b/]),
      data_efectuare_cursa: extractDate,
      numar_auto: extractPlate,
      numar_document_marfa: docNoField([/\b(PSL[\s\-.]*\d[\d./-]*)\b/i]),
      ruta_transport: routeField,
      tip_marfa: goodsField,
      gross_weight_kg: extractGrossWeight,
      net_weight_kg: extractNetWeight,
      pallets: extractPalletCount,
      quantity: extractQuantity,
    },
    weights: {
      numar_tpo: 3, numar_auto: 3, data_efectuare_cursa: 2,
      gross_weight_kg: 2, numar_document_marfa: 2, ruta_transport: 1,
      tip_marfa: 1, net_weight_kg: 0.5, pallets: 0.5, quantity: 0.5,
    },
  },
  {
    id: 'aviz_baumit_tro',
    documentType: 'aviz',
    name: 'Aviz Baumit — TRO',
    markers: [/\btro\b/, /baumit/, /aviz/],
    fields: {
      numar_tpo: tpoField([/\b(TPO[\s\-.]*\d[\d./-]*)\b/i, /\b(\d{4,}\/\d{2,4})\b/]),
      data_efectuare_cursa: extractDate,
      numar_auto: extractPlate,
      numar_document_marfa: docNoField([/\b(TRO[\s\-.]*\d[\d./-]*)\b/i]),
      ruta_transport: routeField,
      tip_marfa: goodsField,
      gross_weight_kg: extractGrossWeight,
      net_weight_kg: extractNetWeight,
      pallets: extractPalletCount,
      quantity: extractQuantity,
    },
    weights: {
      numar_tpo: 3, numar_auto: 3, data_efectuare_cursa: 2,
      gross_weight_kg: 2, numar_document_marfa: 2, ruta_transport: 1,
      tip_marfa: 1, net_weight_kg: 0.5, pallets: 0.5, quantity: 0.5,
    },
  },
  {
    id: 'aviz_generic',
    documentType: 'aviz',
    name: 'Aviz generic',
    markers: [/aviz/, /insotire/, /însoțire'/],
    fields: {
      numar_tpo: tpoField([/\b(TPO[\s\-.]*\d[\d./-]*)\b/i]),
      data_efectuare_cursa: extractDate,
      numar_auto: extractPlate,
      numar_document_marfa: docNoField([/\b(?:aviz|nr\.?)\s*([A-Z]{0,4}[\s\-.]*\d[\d./-]*)\b/i]),
      ruta_transport: routeField,
      tip_marfa: goodsField,
      gross_weight_kg: extractGrossWeight,
      net_weight_kg: extractNetWeight,
      pallets: extractPalletCount,
      quantity: extractQuantity,
    },
    weights: {
      numar_auto: 3, data_efectuare_cursa: 2, gross_weight_kg: 2,
      numar_tpo: 1, numar_document_marfa: 1, ruta_transport: 1, tip_marfa: 1,
    },
  },
  {
    id: 'cmr_standard',
    documentType: 'cmr',
    name: 'CMR internațional',
    markers: [/\bcmr\b/, /expeditor/, /destinatar/, /transportator/],
    fields: {
      // The value must contain a digit. Without that guard the pattern happily matches
      // "CMR SCRISOARE DE TRANSPORT" and the document number comes out as "SCRISOARE".
      cmr_number: docNoField([
        /\b(?:cmr|seria)\s*nr\.?\s*([A-Z0-9][A-Z0-9\-/]*\d[A-Z0-9\-/]*)\b/i,
        /\b(?:cmr|seria)\s*([A-Z0-9][A-Z0-9\-/]*\d[A-Z0-9\-/]*)\b/i,
      ]),
      loading_date: extractDate,
      numar_auto: extractPlate,
      shipper_name: (text) => matchPatterns(text, [
        /(?:expeditor|shipper)\s*[:\-]?\s*([^\n;]{3,60})/i,
      ], { baseConfidence: 0.8 }),
      consignee_name: (text) => matchPatterns(text, [
        /(?:destinatar|consignee)\s*[:\-]?\s*([^\n;]{3,60})/i,
      ], { baseConfidence: 0.8 }),
      gross_weight_kg: extractGrossWeight,
      pallets: extractPalletCount,
    },
    weights: {
      cmr_number: 3, numar_auto: 2, loading_date: 2, gross_weight_kg: 2,
      shipper_name: 1, consignee_name: 1, pallets: 0.5,
    },
  },
];

export function getProfile(id) {
  return OCR_PROFILES.find((p) => p.id === id) ?? null;
}

export function profilesFor(documentType) {
  return OCR_PROFILES.filter((p) => !documentType || p.documentType === documentType);
}

/**
 * Best-matching profile for a text.
 *
 * Returns the ranked list too, so an operator can override the guess when a scan is poor —
 * detection is a hint, not a verdict.
 */
export function detectProfile(text, { documentType, profiles = OCR_PROFILES } = {}) {
  const candidates = profiles
    .filter((p) => !documentType || p.documentType === documentType)
    .map((profile) => ({ profile, score: Math.round(scoreMarkers(text, profile.markers) * 100) / 100 }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0] ?? null;
  return {
    profile: best && best.score > 0 ? best.profile : null,
    score: best?.score ?? 0,
    candidates,
  };
}

/** Numbers that arrive as `{ quantity, unit }` are split into their own columns. */
export function normaliseExtracted(fields) {
  const out = { ...fields };
  const qty = out.quantity;
  if (qty?.value && typeof qty.value === 'object') {
    out.quantity = { ...qty, value: qty.value.quantity };
    out.quantity_unit = {
      value: qty.value.unit,
      confidence: qty.value.unit ? qty.confidence : 0,
      matched: qty.matched,
      status: qty.value.unit ? qty.status : 'missing',
    };
  }
  return out;
}

export { NO_MATCH, parseNumber };

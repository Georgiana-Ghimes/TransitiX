/**
 * OCR profiles, one per document layout, not one per document type.
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
  extractGoodsUnit,
  extractGrossWeight,
  extractNetWeight,
  extractPalletCount,
  extractPlate,
  extractQuantity,
  isPlausibleQuantity,
  matchPatterns,
  parseNumber,
} from './fields.js';
import { parseBaumitAviz } from '../avizOcr.js';

/** How strongly a text looks like this layout, 0..1. */
function scoreMarkers(text, markers) {
  const blob = String(text || '').toLowerCase();
  if (!markers.length) return 0;
  const hits = markers.filter((marker) => (
    marker instanceof RegExp ? marker.test(blob) : blob.includes(String(marker).toLowerCase())
  ));
  return hits.length / markers.length;
}

/**
 * Paddle (and other photo OCR) often glues codes to the previous word
 * (`expeditiePSL-0044362`) or uses `_` instead of space (`transport_TPO-…`).
 * Do not require `\b` before the code, letters/`_` are word chars, so `\b`
 * misses the glued forms. Requiring digits after the prefix keeps false hits low.
 */
const TPO_CODE = /(TPO[\s\-._]*\d{3,}[\d./-]*)/i;
const PSL_CODE = /(PSL[\s\-._]*\d{3,}[\d./-]*)/i;
const TRO_CODE = /(TRO[\s\-._]*\d{3,}[\d./-]*)/i;

/**
 * TPO / PSL / TRO codes are zero-padded to this many digits.
 *
 * A photo where a hand or a fold covers the last digit still reads as a valid-looking code, and
 * a short code copied onto an invoice is worse than a blank field. Length that does not match
 * pulls the value below the accept threshold so it lands in front of an operator.
 */
const CODE_DIGITS = 7;

function codeLengthPenalty(value) {
  const digits = String(value || '').match(/\d+/g)?.join('') ?? '';
  if (!digits) return 0;
  return digits.length === CODE_DIGITS ? 0 : 0.35;
}

const tpoField = (patterns) => (text) => {
  const found = matchPatterns(text, patterns, {
    transform: (raw) => String(raw).toUpperCase().replace(/[\s_]+/g, ''),
  });
  if (!found.value) return found;
  const penalty = codeLengthPenalty(found.value);
  return penalty ? { ...found, confidence: Math.max(0, found.confidence - penalty) } : found;
};

const docNoField = (patterns) => (text) => matchPatterns(text, patterns, {
  transform: (raw) => String(raw).toUpperCase().replace(/[\s_]+/g, ''),
});

const ROUTE_NOISE = /paletizare|infoliere|infotiere|servici|taxa|descarcare|macara|ambalaj|gtin|cod\s*marf/i;

/**
 * Loose "City - City" needs spaces (or an arrow / "către") around the separator.
 * A glued hyphen is a compound place name ("Bolintin-Deal"), not a route — treating it as one
 * wrote the Expeditor's town onto the annex while the delivery address sat unused on the page.
 */
const LOOSE_CITY_ROUTE = /\b([A-ZĂÂÎȘȚ][a-zăâîșț]{2,}(?:\s+[A-ZĂÂÎȘȚ]?[a-zăâîșț]{2,}){0,2}\s+(?:-|–|→|catre|către)\s+[A-ZĂÂÎȘȚ][a-zăâîșț]{2,}(?:\s+[A-ZĂÂÎȘȚ]?[a-zăâîșț]{2,}){0,2})\b/;

const routeField = (text) => {
  const labelled = matchPatterns(text, [
    /(?:ruta|traseu|route)\s*[:\-]?\s*([A-ZĂÂÎȘȚ][^\n;]{3,80})/i,
  ], { baseConfidence: 0.8 });
  if (labelled.value && !ROUTE_NOISE.test(labelled.value)) return labelled;

  const loose = matchPatterns(text, [LOOSE_CITY_ROUTE], { baseConfidence: 0.65 });
  if (loose.value && !ROUTE_NOISE.test(loose.value)) return loose;
  return NO_MATCH;
};

/** Baumit annex route: Site (Bol/Mil) → Adresă de livrare. Falls back to the generic matcher. */
const baumitRouteField = (text) => {
  try {
    const route = parseBaumitAviz(text)?.ruta_transport;
    if (route) return { value: route, confidence: 0.92, matched: route };
  } catch {
    // Profile extractors must not throw the whole document; fall through.
  }
  return routeField(text);
};

const goodsField = (text) => {
  // Do not treat HS / "Cod marfă: 38245090" as the goods description.
  const labelled = matchPatterns(text, [
    /(?:tip\s*marf[aă]|denumire\s*produs)\s*[:\-]?\s*([^\n;]{3,60})/i,
    /(?<!cod\s)(?<!codul\s)\bprodus\b\s*[:\-]?\s*([^\n;]{3,60})/i,
  ], { baseConfidence: 0.75 });
  if (labelled.value && !/^\d{6,}$/.test(String(labelled.value).trim())) return labelled;

  // Baumit product lines often start with MPI / MP1 (OCR of MPI).
  const product = matchPatterns(text, [
    /\b((?:MPI|MP[Il1])\s*\d+[^\n]{0,50})/i,
  ], { baseConfidence: 0.7 });
  if (product.value) {
    return {
      ...product,
      value: String(product.value).replace(/\s+/g, ' ').trim().slice(0, 60),
    };
  }

  // The packaging a document names is a goods type too, and on a transfer aviz it is the only
  // one present: `Numarul de galeti 768.00` says buckets, where the `Cantitate 768.00 buc` two
  // lines above is merely counting them. RAI's annex wants the word that names something.
  return extractGoodsUnit(text);
};

/**
 * The built-in profiles.
 *
 * `fields` maps a target column to an extractor. `weights` says which fields decide the
 * document's overall confidence, a missing TPO number matters far more than a missing route.
 */
/**
 * Carnet de bord: the driver's own handwritten notebook page, photographed in the cab.
 *
 * Its vocabulary is not the printed aviz vocabulary. That is why `aviz_generic` reads only the
 * fields whose patterns happen to be layout-independent — the plate and the TRO code — and
 * leaves the rest blank however well the OCR performed: `CANT MARFĂ` is not `cantitate`, and
 * `NR. CURSE` had no extractor in any profile.
 */
const CARNET_LABEL = /\b(?:tip\s*marf|cant\.?\s*marf|nr\.?\s*document|nr\.?\s*curse|nr\.?\s*auto|data|tpo)/i;

/**
 * A number written the way a hand writes it, where one separator does both jobs.
 *
 * `15,744,00` is on the page with a comma for thousands and for the decimal, and the shared
 * `parseNumber` returns null for it. That parser must not change — it decides what a weight
 * means everywhere else — so the rule lives here, with the layout that needs it.
 */
function carnetNumber(raw) {
  const text = String(raw ?? '').trim();
  const separators = text.match(/[.,]/g) ?? [];
  // None or one: the shared parser already knows the Romanian rules.
  if (separators.length < 2) return parseNumber(text);

  const cut = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','));
  const fraction = text.slice(cut + 1).replace(/\D/g, '');
  const oneKind = new Set(separators).size === 1;
  // `1,234,567` is thousands all the way down; `15,744,00` ends in a two-digit remainder and
  // cannot be. Three digits after the last separator means grouping, not a decimal.
  if (fraction.length === 3 && oneKind) {
    const digits = text.replace(/[.,\s]/g, '');
    return /^\d+$/.test(digits) ? Number(digits) : null;
  }

  const whole = text.slice(0, cut).replace(/[.,\s]/g, '');
  if (!/^\d+$/.test(whole)) return null;
  const value = Number(`${whole}.${fraction || '0'}`);
  return Number.isFinite(value) ? value : null;
}

/** `TPO` in ballpoint reads back as `TP0`, `TPQ`, `IPO`. Fix the prefix, keep the digits. */
const carnetTpoField = (text) => {
  const found = String(text || '').match(/\b(?:TPO|TP0|TPQ|TPD|IPO|7PO)[\s\-._:]*(\d{3,})/i);
  if (!found) return NO_MATCH;
  const value = `TPO-${found[1]}`;
  const penalty = codeLengthPenalty(value);
  return { value, confidence: Math.max(0, 0.88 - penalty), matched: found[0] };
};

/**
 * `DATA: 11.08.2026`, where the hand's dots photograph as colons.
 *
 * Accepted only behind the `DATA` label and only as three parts. Without that, `11:08` is a
 * time of day and this would invent a date out of one.
 */
const carnetDateField = (text) => {
  const found = String(text || '').match(
    /\bdata\s*[:.\-]?\s*(\d{1,2})\s*[.:\-/]\s*(\d{1,2})\s*[.:\-/]\s*(\d{2,4})\b/i
  );
  if (found) {
    const day = Number(found[1]);
    const month = Number(found[2]);
    let year = Number(found[3]);
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { value: iso, confidence: 0.88, matched: found[0] };
    }
  }
  return extractDate(text);
};

/**
 * The route runs over more than one line: the origin after `RUTA TRANS.`, the delivery address
 * on the line below. Reading only the labelled line drops the destination, which is the half
 * the annex actually needs.
 */
const carnetRouteField = (text) => {
  const lines = String(text || '').split(/\n/);
  const start = lines.findIndex((line) => /\bruta\s*trans/i.test(line));
  if (start < 0) return routeField(text);

  const parts = [lines[start].replace(/^.*?\bruta\s*trans[.\s]*:?\s*/i, '')];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || CARNET_LABEL.test(line)) break;
    parts.push(line);
  }
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (joined.length < 3) return NO_MATCH;

  // A street word starts the delivery half. Say so with an arrow rather than running the two
  // together, because "origin destination" reads as a single place name on the sheet.
  const split = joined.match(/^(.*?)\s*\b((?:b-?dul|bd|bud|str|sos|șos|calea|aleea)\b.*)$/i);
  const value = split && split[1].trim() ? `${split[1].trim()} → ${split[2].trim()}` : joined;
  return { value: value.slice(0, 120), confidence: split ? 0.8 : 0.65, matched: joined };
};

const carnetGoodsField = (text) => {
  const found = String(text || '').match(/\btip\s*marf[aăá]?\s*[:.\-]?\s*([^\n;]{3,60})/i);
  if (!found) return goodsField(text);
  const value = found[1].replace(/\s+/g, ' ').trim();
  return value ? { value: value.slice(0, 60), confidence: 0.85, matched: found[0] } : NO_MATCH;
};

/** `CANT MARFĂ`, which `extractQuantity` never matched — it only knows `cantitate`. */
const carnetQuantityField = (text) => {
  // The unit must stay on the number's own line. With `\s*` it reaches the next line and takes
  // the `NR` of `NR. DOCUMENT` as a unit — which `toColumns` then copies into Tip marfă when
  // that field is empty, putting a word on the customer's annex that names nothing.
  const found = String(text || '').match(
    /\bcant(?:itate)?\.?[^\S\n]*marf[aăá]?[^\S\n]*[:.\-]?[^\S\n]*([\d.,]+)[^\S\n]*([a-zăâîșț]{2,8})?/i
  );
  if (!found) return extractQuantity(text);
  const value = carnetNumber(found[1]);
  const unit = (found[2] || '').toLowerCase() || null;
  if (value == null || !isPlausibleQuantity(value, unit)) return NO_MATCH;
  return { value: { quantity: value, unit }, confidence: 0.85, matched: found[0] };
};

/** `NR. CURSE: 1`. A TPO may cover several trips; nothing extracted this before. */
const carnetTripCountField = (text) => {
  const found = String(text || '').match(/\bnr\.?\s*curse\s*[:.\-]?\s*(\d{1,2})\b/i);
  if (!found) return NO_MATCH;
  const value = Number(found[1]);
  if (!Number.isFinite(value) || value < 1 || value > 99) return NO_MATCH;
  return { value, confidence: 0.85, matched: found[0] };
};

export const OCR_PROFILES = [
  {
    id: 'carnet_bord',
    documentType: 'aviz',
    name: 'Carnet de bord, scris de mână',
    markers: [
      /nr\.?\s*auto/, /cant\.?\s*marf/, /nr\.?\s*curse/,
      /tip\s*marf/, /ruta\s*trans/, /nr\.?\s*document/,
    ],
    fields: {
      numar_tpo: carnetTpoField,
      data_efectuare_cursa: carnetDateField,
      numar_auto: extractPlate,
      numar_document_marfa: docNoField([TRO_CODE, PSL_CODE]),
      ruta_transport: carnetRouteField,
      tip_marfa: carnetGoodsField,
      quantity: carnetQuantityField,
      numar_curse: carnetTripCountField,
    },
    weights: {
      numar_tpo: 3, numar_auto: 3, data_efectuare_cursa: 2,
      numar_document_marfa: 2, quantity: 2, ruta_transport: 1,
      tip_marfa: 1, numar_curse: 1,
    },
  },
  {
    id: 'aviz_baumit_psl',
    documentType: 'aviz',
    name: 'Aviz Baumit, PSL',
    markers: [/\bpsl\b/, /baumit/, /aviz/],
    fields: {
      numar_tpo: tpoField([TPO_CODE, /\b(\d{4,}\/\d{2,4})\b/]),
      data_efectuare_cursa: extractDate,
      numar_auto: extractPlate,
      numar_document_marfa: docNoField([PSL_CODE]),
      ruta_transport: baumitRouteField,
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
    name: 'Aviz Baumit, TRO',
    markers: [/\btro\b/, /baumit/, /aviz/],
    fields: {
      numar_tpo: tpoField([TPO_CODE, /\b(\d{4,}\/\d{2,4})\b/]),
      data_efectuare_cursa: extractDate,
      numar_auto: extractPlate,
      numar_document_marfa: docNoField([TRO_CODE]),
      ruta_transport: baumitRouteField,
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
    markers: [
      /aviz/,
      /insotire/,
      /însoțire/,
      /\btpo\b/,
      /expeditor/,
      /livrare/,
      /comanda\s+de\s+transport/,
    ],
    fields: {
      numar_tpo: tpoField([TPO_CODE]),
      data_efectuare_cursa: extractDate,
      numar_auto: extractPlate,
      numar_document_marfa: docNoField([
        /\b(?:aviz|nr\.?)\s*([A-Z]{0,4}[\s\-._]*\d[\d./-]*)\b/i,
        PSL_CODE,
      ]),
      ruta_transport: routeField,
      tip_marfa: goodsField,
      gross_weight_kg: extractGrossWeight,
      net_weight_kg: extractNetWeight,
      pallets: extractPalletCount,
      quantity: extractQuantity,
    },
    weights: {
      numar_tpo: 3, numar_auto: 3, data_efectuare_cursa: 2,
      numar_document_marfa: 1, ruta_transport: 1, tip_marfa: 1,
      gross_weight_kg: 1,
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
 * Returns the ranked list too, so an operator can override the guess when a scan is poor,
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

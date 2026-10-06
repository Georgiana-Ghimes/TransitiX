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
  packagingWordIn,
  parseNumber,
} from './fields.js';
import { parseBaumitAviz, normalizeTpo, TPO_CODE_DIGITS } from '../avizOcr.js';
import { countFilledSheetSlots, withNumberedFallback } from './numberedSheet.js';

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
 *
 * `/` and `:` are handwriting separators ("TPO / 31027" in red on a printed Baumit).
 */
const CODE_SEP = '[\\s\\-._/:]*';
const TPO_CODE = new RegExp(`(TPO${CODE_SEP}\\d{3,}[\\d./-]*)`, 'i');
const PSL_CODE = new RegExp(`(PSL${CODE_SEP}\\d{3,}[\\d./-]*)`, 'i');
const TRO_CODE = new RegExp(`(TRO${CODE_SEP}\\d{3,}[\\d./-]*)`, 'i');

/**
 * TPO / PSL / TRO codes are zero-padded to this many digits (`TPO-0032755`).
 * Handwritten short forms (`TPO/32755`) are padded in `normalizeTpo`; a length that
 * still does not match (truncated OCR, compound year ids) keeps the confidence penalty.
 */
const CODE_DIGITS = TPO_CODE_DIGITS;

function codeLengthPenalty(value) {
  const digits = String(value || '').match(/\d+/g)?.join('') ?? '';
  if (!digits) return 0;
  return digits.length === CODE_DIGITS ? 0 : 0.35;
}

/** Collapse `TPO / 31027` / `TPO-0025629` into the stored 7-digit form. */
function canonicalTpoRaw(raw) {
  return normalizeTpo(raw, 3) || String(raw || '').toUpperCase().replace(/[\s_]+/g, '');
}

const tpoField = (patterns) => (text) => {
  const found = matchPatterns(text, patterns, {
    transform: canonicalTpoRaw,
  });
  if (!found.value) return found;
  const penalty = codeLengthPenalty(found.value);
  return penalty ? { ...found, confidence: Math.max(0, found.confidence - penalty) } : found;
};

/**
 * Printed aviz + handwritten TPO (hybrid).
 *
 * Baumit leaves "Num de comanda de transport" blank; the driver writes `TPO / 31027`
 * in red. The printed TRO/PSL stays the document number — only the note by that label
 * (or a slash-separated TPO anywhere) is the order number.
 */
const hybridAvizTpoField = (text) => {
  const printed = tpoField([TPO_CODE, /\b(\d{4,}\/\d{2,4})\b/])(text);
  if (printed.value) return printed;

  const mangled = String(text || '').match(
    new RegExp(`\\b(?:TPO|TP0|TPQ|TPD|IPO|7PO)${CODE_SEP}(\\d{3,})`, 'i'),
  );
  if (mangled) {
    const value = normalizeTpo(`TPO-${mangled[1]}`, 3) || `TPO-${mangled[1]}`;
    const penalty = codeLengthPenalty(value);
    return { value, confidence: Math.max(0, 0.82 - penalty), matched: mangled[0] };
  }

  // Same line as the transport-order label (print blank, ink filled in).
  const sameLine = String(text || '').match(
    /(?:num\.?\s*(?:de\s+)?)?comand[aă]\s+(?:de\s+)?transport\s*[:.\-]?\s*((?:TPO|TP0|TPQ)[\s\-._/:]*\d{3,}|\d{4,7})\b/i,
  );
  if (sameLine) {
    const digits = sameLine[1].match(/\d{3,}/)?.[0];
    if (digits) {
      const value = normalizeTpo(`TPO-${digits}`, 3) || `TPO-${digits}`;
      const penalty = codeLengthPenalty(value);
      return { value, confidence: Math.max(0, 0.72 - penalty), matched: sameLine[0] };
    }
  }

  // Label on one line, handwritten TPO within the next lines of the cell.
  const nearby = String(text || '').match(
    /(?:num\.?\s*(?:de\s+)?)?comand[aă]\s+(?:de\s+)?transport[\s\S]{0,80}?((?:TPO|TP0|TPQ)[\s\-._/:]*\d{3,})/i,
  );
  if (nearby) {
    const digits = nearby[1].match(/\d{3,}/)?.[0];
    if (digits) {
      const value = normalizeTpo(`TPO-${digits}`, 3) || `TPO-${digits}`;
      const penalty = codeLengthPenalty(value);
      return { value, confidence: Math.max(0, 0.75 - penalty), matched: nearby[0] };
    }
  }

  return NO_MATCH;
};

/** Collapse `TRO / 0010203` / spaces into the stored prefix form; reject bare house numbers. */
function canonicalDocNo(raw) {
  const upper = String(raw || '').toUpperCase().trim();
  const prefixed = upper.match(/\b((?:PSL|TRO|TEST-AVZ)[\s\-._/:]*\d[\d./-]*)\b/i);
  if (prefixed) {
    const kind = prefixed[1].match(/^(PSL|TRO|TEST-AVZ)/i)?.[1].toUpperCase() || 'PSL';
    const digits = prefixed[1].replace(/^[A-Z-]+/i, '').replace(/[^\d]/g, '');
    return digits ? `${kind}-${digits}` : null;
  }
  // `nr. 220` from "Bvd. Iuliu Maniu, nr. 220" is a house number, not an aviz (#54).
  const compact = upper.replace(/[\s_]+/g, '');
  if (/^\d{1,4}([./-]\d+)*$/i.test(compact)) return null;
  return compact || null;
}

const docNoField = (patterns) => (text) => matchPatterns(text, patterns, {
  transform: canonicalDocNo,
});

const ROUTE_NOISE = /paletizare|infoliere|infotiere|servici|taxa|descarcare|macara|ambalaj|gtin|cod\s*marf/i;

/**
 * Loose "City - City" needs spaces (or an arrow / "către") around the separator.
 * A glued hyphen is a compound place name ("Bolintin-Deal"), not a route — treating it as one
 * wrote the Expeditor's town onto the annex while the delivery address sat unused on the page.
 */
const LOOSE_CITY_ROUTE = /\b([A-ZĂÂÎȘȚ][a-zăâîșț]{2,}(?:\s+[A-ZĂÂÎȘȚ]?[a-zăâîșț]{2,}){0,2}\s+(?:-|–|→|catre|către)\s+[A-ZĂÂÎȘȚ][a-zăâîșț]{2,}(?:\s+[A-ZĂÂÎȘȚ]?[a-zăâîșț]{2,}){0,2})\b/;

/**
 * A cell's worth of text: stops at a newline, a `;` or a tab.
 *
 * The tab is what `pdfRows` / the OCR sidecar write between two columns of the same row. Before
 * they did, a label at the left edge and the figure at the right edge were on separate lines and
 * these captures could not reach past the label anyway. Now that the row is one line, `[^\n;]`
 * would run from „Ruta:" all the way through whatever the page prints in the next column.
 */
const CELL = '[^\\n;\\t]';

const routeField = (text) => {
  const labelled = matchPatterns(text, [
    new RegExp(`(?:ruta|traseu|route)\\s*[:\\-]?\\s*([A-ZĂÂÎȘȚ]${CELL}{3,80})`, 'i'),
  ], { baseConfidence: 0.8 });
  if (labelled.value && !ROUTE_NOISE.test(labelled.value)) return labelled;

  const loose = matchPatterns(text, [LOOSE_CITY_ROUTE], { baseConfidence: 0.65 });
  if (loose.value && !ROUTE_NOISE.test(loose.value)) return loose;
  return NO_MATCH;
};

/**
 * Baumit annex route: Expeditor (Bol/Mil) → Adresa de livrare.
 * If that parse is empty, only an explicit "Ruta:" label is accepted — never loose City-City,
 * which once wrote the Expeditor town (Bolintin-Deal) onto the annex.
 */
const baumitRouteField = (text) => {
  try {
    const route = parseBaumitAviz(text)?.ruta_transport;
    if (route) return { value: route, confidence: 0.92, matched: route };
  } catch {
    // Profile extractors must not throw the whole document; fall through.
  }
  const labelled = matchPatterns(text, [
    new RegExp(`(?:ruta|traseu|route)\\s*[:\\-]?\\s*([A-ZĂÂÎȘȚ]${CELL}{3,80})`, 'i'),
  ], { baseConfidence: 0.8 });
  if (labelled.value && !ROUTE_NOISE.test(labelled.value)) return labelled;
  return NO_MATCH;
};

const goodsField = (text) => {
  // RAI Tip marfă is the packaging (saci / găleți / paleți / bucăți), never the product row.
  // Grabbing `MPI Adeziv 20 kg …` put the whole line on the annex and buried the unit.
  const unit = extractGoodsUnit(text);
  if (unit.value) return unit;

  // Labelled tip: keep only a packaging word from the capture, not the rest of the line.
  const labelled = matchPatterns(text, [
    new RegExp(`(?:tip\\s*marf[aă]|denumire\\s*produs)\\s*[:\\-]?\\s*(${CELL}{3,60})`, 'i'),
    new RegExp(`(?<!cod\\s)(?<!codul\\s)\\bprodus\\b\\s*[:\\-]?\\s*(${CELL}{3,60})`, 'i'),
  ], { baseConfidence: 0.75 });
  const fromLabel = packagingWordIn(labelled.value);
  if (fromLabel) {
    return { value: fromLabel, confidence: 0.8, matched: labelled.matched };
  }

  return NO_MATCH;
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

/** `TPO` in ballpoint reads back as `TP0`, `TPQ`, `IPO`. Fix the prefix, pad digits. */
const carnetTpoField = (text) => {
  const found = String(text || '').match(
    new RegExp(`\\b(?:TPO|TP0|TPQ|TPD|IPO|7PO)${CODE_SEP}(\\d{3,})`, 'i'),
  );
  if (!found) return NO_MATCH;
  const value = normalizeTpo(`TPO-${found[1]}`, 3) || `TPO-${found[1]}`;
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
  const found = String(text || '').match(
    new RegExp(`\\btip\\s*marf[aăá]?\\s*[:.\\-]?\\s*(${CELL}{3,60})`, 'i'),
  );
  if (!found) return goodsField(text);
  const slice = found[1].replace(/\s+/g, ' ').trim();
  const pack = packagingWordIn(slice);
  if (pack) return { value: pack, confidence: 0.9, matched: found[0] };
  // Short handwriting ("Beton") without a packaging word — keep it; a whole OCR row, drop.
  if (slice.length >= 2 && slice.length <= 20 && !/\d/.test(slice)) {
    return { value: slice, confidence: 0.75, matched: found[0] };
  }
  return goodsField(text);
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

/** Numbered sheet slot 2 often has only `11.08.2026` with no DATA label. */
const dateFromBareLine = (line) => {
  const found = String(line || '').match(
    /^(\d{1,2})\s*[.:\-/]\s*(\d{1,2})\s*[.:\-/]\s*(\d{2,4})$/,
  );
  if (!found) return null;
  const day = Number(found[1]);
  const month = Number(found[2]);
  let year = Number(found[3]);
  if (year < 100) year += 2000;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { value: iso, confidence: 0.9, matched: found[0] };
};

const routeFromBareLine = (line) => {
  const value = String(line || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (value.length < 3) return null;
  return { value, confidence: 0.82, matched: value };
};

const goodsFromBareLine = (line) => {
  const value = String(line || '').replace(/\s+/g, ' ').trim();
  if (value.length < 2) return null;
  const pack = packagingWordIn(value);
  if (pack) return { value: pack, confidence: 0.9, matched: value };
  // Numbered sheet slot 6 is usually just the unit word; refuse a leaked product row.
  if (value.length <= 20 && !/\d/.test(value)) {
    return { value: value.slice(0, 40), confidence: 0.82, matched: value };
  }
  return null;
};

const qtyFromBareLine = (line) => {
  const found = String(line || '').match(/([\d.,]+)\s*([a-zăâîșț]{0,8})/i);
  if (!found) return null;
  const value = carnetNumber(found[1]);
  const unit = (found[2] || '').toLowerCase() || null;
  if (value == null || !isPlausibleQuantity(value, unit)) return null;
  return { value: { quantity: value, unit }, confidence: 0.86, matched: found[0] };
};

const tripsFromBareLine = (line) => {
  const found = String(line || '').match(/(\d{1,2})/);
  if (!found) return null;
  const value = Number(found[1]);
  if (!Number.isFinite(value) || value < 1 || value > 99) return null;
  return { value, confidence: 0.86, matched: found[0] };
};

/** Minimal sheet: digits alone, or a mangled TPO prefix on the numbered line. */
const tpoFromBareLine = (line) => {
  const labelled = carnetTpoField(line);
  if (labelled?.value) return { ...labelled, confidence: Math.min(0.94, (labelled.confidence || 0.88) + 0.04) };
  const digits = String(line || '').match(/(\d{4,})/);
  if (!digits) return null;
  const value = normalizeTpo(`TPO-${digits[1]}`, 3) || `TPO-${digits[1]}`;
  const penalty = codeLengthPenalty(value);
  return { value, confidence: Math.max(0, 0.8 - penalty), matched: digits[0] };
};

/** Money / rate on optional sheet lines (3, 12, 14). Blank means "leave empty", not 0. */
const moneyFromBareLine = (line) => {
  const found = String(line || '').match(/([\d.,]+)/);
  if (!found) return null;
  const value = carnetNumber(found[1]);
  if (value == null || value < 0 || value > 1_000_000) return null;
  return { value, confidence: 0.84, matched: found[0] };
};

const kmFromBareLine = (line) => {
  const found = String(line || '').match(/([\d.,]+)/);
  if (!found) return null;
  const value = carnetNumber(found[1]);
  if (value == null || value <= 0 || value > 5000) return null;
  return { value, confidence: 0.84, matched: found[0] };
};

const weightFromBareLine = (line) => {
  const n = carnetNumber(String(line).replace(/[^\d.,]/g, ''));
  if (n == null || n < 1) return null;
  return { value: n, confidence: 0.84, matched: line };
};

export const OCR_PROFILES = [
  {
    id: 'carnet_bord',
    documentType: 'aviz',
    name: 'Carnet de bord, scris de mână',
    markers: [
      /nr\.?\s*auto/, /cant\.?\s*marf/, /nr\.?\s*curse/,
      /tip\s*marf/, /ruta\s*trans/, /nr\.?\s*document/,
      // Numbered cheat-sheet (driver app writing guide): "1. TPO-…" or even "1. 0025999"
      /(?:^|\n)\s*1[.)\-]\s*\S/,
      /(?:^|\n)\s*4[.)\-]\s*\S/,
    ],
    fields: {
      // DRIVER_SHEET_GUIDE / DRIVER_SHEET_FIELD_BY_NO: 1–14
      numar_tpo: withNumberedFallback(1, carnetTpoField, tpoFromBareLine),
      data_efectuare_cursa: withNumberedFallback(2, carnetDateField, dateFromBareLine),
      valoare_tpo: withNumberedFallback(3, () => NO_MATCH, moneyFromBareLine),
      numar_auto: withNumberedFallback(4, extractPlate),
      ruta_transport: withNumberedFallback(5, carnetRouteField, routeFromBareLine),
      tip_marfa: withNumberedFallback(6, carnetGoodsField, goodsFromBareLine),
      quantity: withNumberedFallback(7, carnetQuantityField, qtyFromBareLine),
      gross_weight_kg: withNumberedFallback(8, extractGrossWeight, weightFromBareLine),
      net_weight_kg: withNumberedFallback(9, extractNetWeight, weightFromBareLine),
      numar_document_marfa: withNumberedFallback(10, docNoField([TRO_CODE, PSL_CODE])),
      numar_curse: withNumberedFallback(11, carnetTripCountField, tripsFromBareLine),
      taxe_suplimentare: withNumberedFallback(12, () => NO_MATCH, moneyFromBareLine),
      km_parcursi: withNumberedFallback(13, () => NO_MATCH, kmFromBareLine),
      tarif_km: withNumberedFallback(14, () => NO_MATCH, moneyFromBareLine),
    },
    weights: {
      numar_tpo: 3, numar_auto: 3, data_efectuare_cursa: 2,
      numar_document_marfa: 2, quantity: 2, gross_weight_kg: 2, net_weight_kg: 1.5,
      ruta_transport: 1, tip_marfa: 1, numar_curse: 1,
      valoare_tpo: 0.5, taxe_suplimentare: 0.5, km_parcursi: 0.5, tarif_km: 0.5,
    },
  },
  {
    id: 'aviz_baumit_psl',
    documentType: 'aviz',
    name: 'Aviz Baumit, PSL',
    markers: [/\bpsl\b/, /baumit/, /aviz/],
    fields: {
      numar_tpo: hybridAvizTpoField,
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
      numar_tpo: hybridAvizTpoField,
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
      numar_tpo: hybridAvizTpoField,
      data_efectuare_cursa: extractDate,
      numar_auto: extractPlate,
      numar_document_marfa: docNoField([
        TRO_CODE,
        PSL_CODE,
        // Labelled only when a logistics prefix is already there — bare "nr. 220" is a house (#54).
        /\b(?:aviz|nr\.?)\s*((?:PSL|TRO|TEST-AVZ)[\s\-._/:]*\d[\d./-]*)\b/i,
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
        new RegExp(`(?:expeditor|shipper)\\s*[:\\-]?\\s*(${CELL}{3,60})`, 'i'),
      ], { baseConfidence: 0.8 }),
      consignee_name: (text) => matchPatterns(text, [
        new RegExp(`(?:destinatar|consignee)\\s*[:\\-]?\\s*(${CELL}{3,60})`, 'i'),
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
  const sheetSlots = countFilledSheetSlots(text);
  const candidates = profiles
    .filter((p) => !documentType || p.documentType === documentType)
    .map((profile) => {
      let score = scoreMarkers(text, profile.markers);
      // A filled driver guide (1.…13.) must not lose to a lone PSL/TRO token on line 9 —
      // that is what sent the handwritten test sheet through the Baumit profile and left
      // quantity / weight / trip count empty.
      if (profile.id === 'carnet_bord') {
        if (sheetSlots >= 5) score = Math.max(score, 0.92);
        else if (sheetSlots >= 3) score = Math.max(score, 0.55);
      }
      return { profile, score: Math.round(score * 100) / 100 };
    })
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

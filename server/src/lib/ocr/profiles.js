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
  isPlausibleLoadWeightKg,
  isPlausibleQuantity,
  matchPatterns,
  packagingWordIn,
  parseNumber,
  resolveAvizDateParts,
} from './fields.js';
import { parseBaumitAviz, normalizeTpo, TPO_CODE_DIGITS, clipRouteGoodsTable } from '../avizOcr.js';
import {
  countFilledSheetSlots,
  numberedLineValue,
  withCarnetNumberedField,
  withNumberedFallback,
} from './numberedSheet.js';

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
  // Never keep bare "0000/2000" (Nr. Reg. Com. footer) — only a real TPO (#58).
  return normalizeTpo(raw, 3) || null;
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
 * in red. The printed TRO/PSL stays the document number — only a real TPO (prefix +
 * digits) by that label is the order number. A bare `0000/2000` from the commercial
 * register footer must never fill Număr TPO (#58).
 */
const hybridAvizTpoField = (text) => {
  const printed = tpoField([TPO_CODE])(text);
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

/**
 * Bright / low-contrast photos often turn TRO into TPO (or IRO / TR0) on the
 * „Aviz de expediție” / „Comanda de transfer” row while the real order TPO stays
 * in the rezumat title (#75). A code next to those labels whose digits differ from
 * the page TPO is the document number — store it as TRO- (Baumit transfer aviz).
 */
function recoverDocNearLabels(text) {
  const blob = String(text || '');
  const orderDigits = String(hybridAvizTpoField(blob)?.value || '').replace(/\D/g, '');
  const re = /(?:aviz\s+de\s+expedi[tț]ie|comand[aă]\s+de\s+transfer)\s*[:.\-]?\s*((?:PSL|TRO|TR0|TPO|TP0|IRO|T[\s]?R[\s]?[O0])[\s\-._/:]*\d{3,}[\d./-]*)/gi;
  let m;
  while ((m = re.exec(blob)) !== null) {
    const raw = String(m[1] || '').toUpperCase();
    const digits = raw.replace(/[^\d]/g, '');
    if (!digits || digits.length < 5) continue;
    if (orderDigits && digits === orderDigits) continue;
    const kind = /^PSL/.test(raw) ? 'PSL' : 'TRO';
    return { value: `${kind}-${digits}`, confidence: 0.72, matched: m[0] };
  }
  return null;
}

const docNoField = (patterns) => (text) => {
  const found = matchPatterns(text, patterns, { transform: canonicalDocNo });
  if (found?.value) return found;
  return recoverDocNearLabels(text) ?? NO_MATCH;
};

const ROUTE_NOISE = /paletizare|infoliere|infotiere|servici|taxa|descarcare|macara|ambalaj|gtin|cod\s*marf|\bprodus\b|\bcantitate\b/i;

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

const cleanRouteHit = (hit) => {
  if (!hit?.value) return NO_MATCH;
  const value = clipRouteGoodsTable(hit.value);
  if (!value || ROUTE_NOISE.test(value)) return NO_MATCH;
  return { ...hit, value, matched: hit.matched || value };
};

const routeField = (text) => {
  // PSL/TRO pages often land on aviz_generic when "Baumit" is missing from OCR. Without this,
  // Expeditor is dropped and only Adresa de livrare is shown (#80).
  try {
    const route = clipRouteGoodsTable(parseBaumitAviz(text)?.ruta_transport);
    if (route && /\s\/\s/.test(route)) {
      return { value: route, confidence: 0.9, matched: route };
    }
  } catch {
    // Keep falling through to labelled / loose patterns.
  }

  const labelled = matchPatterns(text, [
    new RegExp(`(?:ruta|traseu|route)\\s*[:\\-]?\\s*([A-ZĂÂÎȘȚ]${CELL}{3,80})`, 'i'),
  ], { baseConfidence: 0.8 });
  const fromLabel = cleanRouteHit(labelled);
  if (fromLabel.value) return fromLabel;

  const loose = matchPatterns(text, [LOOSE_CITY_ROUTE], { baseConfidence: 0.65 });
  return cleanRouteHit(loose);
};

/**
 * Baumit annex route: Expeditor (Bol/Mil) → Adresa de livrare.
 * If that parse is empty, only an explicit "Ruta:" label is accepted — never loose City-City,
 * which once wrote the Expeditor town (Bolintin-Deal) onto the annex.
 */
const baumitRouteField = (text) => {
  try {
    const route = clipRouteGoodsTable(parseBaumitAviz(text)?.ruta_transport);
    if (route) return { value: route, confidence: 0.92, matched: route };
  } catch {
    // Profile extractors must not throw the whole document; fall through.
  }
  const labelled = matchPatterns(text, [
    new RegExp(`(?:ruta|traseu|route)\\s*[:\\-]?\\s*([A-ZĂÂÎȘȚ]${CELL}{3,80})`, 'i'),
  ], { baseConfidence: 0.8 });
  return cleanRouteHit(labelled);
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
    // Same 0↔6 year repair as extractDate (#77).
    const parsed = resolveAvizDateParts(found[1], found[2], found[3]);
    if (parsed) {
      return {
        value: parsed.iso,
        confidence: Math.min(0.88, parsed.confidence),
        matched: found[0],
      };
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
    /\bcant(?:itate)?\.?[^\S\n]*marf[aăá]?[^\S\n]*[:.\-]?[^\S\n]*([\d.,]+)[^\S\n]*(m\s*³|m\s*3|mc|[a-zăâîșț]{2,8})?/i
  );
  if (!found) return extractQuantity(text);
  const value = carnetNumber(found[1]);
  let unit = (found[2] || '').toLowerCase().replace(/\s+/g, '') || null;
  if (unit === 'm3' || unit === 'm³' || unit === 'mc') unit = 'm³';
  if (value == null || !isPlausibleQuantity(value, unit === 'm³' ? 'm3' : unit)) return NO_MATCH;
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
  const parsed = resolveAvizDateParts(found[1], found[2], found[3]);
  if (!parsed) return null;
  return { value: parsed.iso, confidence: parsed.confidence, matched: found[0] };
};

const routeFromBareLine = (line) => {
  const value = String(line || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (value.length < 3) return null;
  // Refuse tip-marfă words and plates when the driver renumbered slots (#68).
  if (extractPlate(value)?.value) return null;
  if (/\b(?:kg|greutate|m3|m³)\b/i.test(value)) return null;
  const pack = packagingWordIn(value);
  if (pack && !/(?:→|->|\/|catre|către|\bbd\b|\bstr\b)/i.test(value) && value.length <= 24) {
    return null;
  }
  if (
    !/(?:→|->|–|\/|catre|către|\bb-?dul\b|\bbd\b|\bstr\b|\bsos\b|\bcalea\b)/i.test(value)
    && value.length <= 24
    && !/\d/.test(value)
  ) {
    // "nisip" / "balast" without a route marker is not a route.
    return null;
  }
  return { value, confidence: 0.82, matched: value };
};

const goodsFromBareLine = (line) => {
  const value = String(line || '').replace(/\s+/g, ' ').trim();
  if (value.length < 2) return null;
  if (extractPlate(value)?.value) return null;
  if (/\b(?:kg|greutate)\b/i.test(value)) return null;
  if (/(?:→|->)/i.test(value)) return null;
  const pack = packagingWordIn(value);
  if (pack) return { value: pack, confidence: 0.9, matched: value };
  // Numbered sheet slot 6 is usually just the unit word; refuse a leaked product row.
  if (value.length <= 20 && !/\d/.test(value)) {
    return { value: value.slice(0, 40), confidence: 0.82, matched: value };
  }
  return null;
};

const qtyFromBareLine = (line) => {
  const blob = String(line || '');
  if (/\b(?:psl|tro|tpo)\b/i.test(blob)) return null;
  if (extractPlate(blob)?.value) return null;
  // Load weight is not cantitate — even when the guide index slipped (#68).
  if (/\b(?:kg|greutate)\b/i.test(blob)) {
    const w = carnetNumber(blob.replace(/[^\d.,]/g, ''));
    if (w != null && isPlausibleLoadWeightKg(w)) return null;
  }
  // Shared extractor already knows m3 / m³ / mc (#63). The old carnet regex used
  // `[a-z…]` for the unit, so `18.5 m3` stopped at `m` and lost the volume (#69).
  const shared = extractQuantity(blob);
  if (shared?.value && typeof shared.value === 'object' && shared.value.quantity != null) {
    return {
      value: shared.value,
      confidence: Math.min(0.9, Number(shared.confidence) || 0.86),
      matched: shared.matched || blob,
    };
  }
  // ASCII `m3` / spaced `m 3` when extractQuantity had nothing else to latch onto.
  const vol = blob.match(/([\d.,]+)\s*(m\s*3|m³|mc)\b/i);
  if (vol) {
    const value = carnetNumber(vol[1]);
    if (value != null && isPlausibleQuantity(value, 'm3')) {
      return { value: { quantity: value, unit: 'm³' }, confidence: 0.88, matched: vol[0] };
    }
  }
  const found = blob.match(/([\d.,]+)\s*([a-zăâîșț]{0,8})/i);
  if (!found) return null;
  const value = carnetNumber(found[1]);
  const unit = (found[2] || '').toLowerCase() || null;
  // Lone `m` is a truncated m³ — not a real unit; leave empty rather than store junk (#69).
  if (unit === 'm') return null;
  if (value == null || !isPlausibleQuantity(value, unit)) return null;
  return { value: { quantity: value, unit }, confidence: 0.86, matched: found[0] };
};

const tripsFromBareLine = (line) => {
  const blob = String(line || '');
  if (/\b(?:kg|greutate|psl|tro|tpo)\b/i.test(blob)) return null;
  if (extractPlate(blob)?.value) return null;
  const found = blob.match(/(\d{1,2})\s*(?:curs[aeă]|curse)?/i);
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
  const blob = String(line || '');
  // Plate / PSL / weight digits must never become Valoare TPO (#68).
  if (extractPlate(blob)?.value) return null;
  if (/\b(?:psl|tro|tpo|kg|greutate|m3|m³|curs[aeă]|curse)\b/i.test(blob)) return null;
  if (/[a-zăâîșț]/i.test(blob.replace(/\b(?:lei|ron|eur)\b/gi, ''))) return null;
  const found = blob.match(/([\d.,]+)/);
  if (!found) return null;
  const value = carnetNumber(found[1]);
  if (value == null || value < 0 || value > 1_000_000) return null;
  return { value, confidence: 0.84, matched: found[0] };
};

const kmFromBareLine = (line) => {
  const blob = String(line || '');
  if (extractPlate(blob)?.value) return null;
  if (/\b(?:psl|tro|tpo|kg|greutate)\b/i.test(blob)) return null;
  const found = blob.match(/([\d.,]+)/);
  if (!found) return null;
  const value = carnetNumber(found[1]);
  if (value == null || value <= 0 || value > 5000) return null;
  return { value, confidence: 0.84, matched: found[0] };
};

const weightFromBareLine = (line) => {
  const blob = String(line || '');
  if (/\b(?:psl|tro|tpo)\b/i.test(blob)) return null;
  if (/\b(?:curs[aeă]|curse)\b/i.test(blob)) return null;
  if (extractPlate(blob)?.value) return null;
  const n = carnetNumber(blob.replace(/[^\d.,]/g, ''));
  if (n == null || n < 1) return null;
  // Carnet slot 8/9 — still refuse CMR box-12 leftovers (#66).
  if (!isPlausibleLoadWeightKg(n)) return null;
  return { value: n, confidence: 0.84, matched: line };
};

const plateFromBareLine = (line) => {
  const blob = String(line || '');
  const tight = blob.replace(/\s*-\s*/g, '-');
  const found = extractPlate(tight)?.value ? extractPlate(tight) : extractPlate(blob);
  if (found?.value) return found;
  return null;
};

const docFromBareLine = (line) => {
  const found = docNoField([TRO_CODE, PSL_CODE])(line);
  if (found?.value) return found;
  return null;
};

/** True when the page is a CMR / scrisoare de trăsură (not a Baumit aviz). */
export function looksLikeCmrDocument(text) {
  const blob = String(text || '').toLowerCase();
  if (/\bcmr\b/.test(blob)) return true;
  if (/scrisoare\s+de\s+tr[aă]sur/.test(blob)) return true;
  if (/letter\s+of\s+consignment/.test(blob)) return true;
  // Numbered CMR boxes with logistics labels (not the driver cheat-sheet alone).
  if (
    /locul\s+de\s+(?:incarcare|descarcare|preluare|livrare)/i.test(blob)
    && /(?:greutate\s*(?:bruta|brută)|gross\s*weight|(?:^|\n)\s*11[.)\-])/i.test(blob)
  ) {
    return true;
  }
  return false;
}

/**
 * CMR document number (top-right serial), never "SCRISOARE".
 * Examples: `CMR nr. 0247315`, lone `0247315` near the header.
 */
const cmrDocumentNumberField = (text) => {
  const blob = String(text || '');
  const labelled = matchPatterns(blob, [
    // `CMR nr. RO-2026-5512` / `CMR nr. 0247315`
    /\b(?:cmr|seria)\s*(?:nr\.?|no\.?)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/]*\d[A-Z0-9\-/]*)\b/i,
    /\b(?:nr\.?|no\.?)\s*(?:cmr)?\s*[:\-]?\s*(0\d{6,10})\b/i,
  ], { transform: (raw) => String(raw).replace(/\s+/g, '').toUpperCase(), baseConfidence: 0.9 });
  if (labelled.value) return labelled;
  // First standalone 6–8 digit run near the top of the page (Romanian CMR serials).
  const head = blob.slice(0, 400);
  const serial = head.match(/(?:^|\n)\s*(0?\d{6,8})\s*(?:\n|$)/);
  if (serial?.[1]) {
    return { value: serial[1], confidence: 0.75, matched: serial[0] };
  }
  return NO_MATCH;
};

/** CMR boxes 3 (încărcare) + 4 (descărcare) → `origine / destinație`. */
const cmrRouteField = (text) => {
  const blob = String(text || '');
  const pick = (patterns) => matchPatterns(blob, patterns, {
    transform: (raw) => String(raw).replace(/\s+/g, ' ').trim(),
    baseConfidence: 0.85,
  });
  const load = pick([
    /locul\s+de\s+(?:preluare|incarcare|luare\s+in\s+primire)[^:\n]{0,40}[:\-]?\s*([^\n]{3,80})/i,
    /place\s+of\s+taking\s+over[^:\n]{0,40}[:\-]?\s*([^\n]{3,80})/i,
    /(?:^|\n)\s*3[.)\-][^\S\n]+([^\n]{3,80})/i,
  ]);
  const unload = pick([
    /locul\s+de\s+(?:livrare|descarcare|destinatie)[^:\n]{0,40}[:\-]?\s*([^\n]{3,80})/i,
    /place\s+of\s+delivery[^:\n]{0,40}[:\-]?\s*([^\n]{3,80})/i,
    /(?:^|\n)\s*4[.)\-][^\S\n]+([^\n]{3,80})/i,
  ]);
  const a = load.value || null;
  const b = unload.value || null;
  if (a && b) return { value: `${a} / ${b}`, confidence: 0.88, matched: `${load.matched}+${unload.matched}` };
  if (b) return { value: b, confidence: 0.8, matched: unload.matched };
  if (a) return { value: a, confidence: 0.8, matched: load.matched };
  return NO_MATCH;
};

/**
 * CMR box 11 = greutate brută. Never box 12 (volume) and never a sub-100 kg leftover (#66).
 */
const cmrGrossWeightField = (text) => {
  const blob = String(text || '');
  const box11 = numberedLineValue(blob, 11);
  if (box11) {
    const n = parseNumber(String(box11).replace(/[^\d.,]/g, '')) 
      ?? carnetNumber(String(box11).replace(/[^\d.,]/g, ''));
    if (n != null && isPlausibleLoadWeightKg(n)) {
      return { value: n, confidence: 0.9, matched: box11 };
    }
  }
  const labelled = extractGrossWeight(blob);
  if (labelled?.value != null && isPlausibleLoadWeightKg(labelled.value)) return labelled;
  // Explicit "11 … 14844 kg" without relying on numberedLineValue spacing.
  const m = blob.match(/(?:^|\n)\s*11[.)\-][^\S\n]*([\d][\d.,\s]*)\s*(?:kg)?\b/i);
  if (m) {
    const n = parseNumber(m[1]);
    if (n != null && isPlausibleLoadWeightKg(n)) {
      return { value: n, confidence: 0.88, matched: m[0] };
    }
  }
  return NO_MATCH;
};

/** CMR: packaging + count from boxes 7–9 / nature of goods — not euro-pallet alone. */
const cmrQuantityField = (text) => {
  // Box 7 is the package count. Prefer it over summing "8. saci" (box label) + "720.00 sac" (#66).
  const box7 = numberedLineValue(text, 7);
  if (box7) {
    const n = parseNumber(box7) ?? carnetNumber(String(box7).replace(/[^\d.,]/g, ''));
    if (n != null && isPlausibleQuantity(n, 'saci')) {
      const pack = packagingWordIn(numberedLineValue(text, 8) || '')
        || packagingWordIn(numberedLineValue(text, 9) || '')
        || packagingWordIn(text)
        || 'saci';
      const unit = pack === 'paleti' ? 'saci' : pack;
      return { value: { quantity: n, unit }, confidence: 0.9, matched: box7 };
    }
  }
  const found = extractQuantity(text);
  if (found?.value && typeof found.value === 'object') {
    // Prefer saci/galeți over a lone pallet count when the page also names bags.
    const unit = String(found.value.unit || '');
    if (unit === 'paleti' && /\b\d[\d.,]*\s*sac/i.test(text)) {
      const bags = extractQuantity(String(text).replace(/\d[\d.,]*\s*pce\b/gi, ' '));
      if (bags?.value?.quantity != null) return bags;
    }
    return found;
  }
  return NO_MATCH;
};

const cmrGoodsField = (text) => {
  const unit = extractGoodsUnit(text);
  if (unit.value && unit.value !== 'paleti') return unit;
  const box8 = numberedLineValue(text, 8);
  const box9 = numberedLineValue(text, 9);
  for (const line of [box8, box9, text]) {
    const pack = packagingWordIn(line) || goodsFromBareLine(line)?.value;
    if (pack && pack !== 'paleti') {
      return { value: pack, confidence: 0.82, matched: line };
    }
  }
  if (unit.value) return unit;
  return NO_MATCH;
};

/** Parsers for content-aware carnet slot assignment (#68). */
const CARNET_LINE_PARSERS = {
  numar_tpo: tpoFromBareLine,
  data_efectuare_cursa: dateFromBareLine,
  valoare_tpo: moneyFromBareLine,
  numar_auto: plateFromBareLine,
  ruta_transport: routeFromBareLine,
  tip_marfa: goodsFromBareLine,
  quantity: qtyFromBareLine,
  gross_weight_kg: weightFromBareLine,
  net_weight_kg: weightFromBareLine,
  numar_document_marfa: docFromBareLine,
  numar_curse: tripsFromBareLine,
  taxe_suplimentare: moneyFromBareLine,
  km_parcursi: kmFromBareLine,
  tarif_km: moneyFromBareLine,
};

const carnetSlot = (sheetNo, fieldKey, extract, fromLine) => (
  withCarnetNumberedField(sheetNo, fieldKey, extract, fromLine, CARNET_LINE_PARSERS)
);

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
      // Short handwritten carnets titled explicitly (#68).
      /carnet\s+de\s+bord/i,
    ],
    fields: {
      // DRIVER_SHEET_GUIDE / DRIVER_SHEET_FIELD_BY_NO: 1–14 — content wins over index (#68).
      numar_tpo: carnetSlot(1, 'numar_tpo', carnetTpoField, tpoFromBareLine),
      data_efectuare_cursa: carnetSlot(2, 'data_efectuare_cursa', carnetDateField, dateFromBareLine),
      valoare_tpo: carnetSlot(3, 'valoare_tpo', () => NO_MATCH, moneyFromBareLine),
      numar_auto: carnetSlot(4, 'numar_auto', extractPlate, plateFromBareLine),
      ruta_transport: carnetSlot(5, 'ruta_transport', carnetRouteField, routeFromBareLine),
      tip_marfa: carnetSlot(6, 'tip_marfa', carnetGoodsField, goodsFromBareLine),
      quantity: carnetSlot(7, 'quantity', carnetQuantityField, qtyFromBareLine),
      gross_weight_kg: carnetSlot(8, 'gross_weight_kg', extractGrossWeight, weightFromBareLine),
      net_weight_kg: carnetSlot(9, 'net_weight_kg', extractNetWeight, weightFromBareLine),
      numar_document_marfa: carnetSlot(10, 'numar_document_marfa', docNoField([TRO_CODE, PSL_CODE]), docFromBareLine),
      numar_curse: carnetSlot(11, 'numar_curse', carnetTripCountField, tripsFromBareLine),
      taxe_suplimentare: carnetSlot(12, 'taxe_suplimentare', () => NO_MATCH, moneyFromBareLine),
      km_parcursi: carnetSlot(13, 'km_parcursi', () => NO_MATCH, kmFromBareLine),
      tarif_km: carnetSlot(14, 'tarif_km', () => NO_MATCH, moneyFromBareLine),
    },
    weights: {
      numar_tpo: 3, numar_auto: 3, data_efectuare_cursa: 2,
      numar_document_marfa: 2, quantity: 2, gross_weight_kg: 2, net_weight_kg: 1.5,
      ruta_transport: 1, tip_marfa: 1, numar_curse: 1,
      valoare_tpo: 0.5, taxe_suplimentare: 0.5, km_parcursi: 0.5, tarif_km: 0.5,
    },
  },
  {
    // Handwritten / printed CMR uploaded on /avize (document_type stays aviz) (#66).
    id: 'aviz_cmr',
    documentType: 'aviz',
    name: 'CMR / scrisoare de trăsură',
    markers: [
      /\bcmr\b/,
      /scrisoare\s+de\s+tr[aă]sur/,
      /locul\s+de\s+(?:incarcare|descarcare|preluare)/,
      /place\s+of\s+(?:taking\s+over|delivery)/,
      /(?:^|\n)\s*11[.)\-]/,
    ],
    fields: {
      numar_tpo: hybridAvizTpoField,
      data_efectuare_cursa: extractDate,
      numar_auto: extractPlate,
      numar_document_marfa: cmrDocumentNumberField,
      ruta_transport: cmrRouteField,
      tip_marfa: cmrGoodsField,
      quantity: cmrQuantityField,
      gross_weight_kg: cmrGrossWeightField,
      // CMR has no net weight box — leave empty (do not invent from box 12).
      net_weight_kg: () => NO_MATCH,
      pallets: extractPalletCount,
    },
    weights: {
      numar_document_marfa: 3, gross_weight_kg: 3, numar_auto: 2,
      ruta_transport: 2, quantity: 2, tip_marfa: 1.5,
      data_efectuare_cursa: 1, numar_tpo: 1, pallets: 0.3,
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
    markers: [/\bcmr\b/, /expeditor/, /destinatar/, /transportator/, /scrisoare\s+de\s+tr[aă]sur/],
    fields: {
      // The value must contain a digit. Without that guard the pattern happily matches
      // "CMR SCRISOARE DE TRANSPORT" and the document number comes out as "SCRISOARE".
      cmr_number: cmrDocumentNumberField,
      loading_date: extractDate,
      numar_auto: extractPlate,
      shipper_name: (text) => matchPatterns(text, [
        new RegExp(`(?:expeditor|shipper)\\s*[:\\-]?\\s*(${CELL}{3,60})`, 'i'),
      ], { baseConfidence: 0.8 }),
      consignee_name: (text) => matchPatterns(text, [
        new RegExp(`(?:destinatar|consignee)\\s*[:\\-]?\\s*(${CELL}{3,60})`, 'i'),
      ], { baseConfidence: 0.8 }),
      ruta_transport: cmrRouteField,
      tip_marfa: cmrGoodsField,
      quantity: cmrQuantityField,
      gross_weight_kg: cmrGrossWeightField,
      net_weight_kg: () => NO_MATCH,
      pallets: extractPalletCount,
    },
    weights: {
      cmr_number: 3, numar_auto: 2, loading_date: 2, gross_weight_kg: 3,
      ruta_transport: 2, quantity: 1.5, tip_marfa: 1,
      shipper_name: 1, consignee_name: 1, pallets: 0.3,
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
  const isCmr = looksLikeCmrDocument(text);
  const candidates = profiles
    .filter((p) => !documentType || p.documentType === documentType)
    .map((profile) => {
      let score = scoreMarkers(text, profile.markers);
      // A filled driver guide (1.…13.) must not lose to a lone PSL/TRO token on line 9 —
      // that is what sent the handwritten test sheet through the Baumit profile and left
      // quantity / weight / trip count empty.
      // CMR boxes are also numbered 1–24 — do not steal those into carnet slots (#66).
      if (profile.id === 'carnet_bord') {
        if (isCmr) score = Math.min(score, 0.25);
        else if (sheetSlots >= 5) score = Math.max(score, 0.92);
        else if (sheetSlots >= 3) score = Math.max(score, 0.55);
      }
      // /avize uploads stay documentType=aviz → aviz_cmr. Native CMR type → cmr_standard.
      if (isCmr && profile.id === 'aviz_cmr' && (!documentType || documentType === 'aviz')) {
        score = Math.max(score, 0.93);
      }
      if (isCmr && profile.id === 'cmr_standard' && (!documentType || documentType === 'cmr')) {
        score = Math.max(score, 0.95);
      }
      // When both profiles compete (no documentType filter), prefer the native CMR one.
      if (isCmr && profile.id === 'aviz_cmr' && !documentType) {
        score = Math.min(score, 0.9);
      }
      // A real PSL-/TRO- code beats generic even when "Baumit" is absent from the photo (#80).
      if (profile.id === 'aviz_baumit_psl' && /\bpsl[\s\-._/:]*\d{3,}/i.test(String(text || ''))) {
        score = Math.max(score, 0.88);
      }
      if (profile.id === 'aviz_baumit_tro' && /\btro[\s\-._/:]*\d{3,}/i.test(String(text || ''))) {
        score = Math.max(score, 0.88);
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

/**
 * Drivers write carnet lines as "1. … 2. …" so OCR can map slot → field
 * even when the handwritten label is messy or missing. Must stay aligned with
 * DRIVER_SHEET_GUIDE in `src/lib/driverAvizLogistics.js` (same numbers, same order).
 *
 * When the driver skips a guide slot or renumbers (plate on 3, route on 4, …),
 * blind index mapping fills every field wrong (#68). Content classification
 * reassigns those lines; the guide index is only a preference when it matches.
 */

import {
  extractPlate,
  isPlausibleLoadWeightKg,
  isPlausibleQuantity,
  packagingWordIn,
  parseNumber,
} from './fields.js';

/**
 * Sheet slot → extractor field name (see DRIVER_SHEET_GUIDE nos 1–14).
 * `quantity` maps to `cantitate_marfa` in toColumns.
 */
export const DRIVER_SHEET_FIELD_BY_NO = Object.freeze({
  1: 'numar_tpo',
  2: 'data_efectuare_cursa',
  3: 'valoare_tpo',
  4: 'numar_auto',
  5: 'ruta_transport',
  6: 'tip_marfa',
  7: 'quantity',
  8: 'gross_weight_kg',
  9: 'net_weight_kg',
  10: 'numar_document_marfa',
  11: 'numar_curse',
  12: 'taxe_suplimentare',
  13: 'km_parcursi',
  14: 'tarif_km',
});

/** Value after `N.` / `N)` / `N-` on its own line (or start of text). */
export function numberedLineValue(text, sheetNo) {
  const n = Number(sheetNo);
  if (!Number.isFinite(n) || n < 1) return '';
  // Same-line whitespace only after the marker: `\s*` would jump to the next numbered
  // line and turn a blank "3." into the plate digits from "4. B …".
  const re = new RegExp(`(?:^|\\n)\\s*${n}[.)\\-][^\\S\\n]*([^\\n]*)`, 'i');
  const m = String(text || '').match(re);
  if (!m) return '';
  const raw = String(m[1]).replace(/\s+/g, ' ').trim();
  // Drivers leave optional lines blank as "3." / "3. -" / "3. gol" — treat as empty.
  if (!raw || /^(?:[-–—x]|gol|n\/?a|\.+)$/i.test(raw)) return '';
  return raw;
}

/** How many DRIVER_SHEET_GUIDE slots (1–14) carry a non-blank value. */
export function countFilledSheetSlots(text) {
  let filled = 0;
  for (let n = 1; n <= 14; n += 1) {
    if (numberedLineValue(text, n)) filled += 1;
  }
  return filled;
}

/** @returns {{ no: number, raw: string }[]} */
export function listNumberedLines(text) {
  const out = [];
  for (let n = 1; n <= 14; n += 1) {
    const raw = numberedLineValue(text, n);
    if (raw) out.push({ no: n, raw });
  }
  return out;
}

const TPO_LINE = /\b(?:TPO|TP0|TPQ|TPD|IPO|7PO)[\s\-._/:]*\d{3,}/i;
const DOC_LINE = /\b(?:PSL|TRO|TEST-AVZ)[\s\-._/:]*\d{3,}/i;
const DATE_LINE = /^(\d{1,2})\s*[.:\-/]\s*(\d{1,2})\s*[.:\-/]\s*(\d{2,4})$/;
const ROUTE_MARK = /(?:→|->|–\s*|^\s*\S.{0,40}\s+(?:catre|către)\s+)/i;
const STREET_MARK = /\b(?:b-?dul|bd|bud|str\.?|sos\.?|șos\.?|calea|aleea)\b/i;
const QTY_UNIT = /\b(?:m3|m³|mc|t(?:one?)?|sac(?:i)?|gale(?:ti|ți)?|buc(?:ati)?|pal(?:eti)?|pce)\b/i;
const WEIGHT_MARK = /\b(?:kg|greutate)\b/i;
const TRIP_MARK = /\b(?:curs[aeă]|curse)\b/i;
const MONEY_MARK = /\b(?:lei|ron|eur)\b/i;
const GOODS_WORD = /^(?:nisip|balast|beton|ciment|apa|apă|lemn|fier|oteland|otelu|oteli|pietris|pietriș|sort|agregat|moloz|pamant|pământ|galeti|găleți|saci|paleți|paleti|m3|m³)(?:\s|$)/i;

function firstNumber(raw) {
  const m = String(raw || '').match(/([\d]+(?:[.,]\d+)?)/);
  if (!m) return null;
  return parseNumber(m[1]) ?? Number(String(m[1]).replace(',', '.'));
}

/**
 * What a numbered carnet line looks like, independent of the index the driver wrote (#68).
 * @returns {string|null} field kind key
 */
export function classifyCarnetLine(raw) {
  const line = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!line) return null;

  if (TPO_LINE.test(line)) return 'numar_tpo';
  if (DOC_LINE.test(line)) return 'numar_document_marfa';
  // Guide slot 1 often has bare zero-padded digits (`0025999`) without a TPO prefix.
  if (/^0\d{4,8}$/.test(line)) return 'numar_tpo';

  // Handwriting often spaces the dashes: `B - 100 - PLM` (extractPlate wants `B-100-PLM`).
  const plateLine = line.replace(/\s*-\s*/g, '-');
  const plate = extractPlate(plateLine)?.value ? extractPlate(plateLine) : extractPlate(line);
  if (plate?.value && String(plate.value).length >= 6) return 'numar_auto';

  const date = line.match(DATE_LINE);
  if (date) {
    const day = Number(date[1]);
    const month = Number(date[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return 'data_efectuare_cursa';
  }

  if (WEIGHT_MARK.test(line)) {
    const n = firstNumber(line);
    if (n != null && isPlausibleLoadWeightKg(n)) return 'weight';
  }

  if (TRIP_MARK.test(line)) {
    const n = firstNumber(line);
    if (n != null && n >= 1 && n <= 99) return 'numar_curse';
  }

  if (QTY_UNIT.test(line)) {
    const n = firstNumber(line);
    const unitMatch = line.match(QTY_UNIT);
    const unit = unitMatch ? unitMatch[0].toLowerCase().replace('m³', 'm3') : null;
    if (n != null && isPlausibleQuantity(n, unit)) return 'quantity';
  }

  // Route before bare goods: "Bol -> Ploiesti" must not become tip marfă.
  if (ROUTE_MARK.test(line) || STREET_MARK.test(line)) {
    if (line.length >= 3 && !WEIGHT_MARK.test(line) && !QTY_UNIT.test(line)) {
      return 'ruta_transport';
    }
  }

  const pack = packagingWordIn(line);
  if (pack && !/\d/.test(line)) return 'tip_marfa';
  if (GOODS_WORD.test(line) && !/\d/.test(line) && line.length <= 24) return 'tip_marfa';
  if (line.length >= 2 && line.length <= 20 && !/\d/.test(line) && !/[→/]/.test(line)) {
    // Short alpha-only: tip marfă (nisip, balast) — not a route without markers.
    if (/^[a-zăâîșțA-ZĂÂÎȘȚ\s-]+$/i.test(line)) return 'tip_marfa';
  }

  const n = firstNumber(line);
  if (n == null) {
    if (line.length >= 3) return 'ruta_transport';
    return null;
  }

  // Plain load-sized figure without kg still counts as weight (guide slots 8–9).
  if (!MONEY_MARK.test(line) && !QTY_UNIT.test(line) && n >= 1000 && isPlausibleLoadWeightKg(n)) {
    return 'weight';
  }

  // Plain small figures are money/qty/curse at the guide index — not trips unless
  // the line says „cursa” (see TRIP_MARK above). `7. 10` and `11. 2` both land here.
  if (n >= 0 && n < 1000 && line.length < 24 && !QTY_UNIT.test(line)) return 'money';

  if (n > 0 && n <= 5000 && /^\d{1,4}(?:[.,]\d+)?$/.test(line.trim())) {
    return 'km_parcursi';
  }

  return null;
}

/**
 * Assign numbered lines to fields by content. Guide index wins only when the line
 * classifies as that field (or weight for slots 8/9).
 * @returns {Record<string, { value: unknown, confidence: number, matched: string }>|null}
 */
export function assignNumberedCarnet(text, parsers = {}) {
  const lines = listNumberedLines(text);
  if (lines.length < 3) return null;

  const classified = lines.map((l) => ({ ...l, kind: classifyCarnetLine(l.raw) }));
  const used = new Set();
  const out = {};

  const take = (field, line, parsed) => {
    if (!parsed || parsed.value == null || parsed.value === '') return false;
    if (used.has(line.no)) return false;
    used.add(line.no);
    out[field] = {
      ...parsed,
      confidence: Math.min(0.92, Number(parsed.confidence) || 0.84),
      matched: parsed.matched || line.raw,
    };
    return true;
  };

  const parseWith = (field, line) => {
    const fn = parsers[field];
    if (typeof fn !== 'function') return null;
    return fn(line.raw);
  };

  const fieldKind = (field) => {
    if (field === 'gross_weight_kg' || field === 'net_weight_kg') return 'weight';
    if (field === 'valoare_tpo' || field === 'taxe_suplimentare' || field === 'tarif_km') return 'money';
    return field;
  };

  /** Guide slot may hold a sibling kind (km line classified as money, etc.). */
  const guideKindOk = (field, kind) => {
    if (!kind) return false;
    if (kind === fieldKind(field)) return true;
    if (field === 'km_parcursi' && (kind === 'money' || kind === 'numar_curse')) return true;
    if (field === 'tarif_km' && kind === 'money') return true;
    if (field === 'taxe_suplimentare' && kind === 'money') return true;
    if (field === 'numar_curse' && kind === 'money') return true;
    // `7. 9.96` tonnes often classifies as money (plain decimal) — still cantitate on guide.
    if (field === 'quantity' && kind === 'money') return true;
    return false;
  };

  // Pass 1 — guide index when content agrees (so Valoare TPO cannot steal `7. 9.96`).
  for (let no = 1; no <= 14; no += 1) {
    const field = DRIVER_SHEET_FIELD_BY_NO[no];
    if (!field || out[field]) continue;
    const atGuide = classified.find((l) => l.no === no);
    if (atGuide && !used.has(atGuide.no) && guideKindOk(field, atGuide.kind)) {
      take(field, atGuide, parseWith(field, atGuide));
    }
  }

  // Pass 2 — content remap when the driver skipped/renumbered (#68).
  // Optional money (3/12/14) stays guide-only: remapping would steal `7. 9.96` into Valoare TPO.
  for (let no = 1; no <= 14; no += 1) {
    const field = DRIVER_SHEET_FIELD_BY_NO[no];
    if (!field || out[field]) continue;
    if (field === 'valoare_tpo' || field === 'taxe_suplimentare' || field === 'tarif_km') continue;
    const want = fieldKind(field);
    const alt = classified.find((l) => !used.has(l.no) && l.kind === want);
    if (alt) {
      const parsed = parseWith(field, alt);
      if (parsed?.value != null && parsed.value !== '') {
        take(field, alt, {
          ...parsed,
          confidence: Math.min(0.84, (Number(parsed.confidence) || 0.8) - 0.04),
        });
      }
    }
  }

  return out;
}

/**
 * Prefer a numbered line; fall back to the classic extractor.
 * @param {number} sheetNo
 * @param {(text: string) => { value: unknown, confidence: number, matched?: string }} extract
 * @param {(raw: string) => { value: unknown, confidence: number, matched?: string } | null} [fromLine]
 */
export function withNumberedFallback(sheetNo, extract, fromLine) {
  return (text) => {
    const line = numberedLineValue(text, sheetNo);
    if (line) {
      if (typeof fromLine === 'function') {
        const parsed = fromLine(line);
        if (parsed?.value != null && parsed.value !== '') return parsed;
      }
      // Feed only the line into the classic extractor so labels on other lines do not confuse it.
      const fromExtract = extract(line);
      if (fromExtract?.value != null && fromExtract.value !== '') {
        return {
          ...fromExtract,
          confidence: Math.min(0.95, (Number(fromExtract.confidence) || 0.7) + 0.08),
          matched: fromExtract.matched || line,
        };
      }
    }
    return extract(text);
  };
}

const assignmentCache = new Map();

/**
 * Carnet field: content-aware numbered assignment when the sheet looks numbered,
 * otherwise the classic guide-index fallback + label extractors.
 */
export function withCarnetNumberedField(sheetNo, fieldKey, extract, fromLine, parsers) {
  const guide = withNumberedFallback(sheetNo, extract, fromLine);
  return (text) => {
    const blob = String(text || '');
    if (countFilledSheetSlots(blob) >= 3) {
      let assigned = assignmentCache.get(blob);
      if (!assigned) {
        assigned = assignNumberedCarnet(blob, parsers) || {};
        // Bound the cache — extractDocument is sync and short-lived per text.
        if (assignmentCache.size > 32) assignmentCache.clear();
        assignmentCache.set(blob, assigned);
      }
      if (assigned[fieldKey]) return assigned[fieldKey];
      // Numbered sheet but this field has no matching line — do not trust a shifted index.
      return extract(blob);
    }
    return guide(blob);
  };
}

/** Test helper / repair path. */
export function clearCarnetAssignmentCache() {
  assignmentCache.clear();
}

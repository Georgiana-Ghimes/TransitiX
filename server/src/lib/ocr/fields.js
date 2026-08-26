/**
 * Field extractors shared by OCR profiles.
 *
 * Each extractor returns `{ value, confidence, matched }` rather than a bare value.
 * Confidence is what decides whether a field is written unattended or lands in front of an
 * operator, so every extractor has to be honest about how sure it is — a regex that matched
 * a well-formed, labelled value is worth more than one that grabbed a loose number.
 */

export const NO_MATCH = Object.freeze({ value: null, confidence: 0, matched: null });

function result(value, confidence, matched) {
  return { value, confidence: Math.max(0, Math.min(1, confidence)), matched };
}

/**
 * Tries patterns in order and scores by how it matched.
 * A pattern list is ordered best-first, so an earlier hit is more trustworthy.
 */
export function matchPatterns(text, patterns, { transform, baseConfidence = 0.9 } = {}) {
  const blob = String(text || '');
  for (let i = 0; i < patterns.length; i += 1) {
    const hit = blob.match(patterns[i]);
    if (!hit) continue;
    const raw = hit[1] ?? hit[0];
    const value = transform ? transform(raw) : String(raw).trim();
    if (value == null || value === '') continue;
    // Later patterns are looser fallbacks, so each step down costs confidence.
    return result(value, baseConfidence - i * 0.12, raw);
  }
  return NO_MATCH;
}

/** Romanian plates: B 123 ABC, B123ABC, CJ 12 XYZ. */
export function extractPlate(text) {
  const found = matchPatterns(text, [
    /\b((?:B|AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VL|VS|VN)\s?\d{2,3}\s?[A-Z]{3})\b/,
    /\b([A-Z]{1,2}\s?\d{2,3}\s?[A-Z]{3})\b/,
  ], {
    transform: (raw) => String(raw).toUpperCase().replace(/\s+/g, ' ').trim(),
  });
  if (!found.value) return NO_MATCH;
  // A plate that is only plausible in shape, without a real county prefix, is worth less.
  const strong = /^(B|AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VL|VS|VN)\s/.test(found.value);
  return result(found.value, strong ? found.confidence : found.confidence - 0.25, found.matched);
}

const MONTHS = {
  ian: 1, feb: 2, mar: 3, apr: 4, mai: 5, iun: 6,
  iul: 7, aug: 8, sep: 9, oct: 10, noi: 11, dec: 12,
};

/** dd.mm.yyyy, yyyy-mm-dd, dd mmm yyyy. Returns ISO. */
export function extractDate(text) {
  const blob = String(text || '');

  const iso = blob.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return result(`${iso[1]}-${iso[2]}-${iso[3]}`, 0.95, iso[0]);

  const dmy = blob.match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\b/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return result(
        `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        0.9,
        dmy[0]
      );
    }
  }

  const named = blob.match(/\b(\d{1,2})\s+([a-zăâîșț]{3,10})\.?\s+(\d{4})\b/i);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) {
      return result(
        `${named[3]}-${String(month).padStart(2, '0')}-${String(Number(named[1])).padStart(2, '0')}`,
        0.85,
        named[0]
      );
    }
  }

  return NO_MATCH;
}

/** Romanian decimals use a comma; thousands separators are dots or spaces. */
export function parseNumber(raw) {
  if (raw == null) return null;
  let text = String(raw).trim().replace(/\s/g, '');
  if (!text) return null;
  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  if (hasComma && hasDot) {
    // Whichever separator appears last is the decimal one.
    text = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (hasComma) {
    text = text.replace(',', '.');
  } else if (hasDot && /\.\d{3}\b/.test(text)) {
    // A dot followed by exactly three digits is a thousands separator, not a decimal.
    text = text.replace(/\./g, '');
  }
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

const WEIGHT_UNITS = { kg: 1, kgs: 1, t: 1000, to: 1000, tone: 1000, tona: 1000, tone_: 1000 };

/**
 * Gross weight — what the weighbridge shows, goods plus pallets.
 *
 * This is the field the client corrected us on: a report needs "9.000 kg", not "378 saci".
 * A labelled "greutate brută" is trusted; a bare weight with no label is not, because it
 * could just as easily be the net.
 */
export function extractGrossWeight(text) {
  const blob = String(text || '');

  const labelled = blob.match(
    /(?:greutate\s*(?:bruta|brută)|masa\s*(?:bruta|brută)|gross\s*weight|g\.?\s*bruta)\s*[:\-]?\s*([\d.,\s]+)\s*(kg|to?ne?|t)\b/i
  );
  if (labelled) {
    const value = parseNumber(labelled[1]);
    if (value != null) {
      const unit = String(labelled[2] || 'kg').toLowerCase();
      const factor = unit.startsWith('t') ? 1000 : 1;
      return result(Math.round(value * factor * 100) / 100, 0.95, labelled[0]);
    }
  }

  const anyWeight = blob.match(/(?:greutate|masa|weight)\s*[:\-]?\s*([\d.,\s]+)\s*(kg|to?ne?|t)\b/i);
  if (anyWeight) {
    const value = parseNumber(anyWeight[1]);
    if (value != null) {
      const factor = String(anyWeight[2]).toLowerCase().startsWith('t') ? 1000 : 1;
      // Unlabelled: it may be the net weight, so an operator should confirm.
      return result(Math.round(value * factor * 100) / 100, 0.55, anyWeight[0]);
    }
  }

  return NO_MATCH;
}

export function extractNetWeight(text) {
  const hit = String(text || '').match(
    /(?:greutate\s*(?:neta|netă)|masa\s*(?:neta|netă)|net\s*weight)\s*[:\-]?\s*([\d.,\s]+)\s*(kg|to?ne?|t)\b/i
  );
  if (!hit) return NO_MATCH;
  const value = parseNumber(hit[1]);
  if (value == null) return NO_MATCH;
  const factor = String(hit[2]).toLowerCase().startsWith('t') ? 1000 : 1;
  return result(Math.round(value * factor * 100) / 100, 0.9, hit[0]);
}

/** Quantity with its unit — kept separate from weight, never used in its place. */
export function extractQuantity(text) {
  const blob = String(text || '');
  // A labelled quantity is worth more than a loose number followed by a unit.
  const labelled = blob.match(
    /(?:cantitate|quantity)\s*[:\-]?\s*([\d.,]+)\s*(saci|buc|bucati|bucăți|paleti|paleți|palet|kg|to?ne?|mc|m3|role|colete)?\b/i
  );
  if (labelled) {
    const value = parseNumber(labelled[1]);
    if (value != null) {
      return result({ quantity: value, unit: (labelled[2] || '').toLowerCase() || null }, 0.9, labelled[0]);
    }
  }
  // An unlabelled number in a weight unit is almost always the weight, not the quantity —
  // "Greutate 4200 kg" must not come back as "4200 kg of goods". Reading a weight as a
  // quantity is exactly the confusion the report has to avoid.
  const bare = blob.match(
    /(?<!greutate\s)(?<!masa\s)(?<!weight\s)\b([\d.,]+)\s*(saci|buc|bucati|bucăți|paleti|paleți|palet|mc|m3|role|colete)\b/i
  );
  if (bare) {
    const value = parseNumber(bare[1]);
    if (value != null) return result({ quantity: value, unit: bare[2].toLowerCase() }, 0.8, bare[0]);
  }
  return NO_MATCH;
}

/**
 * Pallet count. Documents write it both ways round — "18 paleti" and "Paleti: 18" — and
 * handling only one of them loses the field on half the layouts.
 */
export function extractPalletCount(text) {
  const blob = String(text || '');
  const labelled = blob.match(/(?:paleti|paleți|palet|pal\.)\s*[:\-]?\s*([\d.,]+)/i);
  if (labelled) {
    const value = parseNumber(labelled[1]);
    if (value != null) return result(Math.round(value), 0.9, labelled[0]);
  }
  const trailing = blob.match(/\b([\d.,]+)\s*(?:paleti|paleți|palet|pal\.)\b/i);
  if (trailing) {
    const value = parseNumber(trailing[1]);
    if (value != null) return result(Math.round(value), 0.85, trailing[0]);
  }
  return NO_MATCH;
}

/** Field weights let a profile say which fields matter for the overall score. */
export function overallConfidence(fields, weights = {}) {
  const entries = Object.entries(fields || {});
  if (!entries.length) return 0;
  let total = 0;
  let weighted = 0;
  for (const [name, field] of entries) {
    const weight = weights[name] ?? 1;
    if (weight <= 0) continue;
    total += weight;
    weighted += weight * (field?.confidence ?? 0);
  }
  return total > 0 ? Math.round((weighted / total) * 100) / 100 : 0;
}

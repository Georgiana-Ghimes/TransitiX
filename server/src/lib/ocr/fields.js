/**
 * Field extractors shared by OCR profiles.
 *
 * Each extractor returns `{ value, confidence, matched }` rather than a bare value.
 * Confidence is what decides whether a field is written unattended or lands in front of an
 * operator, so every extractor has to be honest about how sure it is, a regex that matched
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

/** Romanian county codes used on standard plates (B, CJ, …). */
export const RO_PLATE_COUNTIES =
  'B|AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VL|VS|VN';

const RO_PLATE_TOKEN = new RegExp(
  `^(?:${RO_PLATE_COUNTIES})[\\s-]?\\d{2,3}[\\s-]?[A-Z]{2,3}$`,
  'i'
);
const SYNTHETIC_PLATE_TOKEN = /^(?:TEST-?\d{1,6}|B\s+TEST\s+\d{1,4})$/i;

/**
 * True when every slash-separated token is a real RO plate or a known synthetic test plate.
 * Used so OCR prose ("330 SRS FOOTY STREAM…") never lands in Număr auto / Excel.
 */
export function isAcceptableAutoField(value) {
  const parts = String(value || '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return false;
  if (parts.some((p) => p.length > 24)) return false;
  return parts.every((p) => RO_PLATE_TOKEN.test(p) || SYNTHETIC_PLATE_TOKEN.test(p));
}

/** Romanian plates: B 123 ABC, B123ABC, CJ 12 XYZ, county required, no loose shape matches. */
/**
 * The one way a plate is written down: `B-112-VFM`.
 *
 * There used to be two. This extractor returned `B 112 VFM` and `normalizePlate` in avizOcr
 * returned `B-112-VFM`, so the same lorry was stored two ways depending on which path had run.
 * On a screen that is untidy; as the key of a vehicle registry it is two vehicles, one of which
 * never gets its MTMA filled in. Hyphens win because that is the form the customer's own sheet
 * uses.
 *
 * A string this does not recognise as a plate comes back unchanged rather than emptied: the
 * fleet holds deliberate non-standard entries (`B-900-DEMO`, `B TEST 1`) and losing them would
 * be a worse outcome than leaving them inconsistent.
 */
export function canonicalPlate(value) {
  const text = String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const re = new RegExp(`\\b(${RO_PLATE_COUNTIES})[-\\s]?(\\d{2,3})[-\\s]?([A-Z]{2,3})\\b`, 'gi');
  const parts = [];
  const seen = new Set();
  let m = re.exec(text);
  while (m) {
    const plate = `${m[1].toUpperCase()}-${m[2]}-${m[3].toUpperCase()}`;
    if (!seen.has(plate)) {
      seen.add(plate);
      parts.push(plate);
    }
    m = re.exec(text);
  }
  return parts.length ? parts.join(' / ') : text;
}

export function extractPlate(text) {
  const found = matchPatterns(text, [
    new RegExp(`\\b((?:${RO_PLATE_COUNTIES})\\s?\\d{2,3}\\s?[A-Z]{3})\\b`, 'i'),
  ], {
    transform: (raw) => canonicalPlate(raw),
  });
  if (!found.value || !isAcceptableAutoField(found.value)) return NO_MATCH;
  return result(found.value, found.confidence, found.matched);
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

/**
 * Coerce OCR/VLM strings into a DB-safe number (Postgres NUMERIC rejects "15,75").
 *
 * Handles the carnet form `15,744,00` (same separator for thousands and decimals) that
 * plain `parseNumber` cannot, without changing `parseNumber` itself.
 */
export function coerceDbNumber(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = String(raw).trim().replace(/\s/g, '');
  if (!text) return null;

  const simple = parseNumber(text);
  if (simple != null) return simple;

  const separators = text.match(/[.,]/g) ?? [];
  if (separators.length < 2) return null;

  const cut = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','));
  const fraction = text.slice(cut + 1).replace(/\D/g, '');
  const oneKind = new Set(separators).size === 1;
  if (fraction.length === 3 && oneKind) {
    const digits = text.replace(/[.,\s]/g, '');
    return /^\d+$/.test(digits) ? Number(digits) : null;
  }
  const whole = text.slice(0, cut).replace(/[.,\s]/g, '');
  if (!/^\d+$/.test(whole)) return null;
  const value = Number(`${whole}.${fraction || '0'}`);
  return Number.isFinite(value) ? value : null;
}

const WEIGHT_UNITS = { kg: 1, kgs: 1, t: 1000, to: 1000, tone: 1000, tona: 1000, tone_: 1000 };

/**
 * Gross weight, what the weighbridge shows, goods plus pallets.
 *
 * This is the field the client corrected us on: a report needs "9.000 kg", not "378 saci".
 * A labelled "greutate brută" is trusted; a bare weight with no label is not, because it
 * could just as easily be the net.
 */
/**
 * A labelled weight, with the unit on either side of the number.
 *
 * Baumit's own avize print `Greutate bruta, kg  15,744.00` — the unit sits in the label and the
 * figure follows it. Only the `number unit` order was matched, so on those documents the weight
 * came back empty, and the annex fell back to the bucket count: "Cantitate marfa (tone)" read
 * 768 where the weighbridge said 15.74. That is the mistake the client corrected us on once
 * already, arriving again through a different door.
 *
 * The digits are matched without `\s`, so a number cannot swallow the following line on a PDF
 * that puts every token on its own row. A literal space still allows "15 744,00".
 */
function matchLabelledWeight(blob, label) {
  const after = blob.match(new RegExp(`(?:${label})\\s*[:\\-]?\\s*([\\d][\\d., ]*)\\s*(kg|to?ne?|t)\\b`, 'i'));
  if (after) return { raw: after[1], unit: after[2], matched: after[0] };

  const before = blob.match(new RegExp(`(?:${label})\\s*[,:\\-]?\\s*(kg|to?ne?|t)\\b\\s*[:\\-]?\\s*([\\d][\\d., ]*)`, 'i'));
  if (before) return { raw: before[2], unit: before[1], matched: before[0] };

  return null;
}

function weightFrom(hit, confidence) {
  if (!hit) return null;
  const value = coerceDbNumber(hit.raw);
  if (value == null) return null;
  const factor = String(hit.unit || 'kg').toLowerCase().startsWith('t') ? 1000 : 1;
  return result(Math.round(value * factor * 100) / 100, confidence, hit.matched);
}

const GROSS_LABEL = 'greutate\\s*(?:bruta|brută)|masa\\s*(?:bruta|brută)|gross\\s*weight|g\\.?\\s*bruta';
const NET_LABEL = 'greutate\\s*(?:neta|netă)|masa\\s*(?:neta|netă)|net\\s*weight';

export function extractGrossWeight(text) {
  const blob = String(text || '');

  const labelled = weightFrom(matchLabelledWeight(blob, GROSS_LABEL), 0.95);
  if (labelled) return labelled;

  // Unlabelled: it may be the net weight, so an operator should confirm.
  const any = weightFrom(matchLabelledWeight(blob, 'greutate|masa|weight'), 0.55);
  if (any) return any;

  return NO_MATCH;
}

export function extractNetWeight(text) {
  return weightFrom(matchLabelledWeight(String(text || ''), NET_LABEL), 0.9) ?? NO_MATCH;
}

/**
 * Hard ceilings, only drop OCR noise that is orders of magnitude wrong
 * ("245.000 saci" / "245090 saci"). Real loads of 10_000+ bags must still pass.
 */
export const QUANTITY_CEILING = Object.freeze({
  saci: 100000,
  sac: 100000,
  galeti: 100000,
  bucati: 200000,
  buc: 200000,
  bucăți: 200000,
  paleti: 2000,
  paleți: 2000,
  palet: 2000,
  role: 100000,
  colete: 100000,
  kg: 100000,
  t: 100,
  to: 100,
  ton: 100,
  tone: 100,
  mc: 500,
  m3: 500,
});

/** Fold diacritics so tip_marfa / OCR units compare cleanly. */
function foldUnit(unit) {
  return String(unit || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function quantityKey(unit) {
  const u = foldUnit(unit);
  if (u.startsWith('sac')) return 'saci';
  if (u.startsWith('pal')) return 'paleti';
  if (u.startsWith('buc') || u === 'pcs') return 'bucati';
  if (u.startsWith('gal')) return 'galeti';
  if (u.startsWith('ton') || u === 't' || u === 'to') return 'tone';
  return u || 'saci';
}

/**
 * True when qty is below the hard OCR-garbage ceiling for the unit.
 * Unknown count units default to the saci ceiling.
 */
export function isPlausibleQuantity(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return false;
  const key = quantityKey(unit);
  const max = QUANTITY_CEILING[key] ?? QUANTITY_CEILING.saci;
  return n <= max;
}

/**
 * How much a unit says about what is on the lorry.
 *
 * "buc" is a counting word, not a kind of goods: an aviz reading `Cantitate 768.00 buc` and
 * `Numarul de galeti 768.00` is describing buckets both times, and only the second says so.
 * Writing "bucati" into Tip marfa puts a word on the customer's annex that names nothing.
 *
 * Shared with `avizOcr.parseQty`, which ranks the same way. One table, because two would drift
 * and the two readers of the same document would then disagree about its goods.
 */
export const GOODS_UNIT_RANK = Object.freeze({
  galeti: 4, saci: 3, paleti: 2, bucati: 1,
});

/** True when a unit only counts things, without saying what they are. */
export function isGenericCountUnit(unit) {
  const folded = String(unit || '').toLowerCase().trim();
  return /^(buc|bucati|bucăți|bucati\.|pcs|pce|pc)$/.test(folded);
}

// Matched against folded text, so the diacritic spellings are already gone by this point and
// listing them here would only add dead alternatives.
const GOODS_UNIT_SOURCE = '(saci?|pal(?:eti|et)?|buc(?:ati)?|pcs|pce|gal(?:eti|eata)?)';

/**
 * A packaging word, or null.
 *
 * Built on `quantityKey`, which already maps every spelling onto the same four names and is
 * what the plausibility ceilings key off. A second mapping would be a second opinion about
 * what "gal" means. Weights are rejected here: tonnes are how much, not what.
 */
function goodsUnitOf(raw) {
  const key = quantityKey(raw);
  return GOODS_UNIT_RANK[key] ? key : null;
}

/**
 * The packaging the document actually names, preferring the word that says the most.
 *
 * A label like `Numarul de galeti` is taken first: it exists on the page precisely to name the
 * packaging, where a bare `768 buc` is only counting. Failing that, every `N unit` pair is
 * ranked and the most specific wins.
 */
export function extractGoodsUnit(text) {
  const folded = foldUnit(text);

  const labelled = folded.match(new RegExp(`num[ae]r(?:ul)?\\s+de\\s+${GOODS_UNIT_SOURCE}`, 'i'));
  if (labelled) {
    const unit = goodsUnitOf(labelled[1]);
    if (unit) return result(unit, 0.9, labelled[0]);
  }

  let best = null;
  const re = new RegExp(`\\d[\\d.,]*\\s*${GOODS_UNIT_SOURCE}\\b`, 'gi');
  let match = re.exec(folded);
  while (match) {
    const unit = goodsUnitOf(match[1]);
    const rank = GOODS_UNIT_RANK[unit] ?? 0;
    if (unit && (!best || rank > best.rank)) best = { unit, rank, matched: match[0] };
    match = re.exec(folded);
  }
  if (!best) return NO_MATCH;
  // A bare count is the weakest thing a document can say, so it is offered for review rather
  // than written unattended.
  return result(best.unit, best.rank > 1 ? 0.8 : 0.4, best.matched);
}

/** Quantity with its unit, kept separate from weight, never used in its place. */
export function extractQuantity(text) {
  const blob = String(text || '');
  // A labelled quantity is worth more than a loose number followed by a unit.
  const labelled = blob.match(
    /(?:cantitate|quantity)\s*[:\-]?\s*([\d.,]+)\s*(saci|sac|buc|bucati|bucăți|paleti|paleți|palet|kg|to?ne?|mc|m3|role|colete)?\b/i
  );
  if (labelled) {
    const value = parseNumber(labelled[1]);
    const unit = (labelled[2] || '').toLowerCase() || null;
    if (value != null && isPlausibleQuantity(value, unit)) {
      return result({ quantity: value, unit }, 0.9, labelled[0]);
    }
  }
  // An unlabelled number in a weight unit is almost always the weight, not the quantity,
  // "Greutate 4200 kg" must not come back as "4200 kg of goods". Reading a weight as a
  // quantity is exactly the confusion the report has to avoid.
  const bare = blob.match(
    /(?<!greutate\s)(?<!masa\s)(?<!weight\s)\b([\d.,]+)\s*(saci|sac|buc|bucati|bucăți|paleti|paleți|palet|mc|m3|role|colete)\b/i
  );
  if (bare) {
    const value = parseNumber(bare[1]);
    const unit = bare[2].toLowerCase();
    if (value != null && isPlausibleQuantity(value, unit)) {
      return result({ quantity: value, unit }, 0.8, bare[0]);
    }
  }
  return NO_MATCH;
}

/**
 * Pallet count. Documents write it both ways round, "18 paleti" and "Paleti: 18", and
 * handling only one of them loses the field on half the layouts.
 */
export function extractPalletCount(text) {
  const blob = String(text || '');
  // Only same-line whitespace, `\s` would jump to the next article code after "7.00 pal".
  const labelled = blob.match(/(?:paleti|paleți|palete?)\b[^\S\n]*[:\-]?[^\S\n]*([\d.,]+)/i);
  if (labelled) {
    const value = parseNumber(labelled[1]);
    if (value != null && value > 0 && value < 500) return result(Math.round(value), 0.9, labelled[0]);
  }
  const trailing = blob.match(/\b([\d.,]+)[^\S\n]*(?:paleti|paleți|palete?|pal)\b/i);
  if (trailing) {
    const value = parseNumber(trailing[1]);
    if (value != null && value > 0 && value < 500) return result(Math.round(value), 0.85, trailing[0]);
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

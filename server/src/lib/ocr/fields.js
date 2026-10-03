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
  // Walk the whole snippet and keep every RO plate. Matching a single token used to drop
  // the remorca on "B 911 VFM / B 138 VRT", while Autoturisme / taxa de zonă still only
  // look up the first (tractor) plate on purpose.
  const value = canonicalPlate(text);
  if (!value || !isAcceptableAutoField(value)) return NO_MATCH;
  return result(value, value.includes(' / ') ? 0.88 : 0.9, value);
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
 * Some PDF layouts wrap the unit in parentheses — `Greutate brută (kg) 9.487,80` — which the
 * older pattern missed because `(` blocked the unit token.
 *
 * The digits are matched without `\s`, so a number cannot swallow the following line on a PDF
 * that puts every token on its own row. A literal space still allows "15 744,00".
 */
function matchLabelledWeight(blob, label) {
  const unit = '(kg|to?ne?|t)\\b';
  const num = '([\\d][\\d., ]*)';
  // Optional parentheses around the unit: "(kg)" or bare "kg".
  const unitToken = `\\(?\\s*${unit}\\s*\\)?`;

  // Label, then unit, then number — `Greutate bruta, kg 15,744.00` / `Greutate brută (kg) 9.487,80`.
  const unitThenNum = blob.match(
    new RegExp(`(?:${label})\\s*[,:\\-]?\\s*${unitToken}\\s*[:\\-]?\\s*${num}`, 'i'),
  );
  if (unitThenNum) {
    return { raw: unitThenNum[2], unit: unitThenNum[1], matched: unitThenNum[0] };
  }

  // Label, then number, then unit — `Greutate bruta: 9.000 kg`.
  const numThenUnit = blob.match(
    new RegExp(`(?:${label})\\s*[:\\-]?\\s*${num}\\s*${unit}`, 'i'),
  );
  if (numThenUnit) {
    return { raw: numThenUnit[1], unit: numThenUnit[2], matched: numThenUnit[0] };
  }

  return null;
}

function weightFrom(hit, confidence) {
  if (!hit) return null;
  const value = parseNumber(hit.raw);
  if (value == null) return null;
  const factor = String(hit.unit || 'kg').toLowerCase().startsWith('t') ? 1000 : 1;
  return result(Math.round(value * factor * 100) / 100, confidence, hit.matched);
}

const GROSS_LABEL = 'greutate\\s*(?:bruta|brută)|masa\\s*(?:bruta|brută)|gross\\s*weight|g\\.?\\s*bruta';
const NET_LABEL = 'greutate\\s*(?:neta|netă)|masa\\s*(?:neta|netă)|net\\s*weight';

/** Bag/unit sizes like "25 kg" on the product line — not a truck load. */
const LOAD_WEIGHT_MIN_KG = 100;

/**
 * Baumit digital PDFs column-order the goods table so the gross kg sits after the bag
 * count, while the later "Greutate brută:" label only has "pce / preluare" under it:
 *   378.00 sac · 9,487.80 kg · … · Greutate netă: 9,450.00 kg · Greutate brută: pce
 */
function matchQuantityAdjacentGross(blob) {
  const m = blob.match(
    /\b([\d][\d.,]*)\s*(?:sac(?:i)?|gale(?:t[iă]|ți)|buc(?:ati|ăți)?|pcs)\b\s+([\d][\d.,]*)\s*kg\b/i,
  );
  if (!m) return null;
  return { raw: m[2], unit: 'kg', matched: m[0] };
}

/**
 * When net is labelled but gross is not, pick another load-sized kg figure — preferably
 * the one just above net (packaging delta). Skips the net value itself and tiny unit sizes.
 */
function matchGrossBesideNet(blob, netKg) {
  const re = /([\d][\d.,]*)\s*kg\b/gi;
  const candidates = [];
  let m;
  while ((m = re.exec(blob)) !== null) {
    const value = parseNumber(m[1]);
    if (value == null || value < LOAD_WEIGHT_MIN_KG) continue;
    if (netKg != null && Math.abs(value - netKg) < 0.05) continue;
    candidates.push({ value, raw: m[1], matched: m[0] });
  }
  if (!candidates.length) return null;

  if (netKg != null) {
    const above = candidates.filter((c) => c.value >= netKg - 0.05);
    if (above.length) {
      above.sort((a, b) => a.value - b.value);
      return { raw: above[0].raw, unit: 'kg', matched: above[0].matched };
    }
  }

  candidates.sort((a, b) => b.value - a.value);
  return { raw: candidates[0].raw, unit: 'kg', matched: candidates[0].matched };
}

export function extractGrossWeight(text) {
  const blob = String(text || '');

  const labelled = weightFrom(matchLabelledWeight(blob, GROSS_LABEL), 0.95);
  if (labelled) return labelled;

  // Table-column layout: kg figure right after the bag/bucket count.
  const besideQty = weightFrom(matchQuantityAdjacentGross(blob), 0.88);
  if (besideQty && besideQty.value >= LOAD_WEIGHT_MIN_KG) return besideQty;

  // Net labelled (or a hollow "Greutate brută:" with no digits after it) — pick another
  // load-sized kg. Do not run this on bare "Greutate 9000 kg"; that stays low-confidence.
  const net = weightFrom(matchLabelledWeight(blob, NET_LABEL), 0.9);
  const hollowGrossLabel = new RegExp(`(?:${GROSS_LABEL})`, 'i').test(blob);
  if (net || hollowGrossLabel) {
    const besideNet = weightFrom(matchGrossBesideNet(blob, net?.value ?? null), 0.8);
    if (besideNet) return besideNet;
  }

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
  // Photo OCR often turns „găleți” into ga1eti / galei.
  if (u.startsWith('gal') || u === 'ga1eti' || u === 'galei') return 'galeti';
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
// `ga1eti` / `galei` cover common photo-OCR misreads of „găleți”.
const GOODS_UNIT_SOURCE = '(saci?|pal(?:eti|et)?|buc(?:ati)?|pcs|pce|gal(?:eti|eata)?|ga1eti|galei)';

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

/** Footer label `Numărul de găleți` / `Numarul de saci` without requiring the total figure. */
function packagingFooterUnit(folded) {
  const labelled = folded.match(new RegExp(`num[ae]r(?:ul)?\\s+de\\s+${GOODS_UNIT_SOURCE}`, 'i'));
  if (!labelled) return null;
  return goodsUnitOf(labelled[1]);
}

/**
 * Packaging total from the Baumit footer. Photo OCR often splits the label and the number
 * across lines or inserts junk between them — same-line-only matching then falls through to
 * the first product line (48 instead of 576).
 */
function packagingFooterTotal(folded) {
  const attempts = [
    // Same line: `Numarul de galeti: 576,00`
    new RegExp(`num[ae]r(?:ul)?\\s+de\\s+${GOODS_UNIT_SOURCE}\\s*[:\\-]?\\s*([\\d.,]+)`, 'i'),
    // Label then number within a short window (newline / OCR debris)
    new RegExp(`num[ae]r(?:ul)?\\s+de\\s+${GOODS_UNIT_SOURCE}[^\\d]{0,48}([\\d.,]+)`, 'i'),
    // Number then label (reordered OCR blocks)
    new RegExp(`([\\d.,]+)\\s*[:\\-]?\\s*num[ae]r(?:ul)?\\s+de\\s+${GOODS_UNIT_SOURCE}`, 'i'),
  ];
  for (const re of attempts) {
    const m = folded.match(re);
    if (!m) continue;
    // Group order differs on the number-first pattern.
    const unitRaw = m[1] && /[a-z]/i.test(m[1]) ? m[1] : m[2];
    const numRaw = m[1] && /[a-z]/i.test(m[1]) ? m[2] : m[1];
    const unit = goodsUnitOf(unitRaw);
    const value = parseNumber(numRaw);
    if (unit && value != null && isPlausibleQuantity(value, unit)) {
      return { quantity: value, unit, matched: m[0] };
    }
  }
  return null;
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

  const fromFooter = packagingFooterUnit(folded);
  if (fromFooter) {
    const labelled = folded.match(new RegExp(`num[ae]r(?:ul)?\\s+de\\s+${GOODS_UNIT_SOURCE}`, 'i'));
    return result(fromFooter, 0.9, labelled?.[0] || fromFooter);
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

/** Packaging units that name goods (not bare "buc" / euro-pallet "pce"). */
const SUMMABLE_PACKAGING = new Set(['saci', 'galeti', 'paleti']);

/** Count every packaging `N unit` / `Cantitate N unit` pair on the page. */
function collectPackagingLines(folded) {
  const lines = [];
  // Labelled product rows and bare "48.00 buc" / "270.00 sac" alike. Euro-pallet `pce` is
  // skipped: it is returnable packaging, not the goods count the annex wants.
  const re = new RegExp(
    `(?:(?:cantitate|quantity)\\s*[:\\-]?\\s*)?([\\d.,]+)\\s*${GOODS_UNIT_SOURCE}\\b`,
    'gi',
  );
  let match = re.exec(folded);
  while (match) {
    const rawUnit = String(match[2] || '').toLowerCase();
    if (rawUnit === 'pce') {
      match = re.exec(folded);
      continue;
    }
    const unit = goodsUnitOf(rawUnit);
    const qty = parseNumber(match[1]);
    if (unit && qty != null && isPlausibleQuantity(qty, unit)) {
      lines.push({ qty, unit, rank: GOODS_UNIT_RANK[unit] ?? 0, matched: match[0] });
    }
    match = re.exec(folded);
  }
  return lines;
}

/**
 * Quantity with its unit, kept separate from weight, never used in its place.
 *
 * Preference order (Baumit multi-line sheets):
 * 1. Footer total — `Numărul de găleți 576,00` / `Numărul de saci …`
 *    (tolerant of photo-OCR line splits between label and figure)
 * 2. Sum of packaging lines when there are several (exclude euro-pallet `pce`)
 * 3. Single best / labelled line (legacy one-row avize) — BUT never when a packaging
 *    footer label is present: that means the page has a total, and the first product
 *    line (48) is the wrong answer.
 *
 * Taking the first product line alone is wrong on multi-line transfers: 48 instead of 576.
 */
export function extractQuantity(text) {
  const blob = String(text || '');
  const folded = foldUnit(blob);

  const footer = packagingFooterTotal(folded);
  if (footer) {
    return result({ quantity: footer.quantity, unit: footer.unit }, 0.95, footer.matched);
  }

  const footerUnit = packagingFooterUnit(folded);
  const lines = collectPackagingLines(folded);

  // Footer label seen (tip = găleți) but the figure failed OCR: sum product lines instead of
  // grabbing the first `48 buc`. Report the footer unit so Tip marfă and Cantitate agree.
  if (footerUnit && lines.length >= 2) {
    const sum = Math.round(lines.reduce((acc, l) => acc + l.qty, 0) * 100) / 100;
    if (isPlausibleQuantity(sum, footerUnit)) {
      return result(
        { quantity: sum, unit: footerUnit },
        0.86,
        lines.map((l) => l.matched).join(' + '),
      );
    }
  }

  if (!lines.length) {
    // Labelled quantity that carries no packaging word (rare), still better than nothing.
    const labelled = blob.match(
      /(?:cantitate|quantity)\s*[:\-]?\s*([\d.,]+)\s*(kg|to?ne?|mc|m3)?\b/i,
    );
    if (labelled) {
      const value = parseNumber(labelled[1]);
      const unit = (labelled[2] || '').toLowerCase() || null;
      // Reject bare kg/t here when the label was only "Cantitate" next to a weight — those
      // belong to extractGrossWeight. A quantity in kg is allowed only with an explicit unit.
      if (unit && value != null && isPlausibleQuantity(value, unit)) {
        return result({ quantity: value, unit }, 0.75, labelled[0]);
      }
    }
    return NO_MATCH;
  }

  const bestRank = Math.max(...lines.map((l) => l.rank));
  const topUnit = lines.find((l) => l.rank === bestRank)?.unit;
  const top = lines.filter((l) => l.unit === topUnit);

  if (top.length >= 2 && (SUMMABLE_PACKAGING.has(topUnit) || topUnit === 'bucati')) {
    const sum = Math.round(top.reduce((acc, l) => acc + l.qty, 0) * 100) / 100;
    if (isPlausibleQuantity(sum, topUnit)) {
      return result({ quantity: sum, unit: topUnit }, 0.88, top.map((l) => l.matched).join(' + '));
    }
  }

  // Packaging footer label without a readable total + only one product line in OCR:
  // do not write that line as Cantitate (classic photo miss: 48 instead of 576).
  if (footerUnit) return NO_MATCH;

  const pick = top[0];
  return result({ quantity: pick.qty, unit: pick.unit }, pick.rank > 1 ? 0.9 : 0.8, pick.matched);
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

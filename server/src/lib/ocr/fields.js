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

/**
 * Product units that look like a plate letter-series (county + digits + letters).
 * `TM 40 kg` on a goods line is Timiș + 40 + KG — a real county code, a false plate (#52).
 */
const PLATE_SERIES_BLOCKLIST = new Set([
  'KG', 'KGS', 'TO', 'TON', 'T',
  'SAC', 'PCE', 'PCS', 'BUC', 'PAL', 'GAL',
]);

/** Letter series of a RO plate token — not a weighbridge / packaging unit. */
export function isPlausiblePlateSeries(letters) {
  const s = String(letters || '').toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(s)) return false;
  return !PLATE_SERIES_BLOCKLIST.has(s);
}

const RO_PLATE_TOKEN = new RegExp(
  `^(${RO_PLATE_COUNTIES})[\\s-]?(\\d{2,3})[\\s-]?([A-Z]{2,3})$`,
  'i'
);
/**
 * Common EU plates with exactly 4 digits (Bulgarian CA 4471 KX, etc.).
 * Distinct from RO (2–3 digits) so the two never compete on the same token (#60).
 */
const FOREIGN_EU_PLATE_TOKEN = /^([A-Z]{1,2})[\s-]?(\d{4})[\s-]?([A-Z]{2})$/i;
const SYNTHETIC_PLATE_TOKEN = /^(?:TEST-?\d{1,6}|B\s+TEST\s+\d{1,4})$/i;

function isForeignEuPlateToken(part) {
  const m = String(part || '').trim().match(FOREIGN_EU_PLATE_TOKEN);
  return Boolean(m && isPlausiblePlateSeries(m[3]));
}

function isRoPlateToken(part) {
  const m = String(part || '').trim().match(RO_PLATE_TOKEN);
  return Boolean(m && isPlausiblePlateSeries(m[3]));
}

/**
 * True when every slash-separated token is a real RO plate, a recognised foreign EU
 * plate (4-digit series), or a known synthetic test plate.
 * Used so OCR prose ("330 SRS FOOTY STREAM…") never lands in Număr auto / Excel.
 */
export function isAcceptableAutoField(value) {
  const parts = String(value || '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return false;
  if (parts.some((p) => p.length > 24)) return false;
  return parts.every((p) => {
    if (SYNTHETIC_PLATE_TOKEN.test(p)) return true;
    return isRoPlateToken(p) || isForeignEuPlateToken(p);
  });
}

/**
 * Plates in document order: RO (county + 2–3 digits) and foreign EU (1–2 letters + 4 digits).
 * Order matters — tractor is first on Baumit "CA 4471 KX / B 63 RTX" (#60).
 */
export function extractPlateTokens(text) {
  const s = String(text || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const hits = [];
  const ro = new RegExp(`\\b(${RO_PLATE_COUNTIES})[-\\s]?(\\d{2,3})[-\\s]?([A-Z]{2,3})\\b`, 'gi');
  let m;
  while ((m = ro.exec(s)) !== null) {
    if (!isPlausiblePlateSeries(m[3])) continue;
    hits.push({
      index: m.index,
      plate: `${m[1].toUpperCase()}-${m[2]}-${m[3].toUpperCase()}`,
      kind: 'ro',
    });
  }
  // Exactly 4 digits — Bulgarian / similar EU. Must not steal RO's 2–3 digit form.
  const foreign = /\b([A-Z]{1,2})[-\s]?(\d{4})[-\s]?([A-Z]{2})\b/gi;
  while ((m = foreign.exec(s)) !== null) {
    if (!isPlausiblePlateSeries(m[3])) continue;
    hits.push({
      index: m.index,
      plate: `${m[1].toUpperCase()}-${m[2]}-${m[3].toUpperCase()}`,
      kind: 'foreign',
    });
  }
  hits.sort((a, b) => a.index - b.index || a.plate.localeCompare(b.plate));
  const out = [];
  const seen = new Set();
  for (const hit of hits) {
    if (seen.has(hit.plate)) continue;
    seen.add(hit.plate);
    out.push(hit);
  }
  return out;
}

/**
 * The one way a plate is written down: `B-112-VFM` (and `CA-4471-KX` for foreign EU).
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
  const parts = extractPlateTokens(text).map((t) => t.plate);
  return parts.length ? parts.join(' / ') : text;
}

export function extractPlate(text) {
  // Walk the whole snippet and keep every RO + recognised foreign plate. Matching only RO
  // used to drop the Bulgarian tractor on "CA 4471 KX / B 63 RTX" and keep the trailer (#60).
  // Autoturisme / taxa de zonă still look up the first (tractor) plate on purpose.
  const tokens = extractPlateTokens(text);
  if (!tokens.length) return NO_MATCH;
  const value = tokens.map((t) => t.plate).join(' / ');
  if (!isAcceptableAutoField(value)) return NO_MATCH;
  // Recognised foreign EU (4-digit) is trusted like RO; unknown formats never reach here.
  const multi = tokens.length > 1;
  return result(value, multi ? 0.88 : 0.9, value);
}

const MONTHS = {
  ian: 1, feb: 2, mar: 3, apr: 4, mai: 5, iun: 6,
  iul: 7, aug: 8, sep: 9, oct: 10, noi: 11, dec: 12,
};

/** Calendar day in Europe/Bucharest (YYYY-MM-DD). */
function bucharestTodayYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDaysYmdLocal(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

/** Years OCR often confuses by swapping 0↔6 (2026 → 2020 under blue/night wash) (#77). */
export function yearDigitSwapCandidates(year) {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 1000 || y > 9999) return [y].filter(Number.isFinite);
  const s = String(Math.trunc(y));
  const out = new Set([y]);
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '0') out.add(Number(`${s.slice(0, i)}6${s.slice(i + 1)}`));
    if (s[i] === '6') out.add(Number(`${s.slice(0, i)}0${s.slice(i + 1)}`));
  }
  return [...out];
}

/**
 * Build ISO date; if the OCR year falls outside the trip window, try a single 0↔6 digit
 * swap that lands inside it (2020→2026) at low confidence (#77).
 */
export function resolveAvizDateParts(day, month, year, { asOf } = {}) {
  const d = Number(day);
  const m = Number(month);
  let y = Number(year);
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) return null;
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || m < 1 || m > 12) return null;
  if (y < 1990 || y > 2100) return null;

  const today = asOf || bucharestTodayYmd();
  const maxOk = addDaysYmdLocal(today, 1);
  const minOk = addDaysYmdLocal(today, -400);
  const currentYear = Number(String(today).slice(0, 4));
  const pad = (n) => String(n).padStart(2, '0');
  const isoFor = (yr) => `${yr}-${pad(m)}-${pad(d)}`;

  const originalIso = isoFor(y);
  if (originalIso >= minOk && originalIso <= maxOk) {
    return { iso: originalIso, confidence: 0.9, repaired: false };
  }

  const repaired = yearDigitSwapCandidates(y)
    .filter((yr) => yr !== y)
    .map((yr) => ({ yr, iso: isoFor(yr) }))
    .filter(({ iso }) => iso >= minOk && iso <= maxOk)
    .sort((a, b) => Math.abs(a.yr - currentYear) - Math.abs(b.yr - currentYear));

  if (repaired.length) {
    return { iso: repaired[0].iso, confidence: 0.55, repaired: true };
  }

  // Keep OCR year even if old — validation will flag it.
  return { iso: originalIso, confidence: 0.9, repaired: false };
}

function parseDmyToken(token, asOf) {
  const m = String(token || '').match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
  if (!m) return null;
  return resolveAvizDateParts(m[1], m[2], m[3], { asOf });
}

/** dd.mm.yyyy, yyyy-mm-dd, dd mmm yyyy. Returns ISO. */
export function extractDate(text, { asOf } = {}) {
  const blob = String(text || '');
  const today = asOf || bucharestTodayYmd();

  // Prefer the printed aviz date label — first bare date on the page can be noise (#77).
  const labelled = blob.match(
    /(?:data\s+(?:avizului(?:\s+de\s+expedi[tț]ie)?|aviz(?:ului)?(?:\s+de\s+expedi[tț]ie)?|efectu[aă]rii?\s+cursei|documentului)|data\s*aviz)\s*[:.\-]?\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})/i,
  );
  if (labelled) {
    const parsed = parseDmyToken(labelled[1], today);
    if (parsed) return result(parsed.iso, parsed.confidence, labelled[0]);
  }

  const iso = blob.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const parsed = resolveAvizDateParts(iso[3], iso[2], iso[1], { asOf: today });
    if (parsed) return result(parsed.iso, Math.min(0.95, parsed.confidence + 0.05), iso[0]);
  }

  const dmy = blob.match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\b/);
  if (dmy) {
    const parsed = resolveAvizDateParts(dmy[1], dmy[2], dmy[3], { asOf: today });
    if (parsed) return result(parsed.iso, parsed.confidence, dmy[0]);
  }

  const named = blob.match(/\b(\d{1,2})\s+([a-zăâîșț]{3,10})\.?\s+(\d{4})\b/i);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) {
      const parsed = resolveAvizDateParts(named[1], month, named[3], { asOf: today });
      if (parsed) return result(parsed.iso, Math.min(0.85, parsed.confidence), named[0]);
    }
  }

  return NO_MATCH;
}

/**
 * Romanian decimals use a comma; thousands separators are dots or spaces.
 *
 * OCR often turns the thousands comma into another dot (`21,326.48` → `21.326.48`).
 * The old rule treated any `.NNN` as thousands and stripped *all* dots, so `21.326.48`
 * became `2132648` (×100). When several dots remain, the last 1–2 digit group is the
 * decimal; earlier dots are thousands. A lone `.NNN` at the end stays thousands (`9.000`).
 */
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
    // A single comma is the decimal. Multi-comma handwriting (`15,744,00`) stays null
    // here on purpose — carnetNumber in profiles.js owns that layout.
    text = text.replace(',', '.');
  } else if (hasDot) {
    const parts = text.split('.');
    if (parts.length > 2) {
      const fraction = parts[parts.length - 1];
      // `21.326.48` / `20.950.00` — last group is cents; `1.234.567` — all thousands.
      text = fraction.length >= 1 && fraction.length <= 2
        ? `${parts.slice(0, -1).join('')}.${fraction}`
        : parts.join('');
    } else if (/\.\d{3}$/.test(text)) {
      // A single trailing `.NNN` is thousands, not a three-decimal weight.
      text = text.replace('.', '');
    }
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

/**
 * OCR under a stain often spaces digit groups (`6 994 45`) or drops the decimal comma
 * (`6.99445` for `6.994,45`). Normalise before parseNumber so greutate brută is not lost (#74).
 */
export function normalizeWeightRaw(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return text;
  // `6 994 45` / `15 744 00` — spaces as thousands, last ≤2-digit group as cents.
  if (!/[.,]/.test(text) && /\d\s+\d/.test(text)) {
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && parts.every((p) => /^\d+$/.test(p))) {
      const last = parts[parts.length - 1];
      text = last.length <= 2
        ? `${parts.slice(0, -1).join('')},${last}`
        : parts.join('');
    }
  }
  // `6.99445` (one int digit + 4–5 fraction digits) → Romanian `6.994,45`.
  const glued = text.match(/^(\d)\.(\d{4,5})$/);
  if (glued) {
    const frac = glued[2];
    text = `${glued[1]}.${frac.slice(0, -2)},${frac.slice(-2)}`;
  }
  return text;
}

function weightFrom(hit, confidence) {
  if (!hit) return null;
  const value = parseNumber(normalizeWeightRaw(hit.raw));
  if (value == null) return null;
  const factor = String(hit.unit || 'kg').toLowerCase().startsWith('t') ? 1000 : 1;
  return result(Math.round(value * factor * 100) / 100, confidence, hit.matched);
}

const GROSS_LABEL = 'greutate\\s*(?:bruta|brută)|masa\\s*(?:bruta|brută)|gross\\s*weight|g\\.?\\s*bruta';
const NET_LABEL = 'greutate\\s*(?:neta|netă)|masa\\s*(?:neta|netă)|net\\s*weight';

/** Bag/unit sizes like "25 kg" on the product line — not a truck load. */
export const LOAD_WEIGHT_MIN_KG = 100;

/** A lorry on a public road cannot weigh this little as "greutate brută" (#66: CMR box 12 → 12 kg). */
export const LOAD_WEIGHT_MAX_KG = 60000;

/** True when a gross/net kg figure is a plausible truck load, not a box number or unit size. */
export function isPlausibleLoadWeightKg(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return false;
  return n >= LOAD_WEIGHT_MIN_KG && n <= LOAD_WEIGHT_MAX_KG;
}

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

/**
 * Fold for correction / packaging phrase matching (diacritics off).
 */
function foldCorrectionText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ș|ş/g, 's')
    .replace(/ț|ţ/g, 't');
}

/**
 * Pen strike-through + handwritten fix on the page (#65).
 * Phrase like „corectat la încărcare” is the reliable signal; OCR still often reads both figures.
 */
export function detectHandCorrection(text) {
  const folded = foldCorrectionText(text);
  if (!folded.trim()) return { present: false, folded: '' };
  const present = /corectat(?:a|e)?(?:\s+la\s+incarcare)?|\bcorectare\b|\bvaloare\s+corectata\b/.test(folded);
  return { present, folded };
}

/**
 * Bare count written next to a struck packaging total (e.g. "432.00 sac … 400 corectat").
 */
function handwrittenQuantityOverride(folded, printedQty, unit) {
  const phraseAt = folded.search(/corectat/);
  if (phraseAt < 0) return null;
  const window = folded.slice(Math.max(0, phraseAt - 160), phraseAt + 24);
  const re = /\b(\d{2,5})(?:[.,]\d{1,2})?\b(?!\s*(?:sac|gale|buc|pce|kg|pal|m3|mc|lei|ron)\b)/gi;
  const candidates = [];
  let m;
  while ((m = re.exec(window)) !== null) {
    const n = parseNumber(m[1]);
    if (n == null || n < 10) continue;
    if (printedQty != null && Math.abs(n - Number(printedQty)) < 0.01) continue;
    if (!isPlausibleQuantity(n, unit || 'saci')) continue;
    candidates.push(n);
  }
  if (!candidates.length) return null;
  // Closest to the phrase: last match in the pre-phrase window.
  return candidates[candidates.length - 1];
}

/**
 * Second load-sized kg near Greutate brută when the printed figure was struck (#65).
 */
function handwrittenGrossOverride(folded, printedKg) {
  const section = folded.match(/greutate\s*bruta[\s\S]{0,220}/i)?.[0]
    || (folded.search(/corectat/) >= 0
      ? folded.slice(Math.max(0, folded.search(/corectat/) - 200), folded.search(/corectat/) + 40)
      : '');
  if (!section) return null;
  const nums = [];
  const re = /([\d][\d.,\s]{2,})(?:\s*kg)?/gi;
  let m;
  while ((m = re.exec(section)) !== null) {
    const n = parseNumber(m[1]);
    if (n == null || n < LOAD_WEIGHT_MIN_KG || n > 60000) continue;
    nums.push(n);
  }
  const distinct = nums.filter(
    (n) => printedKg == null || Math.abs(n - Number(printedKg)) > 0.5,
  );
  if (!distinct.length) return null;
  // Prefer a figure below the printed one when the strike is a reduction (common at loading).
  if (printedKg != null) {
    const below = distinct.filter((n) => n < Number(printedKg));
    if (below.length) return below[below.length - 1];
  }
  return distinct[distinct.length - 1];
}

function withHandCorrectionConfidence(found) {
  if (!found || found.value == null) return found;
  return {
    ...found,
    confidence: Math.min(Number(found.confidence) || 0, 0.55),
  };
}

export function extractGrossWeight(text) {
  const blob = String(text || '');
  const { present, folded } = detectHandCorrection(blob);

  const labelled = weightFrom(matchLabelledWeight(blob, GROSS_LABEL), 0.95);
  let found = labelled;

  if (!found) {
    // Table-column layout: kg figure right after the bag/bucket count.
    const besideQty = weightFrom(matchQuantityAdjacentGross(blob), 0.88);
    if (besideQty && besideQty.value >= LOAD_WEIGHT_MIN_KG) found = besideQty;
  }

  if (!found) {
    // Net labelled (or a hollow "Greutate brută:" with no digits after it) — pick another
    // load-sized kg. Do not run this on bare "Greutate 9000 kg"; that stays low-confidence.
    const net = weightFrom(matchLabelledWeight(blob, NET_LABEL), 0.9);
    const hollowGrossLabel = new RegExp(`(?:${GROSS_LABEL})`, 'i').test(blob);
    if (net || hollowGrossLabel) {
      const besideNet = weightFrom(matchGrossBesideNet(blob, net?.value ?? null), 0.8);
      if (besideNet) found = besideNet;
    }
  }

  if (!found) {
    // Unlabelled: it may be the net weight, so an operator should confirm.
    const any = weightFrom(matchLabelledWeight(blob, 'greutate|masa|weight'), 0.55);
    if (any) found = any;
  }

  if (!found) return NO_MATCH;

  if (present) {
    const hand = handwrittenGrossOverride(folded, found.value);
    if (hand != null && Math.abs(hand - Number(found.value)) > 0.5) {
      if (!isPlausibleLoadWeightKg(hand)) return NO_MATCH;
      return result(hand, 0.55, 'hand-correction-gross');
    }
    found = withHandCorrectionConfidence(found);
  }

  const netCheck = weightFrom(matchLabelledWeight(blob, NET_LABEL), 0.9);
  const netKg = netCheck?.value != null && Number.isFinite(netCheck.value) ? netCheck.value : null;

  // Reject box-number / unit-size leftovers (CMR căsuța 12 → "12 kg") (#66) — unless a
  // stain-digit repair lands on a truck load (#74).
  if (!isPlausibleLoadWeightKg(found.value)) {
    if (netKg != null) {
      const repaired = repairGrossMissingDigit(found.value, netKg);
      if (repaired != null) {
        return result(repaired, 0.55, found.matched || 'gross-digit-repair');
      }
    }
    return NO_MATCH;
  }

  // Gross below a labelled net is impossible (goods+pallets ≥ goods). A coffee stain often
  // drops a digit (`17.004,82` → `1.704,82`, or `6,994.45` → `699.45`) (#73 / #74).
  if (netKg != null && found.value + 0.05 < netKg) {
    const repaired = repairGrossMissingDigit(found.value, netKg);
    if (repaired != null) {
      return result(repaired, 0.55, found.matched || 'gross-digit-repair');
    }
    // Another load-sized kg on the page (table column) may still be the true gross.
    const besideNet = weightFrom(matchGrossBesideNet(blob, netKg), 0.72);
    if (
      besideNet?.value != null
      && isPlausibleLoadWeightKg(besideNet.value)
      && besideNet.value + 0.05 >= netKg
    ) {
      return besideNet;
    }
    return NO_MATCH;
  }

  return found;
}

/**
 * Stain / OCR often drops one digit from greutate brută. Prefer ×10 (missing thousands place)
 * when that lands just above net with a plausible packaging delta — low confidence → HITL (#74).
 * Also try ×1000 when OCR glued `6.994,45` into a sub-100 figure that normalizeWeightRaw missed.
 */
export function repairGrossMissingDigit(grossKg, netKg) {
  const g = Number(grossKg);
  const n = Number(netKg);
  if (!Number.isFinite(g) || !Number.isFinite(n) || g <= 0 || n <= 0) return null;
  if (g + 0.05 >= n && isPlausibleLoadWeightKg(g)) return null;

  for (const factor of [10, 1000]) {
    const scaled = Math.round(g * factor * 100) / 100;
    if (!isPlausibleLoadWeightKg(scaled)) continue;
    if (scaled + 0.05 < n) continue;
    // Pallets / packaging on a truck are rarely more than a few tonnes above net.
    if (scaled - n > 5000) continue;
    return scaled;
  }
  return null;
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
    // Superscript cube (m³) is not a combining mark — normalize before NFD strip (#63).
    .replace(/m³/g, 'm3')
    .replace(/³/g, '3')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Mixed bag+bucket sheets (#62): tip and quantity cover both packaging types. */
export const MIXED_SAC_GALETI = 'saci/galeti';

function isMixedSacGaleti(unit) {
  const u = foldUnit(unit).replace(/\s+/g, '');
  return u === 'saci/galeti' || u === 'galeti/saci';
}

function quantityKey(unit) {
  const u = foldUnit(unit);
  // Must run before startsWith('sac') — otherwise "saci/galeti" collapses to saci alone (#62).
  if (isMixedSacGaleti(u)) return 'saci';
  if (u === 'm3' || u === 'mc') return 'm3';
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
  // Volume (BCA etc.) outranks returnable euro-pallets (#63).
  m3: 5, galeti: 4, saci: 3, paleti: 2, bucati: 1,
});

/** True when a unit only counts things, without saying what they are. */
export function isGenericCountUnit(unit) {
  const folded = String(unit || '').toLowerCase().trim();
  return /^(buc|bucati|bucăți|bucati\.|pcs|pce|pc)$/.test(folded);
}

// Matched against folded text, so the diacritic spellings are already gone by this point and
// listing them here would only add dead alternatives.
// `ga1eti` / `galei` cover common photo-OCR misreads of „găleți”.
// `m3` / `mc` = cubic metres (BCA); `m³` is folded to `m3` first (#63).
const GOODS_UNIT_SOURCE = '(saci?|pal(?:eti|et)?|buc(?:ati)?|pcs|pce|gal(?:eti|eata)?|ga1eti|galei|m3|mc)';

/**
 * Same-line gap between a count and its unit. Newlines used to glue the trailing digit of
 * `28.80 m3` onto the next row's `Palet` → fake "3 paleți" (#63). Pipes stay allowed for
 * markdown OCR tables (`28.80 | m3`).
 */
const QTY_UNIT_GAP = '(?:[^\\S\\n]|\\|)*';

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

/** Tip/Cantitate unit as shown on screen — volume is m³, not mc/m3 (#63). */
function publicGoodsUnit(unit) {
  if (unit === 'm3') return 'm³';
  return unit;
}

/**
 * OCR often swaps găleți↔paleți on the packaging footer (#82).
 * „Numărul de găleți 192” misread as paleți while product rows are `144 buc` + `48 buc`
 * and `Palet Euro … 8 pce` is only returnable packaging — keep tip as găleți.
 *
 * True pallet returns (`Numărul de paleți` + only `pce`, no buc/(24/pal) buckets) stay paleți.
 */
function footerPaletiIsMisreadGaleti(folded, footerQty) {
  if (!/\d[\d.,]*\s*buc(?:ati)?\b/i.test(folded)) return false;
  const bucketish = /\(\s*\d+\s*\/\s*pal/i.test(folded)
    || /\b(?:betonk[o0]ntakt|unibaza|silikotop|finolux|finishpro|hidrostop|superprimer|grund|primer|glet|vopsea)\b/i.test(folded);
  if (!bucketish) return false;
  const bucLines = collectPackagingLines(folded).filter((l) => l.unit === 'bucati');
  if (!bucLines.length) return false;
  const bucSum = Math.round(bucLines.reduce((acc, l) => acc + l.qty, 0) * 100) / 100;
  if (footerQty != null && Number.isFinite(Number(footerQty))) {
    return Math.abs(bucSum - Number(footerQty)) <= 0.05;
  }
  // Label without a readable total: still distrust paleți when bucket rows + euro pce coexist.
  return /\d[\d.,]*\s*pce\b/i.test(folded) || /palet\s+euro/i.test(folded);
}

function maybeCorrectFooterUnit(folded, unit, footerQty) {
  if (unit === 'paleti' && footerPaletiIsMisreadGaleti(folded, footerQty)) return 'galeti';
  return unit;
}

/** Footer label `Numărul de găleți` / `Numarul de saci` without requiring the total figure. */
function packagingFooterUnit(folded) {
  // Prefer the total parser when the figure is present — it already corrects paleți→găleți (#82).
  const withQty = packagingFooterTotal(folded);
  if (withQty?.unit) return withQty.unit;
  const labelled = folded.match(new RegExp(`num[ae]r(?:ul)?\\s+de\\s+${GOODS_UNIT_SOURCE}`, 'i'));
  if (!labelled) return null;
  return maybeCorrectFooterUnit(folded, goodsUnitOf(labelled[1]), null);
}

/**
 * Printed Baumit/Montaro tables count buckets as `buc` and bags as `sac`.
 * The TRO expedition summary often omits `Numărul de găleți`; without this, Tip marfă
 * stays empty and the list writes "72 bucati" (#57). A lone `Cantitate N buc` with no
 * table still stays `bucati` for review.
 *
 * Mixed sac+buc sheets (#62) are handled separately — `buc` still means găleți there,
 * but Tip/Cantitate must keep both units, so this helper stays false when bags are present.
 */
function bucLinesMeanGaleti(folded) {
  if (packagingFooterUnit(folded)) return false;
  if (new RegExp(`\\d[\\d.,]*\\s*sac(?:i)?\\b`, 'i').test(folded)) return false;
  if (!new RegExp(`\\d[\\d.,]*\\s*buc(?:ati)?\\b`, 'i').test(folded)) return false;
  if (/\(\s*24\s*\/\s*pal/i.test(folded)) return true;
  if (/palet\s+euro|\d[\d.,]*\s*pce\b/i.test(folded)) return true;
  if (/\b(?:unibaza|silikotop|finolux|finishpro|hidrostop|superprimer|betonk[o0]ntakt|grund|primer|glet|vopsea)\b/i.test(folded)) {
    return true;
  }
  return /\b(?:tro|psl)[\s\-._/]*\d/i.test(folded) && /\b11\d{5,7}\b/.test(folded);
}

/**
 * On a sheet that prints both bags and buckets, `buc` is găleți (#62).
 * Pure buc sheets still go through `bucLinesMeanGaleti`.
 */
function remapBucToGaleti(lines, folded) {
  const hasSaci = lines.some((l) => l.unit === 'saci');
  const hasBuc = lines.some((l) => l.unit === 'bucati');
  const asGaleti = (hasSaci && hasBuc) || bucLinesMeanGaleti(folded);
  if (!asGaleti) return lines;
  return lines.map((l) => (
    l.unit === 'bucati'
      ? { ...l, unit: 'galeti', rank: GOODS_UNIT_RANK.galeti }
      : l
  ));
}

function inferBucAsGaleti(folded, found) {
  if (!found?.value || typeof found.value !== 'object') return found;
  if (found.value.unit !== 'bucati' || !bucLinesMeanGaleti(folded)) return found;
  return result(
    { quantity: found.value.quantity, unit: 'galeti' },
    Math.max(found.confidence, 0.8),
    found.matched,
  );
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
    const unitRawNorm = goodsUnitOf(unitRaw);
    const value = parseNumber(numRaw);
    if (unitRawNorm && value != null && isPlausibleQuantity(value, unitRawNorm)) {
      const unit = maybeCorrectFooterUnit(folded, unitRawNorm, value);
      if (!isPlausibleQuantity(value, unit)) continue;
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

  // Prefer the same line inventory as extractQuantity so Tip and Cantitate agree (#62 / #76).
  const remapped = remapBucToGaleti(collectPackagingLines(folded), folded);
  const goods = remapped.filter((l) => l.unit === 'saci' || l.unit === 'galeti');
  const hasSaci = goods.some((l) => l.unit === 'saci');
  const hasGaleti = goods.some((l) => l.unit === 'galeti');
  if (hasSaci && hasGaleti) {
    return result(MIXED_SAC_GALETI, 0.85, goods.map((l) => l.matched).join(' + '));
  }
  // Bags or buckets alone beat the "N pal" package column (and euro-pallet pce).
  if (hasSaci) {
    return result('saci', 0.85, goods.map((l) => l.matched).join(' + '));
  }
  if (hasGaleti) {
    return result('galeti', 0.85, goods.map((l) => l.matched).join(' + '));
  }
  const volume = remapped.find((l) => l.unit === 'm3');
  if (volume) {
    return result(publicGoodsUnit('m3'), 0.85, volume.matched);
  }

  let best = null;
  const re = new RegExp(`(\\d[\\d.,]*)${QTY_UNIT_GAP}${GOODS_UNIT_SOURCE}\\b`, 'gi');
  let match = re.exec(folded);
  while (match) {
    const unit = goodsUnitOf(match[2]);
    const rank = GOODS_UNIT_RANK[unit] ?? 0;
    // Article codes like `11000001 Palet Euro returnabil` are not a pallet count.
    const n = parseNumber(match[1]);
    if (unit === 'paleti' && n != null && n >= 1000) {
      match = re.exec(folded);
      continue;
    }
    // Bare `pce` is not a tip by itself — only when it is the whole load (#64).
    if (!unit || String(match[2] || '').toLowerCase() === 'pce') {
      match = re.exec(folded);
      continue;
    }
    if (!best || rank > best.rank) best = { unit, rank, matched: match[0] };
    match = re.exec(folded);
  }
  if (!best) {
    // Retur paleți goi: only `15.00 pce` on the page (#64).
    if (collectEuroPalletPceLines(folded).length) {
      return result('paleti', 0.8, 'pce');
    }
    // Same night-wash path as extractQuantity: net ÷ bag kg → tip saci (#76).
    const fromBag = quantityFromNetAndBagSize(String(text || ''), folded);
    if (fromBag?.value?.unit === 'saci') {
      return result('saci', 0.55, fromBag.matched);
    }
    return NO_MATCH;
  }
  if (best.unit === 'bucati' && bucLinesMeanGaleti(folded)) {
    return result('galeti', 0.8, best.matched);
  }
  // A bare count is the weakest thing a document can say, so it is offered for review rather
  // than written unattended.
  return result(publicGoodsUnit(best.unit), best.rank > 1 ? 0.8 : 0.4, best.matched);
}

/**
 * Packaging word inside a longer OCR slice (`TIP MARFA GALETI 15,744` → `galeti`).
 * Ranked like extractGoodsUnit so găleți beats a bare „buc” on the same line.
 */
export function packagingWordIn(text) {
  const folded = foldUnit(text);
  if (!folded) return null;
  if (/saci\s*\/\s*galeti|galeti\s*\/\s*saci/.test(folded)) return MIXED_SAC_GALETI;
  let best = null;
  const re = new RegExp(`\\b${GOODS_UNIT_SOURCE}\\b`, 'gi');
  let match = re.exec(folded);
  while (match) {
    const unit = goodsUnitOf(match[1]);
    const rank = GOODS_UNIT_RANK[unit] ?? 0;
    if (unit && (!best || rank > best.rank)) best = unit;
    match = re.exec(folded);
  }
  return best ? publicGoodsUnit(best) : null;
}

/**
 * True when Tip marfă looks like a whole product / table row, not saci|găleți|….
 * Those dumps came from `goodsField` grabbing the MPI line; repair must not keep them.
 */
export function looksLikeOcrGoodsDump(tip) {
  const s = String(tip || '').trim();
  if (!s) return false;
  if (goodsUnitOf(s) && s.length <= 12) return false;
  if (s.length > 24) return true;
  if (/\b(mpi|mp[il1])\b/i.test(s)) return true;
  if (/\d[\d.,]*\s*kg\b/i.test(s)) return true;
  if (/[|]/.test(s)) return true;
  if (/\b\d{6,}\b/.test(s)) return true;
  return false;
}

/** Packaging units that name goods (not bare "buc" / euro-pallet "pce"). */
const SUMMABLE_PACKAGING = new Set(['saci', 'galeti', 'paleti', 'm3']);

/** Push one packaging hit into `lines` when qty/unit are plausible. */
function pushPackagingLine(lines, qtyRaw, unitRaw, matched) {
  const rawUnit = String(unitRaw || '').toLowerCase();
  if (rawUnit === 'pce') return;
  const unit = goodsUnitOf(rawUnit);
  const qty = parseNumber(qtyRaw);
  // `11000001 Palet` is the euro-pallet article row, not 11 million paleți.
  if (unit === 'paleti' && qty != null && qty >= 1000) return;
  if (unit && qty != null && isPlausibleQuantity(qty, unit)) {
    lines.push({ qty, unit, rank: GOODS_UNIT_RANK[unit] ?? 0, matched });
  }
}

/** Count every packaging `N unit` / `Cantitate N unit` pair on the page. */
function collectPackagingLines(folded) {
  const lines = [];
  // Labelled product rows and bare "48.00 buc" / "270.00 sac" / "28.80 m3" alike.
  // Euro-pallet `pce` is skipped here: returnable packaging beside real goods (#63).
  // When `pce` is the *only* line (retur paleți), see collectEuroPalletPceLines (#64).
  // Same-line gap only — see QTY_UNIT_GAP (#63).
  const re = new RegExp(
    `(?:(?:cantitate|quantity)\\s*[:\\-]?\\s*)?([\\d.,]+)${QTY_UNIT_GAP}${GOODS_UNIT_SOURCE}\\b`,
    'gi',
  );
  let match = re.exec(folded);
  while (match) {
    pushPackagingLine(lines, match[1], match[2], match[0]);
    match = re.exec(folded);
  }

  // Night / table OCR often puts the figure and the unit on consecutive lines
  // (`210.00\nsac` or `| 210.00 |\n| sac |`). Same-line-only matching then misses
  // the bags and falls through to empty tip/cantitate (#76). Do not use open `\s`
  // between a digit and a unit on one line — that is what made `28.80 m3\nPalet`
  // invent "3 paleți" (#63).
  const cross = new RegExp(
    `([\\d.,]+)\\s*(?:\\|\\s*)?\\n\\s*(?:\\|\\s*)?(${GOODS_UNIT_SOURCE})\\b`,
    'gi',
  );
  let crossMatch = cross.exec(folded);
  while (crossMatch) {
    pushPackagingLine(lines, crossMatch[1], crossMatch[2], crossMatch[0]);
    crossMatch = cross.exec(folded);
  }

  return collapseDoubledPackagingLines(lines, folded);
}

/**
 * `N pce` euro-pallet rows. Ignored when the page also has saci/găleți/m³;
 * on a pallet-only return they *are* the goods (#64).
 */
function collectEuroPalletPceLines(folded) {
  const lines = [];
  const re = new RegExp(`([\\d.,]+)${QTY_UNIT_GAP}pce\\b`, 'gi');
  let match = re.exec(folded);
  while (match) {
    const qty = parseNumber(match[1]);
    // One truck of empty returns, not an article code mistaken for a count.
    if (qty != null && qty > 0 && qty < 500 && isPlausibleQuantity(qty, 'paleti')) {
      lines.push({
        qty,
        unit: 'paleti',
        rank: GOODS_UNIT_RANK.paleti,
        matched: match[0],
      });
    }
    match = re.exec(folded);
  }
  return collapseDoubledPackagingLines(lines, folded);
}

/** Quantity when the aviz is only empty-pallet return (`15.00 pce`, no other goods). */
function quantityFromPalletsOnly(folded, blob) {
  const pceOnly = collectEuroPalletPceLines(folded);
  if (!pceOnly.length) return null;
  const sum = Math.round(pceOnly.reduce((acc, l) => acc + l.qty, 0) * 100) / 100;
  if (!isPlausibleQuantity(sum, 'paleti') || isWeightMistakenForQuantity(sum, 'paleti', blob)) {
    return null;
  }
  return result(
    { quantity: sum, unit: 'paleti' },
    0.86,
    pceOnly.map((l) => l.matched).join(' + '),
  );
}

/**
 * When night/yellow OCR drops "sac" but the page still has net weight and a bag size
 * (`Tencuiala TM 40 kg` → 40), bags ≈ net / bag kg. Only cement-style bag sizes (25/35/40),
 * not 20 kg bucket lines (#76). Low confidence → HITL.
 */
function quantityFromNetAndBagSize(blob, folded) {
  const net = extractNetWeight(blob)?.value;
  if (net == null || !Number.isFinite(net) || net < LOAD_WEIGHT_MIN_KG) return null;
  // Prefer bag-cement vocabulary; alone, 25/35/40 kg on a product row is enough.
  const bagProduct = /\b(?:tencuiala|adeziv|beton|nivela|mpx|mpi\b|flexbond|montaro)\b/i.test(folded);
  const sizes = [];
  const re = /\b(\d{2})\s*kg\b/gi;
  let m;
  while ((m = re.exec(folded)) !== null) {
    const n = parseNumber(m[1]);
    if (n === 25 || n === 35 || n === 40) sizes.push(n);
  }
  if (!sizes.length) return null;
  if (!bagProduct && sizes.length < 2) return null;
  // Mode of bag sizes on the sheet.
  const freq = new Map();
  for (const s of sizes) freq.set(s, (freq.get(s) || 0) + 1);
  let bag = sizes[0];
  let best = 0;
  for (const [s, c] of freq) {
    if (c > best) {
      best = c;
      bag = s;
    }
  }
  const raw = net / bag;
  const qty = Math.round(raw);
  if (Math.abs(raw - qty) > 0.05) return null;
  if (!isPlausibleQuantity(qty, 'saci') || isWeightMistakenForQuantity(qty, 'saci', blob)) {
    return null;
  }
  return result(
    { quantity: qty, unit: 'saci' },
    0.55,
    `net ${net} / ${bag} kg`,
  );
}

/**
 * OCR+layer merge (and some Mistral tables) repeat the whole packaging list twice.
 * `[72, 72]` → 144 on a one-SKU sheet; `[48,72, …, 48,72, …]` → double the footer total.
 * A perfect mirror of the first half is that echo — keep the first half only.
 */
function collapseDoubledPackagingLines(lines, folded) {
  if (lines.length < 2 || lines.length % 2 !== 0) return lines;
  const half = lines.length / 2;
  const head = lines.slice(0, half);
  const tail = lines.slice(half);
  const mirrored = head.every((l, i) => l.qty === tail[i].qty && l.unit === tail[i].unit);
  if (!mirrored) return lines;
  if (half >= 2) return head;
  // Two identical counts: collapse only on a short article list (goods + euro pallet).
  // Count distinct codes — an echoed page lists the same two SKUs twice.
  const articles = new Set(String(folded || '').match(/\b\d{7,8}\b/g) || []).size;
  return articles <= 2 ? head : lines;
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
  let found = inferBucAsGaleti(folded, extractQuantityCore(blob, folded));
  const { present, folded: correctionFolded } = detectHandCorrection(blob);
  if (!present || !found?.value || typeof found.value !== 'object') return found;

  const hand = handwrittenQuantityOverride(
    correctionFolded,
    found.value.quantity,
    found.value.unit,
  );
  if (hand != null) {
    return result(
      { quantity: hand, unit: found.value.unit },
      0.55,
      `hand-correction-qty:${hand}`,
    );
  }
  // Phrase seen but no alternate figure in OCR — keep printed value, force review via confidence.
  return withHandCorrectionConfidence(found);
}

function extractQuantityCore(blob, folded) {
  const footer = packagingFooterTotal(folded);
  if (
    footer
    && !isWeightMistakenForQuantity(footer.quantity, footer.unit, blob)
  ) {
    return result(
      { quantity: footer.quantity, unit: publicGoodsUnit(footer.unit) },
      0.95,
      footer.matched,
    );
  }

  const footerUnit = packagingFooterUnit(folded);
  const lines = collectPackagingLines(folded);

  // Footer label seen (tip = găleți) but the figure failed OCR: sum product lines instead of
  // grabbing the first `48 buc`. Report the footer unit so Tip marfă and Cantitate agree.
  if (footerUnit && lines.length >= 2) {
    const sum = Math.round(lines.reduce((acc, l) => acc + l.qty, 0) * 100) / 100;
    if (
      isPlausibleQuantity(sum, footerUnit)
      && !isWeightMistakenForQuantity(sum, footerUnit, blob)
    ) {
      return result(
        { quantity: sum, unit: publicGoodsUnit(footerUnit) },
        0.86,
        lines.map((l) => l.matched).join(' + '),
      );
    }
  }

  // One goods line + euro-pallet `pce` (SuperPrimer): the line is the whole load. Without
  // `pce`, a lone `48 buc` under a găleți footer is usually OCR that missed the other rows (#42).
  if (footerUnit && lines.length === 1 && /\d[\d.,]*\s*pce\b/i.test(folded)) {
    const pick = lines[0];
    if (
      isPlausibleQuantity(pick.qty, footerUnit)
      && !isWeightMistakenForQuantity(pick.qty, footerUnit, blob)
    ) {
      return result(
        { quantity: pick.qty, unit: publicGoodsUnit(footerUnit) },
        0.84,
        pick.matched,
      );
    }
  }

  if (!lines.length) {
    // Pallet-only return: `Palet Euro returnabil 15.00 pce` — pce was skipped above (#64).
    const palletsOnly = quantityFromPalletsOnly(folded, blob);
    if (palletsOnly) return palletsOnly;
    // Yellow / night wash drops "sac" but leaves net kg + bag size on the product line (#76).
    const fromBag = quantityFromNetAndBagSize(blob, folded);
    if (fromBag) return fromBag;

    // Labelled quantity that carries no packaging word (rare), still better than nothing.
    const labelled = foldUnit(blob).match(
      /(?:cantitate|quantity)\s*[:\-]?\s*([\d.,]+)\s*(kg|to?ne?|mc|m3)?\b/i,
    );
    if (labelled) {
      const value = parseNumber(labelled[1]);
      const rawUnit = labelled[2] || null;
      const unit = rawUnit ? publicGoodsUnit(goodsUnitOf(rawUnit) || foldUnit(rawUnit)) : null;
      // Reject bare kg/t here when the label was only "Cantitate" next to a weight — those
      // belong to extractGrossWeight. A quantity in kg is allowed only with an explicit unit.
      // Also refuse a "Cantitate … kg" that is really the weighbridge figure (column scramble
      // on Baumit: Cantitate header lands on 1.551,00 kg / 1550.998).
      if (
        unit
        && value != null
        && isPlausibleQuantity(value, unit)
        && !isWeightMistakenForQuantity(value, unit, blob)
      ) {
        return result({ quantity: value, unit }, 0.75, labelled[0]);
      }
    }
    return NO_MATCH;
  }

  // sac + buc/găleți on the same aviz: sum both, tip = saci/galeti, skip euro-pallet (#62).
  const remapped = remapBucToGaleti(lines, folded);
  const mixedGoods = remapped.filter((l) => l.unit === 'saci' || l.unit === 'galeti');
  const mixedHasSaci = mixedGoods.some((l) => l.unit === 'saci');
  const mixedHasGaleti = mixedGoods.some((l) => l.unit === 'galeti');
  if (mixedHasSaci && mixedHasGaleti && mixedGoods.length >= 2) {
    const sum = Math.round(mixedGoods.reduce((acc, l) => acc + l.qty, 0) * 100) / 100;
    if (
      isPlausibleQuantity(sum, MIXED_SAC_GALETI)
      && !isWeightMistakenForQuantity(sum, MIXED_SAC_GALETI, blob)
    ) {
      return result(
        { quantity: sum, unit: MIXED_SAC_GALETI },
        0.88,
        mixedGoods.map((l) => l.matched).join(' + '),
      );
    }
  }

  const bestRank = Math.max(...remapped.map((l) => l.rank));
  const topUnit = remapped.find((l) => l.rank === bestRank)?.unit;
  const top = remapped.filter((l) => l.unit === topUnit);

  if (top.length >= 2 && (SUMMABLE_PACKAGING.has(topUnit) || topUnit === 'bucati')) {
    const sum = Math.round(top.reduce((acc, l) => acc + l.qty, 0) * 100) / 100;
    if (isPlausibleQuantity(sum, topUnit) && !isWeightMistakenForQuantity(sum, topUnit, blob)) {
      return result(
        { quantity: sum, unit: publicGoodsUnit(topUnit) },
        0.88,
        top.map((l) => l.matched).join(' + '),
      );
    }
  }

  // Packaging footer label without a readable total + only one product line in OCR:
  // do not write that line as Cantitate (classic photo miss: 48 instead of 576) — unless
  // the euro-pallet row above already proved this is a one-SKU sheet.
  if (footerUnit && !/\d[\d.,]*\s*pce\b/i.test(folded)) return NO_MATCH;

  const pick = top[0];
  if (isWeightMistakenForQuantity(pick.qty, pick.unit, blob)) return NO_MATCH;
  return result(
    { quantity: pick.qty, unit: publicGoodsUnit(pick.unit) },
    pick.rank > 1 ? 0.9 : 0.8,
    pick.matched,
  );
}

/**
 * True when a candidate "quantity" is the gross (or net) weight wearing the wrong label.
 * Seen on SuperPrimer / TRO sheets: Cantitate reads 1550.998 while the page says 72.00 buc
 * and Greutate brută 1.551,00 kg.
 */
function isWeightMistakenForQuantity(value, unit, blob) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return false;
  const u = foldUnit(unit);
  const weightUnit = u === 'kg' || u === 'kgs' || u.startsWith('ton') || u === 't' || u === 'to';
  // Packaging counts on the page always beat a kg "Cantitate".
  if (weightUnit && pageHasPackagingCount(foldUnit(blob))) return true;
  const gross = extractGrossWeight(blob)?.value;
  const net = extractNetWeight(blob)?.value;
  for (const w of [gross, net]) {
    if (w == null || !Number.isFinite(Number(w)) || Number(w) <= 0) continue;
    if (Math.abs(n - Number(w)) / Number(w) <= 0.02) return true;
  }
  return false;
}

function pageHasPackagingCount(folded) {
  if (packagingFooterUnit(folded)) return true;
  return new RegExp(`\\d[\\d.,]*\\s*${GOODS_UNIT_SOURCE}\\b`, 'i').test(folded);
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

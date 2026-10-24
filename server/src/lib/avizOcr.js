/**
 * Extract + parse Baumit-style avize (PSL sales and TRO transfer).
 * Text parsing only. Reading a file is the profile extractor's job (lib/ocr/readText.js).
 */
import { annexFieldDefaults, normalizeGoodsUnit } from './avizTemplate.js';
import {
  canonicalPlate,
  extractDate,
  extractGrossWeight,
  extractNetWeight,
  extractQuantity,
  isAcceptableAutoField,
  isGenericCountUnit,
  isPlausibleQuantity,
  looksLikeOcrGoodsDump,
  packagingWordIn,
  parseNumber,
} from './ocr/fields.js';
import { DEFAULT_BANDS, fieldMeta } from './ocr/avizFieldSchema.js';

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // OCR ș/șt→$ (Balote$i ← Balotești) — must not stay as a dollar in Rută.
    .replace(/([aeiou])\$i\b/g, '$1sti')
    .replace(/\$/g, 's')
    .replace(/ș|ş|Ș|Ş/g, 's')
    .replace(/ț|ţ|Ț|Ţ/g, 't')
    .toLowerCase();
}

function normalizeWs(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Prefer the aviz datetime (11.08.2026 13:10), not a split "1 1.08.2026". */
function findAvizDate(blob) {
  // Same path as OCR profiles (#110): year digit repair, spaced tokens, labelled gap.
  return extractDate(blob)?.value || null;
}

/** @deprecated prefer canonicalPlate — kept for callers that expect a string[]. */
export function extractPlates(value) {
  const normalized = normalizePlate(value);
  if (!normalized) return [];
  return normalized.split(/\s*\/\s*/).filter(Boolean);
}

/** Tractor / trailer (RO + foreign EU): `CA 4471 KX / B 63 RTX` → both, tractor first (#60). */
export function normalizePlate(value) {
  const plates = canonicalPlate(value);
  if (plates && isAcceptableAutoField(plates)) return plates;
  return null;
}

/** Synthetic office/driver fixtures, not RO format, but intentional and short. */
function syntheticLabeledPlate(labeled) {
  const text = normalizeWs(labeled).toUpperCase();
  if (!text) return null;
  const multi = [...text.matchAll(/\bB\s+TEST\s+\d{1,4}\b/g)].map((m) => m[0].replace(/\s+/g, ' '));
  if (multi.length) return multi.join(' / ');
  const single = text.match(/\bTEST[-\s]?\d{1,6}\b/);
  if (single) return single[0].replace(/\s+/g, '').replace(/^TEST(\d)/, 'TEST-$1');
  return null;
}

function labeledPlateWindow(folded) {
  const labels = ['placuta de inmatriculare', 'numar auto'];
  let start = -1;
  let labelLen = 0;
  for (const label of labels) {
    const i = folded.indexOf(label);
    if (i >= 0 && (start === -1 || i < start)) {
      start = i;
      labelLen = label.length;
    }
  }
  if (start < 0) return null;
  const from = start + labelLen;
  let end = Math.min(folded.length, from + 80);
  for (const stop of ['nume delegat', 'nume sofer', 'telefon', 'ekaer', 'pozitii', 'descriere', 'nr ']) {
    const i = folded.indexOf(stop, from);
    if (i > from && i < end) end = i;
  }
  return folded.slice(from, end).replace(/^[\s:]+/, '').trim();
}

function findPlates(blob) {
  const folded = fold(blob);
  const labeled = labeledPlateWindow(folded);
  const search = labeled == null ? folded : labeled;
  const plates = normalizePlate(search);
  if (plates) return plates;
  // Never dump the labelled window as-is: OCR often glues bookmark/UI noise onto a partial
  // plate ("330 SRS FOOTY STREAM TRANSPORTATOR"). Empty + review beats a poisoned Excel cell.
  if (labeled) return syntheticLabeledPlate(labeled);
  return null;
}

function pickRegex(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return normalizeWs(m[1]);
  }
  return null;
}

function normalizeDocNo(value) {
  if (!value) return null;
  const upper = String(value).toUpperCase();
  // Accept OCR letter digits (`TRO-OOI 1300` → TRO-0011300), same as splitPdf.
  // Capture the body separately so the O in „TRO” is never rewritten to 0.
  const m = upper.match(/\b(PSL|TRO)[-.\s]*([0-9OI]{3,14}(?:[ \t\-]+[0-9OI]{2,10})?)/);
  if (m) {
    const digits = m[2].replace(/O/g, '0').replace(/I/g, '1').replace(/[^\d]/g, '');
    if (digits.length >= 4) return `${m[1]}-${digits}`;
  }
  const testAvz = upper.match(/\b(TEST-AVZ[-.\s]*\d+)\b/);
  if (testAvz) return testAvz[1].replace(/\s+/g, '');
  return null;
}

/**
 * Normalises a TPO number to `TPO-<digits>`.
 *
 * The whole identifier is kept, including any sequence that follows a year. Matching only the
 * first run of digits turned every `TPO 2026-0311` of a year into the same `TPO-2026`: on a
 * report that collapses distinct trips onto one identifier and makes the annex's key column
 * useless, and it fires the duplicate-TPO warning on a perfectly clean selection.
 */
/**
 * Baumit / RAI TPO identifiers are zero-padded to 7 digits (`TPO-0032755`).
 * Handwritten `TPO/32755` (4–5 digits) must land the same way, or duplicates miss (#55).
 * Six-digit values are left short: they usually mean a truncated 7-digit OCR read and stay
 * in review rather than looking valid after a wrong pad. Compound year forms
 * (`TPO-2026-0311`) keep their structure.
 */
export const TPO_CODE_DIGITS = 7;

export function normalizeTpo(value, minDigits = 1) {
  if (!value) return null;
  const n = Number(minDigits) >= 1 ? Number(minDigits) : 1;
  // `/` is common on handwritten notes ("TPO / 31027") next to a blank printed field.
  const m = String(value).toUpperCase().match(new RegExp(`TPO[\\s\\-./:]*(\\d{${n},}(?:[-/.]\\d+)*)`));
  if (!m) return null;
  const body = m[1].replace(/[/.]/g, '-');
  if (body.includes('-')) return `TPO-${body}`;
  const digits = body.replace(/\D/g, '');
  if (digits.length < n) return null;
  // 4–5 digit shorthand (handwritten) → pad. 6-digit stays short for HITL (likely truncated).
  const padded = (digits.length >= 4 && digits.length <= 5)
    ? digits.padStart(TPO_CODE_DIGITS, '0')
    : digits;
  return `TPO-${padded}`;
}

function findTpoNumber(blob) {
  return normalizeTpo(blob, 4);
}

function isExtractedGarbageTpo(value) {
  const s = String(value || '').trim();
  if (!s) return true;
  // Anything that is not a real TPO (Reg. Com. "0000/2000", product names, …) is noise (#58).
  return !normalizeTpo(s, 1);
}

function resolveStoredTpo(row, parsed) {
  const stored = String(row?.numar_tpo || '').trim();
  const storedNorm = normalizeTpo(stored, 1);
  if (storedNorm) return storedNorm;
  const parsedNorm = normalizeTpo(parsed?.numar_tpo, 1);
  if (parsedNorm) return parsedNorm;
  // Do not keep footer leftovers on the row — leave empty for HITL (#58).
  return null;
}

function parseQty(blob) {
  // Same rules as live OCR (`extractQuantity`): footer `Numărul de găleți` first, then sum
  // of packaging lines — never the first product row alone on a multi-line transfer.
  const found = extractQuantity(blob);
  const packed = found?.value;
  if (!packed || typeof packed !== 'object') return null;
  const qty = Number(packed.quantity);
  const tip = normalizeGoodsUnit(packed.unit) || String(packed.unit || '').toLowerCase() || 'saci';
  if (!Number.isFinite(qty) || !isPlausibleQuantity(qty, tip)) return null;
  const rank = (tip === 'saci/galeti' || tip === 'saci / galeti' || tip === 'saci / bucati') ? 6
    : tip === 'm³' || tip === 'm3' || tip === 'mc' ? 5
      : tip === 'galeti' ? 4
        : tip === 'saci' ? 3
          : tip === 'paleti' ? 2
            : 1;
  return { qty, tip, rank };
}

function prettyPlace(value) {
  const parts = fold(value).split(/[^a-z]+/).filter((p) => p.length >= 2);
  if (!parts.length) return null;
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function formatHouseNumber(number) {
  let s = String(number || '').replace(/\s+/g, '');
  if (!s) return '';
  // Baumit prints "nr. 1F"; OCR often yields "IF" / "LF".
  if (/^[il]([a-z])$/i.test(s)) s = `1${s.slice(-1)}`;
  return s.replace(/[a-z]+/g, (m) => m.toUpperCase());
}

function compactStreet(name, number) {
  const street = prettyPlace(name);
  if (!street) return null;
  const num = formatHouseNumber(number);
  return num ? `${street}${num}` : street;
}

/** Find a multi-word label even when OCR/PDF emits one word per line. */
function findFoldedLabel(folded, label) {
  const pattern = fold(label).trim().replace(/\s+/g, '\\s+');
  if (!pattern) return null;
  const m = folded.match(new RegExp(pattern));
  if (!m || m.index == null) return null;
  return { index: m.index, length: m[0].length };
}

/**
 * Labels that share the Baumit heading row with "Adresa de livrare" (right column).
 * Only these may be ignored when they sit on the first heading line — never section
 * boundaries like "adresa de livrare" itself (that used to let Expeditor swallow the
 * delivery street on one-line OCR).
 */
const HEADING_ROW_COMPANIONS = new Set([
  'referinta client',
  'referinta clientului',
  'referință client',
  'referință clientului',
  // Baumit prints "Adresa de livrare | Client" on one heading row — right header only.
  'client',
]);

/**
 * Bare "Client" column header (right of Adresa de livrare). Not "referința client",
 * not "client factură" (those have their own stops). Word-boundary only.
 */
function standaloneClientHeaderIndex(folded, from, protectUntil) {
  const slice = folded.slice(from);
  // Bare column header only (`Client` / `Client:` / `Client\t…`).
  // Do NOT treat a company name like "Client Timisoara SRL" as the header —
  // that used to truncate Adresa de livrare before the street on PDF extracts.
  const re = /(?:^|[\n\t])client(?!\s+factur)(?=\s*(?:$|\t|:|\n))/g;
  let m;
  while ((m = re.exec(slice)) !== null) {
    const lead = m[0].match(/^[\n\t]/) ? 1 : 0;
    const abs = from + m.index + lead;
    if (abs < protectUntil) continue;
    const before = fold(folded.slice(Math.max(0, abs - 28), abs));
    if (/referint[aă]?\s*$/.test(before)) continue;
    return abs;
  }
  return -1;
}

/**
 * @param {string} blob
 * @param {string[]} startLabels
 * @param {string[]} stopLabels
 * @param {{ stopAtClientHeader?: boolean }} [opts]
 *   `stopAtClientHeader` only for Adresa de livrare — never for Expeditor. OCR often
 *   emits the right-column "Client" header before the left-column Site/street lines;
 *   cutting Expeditor there dropped the origin and left only the delivery leg in Rută.
 */
function sliceSection(blob, startLabels, stopLabels, { stopAtClientHeader = false } = {}) {
  const folded = fold(blob);
  let start = -1;
  let labelLen = 0;
  for (const label of startLabels) {
    const hit = findFoldedLabel(folded, label);
    if (hit && (start === -1 || hit.index < start)) {
      start = hit.index;
      labelLen = hit.length;
    }
  }
  if (start < 0) return '';
  const from = start + labelLen;
  // Companion column headers on the same row as the start label must not truncate the
  // address lines below. Cap the window at the first newline (or ~80 chars) — never at
  // a street that may belong to the *next* section.
  //
  // PDF extractors (and some OCR) often put "Adresa de livrare" and "Client" on two
  // consecutive lines with no tab — treat a lone following "client" as the heading
  // companion, not as the end of the delivery block.
  const rest = folded.slice(from);
  let protectUntil = from + Math.min(rest.length, 80);
  const firstNl = rest.indexOf('\n');
  if (firstNl >= 0) {
    protectUntil = from + firstNl + 1;
    if (stopAtClientHeader) {
      const afterHeading = folded.slice(protectUntil);
      const loneClient = afterHeading.match(/^\s*client(?!\s+factur)(?=\s|$|\t|:)/);
      if (loneClient) {
        const afterClient = afterHeading.slice(loneClient[0].length);
        const nextNl = afterClient.indexOf('\n');
        protectUntil += loneClient[0].length + (nextNl >= 0 ? nextNl + 1 : 0);
      }
    }
  }
  let end = folded.length;
  for (const stop of stopLabels) {
    const hit = findFoldedLabel(folded.slice(from), stop);
    if (!hit) continue;
    const abs = from + hit.index;
    const stopFold = fold(stop);
    if (HEADING_ROW_COMPANIONS.has(stopFold) && abs < protectUntil) continue;
    if (abs < end) end = abs;
  }
  // Right-column "Client" ends Adresa de livrare only (delivery slice).
  if (stopAtClientHeader) {
    const clientAt = standaloneClientHeaderIndex(folded, from, protectUntil);
    if (clientAt >= 0 && clientAt < end) end = clientAt;
  }
  return folded.slice(from, end);
}

/** Grammatical noise — never a locality. No town/street whitelist. */
const LOCALITY_NOISE = /^(rou|ro|romania|sector|site|depozite?|nr|numar|str|strada|sosea|soseaua|sos|bvd|blvd|aleea|al|piata|pta|calea|pagina|client|produs|cantitate|denumire|ilfov)$/;

/**
 * Romanian county plate codes (2 letters) and OCR stubs ("I" from "IF") — printed after
 * the town before RO ##### (e.g. `Balotesti IF RO 077040`). Never a locality name.
 */
const COUNTY_OR_STUB = /^(i|b|ab|ag|ar|bc|bh|bn|br|bt|bv|bz|cj|cl|cs|ct|cv|db|dj|gj|gl|gr|hd|hr|if|il|is|mh|mm|ms|nt|ot|ph|sb|sj|sm|sv|tl|tm|tr|vl|vn|vs)$/;

/** True when a folded token can be the town on an aviz address line. */
function isPlausibleLocalityToken(word) {
  const w = fold(word).replace(/[,.]+$/g, '');
  if (!w || w.length < 3) return false;
  if (LOCALITY_NOISE.test(w) || STREET_NAME_STOP.test(w) || COUNTY_OR_STUB.test(w)) return false;
  return true;
}

/** Second street-name token stops here (grammatical), not at town names — towns vary. */
const STREET_NAME_STOP = /^(nr|numar|sector|ro|rou|romania|produs|cantitate|denumire|um)$/;

/**
 * Goods-table headers that sit under Adresa de livrare / Ruta on Baumit PDFs (#70).
 * When OCR collapses few lines, the delivery slice must end here or the route
 * swallows `Produs Cantitate FinoGrande nr. 20`.
 */
const GOODS_TABLE_STOPS = [
  'produs cantitate',
  'produs | cantitate',
  'denumire produs',
  'produs',
  'cantitate',
  'greutate bruta',
  'greutate brută',
  'greutate neta',
  'greutate netă',
];

/**
 * Street-type token. Not a bare substring — `str` inside `DISTRIBUTIE` / `CONSTRUCT`
 * used to become the type and leave `Ibutie Srl` / `Uct Srl` as the street name (#53).
 * Lookarounds (not `\b`) so `str.` still matches before a space (`.` is non-word).
 */
// `Bulevard` (no article) and `Alee` are how Baumit prints them on many sales sheets
// (`Bulevard Camil Ressu`, `Alee Privighetorilor`); without them the parse fell back to the
// type-less matcher and took the client's site name above (`Reabilitare Lohn 60`) for the street.
const STREET_TYPE_RE = /(?<type>(?<![a-z0-9])(?:strada|str\.?|soseaua|sosea|sos\.?|bulevardul|bulevard|bul\.|blvd\.?|bld\.?|bvd\.?|b-dul|bdul|bd\.?|aleea|alee|al\.|piata|pta\.?|calea|intrarea|intrare|intr\.?|splaiul|splai)(?![a-z]))/;

/** Company form before the real street type (`DEMOS INTERMED SRL Intrare Navigatorilor`). */
const COMPANY_FORM_RE = /\b(?:s\.?\s*r\.?\s*l\.?|s\.?\s*a\.?|scs|sra|gmbh|ltd|com)\b/i;

/**
 * Words that make a type-less "name + number" a company / branch / logo, never a street
 * (`BRICO MILITARI 2`, `ROCKWOOL ROMANIA SRL LIV 0-100`, the `Baumit` logo above Expeditor).
 * Used only where the street has no printed type: a printed `Str. Hornbach, nr. 17-21` or
 * `Str. Fabricii` / `Calea Depozitelor` is a street whatever the word (exact tokens only, so
 * `constructorilor` is not `construct`).
 */
const COMPANY_TOKENS = new Set([
  'srl', 'sa', 'snc', 'scs', 'sca', 'pfa', 'gmbh', 'ltd', 'liv', 'client', 'magazin', 'depozit',
  'logistic', 'logistics', 'construct', 'build', 'distributie', 'distribution', 'intermed',
  'renovari', 'baumit', 'montaro', 'brico', 'bricostore', 'dedeman', 'hornbach', 'rockwool',
  'arabesque', 'altex', 'praktiker', 'mathaus', 'leroy', 'merlin', 'obi', 'adeplast', 'romstal',
]);
/** Legal forms: a name next to one is a company even after a street-type word (`CALEA 13 BUILD SRL`). */
const LEGAL_FORM_TOKENS = new Set(['srl', 'sa', 'snc', 'scs', 'sca', 'pfa', 'gmbh', 'ltd']);

function wordTokens(text) {
  return fold(text).replace(/s\.\s*r\.\s*l\.?/g, ' srl ').replace(/s\.\s*a\./g, ' sa ')
    .split(/[^a-z0-9]+/).filter(Boolean);
}
function hasLegalForm(text) {
  return wordTokens(text).some((t) => LEGAL_FORM_TOKENS.has(t));
}
function hasCompanyToken(text) {
  return wordTokens(text).some((t) => COMPANY_TOKENS.has(t));
}

/**
 * Street names that start with a day of a month (`1 Decembrie 1918`, `Calea 13 Septembrie`,
 * `1 Mai`): the number belongs to the name, it is not the house number. Grammar (month names),
 * not a street list.
 */
const MONTH_NAME = String.raw`(?:ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie)`;
const DAY_MONTH_NAME = String.raw`(?:[0-9]{1,2}\s+${MONTH_NAME}(?:\s+(?:18|19|20)[0-9]{2}(?![0-9]))?)`;
const DAY_MONTH_RE = new RegExp(String.raw`(?<![0-9])${DAY_MONTH_NAME}(?![a-z])`, 'g');
const MONTH_TOKEN_RE = new RegExp(`^${MONTH_NAME}$`);

/**
 * House number shape: `31B`, `1F`, OCR `IF`/`LF`, building wing `1/VII` (#89), range `17-21`.
 * At most 4 digits; leading `\b` so a postcode run (`077085`) cannot yield `7085`.
 * Slash + Roman/digit is part of the printed number on Baumit (Pipera nr. 1/VII) — do not
 * stop at the bare digits or the wing is dropped from Rută / zona tax.
 */
// A range (`Calea Giulesti nr. 1-3`, `Str. Hornbach nr. 17-21`) is one printed number; cutting
// it at the dash sent the route to a house that is not on the aviz.
const HOUSE_CORE = String.raw`[0-9]{1,4}[a-z]{0,2}(?:/[0-9ivxlcdm]{1,6}|-[0-9]{1,4}[a-z]?)?|[il]f`;
/**
 * Short words inside a street name (`Pierre de Coubertin`, `Calea lui Traian`). Only between two
 * real words: on their own they are noise, which is what the 3-letter minimum keeps out.
 */
const STREET_NAME_LINK = String.raw`(?:de|la|lui|din)`;
const STREET_NAME_WORD = String.raw`(?:${DAY_MONTH_NAME}|[a-z]{3,})`;
const STREET_NAME_WORDS = String.raw`${STREET_NAME_WORD}(?:\s+(?:${STREET_NAME_LINK}\s+)?${STREET_NAME_WORD}){0,3}`;
const HOUSE_NUM_BODY = String.raw`\b(?:nr\.?\s*)?(?:${HOUSE_CORE})\b`;
const HOUSE_NUM_RE = new RegExp(String.raw`\b(?:nr\.?\s*)?(?<house>${HOUSE_CORE})\b`, 'i');

/**
 * Street line after a type word — name then optional house, or house then name.
 * Structural only: no town / street vocabulary.
 */
// Greedy name stopped by nr / RO / sector / postcode / end — non-greedy would keep only
// the first token and leave "Maniu" behind on `Iuliu Maniu nr. 600A`.
// Lookahead must use the full house pattern: a single `[0-9]\b` fails on `52` (no boundary
// between the two digits) and was why only the number survived as a leg.
const STREET_AFTER_TYPE_NAME_FIRST = new RegExp(
  String.raw`^\s*,?\s*(?<name>${STREET_NAME_WORDS})` +
  // `nr. ~~` (number unreadable) still ends the name: the street is read, its number is not.
  String.raw`(?=\s*(?:,|${HOUSE_NUM_BODY}|\bnr\b|\bro\b|\bsector\b|\d{5}|$))` +
  String.raw`(?:\s*,)?(?:\s*${HOUSE_NUM_RE.source})?`,
  'i'
);
const STREET_AFTER_TYPE_HOUSE_FIRST = new RegExp(
  String.raw`^\s*,?\s*${HOUSE_NUM_RE.source}\s+` +
  String.raw`(?<name>${STREET_NAME_WORDS})` +
  String.raw`(?=\s*(?:,|\bro\b|\bsector\b|\d{5}|$))`,
  'i'
);
/**
 * Name immediately before the type word. Tab OCR often emits `Viilor\t52` then `Șosea\tnr.`
 * so the house sits between name and type — capture it here, not only after the type.
 * Single last token: site leftovers (`obi lohn viilor 52`) must not become the street.
 * Two-word names after a type stay on STREET_AFTER_TYPE_NAME_FIRST (`Iuliu Maniu`).
 */
const STREET_NAME_HOUSE_BEFORE_TYPE = new RegExp(
  String.raw`(?:^|[\s,])(?<name>[a-z]{3,})\s+${HOUSE_NUM_RE.source}\s*$`,
  'i'
);
const STREET_NAME_BEFORE_TYPE = /(?:^|[\s,])(?<name>[a-z]{3,}(?:\s+[a-z]{3,}){0,1})\s*$/i;

function isUsableStreetToken(word, localityFolded = '') {
  if (!word || word.length < 3) return false;
  if (STREET_NAME_STOP.test(word) || LOCALITY_NOISE.test(word)) return false;
  if (/^pagina/i.test(word)) return false;
  if (localityFolded && localityFolded.startsWith(word)) return false;
  return true;
}

const STREET_NAME_LINK_RE = new RegExp(`^${STREET_NAME_LINK}$`);

/** Keep name tokens that are not the locality / grammatical noise (a link word only between two). */
function cleanStreetName(rawName, localityFolded = '') {
  const tokens = fold(rawName).split(/\s+/).filter(Boolean);
  const parts = tokens.filter((tok, i) => {
    // `13 Septembrie`, `1 Decembrie 1918`: the day (and the year) are part of the name.
    if (/^[0-9]{1,2}$/.test(tok)) return MONTH_TOKEN_RE.test(tokens[i + 1] || '');
    if (/^(?:18|19|20)[0-9]{2}$/.test(tok)) return MONTH_TOKEN_RE.test(tokens[i - 1] || '');
    if (STREET_NAME_LINK_RE.test(tok)) {
      return i > 0 && i < tokens.length - 1
        && isUsableStreetToken(tokens[i - 1], localityFolded)
        && isUsableStreetToken(tokens[i + 1], localityFolded);
    }
    return isUsableStreetToken(tok, localityFolded);
  });
  return parts.length ? parts.join(' ') : null;
}

/**
 * Type + name + house from a folded address block. Regex shape only — never a street list.
 */
/**
 * No street type printed: the first `name + number` that is not a company / branch / logo
 * (`BRICO MILITARI 2`, `Baumit` above Expeditor) and whose number is a house number.
 */
function parseLooseStreet(folded, localityFolded) {
  const none = { streetType: null, streetName: null, houseNumber: null };
  const loose = new RegExp(
    // A number running into `.09.2026` / `/10` is the start of a date (OCR-mangled ones survive
    // the date scrub), never a house number. A number with letters glued to a dot (`5tr.`) is a
    // misread `Str.`, not `nr. 5TR`.
    String.raw`\b(?<name>${STREET_NAME_WORD}(?:\s+${STREET_NAME_WORD}){0,3}?)\s+${HOUSE_NUM_RE.source}(?!\s*[.\/]\s*\d)`,
    'gi'
  );
  for (const m of folded.matchAll(loose)) {
    const rawName = m.groups?.name || '';
    const house = m.groups?.house || null;
    if (house && /[a-z]/.test(house) && folded.charAt(m.index + m[0].length) === '.') continue;
    if (hasCompanyToken(rawName)) continue;
    const streetName = cleanStreetName(rawName, localityFolded);
    if (!streetName) continue;
    return { streetType: null, streetName, houseNumber: house ? fold(house) : null };
  }
  return none;
}

/** A typed street whose name is the client firm (`CALEA 13 BUILD SRL`) is not the street. */
function nameAfterTypeIsCompany(afterType) {
  const name = afterType.split(/\bnr\b|,|\bro\b|\d{5,6}/)[0];
  return hasLegalForm(name.trim().split(/\s+/).slice(0, 4).join(' '));
}

function parseStreetParts(folded, localityFolded = '') {
  const typeRe = new RegExp(STREET_TYPE_RE.source, `${STREET_TYPE_RE.flags}g`);
  const typeMatches = [...folded.matchAll(typeRe)];
  // Skip a type word that only introduces the client firm (`Calea 13 Build SRL` above the real
  // `Calea 13 Septembrie nr. 127`), as long as another type follows.
  let typeMatch = typeMatches[0] || null;
  for (let i = 0; i < typeMatches.length - 1; i += 1) {
    const after = folded.slice(typeMatches[i].index + typeMatches[i][0].length);
    if (!nameAfterTypeIsCompany(after)) break;
    typeMatch = typeMatches[i + 1];
  }
  if (!typeMatch) return parseLooseStreet(folded, localityFolded);

  const streetType = typeMatch.groups?.type?.replace(/\.$/, '') || null;
  const afterType = folded.slice(typeMatch.index + typeMatch[0].length);
  let streetName = null;
  let houseRaw = null;

  const nameFirst = afterType.match(STREET_AFTER_TYPE_NAME_FIRST);
  if (nameFirst?.groups?.name) {
    streetName = cleanStreetName(nameFirst.groups.name, localityFolded);
    houseRaw = nameFirst.groups.house || null;
  }
  if (!streetName) {
    const houseFirst = afterType.match(STREET_AFTER_TYPE_HOUSE_FIRST);
    if (houseFirst?.groups?.name) {
      houseRaw = houseFirst.groups.house || null;
      streetName = cleanStreetName(houseFirst.groups.name, localityFolded);
    }
  }
  if (!streetName) {
    const before = folded.slice(0, typeMatch.index);
    const withHouse = before.match(STREET_NAME_HOUSE_BEFORE_TYPE);
    if (withHouse?.groups?.name) {
      streetName = cleanStreetName(withHouse.groups.name, localityFolded);
      if (!houseRaw && withHouse.groups.house) houseRaw = withHouse.groups.house;
    } else {
      const prev = before.match(STREET_NAME_BEFORE_TYPE);
      if (prev?.groups?.name) streetName = cleanStreetName(prev.groups.name, localityFolded);
    }
  }
  if (!streetName) {
    // Scanned sheets put the type word on a line of its own after the street (`Metalurgiei 84-`
    // … `Bulevard nr.`): the one name+number in the block is the street, the type is the one
    // printed. Before `Bulevard` was a type the type-less matcher found it; keep finding it.
    const loose = parseLooseStreet(folded.slice(Math.max(0, typeMatch.index - 60), typeMatch.index), localityFolded);
    if (loose.streetName) return { ...loose, streetType };
  }
  // `nr. ~~` / `nr.Z5-ALeo`: the number is printed but unreadable (symbols, or digits mixed with
  // letters in no house-number shape). Do not borrow another number from nearby (`Sector 6`
  // became `nr. 6`); say so, the route confidence uses it.
  const nrToken = afterType.slice(0, 64).match(/\bnr\b\.?\s*([^\s,.][^\s,]*)/)?.[1] || '';
  const houseUnreadable = Boolean(!houseRaw && streetName && nrToken && (
    /^[^a-z0-9]/.test(nrToken)
    || (/\d/.test(nrToken) && !new RegExp(`^${HOUSE_CORE}\\.?$`).test(nrToken))
  ));
  if (!houseRaw && streetName && !houseUnreadable) {
    // Prefer a house next to the street name / type; never scan past RO/postcode.
    const typeAt = typeMatch.index;
    const nearStreet = folded.slice(Math.max(0, typeAt - 48), Math.min(folded.length, typeAt + typeMatch[0].length + 48))
      // `13 Septembrie` is the name, its 13 is not a house number; nor is the 6 of `Sector 6`.
      .replace(DAY_MONTH_RE, ' ')
      .replace(/\bsector(?:ul)?\s*\d{1,2}\b/g, ' ');
    const beforePost = nearStreet.replace(/\bro\s*\d{5,6}\b[\s\S]*$/i, '').replace(/\b\d{5,6}\b[\s\S]*$/i, '');
    const nrNear = beforePost.match(new RegExp(HOUSE_NUM_RE.source, 'i'));
    if (nrNear?.groups?.house) houseRaw = nrNear.groups.house;
  }

  return {
    streetType,
    streetName,
    houseNumber: houseRaw ? fold(houseRaw) : null,
    ...(houseUnreadable ? { houseUnreadable: true } : {}),
  };
}

/**
 * Romanian postcode from a delivery block: `RO 077190` (under Adresa de livrare, before Client)
 * or bare six digits when the two-column PDF dropped "RO".
 * @returns {string|null} six digits when possible
 */
function postcodeFromSection(folded) {
  const withRo = String(folded || '').match(/\bro\s*(\d{5,6})\b/i);
  if (withRo?.[1]) {
    const digits = withRo[1];
    return digits.length === 6 ? digits : digits.padStart(6, '0');
  }
  const bare = String(folded || '').match(/\b(\d{6})\b/);
  return bare?.[1] || null;
}

/**
 * Settlement implied by a Romanian postcode when the range is unambiguous.
 * București sectors use 01xxxx–06xxxx. Other prefixes are left null so OCR
 * locality wins (Ilfov 07xxxx, county towns, etc.).
 * @returns {string|null} folded locality token, e.g. `bucuresti`
 */
export function localityHintFromPostcode(postcode) {
  const pc = String(postcode || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(pc)) return null;
  const prefix = Number(pc.slice(0, 2));
  if (prefix >= 1 && prefix <= 6) return 'bucuresti';
  return null;
}

/**
 * Prefer postcode settlement when OCR locality is missing or conflicts
 * (e.g. site/street "Timisoara" + RO 061344 under Adresa de livrare).
 * Does not invent towns outside known ranges — those keep the OCR value.
 */
export function resolveLocalityWithPostcode(localityRaw, postcode) {
  const hint = localityHintFromPostcode(postcode);
  if (!hint) return localityRaw || null;
  const loc = fold(localityRaw || '');
  if (!loc) return hint;
  if (/\bbucuresti\b/.test(loc) || /^sector(?:ul)?\s*[1-6]\b/.test(loc)) {
    return localityRaw;
  }
  return hint;
}

/**
 * Last plausible town token in a phrase (skip county `IF` / stub `I` before RO).
 * `Balotesti IF RO 077040` → balotesti, not if.
 */
function lastPlausibleLocality(phrase) {
  const words = fold(phrase).split(/\s+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const tok = words[i].replace(/^[(\[]+|[),\]]+$/g, '');
    // Hyphenated towns: bolintin-deal
    if (isPlausibleLocalityToken(tok)) return withLocalityQualifier(words, i, tok);
  }
  return null;
}

/**
 * Romanian village qualifiers (`Bolintin Deal`, `Bolintin Vale`, `Stefanesti de Jos`) are the
 * second half of a town printed without the hyphen; alone (`Deal`) they are not the town.
 */
const LOCALITY_QUALIFIER = /^(deal|vale|mare|mic|mica|noi|nou|noua|vechi|jos|sus)$/;
function withLocalityQualifier(words, i, tok) {
  if (!LOCALITY_QUALIFIER.test(tok) || i < 1) return tok;
  let j = i - 1;
  let link = '';
  if (/^(jos|sus)$/.test(tok)) {
    if (words[j] !== 'de' || j < 1) return tok;
    link = 'de ';
    j -= 1;
  }
  const prevRaw = words[j];
  // `Principala nr. 58, Deal`: a comma ends the street, the qualifier stands alone.
  if (/[,;]$/.test(prevRaw)) return tok;
  const prev = prevRaw.replace(/^[(\[]+|[),\]]+$/g, '');
  if (!isPlausibleLocalityToken(prev) || /\d/.test(prev)) return tok;
  // `Bolintin-Deal` / `Bolintin-Vale` are written hyphenated (as sanitizeOcrText already does at
  // extract), so the list shows the same town as the stored route.
  if (/^(deal|vale)$/.test(tok)) return `${prev}-${tok}`;
  return `${prev} ${link}${tok}`;
}

/**
 * `Domnesti, Soseaua Curtea Domneasca, nr.Z5-ALeo RO 077090`: the town is printed first and the
 * chunk before RO is only the (unreadable) house number — read from the end it became the town
 * (`Nr.z5-Aleo`). Only this comma shape: town, then a chunk opening with a street type, then a
 * lone `nr.` chunk.
 */
function localityPrintedBeforeStreet(before) {
  const chunks = String(before || '').split(',').map((c) => c.trim()).filter(Boolean);
  if (chunks.length < 3 || !/^nr\b\.?\s*\S+$/.test(chunks[chunks.length - 1])) return null;
  const typeRe = new RegExp(STREET_TYPE_RE.source, STREET_TYPE_RE.flags);
  const typeAtStart = chunks[chunks.length - 2].match(typeRe);
  const townChunk = chunks[chunks.length - 3];
  if (!typeAtStart || typeAtStart.index !== 0 || typeRe.test(townChunk)) return null;
  return lastPlausibleLocality(townChunk);
}

/**
 * Locality from an address block: place before `RO #####`, or `Place ######` when the
 * two-column PDF drops the "RO" onto the Client column.
 */
function localityFromSection(sectionFolded) {
  // `Bolintin- Deal` (OCR space after the hyphen) is one town, not `Deal`.
  const folded = String(sectionFolded || '').replace(/([a-z])-\s+([a-z])/g, '$1-$2');
  let roAt = folded.search(/\bro\s*\d{5,6}\b/);
  // A postcode cut by the scan (`RO 0870`) still marks where the town ends.
  if (roAt < 0) roAt = folded.search(/\bro\s*\d{3,4}\b/);
  if (roAt > 0) {
    // Printed forms use commas: "nr. 7, Bolintin-Deal, RO 087015" / "…, Bucuresti Sector 1, RO …".
    let before = folded.slice(0, roAt).replace(/[,.\s]+$/g, '').trim();
    // Bare "Bucuresti Sector" (tab OCR drops the digit) still names the city.
    before = before.replace(/\bsector(?:ul)?\s*[0-9]*\s*$/i, '').replace(/[,.\s]+$/g, '').trim();
    // Skip trailing county plate (`IF`) / OCR stub (`I`) — TPO-0033547 Balotești.
    const fromRo = localityPrintedBeforeStreet(before) || lastPlausibleLocality(before);
    if (fromRo) return fromRo;
  }

  // Two-column OCR: locality\tpostcode with no "RO" on the delivery side.
  // Also "Bucuresti Sector\t050151" — strip a trailing sector label before the digits.
  const digitHits = [...folded.matchAll(/\b([a-z][a-z]*(?:-[a-z]+)?)\s+(?:sector(?:ul)?\s*[0-9]*\s+)?(\d{5,6})\b/g)];
  for (let i = digitHits.length - 1; i >= 0; i -= 1) {
    const name = digitHits[i][1];
    if (isPlausibleLocalityToken(name)) {
      return lastPlausibleLocality(folded.slice(0, digitHits[i].index + name.length)) || name;
    }
  }

  // Comma after house number is common on sales sheets (#61).
  // Prefer the last plausible word after nr. (skip `IF` / `I` when Balotești follows).
  const afterNrChunks = [...folded.matchAll(
    /\bnr\.?\s*[a-z0-9][a-z0-9\-]*\s*,?\s+([a-z][a-z0-9\-\s]{1,40}?)(?=\s+ro\b|\s+\d{5,6}\b|$)/gi,
  )];
  for (let i = afterNrChunks.length - 1; i >= 0; i -= 1) {
    const fromNr = lastPlausibleLocality(afterNrChunks[i][1]);
    if (fromNr) return fromNr;
  }
  // Postcode unreadable (`RO Ol 1743`) but the city line survived: `Bucuresti Sector 1`.
  if (/\bbucuresti\s+sector(?:ul)?\s*[1-6]\b/.test(folded)) return 'bucuresti';
  return null;
}

/** True when the cell is only a street-type token (`Sosea`, `Str.`), using STREET_TYPE_RE. */
function isStreetTypeOnlyCell(text) {
  const f = fold(text).trim();
  return new RegExp(`^${STREET_TYPE_RE.source}$`, STREET_TYPE_RE.flags).test(f);
}

function looksLikeClientIdCell(text) {
  const f = fold(text);
  return /^c\d{8}\b/.test(f) || /^ap-/.test(f);
}

/** Bare `nr` / `nr.` stub from a split cell (`Șosea\tnr.`). */
function isNrStubCell(text) {
  return /^nr\.?$/i.test(fold(text).trim());
}

/** Delivery-side continuation after a lone type cell: name and/or house, not a client id. */
function isAddressContinuationCell(text) {
  if (!text || looksLikeClientIdCell(text)) return false;
  const f = fold(text).trim();
  if (isNrStubCell(f)) return true;
  if (new RegExp(`^${HOUSE_NUM_RE.source}$`, 'i').test(f)) return true;
  return /[a-z]{3,}/.test(f);
}

/** True when left-column text already has a complete unload address (RO / postcode). */
function leftHasDeliveryPostcode(parts) {
  return /\bro\s*\d{5,6}\b|\b\d{5,6}\b/.test(fold(parts.join(' ')));
}

/**
 * When Adresa de livrare | Client share a row, pdf-parse emits tab-separated cells.
 * Keep only the left cell(s) — unloading address under Expeditor. Right = Client seat,
 * never parsed as delivery.
 */
function leftColumnFromInterleaved(section) {
  const left = [];
  // Flat OCR sometimes dumps the Client id (C########) + billing seat *above* the unload
  // street in the same Adresa de livrare slice. Skip that C# row, then the first complete
  // address is still the seat — restart on the next street (#111 CONCELEX / Aeroportului).
  // Do NOT treat leading AP- the same way: under Adresa de livrare, AP-ARABESQUE-… is the
  // unload site label; restarting would replace Unirii/Găești with the Client seat
  // (Timisului/Galați) printed below (#111 galati.pdf).
  let skippedLeadingClientNumericId = false;
  // Which input line each kept cell came from: the branch / site name prints on its own line
  // above the street and is dropped at the end (dropLeadingSiteLabelLines).
  const lineOf = [];
  let lineNo = -1;
  const push = (...kept) => {
    for (const cell of kept) {
      left.push(cell);
      lineOf.push(lineNo);
    }
  };
  for (const line of String(section || '').split(/\r?\n/)) {
    lineNo += 1;
    if (!line.trim() && !/^\t/.test(line)) continue;
    // Leading tab ⇒ empty left cell: the whole row is the Client column.
    const rawCells = line.split(/\t+/);
    const rightColumnOnly = /^\t/.test(line) || (rawCells.length > 1 && !String(rawCells[0] || '').trim());
    if (rightColumnOnly) continue;

    const cells = rawCells.map((c) => c.trim()).filter(Boolean);
    if (!cells.length) continue;
    const firstFold = fold(cells[0]);
    if (firstFold === 'client') continue;

    // After a complete left address, further lines are Client seat dumps (no leading tab)
    // — unless we already skipped a leading C######## and this is a new street (#111).
    if (leftHasDeliveryPostcode(left)) {
      if (/^(rou|ro)$/i.test(firstFold)) {
        push(cells[0]);
        continue;
      }
      if (
        skippedLeadingClientNumericId
        && new RegExp(STREET_TYPE_RE.source, STREET_TYPE_RE.flags).test(firstFold)
      ) {
        left.length = 0;
        lineOf.length = 0;
        push(cells[0]);
        skippedLeadingClientNumericId = false;
        continue;
      }
      continue;
    }

    if (cells.length === 1) {
      // Lone Client id / AP- row with tabs collapsed — not a street line.
      if (looksLikeClientIdCell(cells[0])) {
        // Only C######## means "billing seat dumped first". AP- alone is often the
        // delivery site code on the left column (AP-ARABESQUE-LOHNLIVRA).
        if (!left.length && /^c\d{8}\b/.test(firstFold)) skippedLeadingClientNumericId = true;
        continue;
      }
      push(cells[0]);
      continue;
    }
    // locality\tpostcode — both belong to the delivery column.
    const secondCompact = cells[1].replace(/\s+/g, '');
    if (cells.length === 2 && /^\d{5,6}$/.test(secondCompact)) {
      push(cells[0], `RO ${secondCompact}`);
      continue;
    }
    // `Sosea\tViilor nr. 52` / `Șosea\tnr.` — type alone left; name/nr still delivery-side.
    if (
      cells.length >= 2
      && isStreetTypeOnlyCell(cells[0])
      && isAddressContinuationCell(cells[1])
    ) {
      push(cells[0], cells[1]);
      // type\thouse\t… — keep a bare house in cell 3 only when cell 2 was the name.
      if (cells.length >= 3 && new RegExp(`^${HOUSE_NUM_RE.source}$`, 'i').test(fold(cells[2]).trim())) {
        push(cells[2]);
      }
      continue;
    }
    // pdf-parse on rezumat: `str. Republicii,\tIF Bolintin-Deal RO 087015 ROU` — street left,
    // house+locality in the next cell (not a Client id). Dropping the right cell left only
    // "Str. Republicii" until sanitize collapsed the tab on the extract path.
    const rightFold = fold(cells[1] || '').trim();
    const leftHasStreet = new RegExp(STREET_TYPE_RE.source, STREET_TYPE_RE.flags).test(firstFold);
    const rightStartsHouse = new RegExp(String.raw`^(?:nr\.?\s*)?(?:[0-9]{1,4}[a-z]{0,2}|[il]f)\b`, 'i')
      .test(rightFold);
    if (
      cells.length >= 2
      && leftHasStreet
      && rightStartsHouse
      && !looksLikeClientIdCell(cells[1])
    ) {
      push(cells[0], cells[1]);
      continue;
    }
    // `Viilor\t52` / `Viilor\t52\tStradă Aeroportului…` — name+house left, client street right.
    const houseCell = rightFold;
    const nameLike = /^[a-z]{3,}(?:\s+[a-z]{3,}){0,2}$/i.test(firstFold)
      && !isStreetTypeOnlyCell(cells[0])
      && !LOCALITY_NOISE.test(firstFold);
    if (
      nameLike
      && cells.length >= 2
      && new RegExp(`^${HOUSE_NUM_RE.source}$`, 'i').test(houseCell)
    ) {
      push(cells[0], cells[1]);
      continue;
    }
    // Skip cells that are clearly the Client id column (C######## / AP-…).
    if (/^c\d{8}\b/.test(firstFold) || /^ap-/.test(firstFold)) {
      if (!left.length && /^c\d{8}\b/.test(firstFold)) skippedLeadingClientNumericId = true;
      continue;
    }
    // Sector fragment left of the Client town (`5 RO\tBucurești Sector 1…`) — not a street.
    if (/^\d{1,2}\s*ro$/i.test(firstFold)) continue;
    push(cells[0]);
    // type\thouse\tclientStreet — middle cell is delivery house number.
    if (cells.length >= 3 && /^(nr\.?\s*)?[a-z0-9\-]+$/i.test(secondCompact)) {
      push(cells[1]);
    }
  }
  return dropLeadingSiteLabelLines(left, lineOf).join(' ');
}

const POSTCODE_IN_LINE_RE = /\bro\s*\d{5,6}\b|\b\d{5,6}\b/;
/** `Bl. 4` / `Etaj 2` / `Ap 12` under the street: building detail, not another street. */
const BUILDING_WORD_RE = /^(?:bl|bloc|sc|scara|et|etaj|ap|apartament|cam|camera|corp|hala|lot|tronson|parter|cladirea|cladire|sector)$/;

/** One delivery line that reads as a street on its own: a type word, or a name with a house number. */
function isStreetLikeLine(lineFolded) {
  const f = String(lineFolded || '').trim();
  if (!f || hasLegalForm(f) || /^(?:cs-|ap-|c\d{8}\b)/.test(f)) return false;
  if (new RegExp(STREET_TYPE_RE.source, STREET_TYPE_RE.flags).test(f)) return true;
  if (BUILDING_WORD_RE.test(f.split(/[^a-z0-9]+/)[0] || '')) return false;
  const withoutPost = f.replace(POSTCODE_IN_LINE_RE, ' ').replace(/\bsector(?:ul)?\s*\d\b/g, ' ');
  return new RegExp(String.raw`\b${STREET_NAME_WORD}\b[^0-9]{0,12}${HOUSE_NUM_RE.source}`, 'i').test(withoutPost);
}

/**
 * Baumit prints the delivery block as: branch / site name (`BRICO MILITARI 2`,
 * `ARABESQUE- GALATI`, `CALEA 13 BUILD SRL`, `CS-NAVIGATOR DEPOZIT`), then the street, then
 * town + `RO #####`. Read flat, the name line was taken for the street (`Str. Brico Militari
 * nr. 2`, `Str. Galati Salcamilor`). Structural rule: the lines above the last street-like line
 * before the postcode are the name, provided none of them is itself a typed street (a street split
 * over two lines, `Str. Drumul` / `de Centura nr. 39`, stays whole). A firm with a legal form is a
 * name even when it starts with a type word (`CALEA 13 BUILD SRL`).
 */
function dropLeadingSiteLabelLines(cells, lineOf) {
  const order = [];
  const byLine = new Map();
  cells.forEach((cell, i) => {
    const key = lineOf[i];
    if (!byLine.has(key)) {
      byLine.set(key, []);
      order.push(key);
    }
    byLine.get(key).push(cell);
  });
  if (order.length < 2) return cells;
  const lines = order.map((key) => fold(byLine.get(key).join(' ')));
  let postAt = lines.findIndex((f) => POSTCODE_IN_LINE_RE.test(f));
  if (postAt < 0) postAt = lines.length;
  let streetAt = -1;
  for (let i = postAt - 1; i >= 0; i -= 1) {
    if (isStreetLikeLine(lines[i])) {
      streetAt = i;
      break;
    }
  }
  if (streetAt < 0 && postAt < lines.length) {
    const beforePost = lines[postAt].split(POSTCODE_IN_LINE_RE)[0];
    if (new RegExp(STREET_TYPE_RE.source, STREET_TYPE_RE.flags).test(beforePost)) streetAt = postAt;
  }
  if (streetAt <= 0 || streetAt > 2) return cells;
  const typeRe = new RegExp(STREET_TYPE_RE.source, STREET_TYPE_RE.flags);
  for (let i = 0; i < streetAt; i += 1) {
    const companyLine = hasLegalForm(lines[i]) || hasCompanyToken(lines[i]) || /^(?:cs-|ap-)/.test(lines[i]);
    if (typeRe.test(lines[i]) && !hasLegalForm(lines[i])) return cells;
    // Scanned sheets scatter one street over lines (`Titulescu 4-8` / `Soseaua Nicolae nr.`):
    // a street-like line above another is part of it, unless it names a firm / branch.
    if (isStreetLikeLine(lines[i]) && !companyLine) return cells;
    if (!/[a-z]{3,}/.test(lines[i])) return cells;
  }
  const dropped = new Set(order.slice(0, streetAt));
  return cells.filter((_, i) => !dropped.has(lineOf[i]));
}

/**
 * Remove a Client column dump that OCR placed inside the Expeditor slice (before Site /
 * street). Resume at `Site:` only — Client seats also have Str./Șosea, so street-type
 * is not a safe resume marker.
 */
function scrubClientDumpFromExpeditor(folded) {
  const s = String(folded || '');
  if (!s.trim()) return s;
  // Baumit load origin is labelled Site; everything from Client / C######## until Site is seat dump.
  return s
    .replace(/(?:^|\s)client(?!\s+factur)\b[\s\S]*?(?=\bsite\b|$)/gi, ' ')
    .replace(/\bc\d{8}\b[\s\S]*?(?=\bsite\b|$)/gi, ' ')
    .replace(/\bap-[a-z0-9][\s\S]*?(?=\bsite\b|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One unload address only: keep through the first RO ##### (optional ROU).
 * A second street after that is the Client column (or another stop handled elsewhere).
 */
function clipToFirstDeliveryPostcode(folded) {
  const m = folded.match(/\bro\s*\d{5,6}\b/);
  if (!m || m.index == null) {
    // Tab OCR sometimes drops "RO" and leaves locality + 5–6 digits alone.
    const bare = folded.match(/\b\d{5,6}\b/);
    if (!bare || bare.index == null || bare.index < 4) return folded;
    return folded.slice(0, bare.index + bare[0].length).trim();
  }
  let end = m.index + m[0].length;
  const after = folded.slice(end);
  const rou = after.match(/^\s*rou\b/);
  if (rou) end += rou[0].length;
  return folded.slice(0, end).trim();
}

/**
 * Mistral / flat OCR often puts both columns on one line without tabs:
 * `Sosea Viilor nr. 52 Str. Aeroportului 120-130 Bucuresti … RO 050151`.
 * Drop the Client street+house, keep unload street + locality/postcode (#111).
 */
function peelLeftOfSecondStreet(folded) {
  const s = String(folded || '');
  if (!s.trim()) return s;
  const re = new RegExp(STREET_TYPE_RE.source, `${STREET_TYPE_RE.flags}g`);
  const hits = [...s.matchAll(re)];
  if (hits.length < 2) return s;
  const secondAt = hits[1].index;
  if (secondAt == null || secondAt < 8) return s;
  const afterSecond = s.slice(secondAt);
  // Client street through its house number; locality/RO after that belongs to delivery.
  const clientSpan = afterSecond.match(
    new RegExp(
      String.raw`^${STREET_TYPE_RE.source}\s*[a-z0-9.\-\/\s]{0,48}?(?=\s+(?:[a-z][a-z\-]+(?:\s+sector(?:ul)?\s*\d*)?\s+)?(?:ro\s*)?\d{5,6}\b|\s+[a-z]{3,}\s+sector\b|$)`,
      STREET_TYPE_RE.flags,
    ),
  );
  if (!clientSpan) return s.slice(0, secondAt).trim();
  return `${s.slice(0, secondAt)} ${s.slice(secondAt + clientSpan[0].length)}`
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * When the labelled delivery column only captured the Client seat (C######## + billing
 * street), Baumit still prints the unload street on „Solicitare / Referință client”
 * (`SOS. VIILOR NR 52, SECT 5`) — use that as the delivery hint (#111).
 */
function deliveryHintFromClientNotes(blob) {
  const notes = String(blob || '')
    .split(/\r?\n/)
    .map((line) => fold(line))
    .filter((line) => /\b(?:solicitare|referint[aă]?)\s+client\b/.test(line));
  if (!notes.length) return null;
  const text = notes.join(' ');
  const m = text.match(
    /\b(sos\.?|sosea|soseaua|str\.?|strada|bvd\.?|blvd\.?|bulevardul|calea|aleea)\s*([a-z][a-z0-9\-]{2,30})\s*(?:nr\.?\s*)?(\d{1,4}[a-z]?)\b/,
  );
  if (!m) return null;
  const sector = text.match(/\bsect(?:or)?\.?\s*([1-6])\b/);
  if (sector) return `${m[1]} ${m[2]} nr. ${m[3]} bucuresti sector ${sector[1]}`;
  // Town after house when present: "UNIRII NR 45, GAESTI, DAMBOVITA" — never invent București.
  const after = text.slice((m.index || 0) + m[0].length);
  const town = after.match(/^\s*,?\s*([a-z][a-z\-]{2,40})\b/);
  if (town && !/^(nr|ro|rou|sect|sector|jud|judetul)$/.test(town[1])) {
    return `${m[1]} ${m[2]} nr. ${m[3]} ${town[1]}`;
  }
  return `${m[1]} ${m[2]} nr. ${m[3]}`;
}

/**
 * After stripping client ids, no street type remains — the slice is only the billing seat.
 */
function deliverySectionLooksLikeClientSeat(section) {
  const f = fold(section)
    .replace(/\bc\d{8}\b/g, ' ')
    .replace(/\bap-[a-z0-9\-]+\b/g, ' ');
  const peeled = peelLeftOfSecondStreet(f);
  return !new RegExp(STREET_TYPE_RE.source, STREET_TYPE_RE.flags).test(peeled);
}

/**
 * Client seat printed above the unload street in the same delivery slice:
 * `C2390… Str. Aeroportului … RO 013596` then `Sosea Viilor … RO 050151`.
 */
function scrubLeadingClientSeatFromDelivery(folded) {
  const s = String(folded || '');
  if (!s.trim()) return s;
  const idAt = s.search(/\bc\d{8}\b|\bap-[a-z0-9]/);
  if (idAt < 0 || idAt > 64) return s;
  const streetRe = new RegExp(STREET_TYPE_RE.source, STREET_TYPE_RE.flags);
  const streetAt = s.search(streetRe);
  if (streetAt >= 0 && streetAt < idAt) return s;
  const afterId = s.slice(idAt);
  const pc = afterId.match(/\bro\s*\d{5,6}\b|\b\d{5,6}\b/);
  if (!pc || pc.index == null) return s;
  let end = idAt + pc.index + pc[0].length;
  const rou = s.slice(end).match(/^\s*rou\b/);
  if (rou) end += rou[0].length;
  const rest = s.slice(end).trim();
  if (streetRe.test(rest)) return rest;
  return s;
}

/**
 * Document title (`Aviz de expediție`, `Data aviz de expediție`, OCR `expedi!ie`) and calendar
 * dates / clock times are never part of an address.
 *
 * Context-bound on purpose: only the phrase `aviz de expedi…` goes, so a real street
 * `Str. Expediției nr. 4` keeps its name. Dates must look like dates (dd.mm.yyyy, a real day
 * and month, 4-digit year) — a house range `nr. 17-21` or wing `1/VII` is not touched.
 */
const DOC_TITLE_RE = /\b(?:data\s+)?aviz(?:ul)?\s+de\s+expedi[^\s]*(?:\s+rezumat\b:?)?/g;
const DATE_RE = /(?<![0-9])(?:0?[1-9]|[12][0-9]|3[01])\s*[.\/\-]\s*(?:0?[1-9]|1[0-2])\s*[.\/\-]\s*(?:19|20)\d{2}(?![0-9])(?:\s+(?:[01]?[0-9]|2[0-3])[:.][0-5][0-9](?::[0-5][0-9])?(?![0-9]))?/g;
const CLOCK_RE = /(?<![0-9:.])(?:[01]?[0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?(?![0-9])/g;

function scrubDocumentTitleAndDates(folded) {
  return String(folded || '')
    .replace(DOC_TITLE_RE, ' ')
    .replace(DATE_RE, ' ')
    .replace(CLOCK_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Street + locality inside one labelled block (Expeditor or Adresa de livrare).
 * Structure only: `Str. …` + place — no hard-coded town list.
 */
function parseDestBlock(section, { interleaved = false } = {}) {
  if (!section || !String(section).trim()) {
    return {
      locality: null, street: null, streetName: null, streetType: null, houseNumber: null, postcode: null,
    };
  }

  // Delivery is always the left column under Expeditor. When tabs (or Client markers)
  // are present, rebuild from left cells only — never the Client seat on the right.
  const source = interleaved ? leftColumnFromInterleaved(section) : section;
  let folded = fold(source)
    .replace(/bucurestisector/g, 'bucuresti sector')
    .replace(/([a-z])sector(\d)/g, '$1 sector $2');

  // PDF footers ("PAGINA 1/1") and OCR glue ("RepubliciiPAGINA") are not part of the street.
  folded = folded
    .replace(/([a-z])pagina\b/g, '$1 ')
    .replace(/\bpagina\b(?:\s*\d+(?:\s*[\/.\-]\s*\d+)?)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // TRO "rezumat" avize print the title and the date right under Expeditor:
  // `Aviz de expediție … Data aviz de expediție 20.10.2026 15:19`. Read as a street that
  // became `Str. Expeditie nr. 20` and hid the Site/Depozit origin from memory too.
  folded = scrubDocumentTitleAndDates(folded);

  if (interleaved) {
    // OCR sometimes dumps the Client seat (C######## + billing street + CP) *above* the
    // real Adresa de livrare street in the same slice — drop that leading seat (#111).
    folded = scrubLeadingClientSeatFromDelivery(folded);
    // Delivery (left column): Client id / AP- still mark the end when a right-column
    // dump lost its leading tab — but only after a street is already present. Flat OCR
    // often has `CONCELEX SRL C2390… Sosea Viilor…`; clipping at C# would drop Viilor (#111).
    const streetBeforeId = folded.search(new RegExp(STREET_TYPE_RE.source, STREET_TYPE_RE.flags));
    let clipAt = folded.length;
    for (const re of [/\bc\d{8}\b/, /\bap-[a-z0-9]/]) {
      const m = re.exec(folded);
      if (
        m && m.index >= 8 && m.index < clipAt
        && streetBeforeId >= 0 && streetBeforeId < m.index
      ) {
        clipAt = m.index;
      }
    }
    folded = folded.slice(0, clipAt);
    // One unload address: anything after the first postcode is Client (or a later stop).
    folded = clipToFirstDeliveryPostcode(folded);
  } else {
    // Expeditor: OCR often inserts the right-column Client header / C######## block
    // *before* Site/street. End-clipping at C######## would drop the origin and leave
    // Rută as delivery-only — strip the Client dump, then keep through first postcode.
    folded = scrubClientDumpFromExpeditor(folded);
    folded = clipToFirstDeliveryPostcode(folded);
  }
  // After Client dumps are gone: two streets on one line (Viilor + Aeroportului) → keep left (#111).
  folded = peelLeftOfSecondStreet(folded);
  folded = scrubSectionNoise(folded);
  // Client / site company sits above the street on Baumit (`DEMOS INTERMED SRL` then
  // `Intrare Navigatorilor`). Without this, the loose name matcher eats the firm + street.
  folded = scrubLeadingCompanyBeforeStreet(folded);

  // Postcode first: a București CP (01–06) corrects a wrong OCR town (Timisoara on
  // Bvd. Timișoara) before street parsing, so the street name is not stripped as locality.
  const postcode = postcodeFromSection(folded);
  const localityRaw = resolveLocalityWithPostcode(localityFromSection(folded), postcode);
  const localityFolded = localityRaw ? fold(localityRaw) : '';

  const {
    streetType, streetName, houseNumber: houseRaw, houseUnreadable,
  } = parseStreetParts(folded, localityFolded);
  // Without a street name, a lone house number is not an address leg ("nr. 52" alone).
  const rawHouse = streetName && houseRaw && !LOCALITY_NOISE.test(houseRaw) && !/^pagina/i.test(houseRaw)
    ? houseRaw
    : null;

  const locality = localityRaw ? displayWords(localityRaw) : null;
  const street = compactStreet(streetName, rawHouse);

  return {
    locality,
    street,
    streetName: streetName || null,
    streetType,
    houseNumber: rawHouse ? formatHouseNumber(rawHouse) : null,
    postcode,
    ...(houseUnreadable ? { houseUnreadable: true } : {}),
    // A street is printed (type word / `nr.`) but none could be read: the leg is the town only
    // although the page names a street (`Str. 13 Septembrie` → `Bucuresti` before the fix).
    ...(!streetName && (new RegExp(STREET_TYPE_RE.source, STREET_TYPE_RE.flags).test(folded) || /\bnr\b/.test(folded))
      ? { streetUnreadable: true } : {}),
  };
}

function displayWords(value) {
  const folded = fold(value);
  if (!folded) return null;
  return folded.split(/\s+/).filter(Boolean).map((word) => word.split('-').filter(Boolean).map((part) => {
    if (/^\d/.test(part)) return part.toUpperCase();
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join('-')).join(' ');
}

/** Canonical street-type label. The name itself keeps spaces (`Iuliu Maniu`, not `IuliuManiu`). */
function streetTypeLabel(type) {
  const t = fold(type).replace(/\.$/, '');
  if (!t) return null;
  if (/^str/.test(t)) return 'Str.';
  if (/^sos|^sosea/.test(t)) return 'Șosea';
  if (/^(bvd|blvd|bld|bd|bul|b-dul|bdul)/.test(t)) return 'Bvd.';
  if (t === 'al' || /^alee/.test(t)) return 'Aleea';
  if (/^pta|^piata/.test(t)) return 'Piața';
  if (/^cale/.test(t)) return 'Calea';
  if (/^intr/.test(t)) return 'Intrarea';
  if (/^splai/.test(t)) return 'Splaiul';
  return null;
}

/**
 * Drop `DEMOS INTERMED SRL` (etc.) when a recognised street type follows.
 * Keeps `Intrare Navigatorilor nr. 15` instead of gluing the firm into the street name.
 */
function scrubLeadingCompanyBeforeStreet(folded) {
  const raw = String(folded || '').trim();
  if (!raw || !COMPANY_FORM_RE.test(raw)) return raw;
  // Prefer SRL/S.A. (etc.) — never a bare `com` alone (too common in OCR noise).
  const firm = /\b(?:s\.?\s*r\.?\s*l\.?|s\.?\s*a\.?|scs|sra|gmbh|ltd)\b/i;
  // Named group inside a lookahead still occupies [1] — use a non-capturing type atom.
  const typeAtom = STREET_TYPE_RE.source.replace('(?<type>', '(?:');
  const afterFirm = raw.match(
    new RegExp(
      String.raw`${firm.source}\s+(?=${typeAtom})([\s\S]+)$`,
      'i',
    ),
  );
  if (afterFirm?.[1]) return afterFirm[1].trim();
  return raw;
}

/**
 * One leg for the route column: street + number + locality.
 * Example: `Str. Republicii nr. 1F, Bolintin-Deal` — never site codes or glued tokens.
 */
export function formatAddressLine(block) {
  if (!block) return null;
  const name = displayWords(block.streetName);
  // Type alone ("Șosea") or number alone ("nr. 52") is not an address leg.
  if (!name) return displayWords(block.locality);
  // Prefer the OCR type; default Str. only when the name is not already a typed street
  // (`Intrarea Navigatorilor` must not become `Str. Intrarea Navigatorilor`).
  const nameFold = fold(name);
  const nameHasType = new RegExp(`^${STREET_TYPE_RE.source}\\b`, STREET_TYPE_RE.flags).test(nameFold);
  const type = streetTypeLabel(block.streetType)
    || (nameHasType ? null : 'Str.');
  const nr = block.houseNumber ? `nr. ${block.houseNumber}` : null;
  const streetLine = [type, name, nr].filter(Boolean).join(' ');
  const locality = displayWords(block.locality);
  if (streetLine && locality) return `${streetLine}, ${locality}`;
  return streetLine || locality || null;
}

/**
 * Drop labels and codes that sit in the Expeditor / Adresa blocks but are not the street.
 * Keeps the parse focused on Str. … + locality before RO #####.
 */
function scrubSectionNoise(folded) {
  return folded
    // Label + value — Site/Depozit codes (MIL, NEAMTIU, MBMARFA…) are never a street.
    .replace(/\bsite(?:\s+livrare)?\s*[:\s]+[a-z][a-z0-9\-]{0,20}\b/g, ' ')
    .replace(/\bdepozite?\s*[:\s]+[a-z][a-z0-9\-]{0,20}\b/g, ' ')
    // Right-column header glued into the delivery block by OCR.
    .replace(/\breferint[aă]\s+client(?:ului)?\b/g, ' ')
    // Trailing hyphen on CS codes ("CS-PRAHOVA- OBI …") is not a word boundary — strip it too.
    .replace(/\bcs-[a-z0-9]+(?:-[a-z0-9]+)*-?/g, ' ')
    .replace(/\bap-[a-z0-9\-]+\b/g, ' ')
    .replace(/\bc\d{8}\b/g, ' ')
    // Store brand glued to a CS- site name ("OBI PLOIESTI", "OBI AVIATORILOR") — not a street.
    .replace(/\bobi\b/g, ' ')
    .replace(/\brou\b/g, ' ')
    // Goods table (and product row) after a route label on the same OCR line (#70).
    .replace(/\bprodus\b[\s\S]*$/i, ' ')
    .replace(/\bcantitate\b[\s\S]*$/i, ' ')
    .replace(/\bdenumire\s+produs\b[\s\S]*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Drop goods-table / SKU tail from a finished route string (#70). */
export function clipRouteGoodsTable(route) {
  const raw = String(route || '').trim();
  if (!raw) return raw;
  const clipped = raw
    .replace(/\bprodus\b[\s\S]*$/i, '')
    .replace(/\bcantitate\b[\s\S]*$/i, '')
    .replace(/\bdenumire\s+produs\b[\s\S]*$/i, '')
    .replace(/[|/]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clipped || raw;
}

/** Labels that open the delivery / unload column — never Expeditor / Client factură (#96). */
const DELIVERY_SECTION_STARTS = [
  'adrese de livrare',
  'adresa de livrare',
  'adresa livrare',
  'loc de descarcare',
  'loc descarcare',
  'adresa de descarcare',
  'adresa descarcare',
  'punct de descarcare',
  'destinatie',
];

const DELIVERY_SECTION_STOPS = [
  'client factura',
  'client factură',
  'client:',
  'placuta de inmatriculare',
  'transportator',
  'comanda vanzare',
  'termeni de livrare',
  'termen de livrare',
  'cod uit',
  'num de comanda',
  'solicitare client',
  'expeditor',
  'comanda de transport',
  // Table under the delivery address — not part of the route (#70).
  ...GOODS_TABLE_STOPS,
];

/** Earliest index of a delivery/unload heading in folded text, or -1. */
function earliestDeliveryLabelIndex(folded) {
  let best = -1;
  for (const label of DELIVERY_SECTION_STARTS) {
    const i = folded.indexOf(label);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

/**
 * Text under the Expeditor heading only. Site codes that appear later (e.g. MIL inside
 * Adresa de livrare) must not become the load origin.
 */
function parseExpeditorSection(blob) {
  return sliceSection(
    blob,
    ['expeditor'],
    [
      ...DELIVERY_SECTION_STARTS,
      'aviz de expeditie',
      'aviz de expediție',
      'client factura',
      'client factură',
      'client:',
      'placuta de inmatriculare',
      'transportator',
      'destinatar',
      'comanda vanzare',
      'termeni de livrare',
    ]
  );
}

function emptyAddressBlock() {
  return {
    locality: null, street: null, streetName: null, streetType: null, houseNumber: null, postcode: null,
  };
}

function isUsableAddressBlock(block) {
  return Boolean(block && (block.streetName || block.locality));
}

function isBucharestAddressBlock(block) {
  const loc = fold(block?.locality || '');
  return /\bbucuresti\b/.test(loc) || /^sector(?:ul)?\s*[1-6]\b/.test(loc);
}

/**
 * Parse address blocks from marker ranges in a folded delivery section.
 * @param {string} folded
 * @param {{ index: number, end: number }[]} markers
 * @param {'after'|'at'} contentFrom — after marker text, or including it (CS- codes).
 */
function blocksFromMarkers(folded, markers, contentFrom = 'after') {
  if (markers.length < 2) return [];
  const blocks = [];
  for (let i = 0; i < markers.length; i += 1) {
    const from = contentFrom === 'at' ? markers[i].index : markers[i].end;
    const to = i + 1 < markers.length ? markers[i + 1].index : folded.length;
    const chunk = folded.slice(from, to);
    // Delivery stops are always the left column — never Client on the right.
    const block = parseDestBlock(chunk, { interleaved: true });
    if (isUsableAddressBlock(block)) blocks.push(block);
  }
  return blocks;
}

/**
 * Baumit multi-stop sales sheets under "Adrese de livrare" (#61 / #96).
 * Prefer numbered "Livrare N:"; else CS- site codes; else repeated street-type starts.
 * Without this, a dual-stop section without "Livrare 1/2" collapsed to the *first*
 * street via parseDestBlock — inconsistent with the last/București rule on labelled stops.
 */
function parseMultiDeliveryBlocks(section) {
  const folded = fold(section);
  if (!folded.trim()) return [];

  const livrareMarkers = [];
  const livrareRe = /\blivrare\s*(\d+)\s*[:.\-]?\s*/gi;
  let m;
  while ((m = livrareRe.exec(folded)) !== null) {
    livrareMarkers.push({ index: m.index, end: m.index + m[0].length, n: Number(m[1]) });
  }
  const fromLivrare = blocksFromMarkers(folded, livrareMarkers, 'after');
  if (fromLivrare.length >= 2) return fromLivrare;

  // Baumit customer sites: `CS-PRAHOVA- OBI…` / `CS-HERASTRAU- OBI…` without Livrare N.
  const csMarkers = [];
  const csRe = /\bcs-[a-z0-9][a-z0-9\-]*/gi;
  while ((m = csRe.exec(folded)) !== null) {
    csMarkers.push({ index: m.index, end: m.index + m[0].length });
  }
  const fromCs = blocksFromMarkers(folded, csMarkers, 'at');
  if (fromCs.length >= 2) return fromCs;

  // Do not split on bare street-type words: Baumit two-column OCR often leaves the
  // Client factură street (Aeroportului / Locotenent Moga) in the same slice (#96).
  return [];
}

/**
 * Text above „Adresa de livrare” when OCR drops the Expeditor heading (#80).
 * Site/street still print there; without this the route keeps only the delivery leg.
 */
function expeditorHeadFallback(blob) {
  const folded = fold(blob);
  const deliveryAt = earliestDeliveryLabelIndex(folded);
  if (deliveryAt <= 0) return '';
  let from = 0;
  const exp = folded.lastIndexOf('expeditor', deliveryAt);
  if (exp >= 0) from = exp + 'expeditor'.length;
  // Skip a leading title line ("Aviz de expeditie…") if we started at 0.
  let head = folded.slice(from, deliveryAt);
  if (from === 0) {
    const nl = head.indexOf('\n');
    if (nl >= 0 && /\baviz\b/.test(head.slice(0, nl))) head = head.slice(nl + 1);
  }
  return head.trim();
}

/** Street + locality under Expeditor (whatever street the document prints). */
export function parseExpeditorAddress(blob) {
  const labelled = parseDestBlock(parseExpeditorSection(blob));
  if (labelled?.streetName) return labelled;
  const fallback = parseDestBlock(expeditorHeadFallback(blob));
  if (fallback?.streetName) return fallback;
  return labelled?.locality ? labelled : (fallback || emptyAddressBlock());
}

/**
 * Warehouse origin from Expeditor Site + Depozit when no street is printed.
 * Example: `Site: MIL` + `Depozit: NEAMTIU` → `MIL-NEAMTIU`.
 * Never reads Site/Depozit from Adresa de livrare / Client.
 */
export function originFromSiteDepozit(blob) {
  const section = fold(parseExpeditorSection(blob));
  let head = section;
  if (!head.trim()) {
    // OCR dropped the "Expeditor" word — take text before Adresa/Adrese de livrare only.
    const folded = fold(blob);
    const deliveryAt = earliestDeliveryLabelIndex(folded);
    head = deliveryAt >= 0 ? folded.slice(0, deliveryAt) : '';
  }
  if (!head.trim()) return null;

  // Baumit prints "Depozit" or "Depozite" (plural) depending on the form revision.
  const noise = /^(site|depozite?|pagina|data|aviz|rou?|nr|str)$/;

  let site = null;
  const siteM = head.match(/\bsite(?:\s+(?:livrare|depozite?))?\s*[:\s]+([a-z]{2,4})\b/);
  if (siteM?.[1] && !noise.test(siteM[1])) site = siteM[1];
  // `Site Depozit MIL MMMARFA` — labels then codes, no colons.
  if (!site) {
    const bare = head.match(/\bsite\s+depozite?\s+([a-z]{2,4})\s+([a-z][a-z0-9\-]{2,20})\b/);
    if (bare) {
      site = bare[1];
      const depot = bare[2];
      if (!noise.test(depot)) {
        return `${site.toUpperCase()}-${depot.toUpperCase()}`;
      }
    }
  }

  let depot = null;
  const depotM = head.match(/\bdepozite?\s*[:\s]+([a-z][a-z0-9\-]{2,20})\b/);
  if (depotM?.[1] && !noise.test(depotM[1]) && depotM[1] !== site) depot = depotM[1];
  // Tab OCR: `Site MIL .` / `NEAMTIU Pagina` / `Depozit` — depot name before an empty Depozit label.
  // Only when a Depozit(e) label exists; `Site: BOL Bolintin` must not become BOL-BOLINTIN.
  if (!depot && site && /\bdepozite?\b/.test(head)) {
    const afterSite = head.match(
      new RegExp(String.raw`\bsite(?:\s+(?:livrare|depozite?))?\s*[:\s]+${site}\b[\s.\-]*([a-z][a-z0-9\-]{3,20})\b`)
    );
    const cand = afterSite?.[1];
    if (cand && !noise.test(cand) && cand !== site && !/^(pagina|data|aviz)$/.test(cand)) {
      depot = cand;
    }
  }

  if (site && depot) return `${site.toUpperCase()}-${depot.toUpperCase()}`;
  if (site) return site.toUpperCase();
  if (depot) return depot.toUpperCase();
  return null;
}

/**
 * Every delivery stop on the page (one or many).
 * Multi-stop: "Adrese de livrare" + Livrare 1 / Livrare 2 / CS- sites (#61 / #96).
 */
export function parseDeliveryAddresses(blob) {
  const section = sliceSection(
    blob,
    DELIVERY_SECTION_STARTS,
    DELIVERY_SECTION_STOPS,
    { stopAtClientHeader: true },
  );
  const multi = parseMultiDeliveryBlocks(section);
  if (multi.length) return multi;

  // Always left-column rebuild: Adresa de livrare sits under Expeditor on the left.
  // The Client seat on the right is never the unload address (tabs or not).
  const one = parseDestBlock(section, { interleaved: true });
  const hintText = deliveryHintFromClientNotes(blob);
  const hint = hintText ? parseDestBlock(hintText, { interleaved: false }) : null;
  const hintOk = isUsableAddressBlock(hint) && Boolean(hint?.streetName);
  const oneOk = isUsableAddressBlock(one) && Boolean(one?.streetName);
  const sectionHasClientId = /\bc\d{8}\b|\bap-[a-z0-9]/.test(fold(section));
  const seatOnly = deliverySectionLooksLikeClientSeat(section);

  // Labelled column captured Client billing (Aeroportului) while Solicitare/Referință
  // names the unload street (SOS. VIILOR NR 52) — prefer the note (#111 CONCELEX).
  if (hintOk && (!oneOk || seatOnly
    || (one.streetName && fold(one.streetName) !== fold(hint.streetName) && sectionHasClientId))) {
    return [hint];
  }
  if (oneOk) return [one];
  if (hintOk) return [hint];
  return isUsableAddressBlock(one) ? [one] : [];
}

/**
 * True when the labelled delivery column has two+ stops — zone tax picks one
 * (București if present, else last) and the operator must see that choice (#96).
 */
export function hasAmbiguousDeliveryChoice(blob) {
  return parseDeliveryAddresses(blob).length >= 2;
}

/**
 * Primary delivery block for zone-tax fallback: among *labelled delivery* stops only,
 * București if present, else last stop in document order (#61 / #96).
 * Never Expeditor / Client — those sit outside the delivery section.
 */
export function parseDeliveryAddress(blob) {
  const all = parseDeliveryAddresses(blob);
  if (!all.length) return emptyAddressBlock();
  return all.find(isBucharestAddressBlock) || all[all.length - 1];
}

/**
 * Route = [Expeditor street | Site-Depozit] / [each delivery stop].
 * Multi-stop example (#61):
 * `Str. Industriei nr. 7, Bolintin-Deal / Strada Gheorghe Doja nr. 51, Ploiesti / Bvd. Aviatorilor nr. 72, Bucuresti`.
 */
function parseRoute(blob) {
  const { leg, status } = expeditorOrigin(blob);
  // A town alone, with no delivery leg, is the old false route (`Bolintin-Deal`).
  return buildRouteWithOrigin(blob, leg, { originNeedsDelivery: status === 'locality' });
}

/**
 * What the Expeditor block gives the route, and how much of it could be read.
 *
 *   street   — `Str. Republicii nr. 1F, Bolintin-Deal`
 *   site     — no street printed, Site/Depozit codes instead (`MIL-NEAMTIU`, `BOL`)
 *   locality — the street is there but unreadable (scanner text layer: `Str.-.epuolicii`),
 *              only the town before `RO 087015` survived (#112). Better a town than nothing,
 *              and the route is flagged so somebody looks at it.
 *   none     — nothing usable
 *
 * `block` is the parsed Expeditor address (postcode, locality, …) whatever the status, so
 * the learned-address memory can look the street up by postcode.
 */
export function expeditorOrigin(blob) {
  const block = parseExpeditorAddress(blob);
  if (block?.streetName) return { status: 'street', leg: formatAddressLine(block), block };
  const site = originFromSiteDepozit(blob);
  if (site) return { status: 'site', leg: site, block };
  const town = block?.locality ? displayWords(block.locality) : null;
  if (town) return { status: 'locality', leg: town, block };
  return { status: 'none', leg: null, block };
}

/**
 * Route = origin leg + every delivery stop read from the page.
 * The origin is passed in so a leg from somewhere else (the company's learned addresses)
 * goes through exactly the same delivery parse and clipping as a read one. `destLegs` does the
 * same for delivery stops filled from memory.
 */
export function buildRouteWithOrigin(blob, originLeg, { originNeedsDelivery = false, destLegs = null } = {}) {
  const dests = (destLegs || parseDeliveryAddresses(blob).map(formatAddressLine)).filter(Boolean);
  const origin = originNeedsDelivery && !dests.length ? null : originLeg;
  const legs = [origin, ...dests].filter(Boolean);
  if (!legs.length) return null;
  return clipRouteGoodsTable(legs.join(' / '));
}

/**
 * Parse OCR / PDF plain text into Anexa Factura RAI fields.
 * Codes / quantities use a space-joined blob; addresses keep raw line+tab structure
 * because Baumit's Adresa|Client columns only survive as tab-separated rows.
 */
export function parseBaumitAviz(rawText) {
  const raw = String(rawText || '').replace(/\r/g, '');
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const blob = lines.join(' ');

  const numar_tpo = findTpoNumber(blob);

  const data_efectuare_cursa = findAvizDate(blob);

  const numar_auto = findPlates(blob);

  const psl = normalizeDocNo(pickRegex(blob, [/\b(PSL[\s\-\.]*[0-9OI]{3,14}(?:[ \t\-]+[0-9OI]{2,10})?)\b/i]));
  const tro = normalizeDocNo(pickRegex(blob, [/\b(TRO[\s\-\.]*[0-9OI]{3,14}(?:[ \t\-]+[0-9OI]{2,10})?)\b/i]));
  const testAvz = normalizeDocNo(pickRegex(blob, [/\b(TEST-AVZ[\s\-\.]*\d+)\b/i]));
  const numar_document_marfa = psl || tro || testAvz;

  const qty = parseQty(blob);
  const gross = extractGrossWeight(blob);
  const net = extractNetWeight(blob);
  const defaults = annexFieldDefaults();

  return {
    ...defaults,
    numar_tpo,
    data_efectuare_cursa,
    numar_auto,
    ruta_transport: parseRoute(raw),
    delivery_address: parseDeliveryAddress(raw),
    tip_marfa: qty?.tip || null,
    cantitate_marfa: qty?.qty ?? null,
    gross_weight_kg: gross.value ?? null,
    net_weight_kg: net.value ?? null,
    numar_document_marfa,
    layout: psl ? 'psl' : tro ? 'tro' : null,
    _stub: false,
  };
}

function fieldFilled(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

function isGarbageAuto(value) {
  const s = String(value || '').trim();
  if (!s) return true;
  if (isAcceptableAutoField(s)) return false;
  if (normalizePlate(s)) return false;
  return true;
}

function isGarbageQuantity(value, tip) {
  if (!fieldFilled(value)) return true;
  return !isPlausibleQuantity(value, tip);
}

function preferStored(stored, parsedValue, isGarbage) {
  if (fieldFilled(stored) && !(isGarbage && isGarbage(stored))) return stored;
  if (parsedValue != null && String(parsedValue).trim() !== '') return parsedValue;
  // Do not keep a poisoned stored plate when we have nothing better, leave empty for review.
  return null;
}

function preferQuantity(row, parsed) {
  const tip = row?.tip_marfa || parsed?.tip_marfa || 'saci';
  const parsedQty = parsed?.cantitate_marfa;
  const parsedTip = parsed?.tip_marfa || tip;

  // Heal rows locked on the first product line (48) when raw text has a packaging total or
  // a multi-line sum (576). Tip was already upgraded to găleți by build 41; quantity was not.
  if (parsedQty != null && isPlausibleQuantity(parsedQty, parsedTip)) {
    const stored = row?.cantitate_marfa;
    if (!fieldFilled(stored) || !isPlausibleQuantity(stored, tip)) return parsedQty;
    if (Number(stored) !== Number(parsedQty)) {
      const raw = fold(row?.extracted_data?.raw_text || '');
      const hasPackagingTotal = /numar(?:ul)?\s+de\s+(galeti|saci|paleti)/i.test(raw);
      const parsedNorm = String(normalizeGoodsUnit(parsedTip) || parsedTip).toLowerCase();
      const parsedIsPackaging = [
        'galeti', 'saci', 'paleti', 'saci/galeti', 'saci / galeti', 'saci / bucati', 'm3', 'mc', 'm³',
      ].includes(
        parsedNorm,
      );
      if (hasPackagingTotal || (parsedIsPackaging && Number(parsedQty) > Number(stored))) {
        return parsedQty;
      }
    }
    return stored;
  }
  // Impossible OCR magnitudes (245000 saci) stay empty so the row is marked for review.
  return null;
}

/**
 * True when a stored "route" is really a compound place name (or bare site code), not
 * Site→delivery. Those values came from treating "Bolintin-Deal" as City-City in the OCR
 * profile; preferStored would keep them forever because the field is non-empty.
 */
/** A leg that is only Site/Depozit labelling (`MIL`, `MIL-NEAMTIU`), not a street. */
function looksLikeSiteCodeLeg(leg) {
  const s = String(leg || '').trim();
  if (!s) return false;
  if (/\b(str\.|strada|șosea|sosea|sos\.|bvd\.|blvd|aleea|piața|piata|calea|intrarea|intrare|nr\.)\b/i.test(s)) {
    return false;
  }
  // Bare site code or Site-Depozit glue (MIL-NEAMTIU), with no street words.
  return /^[A-Za-zĂÂÎȘȚăâîșț]{2,4}(-[A-Za-zĂÂÎȘȚăâîșț0-9]+)*$/u.test(s);
}

export function isFalseRoute(value) {
  const s = String(value || '').trim();
  if (!s) return true;
  // Bare 2–4 letter site code alone is not a route.
  if (/^[A-Za-zĂÂÎȘȚăâîșț]{2,4}$/u.test(s)) return true;
  // Site-Depozit glue without a slash (MIL-NEAMTIU) — warehouse labels, not a trip.
  if (looksLikeSiteCodeLeg(s)) return true;
  // Glued hyphen, no slash: compound locality, not origin/destination.
  if (/^[A-Za-zĂÂÎȘȚăâîșț]+-[A-Za-zĂÂÎȘȚăâîșț]+$/u.test(s) && !/^[A-Za-z]{2,4}-/i.test(s)) {
    return true;
  }
  return false;
}

/**
 * Good: two legs with ` / ` (street/street or Site-Depozit/street). Bad: glued codes,
 * Site/Depozit as the *delivery* leg, or a single leg when the page has both labels
 * and a Site/Depozit origin that should appear.
 */
export function isSuspiciousRoute(value, rawText = null) {
  if (isFalseRoute(value)) return true;
  const s = String(value || '').trim();
  if (/\s\/\s/.test(s)) {
    const parts = s.split(/\s\/\s/).map((part) => part.trim()).filter(Boolean);
    const dests = parts.length >= 2 ? parts.slice(1) : parts;
    // Every delivery leg must be a street (or locality), never another Site-Depozit code alone.
    if (dests.some((dest) => looksLikeSiteCodeLeg(dest))) return true;
    return false;
  }
  // One leg only while the document has Expeditor + delivery → incomplete when a
  // Site/Depozit or street origin exists on the page.
  if (rawText) {
    const folded = fold(rawText);
    const hasOriginLabel = folded.includes('expeditor');
    const hasDelivery = earliestDeliveryLabelIndex(folded) >= 0;
    if (hasOriginLabel && hasDelivery) {
      const originStreet = parseExpeditorAddress(rawText)?.streetName;
      const siteOrigin = originFromSiteDepozit(rawText);
      if (originStreet || siteOrigin) return true;
    }
  }
  if (/\s/.test(s) && /nr\.|str\.|șosea|sosea|bvd\.|aleea|piața|piata|calea/i.test(s)) return false;
  return true;
}

/**
 * Stored quantity disagrees with what the same raw OCR text prefers (footer total / line sum).
 * Classic multi-line Baumit miss: first product line 48 while `Numărul de găleți` is 576.
 */
export function quantityConflictsWithRaw(qty, tip, rawText) {
  if (!fieldFilled(qty) || !rawText) return false;
  const parsed = parseQty(rawText);
  if (!parsed || !isPlausibleQuantity(parsed.qty, parsed.tip || tip)) return false;
  return Number(parsed.qty) !== Number(qty);
}

function preferRoute(stored, parsed, rawText = null) {
  const parsedRoute = fieldFilled(parsed) ? parsed : null;
  const storedOk = fieldFilled(stored) && !isFalseRoute(stored);
  const parsedTwoLeg = Boolean(parsedRoute && /\s\/\s/.test(parsedRoute));

  // Two-leg labelled parse upgrades empty/false/suspicious OCR, truncated two-leg, and
  // Client-column leftovers. It must not replace a non-suspicious one-leg the office kept.
  if (parsedTwoLeg) {
    if (!storedOk || isSuspiciousRoute(stored, rawText) || /\s\/\s/.test(stored)) {
      return parsedRoute;
    }
    return stored;
  }

  // Single-leg parse must never wipe free-text Editează ("Ruta de birou") or an accepted street.
  if (storedOk) return stored;
  if (parsedRoute) return parsedRoute;
  return null;
}

/**
 * Tip marfa for list / export / repair.
 *
 * A bare count ("bucati") on the row is OCR noise from `Cantitate … buc`, not an office edit.
 * Prefer a packaging word from the stored raw text (or a non-generic quantity_unit) so old
 * rows upgrade on the next list/export without a re-scan. A real packaging tip already on
 * the row (Editează → găleți) is kept.
 */
function preferTipMarfa(row, parsed) {
  const storedRaw = row?.tip_marfa;
  const storedUnit = normalizeGoodsUnit(storedRaw);
  const storedDump = looksLikeOcrGoodsDump(storedRaw);
  // A filled office value wins — packaging *or* free text ("Beton"). Whole OCR product rows
  // and bare "bucati" are noise and must not stick across list/repair.
  if (
    fieldFilled(storedRaw)
    && !isGenericCountUnit(storedUnit || storedRaw)
    && !storedDump
  ) {
    return storedUnit && !isGenericCountUnit(storedUnit)
      ? storedUnit
      : String(storedRaw).trim();
  }

  const buried = packagingWordIn(storedRaw);
  if (buried && !isGenericCountUnit(buried)) return buried;

  const fromParsed = normalizeGoodsUnit(parsed?.tip_marfa)
    || packagingWordIn(parsed?.tip_marfa);
  if (fromParsed && !isGenericCountUnit(fromParsed)) return fromParsed;

  const fromUnit = normalizeGoodsUnit(row?.quantity_unit);
  if (fromUnit && !isGenericCountUnit(fromUnit)) return fromUnit;

  return null;
}

/**
 * Fill empty/garbage fields from stored OCR text. Never overwrite office Editează values
 * listed in corrected_fields. A complete two-leg parse from labelled slices replaces
 * stale OCR routes (including ones that once read the Client column).
 */
export function repairAvizFromStored(row) {
  const raw = row?.extracted_data?.raw_text;
  const parsed = raw ? parseBaumitAviz(raw) : null;
  const corrected = row?.corrected_fields ?? [];
  const keep = (field) => Array.isArray(corrected) && corrected.includes(field);
  return {
    ...row,
    numar_tpo: keep('numar_tpo') ? row.numar_tpo : resolveStoredTpo(row, parsed),
    data_efectuare_cursa: keep('data_efectuare_cursa')
      ? row.data_efectuare_cursa
      : preferStored(row?.data_efectuare_cursa, parsed?.data_efectuare_cursa),
    numar_auto: keep('numar_auto')
      ? row.numar_auto
      : preferStored(row?.numar_auto, parsed?.numar_auto, isGarbageAuto),
    ruta_transport: keep('ruta_transport')
      ? row.ruta_transport
      : preferRoute(row?.ruta_transport, parsed?.ruta_transport, raw),
    tip_marfa: keep('tip_marfa') && fieldFilled(row?.tip_marfa)
      ? String(row.tip_marfa).trim()
      : preferTipMarfa(row, parsed),
    cantitate_marfa: keep('cantitate_marfa')
      ? row.cantitate_marfa
      : preferQuantity(row, parsed),
    gross_weight_kg: keep('gross_weight_kg')
      ? row.gross_weight_kg
      : (row?.gross_weight_kg ?? parsed?.gross_weight_kg ?? null),
    net_weight_kg: keep('net_weight_kg')
      ? row.net_weight_kg
      : (row?.net_weight_kg ?? parsed?.net_weight_kg ?? null),
    numar_document_marfa: keep('numar_document_marfa')
      ? row.numar_document_marfa
      : preferStored(row?.numar_document_marfa, parsed?.numar_document_marfa),
    // Derived, never stored and never edited: the delivery address exists only to answer
    // "which zone", and re-reading it from the OCR text each time means a document whose text
    // improves on re-extraction improves here too, with no column to keep in step.
    delivery_address: parsed?.delivery_address ?? null,
  };
}

/*
 * Route completeness (route confidence). A route is `ok` only when every leg is a full address
 * — street + town — or, for the origin, a printed Site-Depozit pair (`MIL-NEAMTIU`), and nothing
 * on the page says the read is noisy. Anything else is `low` (needs review) with a reason code,
 * so a partial route (`… / Bucuresti`), a bare site code (`BOL / …`) or a street made of the
 * client's name can no longer pass as a confident one. The route text itself is not touched.
 *
 * Reason codes (also on route_trace.confidence.reasons, no address text):
 *   incomplete_leg     a leg is missing, or is only a town / only a street / a bare site code
 *   unknown_street     the page prints a street for that leg but none could be read
 *   unknown_house      the street's number is printed but unreadable (`nr. ~~`)
 *   junk_street        the street is a firm / branch / logo word, or number / town are not plausible
 *   duplicate_leg      the same delivery stop twice (two columns of one photo)
 *   form_label         CMR: the leg is a printed form label, not a place (handwritten CMR)
 *   ambiguous_delivery several stops, the tax picks one (#96)
 *   origin_locality    Expeditor street unreadable, only the town survived (#112)
 *   suspicious_route   isSuspiciousRoute (glued codes, site code as delivery…)
 */
const ROUTE_LEG_TYPE_RE = /^(?:str\.?|strada|sos\.?|sosea|soseaua|bvd\.?|blvd\.?|bd\.?|b-dul|bdul|bulevard(?:ul)?|aleea|alee|piata|calea|intrarea|splaiul|drumul)(?![a-z])/;
const PLAUSIBLE_HOUSE_RE = /^\d{1,4}[a-z]{0,2}(?:[-/][0-9a-z]{1,6})?$/i;
const PLAUSIBLE_TOWN_RE = /^\p{L}[\p{L} .-]*$/u;
/** Printed CMR box labels (DE / EN / RO) that a handwritten CMR route picked up instead of places. */
const CMR_FORM_LABEL_RE = /\b(?:ort|ubernahme|gutes|empfanger|absender|frachtfuhrer|nachfolgende|anschrift|ablieferung|bestimmungsort|taking\s+over|place\s+of|consignee|carrier|successive|locul|destinatar|expeditor|transportator|preluare)\b/;

function splitRouteLeg(leg) {
  const text = String(leg || '').trim();
  const comma = text.lastIndexOf(',');
  const head = comma >= 0 ? text.slice(0, comma).trim() : text;
  const town = comma >= 0 ? text.slice(comma + 1).trim() : '';
  const headFold = fold(head);
  const hasStreet = ROUTE_LEG_TYPE_RE.test(headFold) || /\bnr\.?\s*\S/.test(headFold);
  return {
    street: hasStreet ? head : null,
    town: hasStreet ? (town || null) : (town ? `${head}, ${town}` : head),
  };
}

function legHouse(street) {
  return fold(street).match(/\bnr\.?\s*([^\s,]+)/)?.[1] || null;
}

function routeLegIssues(leg, block, { origin = false } = {}) {
  const issues = [];
  if (looksLikeSiteCodeLeg(leg)) {
    // `MIL-NEAMTIU` / `BOL-MBMARFA`: a printed origin. A bare `BOL` says only which site.
    if (!(origin && /-/.test(leg))) issues.push('incomplete_leg');
    return issues;
  }
  const { street, town } = splitRouteLeg(leg);
  if (!street) {
    issues.push(block?.streetUnreadable ? 'unknown_street' : 'incomplete_leg');
    return issues;
  }
  if (!town) issues.push('incomplete_leg');
  const house = legHouse(street);
  if (house && !PLAUSIBLE_HOUSE_RE.test(house)) issues.push('junk_street');
  if (town && !PLAUSIBLE_TOWN_RE.test(town)) issues.push('junk_street');
  const name = fold(street).replace(ROUTE_LEG_TYPE_RE, ' ').replace(/\bnr\b[\s\S]*$/, ' ');
  // A legal form in the street is a firm. A chain / logo word is one only when no type was
  // printed (`Str. Hornbach, nr. 17-21` is printed as a street and stays one).
  if (hasLegalForm(name) || (block && !block.streetType && hasCompanyToken(name))) issues.push('junk_street');
  if (block?.houseUnreadable) issues.push('unknown_house');
  return issues;
}

/**
 * Why this route is not a confident one (empty list = ok). See the block comment above.
 * @param {string|null} route
 * @param {string|null} rawText
 * @param {{ profileId?: string|null, learned?: boolean, corrected?: boolean }} [opts]
 *   learned / corrected: a rule from an office correction or a pinned route is the office's
 *   word — only the old heuristics apply, not the completeness check.
 */
export function routeConfidenceReasons(route, rawText, { profileId = null, learned = false, corrected = false } = {}) {
  if (corrected) return [];
  const reasons = [];
  const add = (code) => { if (!reasons.includes(code)) reasons.push(code); };
  const raw = rawText || null;
  if (isSuspiciousRoute(route, raw)) add('suspicious_route');
  if (raw && hasAmbiguousDeliveryChoice(raw)) add('ambiguous_delivery');
  if (raw && expeditorOrigin(raw).status === 'locality') add('origin_locality');
  if (learned) return reasons;

  const value = String(route || '').trim();
  const profile = String(profileId || '');
  const legs = value ? value.split(/\s\/\s/).map((l) => l.trim()).filter(Boolean) : [];
  if (/^aviz_cmr/.test(profile)) {
    if (legs.length < 2) add('incomplete_leg');
    if (legs.some((leg) => CMR_FORM_LABEL_RE.test(fold(leg)))) add('form_label');
    return reasons;
  }
  if (!/^aviz_baumit/.test(profile)) return reasons;

  if (legs.length < 2) add('incomplete_leg');
  const originBlock = raw ? expeditorOrigin(raw).block : null;
  const deliveryBlocks = raw ? parseDeliveryAddresses(raw) : [];
  const blockFor = (leg, blocks) => blocks.find((b) => formatAddressLine(b) === leg) || null;
  legs.forEach((leg, i) => {
    const block = i === 0 ? (originBlock && formatAddressLine(originBlock) === leg ? originBlock : null) : blockFor(leg, deliveryBlocks);
    // One leg only: it is the delivery when the page has no origin left (cut header).
    const asOrigin = i === 0 && legs.length >= 2;
    for (const code of routeLegIssues(leg, block, { origin: asOrigin })) add(code);
  });
  const stops = legs.slice(1).map((l) => fold(l).replace(/[^a-z0-9]+/g, ' ').trim());
  if (new Set(stops).size < stops.length) add('duplicate_leg');
  return reasons;
}

/**
 * Extract time: the stored `ruta_transport` field object goes to review when the route is not a
 * confident one, so `needs_review` / routing agree with the list's amber flag. Mutates and
 * returns `{ status, reasons }` for route_trace. Memory fills are already `review` (0.6).
 */
export function applyRouteConfidenceToField(fields, {
  route, rawText, profileId = null, learned = false, corrected = false,
} = {}) {
  const reasons = routeConfidenceReasons(route, rawText, { profileId, learned, corrected });
  const status = reasons.length ? 'low' : 'ok';
  const field = fields?.ruta_transport;
  if (status === 'low' && field && String(route ?? '').trim()) {
    fields.ruta_transport = {
      ...field,
      confidence: Math.min(Number(field.confidence) || 0, 0.6),
      status: 'review',
      route_confidence_reasons: reasons,
    };
  }
  return { status, reasons };
}

export function avizFieldConfidence(row) {
  const raw = row?.extracted_data?.raw_text;
  const qtyLow = isGarbageQuantity(row?.cantitate_marfa, row?.tip_marfa)
    || quantityConflictsWithRaw(row?.cantitate_marfa, row?.tip_marfa, raw);
  // Multi-stop delivery: tax picks București/last — mark rută so the choice is visible (#96).
  // Expeditor street unreadable (#112): the origin leg is a town or a learned address, not
  // what the page says — always worth a look. Incomplete / noisy legs: routeConfidenceReasons.
  const routeLow = routeConfidenceReasons(row?.ruta_transport, raw, {
    profileId: row?.ocr_profile_id,
    learned: row?.extracted_data?.route_source === 'learned',
  }).length > 0;
  return {
    numar_tpo: isExtractedGarbageTpo(row?.numar_tpo) ? 'low' : 'ok',
    numar_auto: isGarbageAuto(row?.numar_auto) ? 'low' : 'ok',
    ruta_transport: routeLow ? 'low' : 'ok',
    cantitate_marfa: qtyLow ? 'low' : 'ok',
  };
}

function confidenceRank(status) {
  return status === 'low' ? 1 : 0;
}

function worseConfidence(a, b) {
  return confidenceRank(a) >= confidenceRank(b) ? a : b;
}

/** Keys the OCR verify hard-lock cares about (aligned with companion OCR_VERIFY_KEYS). */
const OCR_VERIFY_FIELD_KEYS = new Set([
  'numar_tpo', 'numar_document_marfa', 'numar_auto', 'data_efectuare_cursa', 'ruta_transport',
]);

/**
 * Prefer stored OCR field objects for the UI amber flags; fall back to heuristics
 * when a row predates field_confidence JSON or only has low/ok strings.
 * Heuristic "low" always wins over a stored "ok" — otherwise a wrong-but-confident
 * parse (Republicii17, first-line quantity 48) hides the review label.
 * Office-corrected fields are always ok: the operator accepted the value.
 */
export function fieldConfidenceForUi(row) {
  const heuristic = avizFieldConfidence(row);
  const stored = row?.field_confidence;
  const corrected = new Set(
    Array.isArray(row?.corrected_fields) ? row.corrected_fields : [],
  );

  const out = { ...heuristic };
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [key, val] of Object.entries(stored)) {
      let fromStored = null;
      if (val === 'low' || val === 'ok') {
        fromStored = val;
      } else if (val && typeof val === 'object') {
        // Prefer numeric confidence over status — amber follows the field's HITL auto band (#56/#85).
        if (typeof val.confidence === 'number') {
          const auto = fieldMeta(key)?.bands?.auto ?? DEFAULT_BANDS.auto;
          fromStored = val.confidence >= auto ? 'ok' : 'low';
        } else if (val.status === 'ok') {
          fromStored = 'ok';
        } else if (val.status === 'review' || val.status === 'missing') {
          fromStored = 'low';
        }
      }
      if (!fromStored) continue;
      out[key] = worseConfidence(heuristic[key] || 'ok', fromStored);
    }
  }
  for (const key of corrected) {
    if (key in out || OCR_VERIFY_FIELD_KEYS.has(key)) out[key] = 'ok';
  }
  return out;
}

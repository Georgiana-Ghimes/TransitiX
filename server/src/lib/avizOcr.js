/**
 * Extract + parse Baumit-style avize (PSL sales and TRO transfer).
 * Text parsing only. Reading a file is the profile extractor's job (lib/ocr/readText.js).
 */
import { annexFieldDefaults, normalizeGoodsUnit } from './avizTemplate.js';
import {
  extractGrossWeight,
  extractNetWeight,
  extractQuantity,
  isAcceptableAutoField,
  isGenericCountUnit,
  isPlausibleQuantity,
  parseNumber,
  RO_PLATE_COUNTIES,
} from './ocr/fields.js';

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

function toIsoDate(value) {
  const s = String(value || '').trim().replace(/\s+\d{1,2}:\d{2}(?::\d{2})?.*$/, '');
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!dmy) return null;
  const day = Number(dmy[1]);
  const month = Number(dmy[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Prefer the aviz datetime (11.08.2026 13:10), not a split "1 1.08.2026". */
function findAvizDate(blob) {
  const labeled = blob.match(
    /data\s+aviz(?:ului)?(?:\s+de\s+expedi[tț]ie)?[\s\S]{0,800}?(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})(?:\s+\d{1,2}:\d{2})?/i
  );
  if (labeled?.[1] && toIsoDate(labeled[1])) return toIsoDate(labeled[1]);

  const glued = blob.match(/\b(\d)\s+(\d[./-]\d{1,2}[./-]\d{4})\b/);
  if (glued) {
    const iso = toIsoDate(`${glued[1]}${glued[2]}`);
    if (iso) return iso;
  }

  const withTime = blob.match(/\b(\d{2}[./-]\d{2}[./-]\d{4})\s+\d{1,2}:\d{2}\b/);
  if (withTime) return toIsoDate(withTime[1]);

  const twoDigit = blob.match(/\b(\d{2}[./-]\d{2}[./-]\d{4})\b/);
  if (twoDigit) return toIsoDate(twoDigit[1]);

  const any = blob.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{4})\b/);
  return any ? toIsoDate(any[1]) : null;
}

const PLATE_RE = new RegExp(
  `\\b(${RO_PLATE_COUNTIES})[-\\s]?(\\d{2,3})[-\\s]?([A-Z]{2,3})\\b`,
  'gi'
);

export function extractPlates(value) {
  const s = normalizeWs(value).toUpperCase();
  const plates = [];
  const seen = new Set();
  let m;
  const re = new RegExp(PLATE_RE.source, 'gi');
  while ((m = re.exec(s)) !== null) {
    const plate = `${m[1]}-${m[2]}-${m[3]}`;
    if (seen.has(plate)) continue;
    seen.add(plate);
    plates.push(plate);
  }
  return plates;
}

/** Tractor / trailer: `B 112 VFM / B 475AGR` → `B-112-VFM / B-475-AGR`. Never dump prose. */
export function normalizePlate(value) {
  const plates = extractPlates(value);
  if (plates.length) return plates.join(' / ');
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
  const plates = extractPlates(search);
  if (plates.length) return plates.join(' / ');
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
  const m = upper.match(/\b(PSL|TRO)[-.\s]*(\d[\d./-]*)/);
  if (m) return `${m[1]}-${m[2].replace(/[^\d]/g, '')}`;
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
export function normalizeTpo(value, minDigits = 1) {
  if (!value) return null;
  const n = Number(minDigits) >= 1 ? Number(minDigits) : 1;
  const m = String(value).toUpperCase().match(new RegExp(`TPO[\\s\\-.]*(\\d{${n},}(?:[-/.]\\d+)*)`));
  return m ? `TPO-${m[1].replace(/[/.]/g, '-')}` : null;
}

function findTpoNumber(blob) {
  return normalizeTpo(blob, 4);
}

function isExtractedGarbageTpo(value) {
  const s = String(value || '').trim();
  if (!s) return true;
  if (normalizeTpo(s, 1)) return false;
  return /^(mpi|adeziv|adresa)\b/i.test(s);
}

function resolveStoredTpo(row, parsed) {
  const stored = String(row?.numar_tpo || '').trim();
  const storedNorm = normalizeTpo(stored, 1);
  if (storedNorm) return storedNorm;
  if (parsed?.numar_tpo && isExtractedGarbageTpo(stored)) return parsed.numar_tpo;
  return stored || null;
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
  return { qty, tip, rank: tip === 'galeti' ? 4 : tip === 'saci' ? 3 : tip === 'paleti' ? 2 : 1 };
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

function sliceSection(blob, startLabels, stopLabels) {
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
  let end = folded.length;
  for (const stop of stopLabels) {
    const hit = findFoldedLabel(folded.slice(from), stop);
    if (hit && hit.index > 0) {
      const abs = from + hit.index;
      if (abs < end) end = abs;
    }
  }
  return folded.slice(from, end);
}

/** Grammatical noise — never a locality. No town/street whitelist. */
const LOCALITY_NOISE = /^(rou|ro|romania|sector|site|depozit|nr|numar|str|strada|sosea|soseaua|sos|bvd|blvd|aleea|al|piata|pta|calea|pagina|client)$/;

/** Second street-name token stops here (grammatical), not at town names — towns vary. */
const STREET_NAME_STOP = /^(nr|numar|sector|ro|rou|romania)$/;

const STREET_TYPE_RE = /(?<type>strada|str\.?|soseaua|sosea|sos\.?|bulevardul|blvd\.?|bld\.?|bvd\.?|b-dul|bdul|bd\.?|aleea|al\.|piata|pta\.?|calea)/;

function isUsableStreetToken(word, localityFolded = '') {
  if (!word || word.length < 3) return false;
  if (STREET_NAME_STOP.test(word) || LOCALITY_NOISE.test(word)) return false;
  if (/^pagina/i.test(word)) return false;
  if (localityFolded && localityFolded.startsWith(word)) return false;
  return true;
}

/**
 * Locality from an address block: place before `RO #####`, or `Place ######` when the
 * two-column PDF drops the "RO" onto the Client column.
 */
function localityFromSection(folded) {
  const roAt = folded.search(/\bro\s*\d{5,6}\b/);
  if (roAt > 0) {
    const before = folded
      .slice(0, roAt)
      .replace(/\bsector\s*\d*\s*$/i, '')
      .trim();
    const m = before.match(/([a-z][a-z]*(?:-[a-z]+)?)$/);
    if (m?.[1] && !LOCALITY_NOISE.test(m[1]) && !STREET_NAME_STOP.test(m[1])) {
      return m[1];
    }
  }

  // Two-column OCR: locality\tpostcode with no "RO" on the delivery side.
  for (const m of folded.matchAll(/\b([a-z][a-z]*(?:-[a-z]+)?)\s+(\d{5,6})\b/g)) {
    if (!LOCALITY_NOISE.test(m[1]) && !STREET_NAME_STOP.test(m[1])) return m[1];
  }

  const afterNr = folded.match(
    /\bnr\.?\s*[a-z0-9][a-z0-9\-]*\s+([a-z][a-z]*(?:-[a-z]+)?)\b/
  );
  if (afterNr?.[1] && !LOCALITY_NOISE.test(afterNr[1]) && !STREET_NAME_STOP.test(afterNr[1])) {
    return afterNr[1];
  }
  return null;
}

/**
 * When Adresa de livrare | Client share a row, pdf-parse emits tab-separated cells.
 * Keep only the left cell(s) — unloading address. Right = Client seat, never parsed.
 */
function leftColumnFromInterleaved(section) {
  const left = [];
  for (const line of String(section || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split(/\t+/).map((c) => c.trim()).filter(Boolean);
    if (!cells.length) continue;
    const firstFold = fold(cells[0]);
    if (firstFold === 'client') continue;
    if (cells.length === 1) {
      left.push(cells[0]);
      continue;
    }
    // locality\tpostcode — both belong to the delivery column.
    const secondCompact = cells[1].replace(/\s+/g, '');
    if (cells.length === 2 && /^\d{5,6}$/.test(secondCompact)) {
      left.push(cells[0], `RO ${secondCompact}`);
      continue;
    }
    // Skip cells that are clearly the Client id column (C######## / AP-…).
    if (/^c\d{8}\b/.test(firstFold) || /^ap-/.test(firstFold)) continue;
    left.push(cells[0]);
    // type\thouse\tclientStreet — middle cell is delivery house number.
    if (cells.length >= 3 && /^(nr\.?\s*)?[a-z0-9\-]+$/i.test(secondCompact)) {
      left.push(cells[1]);
    }
  }
  return left.join(' ');
}

/**
 * Street + locality inside one labelled block (Expeditor or Adresa de livrare).
 * Structure only: `Str. …` + place — no hard-coded town list.
 */
function parseDestBlock(section, { interleaved = false } = {}) {
  if (!section || !String(section).trim()) {
    return { locality: null, street: null, streetName: null, streetType: null, houseNumber: null };
  }

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

  // On a clean single-column block, Client codes still mark the end of the delivery address.
  // After left-column rebuild they should already be gone — clipping would only hurt.
  if (!interleaved) {
    let clipAt = folded.length;
    for (const re of [/\bc\d{8}\b/, /\bap-[a-z0-9]/]) {
      const m = re.exec(folded);
      if (m && m.index >= 8 && m.index < clipAt) clipAt = m.index;
    }
    folded = folded.slice(0, clipAt);
  }
  folded = scrubSectionNoise(folded);

  const localityRaw = localityFromSection(folded);
  const localityFolded = localityRaw ? fold(localityRaw) : '';

  const typeMatch = folded.match(new RegExp(STREET_TYPE_RE.source, STREET_TYPE_RE.flags));
  let streetType = typeMatch?.groups?.type?.replace(/\.$/, '') || null;
  let streetName = null;

  if (typeMatch) {
    const afterType = folded.slice(typeMatch.index + typeMatch[0].length);
    // Skip `nr. 31B` / OCR `nr IF` that often sits between STR and the street name line.
    const afterNr = afterType.replace(/^\s*(?:nr\.?\s*)?[a-z]?\d[a-z0-9\-]*\s*/i, ' ');
    const afterTokens = afterNr.match(/[a-z]{3,}/g) || [];
    for (const tok of afterTokens) {
      if (isUsableStreetToken(tok, localityFolded)) {
        streetName = tok;
        break;
      }
    }
    // Street name immediately before the type word (`Viilor Șosea`) — not earlier site tags.
    if (!streetName) {
      const before = folded.slice(0, typeMatch.index).trim();
      const prev = before.match(/([a-z]{4,})$/);
      if (prev && isUsableStreetToken(prev[1], localityFolded)) {
        streetName = prev[1];
      }
    }
  }

  const nrMatch = folded.match(/\bnr\.?\s*([a-z0-9][a-z0-9\-]*)/);
  let rawHouse = nrMatch?.[1] && !LOCALITY_NOISE.test(nrMatch[1]) && !/^pagina/i.test(nrMatch[1])
    ? nrMatch[1]
    : null;
  // Baumit often prints `Str. Republicii, IF Bolintin-Deal` with `nr.` on the next line.
  if (!rawHouse && streetName) {
    const afterStreet = folded.slice(folded.indexOf(streetName) + streetName.length);
    const bare = afterStreet.match(/^\s*,?\s*(?:nr\.?\s*)?([0-9]+[a-z]?|[il]f)\b/i);
    if (bare?.[1] && !LOCALITY_NOISE.test(fold(bare[1]))) rawHouse = bare[1];
  }

  if (!streetName && rawHouse) {
    const loose = folded.match(/([a-z]{4,})(?:\s+([a-z]{3,}))?\s+nr\.?\s*[a-z0-9]/);
    if (loose && isUsableStreetToken(loose[1], localityFolded)) {
      streetName = loose[1];
      if (loose[2] && isUsableStreetToken(loose[2], localityFolded)) {
        streetName = `${loose[1]} ${loose[2]}`;
      }
    }
  }

  // "Iuliu Maniu" — second token only when it is still a street word, not the town.
  if (streetName && !/\s/.test(streetName) && typeMatch) {
    const afterName = folded.slice(folded.indexOf(streetName) + streetName.length);
    const second = afterName.match(/^\s*([a-z]{3,})/);
    if (second && isUsableStreetToken(second[1], localityFolded)) {
      streetName = `${streetName} ${second[1]}`;
    }
  }

  const locality = localityRaw ? displayWords(localityRaw) : null;
  const street = compactStreet(streetName, rawHouse);

  return {
    locality,
    street,
    streetName: streetName || null,
    streetType,
    houseNumber: rawHouse ? formatHouseNumber(rawHouse) : null,
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
  if (/^(bvd|blvd|bld|bd|bulevard|b-dul|bdul)/.test(t)) return 'Bvd.';
  if (t === 'al' || /^alee/.test(t)) return 'Aleea';
  if (/^pta|^piata/.test(t)) return 'Piața';
  if (/^cale/.test(t)) return 'Calea';
  return null;
}

/**
 * One leg for the route column: street + number + locality.
 * Example: `Str. Republicii nr. 1F, Bolintin-Deal` — never site codes or glued tokens.
 */
function formatAddressLine(block) {
  if (!block) return null;
  const name = displayWords(block.streetName);
  const type = streetTypeLabel(block.streetType) || (name ? 'Str.' : null);
  const street = [type, name].filter(Boolean).join(' ');
  const nr = block.houseNumber ? `nr. ${block.houseNumber}` : null;
  const streetLine = [street, nr].filter(Boolean).join(' ');
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
    // Label patterns only — not place names.
    .replace(/\bsite(?:\s+livrare)?\s*[:\s]+[a-z]{2,4}\b/g, ' ')
    .replace(/\bdepozit\s*[:\s]+[a-z]{2,4}\b/g, ' ')
    .replace(/\bcs-[a-z0-9\-]+\b/g, ' ')
    .replace(/\bap-[a-z0-9\-]+\b/g, ' ')
    .replace(/\bc\d{8}\b/g, ' ')
    .replace(/\brou\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
      'adresa de livrare',
      'adresa livrare',
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

/** Short Site / Depozit code (`Site: BOL` → `Bol`). Any 2–4 letter code the form prints. */
function siteCodeFromText(folded) {
  if (!folded) return null;
  const m = folded.match(/\b(?:site(?:\s+(?:livrare|depozit))?|depozit)\s*[:\s]+([a-z]{2,4})\b/);
  if (!m?.[1]) return null;
  const code = m[1];
  if (/^(site|nr|str|rou?|sos)$/.test(code)) return null;
  return code.charAt(0).toUpperCase() + code.slice(1).toLowerCase();
}

/**
 * Origin from Expeditor first. If OCR dropped the "Expeditor" word, still accept Site/Depozit
 * BOL|MIL printed *before* Adresa de livrare — never from the delivery or Client blocks.
 */
function originFromExpeditor(blob) {
  const fromExpeditor = siteCodeFromText(fold(parseExpeditorSection(blob)));
  if (fromExpeditor) return fromExpeditor;

  const folded = fold(blob);
  let deliveryAt = -1;
  for (const label of ['adresa de livrare', 'adresa livrare']) {
    const i = folded.indexOf(label);
    if (i >= 0 && (deliveryAt < 0 || i < deliveryAt)) deliveryAt = i;
  }
  const head = deliveryAt >= 0 ? folded.slice(0, deliveryAt) : folded;
  // Drop Client / billing text that sometimes sits above the delivery label on odd OCR order.
  let clientAt = -1;
  for (const label of ['client factura', 'client factură', 'client:']) {
    const i = head.indexOf(label);
    if (i >= 0 && (clientAt < 0 || i < clientAt)) clientAt = i;
  }
  const loadSide = clientAt >= 0 ? head.slice(0, clientAt) : head;
  return siteCodeFromText(loadSide);
}

/** Street + locality under Expeditor (whatever street the document prints). */
export function parseExpeditorAddress(blob) {
  return parseDestBlock(parseExpeditorSection(blob));
}

/** The `Adresă de livrare` block, parsed. Where the lorry ends up, and what a zone is read from. */
export function parseDeliveryAddress(blob) {
  // Stop at Client factură / transport — never at the bare "Client" column header that sits
  // on the same row as "Adresă de livrare" in Baumit's two-column layout.
  const section = sliceSection(
    blob,
    ['adresa de livrare', 'adresa livrare'],
    [
      'client factura',
      'client factură',
      'referinta client',
      'referință client',
      'placuta de inmatriculare',
      'transportator',
      'comanda vanzare',
      'termeni de livrare',
      'solicitare client',
      'expeditor',
    ]
  );
  const foldedHead = fold(section).trimStart();
  const interleaved = /^(client\b|\S+\t)/.test(section.trimStart())
    || /\bc\d{8}\b/.test(foldedHead)
    || /\t/.test(section);
  return parseDestBlock(section, { interleaved });
}

/**
 * Always: [street + locality from Expeditor] / [street + locality from Adresa de livrare].
 * Example: `Str. Republicii nr. 1F, Bolintin-Deal / Șosea Viilor nr. 52, Bucuresti`.
 */
function parseRoute(blob) {
  const origin = formatAddressLine(parseExpeditorAddress(blob));
  const dest = formatAddressLine(parseDeliveryAddress(blob));
  if (origin && dest) return `${origin} / ${dest}`;
  if (dest) return dest;
  return origin;
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

  const psl = normalizeDocNo(pickRegex(blob, [/\b(PSL[\s\-\.]*\d[\d./-]*)\b/i]));
  const tro = normalizeDocNo(pickRegex(blob, [/\b(TRO[\s\-\.]*\d[\d./-]*)\b/i]));
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
      const parsedIsPackaging = ['galeti', 'saci', 'paleti'].includes(
        String(normalizeGoodsUnit(parsedTip) || parsedTip).toLowerCase(),
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
export function isFalseRoute(value) {
  const s = String(value || '').trim();
  if (!s) return true;
  // Bare 2–4 letter site code alone is not a route.
  if (/^[A-Za-zĂÂÎȘȚăâîșț]{2,4}$/u.test(s)) return true;
  // Glued hyphen, no slash: compound locality, not origin/destination.
  if (/^[A-Za-zĂÂÎȘȚăâîșț]+-[A-Za-zĂÂÎȘȚăâîșț]+$/u.test(s) && !/^[A-Za-z]{2,4}-/i.test(s)) {
    return true;
  }
  return false;
}

/**
 * Good: two legs with ` / `. Bad: glued codes, bare site codes, or a single leg
 * when the page has both Expeditor and Adresa de livrare labels.
 */
export function isSuspiciousRoute(value, rawText = null) {
  if (isFalseRoute(value)) return true;
  const s = String(value || '').trim();
  if (/\s\/\s/.test(s)) return false;
  // One leg only while the document clearly has both address labels → incomplete.
  if (rawText) {
    const folded = fold(rawText);
    const hasOrigin = folded.includes('expeditor');
    const hasDelivery = folded.includes('adresa de livrare') || folded.includes('adresa livrare');
    if (hasOrigin && hasDelivery) return true;
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
  // Fresh two-leg parse from labelled slices wins over a stale extract.
  // Office Editează is protected via corrected_fields in repairAvizFromStored.
  if (parsedRoute && /\s\/\s/.test(parsedRoute)) return parsedRoute;
  if (fieldFilled(stored) && !isFalseRoute(stored) && !isSuspiciousRoute(stored, rawText)) {
    return stored;
  }
  if (parsedRoute) return parsedRoute;
  return fieldFilled(stored) ? stored : null;
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
  if (storedUnit && !isGenericCountUnit(storedUnit)) return storedUnit;

  const fromParsed = normalizeGoodsUnit(parsed?.tip_marfa);
  if (fromParsed && !isGenericCountUnit(fromParsed)) return fromParsed;

  const fromUnit = normalizeGoodsUnit(row?.quantity_unit);
  if (fromUnit && !isGenericCountUnit(fromUnit)) return fromUnit;

  // Free-text product name (not a unit spelling) stays; bare "bucati" does not.
  if (fieldFilled(storedRaw) && !storedUnit) return String(storedRaw).trim();
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
  return {
    ...row,
    numar_tpo: resolveStoredTpo(row, parsed),
    data_efectuare_cursa: preferStored(row?.data_efectuare_cursa, parsed?.data_efectuare_cursa),
    numar_auto: preferStored(row?.numar_auto, parsed?.numar_auto, isGarbageAuto),
    ruta_transport: corrected.includes('ruta_transport')
      ? row.ruta_transport
      : preferRoute(row?.ruta_transport, parsed?.ruta_transport, raw),
    tip_marfa: preferTipMarfa(row, parsed),
    cantitate_marfa: preferQuantity(row, parsed),
    gross_weight_kg: row?.gross_weight_kg ?? parsed?.gross_weight_kg ?? null,
    net_weight_kg: row?.net_weight_kg ?? parsed?.net_weight_kg ?? null,
    numar_document_marfa: preferStored(row?.numar_document_marfa, parsed?.numar_document_marfa),
    // Derived, never stored and never edited: the delivery address exists only to answer
    // "which zone", and re-reading it from the OCR text each time means a document whose text
    // improves on re-extraction improves here too, with no column to keep in step.
    delivery_address: parsed?.delivery_address ?? null,
  };
}

export function avizFieldConfidence(row) {
  const raw = row?.extracted_data?.raw_text;
  const qtyLow = isGarbageQuantity(row?.cantitate_marfa, row?.tip_marfa)
    || quantityConflictsWithRaw(row?.cantitate_marfa, row?.tip_marfa, raw);
  return {
    numar_tpo: isExtractedGarbageTpo(row?.numar_tpo) ? 'low' : 'ok',
    numar_auto: isGarbageAuto(row?.numar_auto) ? 'low' : 'ok',
    ruta_transport: isSuspiciousRoute(row?.ruta_transport, raw) ? 'low' : 'ok',
    cantitate_marfa: qtyLow ? 'low' : 'ok',
  };
}

function confidenceRank(status) {
  return status === 'low' ? 1 : 0;
}

function worseConfidence(a, b) {
  return confidenceRank(a) >= confidenceRank(b) ? a : b;
}

/**
 * Prefer stored OCR field objects for the UI amber flags; fall back to heuristics
 * when a row predates field_confidence JSON or only has low/ok strings.
 * Heuristic "low" always wins over a stored "ok" — otherwise a wrong-but-confident
 * parse (Republicii17, first-line quantity 48) hides the review label.
 */
export function fieldConfidenceForUi(row) {
  const heuristic = avizFieldConfidence(row);
  const stored = row?.field_confidence;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return heuristic;

  const out = { ...heuristic };
  for (const [key, val] of Object.entries(stored)) {
    let fromStored = null;
    if (val === 'low' || val === 'ok') {
      fromStored = val;
    } else if (val && typeof val === 'object') {
      const status = val.status;
      if (status === 'ok') fromStored = 'ok';
      else if (status === 'review' || status === 'missing') fromStored = 'low';
      else if (typeof val.confidence === 'number') {
        fromStored = val.confidence >= 0.92 ? 'ok' : 'low';
      }
    }
    if (!fromStored) continue;
    out[key] = worseConfidence(heuristic[key] || 'ok', fromStored);
  }
  return out;
}

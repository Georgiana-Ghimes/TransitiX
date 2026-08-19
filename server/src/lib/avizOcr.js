/**
 * Extract + parse Baumit-style avize (PSL sales and TRO transfer).
 * PDF text layer first; Vision for images / text-poor PDFs; stub when unset.
 */
import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import { resolveUploadPath } from './cmrOcr.js';
import { annexFieldDefaults } from './avizTemplate.js';
import { isTextPoor, visionAnnotateImage, visionAnnotatePdf, visionApiKey } from './avizVision.js';
import { mapProviderToSource } from './avizQuery.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

/** pdf-parse can throw `bad XRef entry` on otherwise valid PDFs; retry a copy of the buffer. */
async function parsePdfTextLayer(buf) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const parsed = await pdfParse(Buffer.from(buf));
      const text = String(parsed?.text || '');
      if (text.trim()) return text;
    } catch (err) {
      lastErr = err;
      console.error('[aviz pdf-parse]', err.message || err, `attempt ${attempt + 1}`);
    }
  }
  if (lastErr) throw lastErr;
  return '';
}

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

const PLATE_RE = /\b([A-Z]{1,2})[-\s]?(\d{2,3})[-\s]?([A-Z]{2,3})\b/g;

export function extractPlates(value) {
  const s = normalizeWs(value).toUpperCase();
  const plates = [];
  const seen = new Set();
  let m;
  const re = new RegExp(PLATE_RE.source, 'g');
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
  if (labeled && labeled.length > 0 && labeled.length <= 40) {
    if (/document de test|fara valoare|materiale demonstrative|aviz de expeditie|buildtest/.test(labeled)) {
      return null;
    }
    return labeled.replace(/\s+/g, ' ').toUpperCase();
  }
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

function normalizeTpo(value, minDigits = 1) {
  if (!value) return null;
  const n = Number(minDigits) >= 1 ? Number(minDigits) : 1;
  const m = String(value).toUpperCase().match(new RegExp(`TPO[\\s\\-\\.]*(\\d{${n},})`));
  return m ? `TPO-${m[1]}` : null;
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

const UNIT_RANK = { galeti: 4, saci: 3, paleti: 2, bucati: 1 };

function parseQty(blob) {
  const folded = fold(blob);
  const galetiLabel = folded.match(/numarul de galeti\s+([\d.,]+)/);
  if (galetiLabel) {
    const qty = Number(String(galetiLabel[1]).replace(',', '.'));
    if (!Number.isNaN(qty) && qty > 0) return { qty, tip: 'galeti', rank: 4 };
  }

  const re = /(\d+(?:[.,]\d+)?)\s*(saci?|pal(?:eti|et[ie]?)?|buc(?:ati)?|pcs|gal(?:eti)?|gale(?:ti|ata|ata)?)\b/gi;
  let best = null;
  let match;
  while ((match = re.exec(blob)) !== null) {
    const rawUnit = fold(match[2]);
    let mapped = 'saci';
    if (rawUnit.startsWith('pal')) mapped = 'paleti';
    else if (rawUnit.startsWith('buc') || rawUnit === 'pcs') mapped = 'bucati';
    else if (rawUnit.startsWith('gal')) mapped = 'galeti';
    const qty = Number(String(match[1]).replace(',', '.'));
    if (Number.isNaN(qty)) continue;
    const rank = UNIT_RANK[mapped] || 0;
    if (!best || rank > best.rank) best = { qty, tip: mapped, rank };
  }
  return best;
}

function prettyPlace(value) {
  const parts = fold(value).split(/[^a-z]+/).filter((p) => p.length >= 2);
  if (!parts.length) return null;
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function formatHouseNumber(number) {
  const s = String(number || '').replace(/\s+/g, '');
  if (!s) return '';
  return s.replace(/[a-z]+/g, (m) => m.toUpperCase());
}

function compactStreet(name, number) {
  const street = prettyPlace(name);
  if (!street) return null;
  const num = formatHouseNumber(number);
  return num ? `${street}${num}` : street;
}

function sliceSection(blob, startLabels, stopLabels) {
  const folded = fold(blob);
  let start = -1;
  let labelLen = 0;
  for (const label of startLabels) {
    const fl = fold(label);
    const i = folded.indexOf(fl);
    if (i >= 0 && (start === -1 || i < start)) {
      start = i;
      labelLen = fl.length;
    }
  }
  if (start < 0) return '';
  const from = start + labelLen;
  let end = folded.length;
  for (const stop of stopLabels) {
    const i = folded.indexOf(fold(stop), from);
    if (i > from && i < end) end = i;
  }
  return folded.slice(from, end);
}

function parseDestBlock(section) {
  if (!section || !String(section).trim()) return { locality: null, street: null };
  const folded = fold(section)
    .replace(/bucurestisector/g, 'bucuresti sector')
    .replace(/([a-z])sector(\d)/g, '$1 sector $2');
  const skipLocality = /^(bolintin|deal|republicii|rou|romania|sector|lohn|obi|pagina)$/;
  const streetStop = /^(nr|numar|sector|ro|rou|romania|bucuresti|domnesti|dobroesti|militari|fundeni|comanesti|popesti)$/;
  const typeMatch = folded.match(
    /(?:strada|str\.?|sosea|sos\.?|bulevardul|blvd\.?|bld\.?|bvd\.?|b-dul|bdul|bd\.?|aleea|al\.|piata|pta\.?|calea)\s+([a-z]+)(?:\s+([a-z]+))?/
  );
  const nrMatch = folded.match(/\bnr\.?\s*(\d+[a-z\-]*)/);
  let streetName = null;
  if (typeMatch) {
    streetName = typeMatch[1];
    if (typeMatch[2] && !streetStop.test(typeMatch[2])) {
      streetName = `${typeMatch[1]} ${typeMatch[2]}`;
    }
  } else if (nrMatch) {
    const loose = folded.match(/([a-z]{4,})(?:\s+([a-z]{3,}))?\s+nr\.?\s*\d+/);
    if (loose) {
      streetName = loose[1];
      if (loose[2] && !streetStop.test(loose[2])) {
        streetName = `${loose[1]} ${loose[2]}`;
      }
    }
  }

  let localityRaw = null;
  if (/\bbucuresti\b/.test(folded)) localityRaw = 'bucuresti';
  else {
    const locMatch = folded.match(/(?<![a-z0-9]-)\b(domnesti|dobroesti|militari|fundeni|comanesti|popesti)\b/);
    localityRaw = locMatch?.[1] || null;
  }
  if (!localityRaw) {
    const beforePostal = folded.match(
      /\b([a-z][a-z\-]{2,})\s+(?:sector\s*\d+\s+)?ro\s*\d{5}/
    );
    if (beforePostal?.[1] && !skipLocality.test(beforePostal[1])) {
      localityRaw = beforePostal[1];
    }
  }

  const locality = localityRaw ? prettyPlace(localityRaw) : null;
  const street = compactStreet(streetName, nrMatch?.[1]);
  return { locality, street };
}

function formatRouteLeg(block) {
  if (!block) return null;
  if (block.locality && block.street) return `${block.locality}/${block.street}`;
  return block.street || block.locality || null;
}

/** Client site (C23000014 AP-… + street), not Client factură and not Expeditor. */
function findClientOrigin(blob) {
  const folded = fold(blob);
  const re = /\bc\d{8}\b/g;
  let best = { locality: null, street: null };
  let bestScore = 0;
  let m;
  while ((m = re.exec(folded)) !== null) {
    const window = folded.slice(m.index, m.index + 320);
    const parsed = parseDestBlock(window);
    if (!parsed.locality && !parsed.street) continue;
    let score = 0;
    if (parsed.street) score += 2;
    if (parsed.locality) score += 1;
    if (/\bap-/.test(window)) score += 3;
    if (score >= bestScore) {
      best = parsed;
      bestScore = score;
    }
  }
  return best;
}

function originFromSite(blob) {
  const folded = fold(blob);
  if (/\bsite(?:\s+livrare)?\s*[:\s]+bol\b/.test(folded) || /\bsite:\s*bol\b/.test(folded)) return 'Bol';
  if (
    /\bsite(?:\s+livrare)?\s*[:\s]+mil\b/.test(folded)
    || /\bdepozit\s*[:\s]+mil\b/.test(folded)
    || /\bsite\s+depozit\s*[:\s]+mil\b/.test(folded)
  ) {
    return 'Mil';
  }
  return null;
}

/**
 * Start = Client address (e.g. Aeroportului 120-T).
 * End = Adresă de livrare (e.g. Viilor 52).
 * Site BOL/MIL is only a fallback when the Client block has no street (TRO).
 * Never use Expeditor Bolintin-Deal.
 */
function parseRoute(blob) {
  const delivery = sliceSection(
    blob,
    ['adresa de livrare', 'adresa livrare'],
    [
      'pagina',
      'pagină',
      'client factura',
      'client factură',
      'client',
      'placuta de inmatriculare',
      'transportator',
      'comanda vanzare',
      'termeni de livrare',
    ]
  );
  const destLeg = formatRouteLeg(parseDestBlock(delivery));
  const originLeg = formatRouteLeg(findClientOrigin(blob));
  const site = originFromSite(blob);

  if (originLeg && destLeg && originLeg !== destLeg) return `${originLeg}-${destLeg}`;
  if (site && destLeg) return `${site}-${destLeg}`;
  if (destLeg) return destLeg;
  if (originLeg) return originLeg;
  return site;
}

/**
 * Parse OCR / PDF plain text into Anexa Factura RAI fields.
 * Baumit PDFs often emit one word per line — join before matching.
 */
export function parseBaumitAviz(rawText) {
  const lines = String(rawText || '')
    .replace(/\r/g, '')
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
  const defaults = annexFieldDefaults();

  return {
    ...defaults,
    numar_tpo,
    data_efectuare_cursa,
    numar_auto,
    ruta_transport: parseRoute(blob),
    tip_marfa: qty?.tip || null,
    cantitate_marfa: qty?.qty ?? null,
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
  if (s.length > 48) return true;
  return /document de test|fara valoare|materiale demonstrative|buildtest/i.test(s);
}

function preferStored(stored, parsedValue, isGarbage) {
  if (fieldFilled(stored) && !(isGarbage && isGarbage(stored))) return stored;
  return parsedValue ?? (fieldFilled(stored) ? stored : null);
}

/** Fill empty/garbage fields from stored OCR text. Never overwrite office Editează values. */
export function repairAvizFromStored(row) {
  const raw = row?.extracted_data?.raw_text;
  const parsed = raw ? parseBaumitAviz(raw) : null;
  return {
    ...row,
    numar_tpo: resolveStoredTpo(row, parsed),
    data_efectuare_cursa: preferStored(row?.data_efectuare_cursa, parsed?.data_efectuare_cursa),
    numar_auto: preferStored(row?.numar_auto, parsed?.numar_auto, isGarbageAuto),
    ruta_transport: preferStored(row?.ruta_transport, parsed?.ruta_transport),
    tip_marfa: preferStored(row?.tip_marfa, parsed?.tip_marfa),
    cantitate_marfa: row?.cantitate_marfa ?? parsed?.cantitate_marfa ?? null,
    numar_document_marfa: preferStored(row?.numar_document_marfa, parsed?.numar_document_marfa),
  };
}

export function avizFieldConfidence(row) {
  return {
    numar_tpo: isExtractedGarbageTpo(row?.numar_tpo) ? 'low' : 'ok',
    numar_auto: isGarbageAuto(row?.numar_auto) ? 'low' : 'ok',
    ruta_transport: fieldFilled(row?.ruta_transport) ? 'ok' : 'low',
  };
}

export function stubAvizFields() {
  return {
    ...annexFieldDefaults(),
    layout: null,
    _stub: true,
    _note: 'OCR stub: completează manual. Configurează GOOGLE_VISION_API_KEY pentru imagini, sau încarcă un PDF cu text.',
  };
}

export async function extractAvizFromFile(fileUrl) {
  const localPath = resolveUploadPath(fileUrl);
  if (!localPath) {
    const err = new Error('Could not resolve file path for aviz OCR');
    err.code = 'AVIZ_NO_FILE';
    throw err;
  }

  const buf = await fs.readFile(localPath);
  const ext = path.extname(localPath).toLowerCase();
  const apiKey = visionApiKey();
  let rawText = '';
  let provider = 'stub';

  if (ext === '.pdf') {
    try {
      rawText = await parsePdfTextLayer(buf);
      if (!isTextPoor(rawText)) provider = 'pdf_text';
    } catch (err) {
      console.error('[aviz pdf-parse]', err.message || err);
    }
    if (provider !== 'pdf_text' && apiKey) {
      try {
        rawText = await visionAnnotatePdf(buf, apiKey);
        provider = 'google_vision';
      } catch (err) {
        console.error('[aviz vision pdf]', err.message || err);
      }
    }
  } else if (apiKey) {
    try {
      rawText = await visionAnnotateImage(buf.toString('base64'), apiKey);
      provider = 'google_vision';
    } catch (err) {
      console.error('[aviz vision image]', err.message || err);
    }
  }

  if (!rawText.trim()) {
    const stub = stubAvizFields();
    return {
      ...stub,
      extraction_source: 'stub',
      extracted_data: { raw_text: '', parsed: stub, provider: 'stub' },
    };
  }

  const parsed = parseBaumitAviz(rawText);
  parsed._stub = false;
  parsed._provider = provider;
  const extraction_source = mapProviderToSource(provider);
  return {
    ...parsed,
    extraction_source,
    extracted_data: {
      raw_text: rawText.slice(0, 8000),
      parsed,
      provider,
    },
  };
}

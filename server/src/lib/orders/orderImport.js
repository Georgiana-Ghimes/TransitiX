/**
 * Order import from a spreadsheet the dispatcher already has.
 *
 * Everything here is pure: parsing, header mapping, matching and validation. The route
 * reads the file and writes rows; this module decides what the file *means*, so the
 * ambiguous parts (Romanian decimals, dd.mm.yyyy, which location a line points at) are
 * testable without a database.
 *
 * The import never guesses a location. A line whose location cannot be matched is
 * reported as an error, because an order without a location can never be planned — the
 * same rule the manual form enforces.
 */

import { addressKey, stripDiacritics } from '../geo/address.js';

/** Hard cap so one pasted file cannot lock the API for a minute. */
export const MAX_IMPORT_ROWS = 500;

/** Column aliases, normalized: lowercase, no diacritics, single spaces. */
const HEADER_ALIASES = {
  order_number: ['numar comanda', 'nr comanda', 'numar', 'nr', 'comanda', 'order', 'order number', 'order_number'],
  client_name: ['client', 'beneficiar', 'customer', 'client name'],
  location_name: ['locatie', 'punct de lucru', 'punct', 'destinatie', 'location'],
  address: ['adresa', 'adresa livrare', 'address'],
  city: ['oras', 'localitate', 'city'],
  type: ['tip', 'tip comanda', 'type'],
  requested_date: ['data', 'data livrare', 'data cursa', 'date', 'requested date'],
  window_start: ['fereastra de la', 'de la', 'ora de la', 'interval de la', 'window start'],
  window_end: ['fereastra pana la', 'pana la', 'ora pana la', 'interval pana la', 'window end'],
  service_time_min: ['timp servire', 'timp descarcare', 'minute servire', 'service time'],
  weight_kg: ['greutate', 'greutate kg', 'kg', 'weight'],
  volume_mc: ['volum', 'volum mc', 'mc', 'volume'],
  pallets: ['paleti', 'nr paleti', 'palets', 'pallets'],
  requires: ['cerinte', 'cerinte vehicul', 'requires'],
  goods_description: ['marfa', 'descriere', 'descriere marfa', 'goods'],
  notes: ['note', 'notite', 'observatii', 'mentiuni', 'notes'],
};

const TYPE_ALIASES = {
  livrare: 'livrare',
  livrari: 'livrare',
  delivery: 'livrare',
  l: 'livrare',
  ridicare: 'ridicare',
  colectare: 'ridicare',
  pickup: 'ridicare',
  r: 'ridicare',
  schimb: 'schimb',
  exchange: 'schimb',
  s: 'schimb',
};

export function normalizeHeader(value) {
  return stripDiacritics(String(value ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Which column holds which field. Unknown columns are reported rather than dropped
 * silently — a misspelled header is the most common reason an import "loses" data.
 */
export function mapHeaders(headerRow = []) {
  const fields = {};
  const unknown = [];
  const duplicates = [];

  headerRow.forEach((raw, index) => {
    const normalized = normalizeHeader(raw);
    if (!normalized) return;
    const field = Object.keys(HEADER_ALIASES)
      .find((key) => HEADER_ALIASES[key].includes(normalized));
    if (!field) {
      unknown.push(String(raw).trim());
      return;
    }
    if (fields[field] != null) {
      duplicates.push(String(raw).trim());
      return;
    }
    fields[field] = index;
  });

  return { fields, unknown, duplicates };
}

/**
 * Splits a delimited file into rows.
 *
 * The delimiter is sniffed instead of assumed: Romanian Excel writes `;` because the
 * locale uses `,` as the decimal separator, but an export from a web tool is usually `,`.
 */
export function parseDelimited(text) {
  const clean = String(text ?? '').replace(/^\uFEFF/, '');
  if (!clean.trim()) return [];
  const delimiter = sniffDelimiter(clean);

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];

    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }

    if (char === '"') { quoted = true; continue; }
    if (char === delimiter) { row.push(field); field = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }
  row.push(field);
  rows.push(row);

  return rows
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ''));
}

function sniffDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  let best = ',';
  let bestCount = 0;
  for (const candidate of [';', ',', '\t', '|']) {
    let count = 0;
    let quoted = false;
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted;
      else if (char === candidate && !quoted) count += 1;
    }
    if (count > bestCount) { best = candidate; bestCount = count; }
  }
  return best;
}

/**
 * Romanian spreadsheets mix separators: "1.234,56", "1234,56" and "1234.56" all appear,
 * sometimes in one file. The rightmost separator wins when both are present.
 * A lone dot with exactly three digits after it is thousands ("1.500" is 1500 kg) —
 * nobody writes a dot-three-zeros to mean one and a half.
 */
export function parseNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  let text = String(value).trim().replace(/\s/g, '');
  if (!text) return null;
  text = text.replace(/[^\d.,-]/g, '');
  if (!text || text === '-') return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    text = text.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    text = text.replace(/,/g, '.');
  } else if (lastDot >= 0) {
    const decimals = text.length - lastDot - 1;
    const onlyOneDot = text.indexOf('.') === lastDot;
    if (onlyOneDot && decimals === 3) text = text.replace('.', '');
    else if (!onlyOneDot) text = text.split('.').join('');
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function pad(value) {
  return String(value).padStart(2, '0');
}

function isoFromParts(year, month, day) {
  if (!(year >= 1970 && year <= 2999)) return null;
  if (!(month >= 1 && month <= 12)) return null;
  if (!(day >= 1 && day <= 31)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Date as YYYY-MM-DD. Accepts what a spreadsheet actually produces: a real Date, an
 * Excel serial, `dd.mm.yyyy`, `dd/mm/yyyy` and ISO. Day-first, because the file comes
 * from a Romanian office — `03.04.2026` is 3 April, never 4 March.
 */
export function parseImportDate(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return isoFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 20000 || value > 80000) return null;
    const date = new Date(EXCEL_EPOCH_MS + Math.round(value) * 86_400_000);
    return isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const text = String(value).trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayFirst = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
  if (dayFirst) {
    let year = Number(dayFirst[3]);
    if (year < 100) year += 2000;
    return isoFromParts(year, Number(dayFirst[2]), Number(dayFirst[1]));
  }

  return null;
}

/** Time as HH:MM. "8" means 08:00; a spreadsheet time cell arrives as a Date. */
export function parseImportTime(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const fraction = value - Math.floor(value);
    if (fraction <= 0 && value !== 0) return null;
    const minutes = Math.round(fraction * 24 * 60);
    return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
  }

  const text = String(value).trim();
  if (!text) return null;

  const match = text.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  if (hours > 23 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}

export function parseRequires(value) {
  if (value == null || value === '') return [];
  return String(value)
    .split(/[,;/|]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 10);
}

export function parseOrderType(value) {
  const normalized = normalizeHeader(value);
  if (!normalized) return 'livrare';
  return TYPE_ALIASES[normalized] || null;
}

function textKey(value) {
  return stripDiacritics(String(value ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Lookup tables for matching a spreadsheet line to a stored location.
 * A name is only usable as a key when it is unambiguous — two locations called "Depozit"
 * must not silently resolve to whichever was loaded first.
 */
export function indexLocations(locations = []) {
  const byName = new Map();
  const byAddressKey = new Map();
  const ambiguousNames = new Set();

  for (const location of locations) {
    if (location.is_active === false) continue;

    const nameHit = textKey(location.name);
    if (nameHit) {
      if (byName.has(nameHit)) ambiguousNames.add(nameHit);
      else byName.set(nameHit, location);
    }

    const key = location.address_key || (location.address ? addressKey(location.address) : null);
    if (key && !byAddressKey.has(key)) byAddressKey.set(key, location);
  }

  for (const name of ambiguousNames) byName.delete(name);
  return { byName, byAddressKey, ambiguousNames };
}

/**
 * Resolves one line to a location: exact name first, then the deduplication key the rest
 * of the geo pipeline already uses, so an address written slightly differently still lands
 * on the same pin.
 */
export function matchLocation(index, { location_name, address, city } = {}) {
  const nameHit = textKey(location_name);
  if (nameHit) {
    if (index.ambiguousNames?.has(nameHit)) {
      return { location: null, reason: 'nume_ambiguu' };
    }
    const byName = index.byName.get(nameHit);
    if (byName) return { location: byName, reason: 'nume' };
  }

  const rawAddress = String(address || '').trim();
  if (rawAddress) {
    // The city is often its own column, and `address_key` needs it to be part of the
    // address string — otherwise the same street in two towns collapses to one key.
    const withCity = city && !textKey(rawAddress).includes(textKey(city))
      ? `${city}, ${rawAddress}`
      : rawAddress;
    const byAddress = index.byAddressKey.get(addressKey(withCity));
    if (byAddress) return { location: byAddress, reason: 'adresa' };
  }

  return { location: null, reason: nameHit || rawAddress ? 'negasit' : 'lipsa' };
}

export function indexClients(clients = []) {
  const byName = new Map();
  for (const client of clients) {
    if (client.is_active === false) continue;
    const key = textKey(client.name);
    if (key && !byName.has(key)) byName.set(key, client);
  }
  return byName;
}

function cellAt(row, index) {
  if (index == null) return null;
  const value = row[index];
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  return value;
}

/**
 * Turns one spreadsheet line into an order draft plus the reasons it cannot be saved.
 * Warnings are things the dispatcher should see but that do not block the import.
 */
export function parseImportRow(row, { fields, locationIndex, clientIndex, defaultDate } = {}) {
  const errors = [];
  const warnings = [];
  const raw = {};
  for (const [field, index] of Object.entries(fields || {})) raw[field] = cellAt(row, index);

  const orderNumber = raw.order_number == null ? '' : String(raw.order_number).trim();
  if (!orderNumber) errors.push('Lipsește numărul comenzii');

  const requestedDate = parseImportDate(raw.requested_date) || defaultDate || null;
  if (!requestedDate) errors.push('Data lipsește sau nu poate fi citită');
  else if (raw.requested_date != null && !parseImportDate(raw.requested_date)) {
    warnings.push('Data nu a putut fi citită — s-a folosit data selectată');
  }

  const type = parseOrderType(raw.type);
  if (type == null) errors.push(`Tip necunoscut: „${raw.type}”`);

  const match = matchLocation(locationIndex || { byName: new Map(), byAddressKey: new Map() }, raw);
  if (!match.location) {
    if (match.reason === 'nume_ambiguu') {
      errors.push(`Există mai multe locații cu numele „${raw.location_name}”`);
    } else if (match.reason === 'lipsa') {
      errors.push('Lipsește locația (nume sau adresă)');
    } else {
      errors.push('Locația nu există — adaug-o din Locații și reia importul');
    }
  }

  const client = raw.client_name ? clientIndex?.get(textKey(raw.client_name)) : null;
  if (raw.client_name && !client) warnings.push(`Clientul „${raw.client_name}” nu există — comanda rămâne fără client`);

  const windowStart = raw.window_start == null ? null : parseImportTime(raw.window_start);
  const windowEnd = raw.window_end == null ? null : parseImportTime(raw.window_end);
  if (raw.window_start != null && !windowStart) warnings.push('Ora de început nu a putut fi citită');
  if (raw.window_end != null && !windowEnd) warnings.push('Ora de sfârșit nu a putut fi citită');
  if (windowStart && windowEnd && windowStart >= windowEnd) {
    errors.push('Fereastra de livrare se termină înainte să înceapă');
  }

  const numbers = {};
  for (const [field, label] of [
    ['weight_kg', 'Greutatea'],
    ['volume_mc', 'Volumul'],
    ['pallets', 'Numărul de paleți'],
    ['service_time_min', 'Timpul de servire'],
  ]) {
    if (raw[field] == null) { numbers[field] = null; continue; }
    const parsed = parseNumber(raw[field]);
    if (parsed == null) { warnings.push(`${label} nu a putut fi citit — se ignoră`); numbers[field] = null; }
    else if (parsed < 0) { errors.push(`${label} nu poate fi negativ`); numbers[field] = null; }
    else numbers[field] = parsed;
  }

  const order = {
    order_number: orderNumber,
    client_id: client?.id || null,
    location_id: match.location?.id || null,
    type: type || 'livrare',
    requested_date: requestedDate,
    window_start: windowStart,
    window_end: windowEnd,
    service_time_min: numbers.service_time_min == null
      ? (match.location?.default_service_time_min ?? 15)
      : Math.round(numbers.service_time_min),
    weight_kg: numbers.weight_kg ?? 0,
    volume_mc: numbers.volume_mc ?? 0,
    pallets: numbers.pallets == null ? 0 : Math.round(numbers.pallets),
    requires: parseRequires(raw.requires),
    goods_description: raw.goods_description == null ? null : String(raw.goods_description).slice(0, 500),
    notes: raw.notes == null ? null : String(raw.notes).slice(0, 500),
  };

  return {
    order,
    errors,
    warnings,
    matched: match.location
      ? { location_name: match.location.name, matched_by: match.reason, geocoded: match.location.latitude != null }
      : null,
    client_name: client?.name || (raw.client_name == null ? null : String(raw.client_name)),
  };
}

/**
 * The whole file, decided line by line.
 *
 * Duplicates are checked both against the database and inside the file itself, because a
 * spreadsheet that lists the same order twice would otherwise fail halfway through the
 * insert and leave the dispatcher with a partial import.
 */
export function buildImportPlan(rows = [], {
  locations = [],
  clients = [],
  existingNumbers = [],
  defaultDate = null,
} = {}) {
  if (!rows.length) {
    return { rows: [], summary: emptySummary(), headers: { fields: {}, unknown: [], duplicates: [] } };
  }

  const headers = mapHeaders(rows[0]);
  const body = rows.slice(1, MAX_IMPORT_ROWS + 1);
  const truncated = Math.max(0, rows.length - 1 - body.length);

  const locationIndex = indexLocations(locations);
  const clientIndex = indexClients(clients);
  const taken = new Set(existingNumbers.map((n) => String(n).trim().toLowerCase()).filter(Boolean));
  const seen = new Set();

  const parsed = body.map((row, offset) => {
    const result = parseImportRow(row, { fields: headers.fields, locationIndex, clientIndex, defaultDate });
    const key = result.order.order_number.toLowerCase();

    if (key) {
      if (taken.has(key)) result.errors.push('Există deja o comandă cu acest număr');
      else if (seen.has(key)) result.errors.push('Numărul se repetă în fișier');
      else seen.add(key);
    }

    return { line: offset + 2, status: result.errors.length ? 'eroare' : 'ok', ...result };
  });

  // Index 0 is a perfectly good column, so these are presence checks, not truthiness ones.
  const hasNumber = headers.fields.order_number != null;
  const hasPlace = headers.fields.location_name != null || headers.fields.address != null;
  if (!hasNumber || !hasPlace) {
    return {
      rows: parsed,
      headers,
      truncated,
      summary: { ...emptySummary(), total: parsed.length, errors: parsed.length },
      fatal: 'Fișierul are nevoie de o coloană „Număr comandă” și una „Locație” sau „Adresă”',
    };
  }

  return {
    rows: parsed,
    headers,
    truncated,
    summary: {
      total: parsed.length,
      ok: parsed.filter((r) => r.status === 'ok').length,
      errors: parsed.filter((r) => r.status === 'eroare').length,
      warnings: parsed.filter((r) => r.warnings.length).length,
    },
  };
}

function emptySummary() {
  return { total: 0, ok: 0, errors: 0, warnings: 0 };
}

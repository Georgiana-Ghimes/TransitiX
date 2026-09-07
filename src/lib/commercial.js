/**
 * The vocabulary the commercial configuration screens share.
 *
 * A tariff is looked up by `vehicle_class` and a zone tax by `mma_kg`, and the two are different
 * things: the class is the commercial band a customer contracts for ("10t"), the MMA is what the
 * registration says the vehicle weighs fully loaded (19.000 kg). Typing "10t" into the MMA box
 * would price every zone tax in the fleet wrongly, so the screens keep them visibly apart and
 * this file is the one place the classes are named.
 */

/** The commercial bands the customer contracts for. Free text is still allowed. */
export const VEHICLE_CLASSES = ['2.5t', '3.5t', '7.5t', '10t', '12t', '20t', '24t', '40t'];

export const APPLIES_PER = [
  { value: 'trip', label: 'O dată pe cursă' },
  { value: 'stop', label: 'Pentru fiecare oprire' },
  { value: 'km', label: 'Pe kilometru' },
];

/** Must match tax_zones.kind CHECK: zone | county | city | custom. */
export const ZONE_KINDS = [
  { value: 'zone', label: 'Zonă (ex. București A/B)' },
  { value: 'city', label: 'Oraș' },
  { value: 'county', label: 'Județ' },
  { value: 'custom', label: 'Definită manual' },
];

/** Common RO county codes for the zone picker (not the full ISO list). */
export const ZONE_COUNTY_OPTIONS = [
  { code: 'B', label: 'B — București' },
  { code: 'IF', label: 'IF — Ilfov' },
  { code: 'CL', label: 'CL — Călărași' },
  { code: 'GR', label: 'GR — Giurgiu' },
  { code: 'PH', label: 'PH — Prahova' },
  { code: 'DB', label: 'DB — Dâmbovița' },
];

export const ZONE_CITY_SUGGESTIONS = [
  'Bucuresti', 'Voluntari', 'Otopeni', 'Popesti-Leordeni', 'Bragadiru',
  'Chiajna', 'Domnesti', 'Magurele', 'Pantelimon', 'Popesti Leordeni',
];

/**
 * HCGMB 514/2025 — taxa pe zi autorizație, MTMA > 5t, de la 01.01.2026.
 * First row (0–4999.99) is explicit 0 for light vehicles.
 */
export const PMB_ZONE_RATE_BANDS = [
  { mma_min_kg: 0, mma_max_kg: 4999.99, label: 'sub 5 t' },
  { mma_min_kg: 5000, mma_max_kg: 7500, label: '5 – 7,5 t' },
  { mma_min_kg: 7500.01, mma_max_kg: 12500, label: '7,5 – 12,5 t' },
  { mma_min_kg: 12500.01, mma_max_kg: 16000, label: '12,5 – 16 t' },
  { mma_min_kg: 16000.01, mma_max_kg: 22000, label: '16 – 22 t' },
  { mma_min_kg: 22000.01, mma_max_kg: 40000, label: '22 – 40 t' },
  { mma_min_kg: 40000.01, mma_max_kg: null, label: 'peste 40 t' },
];

export const PMB_ZONE_DAY_AMOUNTS = {
  ZA: [0, 363, 711, 1421, 2133, 2843, 3534],
  ZB: [0, 100, 183, 280, 363, 446, 547],
};

/** Ready-made București A/B definitions for one-click setup. */
export const BUCHAREST_ZONE_PRESETS = [
  {
    code: 'ZA',
    name: 'Zona A — București centru',
    kind: 'zone',
    priority: 20,
    blurb: 'Inelul central PMB. Taxă pe zi după MMA din talon (HCGMB 514/2025).',
    where: 'Județ B + oraș București',
    counties: ['B'],
    cities: ['Bucuresti'],
    exampleMmaKg: 19000,
    amountKey: 'ZA',
  },
  {
    code: 'ZB',
    name: 'Zona B — București + Ilfov limitrof',
    kind: 'zone',
    priority: 10,
    blurb: 'Centura interioară + localități IF tipice. Prioritate mai mică decât ZA.',
    where: 'Județ B/IF + București, Voluntari, Otopeni…',
    counties: ['B', 'IF'],
    cities: ['Bucuresti', 'Voluntari', 'Otopeni', 'Popesti-Leordeni', 'Bragadiru', 'Chiajna', 'Domnesti', 'Magurele'],
    exampleMmaKg: 19000,
    amountKey: 'ZB',
  },
];

export function pmbDayRatesFor(code) {
  const amounts = PMB_ZONE_DAY_AMOUNTS[String(code || '').toUpperCase()];
  if (!amounts) return [];
  return PMB_ZONE_RATE_BANDS.map((band, i) => ({
    ...band,
    amount: amounts[i],
    currency: 'RON',
    valid_from: '2026-01-01',
  }));
}

export function exampleZoneAmount(code, mmaKg = 19000) {
  const rates = pmbDayRatesFor(code);
  const mma = Number(mmaKg);
  const hit = rates.find((r) => mma >= r.mma_min_kg && (r.mma_max_kg == null || mma <= r.mma_max_kg));
  return hit?.amount ?? null;
}

/** Map common mistakes ("Bucuresti") to county codes. */
export function normaliseCountyToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const folded = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (folded === 'b' || folded === 'bucuresti' || folded === 'bucharest') return 'B';
  if (folded === 'if' || folded === 'ilfov') return 'IF';
  if (/^[a-z]{1,2}$/.test(folded)) return folded.toUpperCase();
  return raw.toUpperCase();
}

/** Split "B, IF" or "București; Voluntari" into clean tokens. */
export function splitMatcherList(value) {
  return String(value || '')
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Normalise matcher from API (object), form JSON string, or structured fields.
 */
export function parseZoneMatcher(raw) {
  if (raw == null || raw === '') {
    return { counties: [], cities: [], postcodes: [] };
  }
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { counties: [], cities: [], postcodes: [] };
    }
  }
  if (!obj || typeof obj !== 'object') {
    return { counties: [], cities: [], postcodes: [] };
  }
  return {
    counties: Array.isArray(obj.counties) ? obj.counties.map(String) : [],
    cities: Array.isArray(obj.cities) ? obj.cities.map(String) : [],
    postcodes: Array.isArray(obj.postcodes) ? obj.postcodes.map(String) : [],
  };
}

/** Build matcher JSONB payload; empty lists are omitted. Counties are normalised. */
export function buildZoneMatcher({ counties = [], cities = [], postcodes = [] } = {}) {
  const out = {};
  const c = [...new Set(
    counties.map((x) => normaliseCountyToken(x)).filter(Boolean),
  )];
  const citiesClean = cities.map((x) => String(x).trim()).filter(Boolean);
  const p = postcodes.map((x) => String(x).trim()).filter(Boolean);
  if (c.length) out.counties = c;
  if (citiesClean.length) out.cities = citiesClean;
  if (p.length) out.postcodes = p;
  return out;
}

export function matcherSummary(raw) {
  const m = parseZoneMatcher(raw);
  const bits = [];
  if (m.counties.length) {
    bits.push(m.counties.map((c) => {
      const opt = ZONE_COUNTY_OPTIONS.find((o) => o.code === c);
      return opt ? opt.label : `județ ${c}`;
    }).join(', '));
  }
  if (m.cities.length) bits.push(m.cities.join(', '));
  if (m.postcodes.length) bits.push(`CP ${m.postcodes.join(', ')}`);
  return bits.join(' · ') || 'fără zonă geografică';
}

export function classLabel(value) {
  const text = String(value ?? '').trim();
  return text || '—';
}

/** Romanian decimal in, number out; blank stays blank rather than becoming zero. */
export function parseAmount(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const num = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

export function formatAmount(value, decimals = 2) {
  const num = parseAmount(value);
  if (num === null) return '';
  return num.toLocaleString('ro-RO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatDate(value) {
  const text = String(value ?? '').slice(0, 10);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

/** `01.01.2026 → 30.06.2026`, or `din 01.01.2026` when the end is open. */
export function validityLabel(row) {
  const from = formatDate(row?.valid_from);
  const to = formatDate(row?.valid_to);
  if (from && to) return `${from} → ${to}`;
  if (from) return `din ${from}`;
  if (to) return `până la ${to}`;
  return 'oricând';
}

/**
 * Whether a row is the one in force today.
 *
 * The screen marks it because a tariff list is mostly history: without a marker, the first row
 * reads as the current one, and the first row is whatever sorted highest.
 */
export function isInForce(row, onDate = new Date().toISOString().slice(0, 10)) {
  const from = String(row?.valid_from ?? '').slice(0, 10);
  const to = String(row?.valid_to ?? '').slice(0, 10);
  if (from && from > onDate) return false;
  if (to && to < onDate) return false;
  return true;
}

/**
 * Groups tariff rows by vehicle class, newest first.
 *
 * History is the point of this screen: a report from March has to be recomputable with the
 * tariff that was in force in March, so old rows are never edited away — they are shown.
 */
export function groupTariffs(tariffs = []) {
  const byClass = new Map();
  for (const row of tariffs) {
    const key = String(row.vehicle_class ?? '').trim() || '—';
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key).push(row);
  }
  return [...byClass.entries()]
    .map(([vehicleClass, rows]) => ({
      vehicle_class: vehicleClass,
      rows: [...rows].sort((a, b) =>
        String(b.valid_from ?? '').localeCompare(String(a.valid_from ?? ''))),
    }))
    .sort((a, b) => a.vehicle_class.localeCompare(b.vehicle_class, 'ro', { numeric: true }));
}

/** An MMA bracket as the rate table shows it. */
export function bracketLabel(rate) {
  const min = rate?.mma_min_kg;
  const max = rate?.mma_max_kg;
  const kg = (v) => Number(v).toLocaleString('ro-RO');
  if (min != null && max != null) return `${kg(min)} – ${kg(max)} kg`;
  if (min != null) return `peste ${kg(min)} kg`;
  if (max != null) return `până la ${kg(max)} kg`;
  return 'orice MMA';
}

/**
 * What is wrong with a tariff before it is saved.
 *
 * A tariff with neither a per-trip nor a per-km rate produces a TPO line of zero that looks
 * deliberate, which is the failure this whole screen exists to prevent.
 */
export function validateTariff(form) {
  const errors = {};
  if (!String(form.contract_id || '').trim()) errors.contract_id = 'Alege contractul.';
  if (!String(form.vehicle_class || '').trim()) errors.vehicle_class = 'Alege clasa de vehicul.';
  if (!String(form.valid_from || '').trim()) errors.valid_from = 'Pune data de la care se aplică.';
  if (form.valid_to && form.valid_from && form.valid_to < form.valid_from) {
    errors.valid_to = 'Data de sfârșit e înaintea celei de început.';
  }
  const trip = parseAmount(form.trip_rate);
  const km = parseAmount(form.km_rate);
  if (trip === null && km === null) {
    errors.trip_rate = 'Pune cel puțin un tarif — pe cursă sau pe kilometru.';
  }
  if (trip !== null && trip < 0) errors.trip_rate = 'Tariful nu poate fi negativ.';
  if (km !== null && km < 0) errors.km_rate = 'Tariful nu poate fi negativ.';
  return errors;
}

export function validateZoneRate(form) {
  const errors = {};
  const min = parseAmount(form.mma_min_kg);
  const max = parseAmount(form.mma_max_kg);
  if (parseAmount(form.amount) === null) errors.amount = 'Pune suma taxei.';
  if (min !== null && max !== null && min > max) errors.mma_max_kg = 'MMA maxim e sub cel minim.';
  if (!String(form.valid_from || '').trim()) errors.valid_from = 'Pune data de la care se aplică.';
  return errors;
}

export function validateSurchargeRate(form) {
  const errors = {};
  if (parseAmount(form.amount) === null) errors.amount = 'Pune suma taxei.';
  if (!String(form.valid_from || '').trim()) errors.valid_from = 'Pune data de la care se aplică.';
  return errors;
}

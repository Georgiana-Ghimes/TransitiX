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

export const ZONE_KINDS = [
  { value: 'oras', label: 'Oraș / zonă centrală' },
  { value: 'judet', label: 'Județ' },
  { value: 'custom', label: 'Definită manual' },
];

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

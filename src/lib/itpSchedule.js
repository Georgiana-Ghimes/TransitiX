/**
 * Romanian ITP periodicity (RNTR 1 / Ordin MT 2133/2005).
 *
 * Companion default is transport marfă → +12 months after each inspection.
 * The date on the registration certificate remains authoritative; this only proposes.
 */

import { toDateIso } from './utils.js';

/** @typedef {'goods'|'passenger'|'trailer_light'|'trailer_heavy'|'taxi_bus'} ItpKind */

export const ITP_KIND_LABELS = {
  goods: 'Transport marfă (1 an)',
  passenger: 'Autoturism ≤8 locuri',
  trailer_light: 'Remorcă ≤3,5 t (2 ani)',
  trailer_heavy: 'Remorcă >3,5 t (1 an)',
  taxi_bus: 'Taxi / autobuz / închiriere (6 luni)',
};

/**
 * Infer kind for companion fleet. RAI lorries → goods.
 * Explicit `itp_kind` wins when set later.
 *
 * @param {object} [vehicle]
 * @returns {ItpKind}
 */
export function resolveItpKind(vehicle = {}) {
  const raw = String(vehicle?.itp_kind || vehicle?.itp_category || '').trim().toLowerCase();
  if (raw === 'goods' || raw === 'marfa' || raw === 'marfă') return 'goods';
  if (raw === 'passenger' || raw === 'autoturism' || raw === 'car') return 'passenger';
  if (raw === 'trailer_light' || raw === 'remorca_usoara') return 'trailer_light';
  if (raw === 'trailer_heavy' || raw === 'remorca') return 'trailer_heavy';
  if (raw === 'taxi_bus' || raw === 'taxi' || raw === 'bus') return 'taxi_bus';

  const mma = Number(vehicle?.mma_kg);
  // Light trailers are rare in this fleet; MTMA alone does not distinguish tractor vs trailer.
  // Default: goods transport (annual), which matches companion Autoturisme / avize.
  if (Number.isFinite(mma) && mma > 0) return 'goods';
  return 'goods';
}

/**
 * Months until the next ITP after a passed inspection (not the first-registration specials).
 *
 * @param {object} [vehicle]
 * @param {{ kind?: ItpKind, asOf?: Date|string }} [opts]
 * @returns {number}
 */
export function itpIntervalMonths(vehicle = {}, { kind, asOf } = {}) {
  const k = kind || resolveItpKind(vehicle);
  if (k === 'taxi_bus') return 6;
  if (k === 'trailer_light') return 24;
  if (k === 'trailer_heavy' || k === 'goods') return 12;
  if (k === 'passenger') {
    return passengerAgeYears(vehicle, asOf) >= 12 ? 12 : 24;
  }
  return 12;
}

/**
 * @param {object} vehicle
 * @param {Date|string} [asOf]
 */
export function passengerAgeYears(vehicle, asOf = new Date()) {
  const first = toDateIso(vehicle?.first_registration_date || vehicle?.first_registered_at);
  const ref = asOf instanceof Date ? asOf : new Date(asOf || Date.now());
  if (first) {
    const [y, m, d] = first.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    let age = ref.getFullYear() - start.getFullYear();
    const md = (ref.getMonth() + 1) * 100 + ref.getDate();
    const sd = m * 100 + d;
    if (md < sd) age -= 1;
    return Math.max(0, age);
  }
  const year = Number(vehicle?.year);
  if (Number.isFinite(year) && year >= 1950 && year <= ref.getFullYear()) {
    return Math.max(0, ref.getFullYear() - year);
  }
  return 0;
}

/**
 * Add calendar months, keeping day-of-month when possible (RNTR periods are in months/years).
 * 31 Jan + 1 month → 28/29 Feb.
 *
 * @param {string} iso YYYY-MM-DD
 * @param {number} months
 * @returns {string|null}
 */
export function addCalendarMonths(iso, months) {
  const base = toDateIso(iso);
  if (!base || !Number.isFinite(months)) return null;
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(y, m - 1, 1);
  dt.setMonth(dt.getMonth() + months);
  const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  dt.setDate(Math.min(d, lastDay));
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Proposed next ITP expiry after `fromDate` (usually current itp_expiry or inspection day).
 *
 * @param {object} [vehicle]
 * @param {string|Date|null|undefined} fromDate
 * @param {{ kind?: ItpKind }} [opts]
 * @returns {{ iso: string|null, months: number, kind: ItpKind, label: string }}
 */
export function nextItpExpiry(vehicle = {}, fromDate, opts = {}) {
  const kind = opts.kind || resolveItpKind(vehicle);
  const from = toDateIso(fromDate);
  const months = itpIntervalMonths(vehicle, { kind, asOf: from || undefined });
  const iso = from ? addCalendarMonths(from, months) : null;
  return {
    iso,
    months,
    kind,
    label: ITP_KIND_LABELS[kind] || ITP_KIND_LABELS.goods,
  };
}

/**
 * After an ITP is done: roll from the previous expiry when present, else from today.
 * Prefer rolling from the stored expiry so a late inspection still lands on the calendar cycle
 * the operator already tracked (they can override the date if the talon says otherwise).
 *
 * @param {object} vehicle
 * @param {{ today?: Date }} [opts]
 */
export function rollItpExpiry(vehicle, { today = new Date() } = {}) {
  const current = toDateIso(vehicle?.itp_expiry);
  const todayIso = toDateIso(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
  ) || toDateIso(today.toISOString());
  const from = current || todayIso;
  return nextItpExpiry(vehicle, from, { kind: resolveItpKind(vehicle) });
}

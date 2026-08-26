/**
 * Contractual rate lookup.
 *
 * Rates are negotiated per client and change by addendum, so they are never fetched from
 * anywhere and never edited in place. Each change adds a new validity period, and every
 * lookup is *as of a date* — a report for March must recompute with the March rate even if
 * the contract has been renegotiated twice since.
 */

/**
 * Normalises anything date-shaped to YYYY-MM-DD.
 *
 * pg hands back DATE columns as Date objects, so a raw query row and a serialised API row
 * arrive in different shapes. Accepting only strings meant every tariff silently failed to
 * match when the rows came straight from the database.
 */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : formatLocalDate(value);
  }
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/** Local calendar date, so a midnight-UTC DATE does not slip to the previous day. */
function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True when `onDate` falls inside [valid_from, valid_to]; an open end never expires. */
export function isValidOn(row, onDate) {
  const date = toDate(onDate);
  const from = toDate(row?.valid_from);
  if (!date || !from) return false;
  if (date < from) return false;
  const to = toDate(row?.valid_to);
  return !to || date <= to;
}

/**
 * The row in force on a date. When several overlap — which happens when someone forgets to
 * close the previous period — the one that started most recently wins, because that is the
 * addendum the parties signed last.
 */
export function pickValid(rows = [], onDate) {
  const candidates = rows.filter((row) => isValidOn(row, onDate));
  if (!candidates.length) return null;
  return candidates.reduce((best, row) => (
    toDate(row.valid_from) > toDate(best.valid_from) ? row : best
  ));
}

/**
 * Tariff for a vehicle class on a date.
 *
 * Falls back to a tariff with no class only if one exists — a contract that prices "10t"
 * and "20t" separately must not silently charge a 20t truck at the 10t rate.
 */
export function findTariff(tariffs = [], { vehicleClass, onDate }) {
  const exact = pickValid(
    tariffs.filter((t) => normaliseClass(t.vehicle_class) === normaliseClass(vehicleClass)),
    onDate
  );
  if (exact) return exact;
  return pickValid(tariffs.filter((t) => !t.vehicle_class), onDate);
}

/** "10 T", "10t", "10T" all mean the same commercial class. */
export function normaliseClass(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

export function num(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Rate history for one class, newest first — what the tariff screen shows. */
export function tariffHistory(tariffs = [], vehicleClass) {
  return tariffs
    .filter((t) => normaliseClass(t.vehicle_class) === normaliseClass(vehicleClass))
    .sort((a, b) => String(toDate(b.valid_from) ?? '').localeCompare(String(toDate(a.valid_from) ?? '')));
}

/**
 * Periods that overlap for the same class. Not an error — the newest still wins — but the
 * tariff screen should show it, because it is nearly always a forgotten `valid_to`.
 */
export function findOverlaps(tariffs = []) {
  const overlaps = [];
  const byClass = new Map();
  for (const tariff of tariffs) {
    const key = normaliseClass(tariff.vehicle_class);
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key).push(tariff);
  }

  for (const rows of byClass.values()) {
    const sorted = [...rows].sort((a, b) => String(toDate(a.valid_from) ?? '').localeCompare(String(toDate(b.valid_from) ?? '')));
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const next = sorted[i + 1];
      const currentTo = toDate(current.valid_to);
      if (!currentTo || currentTo >= toDate(next.valid_from)) {
        overlaps.push({ a: current, b: next });
      }
    }
  }
  return overlaps;
}

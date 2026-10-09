/**
 * ITP board helpers for companion Flotă → ITP.
 * Status / filters stay here so the screen and tests share one reading of “expirat”.
 */

import { DEFAULT_EXPIRY_HORIZON_DAYS } from './documentExpiry.js';
import { toDateIso } from './utils.js';

/** @typedef {'missing'|'expired'|'soon'|'ok'} ItpStatus */

/**
 * @param {string|Date|null|undefined} expiry
 * @param {{ now?: Date, horizonDays?: number }} [opts]
 * @returns {{ status: ItpStatus, daysLeft: number|null, label: string }}
 */
export function itpStatusFor(expiry, { now = new Date(), horizonDays = DEFAULT_EXPIRY_HORIZON_DAYS } = {}) {
  const iso = toDateIso(expiry);
  if (!iso) {
    return { status: 'missing', daysLeft: null, label: 'Lipsă' };
  }
  const end = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(end.getTime())) {
    return { status: 'missing', daysLeft: null, label: 'Lipsă' };
  }
  const start = new Date(now);
  start.setHours(12, 0, 0, 0);
  const daysLeft = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (daysLeft < 0) {
    return { status: 'expired', daysLeft, label: 'Expirat' };
  }
  if (daysLeft <= horizonDays) {
    return {
      status: 'soon',
      daysLeft,
      label: daysLeft === 0 ? 'Expiră azi' : `În ${daysLeft} zile`,
    };
  }
  return { status: 'ok', daysLeft, label: 'OK' };
}

/**
 * @param {object[]} vehicles
 * @param {{ now?: Date, horizonDays?: number }} [opts]
 */
export function summariseItpFleet(vehicles, opts = {}) {
  const counts = { missing: 0, expired: 0, soon: 0, ok: 0, total: 0 };
  for (const v of vehicles || []) {
    if (v?.is_active === false) continue;
    counts.total += 1;
    const { status } = itpStatusFor(v?.itp_expiry, opts);
    counts[status] += 1;
  }
  return counts;
}

/**
 * @param {object[]} vehicles
 * @param {'all'|'expired'|'soon'|'missing'} filter
 * @param {{ now?: Date, horizonDays?: number }} [opts]
 */
export function filterItpVehicles(vehicles, filter, opts = {}) {
  const list = (vehicles || []).filter((v) => v?.is_active !== false);
  if (!filter || filter === 'all') return list;
  return list.filter((v) => itpStatusFor(v?.itp_expiry, opts).status === filter);
}

/** True when ITP is past due (for Autoturisme row badge). */
export function itpExpired(expiry, now = new Date()) {
  return itpStatusFor(expiry, { now }).status === 'expired';
}

/**
 * The route as a driver sees it: a list of stops with one obvious next action.
 *
 * The dispatch board optimises for an overview; this optimises for someone holding a phone
 * in a truck cab. So there is exactly one primary button per stop, the current stop is
 * chosen for them, and nothing here needs two hands.
 */

import { toFiniteNumber } from './utils.js';

export const STOP_STATUS_META = {
  planificat: { label: 'De făcut', badge: 'bg-slate-100 text-slate-600 border-slate-200' },
  sosit: { label: 'Ajuns', badge: 'bg-sky-50 text-sky-700 border-sky-200' },
  finalizat: { label: 'Gata', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  esuat: { label: 'Eșuat', badge: 'bg-red-50 text-red-700 border-red-200' },
  sarit: { label: 'Sărit', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
};

export function stopStatusMeta(status) {
  return STOP_STATUS_META[status] || STOP_STATUS_META.planificat;
}

const CLOSED = new Set(['finalizat', 'esuat', 'sarit']);

export function isStopClosed(stop) {
  return CLOSED.has(stop?.status);
}

/**
 * The stop the driver is on: the first one not yet closed. A route where every stop is
 * done has no current stop, which is how the screen knows to show the finished state.
 */
export function currentStop(stops = []) {
  return stops.find((stop) => !isStopClosed(stop)) || null;
}

export function routeProgress(stops = []) {
  const total = stops.length;
  const done = stops.filter(isStopClosed).length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/**
 * The one button this stop needs next.
 *
 * A stop that has not been reached offers "arrived"; once arrived, the choice is done or
 * failed. A closed stop offers nothing — undoing is the dispatcher's job, not something a
 * driver should trip over while parking.
 */
export function stopActions(stop) {
  if (!stop || isStopClosed(stop)) return [];
  if (stop.status === 'sosit') {
    return [
      { status: 'finalizat', label: 'Gata', tone: 'primary' },
      { status: 'esuat', label: 'Nu s-a putut', tone: 'danger' },
    ];
  }
  return [{ status: 'sosit', label: 'Am ajuns', tone: 'primary' }];
}

/** Local HH:MM, or an em dash. Times are shown in the driver's own clock. */
export function formatClock(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

export function formatWindow(stop) {
  const from = String(stop?.window_start || '').slice(0, 5);
  const to = String(stop?.window_end || '').slice(0, 5);
  if (!from && !to) return '';
  return `${from || '…'}–${to || '…'}`;
}

/** "1.200 kg · 4 paleți" — only the parts that are actually set. */
export function formatStopLoad(stop) {
  const parts = [];
  const kg = toFiniteNumber(stop?.weight_kg);
  const pallets = toFiniteNumber(stop?.pallets);
  const volume = toFiniteNumber(stop?.volume_mc);
  if (kg) parts.push(`${kg.toLocaleString('ro-RO')} kg`);
  if (pallets) parts.push(`${pallets} ${pallets === 1 ? 'palet' : 'paleți'}`);
  if (volume) parts.push(`${volume.toLocaleString('ro-RO')} mc`);
  return parts.join(' · ');
}

export function stopAddress(stop) {
  return stop?.address_full || [stop?.address, stop?.city].filter(Boolean).join(', ');
}

export function stopPhone(stop) {
  return stop?.phone || stop?.client_phone || null;
}

/** Shifts a YYYY-MM-DD day, for the previous/next arrows. */
export function shiftDay(iso, days) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dayLabel(iso, today = new Date()) {
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (iso === stamp) return 'Azi';
  if (iso === shiftDay(stamp, 1)) return 'Mâine';
  if (iso === shiftDay(stamp, -1)) return 'Ieri';
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(iso || '');
}

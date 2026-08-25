/**
 * Display and decision helpers for the dispatch board.
 *
 * The board is the first screen where a dispatcher makes a plan rather than records one,
 * so everything that decides "is this allowed / is this a problem" lives here, pure and
 * tested, instead of inside the component.
 */

import { toFiniteNumber } from './utils.js';

export const ROUTE_STATUS_META = {
  draft: { label: 'Ciornă', badge: 'bg-slate-100 text-slate-600 border-slate-200' },
  planificata: { label: 'Planificată', badge: 'bg-sky-50 text-sky-700 border-sky-200' },
  lansata: { label: 'Lansată', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  in_executie: { label: 'În execuție', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  finalizata: { label: 'Finalizată', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  anulata: { label: 'Anulată', badge: 'bg-red-50 text-red-700 border-red-200' },
};

export function routeStatusMeta(status) {
  return ROUTE_STATUS_META[status] || ROUTE_STATUS_META.draft;
}

/** Colour ramp for stop markers — worst state wins. */
export function stopMarkerColor(stop, violations = []) {
  const hit = violations.find((v) => v.stop_id === stop.id);
  if (hit?.type === 'intarziere') return '#C0392B';
  if (hit?.type === 'prea_devreme') return '#F5A623';
  if (stop.planned_arrival == null) return '#94A3B8';
  return '#1D4E89';
}

/** "6h 47m" / "47m". Minutes only, because a route plan never needs seconds. */
export function formatDuration(minutes) {
  const total = toFiniteNumber(minutes);
  if (total == null || total < 0) return '—';
  const rounded = Math.round(total);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (!hours) return `${mins}m`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

/** Local HH:MM for a stored timestamp. Times are shown in the viewer's zone, never UTC. */
export function formatEta(value) {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

export function formatKm(value) {
  const num = toFiniteNumber(value);
  if (num == null) return '—';
  return `${num.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} km`;
}

/** Next free route code for a day: R-01, R-02, … */
export function nextRouteCode(existingCodes = []) {
  let max = 0;
  for (const code of existingCodes) {
    const match = String(code || '').match(/^R-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `R-${String(max + 1).padStart(2, '0')}`;
}

const num = (value) => toFiniteNumber(value) ?? 0;

/**
 * Would adding this order push the route past the vehicle?
 * Returns warnings, never a hard block: a dispatcher who knows the load will fit must be
 * able to plan it anyway, and the board shows the overflow rather than hiding the option.
 */
export function previewFit(order, totals, vehicle) {
  const warnings = [];
  if (!order) return warnings;

  const after = {
    weight_kg: num(totals?.weight_kg) + num(order.weight_kg),
    volume_mc: num(totals?.volume_mc) + num(order.volume_mc),
  };
  const checks = [
    { key: 'weight_kg', limit: vehicle?.capacity_kg, label: 'greutate', unit: 'kg' },
    { key: 'volume_mc', limit: vehicle?.capacity_mc, label: 'volum', unit: 'mc' },
  ];
  for (const check of checks) {
    if (check.limit == null || check.limit === '') continue;
    const limit = Number(check.limit);
    if (!Number.isFinite(limit) || limit <= 0) continue;
    if (after[check.key] > limit) {
      warnings.push({
        field: check.key,
        label: check.label,
        unit: check.unit,
        over: Math.round((after[check.key] - limit) * 100) / 100,
      });
    }
  }
  return warnings;
}

/** One-line problem summaries for a route card. */
export function routeWarnings(plan) {
  const out = [];
  for (const problem of plan?.capacityProblems || []) {
    out.push({
      level: 'error',
      text: `Depășire ${problem.label}: +${problem.over} ${problem.unit}`,
    });
  }
  const late = (plan?.windowViolations || []).filter((v) => v.type === 'intarziere');
  if (late.length) {
    out.push({
      level: 'error',
      text: late.length === 1
        ? `Oprirea ${late[0].seq} întârzie cu ${late[0].by_min} min`
        : `${late.length} opriri întârzie față de fereastră`,
    });
  }
  const early = (plan?.windowViolations || []).filter((v) => v.type === 'prea_devreme');
  if (early.length) {
    out.push({
      level: 'warn',
      text: early.length === 1
        ? `Oprirea ${early[0].seq} ajunge cu ${early[0].by_min} min prea devreme`
        : `${early.length} opriri ajung înainte de deschidere`,
    });
  }
  if (plan?.totals && plan.totals.complete === false) {
    out.push({ level: 'warn', text: 'Unele segmente nu au distanță — ETA-urile sunt incomplete' });
  }
  return out;
}

/** Orders still waiting to be planned, filtered and searched. */
export function unplannedOrders(orders = [], { date, search = '' } = {}) {
  const needle = String(search || '').trim().toLowerCase();
  return orders
    .filter((o) => o.status === 'nou')
    .filter((o) => !date || String(o.requested_date).slice(0, 10) === date)
    .filter((o) => {
      if (!needle) return true;
      return [o.order_number, o.client_name, o.goods_description]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    })
    .sort((a, b) => String(a.order_number).localeCompare(String(b.order_number), 'ro'));
}

export function dayTotals(orders = [], routes = []) {
  const planned = orders.filter((o) => o.status !== 'nou' && o.status !== 'anulat').length;
  return {
    orders: orders.length,
    unplanned: orders.filter((o) => o.status === 'nou').length,
    planned,
    routes: routes.length,
    distance_km: Math.round(routes.reduce((sum, r) => sum + num(r.planned_distance_km), 0) * 10) / 10,
    duration_min: routes.reduce((sum, r) => sum + num(r.planned_duration_min), 0),
  };
}

/** Guards the drop handler: a stop may only move inside its own route. */
export function canDropOnRoute(payload, routeId) {
  if (!payload) return false;
  if (payload.kind === 'order') return true;
  if (payload.kind === 'stop') return payload.routeId === routeId;
  return false;
}

export function parseDragPayload(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.kind === 'order' && parsed.orderId) return parsed;
    if (parsed?.kind === 'stop' && parsed.stopId && parsed.routeId) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Operational KPIs for the cockpit — pure aggregations over route/trip rows.
 */

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(part, whole) {
  if (whole == null || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * On-time: stop with actual_arrival <= planned_arrival + graceMin.
 */
export function punctuality({ stops = [], graceMin = 15 } = {}) {
  const countable = stops.filter(
    (s) => s
      && s.planned_arrival
      && s.actual_arrival
      && !['depot_start', 'depot_end', 'pauza', 'repaus'].includes(s.kind)
  );
  if (!countable.length) {
    return { sample: 0, on_time: 0, late: 0, rate_pct: null };
  }
  let onTime = 0;
  for (const s of countable) {
    const planned = Date.parse(s.planned_arrival);
    const actual = Date.parse(s.actual_arrival);
    if (!Number.isFinite(planned) || !Number.isFinite(actual)) continue;
    if (actual <= planned + graceMin * 60_000) onTime += 1;
  }
  const sample = countable.length;
  return {
    sample,
    on_time: onTime,
    late: sample - onTime,
    rate_pct: pct(onTime, sample),
  };
}

/**
 * Empty km: legs with no delivery/pickup cargo — approximate as depot→first and last→depot
 * when kind is known; else null.
 */
export function emptyKmShare({ legs = [] } = {}) {
  let total = 0;
  let empty = 0;
  for (const leg of legs) {
    const km = num(leg.distance_km);
    if (km == null || km < 0) continue;
    total += km;
    if (leg.empty) empty += km;
  }
  if (total <= 0) return { total_km: 0, empty_km: 0, empty_pct: null };
  return {
    total_km: Math.round(total * 10) / 10,
    empty_km: Math.round(empty * 10) / 10,
    empty_pct: pct(empty, total),
  };
}

export function fillRates({ used_kg, capacity_kg, used_mc, capacity_mc } = {}) {
  const kg = num(used_kg);
  const capKg = num(capacity_kg);
  const mc = num(used_mc);
  const capMc = num(capacity_mc);
  return {
    weight_pct: capKg > 0 && kg != null ? pct(kg, capKg) : null,
    volume_pct: capMc > 0 && mc != null ? pct(mc, capMc) : null,
  };
}

/**
 * Plan vs realized on a route.
 */
export function planVsActual(route = {}) {
  const pKm = num(route.planned_distance_km);
  const aKm = num(route.actual_distance_km);
  const pMin = num(route.planned_duration_min);
  const aMin = num(route.actual_duration_min);
  return {
    distance: {
      planned_km: pKm,
      actual_km: aKm,
      delta_km: pKm != null && aKm != null ? Math.round((aKm - pKm) * 10) / 10 : null,
    },
    duration: {
      planned_min: pMin,
      actual_min: aMin,
      delta_min: pMin != null && aMin != null ? Math.round(aMin - pMin) : null,
    },
  };
}

/**
 * Build cockpit summary from preloaded rows.
 */
export function buildCockpit({
  routes = [],
  stops = [],
  costs = [],
  orders = [],
} = {}) {
  const stopsByRoute = new Map();
  for (const s of stops) {
    const list = stopsByRoute.get(s.route_id) || [];
    list.push(s);
    stopsByRoute.set(s.route_id, list);
  }

  const punct = punctuality({ stops });
  let plannedKm = 0;
  let actualKm = 0;
  let plannedMin = 0;
  let actualMin = 0;
  let costTotal = 0;
  let costed = 0;

  const byRoute = routes.map((route) => {
    const pva = planVsActual(route);
    if (pva.distance.planned_km != null) plannedKm += pva.distance.planned_km;
    if (pva.distance.actual_km != null) actualKm += pva.distance.actual_km;
    if (pva.duration.planned_min != null) plannedMin += pva.duration.planned_min;
    if (pva.duration.actual_min != null) actualMin += pva.duration.actual_min;

    const cost = costs.find((c) => c.route_id === route.id);
    if (cost?.total != null) {
      costTotal += cost.total;
      costed += 1;
    }

    const routeStops = stopsByRoute.get(route.id) || [];
    return {
      id: route.id,
      code: route.code,
      status: route.status,
      route_date: route.route_date,
      ...pva,
      cost: cost || null,
      punctuality: punctuality({ stops: routeStops }),
      stops: routeStops.length,
    };
  });

  const delivered = orders.filter((o) => o.status === 'livrat').length;
  const openOrders = orders.filter((o) => !['livrat', 'esuat', 'anulat'].includes(o.status)).length;

  return {
    kpis: {
      punctuality_pct: punct.rate_pct,
      punctuality_sample: punct.sample,
      planned_km: Math.round(plannedKm * 10) / 10,
      actual_km: Math.round(actualKm * 10) / 10,
      delta_km: Math.round((actualKm - plannedKm) * 10) / 10,
      planned_hours: Math.round((plannedMin / 60) * 10) / 10,
      actual_hours: Math.round((actualMin / 60) * 10) / 10,
      cost_total: costed ? Math.round(costTotal * 100) / 100 : null,
      cost_per_route: costed ? Math.round((costTotal / costed) * 100) / 100 : null,
      orders_delivered: delivered,
      orders_open: openOrders,
      routes: routes.length,
    },
    routes: byRoute,
    punctuality: punct,
  };
}

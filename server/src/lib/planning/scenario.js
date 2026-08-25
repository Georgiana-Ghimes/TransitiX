/**
 * Fleet pairing and solve orchestration helpers that stay free of the database.
 *
 * The route handler loads the rows; these decide which vehicle gets which driver and what
 * a persisted scenario looks like, so both can be tested without Postgres.
 */

/**
 * Attach a driver to each vehicle.
 *
 * Preferred pairings (from routes already drafted for the day) win. Remaining vehicles take
 * remaining drivers in the order they were listed — a dispatcher who sorted the fleet by
 * preference gets that preference reflected in the solve.
 */
export function assignDrivers(vehicles = [], drivers = [], preferred = []) {
  const byId = new Map((drivers || []).map((d) => [d.id, d]));
  const used = new Set();
  const preferredByVehicle = new Map();
  for (const pair of preferred || []) {
    if (!pair?.vehicle_id || !pair?.driver_id) continue;
    if (!byId.has(pair.driver_id)) continue;
    preferredByVehicle.set(pair.vehicle_id, pair.driver_id);
  }

  const pool = (drivers || []).filter((d) => d?.id);
  let next = 0;

  return (vehicles || []).map((vehicle) => {
    const preferredId = preferredByVehicle.get(vehicle.id);
    if (preferredId && !used.has(preferredId)) {
      used.add(preferredId);
      return { ...vehicle, driver: byId.get(preferredId) };
    }
    while (next < pool.length && used.has(pool[next].id)) next += 1;
    if (next >= pool.length) return { ...vehicle, driver: null };
    const driver = pool[next];
    used.add(driver.id);
    next += 1;
    return { ...vehicle, driver };
  });
}

/** YYYY-MM-DD only — the planner works in calendar days, not instants. */
export function parseRouteDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    // DATE columns come back as midnight UTC from node-pg.
    if (value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0) {
      return value.toISOString().slice(0, 10);
    }
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value || '').trim();
  const day = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return day;
}

export function defaultScenarioName(routeDate, existingCount = 0) {
  const n = Number(existingCount) || 0;
  return `Scenariu ${n + 1} · ${routeDate}`;
}

/**
 * What we store in route_scenarios.solution — plain JSON, no Map leftovers from the index.
 * Arrival times stay as seconds-from-midnight; the promoter turns them into timestamps.
 */
export function shapeSolution(plan) {
  return {
    routes: (plan?.routes || []).map((route) => ({
      vehicle_id: route.vehicle_id,
      driver_id: route.driver_id,
      depot_location_id: route.depot_location_id,
      distance_km: route.distance_km,
      duration_min: route.duration_min,
      service_min: route.service_min,
      waiting_min: route.waiting_min,
      span_min: route.span_min ?? null,
      cost: route.cost,
      breaks_inserted: route.breaks_inserted ?? 0,
      rests_inserted: route.rests_inserted ?? 0,
      violations: route.violations || [],
      stops: (route.stops || []).map((stop) => ({
        seq: stop.seq,
        kind: stop.kind,
        order_id: stop.order_id,
        location_id: stop.location_id,
        arrival_sec: stop.arrival_sec,
        departure_sec: stop.departure_sec,
        service_time_min: stop.service_time_min,
        waiting_min: stop.waiting_min,
        leg_distance_km: stop.leg_distance_km,
        leg_duration_min: stop.leg_duration_min,
      })),
    })),
    unassigned: plan?.unassigned || [],
  };
}

export function shapeKpis(plan, extras = {}) {
  return {
    ...(plan?.kpis || {}),
    ...extras,
  };
}

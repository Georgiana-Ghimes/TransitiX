/**
 * Reg. (EC) 561/2006 post-processor.
 *
 * VROOM plans the stops; it does not know about driving-time law. This walk inserts the
 * breaks and daily rests the regulation requires as real stops (`pauza` / `repaus`), then
 * rebuilds the clocks and reports any delivery window that no longer fits.
 *
 * Rules modelled here (the ones that change a same-day distribution plan):
 * - after 4 h 30 of driving, a break of 45 minutes
 * - after 9 h of driving in the day, a daily rest of 11 hours
 *
 * A leg longer than the remaining allowance is split: drive up to the limit, insert the
 * required stop, then finish the leg. That is what "plan the break into the route" means —
 * a report that only flags the overrun after the fact is not this.
 *
 * Split breaks (15+30) and the twice-a-week 10 h extension are left for later; a dispatcher
 * who needs them can still move the stops by hand.
 */

export const MAX_CONTINUOUS_DRIVE_MIN = 4 * 60 + 30;
export const BREAK_MIN = 45;
export const MAX_DAILY_DRIVE_MIN = 9 * 60;
export const DAILY_REST_MIN = 11 * 60;

function num(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function minutesFromTime(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function proportion(km, takenMin, totalMin) {
  if (km == null || !(totalMin > 0)) return null;
  return Math.round((num(km) * takenMin) / totalMin * 1000) / 1000;
}

function makeBreak({ kind, serviceMin, legMin = 0, legKm = null, locationId = null }) {
  return {
    kind,
    order_id: null,
    location_id: locationId,
    service_time_min: serviceMin,
    waiting_min: 0,
    leg_distance_km: legKm,
    leg_duration_min: legMin,
  };
}

/**
 * Emit the travel segments (and any mid-leg breaks/rests) needed to cover one inbound leg,
 * then the destination stop itself with a zero remaining leg.
 */
function expandLeg(stop, {
  driveSinceBreak,
  driveToday,
  atLocationId,
}) {
  let remainingMin = Math.max(0, num(stop.leg_duration_min));
  let remainingKm = stop.leg_distance_km == null ? null : num(stop.leg_distance_km);
  const originalLeg = remainingMin;
  const totalKm = remainingKm;
  const segments = [];
  let since = driveSinceBreak;
  let today = driveToday;
  let breaks = 0;
  let rests = 0;

  const insertRequiredStop = () => {
    if (today >= MAX_DAILY_DRIVE_MIN) {
      segments.push(makeBreak({
        kind: 'repaus',
        serviceMin: DAILY_REST_MIN,
        locationId: atLocationId,
      }));
      rests += 1;
      today = 0;
      since = 0;
      return;
    }
    segments.push(makeBreak({
      kind: 'pauza',
      serviceMin: BREAK_MIN,
      locationId: atLocationId,
    }));
    breaks += 1;
    since = 0;
  };

  while (remainingMin > 0) {
    if (since >= MAX_CONTINUOUS_DRIVE_MIN || today >= MAX_DAILY_DRIVE_MIN) {
      insertRequiredStop();
      continue;
    }

    const room = Math.min(
      MAX_CONTINUOUS_DRIVE_MIN - since,
      MAX_DAILY_DRIVE_MIN - today
    );

    if (remainingMin <= room) {
      since += remainingMin;
      today += remainingMin;
      segments.push({
        ...stop,
        leg_duration_min: remainingMin,
        leg_distance_km: remainingKm,
      });
      remainingMin = 0;
      break;
    }

    const driveMin = room;
    const driveKm = proportion(totalKm, driveMin, originalLeg);
    const hitsDaily = today + driveMin >= MAX_DAILY_DRIVE_MIN;
    segments.push(makeBreak({
      kind: hitsDaily ? 'repaus' : 'pauza',
      serviceMin: hitsDaily ? DAILY_REST_MIN : BREAK_MIN,
      legMin: driveMin,
      legKm: driveKm,
      locationId: atLocationId,
    }));
    if (hitsDaily) rests += 1;
    else breaks += 1;

    remainingMin -= driveMin;
    if (remainingKm != null && driveKm != null) {
      remainingKm = Math.max(0, Math.round((remainingKm - driveKm) * 1000) / 1000);
    }
    today = hitsDaily ? 0 : today + driveMin;
    since = 0;
  }

  if (num(stop.leg_duration_min) === 0) {
    segments.push({
      ...stop,
      leg_duration_min: 0,
      leg_distance_km: num(stop.leg_distance_km, 0),
    });
  }

  return {
    segments,
    driveSinceBreak: since,
    driveToday: today,
    breaks_inserted: breaks,
    rests_inserted: rests,
  };
}

/**
 * Insert breaks and rests into one route, recompute arrival clocks, collect window misses.
 *
 * `windowsByOrderId` maps order id → { window_start, window_end } as HH:MM.
 */
export function applyDrivingRulesToRoute(route, { windowsByOrderId = new Map() } = {}) {
  const source = route?.stops || [];
  if (!source.length) {
    return { ...route, stops: [], violations: [], breaks_inserted: 0, rests_inserted: 0 };
  }

  const built = [{
    ...source[0],
    leg_distance_km: num(source[0].leg_distance_km, 0),
    leg_duration_min: num(source[0].leg_duration_min, 0),
  }];
  let driveSinceBreak = 0;
  let driveToday = 0;
  let breaksInserted = 0;
  let restsInserted = 0;

  for (let i = 1; i < source.length; i += 1) {
    const atLocationId = built[built.length - 1]?.location_id
      ?? route.depot_location_id
      ?? null;
    const expanded = expandLeg(source[i], {
      driveSinceBreak,
      driveToday,
      atLocationId,
    });
    built.push(...expanded.segments);
    driveSinceBreak = expanded.driveSinceBreak;
    driveToday = expanded.driveToday;
    breaksInserted += expanded.breaks_inserted;
    restsInserted += expanded.rests_inserted;
  }

  let cursor = num(source[0].arrival_sec, 0);
  const stops = built.map((stop, index) => {
    if (index > 0) cursor += Math.round(num(stop.leg_duration_min) * 60);
    const arrival = cursor;
    const departure = arrival + Math.round(num(stop.service_time_min) * 60);
    cursor = departure;
    return {
      ...stop,
      seq: index + 1,
      arrival_sec: arrival,
      departure_sec: departure,
      waiting_min: stop.waiting_min ?? 0,
    };
  });

  const violations = [];
  for (const stop of stops) {
    if (!stop.order_id) continue;
    const window = windowsByOrderId.get(stop.order_id);
    if (!window) continue;
    const arrivalMin = Math.floor(stop.arrival_sec / 60);
    const from = minutesFromTime(window.window_start);
    const to = minutesFromTime(window.window_end);
    if (to != null && arrivalMin > to) {
      violations.push({
        order_id: stop.order_id,
        seq: stop.seq,
        type: 'intarziere',
        by_min: arrivalMin - to,
      });
    } else if (from != null && arrivalMin < from && arrivalMin < 24 * 60) {
      violations.push({
        order_id: stop.order_id,
        seq: stop.seq,
        type: 'prea_devreme',
        by_min: from - arrivalMin,
      });
    }
  }

  const serviceMin = stops.reduce((sum, s) => sum + num(s.service_time_min), 0);
  const durationMin = stops.reduce((sum, s) => sum + num(s.leg_duration_min), 0);
  const distanceKm = stops.reduce((sum, s) => sum + num(s.leg_distance_km), 0);
  const last = stops[stops.length - 1];
  const spanMin = last?.departure_sec == null
    ? durationMin
    : Math.round((last.departure_sec - num(source[0].arrival_sec, 0)) / 60);

  return {
    ...route,
    stops,
    distance_km: Math.round(distanceKm * 1000) / 1000,
    duration_min: durationMin,
    service_min: serviceMin,
    span_min: spanMin,
    violations: [...(route.violations || []), ...violations],
    breaks_inserted: breaksInserted,
    rests_inserted: restsInserted,
  };
}

/** Apply the regulation to every route in a parsed plan. */
export function applyDrivingRules(plan, { windowsByOrderId = new Map() } = {}) {
  const routes = (plan?.routes || []).map((route) => (
    applyDrivingRulesToRoute(route, { windowsByOrderId })
  ));

  const breaks = routes.reduce((sum, r) => sum + (r.breaks_inserted || 0), 0);
  const rests = routes.reduce((sum, r) => sum + (r.rests_inserted || 0), 0);
  const windowHits = routes.reduce((sum, r) => sum + (r.violations || []).filter((v) => (
    v.type === 'intarziere' || v.type === 'prea_devreme'
  )).length, 0);

  return {
    ...plan,
    routes,
    kpis: {
      ...(plan?.kpis || {}),
      distance_km: Math.round(routes.reduce((sum, r) => sum + num(r.distance_km), 0) * 1000) / 1000,
      duration_min: routes.reduce((sum, r) => sum + num(r.duration_min), 0),
      service_min: routes.reduce((sum, r) => sum + num(r.service_min), 0),
      breaks_inserted: breaks,
      rests_inserted: rests,
      window_violations: windowHits,
      driving_rule_violations: 0,
    },
  };
}

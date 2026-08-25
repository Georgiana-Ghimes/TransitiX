/**
 * Route mechanics: sequencing, scheduling, capacity.
 *
 * All pure. The optimizer in P2 will produce sequences instead of a dispatcher dragging
 * them, but everything downstream of "here is an ordered list of stops" is this module —
 * so the solver plugs in without any of it changing.
 *
 * Times are handled as epoch milliseconds and only converted at the edges; doing arithmetic
 * on local time strings is how you lose an hour twice a year.
 */

const MINUTE_MS = 60_000;

/**
 * Number() with a real fallback. Number(null) and Number('') are both 0 and both finite,
 * so a plain isFinite check silently turns "not set" into "zero".
 */
function numOr(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Renumbers stops 1..n in their current array order. */
export function normalizeSequence(stops = []) {
  return stops.map((stop, index) => ({ ...stop, seq: index + 1 }));
}

/** Stops in sequence order, tolerating gaps, duplicates and missing seq values. */
export function sortStops(stops = []) {
  return [...stops].sort((a, b) => {
    const sa = Number.isFinite(Number(a?.seq)) ? Number(a.seq) : Number.MAX_SAFE_INTEGER;
    const sb = Number.isFinite(Number(b?.seq)) ? Number(b.seq) : Number.MAX_SAFE_INTEGER;
    return sa - sb;
  });
}

function clampIndex(index, length) {
  if (!Number.isFinite(Number(index))) return length;
  return Math.max(0, Math.min(Math.trunc(Number(index)), length));
}

/**
 * Depot stops are anchors: the start stays first and the end stays last however the
 * dispatcher drags the middle around.
 */
function isDepotStart(stop) { return stop?.kind === 'depot_start'; }
function isDepotEnd(stop) { return stop?.kind === 'depot_end'; }

function withDepotsPinned(stops) {
  const starts = stops.filter(isDepotStart);
  const ends = stops.filter(isDepotEnd);
  const middle = stops.filter((s) => !isDepotStart(s) && !isDepotEnd(s));
  return [...starts, ...middle, ...ends];
}

export function insertStop(stops = [], stop, atIndex) {
  const ordered = sortStops(stops);
  const next = [...ordered];
  next.splice(clampIndex(atIndex, next.length), 0, stop);
  return normalizeSequence(withDepotsPinned(next));
}

export function removeStop(stops = [], stopId) {
  return normalizeSequence(withDepotsPinned(sortStops(stops).filter((s) => s.id !== stopId)));
}

/** Moves one stop to a new position. Returns the full renumbered list. */
export function moveStop(stops = [], stopId, toIndex) {
  const ordered = sortStops(stops);
  const from = ordered.findIndex((s) => s.id === stopId);
  if (from === -1) return normalizeSequence(ordered);
  const next = [...ordered];
  const [moved] = next.splice(from, 1);
  next.splice(clampIndex(toIndex, next.length), 0, moved);
  return normalizeSequence(withDepotsPinned(next));
}

/** Applies an explicit id order, keeping any stop the caller forgot to mention. */
export function applyOrder(stops = [], orderedIds = []) {
  const byId = new Map(sortStops(stops).map((s) => [s.id, s]));
  const next = [];
  for (const id of orderedIds) {
    const stop = byId.get(id);
    if (stop) { next.push(stop); byId.delete(id); }
  }
  for (const leftover of byId.values()) next.push(leftover);
  return normalizeSequence(withDepotsPinned(next));
}

/**
 * Fills in each stop's leg from the previous one, using an OSRM matrix.
 * `index` maps a stop to its row/column in the matrix.
 */
export function buildLegs(stops = [], matrix, indexOf) {
  const ordered = sortStops(stops);
  return ordered.map((stop, i) => {
    if (i === 0) return { ...stop, leg_distance_km: 0, leg_duration_min: 0 };
    const from = indexOf(ordered[i - 1]);
    const to = indexOf(stop);
    const km = matrix?.distances_km?.[from]?.[to];
    const min = matrix?.durations_min?.[from]?.[to];
    return {
      ...stop,
      leg_distance_km: km == null ? null : Math.round(km * 100) / 100,
      leg_duration_min: min == null ? null : Math.round(min),
    };
  });
}

function toEpoch(value) {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Walks the route from a start instant, accumulating travel and service time.
 * A stop with no leg duration stops the clock: guessing past a gap would produce
 * confident nonsense for every stop after it.
 */
export function scheduleStops(stops = [], { startAt, defaultServiceMin = 15 } = {}) {
  const start = toEpoch(startAt);
  const ordered = sortStops(stops);
  if (start == null) {
    return ordered.map((s) => ({ ...s, planned_arrival: null, planned_departure: null }));
  }

  let cursor = start;
  let broken = false;

  return ordered.map((stop, i) => {
    if (broken) return { ...stop, planned_arrival: null, planned_departure: null };

    if (i > 0) {
      const leg = numOr(stop.leg_duration_min, null);
      if (leg == null) {
        broken = true;
        return { ...stop, planned_arrival: null, planned_departure: null };
      }
      cursor += leg * MINUTE_MS;
    }

    const arrival = cursor;
    const service = numOr(stop.service_time_min, defaultServiceMin);
    const departure = arrival + service * MINUTE_MS;
    cursor = departure;

    return {
      ...stop,
      planned_arrival: new Date(arrival).toISOString(),
      planned_departure: new Date(departure).toISOString(),
    };
  });
}

/** Minutes since midnight for a "HH:MM" / "HH:MM:SS" time column. */
export function minutesFromTime(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function localMinutesOfDay(isoString) {
  const ms = toEpoch(isoString);
  if (ms == null) return null;
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Which stops miss their delivery window. `late` matters operationally; `early` matters
 * because a driver arriving before opening waits, which the plan should show.
 */
export function checkTimeWindows(stops = []) {
  const violations = [];
  for (const stop of sortStops(stops)) {
    const arrival = localMinutesOfDay(stop.planned_arrival);
    if (arrival == null) continue;
    const from = minutesFromTime(stop.window_start);
    const to = minutesFromTime(stop.window_end);
    if (to != null && arrival > to) {
      violations.push({ stop_id: stop.id, seq: stop.seq, type: 'intarziere', by_min: arrival - to });
    } else if (from != null && arrival < from) {
      violations.push({ stop_id: stop.id, seq: stop.seq, type: 'prea_devreme', by_min: from - arrival });
    }
  }
  return violations;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Route totals. Distance and duration come from the legs, load from the orders. */
export function routeTotals(stops = []) {
  const ordered = sortStops(stops);
  let distance = 0;
  let duration = 0;
  let complete = true;

  for (let i = 0; i < ordered.length; i += 1) {
    const stop = ordered[i];
    if (i > 0) {
      if (stop.leg_distance_km == null || stop.leg_duration_min == null) complete = false;
      distance += num(stop.leg_distance_km);
      duration += num(stop.leg_duration_min);
    }
    duration += num(stop.service_time_min);
  }

  const load = ordered.reduce((acc, stop) => ({
    weight_kg: acc.weight_kg + num(stop.weight_kg),
    volume_mc: acc.volume_mc + num(stop.volume_mc),
    pallets: acc.pallets + num(stop.pallets),
  }), { weight_kg: 0, volume_mc: 0, pallets: 0 });

  return {
    stops: ordered.filter((s) => s.kind !== 'depot_start' && s.kind !== 'depot_end').length,
    distance_km: Math.round(distance * 100) / 100,
    duration_min: Math.round(duration),
    weight_kg: Math.round(load.weight_kg * 100) / 100,
    volume_mc: Math.round(load.volume_mc * 100) / 100,
    pallets: load.pallets,
    complete,
  };
}

/**
 * Capacity check against the assigned vehicle.
 * A missing capacity column is not treated as zero — it means "unknown", and inventing a
 * limit would block a dispatcher for no reason.
 */
export function checkCapacity(totals, vehicle) {
  const problems = [];
  if (!vehicle) return problems;

  const checks = [
    { key: 'weight_kg', limit: vehicle.capacity_kg, label: 'greutate', unit: 'kg' },
    { key: 'volume_mc', limit: vehicle.capacity_mc, label: 'volum', unit: 'mc' },
  ];
  for (const check of checks) {
    if (check.limit == null || check.limit === '') continue;
    const limit = Number(check.limit);
    if (!Number.isFinite(limit) || limit <= 0) continue;
    const used = num(totals?.[check.key]);
    if (used > limit) {
      problems.push({
        type: 'capacitate',
        field: check.key,
        label: check.label,
        used,
        limit,
        over: Math.round((used - limit) * 100) / 100,
        unit: check.unit,
      });
    }
  }
  return problems;
}

/** Capabilities the orders on this route need but the vehicle does not have. */
export function checkRequirements(stops = [], vehicleCapabilities = []) {
  const have = new Set((vehicleCapabilities || []).map((c) => String(c).toLowerCase()));
  // Keyed by the folded form so "ADR" and "adr" collapse, but report the first spelling seen.
  const missing = new Map();
  for (const stop of stops) {
    for (const requirement of stop.requires || []) {
      const key = String(requirement).toLowerCase();
      if (!have.has(key) && !missing.has(key)) missing.set(key, requirement);
    }
  }
  return [...missing.values()];
}

/** Everything a dispatch board needs to colour one route. */
export function summarizeRoute(stops = [], { vehicle, startAt, defaultServiceMin = 15 } = {}) {
  const scheduled = scheduleStops(stops, { startAt, defaultServiceMin });
  const totals = routeTotals(scheduled);
  return {
    stops: scheduled,
    totals,
    windowViolations: checkTimeWindows(scheduled),
    capacityProblems: checkCapacity(totals, vehicle),
  };
}

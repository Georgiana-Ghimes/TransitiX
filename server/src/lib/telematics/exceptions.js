/**
 * Live exception detection — pure.
 *
 * Given where the truck is and what the plan said, decide which exceptions to raise.
 * Persistence, dedupe and ETA cascading live next door in evaluate.js.
 */

/** Metres between two WGS84 points. */
export function haversineM(a, b) {
  if (!a || !b) return null;
  const lat1 = Number(a.latitude ?? a.lat);
  const lon1 = Number(a.longitude ?? a.lon ?? a.lng);
  const lat2 = Number(b.latitude ?? b.lat);
  const lon2 = Number(b.longitude ?? b.lon ?? b.lng);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

export const DEFAULT_THRESHOLDS = {
  /** Minutes past planned_arrival before a still-open stop is late. */
  lateGraceMin: 15,
  /** Minutes before window_start that count as too early when near the stop. */
  earlyGraceMin: 30,
  /** Near enough to the stop to count as "arrived / arriving". */
  atStopM: 150,
  /** Far from every stop on the route. */
  offRouteM: 800,
  /** km/h — Romanian A-road soft cap for the alert, not the legal limit. */
  maxSpeedKmh: 90,
  /** Minutes nearly stationary away from a stop. */
  idleMin: 20,
  /** Below this we treat the truck as stopped. */
  idleSpeedKmh: 5,
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function openStops(stops = []) {
  return [...stops]
    .filter((s) => s && !['finalizat', 'esuat', 'sarit'].includes(s.status))
    .filter((s) => s.kind !== 'depot_start' && s.kind !== 'pauza' && s.kind !== 'repaus')
    .sort((a, b) => Number(a.seq) - Number(b.seq));
}

/**
 * Next stop the driver still owes — delivery/pickup/depot_end that is not closed.
 */
export function nextOpenStop(stops = []) {
  return openStops(stops)[0] || null;
}

/**
 * Detect exceptions for one position against one route plan.
 *
 * `idleSinceMs` — when the truck first dropped below idleSpeed while away from stops;
 * null means "not idle". The caller tracks this across positions.
 */
export function detectExceptions({
  position,
  route = null,
  stops = [],
  now = new Date(),
  idleSinceMs = null,
  thresholds = DEFAULT_THRESHOLDS,
} = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const found = [];
  if (!position || position.latitude == null || position.longitude == null) return found;

  const speed = num(position.speed);
  const nowMs = toMs(now) ?? Date.now();
  const next = nextOpenStop(stops);

  if (speed != null && speed > t.maxSpeedKmh) {
    found.push({
      type: 'viteza',
      severity: speed > t.maxSpeedKmh + 20 ? 'critical' : 'warning',
      route_id: route?.id ?? null,
      route_stop_id: null,
      vehicle_id: position.vehicle_id ?? route?.vehicle_id ?? null,
      message: `Viteză ${Math.round(speed)} km/h (prag ${t.maxSpeedKmh})`,
      payload: { speed_kmh: speed, threshold_kmh: t.maxSpeedKmh },
    });
  }

  if (next) {
    const planned = toMs(next.planned_arrival);
    const dist = haversineM(position, next);
    const atStop = dist != null && dist <= t.atStopM;

    if (planned != null && nowMs > planned + t.lateGraceMin * 60_000 && !atStop) {
      const byMin = Math.round((nowMs - planned) / 60_000);
      found.push({
        type: 'intarziere',
        severity: byMin >= 45 ? 'critical' : 'warning',
        route_id: route?.id ?? null,
        route_stop_id: next.id ?? null,
        vehicle_id: position.vehicle_id ?? route?.vehicle_id ?? null,
        message: `Întârziere ~${byMin} min la oprirea ${next.seq}`,
        payload: {
          by_min: byMin,
          planned_arrival: next.planned_arrival,
          distance_m: dist == null ? null : Math.round(dist),
          order_id: next.order_id ?? null,
        },
      });
    }

    const windowStart = next.window_start;
    if (atStop && windowStart) {
      const match = String(windowStart).match(/^(\d{1,2}):(\d{2})/);
      if (match && planned != null) {
        // Compare clock-of-day on the planned date.
        const startMin = Number(match[1]) * 60 + Number(match[2]);
        const date = new Date(planned);
        const arrivalMin = date.getHours() * 60 + date.getMinutes();
        // Use "now" clock when we are physically there.
        const nowDate = new Date(nowMs);
        const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
        if (nowMin + t.earlyGraceMin < startMin) {
          found.push({
            type: 'prea_devreme',
            severity: 'info',
            route_id: route?.id ?? null,
            route_stop_id: next.id ?? null,
            vehicle_id: position.vehicle_id ?? route?.vehicle_id ?? null,
            message: `Sosire prea devreme la oprirea ${next.seq} (fereastră de la ${String(windowStart).slice(0, 5)})`,
            payload: {
              by_min: startMin - nowMin,
              window_start: windowStart,
              arrival_clock_min: arrivalMin,
            },
          });
        }
      }
    }
  }

  const distances = (stops || [])
    .filter((s) => s.latitude != null && s.longitude != null)
    .map((s) => haversineM(position, s))
    .filter((d) => d != null);
  const nearestM = distances.length ? Math.min(...distances) : null;
  const farFromPlan = nearestM != null && nearestM > t.offRouteM;

  if (farFromPlan && next) {
    found.push({
      type: 'abatere_traseu',
      severity: nearestM > t.offRouteM * 3 ? 'critical' : 'warning',
      route_id: route?.id ?? null,
      route_stop_id: next.id ?? null,
      vehicle_id: position.vehicle_id ?? route?.vehicle_id ?? null,
      message: `Abatere de traseu (~${Math.round(nearestM)} m față de cea mai apropiată oprire)`,
      payload: { nearest_m: Math.round(nearestM), threshold_m: t.offRouteM },
    });
  }

  const stationary = speed != null && speed <= t.idleSpeedKmh;
  if (stationary && farFromPlan && idleSinceMs != null) {
    const idleMin = Math.round((nowMs - idleSinceMs) / 60_000);
    if (idleMin >= t.idleMin) {
      found.push({
        type: nearestM != null && nearestM > t.offRouteM ? 'oprire_neplanificata' : 'stationare',
        severity: idleMin >= t.idleMin * 2 ? 'critical' : 'warning',
        route_id: route?.id ?? null,
        route_stop_id: null,
        vehicle_id: position.vehicle_id ?? route?.vehicle_id ?? null,
        message: `Staționare ${idleMin} min departe de plan`,
        payload: { idle_min: idleMin, nearest_m: nearestM == null ? null : Math.round(nearestM) },
      });
    }
  }

  return found;
}

/**
 * Push planned clocks of every stop after `fromSeq` by `delayMin`.
 * Returns new stop list; does not mutate.
 */
export function cascadeEta(stops = [], { fromSeq, delayMin, now = null } = {}) {
  const delay = Number(delayMin);
  if (!Number.isFinite(delay) || delay <= 0) {
    return { stops: stops.map((s) => ({ ...s })), shifted: 0 };
  }
  const seq = Number(fromSeq);
  let shifted = 0;
  const next = stops.map((stop) => {
    if (!(Number(stop.seq) >= seq)) return { ...stop };
    if (['finalizat', 'esuat', 'sarit'].includes(stop.status)) return { ...stop };

    const shift = (value) => {
      const ms = toMs(value);
      if (ms == null) return value ?? null;
      return new Date(ms + delay * 60_000).toISOString();
    };

    shifted += 1;
    return {
      ...stop,
      planned_arrival: shift(stop.planned_arrival),
      planned_departure: shift(stop.planned_departure),
      eta_adjusted_at: now ? new Date(toMs(now) ?? Date.now()).toISOString() : new Date().toISOString(),
      eta_delay_min: (Number(stop.eta_delay_min) || 0) + delay,
    };
  });
  return { stops: next, shifted };
}

/**
 * Update idle tracking: return the new idleSinceMs to store for the next tick.
 * null = not idle / reset.
 */
export function updateIdleSince({ position, stops = [], idleSinceMs = null, now = new Date(), thresholds = DEFAULT_THRESHOLDS } = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const speed = num(position?.speed);
  const stationary = speed != null && speed <= t.idleSpeedKmh;
  const distances = (stops || [])
    .filter((s) => s.latitude != null)
    .map((s) => haversineM(position, s))
    .filter((d) => d != null);
  const nearestM = distances.length ? Math.min(...distances) : null;
  const far = nearestM == null || nearestM > t.atStopM;
  const nowMs = toMs(now) ?? Date.now();

  if (stationary && far) {
    return idleSinceMs == null ? nowMs : idleSinceMs;
  }
  return null;
}

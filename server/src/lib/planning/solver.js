/**
 * Translation between our model and VROOM's.
 *
 * Everything here is pure. The optimizer is three steps — collect the points, measure them,
 * solve — and only the middle one touches the network, so the interesting decisions (what
 * counts as a capacity, what a skill is, how a solved route becomes stops) stay testable.
 *
 * The vocabulary maps like this:
 *
 * | ours                     | VROOM                                  |
 * | ------------------------ | -------------------------------------- |
 * | order (livrare)          | job with a `delivery` amount           |
 * | order (ridicare)         | job with a `pickup` amount             |
 * | order (schimb)           | job with both                          |
 * | orders.requires          | job `skills`                           |
 * | vehicles.capabilities    | vehicle `skills`                       |
 * | kg / mc / paleți         | the three slots of an `amount` vector  |
 * | driver shift             | vehicle `time_window`                  |
 *
 * VROOM identifies everything by integer, so the maps back to our UUIDs travel alongside
 * the problem in an `index` object. Nothing else may reconstruct them.
 */

import { coordinateKey } from '../geo/matrixCache.js';
import { minutesFromTime } from '../routing/routePlan.js';

/**
 * The three numbers a Romanian dispatcher plans on. VROOM amounts are integers, so volume
 * is carried in hundredths of a cubic metre — a centilitre of headroom is not a real
 * constraint, but rounding 2.4 mc down to 2 is.
 */
export const CAPACITY_DIMENSIONS = [
  { demand: 'weight_kg', capacity: 'capacity_kg', scale: 1, label: 'kg' },
  { demand: 'volume_mc', capacity: 'capacity_mc', scale: 100, label: 'mc' },
  { demand: 'pallets', capacity: 'capacity_pallets', scale: 1, label: 'paleți' },
];

/**
 * Stand-in for a pair OSRM could not connect. Large enough that no solution would ever
 * choose it, small enough that summing a couple of hundred of them stays inside the 32-bit
 * range VROOM counts in.
 */
export const UNREACHABLE_SECONDS = 1_000_000;
export const UNREACHABLE_METRES = 10_000_000;

/** Costs travel to VROOM as integers, so money is counted in bani. */
const COST_SCALE = 100;

const DEFAULT_SHIFT_START = '06:00';
const DEFAULT_SHIFT_END = '22:00';
const DEFAULT_SERVICE_MIN = 15;

function num(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSkill(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Every capability mentioned by either side, numbered. Sorted so the same fleet and the same
 * orders always produce the same problem — a solver run has to be reproducible before a
 * scenario comparison means anything.
 */
export function skillVocabulary(orders = [], vehicles = []) {
  const seen = new Set();
  for (const order of orders) {
    for (const skill of order?.requires || []) {
      const key = normalizeSkill(skill);
      if (key) seen.add(key);
    }
  }
  for (const vehicle of vehicles) {
    for (const skill of vehicle?.capabilities || []) {
      const key = normalizeSkill(skill);
      if (key) seen.add(key);
    }
  }
  return new Map([...seen].sort().map((skill, i) => [skill, i]));
}

function skillIds(list, vocabulary) {
  const ids = new Set();
  for (const skill of list || []) {
    const id = vocabulary.get(normalizeSkill(skill));
    if (id != null) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

/** What an order takes out of a vehicle, as an integer vector in the fixed dimension order. */
export function demandVector(order) {
  return CAPACITY_DIMENSIONS.map((dim) => Math.max(0, Math.round(num(order?.[dim.demand]) * dim.scale)));
}

/**
 * What a vehicle can hold. An unset dimension is not zero — it means nobody recorded it, so
 * it must not silently reject every order. It becomes the total on offer, which constrains
 * nothing while still being a real number VROOM can add up.
 */
export function capacityVector(vehicle, totals = []) {
  return CAPACITY_DIMENSIONS.map((dim, i) => {
    const raw = vehicle?.[dim.capacity];
    if (raw == null || raw === '') return Math.max(0, Math.round(num(totals[i])));
    return Math.max(0, Math.round(num(raw) * dim.scale));
  });
}

/** Seconds from midnight on the route date. VROOM's clock is unitless; this is ours. */
export function secondsFromTime(value, fallback = null) {
  const minutes = minutesFromTime(value);
  if (minutes == null) return fallback;
  return minutes * 60;
}

function timeWindow(start, end) {
  const from = secondsFromTime(start);
  const to = secondsFromTime(end);
  if (from == null && to == null) return null;
  // A window open at one end is still a window; the other end becomes the day.
  const open = from ?? 0;
  // An end before the start is an overnight window. Nothing in daily distribution needs one,
  // and treating it as open-ended is safer than handing VROOM an empty interval.
  const close = to == null || to <= open ? 24 * 3600 : to;
  return [open, close];
}

function pointOf(entity) {
  const lat = entity?.latitude;
  const lon = entity?.longitude;
  // Number(null) is 0 and 0 is finite, which would place an ungeocoded stop in the Gulf of
  // Guinea and report it as unreachable instead of as missing a pin.
  if (lat == null || lat === '' || lon == null || lon === '') return null;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

/**
 * The distinct places the problem touches, in the order the matrix will use.
 *
 * Two orders at the same warehouse share one row: this is where a 40-stop day at 12 addresses
 * stops being a 40×40 matrix.
 */
export function collectPoints({ orders = [], vehicles = [], depot = null } = {}) {
  const points = [];
  const byKey = new Map();

  const add = (entity) => {
    const point = pointOf(entity);
    if (!point) return null;
    const key = coordinateKey(point);
    if (byKey.has(key)) return byKey.get(key);
    const index = points.length;
    points.push(point);
    byKey.set(key, index);
    return index;
  };

  const depotIndex = depot ? add(depot) : null;
  const vehicleStart = new Map();
  for (const vehicle of vehicles) {
    const index = pointOf(vehicle?.home) ? add(vehicle.home) : depotIndex;
    if (index != null) vehicleStart.set(vehicle.id, index);
  }
  const orderIndex = new Map();
  for (const order of orders) {
    const index = add(order);
    if (index != null) orderIndex.set(order.id, index);
  }

  return { points, depotIndex, vehicleStart, orderIndex };
}

/** Cost per hour and per km, in bani, or null when nobody has told us what anything costs. */
export function costModel(vehicles = []) {
  const hours = vehicles.map((v) => v?.cost_per_hour).filter((v) => v != null && v !== '');
  const kms = vehicles.map((v) => v?.cost_per_km).filter((v) => v != null && v !== '');
  if (!hours.length && !kms.length) return null;

  const mean = (list) => (list.length
    ? list.reduce((sum, v) => sum + num(v), 0) / list.length
    : 0);
  const fallbackHour = mean(hours);
  const fallbackKm = mean(kms);

  return (vehicle) => ({
    per_hour: Math.max(0, Math.round(num(vehicle?.cost_per_hour, fallbackHour) * COST_SCALE)),
    per_km: Math.max(0, Math.round(num(vehicle?.cost_per_km, fallbackKm) * COST_SCALE)),
  });
}

/** Cached km/min matrices become the integer seconds and metres VROOM counts in. */
export function encodeMatrix(matrix, count) {
  const durations = [];
  const distances = [];
  for (let i = 0; i < count; i += 1) {
    const durationRow = [];
    const distanceRow = [];
    for (let j = 0; j < count; j += 1) {
      const minutes = matrix?.durations_min?.[i]?.[j];
      const km = matrix?.distances_km?.[i]?.[j];
      durationRow.push(minutes == null ? UNREACHABLE_SECONDS : Math.max(0, Math.round(minutes * 60)));
      distanceRow.push(km == null ? UNREACHABLE_METRES : Math.max(0, Math.round(km * 1000)));
    }
    durations.push(durationRow);
    distances.push(distanceRow);
  }
  return { durations, distances };
}

/**
 * A point nothing can reach and nothing can leave. Usually a pin in a field: the geocoder
 * was confident, the road network disagrees. Better named as unplannable than quietly
 * dragged into a route at a sentinel cost.
 */
export function strandedPoints(encoded, count) {
  const stranded = new Set();
  for (let i = 0; i < count; i += 1) {
    let connected = false;
    for (let j = 0; j < count && !connected; j += 1) {
      if (i === j) continue;
      if (encoded.durations[i][j] < UNREACHABLE_SECONDS) connected = true;
      if (encoded.durations[j][i] < UNREACHABLE_SECONDS) connected = true;
    }
    if (!connected) stranded.add(i);
  }
  return stranded;
}

/**
 * The VROOM problem, plus the maps needed to read its answer.
 *
 * `dropped` is not a failure: an order with no coordinates, or one at a place the road
 * network cannot reach, is reported back rather than silently left out of the plan.
 */
export function buildSolverInput({
  orders = [],
  vehicles = [],
  depot = null,
  matrix = null,
  options = {},
} = {}) {
  const collected = collectPoints({ orders, vehicles, depot });
  const count = collected.points.length;
  const encoded = encodeMatrix(matrix, count);
  const stranded = strandedPoints(encoded, count);

  const vocabulary = skillVocabulary(orders, vehicles);
  const dropped = [];

  const usableOrders = [];
  for (const order of orders) {
    const index = collected.orderIndex.get(order.id);
    if (index == null) {
      dropped.push({ order_id: order.id, reason: 'fara_coordonate' });
      continue;
    }
    if (stranded.has(index)) {
      dropped.push({ order_id: order.id, reason: 'fara_drum' });
      continue;
    }
    usableOrders.push({ order, index });
  }

  const usableVehicles = vehicles.filter((v) => collected.vehicleStart.get(v.id) != null);
  for (const vehicle of vehicles) {
    if (collected.vehicleStart.get(vehicle.id) == null) {
      dropped.push({ vehicle_id: vehicle.id, reason: 'fara_depozit' });
    }
  }

  // What the whole day weighs, so an unrecorded capacity constrains nothing.
  const totals = CAPACITY_DIMENSIONS.map((dim, i) => usableOrders
    .reduce((sum, { order }) => sum + demandVector(order)[i], 0));

  const costs = costModel(usableVehicles);

  const jobs = usableOrders.map(({ order, index }, i) => {
    const amount = demandVector(order);
    const job = {
      id: i + 1,
      location_index: index,
      service: Math.max(0, Math.round(num(order.service_time_min, DEFAULT_SERVICE_MIN) * 60)),
    };
    // 'schimb' both drops and collects at the same address, which is one job with both amounts.
    if (order.type !== 'ridicare') job.delivery = amount;
    if (order.type !== 'livrare') job.pickup = amount;
    const skills = skillIds(order.requires, vocabulary);
    if (skills.length) job.skills = skills;
    const window = timeWindow(order.window_start, order.window_end);
    if (window) job.time_windows = [window];
    return job;
  });

  const problemVehicles = usableVehicles.map((vehicle, i) => {
    const start = collected.vehicleStart.get(vehicle.id);
    const entry = {
      id: i + 1,
      start_index: start,
      end_index: start,
      profile: 'car',
      capacity: capacityVector(vehicle, totals),
    };
    const skills = skillIds(vehicle.capabilities, vocabulary);
    if (skills.length) entry.skills = skills;
    const shift = timeWindow(
      vehicle.driver?.shift_start || options.shiftStart || DEFAULT_SHIFT_START,
      vehicle.driver?.shift_end || options.shiftEnd || DEFAULT_SHIFT_END
    );
    if (shift) entry.time_window = shift;
    if (costs) entry.costs = costs(vehicle);
    return entry;
  });

  return {
    problem: {
      vehicles: problemVehicles,
      jobs,
      matrices: { car: encoded },
      options: { g: false },
    },
    index: {
      points: collected.points,
      orderByJobId: new Map(usableOrders.map(({ order }, i) => [i + 1, order])),
      vehicleById: new Map(usableVehicles.map((v, i) => [i + 1, v])),
      depotIndex: collected.depotIndex,
      objective: costs ? 'cost' : 'timp',
    },
    dropped,
  };
}

/** VROOM step type to the `kind` a route_stops row is allowed to hold. */
function stopKind(step, order) {
  if (step.type === 'start') return 'depot_start';
  if (step.type === 'end') return 'depot_end';
  if (step.type === 'break') return 'pauza';
  // 'schimb' delivers as well as collects, and the driver's sheet needs one word for it.
  return order?.type === 'ridicare' ? 'ridicare' : 'livrare';
}

function metresToKm(value) {
  return value == null ? null : Math.round(value) / 1000;
}

function secondsToMin(value) {
  return value == null ? null : Math.round(value / 60);
}

/**
 * A VROOM answer as routes and stops in our own terms.
 *
 * Distances and durations arrive cumulative from the start of the route; the legs a dispatch
 * board shows are the differences.
 */
export function parseSolution(response, { index, dropped = [] } = {}) {
  const routes = (response?.routes || []).map((route) => {
    const vehicle = index?.vehicleById?.get(route.vehicle) || null;
    let previousDistance = 0;
    let previousDuration = 0;

    const stops = (route.steps || []).map((step, seq) => {
      const order = step.type === 'job' ? index?.orderByJobId?.get(step.id) || null : null;
      const cumulativeDistance = num(step.distance, previousDistance);
      const cumulativeDuration = num(step.duration, previousDuration);
      const stop = {
        seq: seq + 1,
        kind: stopKind(step, order),
        order_id: order?.id ?? null,
        location_id: order?.location_id ?? (step.type === 'job' ? null : vehicle?.home_location_id ?? null),
        arrival_sec: step.arrival ?? null,
        departure_sec: step.arrival == null ? null : step.arrival + num(step.service),
        service_time_min: secondsToMin(num(step.service)) ?? 0,
        waiting_min: secondsToMin(num(step.waiting_time)) ?? 0,
        leg_distance_km: metresToKm(cumulativeDistance - previousDistance),
        leg_duration_min: secondsToMin(cumulativeDuration - previousDuration),
      };
      previousDistance = cumulativeDistance;
      previousDuration = cumulativeDuration;
      return stop;
    });

    return {
      vehicle_id: vehicle?.id ?? null,
      driver_id: vehicle?.driver?.id ?? null,
      depot_location_id: vehicle?.home_location_id ?? null,
      distance_km: metresToKm(route.distance),
      duration_min: secondsToMin(route.duration),
      service_min: secondsToMin(route.service),
      waiting_min: secondsToMin(route.waiting_time),
      cost: route.cost == null ? null : route.cost / COST_SCALE,
      violations: route.violations || [],
      stops,
    };
  });

  const unassigned = (response?.unassigned || []).map((entry) => {
    const order = index?.orderByJobId?.get(entry.id) || null;
    return { order_id: order?.id ?? null, order_number: order?.order_number ?? null, reason: 'nealocat' };
  });

  const summary = response?.summary || {};
  return {
    routes,
    unassigned: [...unassigned, ...dropped],
    kpis: {
      objective: index?.objective ?? 'timp',
      routes: routes.length,
      distance_km: metresToKm(summary.distance),
      duration_min: secondsToMin(summary.duration),
      service_min: secondsToMin(summary.service),
      waiting_min: secondsToMin(summary.waiting_time),
      // Only meaningful when a cost model exists; otherwise VROOM's cost is just duration.
      cost: index?.objective === 'cost' && summary.cost != null ? summary.cost / COST_SCALE : null,
      unassigned: unassigned.length + dropped.length,
    },
  };
}

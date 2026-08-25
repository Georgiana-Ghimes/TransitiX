import { describe, expect, it } from 'vitest';
import {
  UNREACHABLE_METRES,
  UNREACHABLE_SECONDS,
  buildSolverInput,
  capacityVector,
  collectPoints,
  costModel,
  demandVector,
  encodeMatrix,
  parseSolution,
  secondsFromTime,
  skillVocabulary,
  strandedPoints,
} from './solver.js';

const DEPOT = { id: 'dep', latitude: 44.4268, longitude: 26.1025 };

function order(overrides = {}) {
  return {
    id: 'o1',
    order_number: 'CMD-1',
    location_id: 'loc1',
    type: 'livrare',
    latitude: 44.5,
    longitude: 26.2,
    service_time_min: 20,
    weight_kg: 1200,
    volume_mc: 2.4,
    pallets: 3,
    requires: [],
    ...overrides,
  };
}

function vehicle(overrides = {}) {
  return {
    id: 'v1',
    plate: 'B 01 AAA',
    capacity_kg: 3500,
    capacity_mc: 20,
    capacity_pallets: 12,
    capabilities: [],
    home_location_id: 'dep',
    home: DEPOT,
    ...overrides,
  };
}

/** A matrix where everything is reachable and the numbers are easy to recognise. */
function fullMatrix(n) {
  return {
    distances_km: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 10))),
    durations_min: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 15))),
  };
}

describe('skillVocabulary', () => {
  it('folds spelling and sorts, so the same fleet always builds the same problem', () => {
    const a = skillVocabulary([{ requires: ['ADR', 'frigo'] }], [{ capabilities: ['lift', ' adr '] }]);
    const b = skillVocabulary([{ requires: ['frigo', 'adr'] }], [{ capabilities: ['ADR', 'LIFT'] }]);
    expect([...a]).toEqual([['adr', 0], ['frigo', 1], ['lift', 2]]);
    expect([...a]).toEqual([...b]);
  });

  it('ignores blanks rather than numbering them', () => {
    expect([...skillVocabulary([{ requires: ['', '  ', null] }], [])]).toEqual([]);
  });
});

describe('demandVector', () => {
  it('carries volume in hundredths so 2.4 mc does not round down to 2', () => {
    expect(demandVector(order())).toEqual([1200, 240, 3]);
  });

  it('reads a missing number as nothing to carry', () => {
    expect(demandVector({})).toEqual([0, 0, 0]);
  });
});

describe('capacityVector', () => {
  it('scales the recorded capacity the same way as the demand', () => {
    expect(capacityVector(vehicle(), [0, 0, 0])).toEqual([3500, 2000, 12]);
  });

  it('treats an unrecorded capacity as the whole day, not as zero', () => {
    const totals = [5000, 900, 20];
    expect(capacityVector(vehicle({ capacity_pallets: null }), totals)).toEqual([3500, 2000, 20]);
  });
});

describe('secondsFromTime', () => {
  it('counts from midnight on the route date', () => {
    expect(secondsFromTime('08:30')).toBe(30_600);
    expect(secondsFromTime('00:00')).toBe(0);
    expect(secondsFromTime(null, 'nimic')).toBe('nimic');
  });
});

describe('collectPoints', () => {
  it('gives two orders at the same warehouse one row in the matrix', () => {
    const { points, orderIndex } = collectPoints({
      depot: DEPOT,
      orders: [order({ id: 'a' }), order({ id: 'b' }), order({ id: 'c', latitude: 45.1, longitude: 25.1 })],
      vehicles: [vehicle()],
    });
    expect(points).toHaveLength(3);
    expect(orderIndex.get('a')).toBe(orderIndex.get('b'));
    expect(orderIndex.get('c')).not.toBe(orderIndex.get('a'));
  });

  it('starts a vehicle from the depot when it has no home of its own', () => {
    const { depotIndex, vehicleStart } = collectPoints({
      depot: DEPOT,
      orders: [],
      vehicles: [vehicle({ home: null })],
    });
    expect(vehicleStart.get('v1')).toBe(depotIndex);
  });
});

describe('encodeMatrix', () => {
  it('converts to the integer seconds and metres VROOM counts in', () => {
    const encoded = encodeMatrix(fullMatrix(2), 2);
    expect(encoded.durations).toEqual([[0, 900], [900, 0]]);
    expect(encoded.distances).toEqual([[0, 10_000], [10_000, 0]]);
  });

  it('marks an unmeasurable pair as effectively impossible rather than free', () => {
    const encoded = encodeMatrix({ distances_km: [[0, null], [null, 0]], durations_min: [[0, null], [null, 0]] }, 2);
    expect(encoded.durations[0][1]).toBe(UNREACHABLE_SECONDS);
    expect(encoded.distances[0][1]).toBe(UNREACHABLE_METRES);
  });

  it('stays inside 32 bits even if a whole route were somehow unreachable', () => {
    expect(UNREACHABLE_SECONDS * 200).toBeLessThan(2 ** 31);
    expect(UNREACHABLE_METRES * 200).toBeLessThan(2 ** 32);
  });
});

describe('strandedPoints', () => {
  it('finds the pin the road network cannot reach in either direction', () => {
    const encoded = encodeMatrix(
      {
        distances_km: [[0, 10, null], [10, 0, null], [null, null, 0]],
        durations_min: [[0, 15, null], [15, 0, null], [null, null, 0]],
      },
      3
    );
    expect([...strandedPoints(encoded, 3)]).toEqual([2]);
  });

  it('keeps a point that is reachable one way only', () => {
    const encoded = encodeMatrix(
      {
        distances_km: [[0, 10], [null, 0]],
        durations_min: [[0, 15], [null, 0]],
      },
      2
    );
    expect([...strandedPoints(encoded, 2)]).toEqual([]);
  });
});

describe('costModel', () => {
  it('is absent when nobody has recorded what anything costs', () => {
    expect(costModel([vehicle(), vehicle({ id: 'v2' })])).toBeNull();
  });

  it('counts money in bani and fills a gap from the rest of the fleet', () => {
    const model = costModel([
      vehicle({ cost_per_km: 2.5, cost_per_hour: 40 }),
      vehicle({ id: 'v2', cost_per_km: 3.5, cost_per_hour: 60 }),
      vehicle({ id: 'v3' }),
    ]);
    expect(model({ cost_per_km: 2.5, cost_per_hour: 40 })).toEqual({ per_km: 250, per_hour: 4000 });
    expect(model({})).toEqual({ per_km: 300, per_hour: 5000 });
  });
});

describe('buildSolverInput', () => {
  it('turns a delivery into a job that unloads and a pickup into one that loads', () => {
    const orders = [
      order({ id: 'a', type: 'livrare' }),
      order({ id: 'b', type: 'ridicare', latitude: 45.1, longitude: 25.1 }),
      order({ id: 'c', type: 'schimb', latitude: 45.2, longitude: 25.2 }),
    ];
    const { problem } = buildSolverInput({
      orders, vehicles: [vehicle()], depot: DEPOT, matrix: fullMatrix(4),
    });

    expect(problem.jobs[0]).toMatchObject({ delivery: [1200, 240, 3] });
    expect(problem.jobs[0].pickup).toBeUndefined();
    expect(problem.jobs[1]).toMatchObject({ pickup: [1200, 240, 3] });
    expect(problem.jobs[1].delivery).toBeUndefined();
    expect(problem.jobs[2]).toMatchObject({ pickup: [1200, 240, 3], delivery: [1200, 240, 3] });
  });

  it('gives the job what it requires and the vehicle what it has', () => {
    const { problem } = buildSolverInput({
      orders: [order({ requires: ['ADR'] })],
      vehicles: [vehicle({ capabilities: ['adr', 'frigo'] })],
      depot: DEPOT,
      matrix: fullMatrix(2),
    });
    // Vocabulary is adr=0, frigo=1. VROOM assigns only when the job's set fits the vehicle's.
    expect(problem.jobs[0].skills).toEqual([0]);
    expect(problem.vehicles[0].skills).toEqual([0, 1]);
  });

  it('omits skills entirely when nothing needs them', () => {
    const { problem } = buildSolverInput({
      orders: [order()], vehicles: [vehicle()], depot: DEPOT, matrix: fullMatrix(2),
    });
    expect(problem.jobs[0].skills).toBeUndefined();
    expect(problem.vehicles[0].skills).toBeUndefined();
  });

  it('bounds the vehicle by the driver shift, falling back to the working day', () => {
    const { problem } = buildSolverInput({
      orders: [order()],
      vehicles: [
        vehicle({ driver: { id: 'd1', shift_start: '07:00', shift_end: '15:00' } }),
        vehicle({ id: 'v2' }),
      ],
      depot: DEPOT,
      matrix: fullMatrix(2),
    });
    expect(problem.vehicles[0].time_window).toEqual([25_200, 54_000]);
    expect(problem.vehicles[1].time_window).toEqual([21_600, 79_200]);
  });

  it('passes an order window through and leaves an open one unconstrained', () => {
    const { problem } = buildSolverInput({
      orders: [
        order({ id: 'a', window_start: '09:00', window_end: '12:00' }),
        order({ id: 'b', latitude: 45.1, longitude: 25.1 }),
      ],
      vehicles: [vehicle()],
      depot: DEPOT,
      matrix: fullMatrix(3),
    });
    expect(problem.jobs[0].time_windows).toEqual([[32_400, 43_200]]);
    expect(problem.jobs[1].time_windows).toBeUndefined();
  });

  it('reports an order with no coordinates instead of quietly leaving it out', () => {
    const { problem, dropped } = buildSolverInput({
      orders: [order({ id: 'a' }), order({ id: 'b', latitude: null, longitude: null })],
      vehicles: [vehicle()],
      depot: DEPOT,
      matrix: fullMatrix(2),
    });
    expect(problem.jobs).toHaveLength(1);
    expect(dropped).toEqual([{ order_id: 'b', reason: 'fara_coordonate' }]);
  });

  it('reports an order the road network cannot reach', () => {
    const matrix = fullMatrix(3);
    // Index 2 is the second order's point: cut it off in both directions.
    for (let i = 0; i < 3; i += 1) {
      if (i === 2) continue;
      matrix.distances_km[i][2] = null;
      matrix.distances_km[2][i] = null;
      matrix.durations_min[i][2] = null;
      matrix.durations_min[2][i] = null;
    }
    const { problem, dropped } = buildSolverInput({
      orders: [order({ id: 'a' }), order({ id: 'b', latitude: 45.9, longitude: 25.9 })],
      vehicles: [vehicle()],
      depot: DEPOT,
      matrix,
    });
    expect(problem.jobs).toHaveLength(1);
    expect(dropped).toEqual([{ order_id: 'b', reason: 'fara_drum' }]);
  });

  it('reports a vehicle with nowhere to start from', () => {
    const { problem, dropped } = buildSolverInput({
      orders: [order()],
      vehicles: [vehicle(), vehicle({ id: 'v2', home: null })],
      depot: null,
      matrix: fullMatrix(2),
    });
    expect(problem.vehicles).toHaveLength(1);
    expect(dropped).toEqual([{ vehicle_id: 'v2', reason: 'fara_depozit' }]);
  });

  it('optimizes for time when there is no cost model, and says so', () => {
    const { problem, index } = buildSolverInput({
      orders: [order()], vehicles: [vehicle()], depot: DEPOT, matrix: fullMatrix(2),
    });
    expect(problem.vehicles[0].costs).toBeUndefined();
    expect(index.objective).toBe('timp');
  });

  it('lets an unrecorded capacity through instead of rejecting every order', () => {
    const { problem } = buildSolverInput({
      orders: [order({ weight_kg: 900 }), order({ id: 'b', weight_kg: 800, latitude: 45.1, longitude: 25.1 })],
      vehicles: [vehicle({ capacity_kg: null })],
      depot: DEPOT,
      matrix: fullMatrix(3),
    });
    expect(problem.vehicles[0].capacity[0]).toBe(1700);
  });
});

describe('parseSolution', () => {
  const built = () => buildSolverInput({
    orders: [
      order({ id: 'a', location_id: 'l1' }),
      order({ id: 'b', location_id: 'l2', type: 'ridicare', latitude: 45.1, longitude: 25.1 }),
    ],
    vehicles: [vehicle({ driver: { id: 'd1' } })],
    depot: DEPOT,
    matrix: fullMatrix(3),
  });

  const response = {
    code: 0,
    summary: { cost: 5400, distance: 30_000, duration: 2700, service: 2400, waiting_time: 0, unassigned: 0 },
    routes: [{
      vehicle: 1,
      cost: 5400,
      distance: 30_000,
      duration: 2700,
      service: 2400,
      waiting_time: 0,
      steps: [
        { type: 'start', arrival: 21_600, duration: 0, distance: 0, service: 0 },
        { type: 'job', id: 1, arrival: 22_500, duration: 900, distance: 10_000, service: 1200 },
        { type: 'job', id: 2, arrival: 24_600, duration: 1800, distance: 20_000, service: 1200 },
        { type: 'end', arrival: 26_700, duration: 2700, distance: 30_000, service: 0 },
      ],
    }],
    unassigned: [],
  };

  it('turns cumulative totals into the legs a dispatch board shows', () => {
    const { index, dropped } = built();
    const plan = parseSolution(response, { index, dropped });
    expect(plan.routes[0].stops.map((s) => s.leg_distance_km)).toEqual([0, 10, 10, 10]);
    expect(plan.routes[0].stops.map((s) => s.leg_duration_min)).toEqual([0, 15, 15, 15]);
  });

  it('names the stops the way route_stops is allowed to', () => {
    const { index, dropped } = built();
    const plan = parseSolution(response, { index, dropped });
    expect(plan.routes[0].stops.map((s) => s.kind))
      .toEqual(['depot_start', 'livrare', 'ridicare', 'depot_end']);
  });

  it('carries the order and location back onto every served stop', () => {
    const { index, dropped } = built();
    const plan = parseSolution(response, { index, dropped });
    expect(plan.routes[0].stops[1]).toMatchObject({ order_id: 'a', location_id: 'l1' });
    expect(plan.routes[0].stops[2]).toMatchObject({ order_id: 'b', location_id: 'l2' });
    expect(plan.routes[0]).toMatchObject({ vehicle_id: 'v1', driver_id: 'd1' });
  });

  it('leaves cost null when the run was only ever optimizing time', () => {
    const { index, dropped } = built();
    const plan = parseSolution(response, { index, dropped });
    expect(index.objective).toBe('timp');
    expect(plan.kpis.cost).toBeNull();
    expect(plan.kpis.distance_km).toBe(30);
    expect(plan.kpis.duration_min).toBe(45);
  });

  it('reports cost in lei once a cost model exists', () => {
    const { index, dropped } = buildSolverInput({
      orders: [order()],
      vehicles: [vehicle({ cost_per_km: 2.5, cost_per_hour: 40 })],
      depot: DEPOT,
      matrix: fullMatrix(2),
    });
    const plan = parseSolution(response, { index, dropped });
    expect(plan.kpis.cost).toBe(54);
  });

  it('lists what VROOM refused alongside what never reached it', () => {
    const { index } = built();
    const plan = parseSolution(
      { ...response, unassigned: [{ id: 2, type: 'job' }] },
      { index, dropped: [{ order_id: 'z', reason: 'fara_drum' }] }
    );
    expect(plan.unassigned).toEqual([
      { order_id: 'b', order_number: 'CMD-1', reason: 'nealocat' },
      { order_id: 'z', reason: 'fara_drum' },
    ]);
    expect(plan.kpis.unassigned).toBe(2);
  });
});

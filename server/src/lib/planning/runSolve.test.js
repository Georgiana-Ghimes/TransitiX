import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSolve } from './runSolve.js';

const originalOsrm = process.env.OSRM_URL;
const originalVroom = process.env.VROOM_URL;

afterEach(() => {
  if (originalOsrm === undefined) delete process.env.OSRM_URL;
  else process.env.OSRM_URL = originalOsrm;
  if (originalVroom === undefined) delete process.env.VROOM_URL;
  else process.env.VROOM_URL = originalVroom;
  vi.restoreAllMocks();
});

const DEPOT = {
  id: 'dep', kind: 'depot', latitude: 44.4, longitude: 26.1, is_active: true, name: 'Baza',
};

const ORDER = {
  id: 'o1', order_number: 'CMD-1', type: 'livrare', location_id: 'l1',
  status: 'nou', weight_kg: 500, volume_mc: 1, pallets: 1, requires: [],
  service_time_min: 15, latitude: 44.5, longitude: 26.2, window_start: null, window_end: null,
};

const VEHICLE = {
  id: 'v1', plate: 'B 01 AAA', is_active: true, status: 'available',
  capacity_kg: 3500, capacity_mc: 20, capacity_pallets: 12, capabilities: [],
  home_location_id: 'dep', home_latitude: 44.4, home_longitude: 26.1, home_name: 'Baza',
};

/**
 * Answers the SQL the orchestrator asks, in order of what each statement looks like.
 * Stores the scenario rows so a failed solve can still be inspected.
 */
function fakeDb({ orders = [ORDER], vehicles = [VEHICLE], drivers = [], depot = DEPOT } = {}) {
  const scenarios = new Map();
  const query = async (sql, params) => {
    if (sql.includes('FROM orders')) return { rows: orders };
    if (sql.includes('FROM vehicles')) return { rows: vehicles };
    if (sql.includes('FROM drivers')) return { rows: drivers };
    if (sql.includes('FROM routes')) return { rows: [] };
    if (sql.includes("kind = 'depot'")) return { rows: depot ? [depot] : [] };
    if (sql.includes('FROM locations') && sql.includes('id = $2')) {
      return { rows: depot && params[1] === depot.id ? [depot] : [] };
    }
    if (sql.includes('COUNT(*)')) return { rows: [{ n: scenarios.size }] };
    if (sql.includes('INSERT INTO route_scenarios')) {
      const row = {
        id: `sc-${scenarios.size + 1}`,
        company_id: params[0],
        route_date: params[1],
        name: params[2],
        params: JSON.parse(params[3]),
        status: 'draft',
        kpis: {},
        solution: null,
        error_message: null,
        is_committed: false,
        created_by: params[4],
      };
      scenarios.set(row.id, row);
      return { rows: [row] };
    }
    if (sql.includes('UPDATE route_scenarios')) {
      const id = params[params.length - 2];
      const companyId = params[params.length - 1];
      const row = scenarios.get(id);
      if (!row || row.company_id !== companyId) return { rows: [] };
      if (sql.includes("status = 'esuat'")) {
        row.status = 'esuat';
        row.error_message = params[0];
      } else if (sql.includes("status = 'rulat'")) {
        row.status = 'rulat';
        row.kpis = JSON.parse(params[0]);
        row.solution = JSON.parse(params[1]);
        row.error_message = sql.includes('error_message = NULL') ? null : params[2];
      }
      scenarios.set(id, row);
      return { rows: [row] };
    }
    return { rows: [] };
  };
  return { query, scenarios };
}

function fullMatrix(n) {
  return {
    distances_km: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 10))),
    durations_min: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 15))),
    cache: { hits: 0, misses: n * n - n, calls: 1 },
  };
}

describe('runSolve', () => {
  it('refuses to invent a plan when the stack is not configured', async () => {
    delete process.env.OSRM_URL;
    delete process.env.VROOM_URL;
    const db = fakeDb();
    await expect(runSolve(db, { companyId: 'co', routeDate: '2026-08-25' }))
      .rejects.toMatchObject({ status: 503 });
    expect(db.scenarios.size).toBe(0);
  });

  it('rejects a bad date before writing anything', async () => {
    process.env.OSRM_URL = 'http://osrm';
    process.env.VROOM_URL = 'http://vroom';
    const db = fakeDb();
    await expect(runSolve(db, { companyId: 'co', routeDate: 'ieri' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('measures, solves, and stores a scenario', async () => {
    process.env.OSRM_URL = 'http://osrm';
    process.env.VROOM_URL = 'http://vroom';
    const db = fakeDb({
      orders: [
        ORDER,
        { ...ORDER, id: 'o2', order_number: 'CMD-2', latitude: 44.6, longitude: 26.3, location_id: 'l2' },
      ],
      drivers: [{ id: 'd1', name: 'Ana', shift_start: '07:00', shift_end: '17:00' }],
    });

    let seenProblem = null;
    const matrix = async (_db, _co, points) => fullMatrix(points.length);
    const solve = async (problem) => {
      seenProblem = problem;
      return {
        code: 0,
        summary: { cost: 1800, distance: 20_000, duration: 1800, service: 1800, waiting_time: 0 },
        routes: [{
          vehicle: 1, cost: 1800, distance: 20_000, duration: 1800, service: 1800, waiting_time: 0,
          steps: [
            { type: 'start', arrival: 25_200, duration: 0, distance: 0, service: 0 },
            { type: 'job', id: 1, arrival: 26_100, duration: 900, distance: 10_000, service: 900 },
            { type: 'job', id: 2, arrival: 27_900, duration: 1800, distance: 20_000, service: 900 },
            { type: 'end', arrival: 28_800, duration: 2700, distance: 30_000, service: 0 },
          ],
        }],
        unassigned: [],
      };
    };

    const row = await runSolve(db, {
      companyId: 'co', userId: 'u1', routeDate: '2026-08-25', name: 'A/B ieftin',
      matrix, solve,
    });

    expect(row.status).toBe('rulat');
    expect(row.name).toBe('A/B ieftin');
    expect(row.solution.routes).toHaveLength(1);
    expect(row.solution.routes[0].vehicle_id).toBe('v1');
    expect(row.solution.routes[0].driver_id).toBe('d1');
    expect(row.solution.routes[0].stops.map((s) => s.kind))
      .toEqual(['depot_start', 'livrare', 'livrare', 'depot_end']);
    expect(row.kpis.routes).toBe(1);
    expect(row.kpis.cache.calls).toBe(1);
    expect(seenProblem.options.t).toBe(30);
    expect(seenProblem.matrices.car.durations[0][1]).toBe(900);
  });

  it('marks the draft as failed when the solver throws', async () => {
    process.env.OSRM_URL = 'http://osrm';
    process.env.VROOM_URL = 'http://vroom';
    const db = fakeDb({
      orders: [ORDER, { ...ORDER, id: 'o2', latitude: 44.6, longitude: 26.3, location_id: 'l2' }],
    });
    const err = new Error('VROOM a căzut');
    err.status = 503;

    await expect(runSolve(db, {
      companyId: 'co', routeDate: '2026-08-25',
      matrix: async (_d, _c, points) => fullMatrix(points.length),
      solve: async () => { throw err; },
    })).rejects.toMatchObject({ status: 503 });

    const stored = [...db.scenarios.values()][0];
    expect(stored.status).toBe('esuat');
    expect(stored.error_message).toMatch(/căzut/);
  });
});

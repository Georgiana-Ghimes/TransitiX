import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assembleMatrix,
  cachedMatrix,
  coordinateKey,
  matrixTtlDays,
  mergeTableResponse,
  planFetch,
} from './matrixCache.js';

const originalTtl = process.env.OSRM_MATRIX_TTL_DAYS;

afterEach(() => {
  if (originalTtl === undefined) delete process.env.OSRM_MATRIX_TTL_DAYS;
  else process.env.OSRM_MATRIX_TTL_DAYS = originalTtl;
  vi.restoreAllMocks();
});

/** A grid of points far enough apart that no two share a snapped node. */
function points(n) {
  return Array.from({ length: n }, (_, i) => ({ latitude: 44 + i * 0.1, longitude: 26 + i * 0.1 }));
}

function nodes(n) {
  return points(n).map(coordinateKey);
}

function pairsFor(nodeKeys) {
  const cached = new Map();
  nodeKeys.forEach((from, i) => {
    nodeKeys.forEach((to, j) => {
      if (i === j) return;
      cached.set(`${from}|${to}`, { distance_km: (i + 1) * 10 + j, duration_min: (i + 1) + j });
    });
  });
  return cached;
}

/**
 * Stands in for OSRM: returns a sub-matrix whose snapped locations are the requested points
 * unchanged, which is what a graph with a road at every coordinate would do.
 */
function fakeTable(all) {
  const calls = [];
  const table = async (_pts, { sources, destinations } = {}) => {
    calls.push({ sources, destinations });
    const wp = (i) => ({ ...all[i], snap_distance_m: 3.2 });
    return {
      distances_km: sources.map((i) => destinations.map((j) => (i === j ? 0 : i * 100 + j))),
      durations_min: sources.map((i) => destinations.map((j) => (i === j ? 0 : i * 10 + j))),
      sources: sources.map(wp),
      destinations: destinations.map(wp),
    };
  };
  return { table, calls };
}

/** Minimal Postgres stand-in: remembers what was written and replays it on the next read. */
function fakeDb() {
  const snaps = new Map();
  const pairs = new Map();
  const queries = [];

  const query = async (sql, params) => {
    queries.push(sql);
    if (sql.trimStart().startsWith('DELETE')) return { rows: [] };
    const profile = params?.[1];
    if (sql.includes('FROM geo_snap_cache')) {
      const rows = (params[2] || [])
        .filter((key) => snaps.has(`${profile}::${key}`))
        .map((key) => ({ point_key: key, node_key: snaps.get(`${profile}::${key}`) }));
      return { rows };
    }
    if (sql.includes('FROM route_matrix_cache')) {
      const keys = new Set(params[2] || []);
      const rows = [...pairs.entries()]
        .filter(([key]) => key.startsWith(`${profile}::`))
        .map(([key, value]) => {
          const [from, to] = key.slice(profile.length + 2).split('|');
          return { from_key: from, to_key: to, ...value };
        })
        .filter((row) => keys.has(row.from_key) && keys.has(row.to_key));
      return { rows };
    }
    if (sql.includes('INTO geo_snap_cache')) {
      params[2].forEach((pointKey, i) => snaps.set(`${profile}::${pointKey}`, params[3][i]));
      return { rows: [] };
    }
    if (sql.includes('INTO route_matrix_cache')) {
      params[2].forEach((from, i) => {
        pairs.set(`${profile}::${from}|${params[3][i]}`, {
          distance_km: params[4][i], duration_min: params[5][i],
        });
      });
      return { rows: [] };
    }
    return { rows: [] };
  };

  return { query, snaps, pairs, queries };
}

describe('coordinateKey', () => {
  it('rounds to about a metre so geocoder jitter does not split a place in two', () => {
    expect(coordinateKey({ latitude: 44.4268001, longitude: 26.1025004 })).toBe('44.42680,26.10250');
    expect(coordinateKey({ latitude: 44.4268, longitude: 26.1025 }))
      .toBe(coordinateKey({ lat: 44.42680004, lon: 26.10249996 }));
  });

  it('separates two genuinely different doors', () => {
    expect(coordinateKey({ latitude: 44.4268, longitude: 26.1025 }))
      .not.toBe(coordinateKey({ latitude: 44.4269, longitude: 26.1025 }));
  });
});

describe('matrixTtlDays', () => {
  it('falls back to the default for junk', () => {
    process.env.OSRM_MATRIX_TTL_DAYS = 'curand';
    expect(matrixTtlDays()).toBe(30);
    process.env.OSRM_MATRIX_TTL_DAYS = '-4';
    expect(matrixTtlDays()).toBe(30);
    process.env.OSRM_MATRIX_TTL_DAYS = '7';
    expect(matrixTtlDays()).toBe(7);
  });
});

describe('planFetch', () => {
  it('asks for the whole matrix when nothing is known', () => {
    const plan = planFetch(4, [null, null, null, null], new Map());
    expect(plan.hits).toBe(0);
    expect(plan.misses).toBe(12);
    expect(plan.fetches).toEqual([{ rows: [0, 1, 2, 3], cols: [0, 1, 2, 3] }]);
  });

  it('asks for nothing when every pair is cached', () => {
    const keys = nodes(5);
    const plan = planFetch(5, keys, pairsFor(keys));
    expect(plan.misses).toBe(0);
    expect(plan.fetches).toEqual([]);
  });

  it('costs one row and one column when a single new point joins a known set', () => {
    const keys = nodes(5);
    const cached = pairsFor(keys);
    const nodeKeys = [...keys.slice(0, 4), null];

    const plan = planFetch(5, nodeKeys, cached);

    // The new point misses against the other four in both directions.
    expect(plan.misses).toBe(8);
    expect(plan.fetches).toEqual([
      { rows: [4], cols: [0, 1, 2, 3, 4] },
      { rows: [0, 1, 2, 3], cols: [4] },
    ]);
    const cells = plan.fetches.reduce((sum, f) => sum + f.rows.length * f.cols.length, 0);
    expect(cells).toBeLessThan(5 * 5);
  });

  it('scales that saving — five new points among two hundred stay two thin rectangles', () => {
    const keys = nodes(200);
    const cached = pairsFor(keys);
    const nodeKeys = keys.map((key, i) => (i < 195 ? key : null));

    const plan = planFetch(200, nodeKeys, cached);

    expect(plan.fetches).toHaveLength(2);
    const cells = plan.fetches.reduce((sum, f) => sum + f.rows.length * f.cols.length, 0);
    expect(cells).toBe(5 * 200 + 195 * 5);
    expect(cells / (200 * 200)).toBeLessThan(0.06);
  });

  it('picks up pairs that expired even when every node is known', () => {
    const keys = nodes(4);
    const cached = pairsFor(keys);
    cached.delete(`${keys[1]}|${keys[2]}`);

    const plan = planFetch(4, keys, cached);

    expect(plan.misses).toBe(1);
    expect(plan.fetches).toEqual([{ rows: [1], cols: [2] }]);
  });

  it('collapses to a single call rather than several that cover nearly the same ground', () => {
    // Two of three points unknown: the two rectangles cover 8 of 9 cells, so splitting only
    // buys a second round trip.
    const keys = nodes(3);
    const plan = planFetch(3, [keys[0], null, null], new Map());
    expect(plan.fetches).toEqual([{ rows: [0, 1, 2], cols: [0, 1, 2] }]);
  });
});

describe('assembleMatrix', () => {
  it('puts zero on the diagonal and leaves an unmeasured cell null', () => {
    const keys = nodes(3);
    const cached = new Map([[`${keys[0]}|${keys[1]}`, { distance_km: 12.5, duration_min: 20 }]]);

    const { distances_km, durations_min } = assembleMatrix(3, keys, cached);

    expect(distances_km[0]).toEqual([0, 12.5, null]);
    expect(distances_km[2]).toEqual([null, null, 0]);
    expect(durations_min[0][1]).toBe(20);
  });

  it('reads zero between two points that snapped to the same node', () => {
    const shared = '44.42680,26.10250';
    const { distances_km, durations_min } = assembleMatrix(2, [shared, shared], new Map());
    expect(distances_km).toEqual([[0, 0], [0, 0]]);
    expect(durations_min).toEqual([[0, 0], [0, 0]]);
  });
});

describe('mergeTableResponse', () => {
  it('learns the snapped node of every point the response covers', () => {
    const nodeKeys = [null, null];
    const cached = new Map();

    const { learnedSnaps, learnedPairs } = mergeTableResponse(
      {
        distances_km: [[0, 8.4]],
        durations_min: [[0, 11]],
        sources: [{ latitude: 44.1, longitude: 26.1, snap_distance_m: 4 }],
        destinations: [
          { latitude: 44.1, longitude: 26.1, snap_distance_m: 4 },
          { latitude: 44.2, longitude: 26.2, snap_distance_m: 9 },
        ],
      },
      { rows: [0], cols: [0, 1], nodeKeys, cached }
    );

    expect(nodeKeys).toEqual(['44.10000,26.10000', '44.20000,26.20000']);
    expect(learnedSnaps.map((s) => s.snapDistanceM)).toEqual([4, 9]);
    expect(learnedPairs).toEqual([
      { from: '44.10000,26.10000', to: '44.20000,26.20000', distance_km: 8.4, duration_min: 11 },
    ]);
    expect(cached.get('44.10000,26.10000|44.20000,26.20000')).toEqual({
      distance_km: 8.4, duration_min: 11,
    });
  });

  it('keeps a node it already had, so one point never splits across two keys mid-call', () => {
    const nodeKeys = ['44.10000,26.10000', null];
    const cached = new Map();

    mergeTableResponse(
      {
        distances_km: [[0, 8.4]],
        durations_min: [[0, 11]],
        // OSRM snapped the first point a few metres away this time — a rebuilt graph.
        sources: [{ latitude: 44.10004, longitude: 26.1 }],
        destinations: [{ latitude: 44.10004, longitude: 26.1 }, { latitude: 44.2, longitude: 26.2 }],
      },
      { rows: [0], cols: [0, 1], nodeKeys, cached }
    );

    expect(nodeKeys[0]).toBe('44.10000,26.10000');
  });

  it('stores nothing for a pair OSRM could not connect', () => {
    const nodeKeys = [null, null];
    const cached = new Map();

    const { learnedPairs } = mergeTableResponse(
      {
        distances_km: [[0, null]],
        durations_min: [[0, null]],
        sources: [{ latitude: 44.1, longitude: 26.1 }],
        destinations: [{ latitude: 44.1, longitude: 26.1 }, { latitude: 44.2, longitude: 26.2 }],
      },
      { rows: [0], cols: [0, 1], nodeKeys, cached }
    );

    expect(learnedPairs).toEqual([]);
    expect(cached.size).toBe(0);
  });
});

describe('cachedMatrix', () => {
  it('measures once, then answers the same question without touching OSRM', async () => {
    const db = fakeDb();
    const pts = points(4);
    const { table, calls } = fakeTable(pts);

    const first = await cachedMatrix(db, 'co', pts, { profile: 'driving', table });
    expect(calls).toHaveLength(1);
    expect(first.cache.hits).toBe(0);
    expect(first.distances_km[1][2]).toBe(102);

    const second = await cachedMatrix(db, 'co', pts, { profile: 'driving', table });
    expect(calls).toHaveLength(1);
    expect(second.cache.misses).toBe(0);
    expect(second.cache.calls).toBe(0);
    expect(second.distances_km).toEqual(first.distances_km);
    expect(second.durations_min).toEqual(first.durations_min);
  });

  it('fetches only the new point when the day adds one stop', async () => {
    const db = fakeDb();
    const pts = points(5);
    const { table, calls } = fakeTable(pts);

    await cachedMatrix(db, 'co', pts.slice(0, 4), { profile: 'driving', table });
    calls.length = 0;

    const result = await cachedMatrix(db, 'co', pts, { profile: 'driving', table });

    expect(calls).toEqual([
      { sources: [4], destinations: [0, 1, 2, 3, 4] },
      { sources: [0, 1, 2, 3], destinations: [4] },
    ]);
    expect(result.cache.fetched_cells).toBe(9);
    // Old cells come from the cache, new ones from the call, and both are the same numbers.
    expect(result.distances_km[1][2]).toBe(102);
    expect(result.distances_km[4][1]).toBe(401);
    expect(result.distances_km[1][4]).toBe(104);
  });

  it('measures rather than fails when the cache cannot be read', async () => {
    const db = { query: async () => { throw new Error('conexiune pierduta'); } };
    const pts = points(3);
    const { table, calls } = fakeTable(pts);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await cachedMatrix(db, 'co', pts, { profile: 'driving', table });

    expect(calls).toHaveLength(1);
    expect(result.distances_km[0][1]).toBe(1);
    expect(result.cache.hits).toBe(0);
  });

  it('still returns the matrix when the cache cannot be written', async () => {
    const db = {
      query: async (sql) => {
        if (sql.includes('INSERT')) throw new Error('disc plin');
        return { rows: [] };
      },
    };
    const pts = points(3);
    const { table } = fakeTable(pts);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await cachedMatrix(db, 'co', pts, { profile: 'driving', table });

    expect(result.distances_km[2][0]).toBe(200);
  });

  it('keeps profiles apart so a truck distance never answers for a van', async () => {
    const db = fakeDb();
    const pts = points(3);
    const { table, calls } = fakeTable(pts);

    await cachedMatrix(db, 'co', pts, { profile: 'driving', table });
    calls.length = 0;
    await cachedMatrix(db, 'co', pts, { profile: 'truck', table });

    expect(calls).toHaveLength(1);
  });
});

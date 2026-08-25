/**
 * Cached road-network distance matrices.
 *
 * A distance between two points on a road graph does not change from one morning to the
 * next, but the optimizer in P2 asks for the same 200×200 matrix every day. This module
 * remembers the answers.
 *
 * Two things make it worth having rather than being a plain memoization:
 *
 * 1. Keys are the **snapped graph nodes**, not the coordinates we asked about. Two pins a
 *    few metres apart on the same street resolve to one node and share one cached row, so
 *    re-geocoding a customer does not invalidate its distances.
 * 2. A partial miss fetches a **sub-matrix**, not the whole thing. One new customer among
 *    two hundred costs one row and one column, not forty thousand cells.
 *
 * The cache is best-effort in both directions: if the database misbehaves we measure
 * instead of failing, and if OSRM is down the caller gets the same error it always got.
 */

import { osrmProfile, osrmTable, toCoordinate } from './osrm.js';

/** Roads change. A month-old distance is still true; a year-old one may not be. */
export const DEFAULT_TTL_DAYS = 30;

/** ~1 m. Anything finer is geocoder noise, not a different place. */
const KEY_DECIMALS = 5;

/** Postgres arrays get unwieldy long before this; the writes are chunked. */
const WRITE_CHUNK = 5000;

/** Below this share of the matrix, fetching pieces beats fetching the lot. */
const SPLIT_THRESHOLD = 0.6;

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastPruneAt = 0;

export function matrixTtlDays() {
  const raw = Number(process.env.OSRM_MATRIX_TTL_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_TTL_DAYS;
}

/** Stable string for a coordinate, used for both the requested point and the snapped node. */
export function coordinateKey(point) {
  const { latitude, longitude } = toCoordinate(point);
  return `${latitude.toFixed(KEY_DECIMALS)},${longitude.toFixed(KEY_DECIMALS)}`;
}

function pairKey(from, to) {
  return `${from}|${to}`;
}

/**
 * Which cells still have to be measured, and how to ask for them.
 *
 * The naive answer — one rectangle spanning every row and column that contains a miss —
 * degenerates the moment a single new point appears: that point misses against everything,
 * so every row and every column is dirty and we re-measure the whole matrix. The saving is
 * lost exactly in the case the cache exists for.
 *
 * So the misses are split along the way they actually arise. A point whose graph node we do
 * not know yet misses in both directions against everything, which is two thin rectangles.
 * Everything else is a pair that expired or was never stored, which is one small rectangle
 * over the handful of points involved.
 */
export function planFetch(count, nodeKeys = [], cached = new Map()) {
  const unknown = [];
  const known = [];
  for (let i = 0; i < count; i += 1) {
    if (nodeKeys[i]) known.push(i);
    else unknown.push(i);
  }

  const stragglerRows = new Set();
  const stragglerCols = new Set();
  let hits = 0;
  let misses = unknown.length * (count - 1) + known.length * unknown.length;

  for (const i of known) {
    for (const j of known) {
      if (i === j) continue;
      if (nodeKeys[i] === nodeKeys[j] || cached.has(pairKey(nodeKeys[i], nodeKeys[j]))) {
        hits += 1;
        continue;
      }
      misses += 1;
      stragglerRows.add(i);
      stragglerCols.add(j);
    }
  }

  const all = Array.from({ length: count }, (_, i) => i);
  const fetches = [];
  if (unknown.length) {
    fetches.push({ rows: unknown, cols: all });
    if (known.length) fetches.push({ rows: known, cols: unknown });
  }
  if (stragglerRows.size) {
    fetches.push({
      rows: [...stragglerRows].sort((a, b) => a - b),
      cols: [...stragglerCols].sort((a, b) => a - b),
    });
  }

  // Splitting only pays when it removes most of the work. Several rectangles that between
  // them cover nearly the whole matrix cost OSRM the same and us an extra round trip.
  const planned = fetches.reduce((sum, f) => sum + f.rows.length * f.cols.length, 0);
  if (fetches.length > 1 && planned > SPLIT_THRESHOLD * count * count) {
    return { hits, misses, fetches: [{ rows: all, cols: all }] };
  }

  return { hits, misses, fetches };
}

/**
 * The matrix as the caller expects it. A cell we could not measure stays null rather than
 * zero — the planner already knows how to stop the clock on a gap, and a zero would look
 * like two points at the same address.
 */
export function assembleMatrix(count, nodeKeys = [], cached = new Map()) {
  const distances_km = [];
  const durations_min = [];

  for (let i = 0; i < count; i += 1) {
    const distanceRow = [];
    const durationRow = [];
    for (let j = 0; j < count; j += 1) {
      const from = nodeKeys[i];
      const to = nodeKeys[j];
      // Same graph node means no travel, whether it is the same point or two doors that
      // snapped together.
      if (i === j || (from && to && from === to)) {
        distanceRow.push(0);
        durationRow.push(0);
        continue;
      }
      const hit = from && to ? cached.get(pairKey(from, to)) : null;
      distanceRow.push(hit?.distance_km ?? null);
      durationRow.push(hit?.duration_min ?? null);
    }
    distances_km.push(distanceRow);
    durations_min.push(durationRow);
  }

  return { distances_km, durations_min };
}

/**
 * Folds a sub-matrix response back into the caches.
 *
 * OSRM returns the snapped location of every point it was given, so a `table` call teaches
 * us the node mapping for free — no `nearest` round trip is ever needed.
 */
export function mergeTableResponse(response, { rows, cols, nodeKeys, cached }) {
  const learnedSnaps = [];
  const learnedPairs = [];

  const learn = (index, waypoint) => {
    // A point that already has a node keeps it. Everything cached for that point is filed
    // under that key, and a graph rebuild that moved the snap by a metre must not split one
    // point across two keys in the middle of a single matrix. The TTL clears it out instead.
    if (nodeKeys[index]) return;
    if (!waypoint || waypoint.latitude == null || waypoint.longitude == null) return;
    const key = coordinateKey(waypoint);
    nodeKeys[index] = key;
    learnedSnaps.push({ index, nodeKey: key, snapDistanceM: waypoint.snap_distance_m ?? null });
  };

  rows.forEach((index, k) => learn(index, response?.sources?.[k]));
  cols.forEach((index, k) => learn(index, response?.destinations?.[k]));

  rows.forEach((rowIndex, k) => {
    cols.forEach((colIndex, l) => {
      const from = nodeKeys[rowIndex];
      const to = nodeKeys[colIndex];
      if (!from || !to || from === to) return;
      const distance = response?.distances_km?.[k]?.[l];
      const duration = response?.durations_min?.[k]?.[l];
      if (distance == null && duration == null) return;
      const entry = { distance_km: distance ?? null, duration_min: duration ?? null };
      cached.set(pairKey(from, to), entry);
      learnedPairs.push({ from, to, ...entry });
    });
  });

  return { learnedSnaps, learnedPairs };
}

async function loadSnaps(db, companyId, profile, pointKeys) {
  const result = await db.query(
    `SELECT point_key, node_key FROM geo_snap_cache
     WHERE company_id = $1 AND profile = $2 AND point_key = ANY($3::text[]) AND expires_at > NOW()`,
    [companyId, profile, [...new Set(pointKeys)]]
  );
  return new Map(result.rows.map((row) => [row.point_key, row.node_key]));
}

async function loadPairs(db, companyId, profile, nodeKeys) {
  const keys = [...new Set(nodeKeys.filter(Boolean))];
  if (keys.length < 2) return new Map();
  const result = await db.query(
    `SELECT from_key, to_key, distance_km, duration_min FROM route_matrix_cache
     WHERE company_id = $1 AND profile = $2
       AND from_key = ANY($3::text[]) AND to_key = ANY($3::text[])
       AND expires_at > NOW()`,
    [companyId, profile, keys]
  );
  return new Map(result.rows.map((row) => [
    pairKey(row.from_key, row.to_key),
    { distance_km: row.distance_km == null ? null : Number(row.distance_km),
      duration_min: row.duration_min == null ? null : Number(row.duration_min) },
  ]));
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function saveSnaps(db, companyId, profile, entries, ttl) {
  if (!entries.length) return;
  for (const batch of chunk(entries, WRITE_CHUNK)) {
    await db.query(
      `INSERT INTO geo_snap_cache (company_id, profile, point_key, node_key, snap_distance_m, expires_at)
       SELECT $1, $2, p, n, d, NOW() + make_interval(days => $6::int)
       FROM UNNEST($3::text[], $4::text[], $5::numeric[]) AS x(p, n, d)
       ON CONFLICT (company_id, profile, point_key)
       DO UPDATE SET node_key = EXCLUDED.node_key,
                     snap_distance_m = EXCLUDED.snap_distance_m,
                     expires_at = EXCLUDED.expires_at`,
      [
        companyId, profile,
        batch.map((e) => e.pointKey),
        batch.map((e) => e.nodeKey),
        batch.map((e) => e.snapDistanceM),
        ttl,
      ]
    );
  }
}

async function savePairs(db, companyId, profile, entries, ttl) {
  if (!entries.length) return;
  for (const batch of chunk(entries, WRITE_CHUNK)) {
    await db.query(
      `INSERT INTO route_matrix_cache (company_id, profile, from_key, to_key, distance_km, duration_min, expires_at)
       SELECT $1, $2, f, t, d, m, NOW() + make_interval(days => $7::int)
       FROM UNNEST($3::text[], $4::text[], $5::numeric[], $6::numeric[]) AS x(f, t, d, m)
       ON CONFLICT (company_id, profile, from_key, to_key)
       DO UPDATE SET distance_km = EXCLUDED.distance_km,
                     duration_min = EXCLUDED.duration_min,
                     expires_at = EXCLUDED.expires_at`,
      [
        companyId, profile,
        batch.map((e) => e.from),
        batch.map((e) => e.to),
        batch.map((e) => e.distance_km),
        batch.map((e) => e.duration_min),
        ttl,
      ]
    );
  }
}

/** Opportunistic, at most hourly per process. Expired rows are already ignored by every read. */
async function pruneExpired(db) {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  await db.query(`DELETE FROM route_matrix_cache WHERE expires_at < NOW()`);
  await db.query(`DELETE FROM geo_snap_cache WHERE expires_at < NOW()`);
}

/**
 * Distance and duration matrix for a list of points, measured once and remembered.
 *
 * Falls back to a plain OSRM call on any cache failure: a matrix that is slow to obtain is
 * a performance problem, but a matrix the dispatcher cannot obtain at all is an outage.
 */
export async function cachedMatrix(db, companyId, points, {
  profile = osrmProfile(),
  ttlDays = null,
  table = osrmTable,
} = {}) {
  const count = Array.isArray(points) ? points.length : 0;
  if (count < 2) return { ...(await table(points)), cache: null };

  const ttl = ttlDays ?? matrixTtlDays();
  const pointKeys = points.map(coordinateKey);
  const nodeKeys = new Array(count).fill(null);
  let cached = new Map();
  let cacheUsable = true;

  try {
    const snaps = await loadSnaps(db, companyId, profile, pointKeys);
    pointKeys.forEach((key, index) => { nodeKeys[index] = snaps.get(key) || null; });
    cached = await loadPairs(db, companyId, profile, nodeKeys);
  } catch (err) {
    console.error('[matrix cache] read', err.message);
    cacheUsable = false;
    nodeKeys.fill(null);
    cached = new Map();
  }

  const plan = planFetch(count, nodeKeys, cached);
  const snapsToSave = [];
  const pairsToSave = [];
  let fetchedCells = 0;

  for (const fetch of plan.fetches) {
    const response = await table(points, { sources: fetch.rows, destinations: fetch.cols });
    fetchedCells += fetch.rows.length * fetch.cols.length;
    const { learnedSnaps, learnedPairs } = mergeTableResponse(response, {
      rows: fetch.rows,
      cols: fetch.cols,
      nodeKeys,
      cached,
    });
    snapsToSave.push(...learnedSnaps.map((s) => ({ ...s, pointKey: pointKeys[s.index] })));
    pairsToSave.push(...learnedPairs);
  }

  if (cacheUsable && (snapsToSave.length || pairsToSave.length)) {
    try {
      await saveSnaps(db, companyId, profile, snapsToSave, ttl);
      await savePairs(db, companyId, profile, pairsToSave, ttl);
      await pruneExpired(db);
    } catch (err) {
      // A matrix we measured but could not store is still a correct matrix.
      console.error('[matrix cache] write', err.message);
    }
  }

  return {
    ...assembleMatrix(count, nodeKeys, cached),
    cache: {
      points: count,
      cells: count * count - count,
      hits: plan.hits,
      misses: plan.misses,
      calls: plan.fetches.length,
      fetched_cells: fetchedCells,
    },
  };
}

/**
 * VROOM client — the VRP solver behind the optimizer.
 *
 * Same discipline as the OSRM client next door: the solver is a sidecar, and when
 * VROOM_URL is unset the callers get a 503. A plan nobody solved is not a plan we invent.
 *
 * We always hand VROOM our own distance matrix rather than letting it call OSRM itself.
 * That keeps every measurement going through the cache in lib/geo/matrixCache.js, so the
 * second run of a day costs nothing, and it means only one component has to know where the
 * road graph lives.
 */

const DEFAULT_TIMEOUT_MS = 90_000;

/** VROOM's own default exploration level; higher is slower and marginally better. */
export const DEFAULT_EXPLORATION = 5;

export function vroomBaseUrl() {
  return String(process.env.VROOM_URL || '').trim().replace(/\/+$/, '');
}

export function vroomConfigured() {
  return Boolean(vroomBaseUrl());
}

/** How long the solver is allowed to think. The dispatcher is waiting. */
export function vroomTimeLimitSec() {
  const raw = Number(process.env.VROOM_TIME_LIMIT_SEC);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 30;
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** VROOM reports failure in the body with a non-zero code, not only in the HTTP status. */
export function parseSolveResponse(json) {
  if (!json || typeof json !== 'object') {
    throw httpError('VROOM a răspuns cu un corp gol', 502);
  }
  if (json.code !== 0) {
    const detail = json.error || `cod ${json.code}`;
    throw httpError(`VROOM nu a putut rezolva problema: ${detail}`, 422);
  }
  if (!Array.isArray(json.routes)) {
    throw httpError('VROOM a răspuns fără rute', 502);
  }
  return json;
}

function requireBaseUrl() {
  const baseUrl = vroomBaseUrl();
  if (!baseUrl) {
    throw httpError(
      'Optimizatorul nu este configurat. Setează VROOM_URL în server/.env (vezi docker-compose.vroom.yml).',
      503
    );
  }
  return baseUrl;
}

/**
 * Runs the solver. `problem` is a VROOM input document — see buildSolverInput in solver.js,
 * which is the only thing that should be producing one.
 */
export async function vroomSolve(problem, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) {
  const baseUrl = requireBaseUrl();
  let res;
  try {
    res = await fetchImpl(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(problem),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw httpError(
      timedOut
        ? `Optimizatorul nu a răspuns în ${Math.round(timeoutMs / 1000)} s`
        : `Optimizatorul este inaccesibil: ${err?.message || 'eroare de rețea'}`,
      503
    );
  }

  const json = await res.json().catch(() => null);
  if (!res.ok && json?.code == null) {
    throw httpError(`VROOM a răspuns ${res.status}`, 502);
  }
  return parseSolveResponse(json);
}

/** Cheap liveness probe for the health endpoint. Never throws. */
export async function vroomPing(options = {}) {
  if (!vroomConfigured()) {
    return { configured: false, ok: false, message: 'VROOM_URL nu este setat' };
  }
  try {
    // Two points and one job on a hand-written matrix: proves the solver runs without
    // depending on a road graph being loaded.
    await vroomSolve(
      {
        vehicles: [{ id: 1, start_index: 0, end_index: 0, profile: 'car' }],
        jobs: [{ id: 1, location_index: 1 }],
        matrices: { car: { durations: [[0, 60], [60, 0]] } },
      },
      { timeoutMs: 5000, ...options }
    );
    return { configured: true, ok: true };
  } catch (err) {
    return { configured: true, ok: false, message: err.message };
  }
}

/**
 * OSRM client — real road-network distances, durations and geometry.
 *
 * The server is a sidecar (see docker-compose.osrm.yml). Nothing here falls back
 * to a stub: when OSRM_URL is unset the callers return 503 so the UI never shows
 * an invented distance as if it were measured.
 */

const DEFAULT_PROFILE = 'driving';
const DEFAULT_TIMEOUT_MS = 15_000;

/** OSRM's own default is 100; the compose overlay raises it, we stay under it. */
export const MAX_MATRIX_POINTS = 200;
export const MAX_ROUTE_POINTS = 100;

export function osrmBaseUrl() {
  return String(process.env.OSRM_URL || '').trim().replace(/\/+$/, '');
}

export function osrmProfile() {
  return String(process.env.OSRM_PROFILE || '').trim() || DEFAULT_PROFILE;
}

export function osrmConfigured() {
  return Boolean(osrmBaseUrl());
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function badRequest(message) {
  return httpError(message, 400);
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Accepts { latitude, longitude } as stored on `locations` / `gps_logs`, plus lat/lon/lng aliases. */
export function toCoordinate(point) {
  const latitude = Number(point?.latitude ?? point?.lat);
  const longitude = Number(point?.longitude ?? point?.lon ?? point?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw badRequest('Fiecare punct are nevoie de latitude și longitude numerice');
  }
  if (latitude < -90 || latitude > 90) {
    throw badRequest(`Latitudine în afara intervalului: ${latitude}`);
  }
  if (longitude < -180 || longitude > 180) {
    throw badRequest(`Longitudine în afara intervalului: ${longitude}`);
  }
  return { latitude, longitude };
}

/** OSRM takes lon,lat pairs separated by semicolons — the reverse of the usual order. */
export function formatCoordinates(points, { min = 1, max = MAX_MATRIX_POINTS } = {}) {
  if (!Array.isArray(points) || points.length < min) {
    throw badRequest(`Sunt necesare cel puțin ${min} puncte`);
  }
  if (points.length > max) {
    throw badRequest(`Prea multe puncte: ${points.length} (maxim ${max})`);
  }
  return points
    .map(toCoordinate)
    .map((c) => `${round(c.longitude, 6)},${round(c.latitude, 6)}`)
    .join(';');
}

function indexList(values, count, label) {
  if (values == null) return null;
  if (!Array.isArray(values) || values.length === 0) {
    throw badRequest(`${label} trebuie să fie o listă de indici`);
  }
  return values.map((value) => {
    const idx = Number(value);
    if (!Number.isInteger(idx) || idx < 0 || idx >= count) {
      throw badRequest(`${label}: index invalid ${value}`);
    }
    return idx;
  });
}

export function buildRouteUrl(baseUrl, points, { profile = DEFAULT_PROFILE, overview = 'simplified' } = {}) {
  const coords = formatCoordinates(points, { min: 2, max: MAX_ROUTE_POINTS });
  const params = new URLSearchParams({
    overview,
    geometries: 'geojson',
    annotations: 'false',
    steps: 'false',
  });
  return `${baseUrl}/route/v1/${profile}/${coords}?${params}`;
}

export function buildTableUrl(baseUrl, points, { profile = DEFAULT_PROFILE, sources, destinations } = {}) {
  const coords = formatCoordinates(points, { min: 2, max: MAX_MATRIX_POINTS });
  const params = new URLSearchParams({ annotations: 'duration,distance' });
  const src = indexList(sources, points.length, 'sources');
  const dst = indexList(destinations, points.length, 'destinations');
  if (src) params.set('sources', src.join(';'));
  if (dst) params.set('destinations', dst.join(';'));
  return `${baseUrl}/table/v1/${profile}/${coords}?${params}`;
}

export function buildNearestUrl(baseUrl, point, { profile = DEFAULT_PROFILE, number = 1 } = {}) {
  const coords = formatCoordinates([point], { min: 1, max: 1 });
  return `${baseUrl}/nearest/v1/${profile}/${coords}?number=${Math.max(1, Math.min(10, Number(number) || 1))}`;
}

function osrmMessage(json) {
  if (!json) return null;
  if (json.message) return `OSRM: ${json.message}`;
  if (json.code && json.code !== 'Ok') return `OSRM: ${json.code}`;
  return null;
}

export function parseRouteResponse(json) {
  const problem = osrmMessage(json);
  if (problem) throw httpError(problem, 422);
  const route = json?.routes?.[0];
  if (!route) throw httpError('OSRM nu a găsit nicio rută între punctele date', 422);
  return {
    distance_km: round(route.distance / 1000, 3),
    duration_min: round(route.duration / 60, 2),
    geometry: route.geometry ?? null,
    legs: (route.legs || []).map((leg) => ({
      distance_km: round(leg.distance / 1000, 3),
      duration_min: round(leg.duration / 60, 2),
    })),
  };
}

function scaleMatrix(rows, divisor, decimals) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => (row || []).map((v) => (v == null ? null : round(v / divisor, decimals))));
}

/** Where OSRM actually put a point on the road graph. This is what the matrix cache keys on. */
function snappedWaypoints(list) {
  if (!Array.isArray(list)) return [];
  return list.map((wp) => ({
    latitude: wp?.location?.[1] ?? null,
    longitude: wp?.location?.[0] ?? null,
    snap_distance_m: wp?.distance == null ? null : round(wp.distance, 1),
  }));
}

export function parseTableResponse(json) {
  const problem = osrmMessage(json);
  if (problem) throw httpError(problem, 422);
  return {
    distances_km: scaleMatrix(json?.distances, 1000, 3),
    durations_min: scaleMatrix(json?.durations, 60, 2),
    sources: snappedWaypoints(json?.sources),
    destinations: snappedWaypoints(json?.destinations),
  };
}

export function parseNearestResponse(json) {
  const problem = osrmMessage(json);
  if (problem) throw httpError(problem, 422);
  const waypoints = (json?.waypoints || []).map((wp) => ({
    latitude: wp.location?.[1] ?? null,
    longitude: wp.location?.[0] ?? null,
    name: wp.name || null,
    /** Metres between the requested point and the nearest drivable road. */
    snap_distance_m: wp.distance == null ? null : round(wp.distance, 1),
  }));
  if (!waypoints.length) throw httpError('OSRM nu a găsit niciun drum în apropiere', 422);
  return { waypoints };
}

async function osrmFetch(url, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw httpError(
      timedOut
        ? `OSRM nu a răspuns în ${timeoutMs} ms`
        : `OSRM inaccesibil: ${err?.message || 'eroare de rețea'}`,
      503
    );
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw httpError(osrmMessage(json) || `OSRM a răspuns ${res.status}`, 502);
  }
  return json;
}

function requireBaseUrl() {
  const baseUrl = osrmBaseUrl();
  if (!baseUrl) {
    throw httpError(
      'OSRM nu este configurat. Setează OSRM_URL în server/.env (vezi docker-compose.osrm.yml).',
      503
    );
  }
  return baseUrl;
}

/** Shortest road route through the given points, in order. */
export async function osrmRoute(points, options = {}) {
  const url = buildRouteUrl(requireBaseUrl(), points, { profile: osrmProfile(), ...options });
  return parseRouteResponse(await osrmFetch(url, options));
}

/** Full distance/duration matrix — the input the VRP solver needs in P2. */
export async function osrmTable(points, options = {}) {
  const url = buildTableUrl(requireBaseUrl(), points, { profile: osrmProfile(), ...options });
  return parseTableResponse(await osrmFetch(url, options));
}

/** Snap a point to the road network — tells us whether a geocode landed somewhere drivable. */
export async function osrmNearest(point, options = {}) {
  const url = buildNearestUrl(requireBaseUrl(), point, { profile: osrmProfile(), ...options });
  return parseNearestResponse(await osrmFetch(url, options));
}

/** Cheap liveness probe for /api/geo/health. Never throws. */
export async function osrmPing(options = {}) {
  if (!osrmConfigured()) {
    return { configured: false, ok: false, message: 'OSRM_URL nu este setat' };
  }
  try {
    // Two points a few hundred metres apart in Bucharest — enough to prove the graph is loaded.
    await osrmRoute(
      [{ latitude: 44.4268, longitude: 26.1025 }, { latitude: 44.4325, longitude: 26.1039 }],
      { timeoutMs: 5000, ...options }
    );
    return { configured: true, ok: true, profile: osrmProfile() };
  } catch (err) {
    return { configured: true, ok: false, profile: osrmProfile(), message: err.message };
  }
}

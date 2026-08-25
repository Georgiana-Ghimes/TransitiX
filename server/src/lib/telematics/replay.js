/**
 * Historical replay helpers — pure.
 * Planned geometry comes from OSRM; the actual trail is the telematics breadcrumb.
 */

import { haversineM } from './exceptions.js';

/**
 * Thin a dense GPS trail for map drawing without changing endpoints.
 * Keeps a point when it moves ≥ minStepM from the last kept one, or is the last sample.
 */
export function downsampleTrail(points = [], { minStepM = 40, maxPoints = 1500 } = {}) {
  const list = (points || []).filter(
    (p) => Number.isFinite(Number(p.latitude ?? p.lat)) && Number.isFinite(Number(p.longitude ?? p.lon ?? p.lng))
  );
  if (list.length <= 2) return list.map(normalizePoint);

  const out = [normalizePoint(list[0])];
  let last = out[0];
  for (let i = 1; i < list.length - 1; i += 1) {
    const cur = normalizePoint(list[i]);
    const d = haversineM(last, cur);
    if (d != null && d >= minStepM) {
      out.push(cur);
      last = cur;
    }
  }
  out.push(normalizePoint(list[list.length - 1]));

  if (out.length <= maxPoints) return out;
  // Evenly thin further if still too dense (long motorway day).
  const step = Math.ceil(out.length / maxPoints);
  const thinned = out.filter((_, i) => i % step === 0 || i === out.length - 1);
  return thinned;
}

function normalizePoint(p) {
  return {
    latitude: Number(p.latitude ?? p.lat),
    longitude: Number(p.longitude ?? p.lon ?? p.lng),
    recorded_at: p.recorded_at ?? null,
    speed: p.speed != null && Number.isFinite(Number(p.speed)) ? Number(p.speed) : null,
    source: p.source ?? null,
  };
}

/** Sum of consecutive haversine segments — realized path length, not road network. */
export function trailLengthM(points = []) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const d = haversineM(points[i - 1], points[i]);
    if (d != null) total += d;
  }
  return Math.round(total);
}

/** Leaflet-friendly [lat, lng][] from trail or GeoJSON LineString coordinates. */
export function toLatLngPath(points = []) {
  return (points || [])
    .map((p) => {
      if (Array.isArray(p) && p.length >= 2) {
        // GeoJSON / OSRM: [lon, lat]
        const lon = Number(p[0]);
        const lat = Number(p[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return [lat, lon];
      }
      const lat = Number(p.latitude ?? p.lat);
      const lng = Number(p.longitude ?? p.lon ?? p.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lat, lng];
    })
    .filter(Boolean);
}

/**
 * Compare planned road km (from OSRM) with realized trail km.
 * Both may be null when data is missing — never invent a number.
 */
export function replayKpis({ plannedDistanceM = null, actualDistanceM = null, stops = [] } = {}) {
  const planned_km = plannedDistanceM != null ? Math.round((plannedDistanceM / 1000) * 10) / 10 : null;
  const actual_km = actualDistanceM != null ? Math.round((actualDistanceM / 1000) * 10) / 10 : null;
  const delta_km = planned_km != null && actual_km != null
    ? Math.round((actual_km - planned_km) * 10) / 10
    : null;

  const countable = (stops || []).filter(
    (s) => s && !['depot_start', 'depot_end', 'pauza', 'repaus'].includes(s.kind)
  );
  const done = countable.filter((s) => ['finalizat', 'esuat', 'sarit'].includes(s.status)).length;

  return {
    planned_km,
    actual_km,
    delta_km,
    stops_done: done,
    stops_total: countable.length,
  };
}

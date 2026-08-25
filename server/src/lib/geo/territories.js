/**
 * Territory generation — capacitated geographic clustering + convex-hull polygons.
 * Pure: no DB. Drive time is approximated by haversine km (OSRM optional later).
 */

const EPS = 1e-9;

export function haversineKm(a, b) {
  if (!a || !b) return null;
  const lat1 = Number(a.latitude ?? a.lat);
  const lon1 = Number(a.longitude ?? a.lon ?? a.lng);
  const lat2 = Number(b.latitude ?? b.lat);
  const lon2 = Number(b.longitude ?? b.lon ?? b.lng);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Weight for balancing: volume, then kg, then stop-count proxy, never zero. */
export function locationWeight(loc = {}) {
  const vol = Number(loc.volume_mc) || 0;
  const kg = Number(loc.weight_kg) || 0;
  const stops = Number(loc.stop_count) || 0;
  const w = vol * 10 + kg / 100 + stops;
  return w > 0 ? w : 1;
}

function centroid(points) {
  if (!points.length) return { latitude: 0, longitude: 0 };
  let lat = 0;
  let lon = 0;
  for (const p of points) {
    lat += Number(p.latitude);
    lon += Number(p.longitude);
  }
  return { latitude: lat / points.length, longitude: lon / points.length };
}

/** k-means++ seed selection. */
function seedCentroids(points, k, random = Math.random) {
  const seeds = [];
  seeds.push(points[Math.floor(random() * points.length)]);
  while (seeds.length < k) {
    const dists = points.map((p) => {
      let best = Infinity;
      for (const s of seeds) {
        const d = haversineKm(p, s);
        if (d != null && d < best) best = d;
      }
      return best === Infinity ? 0 : best ** 2;
    });
    const sum = dists.reduce((a, b) => a + b, 0) || 1;
    let r = random() * sum;
    let pick = points[points.length - 1];
    for (let i = 0; i < points.length; i += 1) {
      r -= dists[i];
      if (r <= 0) {
        pick = points[i];
        break;
      }
    }
    seeds.push(pick);
  }
  return seeds.map((s) => ({ latitude: Number(s.latitude), longitude: Number(s.longitude) }));
}

/**
 * Capacitated k-means: assign each point to nearest under-capacity cluster when possible.
 * @param {object[]} locations — need id, latitude, longitude; optional weight fields
 * @param {{ k?: number, iterations?: number, seed?: number }} opts
 */
export function clusterLocations(locations = [], { k = 5, iterations = 25, random = Math.random } = {}) {
  const points = locations
    .filter((l) => Number.isFinite(Number(l.latitude)) && Number.isFinite(Number(l.longitude)))
    .map((l) => ({
      ...l,
      latitude: Number(l.latitude),
      longitude: Number(l.longitude),
      weight: locationWeight(l),
    }));

  const n = points.length;
  if (!n) return { clusters: [], k: 0 };
  const kk = Math.max(1, Math.min(Math.floor(k) || 1, n));

  const rnd = typeof random === 'function' ? random : Math.random;
  let centers = seedCentroids(points, kk, rnd);

  const totalWeight = points.reduce((s, p) => s + p.weight, 0);
  const capacity = totalWeight / kk;
  let assignment = new Array(n).fill(0);

  for (let iter = 0; iter < iterations; iter += 1) {
    const loads = new Array(kk).fill(0);
    const next = new Array(n).fill(0);

    // Farthest / heaviest first so capacity bites on the big ones.
    const order = [...points.keys()].sort((a, b) => points[b].weight - points[a].weight);

    for (const idx of order) {
      const p = points[idx];
      let best = 0;
      let bestScore = Infinity;
      for (let c = 0; c < kk; c += 1) {
        const dist = haversineKm(p, centers[c]) ?? 1e9;
        const over = Math.max(0, loads[c] + p.weight - capacity);
        const score = dist + over * 5; // soft capacity penalty
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
      next[idx] = best;
      loads[best] += p.weight;
    }

    assignment = next;

    const groups = Array.from({ length: kk }, () => []);
    for (let i = 0; i < n; i += 1) groups[assignment[i]].push(points[i]);
    let moved = false;
    for (let c = 0; c < kk; c += 1) {
      if (!groups[c].length) continue;
      const cen = centroid(groups[c]);
      if (
        Math.abs(cen.latitude - centers[c].latitude) > 1e-5
        || Math.abs(cen.longitude - centers[c].longitude) > 1e-5
      ) {
        moved = true;
      }
      centers[c] = cen;
    }
    if (!moved && iter > 3) break;
  }

  const clusters = Array.from({ length: kk }, (_, i) => {
    const members = points.filter((_, idx) => assignment[idx] === i);
    return {
      index: i,
      center: centers[i],
      location_ids: members.map((m) => m.id),
      locations: members,
      weight: members.reduce((s, m) => s + m.weight, 0),
      stop_count: members.length,
      weight_kg: members.reduce((s, m) => s + (Number(m.weight_kg) || 0), 0),
      volume_mc: members.reduce((s, m) => s + (Number(m.volume_mc) || 0), 0),
    };
  }).filter((c) => c.location_ids.length > 0);

  return { clusters, k: clusters.length, capacity, total_weight: totalWeight };
}

/** Cross product for turn direction (lon/lat as x/y). */
function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Andrew's monotone chain. Input [{latitude, longitude}], output GeoJSON ring [lon, lat][]
 * closed (first === last).
 */
export function convexHull(points = []) {
  const pts = points
    .map((p) => [Number(p.longitude ?? p.lon ?? p.lng), Number(p.latitude ?? p.lat)])
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  // Dedupe
  const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const uniq = [];
  const seen = new Set();
  for (const p of pts) {
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
  }
  if (uniq.length === 0) return null;
  if (uniq.length === 1) {
    const [lon, lat] = uniq[0];
    // Tiny diamond so Leaflet still draws something.
    const d = 0.01;
    return [[lon, lat + d], [lon + d, lat], [lon, lat - d], [lon - d, lat], [lon, lat + d]];
  }
  if (uniq.length === 2) {
    const [a, b] = uniq;
    return [a, b, a];
  }

  uniq.sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));

  const lower = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = uniq.length - 1; i >= 0; i -= 1) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  const ring = lower.concat(upper);
  if (ring.length < 3) return [...ring, ring[0]];
  return [...ring, ring[0]];
}

/** Pad a closed ring outward from its centroid (degrees ≈ km/111). */
export function padRing(ring, padKm = 2) {
  if (!ring || ring.length < 4) return ring;
  const padDeg = padKm / 111;
  const n = ring.length - 1;
  let lon = 0;
  let lat = 0;
  for (let i = 0; i < n; i += 1) {
    lon += ring[i][0];
    lat += ring[i][1];
  }
  lon /= n;
  lat /= n;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const [x, y] = ring[i];
    const dx = x - lon;
    const dy = y - lat;
    const len = Math.hypot(dx, dy) || 1;
    out.push([x + (dx / len) * padDeg, y + (dy / len) * padDeg]);
  }
  out.push([...out[0]]);
  return out;
}

export function hullToGeoJson(points, { padKm = 2, name } = {}) {
  let ring = convexHull(points);
  if (!ring) return null;
  if (padKm > 0) ring = padRing(ring, padKm);
  return {
    type: 'Feature',
    properties: name ? { name } : {},
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
  };
}

const PALETTE = [
  '#1D4E89', '#27AE60', '#E67E22', '#8E44AD', '#16A085',
  '#C0392B', '#2980B9', '#F39C12', '#2C3E50', '#D35400',
];

export function territoryColor(index) {
  return PALETTE[index % PALETTE.length];
}

/**
 * Balance table vs mean load. deviation_pct is max |load - mean| / mean * 100.
 */
export function balanceReport(clusters = []) {
  if (!clusters.length) {
    return { rows: [], mean_weight: 0, max_deviation_pct: 0, balanced: true };
  }
  const mean = clusters.reduce((s, c) => s + c.weight, 0) / clusters.length;
  const rows = clusters.map((c, i) => {
    const deviation_pct = mean > EPS
      ? Math.round((Math.abs(c.weight - mean) / mean) * 1000) / 10
      : 0;
    return {
      index: c.index ?? i,
      name: c.name || `T${(c.index ?? i) + 1}`,
      color: c.color || territoryColor(i),
      stop_count: c.stop_count ?? c.location_ids?.length ?? 0,
      weight: Math.round(c.weight * 10) / 10,
      weight_kg: Math.round((c.weight_kg || 0) * 10) / 10,
      volume_mc: Math.round((c.volume_mc || 0) * 100) / 100,
      // Rough hours: 15 min / stop + 2 min / km of radius-ish — keep simple.
      hours_est: Math.round(((c.stop_count || 0) * 0.35 + (c.weight || 0) * 0.05) * 10) / 10,
      deviation_pct,
    };
  });
  const max_deviation_pct = Math.max(0, ...rows.map((r) => r.deviation_pct));
  return {
    rows,
    mean_weight: Math.round(mean * 10) / 10,
    max_deviation_pct,
    balanced: max_deviation_pct <= 15,
  };
}

/**
 * Build draft territories ready to persist.
 */
export function buildTerritoryDrafts(locations, { k = 5, random } = {}) {
  const { clusters, capacity, total_weight } = clusterLocations(locations, { k, random });
  const drafts = clusters.map((c, i) => {
    const polygon = hullToGeoJson(c.locations, {
      padKm: 2,
      name: `Teritoriu ${i + 1}`,
    });
    return {
      name: `Teritoriu ${i + 1}`,
      color: territoryColor(i),
      polygon,
      sort_order: i,
      location_ids: c.location_ids,
      weight: c.weight,
      stop_count: c.stop_count,
      weight_kg: c.weight_kg,
      volume_mc: c.volume_mc,
    };
  });
  const balance = balanceReport(drafts.map((d, i) => ({ ...d, index: i })));
  return { drafts, balance, capacity, total_weight };
}

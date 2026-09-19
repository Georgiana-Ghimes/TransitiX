/**
 * Geometry helpers for the zone map and for importing a zone outline into `tax_zones.polygon`.
 *
 * `tax_zones.polygon` stores a bare GeoJSON **geometry** (`{ type, coordinates }`), not a
 * Feature, that is what `pointInPolygon` in `server/src/lib/pricing/taxes.js` reads, and the
 * map has to draw exactly what the invoice measures. `territories.polygon` is a Feature, so
 * the two are not interchangeable and the helpers here deliberately do not accept one.
 *
 * GeoJSON is lon/lat; Leaflet is lat/lon. Every conversion to screen coordinates goes through
 * `geometryToRings` so the swap happens in one place.
 *
 * Coordinates are read with `toFiniteNumber`, never `Number()`: `Number(null)` is 0 and passes
 * `Number.isFinite`, so a missing ordinate would not be dropped, it would be silently pulled
 * onto the equator and stitched into the outline as a real vertex.
 */
import { toFiniteNumber } from './utils.js';

const MAX_RINGS = 500;

/** A position is usable only when BOTH ordinates are genuinely present. */
function toPair(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const a = toFiniteNumber(pair[0]);
  const b = toFiniteNumber(pair[1]);
  return a == null || b == null ? null : [a, b];
}

/**
 * Every ring of a Polygon or MultiPolygon as Leaflet `[lat, lon]` arrays.
 *
 * Holes come back as their own rings: Leaflet's `<Polygon positions={[outer, ...holes]}>` wants
 * them nested, and a caller that only wants the outline can take the first ring of each polygon.
 */
export function geometryToRings(geometry) {
  const type = geometry?.type;
  const coords = geometry?.coordinates;
  if (!Array.isArray(coords)) return [];

  const ringsOf = (polygon) => {
    if (!Array.isArray(polygon)) return [];
    return polygon
      .filter(Array.isArray)
      .map((ring) => ring.map(toPair).filter(Boolean).map(([lon, lat]) => [lat, lon]))
      .filter((ring) => ring.length >= 3);
  };

  if (type === 'Polygon') return ringsOf(coords).slice(0, MAX_RINGS);
  if (type === 'MultiPolygon') {
    return coords.flatMap(ringsOf).slice(0, MAX_RINGS);
  }
  return [];
}

/** Leaflet-shaped bounds `[[south, west], [north, east]]`, or null when there is nothing to fit. */
export function geometryBounds(geometry) {
  const points = geometryToRings(geometry).flat();
  if (!points.length) return null;
  let south = Infinity; let west = Infinity; let north = -Infinity; let east = -Infinity;
  for (const [lat, lon] of points) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  return [[south, west], [north, east]];
}

/** Bounds covering several zones at once, what the map fits on load. */
export function combinedBounds(geometries = []) {
  const boxes = geometries.map(geometryBounds).filter(Boolean);
  if (!boxes.length) return null;
  return boxes.reduce((acc, [[s, w], [n, e]]) => [
    [Math.min(acc[0][0], s), Math.min(acc[0][1], w)],
    [Math.max(acc[1][0], n), Math.max(acc[1][1], e)],
  ]);
}

/**
 * Whether a point falls inside a drawn outline.
 *
 * This answers a display question, which shape on screen contains this pin, and never what
 * an address costs. Pricing is resolved by `resolveZone` on the server, against `tax_zones`,
 * and that stays the only authority: the two are asked different questions on purpose, so a
 * zone drawn on the map but not yet linked to pricing can be reported as exactly that instead
 * of the screen showing a pin inside a polygon and claiming it is in no zone.
 *
 * Ray casting on the half-open interval, so a vertex shared by two edges is counted once.
 */
function pointInRing([lat, lon], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [latI, lonI] = ring[i];
    const [latJ, lonJ] = ring[j];
    if ((latI > lat) !== (latJ > lat)) {
      const x = ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI;
      if (lon < x) inside = !inside;
    }
  }
  return inside;
}

export function pointInGeometry(point, geometry) {
  if (!Array.isArray(point) || point.length < 2) return false;
  const lat = toFiniteNumber(point[0]);
  const lon = toFiniteNumber(point[1]);
  if (lat == null || lon == null) return false;

  const polygons = geometry?.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];

  return polygons.some((polygonCoords) => {
    const rings = (polygonCoords || [])
      .map((ring) => (ring || []).map(toPair).filter(Boolean).map(([lo, la]) => [la, lo]))
      .filter((ring) => ring.length >= 3);
    if (!rings.length || !pointInRing([lat, lon], rings[0])) return false;
    // A hit inside a hole puts the point back outside.
    return !rings.slice(1).some((hole) => pointInRing([lat, lon], hole));
  });
}

/** Whether one geometry's extent sits entirely inside another's. */
export function boundsContain(outer, inner) {
  const o = geometryBounds(outer);
  const i = geometryBounds(inner);
  if (!o || !i) return false;
  return i[0][0] >= o[0][0] && i[0][1] >= o[0][1]
    && i[1][0] <= o[1][0] && i[1][1] <= o[1][1];
}

/**
 * Rings for drawing a zone with the zones nested inside it punched out.
 *
 * Display only. The stored outline stays the one the decision defines, Zone B's perimeter
 * genuinely encloses Zone A, and `resolveZone` already picks A inside it on priority. Cutting
 * A out of B's stored polygon would make the data disagree with the official delimitation and
 * would have to be redone every time either outline is corrected.
 *
 * Filling B over A instead paints the inner zone twice, so the strictest zone on the map is the
 * one whose colour is hardest to read. Leaflet treats every ring after the first as a hole,
 * which is all this has to produce.
 */
export function ringsWithCutouts(geometry, cutouts = []) {
  const own = geometryToRings(geometry);
  if (!own.length) return [];
  const holes = cutouts
    .filter((c) => boundsContain(geometry, c))
    .flatMap((c) => geometryToRings(c).slice(0, 1));
  return [...own, ...holes];
}

/** A rough count for the UI: "Zona A · 1 contur, 412 puncte". */
export function geometrySummary(geometry) {
  const rings = geometryToRings(geometry);
  return { rings: rings.length, points: rings.reduce((n, r) => n + r.length, 0) };
}

// ------------------------------------------------------------------ importing

function closeRing(ring) {
  if (ring.length < 3) return null;
  const [firstLon, firstLat] = ring[0];
  const [lastLon, lastLat] = ring[ring.length - 1];
  if (firstLon === lastLon && firstLat === lastLat) return ring;
  return [...ring, ring[0]];
}

/**
 * KML `<coordinates>` bodies are whitespace-separated `lon,lat[,alt]` tuples. Altitude is
 * dropped: a zone boundary is a flat outline, and keeping a third ordinate would make the
 * stored geometry fail `pointInPolygon`, which reads `[lon, lat]` positionally.
 */
export function parseKmlCoordinates(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .map((tuple) => {
      const parts = tuple.split(',');
      if (parts.length < 2) return null;
      const lon = Number(parts[0]);
      const lat = Number(parts[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return [lon, lat];
    })
    .filter(Boolean);
}

/** Bodies of every `<tag>…</tag>` in source order, namespace prefixes tolerated. */
function tagBodies(xml, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}\\s*>`, 'gi');
  const out = [];
  let m = re.exec(xml);
  while (m) {
    out.push(m[1]);
    m = re.exec(xml);
  }
  return out;
}

/**
 * Polygons out of a KML document.
 *
 * This reads the subset an administrative zone export actually uses, `<Polygon>` with an
 * `<outerBoundaryIs>` and optional `<innerBoundaryIs>` holes, including the ones nested in a
 * `<MultiGeometry>`. Anything else (LineString, Point, overlays) is ignored rather than
 * guessed at: a boundary read wrongly is a zone charged wrongly, and silence there would
 * reach a customer's invoice before anyone noticed.
 */
export function parseKmlPolygons(xml) {
  const source = String(xml || '');
  return tagBodies(source, 'Polygon').map((body) => {
    const outer = tagBodies(body, 'outerBoundaryIs')
      .flatMap((b) => tagBodies(b, 'coordinates'))
      .map(parseKmlCoordinates)
      .map(closeRing)
      .filter(Boolean)[0];
    if (!outer) return null;
    const holes = tagBodies(body, 'innerBoundaryIs')
      .flatMap((b) => tagBodies(b, 'coordinates'))
      .map(parseKmlCoordinates)
      .map(closeRing)
      .filter(Boolean);
    return [outer, ...holes];
  }).filter(Boolean);
}

/** The text of the first `<name>` directly in a fragment, trimmed. */
function tagText(xml, tag) {
  const body = tagBodies(xml, tag)[0];
  if (body == null) return null;
  const text = String(body).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  return text || null;
}

function polygonsToGeometry(polygons) {
  if (!polygons.length) return null;
  if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
  return { type: 'MultiPolygon', coordinates: polygons };
}

/** Pulls every polygon out of any GeoJSON container, geometry, Feature or FeatureCollection. */
function geoJsonPolygons(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return [];
  if (node.type === 'FeatureCollection') {
    return (node.features || []).flatMap((f) => geoJsonPolygons(f, depth + 1));
  }
  if (node.type === 'Feature') return geoJsonPolygons(node.geometry, depth + 1);
  if (node.type === 'GeometryCollection') {
    return (node.geometries || []).flatMap((g) => geoJsonPolygons(g, depth + 1));
  }
  if (node.type === 'Polygon' && Array.isArray(node.coordinates)) return [node.coordinates];
  if (node.type === 'MultiPolygon' && Array.isArray(node.coordinates)) return node.coordinates;
  return [];
}

// A ring thinner than roughly 1:30 that also encloses less than a hectare. Both conditions
// have to hold: a genuinely long thin exclusion is still large, and a genuinely small one is
// still roughly compact. Only a digitising artefact is both.
const SLIVER_COMPACTNESS = 0.1;
const SLIVER_AREA_M2 = 10_000;

/**
 * Area, perimeter and compactness of a ring, in metres.
 *
 * Equirectangular around the ring's own latitude, accurate enough over a city, and this is
 * used to tell a shape from a scribble, never to report a figure to anyone.
 */
export function ringMetrics(ring = []) {
  if (!Array.isArray(ring) || ring.length < 4) return { area: 0, perimeter: 0, compactness: 0 };
  const meanLat = ring.reduce((sum, [, lat]) => sum + Number(lat || 0), 0) / ring.length;
  const mx = 111_320 * Math.cos((meanLat * Math.PI) / 180);
  const my = 110_540;

  let twiceArea = 0;
  let perimeter = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const x1 = ring[i][0] * mx; const y1 = ring[i][1] * my;
    const x2 = ring[i + 1][0] * mx; const y2 = ring[i + 1][1] * my;
    twiceArea += x1 * y2 - x2 * y1;
    perimeter += Math.hypot(x2 - x1, y2 - y1);
  }
  const area = Math.abs(twiceArea / 2);
  return {
    area,
    perimeter,
    compactness: perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0,
  };
}

function isSliver(ring) {
  const { area, compactness } = ringMetrics(ring);
  return compactness < SLIVER_COMPACTNESS && area < SLIVER_AREA_M2;
}

/**
 * Removes inner rings that enclose nothing.
 *
 * Editors like Google My Maps resolve a self-intersection by emitting a hole that doubles back
 * along its own path, hundreds of metres of perimeter around a few hundred square metres. They
 * are not exclusions, and carrying them forward would put "4 excluderi" on a screen where an
 * operator has to decide whether a boundary is right. Only inner rings are considered: a
 * degenerate outer ring is a broken file, not something to quietly tidy away.
 */
export function dropSliverHoles(geometry) {
  const polygons = geometry?.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
  if (!polygons) return { geometry, dropped: 0 };

  let dropped = 0;
  const cleaned = polygons.map((rings) => {
    if (!Array.isArray(rings) || !rings.length) return rings;
    const [outer, ...holes] = rings;
    const kept = holes.filter((hole) => {
      if (!isSliver(hole)) return true;
      dropped += 1;
      return false;
    });
    return [outer, ...kept];
  });

  if (!dropped) return { geometry, dropped: 0 };
  return {
    geometry: geometry.type === 'Polygon'
      ? { type: 'Polygon', coordinates: cleaned[0] }
      : { type: 'MultiPolygon', coordinates: cleaned },
    dropped,
  };
}

// A vertex the path leaves and returns along almost the same line. Both legs have to be long
// enough to matter on the ground, a tight angle between two short segments is just detail.
const SPIKE_ANGLE_DEG = 20;
const SPIKE_MIN_LEG_M = 50;

/**
 * Needle vertices: places where a boundary shoots out and comes straight back.
 *
 * These are digitising slips, and on an outer ring they are never corrected automatically,
 * silently reshaping a zone boundary is how an address starts being charged differently with
 * nobody able to say when it changed. They are reported so a person can look and decide.
 */
export function findSpikeVertices(ring = []) {
  if (!Array.isArray(ring) || ring.length < 4) return [];
  const meanLat = ring.reduce((sum, [, lat]) => sum + Number(lat || 0), 0) / ring.length;
  const mx = 111_320 * Math.cos((meanLat * Math.PI) / 180);
  const my = 110_540;
  const projected = ring.map(([lon, lat]) => [lon * mx, lat * my]);

  const spikes = [];
  for (let i = 1; i < projected.length - 1; i += 1) {
    const ax = projected[i - 1][0] - projected[i][0];
    const ay = projected[i - 1][1] - projected[i][1];
    const bx = projected[i + 1][0] - projected[i][0];
    const by = projected[i + 1][1] - projected[i][1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < SPIKE_MIN_LEG_M || lb < SPIKE_MIN_LEG_M) continue;
    const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
    const angle = (Math.acos(cos) * 180) / Math.PI;
    if (angle < SPIKE_ANGLE_DEG) {
      spikes.push({ index: i, position: ring[i], angle, legs: [la, lb] });
    }
  }
  return spikes;
}

/** Every needle vertex across all rings of a geometry. */
export function findGeometrySpikes(geometry) {
  const polygons = geometry?.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.flatMap((rings) => (rings || []).flatMap((ring) => findSpikeVertices(ring)));
}

export class ZoneImportError extends Error {}

/**
 * Named outlines out of a KML, one per `<Placemark>`.
 *
 * Per-placemark matters for the real files: a My Maps export of the Bucharest zones carries
 * Zone A and Zone B as two placemarks in one document. Merging them, which is what reading
 * the document as a flat list of polygons does, would give whichever zone was being imported
 * the union of both, so every address in the outer ring would resolve to the inner zone's
 * stricter tariff. The caller picks which outline goes where; nothing here guesses from a name.
 */
export function parseKmlOutlines(xml) {
  const source = String(xml || '');
  const placemarks = tagBodies(source, 'Placemark');

  if (placemarks.length) {
    const named = placemarks.map((body) => {
      const polygons = parseKmlPolygons(body);
      if (!polygons.length) return null;
      return { name: tagText(body, 'name'), geometry: polygonsToGeometry(polygons) };
    }).filter(Boolean);
    if (named.length) return named;
  }

  // A document that draws polygons outside any placemark is unusual but valid.
  const loose = parseKmlPolygons(source);
  return loose.length ? [{ name: null, geometry: polygonsToGeometry(loose) }] : [];
}

/** Named outlines out of GeoJSON, one per Feature, so a collection is not silently merged. */
export function parseGeoJsonOutlines(node) {
  if (node?.type === 'FeatureCollection' && Array.isArray(node.features)) {
    const named = node.features.map((f) => {
      const polygons = geoJsonPolygons(f);
      if (!polygons.length) return null;
      const props = f?.properties || {};
      return {
        name: props.name ?? props.Name ?? props.title ?? null,
        geometry: polygonsToGeometry(polygons),
      };
    }).filter(Boolean);
    if (named.length) return named;
  }
  const polygons = geoJsonPolygons(node);
  return polygons.length ? [{ name: null, geometry: polygonsToGeometry(polygons) }] : [];
}

/**
 * Every named outline in an uploaded file, ready for `tax_zones.polygon`.
 *
 * Returns a list rather than one geometry because one file routinely describes several zones,
 * and only the operator knows which outline belongs to which zone code. Matching a placemark
 * name to a zone here would be a guess, and the guess that files Zone B's ring under Zone A
 * produces an invoice nobody can explain.
 */
export function parseZoneOutlines(text, filename = '') {
  const raw = String(text || '').trim();
  if (!raw) throw new ZoneImportError('Fișierul este gol.');

  const looksKml = /\.km[lz]$/i.test(filename) || /^<|<kml\b/i.test(raw);
  let outlines;

  if (looksKml) {
    if (/\.kmz$/i.test(filename)) {
      throw new ZoneImportError('KMZ este o arhivă, dezarhiveaz-o și încarcă fișierul .kml din ea.');
    }
    outlines = parseKmlOutlines(raw);
    if (!outlines.length) {
      // A NetworkLink KML holds no geometry at all, only a pointer. Saying "no polygons" would
      // send someone looking for a broken export when the file is doing exactly what it should.
      const href = tagText(raw, 'href');
      if (href) {
        throw new ZoneImportError(
          `Acest KML nu conține contururi, e doar un link către ${href} . `
          + 'Deschide adresa, descarcă fișierul KML de acolo și încarcă-l pe acela.',
        );
      }
      throw new ZoneImportError('Niciun <Polygon> în KML. Contururile de zonă trebuie să fie poligoane, nu linii sau puncte.');
    }
  } else {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ZoneImportError('Fișierul nu este nici GeoJSON valid, nici KML.');
    }
    outlines = parseGeoJsonOutlines(parsed);
    if (!outlines.length) {
      throw new ZoneImportError('Niciun poligon în GeoJSON. Sunt acceptate Polygon, MultiPolygon, Feature și FeatureCollection.');
    }
  }

  const usable = outlines
    .filter((o) => geometryToRings(o.geometry).length > 0)
    .map((o) => {
      const { geometry, dropped } = dropSliverHoles(o.geometry);
      return { ...o, geometry, droppedSlivers: dropped, spikes: findGeometrySpikes(geometry) };
    });
  if (!usable.length) {
    throw new ZoneImportError('Contururile din fișier au prea puține puncte pentru a delimita o zonă.');
  }
  return usable;
}

/**
 * Guards against the single most likely import mistake: a file in lat/lon order, or in a
 * projected CRS. Both parse cleanly and both put the zone somewhere it is not.
 */
export function looksLikePlausibleOutline(geometry) {
  const points = geometryToRings(geometry).flat();
  if (!points.length) return false;
  return points.every(([lat, lon]) => lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180);
}

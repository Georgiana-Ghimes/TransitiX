/**
 * Geographic tax engine.
 *
 * Address -> coordinates -> zone -> charge. The charge is driven by the vehicle's MMA from
 * the registration document, never by how much cargo happens to be aboard: a 10t-class truck
 * with an MMA of 19t is taxed at 19t whether it runs full or empty.
 *
 * Zones match two ways. A polygon is authoritative when the point is geocoded; a textual
 * matcher (county code, city names) works before anyone has drawn a polygon, which is what
 * makes the engine usable on day one.
 */

import { isValidOn, num, pickValid } from './tariffs.js';

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Ray casting against a GeoJSON ring. Coordinates are [lon, lat] as GeoJSON stores them.
 * A point exactly on an edge counts as inside — a delivery on the zone boundary is charged.
 */
export function pointInRing(point, ring) {
  const { latitude, longitude } = point;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Array.isArray(ring)) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] || [];
    const [xj, yj] = ring[j] || [];
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersects = (yi > latitude) !== (yj > latitude)
      && longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Handles Polygon and MultiPolygon; holes are subtracted. */
export function pointInPolygon(point, geometry) {
  if (!geometry) return false;
  const type = geometry.type;
  const coords = geometry.coordinates;
  if (!Array.isArray(coords)) return false;

  const inOnePolygon = (polygon) => {
    if (!Array.isArray(polygon) || !polygon.length) return false;
    if (!pointInRing(point, polygon[0])) return false;
    // Any hit inside a hole puts the point back outside.
    return !polygon.slice(1).some((hole) => pointInRing(point, hole));
  };

  if (type === 'Polygon') return inOnePolygon(coords);
  if (type === 'MultiPolygon') return coords.some(inOnePolygon);
  return false;
}

/**
 * Textual fallback: county codes and city names carried on the zone.
 * `{ counties: ['B','IF'], cities: ['bucuresti'], postcodes: ['0106'] }`
 */
export function matchesTextually(zone, place) {
  const matcher = zone?.matcher || {};
  const counties = (matcher.counties || []).map((c) => String(c).toUpperCase());
  const cities = (matcher.cities || []).map(norm);
  const postcodes = (matcher.postcodes || []).map((c) => String(c).trim());

  if (counties.length && place?.county && counties.includes(String(place.county).toUpperCase())) return true;
  if (cities.length && place?.city && cities.includes(norm(place.city))) return true;
  if (postcodes.length && place?.postcode) {
    const code = String(place.postcode).trim();
    if (postcodes.some((prefix) => code.startsWith(prefix))) return true;
  }
  return false;
}

/**
 * The zone a place falls in.
 *
 * Polygons win over text, and a higher `priority` wins over a lower one — that is how a
 * small inner zone beats the county-wide zone containing it.
 */
export function resolveZone(zones = [], place) {
  if (!place) return null;
  const active = zones.filter((z) => z.is_active !== false);
  const byPriority = [...active].sort((a, b) => num(b.priority) - num(a.priority));

  const hasPoint = Number.isFinite(Number(place.latitude)) && Number.isFinite(Number(place.longitude));
  if (hasPoint) {
    const point = { latitude: Number(place.latitude), longitude: Number(place.longitude) };
    const hit = byPriority.find((zone) => zone.polygon && pointInPolygon(point, zone.polygon));
    if (hit) return hit;
  }

  return byPriority.find((zone) => matchesTextually(zone, place)) ?? null;
}

/** The rate bracket covering an MMA, valid on a date. */
export function findZoneRate(rates = [], { mmaKg, onDate }) {
  const mma = num(mmaKg, null);
  const inBracket = rates.filter((rate) => {
    if (!isValidOn(rate, onDate)) return false;
    if (mma == null) return false;
    const min = num(rate.mma_min_kg, 0);
    const max = rate.mma_max_kg == null ? Infinity : num(rate.mma_max_kg, Infinity);
    return mma >= min && mma <= max;
  });
  // Narrowest bracket wins, so a specific 12–19t band beats a catch-all 0–∞ one.
  return inBracket.sort((a, b) => {
    const spanA = (a.mma_max_kg == null ? Infinity : num(a.mma_max_kg)) - num(a.mma_min_kg);
    const spanB = (b.mma_max_kg == null ? Infinity : num(b.mma_max_kg)) - num(b.mma_min_kg);
    return spanA - spanB;
  })[0] ?? null;
}

/**
 * Zone charges for a set of places, one per distinct zone.
 * The same zone entered twice on one trip is charged once — it is an entry fee, not a toll.
 */
export function zoneCharges(zones, ratesByZoneId, places = [], { mmaKg, onDate }) {
  const charges = [];
  const seen = new Set();

  for (const place of places) {
    const zone = resolveZone(zones, place);
    if (!zone || seen.has(zone.id)) continue;
    seen.add(zone.id);

    const rate = findZoneRate(ratesByZoneId.get(zone.id) ?? [], { mmaKg, onDate });
    if (!rate) {
      charges.push({
        zone,
        amount: 0,
        currency: 'RON',
        missingRate: true,
        label: `Taxă zonă ${zone.code}`,
        detail: { zone_code: zone.code, mma_kg: num(mmaKg, null), reason: 'fara_tarif_valabil' },
      });
      continue;
    }

    charges.push({
      zone,
      amount: num(rate.amount),
      currency: rate.currency || 'RON',
      missingRate: false,
      label: `Taxă zonă ${zone.code}`,
      detail: {
        zone_code: zone.code,
        zone_name: zone.name,
        mma_kg: num(mmaKg, null),
        bracket: { min: num(rate.mma_min_kg, 0), max: rate.mma_max_kg == null ? null : num(rate.mma_max_kg) },
        place: place.label ?? place.city ?? null,
      },
    });
  }

  return charges;
}

/** Surcharge amount for a vehicle class on a date; a class-less rate is the catch-all. */
export function findSurchargeRate(rates = [], { vehicleClass, onDate }) {
  const cls = String(vehicleClass || '').trim().toLowerCase();
  const exact = pickValid(
    rates.filter((r) => String(r.vehicle_class || '').trim().toLowerCase() === cls && r.vehicle_class),
    onDate
  );
  if (exact) return exact;
  return pickValid(rates.filter((r) => !r.vehicle_class), onDate);
}

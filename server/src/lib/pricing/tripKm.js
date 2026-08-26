/**
 * Billable kilometres for a trip.
 *
 * The trip is not "loading to unloading". It is the whole round trip the truck actually
 * drives, and the customer pays for all of it:
 *
 *   depot -> loading -> unloading 1 -> unloading 2 -> ... -> depot
 *
 * Every leg is kept separately so a total can always be explained line by line, and so a
 * single unmeasurable leg does not silently disappear into a smaller total.
 */

import { num } from './tariffs.js';

/**
 * Ordered legs for a trip.
 * @param {{latitude?:number, longitude?:number, label?:string, locationId?:string}|null} depot
 * @param {object|null} loading
 * @param {Array} unloadings — one or more delivery points, in visiting order
 */
export function buildLegs(depot, loading, unloadings = []) {
  const stops = unloadings.filter(Boolean);
  const legs = [];
  let seq = 0;

  const push = (kind, from, to) => {
    if (!from || !to) return;
    seq += 1;
    legs.push({
      seq,
      kind,
      from_label: from.label ?? null,
      to_label: to.label ?? null,
      from_location_id: from.locationId ?? null,
      to_location_id: to.locationId ?? null,
      from,
      to,
    });
  };

  if (depot && loading) push('depot_to_loading', depot, loading);
  if (loading && stops[0]) push('loading_to_unloading', loading, stops[0]);
  for (let i = 0; i < stops.length - 1; i += 1) {
    push('between_unloading', stops[i], stops[i + 1]);
  }
  const last = stops[stops.length - 1];
  if (depot && last) push('unloading_to_depot', last, depot);

  return legs;
}

function hasCoordinates(point) {
  return Number.isFinite(Number(point?.latitude)) && Number.isFinite(Number(point?.longitude));
}

/**
 * Measures each leg with the supplied router.
 *
 * Best-effort per leg: a leg whose endpoints are not geocoded, or that the router cannot
 * answer, comes back with a null distance and is reported as incomplete rather than counted
 * as zero. Charging for a total that quietly dropped 40 km is worse than saying so.
 */
export async function measureLegs(legs, { route }) {
  const measured = [];
  for (const leg of legs) {
    if (!hasCoordinates(leg.from) || !hasCoordinates(leg.to)) {
      measured.push({ ...leg, distance_km: null, duration_min: null, source: 'estimate', reason: 'fara_coordonate' });
      continue;
    }
    try {
      const result = await route([
        { latitude: Number(leg.from.latitude), longitude: Number(leg.from.longitude) },
        { latitude: Number(leg.to.latitude), longitude: Number(leg.to.longitude) },
      ]);
      measured.push({
        ...leg,
        distance_km: Math.round(num(result.distance_km) * 100) / 100,
        duration_min: Math.round(num(result.duration_min)),
        source: 'osrm',
      });
    } catch (err) {
      measured.push({ ...leg, distance_km: null, duration_min: null, source: 'estimate', reason: err.message });
    }
  }
  return measured;
}

/** Totals over measured legs, with an explicit completeness flag. */
export function summariseLegs(legs = []) {
  let distance = 0;
  let duration = 0;
  let complete = true;

  for (const leg of legs) {
    if (leg.distance_km == null) { complete = false; continue; }
    distance += num(leg.distance_km);
    duration += num(leg.duration_min);
  }

  return {
    distance_km: Math.round(distance * 100) / 100,
    duration_min: Math.round(duration),
    complete,
    leg_count: legs.length,
    missing_legs: legs.filter((l) => l.distance_km == null).length,
  };
}

/** Human breakdown for the trip screen: "Garaj → Încărcare  35 km". */
export const LEG_LABELS = {
  depot_to_loading: 'Garaj → încărcare',
  loading_to_unloading: 'Încărcare → descărcare',
  between_unloading: 'Între descărcări',
  unloading_to_depot: 'Descărcare → garaj',
};

export function describeLeg(leg) {
  return {
    seq: leg.seq,
    kind: leg.kind,
    label: LEG_LABELS[leg.kind] ?? leg.kind,
    from: leg.from_label,
    to: leg.to_label,
    distance_km: leg.distance_km,
    duration_min: leg.duration_min,
    source: leg.source,
  };
}

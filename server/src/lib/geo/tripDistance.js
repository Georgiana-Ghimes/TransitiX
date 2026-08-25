/**
 * Automatic `trips.distance_km` from the road network.
 *
 * Two rules shape everything here:
 *
 *  1. A number a dispatcher typed is never overwritten. `distance_source` records who last
 *     set the value, and a `manual` distance is left alone forever after.
 *  2. Saving a CMR must never depend on OSRM being up. Coordinates are read from tables we
 *     already own (`locations`, `geocode_cache`) and the whole computation is best-effort —
 *     when anything is missing the trip saves with no distance, which is the honest result.
 */

import { addressKey } from './address.js';
import { osrmConfigured, osrmRoute } from './osrm.js';

export const DISTANCE_SOURCES = ['manual', 'osrm'];

function toNumber(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Who owns the distance after this save?
 *
 * The trip form always posts `distance_km`, including the auto-computed value it was shown,
 * so presence alone cannot mean "a human typed this". A value that still equals what we
 * computed is the form echoing us back; anything else is a deliberate edit.
 */
export function resolveDistanceSource({ incoming, stored, storedSource }) {
  const next = toNumber(incoming);
  const prev = toNumber(stored);

  if (next == null) {
    // Cleared: hand ownership back to the geocoder.
    return { distance_km: null, distance_source: null, autoEligible: true };
  }
  if (storedSource === 'osrm' && prev != null && Math.abs(next - prev) < 0.5) {
    // Unchanged auto value echoed by the form — stays ours, stays refreshable.
    return { distance_km: next, distance_source: 'osrm', autoEligible: true };
  }
  if (storedSource === 'manual' && prev != null && Math.abs(next - prev) < 0.001) {
    return { distance_km: next, distance_source: 'manual', autoEligible: false };
  }
  return { distance_km: next, distance_source: 'manual', autoEligible: false };
}

/** Only an empty or auto-owned distance may be recomputed. */
export function shouldAutoCompute(trip) {
  if (!trip) return false;
  if (trip.distance_source === 'manual') return false;
  return trip.distance_km == null || trip.distance_source === 'osrm';
}

/**
 * Coordinates for a free-text address, from local tables only.
 * Never calls a geocoding provider — this runs on the trip save path.
 */
export async function findCoordinates(db, companyId, address) {
  const key = addressKey(address);
  if (!key) return null;

  const fromLocations = await db.query(
    `SELECT latitude, longitude FROM locations
     WHERE company_id = $1 AND address_key = $2
       AND latitude IS NOT NULL AND longitude IS NOT NULL
     LIMIT 1`,
    [companyId, key]
  );
  if (fromLocations.rows[0]) {
    return {
      latitude: Number(fromLocations.rows[0].latitude),
      longitude: Number(fromLocations.rows[0].longitude),
      source: 'locations',
    };
  }

  const fromCache = await db.query(
    `SELECT latitude, longitude FROM geocode_cache
     WHERE company_id = $1 AND address_key = $2 AND status = 'hit'
       AND latitude IS NOT NULL AND longitude IS NOT NULL
     LIMIT 1`,
    [companyId, key]
  );
  if (fromCache.rows[0]) {
    return {
      latitude: Number(fromCache.rows[0].latitude),
      longitude: Number(fromCache.rows[0].longitude),
      source: 'geocode_cache',
    };
  }

  return null;
}

/**
 * Road distance between a trip's shipper and consignee.
 * Returns `{ ok: false, reason }` rather than throwing — the caller is a save handler.
 */
export async function computeTripDistance(db, companyId, trip, { route = osrmRoute } = {}) {
  if (!osrmConfigured()) return { ok: false, reason: 'osrm_neconfigurat' };
  if (!trip?.shipper_address || !trip?.consignee_address) {
    return { ok: false, reason: 'adrese_lipsa' };
  }

  const [from, to] = await Promise.all([
    findCoordinates(db, companyId, trip.shipper_address),
    findCoordinates(db, companyId, trip.consignee_address),
  ]);
  if (!from) return { ok: false, reason: 'expeditor_negeocodat' };
  if (!to) return { ok: false, reason: 'destinatar_negeocodat' };

  try {
    const result = await route([from, to]);
    return {
      ok: true,
      distance_km: Math.round(result.distance_km),
      duration_min: Math.round(result.duration_min),
      from,
      to,
    };
  } catch (err) {
    return { ok: false, reason: 'osrm_indisponibil', message: err.message };
  }
}

/**
 * Best-effort recompute after a trip is saved. Swallows every failure: a CMR that cannot be
 * measured is still a valid CMR, and a save must not fail because a map server is down.
 */
export async function refreshTripDistance(db, companyId, trip, options = {}) {
  if (!shouldAutoCompute(trip)) return { ok: false, reason: 'distanta_manuala' };
  try {
    const computed = await computeTripDistance(db, companyId, trip, options);
    if (!computed.ok) return computed;
    if (toNumber(trip.distance_km) === computed.distance_km) {
      return { ...computed, unchanged: true };
    }
    await db.query(
      `UPDATE trips SET distance_km = $1, distance_source = 'osrm', updated_at = NOW()
       WHERE id = $2 AND company_id = $3`,
      [computed.distance_km, trip.id, companyId]
    );
    return { ...computed, saved: true };
  } catch (err) {
    console.error('[trip distance]', err.message || err);
    return { ok: false, reason: 'eroare', message: err.message };
  }
}

export const DISTANCE_REASON_LABELS = {
  osrm_neconfigurat: 'OSRM nu este configurat',
  adrese_lipsa: 'Cursa nu are ambele adrese completate',
  expeditor_negeocodat: 'Adresa expeditorului nu are coordonate',
  destinatar_negeocodat: 'Adresa destinatarului nu are coordonate',
  osrm_indisponibil: 'OSRM nu a răspuns',
  distanta_manuala: 'Distanța a fost introdusă manual',
  eroare: 'Eroare la calcul',
};

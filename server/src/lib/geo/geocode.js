/**
 * Geocoding orchestration: cache → provider → score → decide.
 *
 * The decision is the important part. A result is only written to `locations` unattended when
 * it clears AUTO_ACCEPT_CONFIDENCE; everything else is stored but left unverified so a human
 * confirms the pin. `geocode_verified` is never set by this module — only by a person.
 */

import { addressKey, parseRomanianAddress } from './address.js';
import { AUTO_ACCEPT_CONFIDENCE, photonConfigured, photonSearch } from './photon.js';
import { tomtomConfigured, tomtomSearch } from './tomtom.js';

/** Escalate to the paid provider only when the free one is not confident enough to accept. */
export const ESCALATION_THRESHOLD = AUTO_ACCEPT_CONFIDENCE;

/**
 * Which providers are in play, as a single label.
 *
 * The cache is keyed by this, so it identifies a *strategy*, not a vendor: turning TomTom on
 * changes the label, which retires the photon-only cache entries and gives exactly the weak
 * addresses another attempt with the better provider. That is the behaviour you want, and it
 * costs nothing for the ones Photon already resolved well.
 */
export function activeGeocodeProvider() {
  const photon = photonConfigured();
  const tomtom = tomtomConfigured();
  if (photon && tomtom) return 'photon+tomtom';
  if (tomtom) return 'tomtom';
  return 'photon';
}

/**
 * Runs the free provider first and only pays for the second when the first is unsure.
 *
 * The fallback failing — bad key, quota gone, network — must never break geocoding: the
 * primary result stands, exactly as it would have without TomTom configured.
 */
export function escalatingSearch({
  primary = photonSearch,
  fallback = tomtomSearch,
  threshold = ESCALATION_THRESHOLD,
  onEscalate,
} = {}) {
  return async function search(address, options = {}) {
    let primaryResult = null;
    let primaryError = null;
    try {
      primaryResult = await primary(address, options);
    } catch (err) {
      primaryError = err;
    }

    const best = primaryResult?.best;
    if (best && best.confidence >= threshold) return primaryResult;

    let fallbackResult = null;
    try {
      if (onEscalate) onEscalate({ address, primaryConfidence: best?.confidence ?? null });
      fallbackResult = await fallback(address, options);
    } catch {
      // Paid provider unavailable — fall back to whatever the free one managed.
      if (primaryResult) return primaryResult;
      throw primaryError || new Error('Geocodarea a eșuat la ambii furnizori');
    }

    if (!primaryResult) return fallbackResult;

    // Keep both providers' suggestions so the review screen can show the alternatives.
    const merged = [...(fallbackResult.candidates || []), ...(primaryResult.candidates || [])]
      .sort((a, b) => b.confidence - a.confidence);
    const winner = merged[0] || null;
    return {
      ...primaryResult,
      candidates: merged,
      best: winner,
      autoAcceptable: Boolean(winner && winner.confidence >= threshold),
      escalated: true,
    };
  };
}

/** Default strategy: escalate when TomTom is configured, plain Photon otherwise. */
export function defaultSearch() {
  return tomtomConfigured() && photonConfigured()
    ? escalatingSearch()
    : (tomtomConfigured() ? tomtomSearch : photonSearch);
}

export const GEOCODE_PROVIDER = 'photon';

/**
 * What to do with a geocoding result.
 *   accept  — confident enough to write coordinates unattended
 *   review  — coordinates written, but flagged for a human to confirm on the map
 *   reject  — nothing usable came back; the location stays without coordinates
 */
export function decideOutcome(best, { autoAccept = AUTO_ACCEPT_CONFIDENCE } = {}) {
  if (!best) return { action: 'reject', reason: 'niciun_rezultat' };
  if (best.confidence >= autoAccept) return { action: 'accept', reason: 'incredere_ridicata' };
  if (best.confidence >= 0.45) return { action: 'review', reason: 'incredere_medie' };
  return { action: 'reject', reason: 'incredere_scazuta' };
}

/** Cache row → the same shape a fresh provider call produces. */
export function fromCacheRow(row) {
  if (!row) return null;
  return {
    cached: true,
    status: row.status,
    best: row.status === 'hit' && row.latitude != null
      ? {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        confidence: row.confidence == null ? 0 : Number(row.confidence),
        label: row.matched_label || null,
      }
      : null,
    candidates: Array.isArray(row.candidates) ? row.candidates : [],
    error: row.error_message || null,
  };
}

async function readCache(db, companyId, key, provider) {
  const result = await db.query(
    `SELECT * FROM geocode_cache
     WHERE company_id = $1 AND address_key = $2 AND provider = $3`,
    [companyId, key, provider]
  );
  return fromCacheRow(result.rows[0]);
}

async function writeCache(db, companyId, key, provider, payload) {
  await db.query(
    `INSERT INTO geocode_cache
       (company_id, address_key, provider, query_text, status, latitude, longitude,
        confidence, matched_label, candidates, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (company_id, address_key, provider) DO UPDATE SET
       query_text = EXCLUDED.query_text,
       status = EXCLUDED.status,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       confidence = EXCLUDED.confidence,
       matched_label = EXCLUDED.matched_label,
       candidates = EXCLUDED.candidates,
       error_message = EXCLUDED.error_message,
       updated_at = NOW()`,
    [
      companyId, key, provider, payload.queryText, payload.status,
      payload.latitude, payload.longitude, payload.confidence,
      payload.matchedLabel, JSON.stringify(payload.candidates || []), payload.errorMessage,
    ]
  );
}

/**
 * Geocode one address for a company, using the cache when possible.
 *
 * `search` is injectable so tests never touch the network, and so a second provider can be
 * dropped in later without changing callers.
 */
export async function geocodeAddress(db, companyId, address, {
  provider = activeGeocodeProvider(),
  search = defaultSearch(),
  refresh = false,
  autoAccept = AUTO_ACCEPT_CONFIDENCE,
} = {}) {
  const parsed = typeof address === 'string' ? parseRomanianAddress(address) : address;
  const key = addressKey(parsed);
  if (!key) {
    return { key: null, cached: false, best: null, candidates: [], outcome: { action: 'reject', reason: 'adresa_invalida' } };
  }

  if (!refresh) {
    const cached = await readCache(db, companyId, key, provider);
    if (cached) {
      return {
        key,
        cached: true,
        best: cached.best,
        candidates: cached.candidates,
        error: cached.error,
        outcome: cached.status === 'error'
          ? { action: 'reject', reason: 'eroare_anterioara' }
          : decideOutcome(cached.best, { autoAccept }),
      };
    }
  }

  let result;
  try {
    result = await search(parsed);
  } catch (err) {
    // Cache the failure so a broken address is not re-sent to the provider every run.
    await writeCache(db, companyId, key, provider, {
      queryText: parsed.raw, status: 'error',
      latitude: null, longitude: null, confidence: null, matchedLabel: null,
      candidates: [], errorMessage: err.message,
    });
    return {
      key, cached: false, best: null, candidates: [], error: err.message,
      outcome: { action: 'reject', reason: 'eroare_provider' },
    };
  }

  const best = result.best || null;
  await writeCache(db, companyId, key, provider, {
    queryText: parsed.raw,
    status: best ? 'hit' : 'miss',
    latitude: best?.latitude ?? null,
    longitude: best?.longitude ?? null,
    confidence: best?.confidence ?? null,
    matchedLabel: best?.label ?? null,
    candidates: result.candidates,
    errorMessage: null,
  });

  return {
    key,
    cached: false,
    best,
    candidates: result.candidates,
    outcome: decideOutcome(best, { autoAccept }),
  };
}

/**
 * Applies a geocoding result to a location row.
 * Coordinates are written for both accept and review; `geocode_verified` stays false either
 * way, because only a person confirming the pin may set it.
 */
export async function applyToLocation(db, companyId, locationId, result) {
  if (!result?.best || result.outcome.action === 'reject') return false;
  await db.query(
    `UPDATE locations
     SET latitude = $1, longitude = $2, geocode_confidence = $3,
         geocode_source = $4, geocoded_at = NOW(), updated_at = NOW()
     WHERE id = $5 AND company_id = $6`,
    [
      result.best.latitude, result.best.longitude, result.best.confidence,
      // The winning candidate carries its own provider; with escalation on, the pin that
      // wins may not be the one the free provider returned.
      result.best.provider || GEOCODE_PROVIDER, locationId, companyId,
    ]
  );
  return true;
}

/** Rolling tally for the batch run's report. */
export function emptyStats() {
  return { total: 0, accepted: 0, review: 0, rejected: 0, cached: 0, errors: 0 };
}

export function tally(stats, result) {
  stats.total += 1;
  if (result.cached) stats.cached += 1;
  if (result.error) stats.errors += 1;
  if (result.outcome.action === 'accept') stats.accepted += 1;
  else if (result.outcome.action === 'review') stats.review += 1;
  else stats.rejected += 1;
  return stats;
}

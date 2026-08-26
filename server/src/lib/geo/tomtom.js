/**
 * TomTom Search (geocoding) client.
 *
 * Used as an *escalation*, not as the default: Photon is self-hosted and free, TomTom is
 * billed per request. `escalatingSearch` in geocode.js only reaches for this when the free
 * provider comes back unsure — which in practice means rural Romanian addresses, the exact
 * case Photon handles worst.
 *
 * Candidates are normalized into the same shape Photon produces and scored by the shared
 * scorer, so a TomTom 0.82 means what a Photon 0.82 means.
 *
 * NOT YET EXERCISED AGAINST THE LIVE API — no key was available. The response parser is
 * written defensively and pinned by fixtures in the tests; correct the field names there
 * first if a real key returns something different.
 */

import { parseRomanianAddress } from './address.js';
import { buildSearchResult } from './matchScore.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 5;
const BASE_URL = 'https://api.tomtom.com';

/** Restricting to Romania is both a quality and a cost measure. */
export const DEFAULT_COUNTRY_SET = 'RO';

export function tomtomApiKey() {
  return String(process.env.TOMTOM_API_KEY || '').trim();
}

export function tomtomConfigured() {
  return Boolean(tomtomApiKey());
}

export function tomtomBaseUrl() {
  return String(process.env.TOMTOM_BASE_URL || '').trim().replace(/\/+$/, '') || BASE_URL;
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Free-text query, same assembly as the Photon client so both see the same input. */
export function buildQueryText(parsed) {
  const parts = [parsed?.street, parsed?.city, parsed?.county, parsed?.postcode].filter(Boolean);
  if (!parts.length && parsed?.raw) parts.push(parsed.raw);
  return parts.join(', ');
}

export function buildGeocodeUrl(parsed, {
  apiKey,
  baseUrl = BASE_URL,
  limit = DEFAULT_LIMIT,
  countrySet = DEFAULT_COUNTRY_SET,
} = {}) {
  const query = buildQueryText(parsed);
  if (!query.trim()) throw httpError('Adresă goală — nu se poate geocoda', 400);
  const params = new URLSearchParams({ key: apiKey, limit: String(limit) });
  if (countrySet) params.set('countrySet', countrySet);
  // The query sits in the path for this endpoint, so it must be path-encoded.
  return `${baseUrl}/search/2/geocode/${encodeURIComponent(query)}.json?${params}`;
}

/**
 * TomTom result types → our precision scale.
 * "Point Address" is a specific building; "Address Range" is interpolated along a street,
 * which is a street-level guess wearing a house number, so it does not count as an address.
 */
const TYPE_PRECISION = {
  'Point Address': 'address',
  'Address Range': 'street',
  Street: 'street',
  'Cross Street': 'street',
  Geography: 'locality',
  POI: 'address',
};

export function precisionFromType(type, hasStreetNumber) {
  const mapped = TYPE_PRECISION[String(type || '').trim()];
  if (mapped) return mapped;
  if (hasStreetNumber) return 'address';
  return 'other';
}

/** TomTom result → the candidate shape the rest of the app and the scorer expect. */
export function toCandidate(result) {
  const position = result?.position || {};
  const latitude = Number(position.lat);
  const longitude = Number(position.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const address = result?.address || {};
  const streetNumber = address.streetNumber || null;

  return {
    latitude,
    longitude,
    label: address.freeformAddress
      || [address.streetName, streetNumber, address.municipality].filter(Boolean).join(', ')
      || null,
    housenumber: streetNumber,
    street: address.streetName || null,
    city: address.municipality || address.localName || null,
    county: address.countrySubdivision || null,
    postcode: address.postalCode || null,
    countrycode: address.countryCode || null,
    precision: precisionFromType(result?.type, Boolean(streetNumber)),
    provider: 'tomtom',
    tomtom_id: result?.id ?? null,
    // TomTom's own relevance score, kept for debugging. Deliberately NOT used as the
    // confidence: it is on a different scale and would break the 0.8 / 0.45 thresholds.
    provider_score: Number.isFinite(Number(result?.score)) ? Number(result.score) : null,
  };
}

export function parseSearchResponse(json, parsed) {
  const results = Array.isArray(json?.results) ? json.results : [];
  return buildSearchResult(parsed, results.map(toCandidate));
}

/** TomTom reports errors as {detailedError:{message}} or {errorText}. */
export function tomtomErrorDetail(json) {
  if (!json || typeof json !== 'object') return null;
  if (typeof json.errorText === 'string') return json.errorText;
  if (typeof json.detailedError?.message === 'string') return json.detailedError.message;
  if (typeof json.message === 'string') return json.message;
  return null;
}

async function tomtomFetch(url, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw httpError(
      timedOut
        ? `TomTom nu a răspuns în ${timeoutMs} ms`
        : `TomTom inaccesibil: ${err?.message || 'eroare de rețea'}`,
      503
    );
  }
  const json = await res.json().catch(() => null);
  if (res.status === 403) {
    throw httpError('TomTom a refuzat cheia (403). Verifică TOMTOM_API_KEY.', 502);
  }
  if (res.status === 429) {
    // The free tier answers 429 once the daily allowance is gone; say so plainly rather
    // than letting it look like an outage.
    throw httpError('TomTom: limita de cereri atinsă (429).', 429);
  }
  if (!res.ok) {
    const detail = tomtomErrorDetail(json);
    throw httpError(`TomTom a răspuns ${res.status}${detail ? `: ${detail}` : ''}`, 502);
  }
  return json;
}

function requireApiKey() {
  const apiKey = tomtomApiKey();
  if (!apiKey) {
    throw httpError(
      'TomTom nu este configurat. Setează TOMTOM_API_KEY în server/.env.',
      503
    );
  }
  return apiKey;
}

/** Geocode one address. Same signature and return shape as `photonSearch`. */
export async function tomtomSearch(address, options = {}) {
  const parsed = typeof address === 'string' ? parseRomanianAddress(address) : address;
  const url = buildGeocodeUrl(parsed, {
    apiKey: requireApiKey(),
    baseUrl: tomtomBaseUrl(),
    ...options,
  });
  const json = await tomtomFetch(url, options);
  return { ...parseSearchResponse(json, parsed), parsed };
}

/** Liveness probe for /api/geo/health. Never throws. */
export async function tomtomPing(options = {}) {
  if (!tomtomConfigured()) {
    return { configured: false, ok: false, message: 'TOMTOM_API_KEY nu este setat' };
  }
  try {
    const result = await tomtomSearch('București, Calea Victoriei 1', { timeoutMs: 5000, ...options });
    return { configured: true, ok: Boolean(result.best) };
  } catch (err) {
    return { configured: true, ok: false, message: err.message };
  }
}

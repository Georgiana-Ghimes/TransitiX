/**
 * Photon geocoder client (OSM-backed, self-hostable).
 *
 * Photon returns candidates but no confidence score, so scoring happens here: every
 * candidate is compared against the parsed query and gets a 0–1 number that decides whether
 * the pin lands unattended or goes to a human. That score is the whole point of this module —
 * a geocoder that always answers is worse than one that admits when it guessed.
 */

import { parseRomanianAddress, streetNameTokens, stripDiacritics } from './address.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 5;
/** Photon supports only default/de/en/fr. "default" yields local-language names. */
const DEFAULT_LANG = 'default';

/** Romania's bounding box, so a query for "Unirii 1" cannot land in Hungary. */
export const RO_BBOX = '20.26,43.62,29.72,48.27';

/** Below this a pin is never written unattended. */
export const AUTO_ACCEPT_CONFIDENCE = 0.8;

export function photonBaseUrl() {
  return String(process.env.PHOTON_URL || '').trim().replace(/\/+$/, '');
}

export function photonConfigured() {
  return Boolean(photonBaseUrl());
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function norm(value) {
  return stripDiacritics(String(value || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Free-text query for Photon, assembled from the parsed parts we trust. */
export function buildQueryText(parsed) {
  const parts = [parsed?.street, parsed?.city, parsed?.postcode].filter(Boolean);
  if (!parts.length && parsed?.raw) parts.push(parsed.raw);
  parts.push('Romania');
  return parts.join(', ');
}

export function buildSearchUrl(baseUrl, parsed, { limit = DEFAULT_LIMIT, bbox = RO_BBOX, lang = DEFAULT_LANG } = {}) {
  const q = buildQueryText(parsed);
  if (!q.trim() || q.trim() === 'Romania') {
    throw httpError('Adresă goală — nu se poate geocoda', 400);
  }
  const params = new URLSearchParams({ q, limit: String(limit), lang });
  if (bbox) params.set('bbox', bbox);
  return `${baseUrl}/api?${params}`;
}

/** Photon feature → the shape the rest of the app uses. */
export function toCandidate(feature) {
  const props = feature?.properties || {};
  const [longitude, latitude] = feature?.geometry?.coordinates || [];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    label: [props.name, props.street, props.housenumber, props.city, props.state]
      .filter(Boolean)
      .join(', ') || null,
    housenumber: props.housenumber || null,
    street: props.street || null,
    city: props.city || props.name || null,
    county: props.county || props.state || null,
    postcode: props.postcode || null,
    countrycode: props.countrycode || null,
    osm_key: props.osm_key || null,
    osm_value: props.osm_value || null,
    osm_id: props.osm_id ?? null,
  };
}

/**
 * How much do we trust this candidate for the address we asked about?
 *
 * Precision of what came back sets the ceiling (a house beats a street beats a village),
 * then agreement with the query moves it up or down.
 */
export function scoreCandidate(parsed, candidate) {
  const reasons = [];
  if (!candidate) return { score: 0, reasons: ['fara_rezultat'] };

  // Anything outside Romania is a wrong answer, however confident it looks.
  if (candidate.countrycode && candidate.countrycode.toUpperCase() !== 'RO') {
    return { score: 0, reasons: ['alta_tara'] };
  }

  let score;
  if (candidate.housenumber) { score = 0.55; reasons.push('nivel_adresa'); }
  else if (candidate.street) { score = 0.4; reasons.push('nivel_strada'); }
  else if (candidate.osm_key === 'place') { score = 0.25; reasons.push('nivel_localitate'); }
  else { score = 0.2; reasons.push('nivel_imprecis'); }

  const wantCity = norm(parsed?.city);
  const gotCity = norm(candidate.city);
  if (wantCity && gotCity) {
    if (wantCity === gotCity) { score += 0.2; reasons.push('oras_potrivit'); }
    else if (gotCity.includes(wantCity) || wantCity.includes(gotCity)) {
      score += 0.1;
      reasons.push('oras_partial');
    } else { score -= 0.15; reasons.push('oras_diferit'); }
  }

  // Compare street *names* only. Including the type word would match "Calea Aradului"
  // against "Calea Torontalului" on the shared "calea" and score two different streets
  // as a perfect hit.
  const wantStreet = streetNameTokens(parsed?.street);
  const gotStreet = streetNameTokens(candidate.street);
  if (wantStreet.length && gotStreet.length) {
    const overlap = wantStreet.filter((want) => gotStreet.some((got) => (
      got === want
      // tolerate inflection ("Arad" / "Aradului") without matching unrelated names
      || (want.length >= 4 && got.length >= 4 && (got.includes(want) || want.includes(got)))
    )));
    if (overlap.length) { score += 0.1; reasons.push('strada_potrivita'); }
    // A different street is disqualifying, not a minor deduction: it must not survive
    // into auto-accept even when city and house number both agree.
    else { score -= 0.3; reasons.push('strada_diferita'); }
  }

  if (parsed?.houseNumber && candidate.housenumber) {
    if (norm(parsed.houseNumber) === norm(candidate.housenumber)) {
      score += 0.15;
      reasons.push('numar_potrivit');
    } else { score -= 0.1; reasons.push('numar_diferit'); }
  } else if (parsed?.houseNumber && !candidate.housenumber) {
    reasons.push('numar_negasit');
  }

  if (parsed?.postcode && candidate.postcode && parsed.postcode === candidate.postcode) {
    score += 0.05;
    reasons.push('cod_postal_potrivit');
  }

  return { score: round2(Math.max(0, Math.min(1, score))), reasons };
}

export function rankCandidates(parsed, features = []) {
  return features
    .map(toCandidate)
    .filter(Boolean)
    .map((candidate) => {
      const { score, reasons } = scoreCandidate(parsed, candidate);
      return { ...candidate, confidence: score, reasons };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

export function parseSearchResponse(json, parsed) {
  const features = Array.isArray(json?.features) ? json.features : [];
  const candidates = rankCandidates(parsed, features);
  return {
    candidates,
    best: candidates[0] || null,
    // Only a clear winner may be written without a human looking at it.
    autoAcceptable: Boolean(candidates[0] && candidates[0].confidence >= AUTO_ACCEPT_CONFIDENCE),
  };
}

/** Photon returns {"lang":[{"message":"..."}]} style validation errors. */
export function photonErrorDetail(json) {
  if (!json || typeof json !== 'object') return null;
  if (typeof json.message === 'string') return json.message;
  for (const value of Object.values(json)) {
    if (Array.isArray(value) && value[0]?.message) return value[0].message;
  }
  return null;
}

async function photonFetch(url, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw httpError(
      timedOut
        ? `Photon nu a răspuns în ${timeoutMs} ms`
        : `Photon inaccesibil: ${err?.message || 'eroare de rețea'}`,
      503
    );
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // Photon reports parameter problems in the body; without it a 400 is unreadable.
    const detail = photonErrorDetail(json);
    throw httpError(`Photon a răspuns ${res.status}${detail ? `: ${detail}` : ''}`, 502);
  }
  return json;
}

function requireBaseUrl() {
  const baseUrl = photonBaseUrl();
  if (!baseUrl) {
    throw httpError(
      'Photon nu este configurat. Setează PHOTON_URL în server/.env pentru geocodare.',
      503
    );
  }
  return baseUrl;
}

/** Geocode one address. Accepts raw text or an already-parsed address. */
export async function photonSearch(address, options = {}) {
  const parsed = typeof address === 'string' ? parseRomanianAddress(address) : address;
  const url = buildSearchUrl(requireBaseUrl(), parsed, options);
  const json = await photonFetch(url, options);
  return { ...parseSearchResponse(json, parsed), parsed };
}

/** Liveness probe for /api/geo/health. Never throws. */
export async function photonPing(options = {}) {
  if (!photonConfigured()) {
    return { configured: false, ok: false, message: 'PHOTON_URL nu este setat' };
  }
  try {
    const result = await photonSearch('București, Calea Victoriei 1', { timeoutMs: 5000, ...options });
    return { configured: true, ok: Boolean(result.best) };
  } catch (err) {
    return { configured: true, ok: false, message: err.message };
  }
}

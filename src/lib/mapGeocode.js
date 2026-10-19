/**
 * Map-only geocode for Harta zonelor: public Photon (OSM), first *agreeing* hit.
 *
 * Deliberately separate from `/zones/locate`: that path caches and scores confidence;
 * the map only needs a raw OSM coordinate so an operator can see the pin vs zone outlines.
 *
 * Photon is picky about over-specified queries (`strada X 1F, Town, Romania` often returns
 * nothing while `X, Town` hits), so we try progressively shorter candidates.
 *
 * A hit whose street name does not agree with what was typed is never auto-accepted: that is
 * how "strada Garii 12, Chiajna" used to become "Strada Simion Ghinea 12" with a confident
 * pin and tax answer. Weak / partial street overlap comes back as a suggestion the operator
 * must confirm before zone/tax are calculated.
 */

import { plainText, streetNameWithoutType } from './streetName.js';

const PHOTON_PUBLIC = 'https://photon.komoot.io/api/';
/** Same Romania bbox the server Photon client uses. */
const RO_BBOX = '20.26,43.62,29.72,48.27';

function fold(value) {
  return plainText(value);
}

/** Six-digit Romanian postcode from a free-text query or OCR field. */
export function extractRoPostcode(text) {
  const m = String(text || '').match(/\b(?:RO\s*)?(\d{6})\b/i);
  return m?.[1] || null;
}

/** Street-name tokens from a free-text query (no type word, no house number, no locality). */
export function queryStreetTokens(query, locality = null) {
  let text = String(query || '').trim();
  if (!text) return [];
  const loc = String(locality || '').trim();
  const locEsc = loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (loc) {
    // End-anchored or anywhere (query may continue with `, 077190`).
    text = text
      .replace(new RegExp(`,\\s*${locEsc}\\b`, 'gi'), ' ')
      .replace(new RegExp(`\\b${locEsc}\\b`, 'gi'), ' ')
      .trim();
  }
  text = text
    .replace(/,?\s*Romania\s*$/i, '')
    .replace(/\b(?:RO\s*)?\d{6}\b/gi, ' ')
    // House: `nr. 52`, `600A`, `1/VII` (OCR on Pipera etc.).
    .replace(/\bnr\.?\s*[0-9]+[A-Za-z]*(?:\/[A-Za-z0-9]+)?\b/gi, ' ')
    .replace(/\b[0-9]+[A-Za-z]*(?:\/[A-Za-z0-9]+)?\b/g, ' ')
    .replace(/[,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const bare = streetNameWithoutType(text);
  return bare.split(/\s+/).filter((t) => t.length >= 2 && !t.startsWith('/'));
}

function featureStreetTokens(props) {
  const street = props?.street || props?.name || '';
  const bare = streetNameWithoutType(street);
  return bare.split(/\s+/).filter((t) => t.length >= 2 && !/^\d+[a-z]?$/.test(t));
}

function tokenHits(want, got) {
  return want.filter((w) => got.some((g) => (
    g === w
    || (w.length >= 4 && g.length >= 4 && (g.includes(w) || w.includes(g)))
  )));
}

/**
 * How the Photon street compares to what was typed.
 *   ok          — enough name overlap to trust the pin
 *   suggestion  — some overlap, but not enough to charge without a human
 *   none        — different street (or no street at all when one was asked for)
 */
export function streetAgreement(wantTokens, gotTokens) {
  if (!wantTokens.length) return 'ok';
  if (!gotTokens.length) return 'none';
  const hits = tokenHits(wantTokens, gotTokens);
  if (!hits.length) return 'none';
  // Every typed token appears in the result ("ghinea" → Simion Ghinea, or full match).
  if (hits.length >= wantTokens.length) return 'ok';
  // Result is a shorter spelling of the same street (OSM dropped a given name).
  if (gotTokens.every((g) => tokenHits(wantTokens, [g]).length > 0)) return 'ok';
  // Shared token(s) but also a disagreeing name ("Simion Barnutiu" vs "Simion Ghinea").
  return 'suggestion';
}

/** Shorter queries Photon is more likely to answer. */
export function mapGeocodeQueries(query, locality = null, postcode = null) {
  const base = String(query || '').trim();
  const loc = String(locality || '').trim();
  const pc = extractRoPostcode(postcode) || extractRoPostcode(base);
  const out = [];
  const add = (q) => {
    const t = String(q || '').replace(/\s+/g, ' ').trim().replace(/^,|,$/g, '').trim();
    if (t && !out.some((x) => fold(x) === fold(t))) out.push(t);
  };
  const withLoc = (q) => {
    if (!q) return '';
    if (!loc || fold(q).includes(fold(loc))) return q;
    return `${q}, ${loc}`;
  };
  const withPost = (q) => {
    if (!q || !pc || fold(q).includes(pc)) return q;
    return `${q}, ${pc}`;
  };

  if (!base && !loc) return out;

  // Full query first (often already carries locality + postcode from Editează).
  add(withPost(withLoc(base)));
  add(withLoc(base.replace(/,?\s*Romania\s*$/i, '').trim()));

  // Drop house numbers: "nr. 1F", "1/VII", bare "600A" — keep a six-digit postcode.
  const noNum = base
    .replace(/\bnr\.?\s*[0-9]+[A-Za-z]*(?:\/[A-Za-z0-9]+)?\b/gi, ' ')
    .replace(/\b(?!\d{6}\b)[0-9]+[A-Za-z]*(?:\/[A-Za-z0-9]+)?\b/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  add(withPost(withLoc(noNum)));

  // Street type words often disagree with OSM ("strada" vs "Bulevardul Republicii").
  const locEsc = loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tidyCommas = (s) => String(s || '')
    .replace(/\b(?:RO\s*)?\d{6}\b/gi, ' ')
    .replace(/,\s*,+/g, ',')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();
  const bare = tidyCommas(
    noNum
      .replace(/^(strada|bulevardul|soseaua|aleea|piata|calea)\s+/i, '')
      .replace(loc ? new RegExp(`,\\s*${locEsc}\\b`, 'gi') : /$^/, '')
      .replace(loc ? new RegExp(`\\b${locEsc}\\b`, 'gi') : /$^/, ''),
  );
  if (bare) {
    const streetLoc = loc ? `${bare}, ${loc}` : bare;
    add(withPost(streetLoc));
    add(streetLoc);
  }

  // Street + postcode (no locality) — Photon often resolves the right settlement from the code.
  if (pc && bare) add(`${bare}, ${pc}`);

  // Bare locality only when the query had no street name — otherwise Photon pins the town
  // centre and the map used to treat that as the typed address.
  if (!queryStreetTokens(base, loc).length && loc) add(withPost(loc));
  return out;
}

function featureToPin(feature, query) {
  const [longitude, latitude] = feature?.geometry?.coordinates || [];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const props = feature.properties || {};
  const label = [
    props.name,
    props.street && props.housenumber
      ? `${props.street} ${props.housenumber}`
      : (props.street || props.housenumber),
    props.city || props.county || props.district,
    props.state,
  ].filter(Boolean).join(', ') || query;
  return {
    latitude,
    longitude,
    label,
    query,
    provider: 'photon-map',
    city: props.city || props.district || null,
    street: props.street || props.name || null,
  };
}

function preferLocality(features, locality) {
  if (!locality || !features.length) return features;
  const want = fold(locality);
  const matched = features.filter((f) => {
    const p = f.properties || {};
    return [p.city, p.district, p.county, p.name].some((x) => fold(x).includes(want));
  });
  return matched.length ? matched : features;
}

/** Prefer OSM hits whose postcode matches the aviz (under Adresa de livrare). */
function preferPostcode(features, postcode) {
  const pc = extractRoPostcode(postcode);
  if (!pc || !features.length) return features;
  const matched = features.filter((f) => {
    const got = String(f.properties?.postcode || '').replace(/\s+/g, '');
    return got === pc;
  });
  return matched.length ? matched : features;
}

async function photonSearch(q, { signal } = {}) {
  const url = new URL(PHOTON_PUBLIC);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '5');
  url.searchParams.set('lang', 'default');
  url.searchParams.set('bbox', RO_BBOX);

  let res;
  try {
    res = await fetch(url.toString(), { signal });
  } catch (err) {
    const e = new Error(err?.message || 'Geocodarea pe hartă a eșuat');
    e.status = 0;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(`Geocodarea pe hartă a răspuns ${res.status}`);
    e.status = res.status;
    throw e;
  }
  const json = await res.json().catch(() => null);
  return Array.isArray(json?.features) ? json.features : [];
}

/**
 * @returns {{
 *   latitude: number,
 *   longitude: number,
 *   label: string,
 *   query: string,
 *   match: 'accepted' | 'suggestion',
 * } | null}
 */
export async function geocodeMapPin(query, {
  locality = null,
  postcode = null,
  signal = undefined,
} = {}) {
  const pc = extractRoPostcode(postcode) || extractRoPostcode(query);
  const candidates = mapGeocodeQueries(query, locality, pc);
  if (!candidates.length) return null;

  const wantStreet = queryStreetTokens(query, locality);
  let suggestion = null;
  let lastErr = null;

  for (const q of candidates) {
    try {
      let features = await photonSearch(q, { signal });
      features = preferPostcode(preferLocality(features, locality), pc);
      for (const feature of features) {
        const pin = featureToPin(feature, q);
        if (!pin) continue;
        const gotStreet = featureStreetTokens(feature.properties || {});
        const agreement = streetAgreement(wantStreet, gotStreet);
        if (agreement === 'ok') {
          return { ...pin, match: 'accepted' };
        }
        if (agreement === 'suggestion' && !suggestion) {
          suggestion = { ...pin, match: 'suggestion' };
        }
      }
    } catch (err) {
      lastErr = err;
    }
  }
  if (suggestion) return suggestion;
  if (lastErr) throw lastErr;
  return null;
}

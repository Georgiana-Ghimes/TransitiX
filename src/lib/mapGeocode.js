/**
 * Map-only geocode for Harta zonelor: public Photon (OSM), first usable hit.
 *
 * Deliberately separate from `/zones/locate`: that path caches and scores confidence;
 * the map only needs a raw OSM coordinate so an operator can see the pin vs zone outlines.
 *
 * Photon is picky about over-specified queries (`strada X 1F, Town, Romania` often returns
 * nothing while `X, Town` hits), so we try progressively shorter candidates.
 */

const PHOTON_PUBLIC = 'https://photon.komoot.io/api/';
/** Same Romania bbox the server Photon client uses. */
const RO_BBOX = '20.26,43.62,29.72,48.27';

function fold(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ș|ş/g, 's')
    .replace(/ț|ţ/g, 't');
}

/** Shorter queries Photon is more likely to answer. */
export function mapGeocodeQueries(query, locality = null) {
  const base = String(query || '').trim();
  const loc = String(locality || '').trim();
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

  if (!base && !loc) return out;

  add(withLoc(base));
  add(withLoc(base.replace(/,?\s*Romania\s*$/i, '').trim()));

  // Drop house numbers: "nr. 1F", bare "600A".
  const noNum = base
    .replace(/\bnr\.?\s*[0-9]+[A-Za-z]?\b/gi, ' ')
    .replace(/\b[0-9]+[A-Za-z]?\b/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  add(withLoc(noNum));

  // Street type words often disagree with OSM ("strada" vs "Bulevardul Republicii").
  const bare = noNum
    .replace(/^(strada|bulevardul|soseaua|aleea|piata|calea)\s+/i, '')
    .replace(new RegExp(`,\\s*${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '')
    .trim();
  if (bare) add(loc ? `${bare}, ${loc}` : bare);

  if (loc) add(loc);
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
 * @returns {{ latitude: number, longitude: number, label: string, query: string } | null}
 */
export async function geocodeMapPin(query, { locality = null, signal = undefined } = {}) {
  const candidates = mapGeocodeQueries(query, locality);
  if (!candidates.length) return null;

  let lastErr = null;
  for (const q of candidates) {
    try {
      const features = preferLocality(await photonSearch(q, { signal }), locality);
      for (const feature of features) {
        const pin = featureToPin(feature, q);
        if (pin) return pin;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

/**
 * Display logic for the geocoding review screen.
 *
 * Thresholds mirror `server/src/lib/geo/geocode.js` — if they drift, the screen tells the
 * dispatcher a different story than the batch geocoder did.
 */

import { toFiniteNumber } from './utils.js';

export const AUTO_ACCEPT_CONFIDENCE = 0.8;
export const REVIEW_CONFIDENCE = 0.45;

/**
 * Where a location sits in the review queue.
 * `verified` outranks confidence: once a person confirms the pin, the score stops mattering.
 */
export function locationTier(location) {
  if (!location) return 'missing';
  const hasPin = location.latitude != null && location.longitude != null;
  if (!hasPin) return 'missing';
  if (location.geocode_verified) return 'verified';
  const confidence = toFiniteNumber(location.geocode_confidence);
  if (confidence == null) return 'review';
  if (confidence >= AUTO_ACCEPT_CONFIDENCE) return 'good';
  if (confidence >= REVIEW_CONFIDENCE) return 'review';
  return 'poor';
}

export const TIER_META = {
  verified: {
    label: 'Confirmat',
    short: 'OK',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    marker: '#27AE60',
    hint: 'Poziție confirmată de un operator.',
  },
  good: {
    label: 'Încredere mare',
    short: 'Auto',
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
    marker: '#1D4E89',
    hint: 'Geocodare cu potrivire exactă. Confirmă dacă vrei să fie definitivă.',
  },
  review: {
    label: 'De verificat',
    short: 'Verifică',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    marker: '#F5A623',
    hint: 'Geocoderul a găsit ceva apropiat, dar nu identic. Verifică pinul pe hartă.',
  },
  poor: {
    label: 'Încredere mică',
    short: 'Slab',
    badge: 'bg-red-50 text-red-700 border-red-200',
    marker: '#C0392B',
    hint: 'Potrivire slabă. Aproape sigur trebuie mutat pinul manual.',
  },
  missing: {
    label: 'Fără coordonate',
    short: 'Lipsă',
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
    marker: '#94A3B8',
    hint: 'Nu există poziție. Rulează geocodarea sau pune pinul manual.',
  },
};

export function tierMeta(tier) {
  return TIER_META[tier] || TIER_META.missing;
}

/** Worst first — the review queue should open on what actually needs attention. */
const TIER_ORDER = { missing: 0, poor: 1, review: 2, good: 3, verified: 4 };

export function compareByUrgency(a, b) {
  const diff = TIER_ORDER[locationTier(a)] - TIER_ORDER[locationTier(b)];
  if (diff !== 0) return diff;
  return String(a?.name || '').localeCompare(String(b?.name || ''), 'ro');
}

export const FILTERS = [
  { key: 'todo', label: 'De rezolvat' },
  { key: 'all', label: 'Toate' },
  { key: 'verified', label: 'Confirmate' },
  { key: 'missing', label: 'Fără pin' },
];

export function matchesFilter(location, filter) {
  const tier = locationTier(location);
  if (filter === 'all') return true;
  if (filter === 'verified') return tier === 'verified';
  if (filter === 'missing') return tier === 'missing';
  // "todo" is everything a person still has to look at
  return tier !== 'verified';
}

export function filterLocations(locations = [], filter = 'todo', search = '') {
  const needle = String(search || '').trim().toLowerCase();
  return locations
    .filter((location) => matchesFilter(location, filter))
    .filter((location) => {
      if (!needle) return true;
      return [location.name, location.address, location.city, location.county]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    })
    .sort(compareByUrgency);
}

export function summarizeLocations(locations = []) {
  const counts = { verified: 0, good: 0, review: 0, poor: 0, missing: 0 };
  for (const location of locations) counts[locationTier(location)] += 1;
  return {
    ...counts,
    total: locations.length,
    todo: locations.length - counts.verified,
  };
}

/** Reason codes come from the scorer on the server; these are their plain-language forms. */
export const REASON_LABELS = {
  nivel_adresa: 'potrivire la nivel de adresă',
  nivel_strada: 'potrivire doar la nivel de stradă',
  nivel_localitate: 'potrivire doar la nivel de localitate',
  nivel_imprecis: 'potrivire imprecisă',
  oras_potrivit: 'oraș identic',
  oras_partial: 'oraș parțial potrivit',
  oras_diferit: 'oraș diferit',
  strada_potrivita: 'stradă potrivită',
  strada_diferita: 'stradă diferită',
  numar_potrivit: 'număr identic',
  numar_diferit: 'număr diferit',
  numar_negasit: 'numărul nu a fost găsit',
  cod_postal_potrivit: 'cod poștal identic',
  alta_tara: 'rezultat în afara României',
  fara_rezultat: 'niciun rezultat',
};

export function reasonLabel(code) {
  return REASON_LABELS[code] || code;
}

export function formatCoord(value) {
  const num = toFiniteNumber(value);
  return num == null ? '—' : num.toFixed(6);
}

/** Full address line for display and for handing to the geocoder. */
export function fullAddress(location) {
  return [location?.address, location?.city, location?.county].filter(Boolean).join(', ');
}

/** Has the pin been dragged away from where it was stored? */
export function pinMoved(location, draft, tolerance = 1e-6) {
  if (!draft || !location) return false;
  if (location.latitude == null || location.longitude == null) return true;
  return Math.abs(Number(location.latitude) - draft.latitude) > tolerance
    || Math.abs(Number(location.longitude) - draft.longitude) > tolerance;
}

/**
 * Payload for confirming a pin.
 * A dragged pin becomes `manual` with full confidence — a person looked at it, which is a
 * stronger signal than any geocoder score.
 */
export function confirmPayload(location, draft) {
  const moved = pinMoved(location, draft);
  return {
    latitude: draft.latitude,
    longitude: draft.longitude,
    geocode_verified: true,
    geocode_source: moved ? 'manual' : (location.geocode_source || 'manual'),
    geocode_confidence: moved ? 1 : (location.geocode_confidence ?? 1),
  };
}

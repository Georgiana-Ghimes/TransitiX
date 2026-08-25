import { describe, expect, it } from 'vitest';
import {
  compareByUrgency,
  confirmPayload,
  filterLocations,
  formatCoord,
  fullAddress,
  locationTier,
  matchesFilter,
  pinMoved,
  reasonLabel,
  summarizeLocations,
  tierMeta,
} from './locationsUi.js';

const loc = (over = {}) => ({
  id: 'x', name: 'Depozit', latitude: 44.4, longitude: 26.1,
  geocode_confidence: 0.9, geocode_verified: false, ...over,
});

describe('locationTier', () => {
  it('reports missing when there is no pin', () => {
    expect(locationTier(loc({ latitude: null }))).toBe('missing');
    expect(locationTier(loc({ longitude: null }))).toBe('missing');
    expect(locationTier(null)).toBe('missing');
  });

  it('lets a confirmed pin outrank its score', () => {
    expect(locationTier(loc({ geocode_verified: true, geocode_confidence: 0.1 }))).toBe('verified');
  });

  it('splits on the same thresholds the server uses', () => {
    expect(locationTier(loc({ geocode_confidence: 0.8 }))).toBe('good');
    expect(locationTier(loc({ geocode_confidence: 0.79 }))).toBe('review');
    expect(locationTier(loc({ geocode_confidence: 0.45 }))).toBe('review');
    expect(locationTier(loc({ geocode_confidence: 0.44 }))).toBe('poor');
  });

  it('treats a pin with no score as needing review, not as good', () => {
    expect(locationTier(loc({ geocode_confidence: null }))).toBe('review');
  });

  it('handles a confidence that arrived as a string', () => {
    expect(locationTier(loc({ geocode_confidence: '0.90' }))).toBe('good');
  });
});

describe('tierMeta', () => {
  it('gives every tier a label and a marker colour', () => {
    for (const tier of ['verified', 'good', 'review', 'poor', 'missing']) {
      expect(tierMeta(tier).label).toBeTruthy();
      expect(tierMeta(tier).marker).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('falls back rather than returning undefined', () => {
    expect(tierMeta('nonsense')).toBe(tierMeta('missing'));
  });
});

describe('compareByUrgency', () => {
  it('puts what needs attention first', () => {
    const sorted = [
      loc({ name: 'ok', geocode_verified: true }),
      loc({ name: 'poor', geocode_confidence: 0.2 }),
      loc({ name: 'missing', latitude: null }),
      loc({ name: 'good', geocode_confidence: 0.95 }),
    ].sort(compareByUrgency);
    expect(sorted.map((l) => l.name)).toEqual(['missing', 'poor', 'good', 'ok']);
  });

  it('breaks ties by name using Romanian collation', () => {
    const sorted = [loc({ name: 'Șoseaua' }), loc({ name: 'Aleea' })].sort(compareByUrgency);
    expect(sorted[0].name).toBe('Aleea');
  });
});

describe('matchesFilter', () => {
  it('todo covers everything not yet confirmed', () => {
    expect(matchesFilter(loc({ geocode_confidence: 0.95 }), 'todo')).toBe(true);
    expect(matchesFilter(loc({ geocode_verified: true }), 'todo')).toBe(false);
  });

  it('all lets everything through', () => {
    expect(matchesFilter(loc({ geocode_verified: true }), 'all')).toBe(true);
  });

  it('missing selects only pinless locations', () => {
    expect(matchesFilter(loc({ latitude: null }), 'missing')).toBe(true);
    expect(matchesFilter(loc(), 'missing')).toBe(false);
  });
});

describe('filterLocations', () => {
  const list = [
    loc({ id: '1', name: 'Depozit Cluj', city: 'cluj napoca', geocode_verified: true }),
    loc({ id: '2', name: 'Punct Oradea', city: 'oradea', geocode_confidence: 0.6 }),
    loc({ id: '3', name: 'Hala Timișoara', city: 'timisoara', latitude: null }),
  ];

  it('filters and sorts by urgency in one pass', () => {
    expect(filterLocations(list, 'todo').map((l) => l.id)).toEqual(['3', '2']);
  });

  it('searches name, city and address', () => {
    expect(filterLocations(list, 'all', 'oradea').map((l) => l.id)).toEqual(['2']);
    expect(filterLocations(list, 'all', 'Depozit').map((l) => l.id)).toEqual(['1']);
  });

  it('ignores case and surrounding whitespace in the search', () => {
    expect(filterLocations(list, 'all', '  TIMIȘOARA ').map((l) => l.id)).toEqual(['3']);
  });

  it('returns everything for an empty search', () => {
    expect(filterLocations(list, 'all', '   ')).toHaveLength(3);
  });

  it('does not mutate the input array order', () => {
    const input = [...list];
    filterLocations(input, 'all');
    expect(input.map((l) => l.id)).toEqual(['1', '2', '3']);
  });
});

describe('summarizeLocations', () => {
  it('counts each tier and the outstanding total', () => {
    const stats = summarizeLocations([
      loc({ geocode_verified: true }),
      loc({ geocode_confidence: 0.9 }),
      loc({ geocode_confidence: 0.6 }),
      loc({ geocode_confidence: 0.2 }),
      loc({ latitude: null }),
    ]);
    expect(stats).toMatchObject({
      verified: 1, good: 1, review: 1, poor: 1, missing: 1, total: 5, todo: 4,
    });
  });

  it('handles an empty list', () => {
    expect(summarizeLocations([])).toMatchObject({ total: 0, todo: 0 });
  });
});

describe('reasonLabel', () => {
  it('translates known reason codes', () => {
    expect(reasonLabel('strada_diferita')).toBe('stradă diferită');
  });

  it('passes unknown codes through untouched', () => {
    expect(reasonLabel('ceva_nou')).toBe('ceva_nou');
  });
});

describe('fullAddress', () => {
  it('joins the parts the geocoder expects', () => {
    expect(fullAddress({ address: 'str. Fabricii 12', city: 'cluj napoca', county: 'CJ' }))
      .toBe('str. Fabricii 12, cluj napoca, CJ');
  });

  it('skips missing parts without leaving stray commas', () => {
    expect(fullAddress({ address: 'str. Fabricii 12' })).toBe('str. Fabricii 12');
    expect(fullAddress({})).toBe('');
  });
});

describe('pinMoved', () => {
  it('is true once the marker leaves its stored position', () => {
    expect(pinMoved(loc(), { latitude: 44.4, longitude: 26.1 })).toBe(false);
    expect(pinMoved(loc(), { latitude: 44.5, longitude: 26.1 })).toBe(true);
  });

  it('treats placing a first pin as a move', () => {
    expect(pinMoved(loc({ latitude: null, longitude: null }), { latitude: 44, longitude: 26 })).toBe(true);
  });

  it('ignores floating-point noise', () => {
    expect(pinMoved(loc(), { latitude: 44.4 + 1e-9, longitude: 26.1 })).toBe(false);
  });

  it('is false without a draft', () => {
    expect(pinMoved(loc(), null)).toBe(false);
  });
});

describe('confirmPayload', () => {
  it('marks a dragged pin as manual with full confidence', () => {
    const payload = confirmPayload(loc({ geocode_source: 'photon', geocode_confidence: 0.6 }), {
      latitude: 44.5, longitude: 26.2,
    });
    expect(payload).toEqual({
      latitude: 44.5, longitude: 26.2,
      geocode_verified: true, geocode_source: 'manual', geocode_confidence: 1,
    });
  });

  it('keeps the geocoder as the source when the pin was not touched', () => {
    const payload = confirmPayload(loc({ geocode_source: 'photon', geocode_confidence: 0.9 }), {
      latitude: 44.4, longitude: 26.1,
    });
    expect(payload).toMatchObject({
      geocode_verified: true, geocode_source: 'photon', geocode_confidence: 0.9,
    });
  });

  it('always sets verified — that is the point of confirming', () => {
    expect(confirmPayload(loc({ latitude: null, longitude: null }), { latitude: 1, longitude: 2 }))
      .toMatchObject({ geocode_verified: true, geocode_source: 'manual' });
  });
});

describe('formatCoord', () => {
  it('renders six decimals', () => {
    expect(formatCoord(44.4268)).toBe('44.426800');
    expect(formatCoord('26.1025')).toBe('26.102500');
  });

  it('shows a dash for a missing coordinate', () => {
    expect(formatCoord(null)).toBe('—');
    expect(formatCoord(undefined)).toBe('—');
  });
});

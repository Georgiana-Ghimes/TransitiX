import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  geocodeMapPin,
  mapGeocodeQueries,
  queryStreetTokens,
  streetAgreement,
} from './mapGeocode.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mapGeocodeQueries', () => {
  it('shortens over-specified delivery addresses for Photon', () => {
    expect(mapGeocodeQueries('strada Republicii 1F, Bolintin-Deal', 'Bolintin-Deal')).toEqual([
      'strada Republicii 1F, Bolintin-Deal',
      'strada Republicii, Bolintin-Deal',
      'Republicii, Bolintin-Deal',
    ]);
  });

  it('keeps bare locality only when the query has no street name', () => {
    expect(mapGeocodeQueries('Chiajna', 'Chiajna')).toContain('Chiajna');
    expect(mapGeocodeQueries('strada Garii 12', 'Chiajna')).not.toContain('Chiajna');
  });

  it('tries street + postcode so Photon can pin the OCR settlement', () => {
    const qs = mapGeocodeQueries(
      'bulevardul Pipera 1/VII, Voluntari, 077190',
      'Voluntari',
      '077190',
    );
    expect(qs[0]).toContain('077190');
    expect(qs.some((q) => /^pipera,\s*077190$/i.test(q))).toBe(true);
  });
});

describe('streetAgreement', () => {
  it('accepts the same street name under a different type word', () => {
    expect(streetAgreement(['republicii'], ['republicii'])).toBe('ok');
  });

  it('rejects a different street that only shares the house number locality', () => {
    expect(streetAgreement(['garii'], ['simion', 'ghinea'])).toBe('none');
  });

  it('accepts when OSM returns a shorter form of the typed name', () => {
    expect(streetAgreement(['simion', 'ghinea'], ['ghinea'])).toBe('ok');
  });

  it('flags disagreeing multi-word names as a suggestion', () => {
    expect(streetAgreement(['simion', 'barnutiu'], ['simion', 'ghinea'])).toBe('suggestion');
  });
});

describe('queryStreetTokens', () => {
  it('drops type word, house number and locality', () => {
    expect(queryStreetTokens('strada Garii 12, Chiajna', 'Chiajna')).toEqual(['garii']);
  });

  it('drops a six-digit postcode so it is not treated as a street token', () => {
    expect(queryStreetTokens('bulevardul Pipera 1/VII, Voluntari, 077190', 'Voluntari'))
      .toEqual(['pipera']);
  });
});

describe('geocodeMapPin postcode preference', () => {
  it('prefers the Photon hit whose postcode matches the aviz', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [26.1, 44.4] },
            properties: {
              street: 'Bulevardul Pipera',
              city: 'București',
              postcode: '014254',
            },
          },
          {
            geometry: { coordinates: [26.12, 44.48] },
            properties: {
              street: 'Bulevardul Pipera',
              city: 'Voluntari',
              postcode: '077190',
            },
          },
        ],
      }),
    })));

    const pin = await geocodeMapPin('bulevardul Pipera 1/VII, Voluntari', {
      locality: 'Voluntari',
      postcode: '077190',
    });
    expect(pin).toMatchObject({
      latitude: 44.48,
      longitude: 26.12,
      match: 'accepted',
      label: expect.stringContaining('Voluntari'),
    });
  });
});

describe('geocodeMapPin', () => {
  it('falls back until Photon returns a hit that agrees on the street', async () => {
    const fetchMock = vi.fn(async (url) => {
      const q = String(url);
      if (q.includes('Republicii') && !q.includes('1F') && q.includes('Bolintin')) {
        return {
          ok: true,
          json: async () => ({
            features: [{
              geometry: { coordinates: [25.98, 44.45] },
              properties: {
                name: 'Bulevardul Republicii',
                street: 'Bulevardul Republicii',
                city: 'Bolintin-Deal',
                state: 'Giurgiu',
              },
            }],
          }),
        };
      }
      return { ok: true, json: async () => ({ features: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const pin = await geocodeMapPin('strada Republicii 1F', { locality: 'Bolintin-Deal' });
    expect(pin).toMatchObject({
      latitude: 44.45,
      longitude: 25.98,
      match: 'accepted',
      label: expect.stringContaining('Bolintin-Deal'),
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not accept a different street in the same town', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        features: [{
          geometry: { coordinates: [25.97, 44.46] },
          properties: {
            name: 'Strada Simion Ghinea',
            street: 'Strada Simion Ghinea',
            housenumber: '12',
            city: 'Chiajna',
          },
        }],
      }),
    })));

    expect(await geocodeMapPin('strada Garii 12, Chiajna', { locality: 'Chiajna' })).toBeNull();
  });

  it('returns a suggestion when only part of a multi-word street matches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        features: [{
          geometry: { coordinates: [25.97, 44.46] },
          properties: {
            street: 'Strada Simion Ghinea',
            housenumber: '12',
            city: 'Chiajna',
          },
        }],
      }),
    })));

    // Shares "Simion", disagrees on the second name — must not auto-accept.
    const pin = await geocodeMapPin('strada Simion Barnutiu 12, Chiajna', { locality: 'Chiajna' });
    expect(pin).toMatchObject({
      match: 'suggestion',
      label: expect.stringContaining('Simion Ghinea'),
    });
  });

  it('returns null when every candidate misses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ features: [] }),
    })));
    expect(await geocodeMapPin('nicăieri')).toBeNull();
  });
});

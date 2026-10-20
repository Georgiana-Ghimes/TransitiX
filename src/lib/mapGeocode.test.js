import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearMapGeocodeCache,
  geocodeMapPin,
  mapGeocodeQueries,
  queryStreetTokens,
  streetAgreement,
} from './mapGeocode.js';

afterEach(() => {
  vi.unstubAllGlobals();
  clearMapGeocodeCache();
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

  it('puts postcode candidates first when the aviz carries a CP', () => {
    const qs = mapGeocodeQueries(
      'bulevardul Pipera 1/VII, Voluntari, 077190',
      'Voluntari',
      '077190',
    );
    expect(qs[0]).toContain('077190');
    expect(qs).toContain('077190');
    expect(qs.some((q) => /^pipera,\s*077190$/i.test(q))).toBe(true);
    // Without-CP fallback still present after the mandatory CP pass.
    expect(qs.some((q) => /voluntari/i.test(q) && !q.includes('077190'))).toBe(true);
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

  it('stops after the first candidate that agrees (does not hammer Photon)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        features: [{
          geometry: { coordinates: [26.10, 44.43] },
          properties: {
            street: 'Șoseaua Viilor',
            housenumber: '52',
            city: 'București',
          },
        }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const pin = await geocodeMapPin('Șoseaua Viilor 52', { locality: 'București' });
    expect(pin).toMatchObject({ match: 'accepted', latitude: 44.43 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(/lat=44\.4325/);
    expect(url).toMatch(/lon=26\.1039/);
  });

  it('caches a pin so the second search skips the network', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        features: [{
          geometry: { coordinates: [26.10, 44.43] },
          properties: { street: 'Calea Victoriei', city: 'București' },
        }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await geocodeMapPin('Calea Victoriei 1', { locality: 'București' });
    await geocodeMapPin('Calea Victoriei 1', { locality: 'București' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a same street name under a different postcode when the query carried the CP', async () => {
    const fetchMock = vi.fn(async (url) => {
      const q = String(url);
      if (q.includes('137181') && !q.includes('Principala')) {
        return {
          ok: true,
          json: async () => ({
            features: [{
              geometry: { coordinates: [25.90, 44.63] },
              properties: { name: 'Cocani', city: 'Dâmbovița', postcode: '137181', type: 'locality' },
            }],
          }),
        };
      }
      if (q.includes('137181')) {
        return {
          ok: true,
          json: async () => ({
            features: [{
              geometry: { coordinates: [24.11, 45.15] },
              properties: {
                street: 'Strada Principală',
                housenumber: '64B',
                city: 'Bărbătești',
                postcode: '247028',
              },
            }],
          }),
        };
      }
      return { ok: true, json: async () => ({ features: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const pin = await geocodeMapPin('strada Principala 64B', {
      locality: 'Cocani',
      postcode: '137181',
    });
    expect(pin).toMatchObject({
      latitude: 44.63,
      longitude: 25.90,
      match: 'accepted',
    });
    expect(pin.label).not.toMatch(/Bărbătești/i);
  });
});

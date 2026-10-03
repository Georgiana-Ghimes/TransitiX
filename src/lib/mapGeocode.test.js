import { afterEach, describe, expect, it, vi } from 'vitest';
import { geocodeMapPin, mapGeocodeQueries } from './mapGeocode.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mapGeocodeQueries', () => {
  it('shortens over-specified delivery addresses for Photon', () => {
    expect(mapGeocodeQueries('strada Republicii 1F, Bolintin-Deal', 'Bolintin-Deal')).toEqual([
      'strada Republicii 1F, Bolintin-Deal',
      'strada Republicii, Bolintin-Deal',
      'Republicii, Bolintin-Deal',
      'Bolintin-Deal',
    ]);
  });
});

describe('geocodeMapPin', () => {
  it('falls back until Photon returns a hit', async () => {
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
      label: expect.stringContaining('Bolintin-Deal'),
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('returns null when every candidate misses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ features: [] }),
    })));
    expect(await geocodeMapPin('nicăieri')).toBeNull();
  });
});

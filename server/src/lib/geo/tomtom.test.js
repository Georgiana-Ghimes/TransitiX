import { afterEach, describe, expect, it } from 'vitest';
import { parseRomanianAddress } from './address.js';
import {
  buildGeocodeUrl,
  buildQueryText,
  parseSearchResponse,
  precisionFromType,
  toCandidate,
  tomtomConfigured,
  tomtomErrorDetail,
  tomtomPing,
  tomtomSearch,
} from './tomtom.js';

const originalKey = process.env.TOMTOM_API_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.TOMTOM_API_KEY;
  else process.env.TOMTOM_API_KEY = originalKey;
});

/**
 * Fixture in the shape TomTom's Geocode endpoint documents. The live API was never
 * reachable during development, so this fixture *is* the contract — if a real key returns
 * different field names, fix it here first and the parser follows.
 */
function tomtomResult(over = {}) {
  return {
    type: 'Point Address',
    id: 'RO/PAD/p0/123',
    score: 9.8,
    position: { lat: 46.7825455, lon: 23.6144817 },
    address: {
      streetNumber: '12',
      streetName: 'Strada Fabricii',
      municipality: 'Cluj-Napoca',
      countrySubdivision: 'Cluj',
      postalCode: '400001',
      countryCode: 'RO',
      freeformAddress: 'Strada Fabricii 12, Cluj-Napoca',
    },
    ...over,
  };
}

describe('buildQueryText', () => {
  it('assembles street, city and county', () => {
    const parsed = parseRomanianAddress('Cluj-Napoca, str. Fabricii 12');
    expect(buildQueryText(parsed)).toBe('str. Fabricii 12, cluj napoca, CJ');
  });

  it('falls back to the raw text when nothing parsed', () => {
    expect(buildQueryText(parseRomanianAddress('la km 7 pe centura')))
      .toContain('la km 7 pe centura');
  });
});

describe('buildGeocodeUrl', () => {
  const parsed = parseRomanianAddress('Cluj-Napoca, str. Fabricii 12');

  it('puts the query in the path and the key in the query string', () => {
    const url = buildGeocodeUrl(parsed, { apiKey: 'K123' });
    expect(url).toContain('https://api.tomtom.com/search/2/geocode/');
    expect(url).toContain('key=K123');
    expect(url).toContain('countrySet=RO');
  });

  it('path-encodes the query so commas and spaces cannot break the URL', () => {
    const url = buildGeocodeUrl(parsed, { apiKey: 'K' });
    expect(url).not.toMatch(/geocode\/[^?]*\s/);
    expect(url).toContain('%2C');
  });

  it('refuses an empty address rather than querying for nothing', () => {
    expect(() => buildGeocodeUrl(parseRomanianAddress(''), { apiKey: 'K' }))
      .toThrowError(expect.objectContaining({ status: 400 }));
  });
});

describe('precisionFromType', () => {
  it('treats a point address as address-level', () => {
    expect(precisionFromType('Point Address', true)).toBe('address');
  });

  it('demotes an interpolated address range to street level', () => {
    // "Address Range" carries a house number but is interpolated along the street, so it
    // must not earn the address-level confidence ceiling.
    expect(precisionFromType('Address Range', true)).toBe('street');
  });

  it('maps geography to locality', () => {
    expect(precisionFromType('Geography', false)).toBe('locality');
  });

  it('falls back on an unknown type', () => {
    expect(precisionFromType('Something New', true)).toBe('address');
    expect(precisionFromType(undefined, false)).toBe('other');
  });
});

describe('toCandidate', () => {
  it('normalizes into the same shape the Photon client produces', () => {
    expect(toCandidate(tomtomResult())).toMatchObject({
      latitude: 46.7825455,
      longitude: 23.6144817,
      housenumber: '12',
      street: 'Strada Fabricii',
      city: 'Cluj-Napoca',
      county: 'Cluj',
      postcode: '400001',
      countrycode: 'RO',
      precision: 'address',
      provider: 'tomtom',
    });
  });

  it('keeps the provider score for debugging but does not use it as confidence', () => {
    const candidate = toCandidate(tomtomResult());
    expect(candidate.provider_score).toBe(9.8);
    expect(candidate.confidence).toBeUndefined();
  });

  it('returns null when the position is unusable', () => {
    expect(toCandidate({ address: {} })).toBe(null);
    expect(toCandidate({ position: { lat: 'x', lon: 1 } })).toBe(null);
    expect(toCandidate(null)).toBe(null);
  });

  it('builds a label when freeformAddress is absent', () => {
    const result = tomtomResult({ address: { streetName: 'Strada A', streetNumber: '3', municipality: 'Arad', countryCode: 'RO' } });
    expect(toCandidate(result).label).toBe('Strada A, 3, Arad');
  });
});

describe('parseSearchResponse', () => {
  const parsed = parseRomanianAddress('Cluj-Napoca, str. Fabricii 12');

  it('scores an exact match high enough to auto-accept', () => {
    const out = parseSearchResponse({ results: [tomtomResult()] }, parsed);
    expect(out.autoAcceptable).toBe(true);
    expect(out.best.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('uses the same scale as Photon — a wrong street cannot auto-accept', () => {
    const wrong = tomtomResult({
      address: { ...tomtomResult().address, streetName: 'Calea Torontalului' },
    });
    const out = parseSearchResponse({ results: [wrong] }, parsed);
    expect(out.best.reasons).toContain('strada_diferita');
    expect(out.autoAcceptable).toBe(false);
  });

  it('rejects a result outside Romania', () => {
    const abroad = tomtomResult({ address: { ...tomtomResult().address, countryCode: 'HU' } });
    expect(parseSearchResponse({ results: [abroad] }, parsed).best.confidence).toBe(0);
  });

  it('handles an empty result set', () => {
    expect(parseSearchResponse({ results: [] }, parsed))
      .toEqual({ candidates: [], best: null, autoAcceptable: false });
  });
});

describe('tomtomErrorDetail', () => {
  it('reads the documented error shapes', () => {
    expect(tomtomErrorDetail({ errorText: 'Developer Inactive' })).toBe('Developer Inactive');
    expect(tomtomErrorDetail({ detailedError: { message: 'Bad request' } })).toBe('Bad request');
  });

  it('returns null when there is nothing useful', () => {
    expect(tomtomErrorDetail(null)).toBe(null);
    expect(tomtomErrorDetail({ results: [] })).toBe(null);
  });
});

describe('tomtomSearch', () => {
  it('refuses to call out when no key is set', async () => {
    delete process.env.TOMTOM_API_KEY;
    await expect(tomtomSearch('Cluj-Napoca, str. Fabricii 12'))
      .rejects.toThrowError(expect.objectContaining({ status: 503 }));
  });

  it('returns a parsed result on success', async () => {
    process.env.TOMTOM_API_KEY = 'K';
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ results: [tomtomResult()] }) });
    const out = await tomtomSearch('Cluj-Napoca, str. Fabricii 12', { fetchImpl });
    expect(out.best.provider).toBe('tomtom');
    expect(out.parsed.city).toBe('cluj napoca');
  });

  it('names a rejected key rather than reporting a generic failure', async () => {
    process.env.TOMTOM_API_KEY = 'bad';
    const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
    await expect(tomtomSearch('Cluj-Napoca, str. Fabricii 12', { fetchImpl }))
      .rejects.toThrow(/TOMTOM_API_KEY/);
  });

  it('reports an exhausted quota as 429, not as an outage', async () => {
    process.env.TOMTOM_API_KEY = 'K';
    const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await expect(tomtomSearch('Cluj-Napoca, str. Fabricii 12', { fetchImpl }))
      .rejects.toThrowError(expect.objectContaining({ status: 429 }));
  });

  it('turns a network failure into a 503', async () => {
    process.env.TOMTOM_API_KEY = 'K';
    const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
    await expect(tomtomSearch('Cluj-Napoca, str. Fabricii 12', { fetchImpl }))
      .rejects.toThrowError(expect.objectContaining({ status: 503 }));
  });
});

describe('tomtomPing', () => {
  it('reports unconfigured without touching the network', async () => {
    delete process.env.TOMTOM_API_KEY;
    expect(await tomtomPing()).toMatchObject({ configured: false, ok: false });
  });

  it('reports the failure instead of throwing', async () => {
    process.env.TOMTOM_API_KEY = 'K';
    const fetchImpl = async () => { throw new Error('down'); };
    expect(await tomtomPing({ fetchImpl })).toMatchObject({ configured: true, ok: false });
  });
});

describe('configuration', () => {
  it('treats a blank key as unconfigured', () => {
    process.env.TOMTOM_API_KEY = '   ';
    expect(tomtomConfigured()).toBe(false);
  });
});

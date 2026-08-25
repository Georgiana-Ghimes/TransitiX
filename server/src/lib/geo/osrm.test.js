import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildNearestUrl,
  buildRouteUrl,
  buildTableUrl,
  formatCoordinates,
  osrmBaseUrl,
  osrmConfigured,
  osrmPing,
  osrmRoute,
  parseNearestResponse,
  parseRouteResponse,
  parseTableResponse,
  toCoordinate,
} from './osrm.js';

const BUCHAREST = { latitude: 44.4268, longitude: 26.1025 };
const CLUJ = { latitude: 46.7712, longitude: 23.6236 };

const originalUrl = process.env.OSRM_URL;
const originalProfile = process.env.OSRM_PROFILE;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.OSRM_URL;
  else process.env.OSRM_URL = originalUrl;
  if (originalProfile === undefined) delete process.env.OSRM_PROFILE;
  else process.env.OSRM_PROFILE = originalProfile;
});

describe('toCoordinate', () => {
  it('accepts the latitude/longitude column names used by locations', () => {
    expect(toCoordinate(BUCHAREST)).toEqual({ latitude: 44.4268, longitude: 26.1025 });
  });

  it('accepts lat/lon and lat/lng aliases', () => {
    expect(toCoordinate({ lat: 44.4268, lon: 26.1025 })).toEqual(BUCHAREST);
    expect(toCoordinate({ lat: 44.4268, lng: 26.1025 })).toEqual(BUCHAREST);
  });

  it('rejects missing, non-numeric and out-of-range coordinates', () => {
    expect(() => toCoordinate({})).toThrow(/latitude și longitude/);
    expect(() => toCoordinate({ latitude: 'x', longitude: 26 })).toThrow(/latitude și longitude/);
    expect(() => toCoordinate({ latitude: 91, longitude: 26 })).toThrow(/Latitudine/);
    expect(() => toCoordinate({ latitude: 44, longitude: 181 })).toThrow(/Longitudine/);
  });

  it('marks coordinate errors as client errors', () => {
    expect(() => toCoordinate({})).toThrowError(expect.objectContaining({ status: 400 }));
  });
});

describe('formatCoordinates', () => {
  it('emits lon,lat pairs — the reverse of the stored order', () => {
    expect(formatCoordinates([BUCHAREST, CLUJ])).toBe('26.1025,44.4268;23.6236,46.7712');
  });

  it('rounds to six decimals', () => {
    expect(formatCoordinates([{ latitude: 44.123456789, longitude: 26.987654321 }]))
      .toBe('26.987654,44.123457');
  });

  it('enforces the min and max point counts', () => {
    expect(() => formatCoordinates([BUCHAREST], { min: 2 })).toThrow(/cel puțin 2/);
    expect(() => formatCoordinates([BUCHAREST, CLUJ], { max: 1 })).toThrow(/Prea multe puncte/);
  });
});

describe('url builders', () => {
  it('builds a route url with geojson geometry', () => {
    const url = buildRouteUrl('http://osrm:5000', [BUCHAREST, CLUJ]);
    expect(url).toContain('/route/v1/driving/26.1025,44.4268;23.6236,46.7712?');
    expect(url).toContain('geometries=geojson');
    expect(url).toContain('overview=simplified');
  });

  it('asks the table endpoint for distances as well as durations', () => {
    const url = buildTableUrl('http://osrm:5000', [BUCHAREST, CLUJ]);
    expect(url).toContain('/table/v1/driving/');
    expect(url).toContain('annotations=duration%2Cdistance');
  });

  it('supports rectangular matrices via sources and destinations', () => {
    const url = buildTableUrl('http://osrm:5000', [BUCHAREST, CLUJ, BUCHAREST], {
      sources: [0],
      destinations: [1, 2],
    });
    expect(url).toContain('sources=0');
    expect(url).toContain('destinations=1%3B2');
  });

  it('rejects out-of-range source indices', () => {
    expect(() => buildTableUrl('http://osrm:5000', [BUCHAREST, CLUJ], { sources: [5] }))
      .toThrow(/index invalid/);
  });

  it('clamps the nearest count to the supported range', () => {
    expect(buildNearestUrl('http://osrm:5000', BUCHAREST, { number: 99 })).toContain('number=10');
    expect(buildNearestUrl('http://osrm:5000', BUCHAREST, { number: 0 })).toContain('number=1');
  });
});

describe('response parsers', () => {
  it('converts metres and seconds to km and minutes', () => {
    const parsed = parseRouteResponse({
      code: 'Ok',
      routes: [{
        distance: 445_120,
        duration: 21_600,
        geometry: { type: 'LineString', coordinates: [] },
        legs: [{ distance: 445_120, duration: 21_600 }],
      }],
    });
    expect(parsed.distance_km).toBe(445.12);
    expect(parsed.duration_min).toBe(360);
    expect(parsed.legs).toEqual([{ distance_km: 445.12, duration_min: 360 }]);
  });

  it('surfaces an OSRM error code as a 422', () => {
    expect(() => parseRouteResponse({ code: 'NoRoute', message: 'Impossible route' }))
      .toThrowError(expect.objectContaining({ status: 422 }));
  });

  it('treats a missing route as unroutable rather than crashing', () => {
    expect(() => parseRouteResponse({ code: 'Ok', routes: [] })).toThrow(/nicio rută/);
  });

  it('scales both matrices and preserves unreachable nulls', () => {
    const parsed = parseTableResponse({
      code: 'Ok',
      distances: [[0, 445_120], [445_120, null]],
      durations: [[0, 21_600], [21_600, null]],
    });
    expect(parsed.distances_km).toEqual([[0, 445.12], [445.12, null]]);
    expect(parsed.durations_min).toEqual([[0, 360], [360, null]]);
  });

  it('reports how far a point sat from the road network', () => {
    const parsed = parseNearestResponse({
      code: 'Ok',
      waypoints: [{ location: [26.1025, 44.4268], name: 'Bulevardul Unirii', distance: 12.34 }],
    });
    expect(parsed.waypoints[0]).toEqual({
      latitude: 44.4268,
      longitude: 26.1025,
      name: 'Bulevardul Unirii',
      snap_distance_m: 12.3,
    });
  });
});

describe('configuration', () => {
  it('reports unconfigured when OSRM_URL is empty', () => {
    process.env.OSRM_URL = '   ';
    expect(osrmConfigured()).toBe(false);
  });

  it('strips trailing slashes so url building stays clean', () => {
    process.env.OSRM_URL = 'http://osrm:5000///';
    expect(osrmBaseUrl()).toBe('http://osrm:5000');
  });

  it('refuses to call out when unconfigured, instead of inventing a distance', async () => {
    delete process.env.OSRM_URL;
    await expect(osrmRoute([BUCHAREST, CLUJ])).rejects.toThrowError(
      expect.objectContaining({ status: 503 })
    );
  });
});

describe('osrmRoute over an injected fetch', () => {
  beforeEach(() => {
    process.env.OSRM_URL = 'http://osrm:5000';
  });

  it('returns parsed values on success', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({ code: 'Ok', routes: [{ distance: 1000, duration: 60, legs: [] }] }),
      };
    };
    const result = await osrmRoute([BUCHAREST, CLUJ], { fetchImpl });
    expect(result.distance_km).toBe(1);
    expect(result.duration_min).toBe(1);
    expect(calls[0]).toContain('http://osrm:5000/route/v1/');
  });

  it('turns a network failure into a 503', async () => {
    const fetchImpl = async () => { throw new Error('connect ECONNREFUSED'); };
    await expect(osrmRoute([BUCHAREST, CLUJ], { fetchImpl })).rejects.toThrowError(
      expect.objectContaining({ status: 503 })
    );
  });

  it('turns a timeout into a 503 with the budget in the message', async () => {
    const fetchImpl = async () => {
      const err = new Error('aborted');
      err.name = 'TimeoutError';
      throw err;
    };
    await expect(osrmRoute([BUCHAREST, CLUJ], { fetchImpl, timeoutMs: 250 }))
      .rejects.toThrow(/250 ms/);
  });

  it('turns a non-2xx response into a 502', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => null });
    await expect(osrmRoute([BUCHAREST, CLUJ], { fetchImpl })).rejects.toThrowError(
      expect.objectContaining({ status: 502 })
    );
  });
});

describe('osrmPing', () => {
  it('reports unconfigured without touching the network', async () => {
    delete process.env.OSRM_URL;
    expect(await osrmPing()).toEqual({
      configured: false,
      ok: false,
      message: 'OSRM_URL nu este setat',
    });
  });

  it('reports ok when the graph answers', async () => {
    process.env.OSRM_URL = 'http://osrm:5000';
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ code: 'Ok', routes: [{ distance: 800, duration: 120, legs: [] }] }),
    });
    expect(await osrmPing({ fetchImpl })).toEqual({ configured: true, ok: true, profile: 'driving' });
  });

  it('reports the failure instead of throwing', async () => {
    process.env.OSRM_URL = 'http://osrm:5000';
    const fetchImpl = async () => { throw new Error('connect ECONNREFUSED'); };
    const result = await osrmPing({ fetchImpl });
    expect(result).toMatchObject({ configured: true, ok: false });
    expect(result.message).toMatch(/inaccesibil/);
  });
});

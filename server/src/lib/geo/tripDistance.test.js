import { afterEach, describe, expect, it } from 'vitest';
import {
  computeTripDistance,
  findCoordinates,
  refreshTripDistance,
  resolveDistanceSource,
  shouldAutoCompute,
} from './tripDistance.js';

const originalOsrm = process.env.OSRM_URL;
afterEach(() => {
  if (originalOsrm === undefined) delete process.env.OSRM_URL;
  else process.env.OSRM_URL = originalOsrm;
});

/** db double: each query is matched by the table it reads and answered from `rows`. */
function fakeDb(rows = {}) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: text.trim().split('\n')[0], params });
      if (text.includes('FROM locations')) return { rows: rows.locations || [] };
      if (text.includes('FROM geocode_cache')) return { rows: rows.cache || [] };
      return { rows: [], rowCount: 1 };
    },
  };
}

describe('resolveDistanceSource', () => {
  it('hands ownership back to the geocoder when the field is cleared', () => {
    expect(resolveDistanceSource({ incoming: '', stored: 440, storedSource: 'manual' }))
      .toEqual({ distance_km: null, distance_source: null, autoEligible: true });
    expect(resolveDistanceSource({ incoming: null, stored: 440, storedSource: 'osrm' }).autoEligible)
      .toBe(true);
  });

  it('treats the form echoing our own value as still ours', () => {
    // The trip form always posts distance_km, including the number we computed and showed.
    const result = resolveDistanceSource({ incoming: 440, stored: 440, storedSource: 'osrm' });
    expect(result).toEqual({ distance_km: 440, distance_source: 'osrm', autoEligible: true });
  });

  it('tolerates rounding when deciding the value is unchanged', () => {
    expect(resolveDistanceSource({ incoming: 440.2, stored: 440, storedSource: 'osrm' }).distance_source)
      .toBe('osrm');
  });

  it('marks a real edit as manual and locks it', () => {
    const result = resolveDistanceSource({ incoming: 500, stored: 440, storedSource: 'osrm' });
    expect(result).toEqual({ distance_km: 500, distance_source: 'manual', autoEligible: false });
  });

  it('keeps a manual value manual when it is re-posted unchanged', () => {
    const result = resolveDistanceSource({ incoming: 500, stored: 500, storedSource: 'manual' });
    expect(result).toMatchObject({ distance_source: 'manual', autoEligible: false });
  });

  it('marks a first-time value on a new trip as manual', () => {
    expect(resolveDistanceSource({ incoming: 300, stored: null, storedSource: null }))
      .toMatchObject({ distance_km: 300, distance_source: 'manual' });
  });

  it('ignores a non-numeric value', () => {
    expect(resolveDistanceSource({ incoming: 'abc', stored: 440, storedSource: 'osrm' }).distance_km)
      .toBe(null);
  });
});

describe('shouldAutoCompute', () => {
  it('never touches a manual distance', () => {
    expect(shouldAutoCompute({ distance_km: 500, distance_source: 'manual' })).toBe(false);
    expect(shouldAutoCompute({ distance_km: null, distance_source: 'manual' })).toBe(false);
  });

  it('computes when empty or when we own the value', () => {
    expect(shouldAutoCompute({ distance_km: null, distance_source: null })).toBe(true);
    expect(shouldAutoCompute({ distance_km: 440, distance_source: 'osrm' })).toBe(true);
  });

  it('handles a missing trip', () => {
    expect(shouldAutoCompute(null)).toBe(false);
  });
});

describe('findCoordinates', () => {
  it('prefers a confirmed location over the geocode cache', async () => {
    const db = fakeDb({
      locations: [{ latitude: '46.77', longitude: '23.62' }],
      cache: [{ latitude: '1', longitude: '2' }],
    });
    expect(await findCoordinates(db, 'co', 'Cluj-Napoca, str. Fabricii 12'))
      .toEqual({ latitude: 46.77, longitude: 23.62, source: 'locations' });
  });

  it('falls back to the geocode cache', async () => {
    const db = fakeDb({ locations: [], cache: [{ latitude: '44.4', longitude: '26.1' }] });
    const found = await findCoordinates(db, 'co', 'București, Calea Victoriei 1');
    expect(found).toMatchObject({ latitude: 44.4, source: 'geocode_cache' });
  });

  it('returns null for an address nobody has geocoded', async () => {
    expect(await findCoordinates(fakeDb(), 'co', 'Undeva, prin spate')).toBe(null);
  });

  it('returns null without querying when the address yields no key', async () => {
    const db = fakeDb();
    expect(await findCoordinates(db, 'co', '')).toBe(null);
    expect(db.calls).toHaveLength(0);
  });

  it('looks up by the shared normalized key', async () => {
    const db = fakeDb({ locations: [{ latitude: '1', longitude: '2' }] });
    await findCoordinates(db, 'co', 'Cluj-Napoca, Strada Fabricii nr. 12');
    expect(db.calls[0].params).toEqual(['co', 'cj|cluj napoca|strada fabricii 12']);
  });
});

describe('computeTripDistance', () => {
  const trip = {
    id: 't1',
    shipper_address: 'Cluj-Napoca, str. Fabricii 12',
    consignee_address: 'București, Șoseaua Olteniței 200',
  };

  it('refuses without OSRM rather than guessing', async () => {
    delete process.env.OSRM_URL;
    expect(await computeTripDistance(fakeDb(), 'co', trip))
      .toEqual({ ok: false, reason: 'osrm_neconfigurat' });
  });

  it('reports which end is missing coordinates', async () => {
    process.env.OSRM_URL = 'http://osrm:5000';
    const noneFound = fakeDb();
    expect((await computeTripDistance(noneFound, 'co', trip)).reason).toBe('expeditor_negeocodat');
  });

  it('needs both addresses present', async () => {
    process.env.OSRM_URL = 'http://osrm:5000';
    expect((await computeTripDistance(fakeDb(), 'co', { ...trip, consignee_address: null })).reason)
      .toBe('adrese_lipsa');
  });

  it('rounds the road distance to whole kilometres', async () => {
    process.env.OSRM_URL = 'http://osrm:5000';
    const db = fakeDb({ locations: [{ latitude: '46.77', longitude: '23.62' }] });
    const result = await computeTripDistance(db, 'co', trip, {
      route: async () => ({ distance_km: 440.099, duration_min: 382.06 }),
    });
    expect(result).toMatchObject({ ok: true, distance_km: 440, duration_min: 382 });
  });

  it('reports OSRM being down instead of throwing', async () => {
    process.env.OSRM_URL = 'http://osrm:5000';
    const db = fakeDb({ locations: [{ latitude: '46.77', longitude: '23.62' }] });
    const result = await computeTripDistance(db, 'co', trip, {
      route: async () => { throw new Error('connect ECONNREFUSED'); },
    });
    expect(result).toMatchObject({ ok: false, reason: 'osrm_indisponibil' });
  });
});

describe('refreshTripDistance', () => {
  const trip = {
    id: 't1',
    distance_km: null,
    distance_source: null,
    shipper_address: 'Cluj-Napoca, str. Fabricii 12',
    consignee_address: 'București, Șoseaua Olteniței 200',
  };

  function geoDb() {
    return fakeDb({ locations: [{ latitude: '46.77', longitude: '23.62' }] });
  }

  it('writes the computed distance and marks it osrm-owned', async () => {
    process.env.OSRM_URL = 'http://osrm:5000';
    const db = geoDb();
    const result = await refreshTripDistance(db, 'co', trip, {
      route: async () => ({ distance_km: 440.099, duration_min: 382 }),
    });
    expect(result).toMatchObject({ ok: true, saved: true, distance_km: 440 });
    const update = db.calls.find((c) => c.text.startsWith('UPDATE trips'));
    expect(update.text).toContain("distance_source = 'osrm'");
    expect(update.params).toEqual([440, 't1', 'co']);
  });

  it('leaves a manual distance completely alone', async () => {
    process.env.OSRM_URL = 'http://osrm:5000';
    const db = geoDb();
    const result = await refreshTripDistance(db, 'co', { ...trip, distance_km: 500, distance_source: 'manual' });
    expect(result).toEqual({ ok: false, reason: 'distanta_manuala' });
    expect(db.calls).toHaveLength(0);
  });

  it('skips the write when the value has not changed', async () => {
    process.env.OSRM_URL = 'http://osrm:5000';
    const db = geoDb();
    const result = await refreshTripDistance(db, 'co', { ...trip, distance_km: 440, distance_source: 'osrm' }, {
      route: async () => ({ distance_km: 440.4, duration_min: 382 }),
    });
    expect(result.unchanged).toBe(true);
    expect(db.calls.some((c) => c.text.startsWith('UPDATE trips'))).toBe(false);
  });

  it('never throws when OSRM is unreachable — the trip is still saved', async () => {
    process.env.OSRM_URL = 'http://osrm:5000';
    const db = geoDb();
    const result = await refreshTripDistance(db, 'co', trip, {
      route: async () => { throw new Error('down'); },
    });
    expect(result.ok).toBe(false);
    expect(db.calls.some((c) => c.text.startsWith('UPDATE trips'))).toBe(false);
  });

  it('never throws when the database itself fails', async () => {
    process.env.OSRM_URL = 'http://osrm:5000';
    const broken = { query: async () => { throw new Error('db gone'); } };
    expect(await refreshTripDistance(broken, 'co', trip))
      .toMatchObject({ ok: false, reason: 'eroare' });
  });
});

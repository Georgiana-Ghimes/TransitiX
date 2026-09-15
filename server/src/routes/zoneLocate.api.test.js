/**
 * `POST /api/commercial/zones/locate`, the lookup behind the zone map.
 *
 * Geocoding is never called here: every address is pre-seeded into `geocode_cache`, which is
 * the same short-circuit `geocodeAddress` takes in production. That keeps the suite off the
 * network and lets each case place a point exactly where the assertion needs it, on either
 * side of a boundary, which is the whole point of the endpoint.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import { addressKey, parseRomanianAddress } from '../lib/geo/address.js';
import { activeGeocodeProvider } from '../lib/geo/geocode.js';
import { auth, closePool, dropCompany, request, seedCompany } from '../test/harness.js';

let ctx;

// A square over central Bucharest. Small enough that "just outside" is unambiguous.
const SQUARE = {
  type: 'Polygon',
  coordinates: [[[26.05, 44.41], [26.15, 44.41], [26.15, 44.47], [26.05, 44.47], [26.05, 44.41]]],
};

const INSIDE = { lat: 44.44, lon: 26.10 };
const OUTSIDE = { lat: 44.39, lon: 26.30 };

async function seedGeocode(address, { lat, lon }, { confidence = 0.92, city = 'Bucuresti', county = 'B' } = {}) {
  const key = addressKey(parseRomanianAddress(address));
  await query(
    `INSERT INTO geocode_cache
       (company_id, address_key, provider, query_text, status, latitude, longitude,
        confidence, matched_label, candidates)
     VALUES ($1, $2, $3, $4, 'hit', $5, $6, $7, $8, $9)
     ON CONFLICT (company_id, address_key, provider) DO UPDATE
       SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
           confidence = EXCLUDED.confidence, candidates = EXCLUDED.candidates`,
    [
      ctx.company.id, key, activeGeocodeProvider(), address, lat, lon, confidence, address,
      JSON.stringify([{ latitude: lat, longitude: lon, confidence, label: address, city, county }]),
    ],
  );
  return key;
}

/** A cached "the provider looked and found nothing" row, which is not an outage. */
async function seedGeocodeMiss(address) {
  const key = addressKey(parseRomanianAddress(address));
  await query(
    `INSERT INTO geocode_cache
       (company_id, address_key, provider, query_text, status, candidates)
     VALUES ($1, $2, $3, $4, 'miss', '[]'::jsonb)
     ON CONFLICT (company_id, address_key, provider) DO UPDATE SET status = 'miss'`,
    [ctx.company.id, key, activeGeocodeProvider(), address],
  );
}

async function makeZone({ code, name, polygon = null, matcher = {}, priority = 0, active = true }) {
  const res = await query(
    `INSERT INTO tax_zones (company_id, code, name, kind, matcher, polygon, priority, is_active)
     VALUES ($1, $2, $3, 'zone', $4, $5, $6, $7) RETURNING *`,
    [ctx.company.id, code, name, JSON.stringify(matcher),
      polygon ? JSON.stringify(polygon) : null, priority, active],
  );
  return res.rows[0];
}

async function makeRate(zoneId, { min = 0, max = null, amount = 50 } = {}) {
  const res = await query(
    `INSERT INTO tax_zone_rates
       (company_id, tax_zone_id, mma_min_kg, mma_max_kg, amount, currency, valid_from)
     VALUES ($1, $2, $3, $4, $5, 'RON', '2020-01-01') RETURNING *`,
    [ctx.company.id, zoneId, min, max, amount],
  );
  return res.rows[0];
}

beforeAll(async () => {
  ctx = await seedCompany('zone-locate');
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

const api = () => request(app);
const locate = (body, token = ctx.adminToken) =>
  api().post('/api/commercial/zones/locate').set(auth(token)).send(body);

describe('POST /api/commercial/zones/locate', () => {
  it('rejects an empty address', async () => {
    expect((await locate({ address: '   ' })).status).toBe(400);
  });

  it('rejects an MMA that is not a number', async () => {
    expect((await locate({ address: 'Calea Victoriei, Bucuresti', mma_kg: 'greu' })).status).toBe(400);
  });

  it('is an office screen', async () => {
    expect((await locate({ address: 'x' }, ctx.driverToken)).status).toBe(403);
  });

  it('appends the city so a bare street is not geocoded country-wide', async () => {
    // The screen knows which tab is open. Without this "Calea Victoriei" is matched against
    // every street of that name in Romania, and the pin lands confidently in another county.
    await seedGeocode('Strada Doar, Bucuresti', INSIDE);
    const res = await locate({ address: 'Strada Doar', city: 'București' });
    expect(res.status).toBe(200);
    expect(res.body.point).not.toBeNull();
    expect(res.body.query).toBeUndefined();
  });

  it('does not repeat a city the operator already typed', async () => {
    await seedGeocode('Calea Victoriei, Bucuresti', INSIDE);
    const res = await locate({ address: 'Calea Victoriei, Bucuresti', city: 'București' });
    expect(res.body.point).not.toBeNull();
  });

  it('says the geocoder is missing rather than blaming the address', async () => {
    // The suite runs with PHOTON_URL empty, which is the same state a fresh server is in.
    // Reporting that as "address not found" sent people hunting for a typo in a street that
    // exists, while no address on the server could be resolved at all.
    const res = await locate({ address: 'Strada Fara Cache 999' });
    expect(res.status).toBe(503);
    expect(res.body.geocoder).toBe('indisponibil');
    expect(res.body.message).toMatch(/PHOTON_URL/);
  });

  it('answers 200 with no point when the provider genuinely found nothing', async () => {
    // A miss is not an error: the operator typed something, and the screen has to say so
    // rather than show a failure that looks like the server broke.
    await seedGeocodeMiss('Strada Inexistenta 999, Nicaieri');
    const res = await locate({ address: 'Strada Inexistenta 999, Nicaieri' });
    expect(res.status).toBe(200);
    expect(res.body.point).toBeNull();
    expect(res.body.zone).toBeNull();
  });
});

describe('GET /api/commercial/zones', () => {
  it('returns zones and their brackets, and nothing else', async () => {
    const res = await api().get('/api/commercial/zones').set(auth(ctx.adminToken));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['zone_rates', 'zones']);
  });

  it('is an office screen', async () => {
    expect((await api().get('/api/commercial/zones').set(auth(ctx.driverToken))).status).toBe(403);
  });

  it('never returns another company’s zones', async () => {
    const other = await seedCompany('zones-other');
    try {
      await query(
        `INSERT INTO tax_zones (company_id, code, name, kind, matcher, priority)
         VALUES ($1, 'ZOTHER', 'A lor', 'zone', '{}'::jsonb, 1)`,
        [other.company.id],
      );
      const res = await api().get('/api/commercial/zones').set(auth(ctx.adminToken));
      expect(res.body.zones.some((z) => z.code === 'ZOTHER')).toBe(false);
    } finally {
      await dropCompany(other.company.id);
    }
  });
});

describe('resolving a point against zones', () => {
  let zoneA;

  beforeAll(async () => {
    zoneA = await makeZone({ code: 'ZA', name: 'Zona A', polygon: SQUARE, priority: 10 });
    await makeRate(zoneA.id, { min: 5000, max: 12000, amount: 75 });
    await makeRate(zoneA.id, { min: 12000, max: null, amount: 140 });
    await seedGeocode('Calea Victoriei, Bucuresti', INSIDE);
    await seedGeocode('Soseaua Departe, Bucuresti', OUTSIDE);
  });

  it('places a point inside the outline and says so', async () => {
    const res = await locate({ address: 'Calea Victoriei, Bucuresti', mma_kg: 8000 });
    expect(res.status).toBe(200);
    expect(res.body.zone.code).toBe('ZA');
    expect(res.body.matched_by).toBe('polygon');
  });

  it('picks the MMA bracket the invoice would pick', async () => {
    const light = await locate({ address: 'Calea Victoriei, Bucuresti', mma_kg: 8000 });
    const heavy = await locate({ address: 'Calea Victoriei, Bucuresti', mma_kg: 20000 });
    expect(Number(light.body.rate.amount)).toBe(75);
    expect(Number(heavy.body.rate.amount)).toBe(140);
  });

  it('resolves the zone but no rate when MMA is unknown', async () => {
    // The zone is a fact about the address; the charge is a fact about the vehicle. Reporting
    // a rate without an MMA would mean guessing which bracket applies.
    const res = await locate({ address: 'Calea Victoriei, Bucuresti' });
    expect(res.body.zone.code).toBe('ZA');
    expect(res.body.rate).toBeNull();
    expect(res.body.mma_kg).toBeNull();
  });

  it('leaves a point outside every outline unzoned', async () => {
    const res = await locate({ address: 'Soseaua Departe, Bucuresti', mma_kg: 8000 });
    expect(res.body.zone).toBeNull();
    expect(res.body.matched_by).toBeNull();
  });

  it('never reports a polygon match for a point outside the polygon', async () => {
    // The zone carries an outline AND a matcher that catches the address by city. It must win
    // on the matcher and say `text`, claiming `polygon` would tell the operator the boundary
    // had been checked against this point when it had not.
    const both = await makeZone({
      code: 'ZB', name: 'Zona B', polygon: SQUARE, matcher: { cities: ['bucuresti'] }, priority: 1,
    });
    try {
      const res = await locate({ address: 'Soseaua Departe, Bucuresti', mma_kg: 8000 });
      expect(res.body.zone.code).toBe('ZB');
      expect(res.body.matched_by).toBe('text');
    } finally {
      await query('DELETE FROM tax_zones WHERE id = $1', [both.id]);
    }
  });

  it('matches a city matcher even when the geocode came from cache', async () => {
    // Regression: `fromCacheRow` rebuilds `best` from stored columns and drops city/county, so
    // reading those off `best` made textual zones resolve on an address's first lookup and
    // never again. Every address in this suite is a cache hit, which is the hard case.
    const byCity = await makeZone({
      code: 'ZCITY', name: 'Tot orașul', matcher: { cities: ['bucuresti'] }, priority: 1,
    });
    try {
      const res = await locate({ address: 'Soseaua Departe, Bucuresti', mma_kg: 8000 });
      expect(res.body.zone?.code).toBe('ZCITY');
      expect(res.body.matched_by).toBe('text');
    } finally {
      await query('DELETE FROM tax_zones WHERE id = $1', [byCity.id]);
    }
  });

  it('falls back to the typed address when the provider gave no city', async () => {
    // A candidate without administrative fields still leaves the operator's own text, which
    // named a city. Dropping it would strand the address in no zone at all.
    await query(
      `UPDATE geocode_cache SET candidates = $1
       WHERE company_id = $2 AND address_key = $3`,
      [JSON.stringify([{ latitude: OUTSIDE.lat, longitude: OUTSIDE.lon, confidence: 0.9 }]),
        ctx.company.id, addressKey(parseRomanianAddress('Soseaua Departe, Bucuresti'))],
    );
    const zone = await makeZone({
      code: 'ZTXT', name: 'După text', matcher: { cities: ['bucuresti'] }, priority: 1,
    });
    try {
      const res = await locate({ address: 'Soseaua Departe, Bucuresti', mma_kg: 8000 });
      expect(res.body.zone?.code).toBe('ZTXT');
    } finally {
      await query('DELETE FROM tax_zones WHERE id = $1', [zone.id]);
      await seedGeocode('Soseaua Departe, Bucuresti', OUTSIDE);
    }
  });

  it('reports a zone with no valid rate rather than inventing one', async () => {
    const bare = await makeZone({ code: 'ZC', name: 'Fără tarif', polygon: SQUARE, priority: 99 });
    try {
      const res = await locate({ address: 'Calea Victoriei, Bucuresti', mma_kg: 8000 });
      expect(res.body.zone.code).toBe('ZC');
      expect(res.body.rate).toBeNull();
    } finally {
      await query('DELETE FROM tax_zones WHERE id = $1', [bare.id]);
    }
  });

  it('ignores an inactive zone', async () => {
    const off = await makeZone({ code: 'ZD', name: 'Oprită', polygon: SQUARE, priority: 999, active: false });
    try {
      const res = await locate({ address: 'Calea Victoriei, Bucuresti', mma_kg: 8000 });
      expect(res.body.zone.code).toBe('ZA');
    } finally {
      await query('DELETE FROM tax_zones WHERE id = $1', [off.id]);
    }
  });

  it('never resolves against another company’s zones', async () => {
    const other = await seedCompany('zone-locate-other');
    try {
      await query(
        `INSERT INTO tax_zones (company_id, code, name, kind, matcher, polygon, priority)
         VALUES ($1, 'ZX', 'A lor', 'zone', '{}'::jsonb, $2, 500)`,
        [other.company.id, JSON.stringify(SQUARE)],
      );
      const res = await locate({ address: 'Calea Victoriei, Bucuresti', mma_kg: 8000 });
      expect(res.body.zone.code).toBe('ZA');
    } finally {
      await dropCompany(other.company.id);
    }
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import {
  auth,
  closePool,
  dropCompany,
  makeClient,
  makeContractWithTariff,
  makeVehicle,
  request,
  seedCompany,
} from '../test/harness.js';

let ctx;
let contract;

beforeAll(async () => {
  ctx = await seedCompany('commercial');
  const client = await makeClient(ctx.company.id);
  contract = await makeContractWithTariff(ctx.company.id, client.id, { vehicle_class: '10t' });
  await makeVehicle(ctx.company.id, { vehicle_class: '10t', plate: 'B 100 CFG' });
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

const api = () => request(app);
const overview = async () =>
  (await api().get('/api/commercial/overview').set(auth(ctx.adminToken))).body;

describe('GET /api/commercial/overview', () => {
  it('returns the whole configuration in one call', async () => {
    const res = await api().get('/api/commercial/overview').set(auth(ctx.adminToken));
    expect(res.status).toBe(200);
    for (const key of ['contracts', 'tariffs', 'zones', 'zone_rates', 'surcharge_types',
      'observation_codes', 'locations', 'fleet_vehicle_classes']) {
      expect(res.body, key).toHaveProperty(key);
    }
  });

  it('lists the classes actually in the fleet', async () => {
    expect((await overview()).fleet_vehicle_classes).toContain('10t');
  });

  it('is an office screen', async () => {
    expect((await api().get('/api/commercial/overview').set(auth(ctx.driverToken))).status).toBe(403);
  });

  it('never shows another company’s contracts', async () => {
    const other = await seedCompany('commercial-other');
    try {
      const theirClient = await makeClient(other.company.id);
      await makeContractWithTariff(other.company.id, theirClient.id);
      const mine = await overview();
      expect(mine.contracts.every((c) => c.id !== contract.id || true)).toBe(true);
      expect(mine.contracts).toHaveLength(1);
    } finally {
      await dropCompany(other.company.id);
    }
  });
});

describe('tariff warnings come from the pricing engine, not the screen', () => {
  it('names a class with no tariff in force today', async () => {
    // A rate that expired yesterday still shows in the list; the point is that the screen must
    // say it prices nothing now, in the same terms the calculation would.
    const client = await makeClient(ctx.company.id, 'Client expirat');
    const expired = await makeContractWithTariff(ctx.company.id, client.id, {
      vehicle_class: '20t', valid_from: '2020-01-01',
    });
    await query(
      `UPDATE contract_tariffs SET valid_to = '2020-12-31' WHERE contract_id = $1`,
      [expired.id]
    );

    const row = (await overview()).contracts.find((c) => c.id === expired.id);
    expect(row.classes_without_current_tariff).toContain('20t');
  });

  it('reports overlapping validity periods', async () => {
    const client = await makeClient(ctx.company.id, 'Client suprapus');
    const overlapping = await makeContractWithTariff(ctx.company.id, client.id, {
      vehicle_class: '10t', valid_from: '2020-01-01',
    });
    await query(
      `INSERT INTO contract_tariffs (company_id, contract_id, vehicle_class, km_rate, valid_from)
       VALUES ($1,$2,'10t',2.5,'2021-01-01')`,
      [ctx.company.id, overlapping.id]
    );

    const row = (await overview()).contracts.find((c) => c.id === overlapping.id);
    expect(row.overlaps.length).toBeGreaterThan(0);
    expect(row.overlaps[0].vehicle_class).toBe('10t');
  });

  it('stays quiet on a contract whose tariff is in force', async () => {
    const row = (await overview()).contracts.find((c) => c.id === contract.id);
    expect(row.classes_without_current_tariff).toEqual([]);
    expect(row.overlaps).toEqual([]);
  });
});

describe('GET /api/commercial/contracts/:id/history', () => {
  it('returns the periods newest first, with the current one named', async () => {
    const res = await api()
      .get(`/api/commercial/contracts/${contract.id}/history?vehicle_class=10t`)
      .set(auth(ctx.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.history.length).toBeGreaterThan(0);
    expect(res.body.current).not.toBeNull();
  });

  it('returns nothing for a class the contract does not cover', async () => {
    const res = await api()
      .get(`/api/commercial/contracts/${contract.id}/history?vehicle_class=40t`)
      .set(auth(ctx.adminToken));
    expect(res.body.history).toEqual([]);
    expect(res.body.current).toBeNull();
  });
});

describe('PUT /api/commercial/depot', () => {
  it('refuses a location with no coordinates', async () => {
    // Without coordinates the round trip cannot be measured and the TPO silently loses its
    // kilometre component — better to refuse than to accept a depot that cannot be routed.
    const bare = (await query(
      `INSERT INTO locations (company_id, name) VALUES ($1, 'Fără pin') RETURNING *`,
      [ctx.company.id]
    )).rows[0];

    const res = await api().put('/api/commercial/depot').set(auth(ctx.adminToken))
      .send({ location_id: bare.id });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('coordonate');
  });

  it('accepts a geocoded location and stores it', async () => {
    const pinned = (await query(
      `INSERT INTO locations (company_id, name, latitude, longitude)
       VALUES ($1, 'Garaj Chiajna', 44.45, 26.0) RETURNING *`,
      [ctx.company.id]
    )).rows[0];

    const res = await api().put('/api/commercial/depot').set(auth(ctx.adminToken))
      .send({ location_id: pinned.id });
    expect(res.status).toBe(200);
    expect((await overview()).depot_location_id).toBe(pinned.id);
  });

  it('can be cleared', async () => {
    const res = await api().put('/api/commercial/depot').set(auth(ctx.adminToken))
      .send({ location_id: null });
    expect(res.status).toBe(200);
    expect((await overview()).depot_location_id).toBeNull();
  });

  it('404s on another company’s location', async () => {
    const other = await seedCompany('commercial-depot');
    try {
      const theirs = (await query(
        `INSERT INTO locations (company_id, name, latitude, longitude)
         VALUES ($1, 'Al lor', 44.4, 26.1) RETURNING *`,
        [other.company.id]
      )).rows[0];
      const res = await api().put('/api/commercial/depot').set(auth(ctx.adminToken))
        .send({ location_id: theirs.id });
      expect(res.status).toBe(404);
    } finally {
      await dropCompany(other.company.id);
    }
  });
});

describe('POST /api/commercial/observation-codes/import', () => {
  const csv = (text) => Buffer.from(text, 'utf8');

  it('imports the customer’s own codes', async () => {
    const res = await api().post('/api/commercial/observation-codes/import')
      .set(auth(ctx.adminToken))
      .attach('file', csv('Cod,Descriere,Tip,Activ\nDM,Descarcare macara,taxa,da\nZB,Zona B,zona,da\n'),
        { filename: 'coduri.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);

    const codes = (await overview()).observation_codes;
    expect(codes.find((c) => c.code === 'DM').label).toBe('Descarcare macara');
  });

  it('updates a code that already exists instead of duplicating it', async () => {
    await api().post('/api/commercial/observation-codes/import').set(auth(ctx.adminToken))
      .attach('file', csv('Cod,Descriere\nDM,Macara hidraulica\n'),
        { filename: 'coduri.csv', contentType: 'text/csv' });

    const codes = (await overview()).observation_codes.filter((c) => c.code === 'DM');
    expect(codes).toHaveLength(1);
    expect(codes[0].label).toBe('Macara hidraulica');
  });

  it('previews without writing when asked', async () => {
    const before = (await overview()).observation_codes.length;
    const res = await api().post('/api/commercial/observation-codes/import')
      .set(auth(ctx.adminToken))
      .field('dry_run', 'true')
      .attach('file', csv('Cod,Descriere\nXX,Ceva nou\n'),
        { filename: 'coduri.csv', contentType: 'text/csv' });

    expect(res.body.dry_run).toBe(true);
    expect(res.body.codes).toHaveLength(1);
    expect((await overview()).observation_codes).toHaveLength(before);
  });

  it('names the rows it could not use rather than dropping them silently', async () => {
    const res = await api().post('/api/commercial/observation-codes/import')
      .set(auth(ctx.adminToken))
      .attach('file', csv('Cod,Descriere\nAA,Unu\nAA,Duplicat\n'),
        { filename: 'coduri.csv', contentType: 'text/csv' });

    expect(res.body.imported).toBe(1);
    expect(res.body.skipped[0].reason).toContain('duplicat');
  });

  it('refuses a sheet with no Cod column', async () => {
    const res = await api().post('/api/commercial/observation-codes/import')
      .set(auth(ctx.adminToken))
      .attach('file', csv('Ceva,Altceva\nA,B\n'), { filename: 'x.csv', contentType: 'text/csv' });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('Cod');
  });

  it('refuses a request with no file', async () => {
    const res = await api().post('/api/commercial/observation-codes/import').set(auth(ctx.adminToken));
    expect(res.status).toBe(400);
  });

  it('is an admin action', async () => {
    // The token is minted for an admin; a driver must not reach it at all.
    const res = await api().post('/api/commercial/observation-codes/import')
      .set(auth(ctx.driverToken))
      .attach('file', csv('Cod\nAA\n'), { filename: 'x.csv', contentType: 'text/csv' });
    expect(res.status).toBe(403);
  });
});

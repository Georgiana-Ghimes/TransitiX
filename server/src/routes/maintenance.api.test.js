import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import {
  auth,
  closePool,
  dropCompany,
  makeVehicle,
  request,
  seedCompany,
} from '../test/harness.js';
import { runRetention } from '../lib/maintenance/retention.js';

let ctx;
let vehicle;

beforeAll(async () => {
  ctx = await seedCompany('retention');
  vehicle = await makeVehicle(ctx.company.id);
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

const api = () => request(app);

/** A GPS ping recorded `days` ago. */
async function ping(days) {
  return (await query(
    `INSERT INTO telematics_positions
       (company_id, vehicle_id, latitude, longitude, recorded_at)
     VALUES ($1, $2, 45.1, 24.1, NOW() - ($3::int || ' days')::interval) RETURNING id`,
    [ctx.company.id, vehicle.id, days]
  )).rows[0];
}

const countPings = async () => (await query(
  'SELECT COUNT(*)::int c FROM telematics_positions WHERE company_id = $1', [ctx.company.id]
)).rows[0].c;

describe('the policies are visible before they run', () => {
  it('lists what would be removed and what never is', async () => {
    const res = await api().get('/api/maintenance/retention').set(auth(ctx.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.policies.map((p) => p.id)).toContain('telematics_positions');
    // A screen that shows only what gets deleted is missing the more reassuring half.
    expect(res.body.never_pruned.map((n) => n.table)).toContain('aviz_export_log');
  });

  it('counts rows without deleting them', async () => {
    await ping(200);
    const before = await countPings();

    const res = await api().get('/api/maintenance/retention').set(auth(ctx.adminToken));
    const policy = res.body.policies.find((p) => p.id === 'telematics_positions');
    expect(policy.rows).toBeGreaterThanOrEqual(1);
    expect(policy.error).toBeUndefined();
    expect(await countPings()).toBe(before);
  });

  it('every policy query actually runs against the real schema', async () => {
    // A policy naming a column that does not exist would otherwise fail silently at 3am.
    const res = await api().get('/api/maintenance/retention').set(auth(ctx.adminToken));
    for (const policy of res.body.policies) {
      expect(policy.error, `${policy.id}: ${policy.error}`).toBeUndefined();
      expect(typeof policy.rows).toBe('number');
    }
  });

  it('describes the configured policy without hitting the database', async () => {
    const res = await api().get('/api/maintenance/retention/policies').set(auth(ctx.adminToken));
    expect(res.status).toBe(200);
    const gps = res.body.policies.find((p) => p.id === 'telematics_positions');
    expect(gps.days).toBe(90);
    expect(gps.env).toBe('RETAIN_TELEMATICS_POSITIONS_DAYS');
  });
});

describe('running it', () => {
  it('removes what is past the window and keeps what is not', async () => {
    const old = await ping(400);
    const recent = await ping(3);

    const res = await api().post('/api/maintenance/retention/run')
      .set(auth(ctx.adminToken)).send({});
    expect(res.status).toBe(200);

    const survivors = await query(
      'SELECT id FROM telematics_positions WHERE id = ANY($1::uuid[])', [[old.id, recent.id]]
    );
    expect(survivors.rows.map((r) => r.id)).toEqual([recent.id]);
  });

  it('honours the batch and says when more is left', async () => {
    for (let i = 0; i < 3; i += 1) await ping(300 + i);

    const res = await api().post('/api/maintenance/retention/run')
      .set(auth(ctx.adminToken)).send({ batch: 1 });
    expect(res.status).toBe(200);

    const gps = res.body.results.find((r) => r.id === 'telematics_positions');
    expect(gps.deleted).toBe(1);
    // The answer to a backlog is another pass, not a bigger lock.
    expect(gps.more).toBe(true);
    expect(res.body.more).toBe(true);
  });

  it('reports nothing deleted when nothing is old', async () => {
    await api().post('/api/maintenance/retention/run').set(auth(ctx.adminToken)).send({});
    const res = await api().post('/api/maintenance/retention/run')
      .set(auth(ctx.adminToken)).send({});
    expect(res.body.results.find((r) => r.id === 'telematics_positions').deleted).toBe(0);
  });

  it('never reports an error for a policy', async () => {
    const res = await api().post('/api/maintenance/retention/run')
      .set(auth(ctx.adminToken)).send({});
    for (const result of res.body.results) {
      expect(result.error, `${result.id}: ${result.error}`).toBeUndefined();
    }
  });

  it('leaves the protected tables alone', async () => {
    const before = (await query('SELECT COUNT(*)::int c FROM aviz_export_log')).rows[0].c;
    await runRetention({ batch: 10, overrides: {} });
    expect((await query('SELECT COUNT(*)::int c FROM aviz_export_log')).rows[0].c).toBe(before);
  });

  it('keeps the current position of a truck that has not moved', async () => {
    // Age alone would blank a parked vehicle off the live map.
    const stale = (await query(
      `INSERT INTO gps_logs (company_id, vehicle_id, latitude, longitude, is_current, created_at)
       VALUES ($1, $2, 45.2, 24.2, TRUE, NOW() - INTERVAL '400 days') RETURNING id`,
      [ctx.company.id, vehicle.id]
    )).rows[0];

    await runRetention({ batch: 100 });
    const found = await query('SELECT id FROM gps_logs WHERE id = $1', [stale.id]);
    expect(found.rowCount).toBe(1);
  });
});

describe('who may run it', () => {
  it('refuses a driver', async () => {
    const res = await api().get('/api/maintenance/retention').set(auth(ctx.driverToken));
    expect(res.status).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    expect((await api().post('/api/maintenance/retention/run').send({})).status).toBe(401);
  });
});

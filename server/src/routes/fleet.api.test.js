import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import { auth, closePool, dropCompany, makeVehicle, request, seedCompany } from '../test/harness.js';

let ctx;

beforeAll(async () => {
  ctx = await seedCompany('fleet');
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

const api = () => request(app);

describe('GET /api/fleet', () => {
  it('pages active vehicles and reports missing MTMA across the filter', async () => {
    await makeVehicle(ctx.company.id, { plate: `B-100-FLT`, mma_kg: 19000 });
    await makeVehicle(ctx.company.id, { plate: `B-101-FLT`, mma_kg: null });
    const inactive = await makeVehicle(ctx.company.id, { plate: `B-102-FLT`, mma_kg: null });
    await query(`UPDATE vehicles SET is_active = FALSE WHERE id = $1`, [inactive.id]);

    const res = await api().get('/api/fleet')
      .query({ q: 'FLT', limit: 1, offset: 0 })
      .set(auth(ctx.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(1);
    expect(res.body.total).toBe(2);
    expect(res.body.missing_mma).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].plate).toMatch(/FLT/);
    expect(res.body.items.every((v) => v.is_active !== false)).toBe(true);
  });
});

describe('POST /api/fleet/bulk-delete', () => {
  it('deletes only the selected vehicles for the company', async () => {
    const a = await makeVehicle(ctx.company.id, { plate: `B-200-DEL` });
    const b = await makeVehicle(ctx.company.id, { plate: `B-201-DEL` });
    const keep = await makeVehicle(ctx.company.id, { plate: `B-202-KEEP` });

    const res = await api().post('/api/fleet/bulk-delete').set(auth(ctx.adminToken))
      .send({ ids: [a.id, b.id] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);

    const gone = await query(
      `SELECT id FROM vehicles WHERE id = ANY($1::uuid[])`,
      [[a.id, b.id]]
    );
    expect(gone.rows).toHaveLength(0);
    const still = await query(`SELECT id FROM vehicles WHERE id = $1`, [keep.id]);
    expect(still.rows).toHaveLength(1);
  });

  it('refuses an empty selection', async () => {
    const res = await api().post('/api/fleet/bulk-delete').set(auth(ctx.adminToken))
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it('deletes every vehicle matching the search when all_matching', async () => {
    const tag = `ALL-${Date.now()}`;
    const a = await makeVehicle(ctx.company.id, { plate: `B-400-${tag}` });
    const b = await makeVehicle(ctx.company.id, { plate: `B-401-${tag}` });
    const keep = await makeVehicle(ctx.company.id, { plate: `B-402-KEEP` });

    const res = await api().post('/api/fleet/bulk-delete').set(auth(ctx.adminToken))
      .send({ all_matching: true, q: tag });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);

    const gone = await query(
      `SELECT id FROM vehicles WHERE id = ANY($1::uuid[])`,
      [[a.id, b.id]]
    );
    expect(gone.rows).toHaveLength(0);
    const still = await query(`SELECT id FROM vehicles WHERE id = $1`, [keep.id]);
    expect(still.rows).toHaveLength(1);
  });

  it('does not delete another company\'s vehicles', async () => {
    const other = await seedCompany('fleet-bulk');
    try {
      const foreign = await makeVehicle(other.company.id, { plate: `B-300-X` });
      const res = await api().post('/api/fleet/bulk-delete').set(auth(ctx.adminToken))
        .send({ ids: [foreign.id] });
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(0);
      const still = await query(`SELECT id FROM vehicles WHERE id = $1`, [foreign.id]);
      expect(still.rows).toHaveLength(1);
    } finally {
      await dropCompany(other.company.id);
    }
  });
});

describe('GET /api/fleet/ids', () => {
  it('returns every matching id, not just one page', async () => {
    const tag = `IDS-${Date.now()}`;
    const a = await makeVehicle(ctx.company.id, { plate: `B-500-${tag}` });
    const b = await makeVehicle(ctx.company.id, { plate: `B-501-${tag}` });

    const res = await api().get('/api/fleet/ids')
      .query({ q: tag })
      .set(auth(ctx.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.ids.sort()).toEqual([a.id, b.id].sort());
  });
});

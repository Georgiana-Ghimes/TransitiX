import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import { auth, closePool, dropCompany, request, seedCompany } from '../test/harness.js';

let ctx;
beforeAll(async () => { ctx = await seedCompany('vehicle-put'); });
afterAll(async () => { await dropCompany(ctx?.company?.id); await closePool(); });

const api = () => request(app);

describe('saving MTMA from the Autoturisme screen', () => {
  it('accepts exactly what the screen sends', async () => {
    const v = await query(
      `INSERT INTO vehicles (company_id, plate, added_by_ocr, is_active)
       VALUES ($1, 'B-112-VFM', TRUE, TRUE) RETURNING *`,
      [ctx.company.id],
    );
    const res = await api()
      .put(`/api/entities/Vehicle/${v.rows[0].id}`)
      .set(auth(ctx.adminToken))
      .send({ mma_kg: 26000, added_by_ocr: false });
    if (res.status !== 200) console.log('EROARE', res.status, JSON.stringify(res.body));
    expect(res.status).toBe(200);
    expect(Number(res.body.mma_kg)).toBe(26000);
    expect(res.body.added_by_ocr).toBe(false);
  });
});

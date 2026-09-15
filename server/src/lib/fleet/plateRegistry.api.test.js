/**
 * The plate registry: a lorry on an aviz becomes a record with an MTMA field.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, query } from '../../db.js';
import {
  ensureVehicleForPlate, mmaForPlate, primaryPlate, vehiclesMissingMma,
} from './plateRegistry.js';
import { closePool, dropCompany, seedCompany } from '../../test/harness.js';

let ctx;

beforeAll(async () => {
  ctx = await seedCompany('plate-registry');
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

const register = (numarAuto) => ensureVehicleForPlate(pool, ctx.company.id, numarAuto);
const wipe = () => query('DELETE FROM vehicles WHERE company_id = $1', [ctx.company.id]);

describe('primaryPlate', () => {
  it('takes the tractor, not the trailer', () => {
    // An articulated vehicle is taxed on the combination MTMA, which is on the tractor
    // registration. Opening a record for the trailer would ask for a figure it does not have.
    expect(primaryPlate('B-112-VFM / B-475-AGR')).toBe('B-112-VFM');
  });

  it('normalises whatever spelling it was given', () => {
    expect(primaryPlate('b 112 vfm')).toBe('B-112-VFM');
  });

  it('is null when there is no plate to speak of', () => {
    expect(primaryPlate('')).toBeNull();
    expect(primaryPlate(null)).toBeNull();
  });
});

describe('ensureVehicleForPlate', () => {
  it('opens a record the first time and finds it afterwards', async () => {
    await wipe();
    const first = await register('B-112-VFM / B-475-AGR');
    expect(first.created).toBe(true);
    expect(first.vehicle.plate).toBe('B-112-VFM');
    expect(first.vehicle.added_by_ocr).toBe(true);
    expect(first.vehicle.mma_kg).toBeNull();

    const again = await register('B-112-VFM');
    expect(again.created).toBe(false);
    expect(again.vehicle.id).toBe(first.vehicle.id);
  });

  it('recognises the same lorry however the aviz spelled it', async () => {
    await wipe();
    const created = await register('B 112 VFM');
    const found = await register('b-112-vfm');
    expect(found.created).toBe(false);
    expect(found.vehicle.id).toBe(created.vehicle.id);
  });

  it('opens one record when the same lorry arrives twice at once', async () => {
    // Two documents in a batch routinely carry the same plate. Without the company-row lock
    // both transactions see no vehicle and both insert one.
    await wipe();
    const [a, b] = await Promise.all([register('B-200-AAA'), register('B-200-AAA')]);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    const rows = await query(
      'SELECT id FROM vehicles WHERE company_id = $1 AND plate = $2', [ctx.company.id, 'B-200-AAA'],
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('does not open a lorry out of OCR prose', async () => {
    // canonicalPlate hands unrecognised text back unchanged so the backfill cannot destroy the
    // fleet's non-standard entries, which means prose reaches here intact. A phantom vehicle
    // asks for an MTMA forever, and an alert nobody can clear is one everybody ignores.
    await wipe();
    for (const junk of ['330 SRS FOOTY STREAM', 'CONTROL POARTA', 'B-900-DEMO', '']) {
      expect((await register(junk)).vehicle, junk).toBeNull();
    }
    expect((await query('SELECT id FROM vehicles WHERE company_id = $1', [ctx.company.id])).rows)
      .toHaveLength(0);
  });

  it('never touches a vehicle the office had already entered', async () => {
    await wipe();
    const own = await query(
      `INSERT INTO vehicles (company_id, plate, brand, model, mma_kg)
       VALUES ($1, 'B-300-BBB', 'MAN', 'TGX', 40000) RETURNING *`,
      [ctx.company.id],
    );
    const found = await register('B 300 BBB');
    expect(found.created).toBe(false);
    expect(found.vehicle.id).toBe(own.rows[0].id);
    expect(Number(found.vehicle.mma_kg)).toBe(40000);
    expect(found.vehicle.added_by_ocr).toBe(false);
  });
});

describe('what still needs an MTMA', () => {
  it('lists the vehicles that cannot produce a zone tax', async () => {
    await wipe();
    await register('B-112-VFM');
    await query(
      `INSERT INTO vehicles (company_id, plate, mma_kg) VALUES ($1, 'B-400-CCC', 26000)`,
      [ctx.company.id],
    );
    const missing = await vehiclesMissingMma(pool, ctx.company.id);
    expect(missing.map((v) => v.plate)).toEqual(['B-112-VFM']);
  });

  it('leaves a retired lorry out of it', async () => {
    // Chasing the MTMA of something off the road is noise, and the alert would grow with the
    // fleet history rather than with the work outstanding.
    await wipe();
    await query(
      `INSERT INTO vehicles (company_id, plate, is_active) VALUES ($1, 'B-500-DDD', FALSE)`,
      [ctx.company.id],
    );
    expect(await vehiclesMissingMma(pool, ctx.company.id)).toEqual([]);
  });
});

describe('mmaForPlate', () => {
  it('finds the figure the zone tax is charged on', async () => {
    await wipe();
    await query(
      `INSERT INTO vehicles (company_id, plate, mma_kg) VALUES ($1, 'B-112-VFM', 40000)`,
      [ctx.company.id],
    );
    expect(await mmaForPlate(pool, ctx.company.id, 'B-112-VFM / B-475-AGR')).toBe(40000);
  });

  it('is null while nobody has filled it in', async () => {
    // Null has to stay null: a guessed MTMA picks a tariff bracket, and the brackets are
    // hundreds of lei apart.
    await wipe();
    await register('B-112-VFM');
    expect(await mmaForPlate(pool, ctx.company.id, 'B-112-VFM')).toBeNull();
  });

  it('is null for a lorry nobody has seen', async () => {
    await wipe();
    expect(await mmaForPlate(pool, ctx.company.id, 'B-999-ZZZ')).toBeNull();
  });
});

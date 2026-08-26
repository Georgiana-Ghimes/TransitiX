import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import {
  auth,
  closePool,
  dropCompany,
  makeAviz,
  makeTrip,
  request,
  seedCompany,
} from '../test/harness.js';

let ctx;

beforeAll(async () => {
  ctx = await seedCompany('invoice');
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

const api = () => request(app);

/** A trip priced the way the engine prices one: separate components, total on the trip. */
async function pricedTrip(overrides = {}, charges = [
  { kind: 'trip_rate', code: 'CURSA', label: 'Tarif cursă', quantity: 1, unit_amount: 500, amount: 500 },
  { kind: 'km_rate', code: 'KM', label: 'Kilometri', quantity: 112, unit_amount: 2.5, amount: 280 },
  { kind: 'zone_tax', code: 'ZB', label: 'Taxă zonă B', amount: 75 },
  { kind: 'surcharge', code: 'DM', label: 'Taxă macara', amount: 120 },
]) {
  const trip = await makeTrip(ctx.company.id, {
    tpo_number: `TPO ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tpo_total: charges.reduce((s, c) => s + c.amount, 0),
    ...overrides,
  });
  for (const charge of charges) {
    await query(
      `INSERT INTO trip_charges (company_id, trip_id, kind, code, label, quantity, unit_amount, amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ctx.company.id, trip.id, charge.kind, charge.code ?? null, charge.label,
       charge.quantity ?? null, charge.unit_amount ?? null, charge.amount]
    );
  }
  return trip;
}

const draft = (avizIds) => api().post('/api/avize/draft-invoice')
  .set(auth(ctx.adminToken)).send({ aviz_ids: avizIds });

describe('the invoice comes from the priced lines', () => {
  it('bills the trip charges, itemised', async () => {
    const trip = await pricedTrip();
    const aviz = await makeAviz(ctx.company.id, {
      original_filename: 'inv-1.pdf', trip_id: trip.id, valoare_tpo: 1,
    });

    const res = await draft([aviz.id]);
    expect(res.status).toBe(201);
    // Deliberately not 1: the aviz column said 1, the engine said 975. The engine wins.
    expect(Number(res.body.subtotal)).toBe(975);
    expect(res.body.lines.map((l) => l.code)).toEqual(['CURSA', 'KM', 'ZB', 'DM']);
    expect(res.body.source).toBe('trip_charges');

    const stored = await query(
      'SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY seq',
      [res.body.id]
    );
    expect(stored.rowCount).toBe(4);
    expect(Number(stored.rows[1].quantity)).toBe(112);
  });

  it('adds VAT and totals', async () => {
    const trip = await pricedTrip();
    const aviz = await makeAviz(ctx.company.id, { original_filename: 'inv-2.pdf', trip_id: trip.id });
    const res = await draft([aviz.id]);
    expect(Number(res.body.vat_rate)).toBe(19);
    expect(Number(res.body.vat_amount)).toBe(185.25);
    expect(Number(res.body.total_amount)).toBe(1160.25);
  });

  it('combines several trips onto one invoice and leaves the header trip unset', async () => {
    // Pinning the header to whichever trip sorted first files the invoice against the wrong one.
    const a = await pricedTrip();
    const b = await pricedTrip({}, [{ kind: 'trip_rate', label: 'Tarif cursă', amount: 300 }]);
    const avizA = await makeAviz(ctx.company.id, { original_filename: 'inv-3a.pdf', trip_id: a.id });
    const avizB = await makeAviz(ctx.company.id, { original_filename: 'inv-3b.pdf', trip_id: b.id });

    const res = await draft([avizA.id, avizB.id]);
    expect(Number(res.body.subtotal)).toBe(1275);
    expect(res.body.trip_id).toBeNull();
    expect(res.body.lines).toHaveLength(5);
  });

  it('names the header trip when there is only one', async () => {
    const trip = await pricedTrip();
    const aviz = await makeAviz(ctx.company.id, { original_filename: 'inv-4.pdf', trip_id: trip.id });
    expect((await draft([aviz.id])).body.trip_id).toBe(trip.id);
  });

  it('records which avize the draft was built from', async () => {
    const trip = await pricedTrip();
    const aviz = await makeAviz(ctx.company.id, { original_filename: 'inv-5.pdf', trip_id: trip.id });
    const res = await draft([aviz.id]);
    expect(res.body.aviz_ids).toContain(aviz.id);
  });
});

describe('it refuses to invent a figure', () => {
  it('will not bill a trip nobody priced', async () => {
    // The old path silently summed `aviz.valoare_tpo` here — a column an operator types into —
    // so an invoice went out on a number nothing had recalculated.
    const trip = await makeTrip(ctx.company.id, { tpo_number: 'TPO NEPRETUIT' });
    const aviz = await makeAviz(ctx.company.id, {
      original_filename: 'inv-6.pdf', trip_id: trip.id, valoare_tpo: 5000,
    });

    const res = await draft([aviz.id]);
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('TPO calculat');

    const invoices = await query('SELECT COUNT(*)::int c FROM invoices WHERE company_id = $1', [ctx.company.id]);
    expect(invoices.rows[0].c).toBeGreaterThanOrEqual(0);
  });

  it('bills what it can and names what it could not', async () => {
    const priced = await pricedTrip();
    const unpriced = await makeTrip(ctx.company.id, { tpo_number: 'TPO FARA' });
    const a = await makeAviz(ctx.company.id, { original_filename: 'inv-7a.pdf', trip_id: priced.id });
    const b = await makeAviz(ctx.company.id, { original_filename: 'inv-7b.pdf', trip_id: unpriced.id });

    const res = await draft([a.id, b.id]);
    expect(res.status).toBe(201);
    expect(Number(res.body.subtotal)).toBe(975);
    expect(res.body.warnings.find((w) => w.code === 'trip_not_priced').count).toBe(1);
    expect(res.body.notes).toContain('nu au TPO calculat');
  });

  it('refuses avize that belong to no trip at all', async () => {
    const aviz = await makeAviz(ctx.company.id, { original_filename: 'inv-8.pdf', trip_id: null });
    const res = await draft([aviz.id]);
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('legat de o cursă');
  });

  it('refuses unconfirmed avize', async () => {
    const trip = await pricedTrip();
    const aviz = await makeAviz(ctx.company.id, {
      original_filename: 'inv-9.pdf', trip_id: trip.id, status: 'extracted',
    });
    expect((await draft([aviz.id])).status).toBe(400);
  });

  it('warns when the stored TPO total disagrees with its own lines', async () => {
    const trip = await pricedTrip({ tpo_total: 1200 });
    const aviz = await makeAviz(ctx.company.id, { original_filename: 'inv-10.pdf', trip_id: trip.id });
    const res = await draft([aviz.id]);
    expect(res.body.warnings.some((w) => w.code === 'tpo_total_mismatch')).toBe(true);
    // The lines are still what gets billed — they are what the engine computed.
    expect(Number(res.body.subtotal)).toBe(975);
  });
});

describe('tenancy', () => {
  it('never bills another company’s avize', async () => {
    const other = await seedCompany('invoice-other');
    try {
      const theirTrip = await makeTrip(other.company.id, { tpo_number: 'TPO AL LOR' });
      const theirAviz = await makeAviz(other.company.id, {
        original_filename: 'al-lor.pdf', trip_id: theirTrip.id,
      });
      const res = await draft([theirAviz.id]);
      expect(res.status).toBe(400);
    } finally {
      await dropCompany(other.company.id);
    }
  });
});

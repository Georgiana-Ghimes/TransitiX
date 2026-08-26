import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import {
  auth,
  closePool,
  dropCompany,
  makeAviz,
  makeClient,
  makeContractWithTariff,
  makeTrip,
  makeVehicle,
  request,
  seedCompany,
} from '../test/harness.js';

let ctx;
let vehicle;
let noTariffContract;
let goodContract;

beforeAll(async () => {
  ctx = await seedCompany('validation');
  const client = await makeClient(ctx.company.id);
  vehicle = await makeVehicle(ctx.company.id, { vehicle_class: '10t' });
  noTariffContract = await makeContractWithTariff(ctx.company.id, client.id, null);
  goodContract = await makeContractWithTariff(ctx.company.id, client.id, { vehicle_class: '10t' });
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

const api = () => request(app);
const findings = async (params = '') =>
  (await api().get(`/api/validation/findings${params}`).set(auth(ctx.adminToken))).body;
const rulesFor = (body, subjectId) =>
  body.findings.filter((f) => f.subject?.id === subjectId).map((f) => f.rule);

describe('GET /api/validation/rules', () => {
  it('explains every rule the engine can raise', async () => {
    const res = await api().get('/api/validation/rules').set(auth(ctx.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.rules.every((r) => r.label && r.consequence && r.fix)).toBe(true);
  });

  it('is an office screen', async () => {
    expect((await api().get('/api/validation/rules').set(auth(ctx.driverToken))).status).toBe(403);
  });
});

describe('trip findings', () => {
  it('raises an error for a trip billed with no tariff valid on its date', async () => {
    const trip = await makeTrip(ctx.company.id, {
      vehicle_id: vehicle.id, contract_id: noTariffContract.id,
      tpo_total: 250, tpo_calculated_at: new Date().toISOString(), distance_km: 40,
    });
    await query(`INSERT INTO trip_charges (company_id, trip_id, kind, label, amount)
                 VALUES ($1,$2,'manual','L',250)`, [ctx.company.id, trip.id]);

    const found = await findings();
    const raised = found.findings.find((f) => f.subject?.id === trip.id && f.rule === 'trip_no_tariff');
    expect(raised.severity).toBe('error');
    expect(raised.message).toContain('10t');
  });

  it('stays quiet on a trip whose contract covers it', async () => {
    const trip = await makeTrip(ctx.company.id, {
      vehicle_id: vehicle.id, contract_id: goodContract.id,
      tpo_total: 250, tpo_calculated_at: new Date().toISOString(), distance_km: 40,
    });
    await query(`INSERT INTO trip_charges (company_id, trip_id, kind, label, amount)
                 VALUES ($1,$2,'manual','L',250)`, [ctx.company.id, trip.id]);
    expect(rulesFor(await findings(), trip.id)).toEqual([]);
  });

  it('raises an error when the TPO total is not the sum of its lines', async () => {
    const trip = await makeTrip(ctx.company.id, {
      vehicle_id: vehicle.id, contract_id: goodContract.id,
      tpo_total: 400, tpo_calculated_at: new Date().toISOString(), distance_km: 40,
    });
    await query(`INSERT INTO trip_charges (company_id, trip_id, kind, label, amount)
                 VALUES ($1,$2,'manual','L',350)`, [ctx.company.id, trip.id]);
    const raised = (await findings()).findings
      .find((f) => f.subject?.id === trip.id && f.rule === 'tpo_total_mismatch');
    expect(raised.severity).toBe('error');
    expect(raised.message).toContain('400.00');
  });

  it('warns about a priced trip with no distance', async () => {
    const trip = await makeTrip(ctx.company.id, {
      vehicle_id: vehicle.id, contract_id: goodContract.id,
      tpo_total: 250, tpo_calculated_at: new Date().toISOString(), distance_km: null,
    });
    await query(`INSERT INTO trip_charges (company_id, trip_id, kind, label, amount)
                 VALUES ($1,$2,'manual','L',250)`, [ctx.company.id, trip.id]);
    expect(rulesFor(await findings(), trip.id)).toContain('trip_no_distance');
  });

  it('warns when a delivered trip has a digital CMR nobody closed', async () => {
    const trip = await makeTrip(ctx.company.id, {
      vehicle_id: vehicle.id, contract_id: goodContract.id, status: 'livrata',
    });
    await query(
      `INSERT INTO trip_documents (company_id, trip_id, source, signed_loading_at)
       VALUES ($1,$2,'digital', NOW())`,
      [ctx.company.id, trip.id]
    );
    expect(rulesFor(await findings(), trip.id)).toContain('cmr_unsigned');
  });

  it('never fires that on a company working from paper CMRs', async () => {
    const trip = await makeTrip(ctx.company.id, {
      vehicle_id: vehicle.id, contract_id: goodContract.id, status: 'livrata',
    });
    await query(
      `INSERT INTO trip_documents (company_id, trip_id, source, original_image_url)
       VALUES ($1,$2,'scan','/uploads/cmr.jpg')`,
      [ctx.company.id, trip.id]
    );
    expect(rulesFor(await findings(), trip.id)).not.toContain('cmr_unsigned');
  });
});

describe('document findings', () => {
  it('warns about a confirmed aviz with no weighing and no trip', async () => {
    const doc = await makeAviz(ctx.company.id, {
      original_filename: 'fara-cantar.pdf', gross_weight_kg: null, trip_id: null,
    });
    const raised = rulesFor(await findings(), doc.id);
    expect(raised).toContain('document_no_weight');
    expect(raised).toContain('document_unlinked');
  });

  it('names a document by its file, so duplicates can be told apart', async () => {
    const a = await makeAviz(ctx.company.id, { original_filename: 'dubla-a.pdf', numar_tpo: 'TPO DUP-1' });
    await makeAviz(ctx.company.id, { original_filename: 'dubla-b.pdf', numar_tpo: 'TPO DUP-1' });
    const found = await findings();
    const unlinked = found.findings.filter((f) => f.rule === 'document_unlinked' && f.subject.id === a.id);
    expect(unlinked[0].subject.label).toBe('dubla-a.pdf');
    expect(found.findings.some((f) => f.rule === 'document_duplicate_tpo')).toBe(true);
  });
});

describe('dismissal', () => {
  it('hides a finding, and the summary follows the list', async () => {
    const before = await findings();
    const target = before.findings.find((f) => f.severity === 'error');

    const res = await api().post('/api/validation/findings/dismiss')
      .set(auth(ctx.adminToken)).send({ key: target.key });
    expect(res.status).toBe(200);

    const after = await findings();
    expect(after.findings.some((f) => f.key === target.key)).toBe(false);
    expect(after.dismissed_count).toBeGreaterThan(0);
    // The header must not claim a problem that is no longer on screen.
    expect(after.summary.total).toBe(after.findings.length);
    expect(after.summary.by_severity.error).toBe(
      after.findings.filter((f) => f.severity === 'error').length
    );

    const withHidden = await findings('?include_dismissed=true');
    expect(withHidden.findings.some((f) => f.key === target.key)).toBe(true);
  });

  it('rejects a dismissal with no key', async () => {
    const res = await api().post('/api/validation/findings/dismiss')
      .set(auth(ctx.adminToken)).send({});
    expect(res.status).toBe(400);
  });
});

describe('tenancy', () => {
  it('never reports another company’s data', async () => {
    const other = await seedCompany('validation-other');
    try {
      await makeAviz(other.company.id, { original_filename: 'strain.pdf', gross_weight_kg: null });
      const mine = await findings();
      expect(mine.findings.some((f) => f.subject?.label === 'strain.pdf')).toBe(false);
    } finally {
      await dropCompany(other.company.id);
    }
  });
});

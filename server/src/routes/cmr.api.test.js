import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import { auth, closePool, dropCompany, makeTrip, request, seedCompany } from '../test/harness.js';

/** A 1×1 PNG — enough for the signature store to accept and write. */
const INK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
  + 'AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const LOADED = {
  numar_colete: 18,
  natura_marfii: 'Mortar uscat',
  greutate_bruta_kg: 9000,
};

let ctx;
let trip;

beforeAll(async () => {
  ctx = await seedCompany('cmr');
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

beforeEach(async () => {
  trip = await makeTrip(ctx.company.id, { driver_id: ctx.driver.id, status: 'incarcata' });
});

const api = () => request(app);
const signLoading = (token, extra = {}) => api()
  .post(`/api/cmr/trips/${trip.id}/sign`)
  .set(auth(token))
  .send({
    stage: 'incarcare',
    data: LOADED,
    signatures: { semnatura_expeditor: INK, semnatura_transportator: INK },
    ...extra,
  });

describe('GET /api/cmr/trips/:tripId', () => {
  it('prefills the boxes the office already filled in', async () => {
    const res = await api().get(`/api/cmr/trips/${trip.id}`).set(auth(ctx.driverToken));
    expect(res.status).toBe(200);
    expect(res.body.data.expeditor).toContain('Baumit Romania SRL');
    expect(res.body.data.destinatar).toContain('Depozit Chiajna SRL');
    expect(res.body.data.greutate_bruta_kg).toBe(9000);
  });

  it('reads the loading date as a local calendar day', async () => {
    // pg hands a DATE back as local midnight; the UTC form lands on the day before east of
    // Greenwich, and the note would carry the wrong date.
    const dated = await makeTrip(ctx.company.id, {
      driver_id: ctx.driver.id, loading_date: '2026-03-10',
    });
    const res = await api().get(`/api/cmr/trips/${dated.id}`).set(auth(ctx.driverToken));
    expect(res.body.data.loc_data_incarcare).toContain('2026-03-10');
    expect(res.body.data.intocmit_data).toBe('2026-03-10');
  });

  it('hides another driver’s trip behind a 404, not a 403', async () => {
    // A 403 would confirm the trip exists, which is not theirs to learn.
    const res = await api().get(`/api/cmr/trips/${trip.id}`).set(auth(ctx.otherDriverToken));
    expect(res.status).toBe(404);
  });

  it('lets the office read any trip', async () => {
    expect((await api().get(`/api/cmr/trips/${trip.id}`).set(auth(ctx.adminToken))).status).toBe(200);
  });

  it('404s across companies', async () => {
    const other = await seedCompany('cmr-other');
    try {
      const res = await api().get(`/api/cmr/trips/${trip.id}`).set(auth(other.adminToken));
      expect(res.status).toBe(404);
    } finally {
      await dropCompany(other.company.id);
    }
  });
});

describe('PUT /api/cmr/trips/:tripId', () => {
  it('saves a draft without signing it', async () => {
    const res = await api().put(`/api/cmr/trips/${trip.id}`).set(auth(ctx.driverToken))
      .send({ data: { rezerve_incarcare: 'Doi saci rupți' } });
    expect(res.status).toBe(200);
    expect(res.body.data.rezerve_incarcare).toBe('Doi saci rupți');
    expect(res.body.stages.incarcare.signed_at).toBeNull();
  });

  it('ignores fields that are not CMR boxes', async () => {
    await api().put(`/api/cmr/trips/${trip.id}`).set(auth(ctx.driverToken))
      .send({ data: { natura_marfii: 'Adeziv', is_confirmed: true, company_id: 'altcineva' } });
    const row = (await query('SELECT * FROM trip_documents WHERE trip_id = $1', [trip.id])).rows[0];
    expect(row.is_confirmed).toBe(false);
    expect(row.company_id).toBe(ctx.company.id);
  });

  it('refuses to edit a note that was signed at delivery', async () => {
    await signLoading(ctx.driverToken);
    await api().post(`/api/cmr/trips/${trip.id}/sign`).set(auth(ctx.driverToken))
      .send({ stage: 'livrare', signatures: { semnatura_destinatar: INK } });
    const res = await api().put(`/api/cmr/trips/${trip.id}`).set(auth(ctx.driverToken))
      .send({ data: { natura_marfii: 'altceva' } });
    expect(res.status).toBe(409);
  });

  it('refuses the digital form when the trip already carries a scan', async () => {
    await query(
      `INSERT INTO trip_documents (company_id, trip_id, source, original_image_url)
       VALUES ($1, $2, 'scan', '/uploads/cmr.jpg')`,
      [ctx.company.id, trip.id]
    );
    const res = await api().put(`/api/cmr/trips/${trip.id}`).set(auth(ctx.driverToken))
      .send({ data: { natura_marfii: 'X' } });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/cmr/trips/:tripId/sign', () => {
  it('refuses to sign a loading with no weight, and names the box', async () => {
    const res = await api().post(`/api/cmr/trips/${trip.id}/sign`).set(auth(ctx.driverToken))
      .send({
        stage: 'incarcare',
        data: { ...LOADED, greutate_bruta_kg: null },
        signatures: { semnatura_expeditor: INK, semnatura_transportator: INK },
      });
    expect(res.status).toBe(422);
    expect(res.body.missing.map((m) => m.id)).toContain('greutate_bruta_kg');
  });

  it('validates the merged document, not just what was posted', async () => {
    // Everything is already in the draft; the sign call carries only the signatures.
    await api().put(`/api/cmr/trips/${trip.id}`).set(auth(ctx.driverToken)).send({ data: LOADED });
    const res = await api().post(`/api/cmr/trips/${trip.id}/sign`).set(auth(ctx.driverToken))
      .send({
        stage: 'incarcare',
        signatures: { semnatura_expeditor: INK, semnatura_transportator: INK },
      });
    expect(res.status).toBe(200);
  });

  it('cannot be signed by posting only a signature when the trip carries nothing', async () => {
    // A trip the office left empty gives the prefill nothing to work with, so the boxes really
    // are missing and the server has to say so rather than trust the payload.
    const bare = await makeTrip(ctx.company.id, {
      driver_id: ctx.driver.id, gross_weight_kg: null, package_count: null,
      goods_description: null,
    });
    const res = await api().post(`/api/cmr/trips/${bare.id}/sign`).set(auth(ctx.driverToken))
      .send({
        stage: 'incarcare',
        signatures: { semnatura_expeditor: INK, semnatura_transportator: INK },
      });
    expect(res.status).toBe(422);
    expect(res.body.missing.map((m) => m.id)).toEqual(
      expect.arrayContaining(['numar_colete', 'natura_marfii', 'greutate_bruta_kg'])
    );
  });

  it('signs straight through when the office already filled the trip in', async () => {
    // The prefill is a real answer, not a placeholder: if the TMS knows the weight and the
    // goods, the driver has nothing left to type at the ramp.
    const res = await api().post(`/api/cmr/trips/${trip.id}/sign`).set(auth(ctx.driverToken))
      .send({
        stage: 'incarcare',
        signatures: { semnatura_expeditor: INK, semnatura_transportator: INK },
      });
    expect(res.status).toBe(200);
    expect(res.body.data.greutate_bruta_kg).toBe(9000);
  });

  it('stores each signature as an upload and keeps the draft', async () => {
    await api().put(`/api/cmr/trips/${trip.id}`).set(auth(ctx.driverToken))
      .send({ data: { rezerve_incarcare: 'Palet deteriorat' } });
    const res = await signLoading(ctx.driverToken);
    expect(res.status).toBe(200);
    expect(res.body.signatures.semnatura_expeditor).toMatch(/^\/uploads\//);
    expect(res.body.signatures.semnatura_transportator).toMatch(/^\/uploads\//);
    expect(res.body.data.rezerve_incarcare).toBe('Palet deteriorat');
    expect(res.body.stages.incarcare.signed_at).toBeTruthy();
    expect(res.body.source).toBe('digital');
  });

  it('refuses the delivery signature before the loading one', async () => {
    const res = await api().post(`/api/cmr/trips/${trip.id}/sign`).set(auth(ctx.driverToken))
      .send({ stage: 'livrare', signatures: { semnatura_destinatar: INK } });
    expect(res.status).toBe(409);
  });

  it('closes and confirms the note at delivery', async () => {
    await signLoading(ctx.driverToken);
    const res = await api().post(`/api/cmr/trips/${trip.id}/sign`).set(auth(ctx.driverToken))
      .send({ stage: 'livrare', signatures: { semnatura_destinatar: INK } });
    expect(res.status).toBe(200);
    expect(res.body.document.is_confirmed).toBe(true);
    expect(res.body.stages.livrare.signed_at).toBeTruthy();
  });

  it('never redraws a signature that was already given', async () => {
    const first = await signLoading(ctx.driverToken);
    const url = first.body.signatures.semnatura_expeditor;
    const again = await signLoading(ctx.driverToken);
    expect(again.body.signatures.semnatura_expeditor).toBe(url);
  });

  it('rejects an unknown stage', async () => {
    const res = await api().post(`/api/cmr/trips/${trip.id}/sign`).set(auth(ctx.driverToken))
      .send({ stage: 'inventat' });
    expect(res.status).toBe(400);
  });

  it('rejects a signature that is not an image', async () => {
    const res = await api().post(`/api/cmr/trips/${trip.id}/sign`).set(auth(ctx.driverToken))
      .send({
        stage: 'incarcare',
        data: LOADED,
        signatures: { semnatura_expeditor: 'nu-i imagine', semnatura_transportator: INK },
      });
    expect(res.status).toBe(400);
  });

  it('will not let another driver sign someone else’s trip', async () => {
    expect((await signLoading(ctx.otherDriverToken)).status).toBe(404);
  });
});

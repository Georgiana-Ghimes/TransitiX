import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import { auth, closePool, dropCompany, makeTrip, request, seedCompany } from '../test/harness.js';

/** A minimal PDF body — the pipeline only needs bytes and a mimetype here. */
const PDF = Buffer.from('%PDF-1.4 test\n%%EOF\n');

let ctx;
let trip;

beforeAll(async () => {
  ctx = await seedCompany('driverdocs');
  trip = await makeTrip(ctx.company.id, { driver_id: ctx.driver.id, status: 'incarcata' });
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

const api = () => request(app);
const upload = (token, tripId, filename, type = 'aviz') => api()
  .post('/api/driver-documents')
  .set(auth(token))
  .field('trip_id', tripId)
  .field('document_type', type)
  .attach('files', PDF, { filename, contentType: 'application/pdf' });

describe('POST /api/driver-documents', () => {
  it('puts a photo from the road into the office review queue', async () => {
    const res = await upload(ctx.driverToken, trip.id, 'cantar.pdf');
    expect(res.status).toBe(201);
    expect(res.body.batch.created_from).toBe('driver');
    expect(res.body.batch.trip_id).toBe(trip.id);
    expect(res.body.documents[0]).toMatchObject({
      uploaded_from: 'driver', status: 'uploaded', needs_review: true, trip_id: trip.id,
    });
  });

  it('reuses one batch per trip, so the office reviews the paperwork together', async () => {
    const first = await upload(ctx.driverToken, trip.id, 'a.pdf');
    const second = await upload(ctx.driverToken, trip.id, 'b.pdf');
    expect(second.body.batch.id).toBe(first.body.batch.id);
    expect(second.body.batch.file_count).toBeGreaterThan(first.body.batch.file_count);
  });

  it('starts a new batch once the previous one is confirmed', async () => {
    const first = await upload(ctx.driverToken, trip.id, 'c.pdf');
    await query(`UPDATE document_batches SET status = 'confirmed' WHERE id = $1`, [first.body.batch.id]);
    const second = await upload(ctx.driverToken, trip.id, 'd.pdf');
    expect(second.body.batch.id).not.toBe(first.body.batch.id);
  });

  it('never lets a background extraction un-confirm a batch', async () => {
    // Driver uploads kick OCR off in the background. A confirmation landing while the last page
    // is still being read must not be reverted when it finishes.
    const uploaded = await upload(ctx.driverToken, trip.id, 'cursa-inchisa.pdf');
    const batchId = uploaded.body.batch.id;
    await query(`UPDATE document_batches SET status = 'confirmed' WHERE id = $1`, [batchId]);

    const { extractBatchDocuments } = await import('./documents.js');
    await extractBatchDocuments(ctx.company.id, batchId, ctx.adminUserId ?? ctx.driverUser.id, { force: true });

    const after = await query('SELECT status FROM document_batches WHERE id = $1', [batchId]);
    expect(after.rows[0].status).toBe('confirmed');
  });

  it('makes the batch visible to the office through the normal documents screen', async () => {
    const uploaded = await upload(ctx.driverToken, trip.id, 'vizibil.pdf');
    const batch = await api().get(`/api/documents/batches/${uploaded.body.batch.id}`)
      .set(auth(ctx.adminToken));
    expect(batch.status).toBe(200);
    expect(batch.body.documents.some((d) => d.original_filename === 'vizibil.pdf')).toBe(true);
  });

  it('records who sent it and from where', async () => {
    const uploaded = await upload(ctx.driverToken, trip.id, 'urma.pdf');
    const events = await query(
      `SELECT kind, detail, user_id FROM document_events WHERE document_id = $1`,
      [uploaded.body.documents[0].id]
    );
    expect(events.rows[0].kind).toBe('uploaded');
    expect(events.rows[0].user_id).toBe(ctx.driverUser.id);
    expect(events.rows[0].detail.from).toBe('driver');
  });

  it('allows upload without a trip so the office can link later', async () => {
    const res = await api().post('/api/driver-documents').set(auth(ctx.driverToken))
      .field('document_type', 'aviz')
      .attach('files', PDF, { filename: 'fara-cursa.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.batch.trip_id).toBeNull();
    expect(res.body.batch.created_from).toBe('driver');
    expect(res.body.documents[0]).toMatchObject({
      uploaded_from: 'driver', trip_id: null, needs_review: true,
    });
  });

  it('refuses a trip that is not this driver’s', async () => {
    expect((await upload(ctx.otherDriverToken, trip.id, 'strain.pdf')).status).toBe(404);
  });

  it('refuses a trip in another company', async () => {
    const other = await seedCompany('driverdocs-other');
    try {
      expect((await upload(other.driverToken, trip.id, 'alta-firma.pdf')).status).toBe(404);
    } finally {
      await dropCompany(other.company.id);
    }
  });

  it('refuses a request with no file', async () => {
    const res = await api().post('/api/driver-documents').set(auth(ctx.driverToken))
      .field('trip_id', trip.id);
    expect(res.status).toBe(400);
  });

  it('refuses a file type that is neither an image nor a PDF', async () => {
    const res = await api().post('/api/driver-documents').set(auth(ctx.driverToken))
      .field('trip_id', trip.id)
      .attach('files', Buffer.from('rm -rf /'), { filename: 'x.sh', contentType: 'text/x-sh' });
    expect(res.status).toBe(400);
  });

  it('needs authentication', async () => {
    const res = await api().post('/api/driver-documents')
      .field('trip_id', trip.id)
      .attach('files', PDF, { filename: 'anonim.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/driver-documents', () => {
  it('lists recent uploads by this driver', async () => {
    await upload(ctx.driverToken, trip.id, 'al-meu.pdf');
    const res = await api().get('/api/driver-documents').set(auth(ctx.driverToken));
    expect(res.status).toBe(200);
    expect(res.body.documents.some((d) => d.original_filename === 'al-meu.pdf')).toBe(true);
  });
});

describe('GET /api/driver-documents/trips/:tripId', () => {
  it('lists what the driver already sent for the trip', async () => {
    await upload(ctx.driverToken, trip.id, 'listat.pdf');
    const res = await api().get(`/api/driver-documents/trips/${trip.id}`).set(auth(ctx.driverToken));
    expect(res.status).toBe(200);
    expect(res.body.documents.some((d) => d.original_filename === 'listat.pdf')).toBe(true);
    expect(res.body.max_files).toBeGreaterThan(0);
  });

  it('does not list another driver’s trip', async () => {
    const res = await api().get(`/api/driver-documents/trips/${trip.id}`)
      .set(auth(ctx.otherDriverToken));
    expect(res.status).toBe(404);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import { auth, closePool, dropCompany, makeTrip, request, seedCompany } from '../test/harness.js';

/** A minimal PDF body, the pipeline only needs bytes and a mimetype here. */
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

    const notif = await query(
      `SELECT type, title, message, link, trip_id FROM office_notifications
       WHERE company_id = $1 AND type = 'driver_upload'
       ORDER BY created_at DESC LIMIT 1`,
      [ctx.company.id]
    );
    expect(notif.rows[0]).toMatchObject({
      type: 'driver_upload',
      link: '/avize',
      trip_id: null,
    });
    expect(notif.rows[0].message).toMatch(/fără cursă/i);
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

  /**
   * Multer answers `Unexpected field` past the array limit. A driver reading that learns neither
   * what went wrong nor what the limit is.
   */
  it('names the file limit in Romanian instead of multer’s wording', async () => {
    let req = api().post('/api/driver-documents').set(auth(ctx.driverToken))
      .field('trip_id', trip.id).field('document_type', 'aviz');
    for (let i = 0; i < 9; i += 1) {
      req = req.attach('files', PDF, { filename: `p${i}.pdf`, contentType: 'application/pdf' });
    }
    const res = await req;
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Prea multe fișiere/);
    expect(res.body.message).toContain('8');
    expect(res.body.message).not.toMatch(/unexpected field/i);
  });

  it('refuses a request with no file', async () => {
    const res = await api().post('/api/driver-documents').set(auth(ctx.driverToken))
      .field('trip_id', trip.id);
    expect(res.status).toBe(400);
  });

  /**
   * #47 — Admin already splits multi-PSL PDFs; the cab must produce the same N rows.
   * Text-layer TRO/PSL per page (same planner as `materializePdfPageFiles`).
   */
  it('splits a multi-page PDF with distinct PSL into one row per aviz', async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    for (let i = 0; i < 3; i += 1) {
      if (i) doc.addPage();
      doc.text(`Aviz PSL-${String(5601000 + i).padStart(7, '0')}`, 10, 10);
    }
    const body = Buffer.from(doc.output(), 'latin1');

    const res = await api().post('/api/driver-documents').set(auth(ctx.driverToken))
      .field('trip_id', trip.id)
      .field('document_type', 'aviz')
      .attach('files', body, {
        filename: 'aviz-multi-psl.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(201);
    expect(res.body.split_pages).toBe(3);
    expect(res.body.documents).toHaveLength(3);
    expect(res.body.documents.every((d) => d.uploaded_from === 'driver')).toBe(true);
    expect(new Set(res.body.documents.map((d) => d.batch_id)).size).toBe(1);

    const rows = await query(
      `SELECT original_filename, uploaded_from FROM aviz_documents
       WHERE company_id = $1 AND batch_id = $2
       ORDER BY original_filename`,
      [ctx.company.id, res.body.batch.id]
    );
    expect(rows.rows.filter((r) => /aviz-multi-psl/i.test(r.original_filename))).toHaveLength(3);
  });

  it('keeps a multi-page PDF as one row when pages share no distinct TRO/PSL', async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    doc.text('Aviz pagina 1', 10, 10);
    doc.addPage();
    doc.text('Aviz pagina 2', 10, 10);
    const body = Buffer.from(doc.output(), 'latin1');

    const res = await api().post('/api/driver-documents').set(auth(ctx.driverToken))
      .field('document_type', 'aviz')
      .attach('files', body, {
        filename: 'un-aviz-doua-pagini.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(201);
    expect(res.body.split_pages).toBeUndefined();
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0].original_filename).toBe('un-aviz-doua-pagini.pdf');
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

describe('POST /api/avize/extract on a document that came in through a batch', () => {
  /**
   * `/avize` lists office scans and driver photos in one table. Re-extract must go through
   * the batch extractor, not a stub path. With OCR_PROVIDER=none (suite default without a
   * Mistral key), background re-extract still must not wipe existing fields with stub.
   */
  it('re-runs the batch extractor instead of stubbing the row', async () => {
    const uploaded = await upload(ctx.driverToken, trip.id, 're-extrage.pdf');
    const docId = uploaded.body.documents[0].id;

    // Stands in for a finished OCR run: fields on the row, raw text in extracted_data.
    await query(
      `UPDATE aviz_documents SET
         status = 'extracted', extraction_source = 'mistral', numar_tpo = 'TPO-0025629',
         extracted_data = $2::jsonb
       WHERE id = $1`,
      [docId, JSON.stringify({
        raw_text: 'Comanda de transport TPO-0025629',
        values: { numar_tpo: 'TPO-0025629' },
      })]
    );

    const res = await api().post('/api/avize/extract').set(auth(ctx.adminToken)).send({ id: docId });
    expect(res.status).toBe(202);
    expect(res.body.extraction_pending).toBe(true);
    expect(res.body.reason).toBe('reextract_background');

    await new Promise((r) => setTimeout(r, 400));
    const after = (await query('SELECT * FROM aviz_documents WHERE id = $1', [docId])).rows[0];
    expect(after.numar_tpo).toBe('TPO-0025629');
    expect(after.status).toBe('extracted');
    expect(after.extraction_source).not.toBe('stub');
  });
});

describe('POST /api/avize/extract when OCR runs long', () => {
  /**
   * Re-extract answers 202 and runs in the background. A Mistral endpoint that never finishes
   * still exhausts the budget and is marked failed — the list must not spin forever.
   */
  const KEYS = [
    'OCR_PROVIDER', 'MISTRAL_API_KEY', 'MISTRAL_API_BASE',
    'OCR_TIMEOUT_MS', 'OCR_INTERACTIVE_TIMEOUT_MS',
  ];
  const saved = {};
  let hanging;

  beforeAll(async () => {
    const http = await import('node:http');
    const { resetOcrCapabilityCache } = await import('../lib/ocr/readText.js');
    hanging = http.createServer((req, res) => {
      const url = req.url || '';
      if (url.startsWith('/v1/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'mistral-ocr-latest' }] }));
        return;
      }
      // /v1/ocr — hang until the client aborts
    });
    await new Promise((resolve) => hanging.listen(0, '127.0.0.1', resolve));
    const port = hanging.address().port;

    for (const key of KEYS) saved[key] = process.env[key];
    process.env.OCR_PROVIDER = 'mistral';
    process.env.MISTRAL_API_KEY = 'test-key';
    process.env.MISTRAL_API_BASE = `http://127.0.0.1:${port}`;
    process.env.OCR_TIMEOUT_MS = '80';
    process.env.OCR_INTERACTIVE_TIMEOUT_MS = '80';
    resetOcrCapabilityCache();
  });

  afterAll(async () => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    const { resetOcrCapabilityCache } = await import('../lib/ocr/readText.js');
    resetOcrCapabilityCache();
    hanging?.closeAllConnections?.();
    await new Promise((resolve) => hanging.close(resolve));
  });

  it('hands a slow read to the background pass without losing what was read before', async () => {
    const uploaded = await api().post('/api/driver-documents').set(auth(ctx.driverToken))
      .field('trip_id', trip.id)
      .field('document_type', 'aviz')
      .attach('files', Buffer.from('poza'), { filename: 'lenta.jpg', contentType: 'image/jpeg' });
    const docId = uploaded.body.documents[0].id;

    await query(
      `UPDATE aviz_documents SET
         status = 'extracted', extraction_source = 'mistral', numar_tpo = 'TPO-0025629'
       WHERE id = $1`,
      [docId]
    );

    const res = await api().post('/api/avize/extract').set(auth(ctx.adminToken)).send({ id: docId });
    expect(res.status).toBe(202);
    expect(res.body.extraction_pending).toBe(true);
    expect(res.body.reason).toBe('reextract_background');
    expect(res.body.numar_tpo).toBe('TPO-0025629');

    await new Promise((r) => setTimeout(r, 400));
    const after = (await query('SELECT * FROM aviz_documents WHERE id = $1', [docId])).rows[0];
    expect(after.numar_tpo).toBe('TPO-0025629');
    expect(after.status).toBe('extracted');
    expect(after.needs_review).toBe(true);
    expect(after.extraction_source).toBe('none');
    expect(after.extracted_data?.extract_error).toMatch(/timpul alocat/i);
  });

  it('sends a text-poor PDF to OCR instead of giving up on it', async () => {
    const uploaded = await upload(ctx.driverToken, trip.id, 'scanata.pdf');
    const docId = uploaded.body.documents[0].id;

    const res = await api().post('/api/avize/extract').set(auth(ctx.adminToken)).send({ id: docId });
    expect(res.status).toBe(202);
    expect(res.body.reason).toBe('reextract_background');
  });
});

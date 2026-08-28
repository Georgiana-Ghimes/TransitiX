import fs from 'fs/promises';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import { uploadRoot } from '../uploadPath.js';
import { auth, closePool, dropCompany, request, seedCompany } from '../test/harness.js';

let ctx;

beforeAll(async () => {
  ctx = await seedCompany('avize');
  await fs.mkdir(uploadRoot, { recursive: true });
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

const api = () => request(app);

/** Puts a file where the extractor will look for it, the way an upload would have. */
async function placeUpload(name, body = '%PDF-1.4 test\n%%EOF\n') {
  await fs.writeFile(path.join(uploadRoot, name), body);
  return `/uploads/${name}`;
}

/** A real PDF of `pages` pages — pdf-parse has to be able to count them. */
async function placeMultiPagePdf(name, pages) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  for (let i = 0; i < pages; i += 1) {
    if (i) doc.addPage();
    doc.text(`Aviz pagina ${i + 1}`, 10, 10);
  }
  // `output()` gives a latin1 string; the arraybuffer form comes back unreadable to pdf-parse.
  await fs.writeFile(path.join(uploadRoot, name), Buffer.from(doc.output(), 'latin1'));
  return `/uploads/${name}`;
}

describe('POST /api/avize/extract', () => {
  /**
   * The avize screen uploads a file and asks for it to be read in one call. There is one
   * extractor now, and it works per batch, so the row it creates has to belong to one —
   * otherwise nothing would ever read it again.
   */
  it('files a freshly uploaded aviz into a batch and extracts it', async () => {
    const fileUrl = await placeUpload(`aviz-nou-${Date.now()}.pdf`);
    const res = await api().post('/api/avize/extract').set(auth(ctx.adminToken))
      .send({ file_url: fileUrl, original_filename: 'aviz-nou.pdf' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.status).toBe('extracted');

    const row = (await query(
      'SELECT batch_id, uploaded_from FROM aviz_documents WHERE id = $1', [res.body.id]
    )).rows[0];
    expect(row.batch_id).toBeTruthy();

    const events = await query(
      `SELECT kind FROM document_events WHERE document_id = $1 ORDER BY created_at`, [res.body.id]
    );
    expect(events.rows.map((e) => e.kind)).toContain('uploaded');
  });

  it('re-extracts a row that predates batches by giving it one', async () => {
    const fileUrl = await placeUpload(`aviz-vechi-${Date.now()}.pdf`);
    const legacy = (await query(
      `INSERT INTO aviz_documents (company_id, file_url, original_filename, status, numar_tpo)
       VALUES ($1, $2, 'aviz-vechi.pdf', 'extracted', 'TPO-0011111') RETURNING id, batch_id`,
      [ctx.company.id, fileUrl]
    )).rows[0];
    expect(legacy.batch_id).toBeNull();

    const res = await api().post('/api/avize/extract').set(auth(ctx.adminToken))
      .send({ id: legacy.id });
    expect(res.status).toBe(200);

    const after = (await query(
      'SELECT batch_id, numar_tpo FROM aviz_documents WHERE id = $1', [legacy.id]
    )).rows[0];
    expect(after.batch_id).toBeTruthy();
    // Nothing was read out of the fixture, so the figure already on the row must survive.
    expect(after.numar_tpo).toBe('TPO-0011111');
  });

  /**
   * Every page is a full OCR pass. Holding the request open for a dossier would time out on a
   * document that is perfectly readable, so past a few pages the work goes to the background.
   */
  it('hands a long document to the background instead of blocking the request', async () => {
    const fileUrl = await placeMultiPagePdf(`dosar-${Date.now()}.pdf`, 12);
    const res = await api().post('/api/avize/extract').set(auth(ctx.adminToken))
      .send({ file_url: fileUrl, original_filename: 'dosar.pdf' });

    expect(res.status).toBe(202);
    expect(res.body.extraction_pending).toBe(true);
    expect(res.body.pages).toBe(12);
    expect(res.body.id).toBeTruthy();

    // The row exists and belongs to a batch, so the background pass has something to work on.
    const row = (await query(
      'SELECT batch_id FROM aviz_documents WHERE id = $1', [res.body.id]
    )).rows[0];
    expect(row.batch_id).toBeTruthy();
  });

  it('still extracts a short document while the caller waits', async () => {
    const fileUrl = await placeMultiPagePdf(`scurt-${Date.now()}.pdf`, 2);
    const res = await api().post('/api/avize/extract').set(auth(ctx.adminToken))
      .send({ file_url: fileUrl, original_filename: 'scurt.pdf' });

    expect(res.status).toBe(200);
    expect(res.body.extraction_pending).toBeUndefined();
  });

  it('refuses a request with neither a file nor an id', async () => {
    const res = await api().post('/api/avize/extract').set(auth(ctx.adminToken)).send({});
    expect(res.status).toBe(400);
  });

  it('404s on an aviz from another company', async () => {
    const other = await seedCompany('avize-strain');
    const mine = (await query(
      `INSERT INTO aviz_documents (company_id, file_url, original_filename, status)
       VALUES ($1, '/uploads/x.pdf', 'x.pdf', 'uploaded') RETURNING id`,
      [ctx.company.id]
    )).rows[0];
    const res = await api().post('/api/avize/extract').set(auth(other.adminToken))
      .send({ id: mine.id });
    expect(res.status).toBe(404);
    await dropCompany(other.company.id);
  });
});

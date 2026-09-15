import fs from 'fs/promises';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import { uploadRoot } from '../uploadPath.js';
import { auth, closePool, dropCompany, makeAviz, request, seedCompany } from '../test/harness.js';

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

/** A real PDF of `pages` pages, pdf-parse has to be able to count them. */
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
   * extractor now, and it works per batch, so the row it creates has to belong to one,
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

describe('the list and the export agree about a route', () => {
  // PaddleOCR regularly leaves ruta_transport empty on the row while the route is plainly
  // there in the OCR text. Export repaired it and the list did not, so the same document
  // showed no route on screen and the right one in the XLSX.
  const RAW = [
    'Expeditor: Baumit Romania SRL, Bolintin-Deal',
    'Adresa de livrare',
    'Strada Independentei 121',
    'Domnesti, Ilfov',
    'Client',
    'SC Test SRL',
  ].join('\n');

  async function avizWithoutRoute() {
    const doc = await makeAviz(ctx.company.id, { ruta_transport: null });
    await query(
      `UPDATE aviz_documents SET extracted_data = $1::jsonb WHERE id = $2`,
      [JSON.stringify({ raw_text: RAW, provider: 'paddle' }), doc.id],
    );
    return doc;
  }

  it('shows the route the OCR text carries, not an empty cell', async () => {
    const doc = await avizWithoutRoute();
    try {
      const res = await api().get('/api/avize').set(auth(ctx.adminToken));
      const row = res.body.find((r) => r.id === doc.id);
      expect(row.ruta_transport).toBe('Domnesti/Independentei');
    } finally {
      await query('DELETE FROM aviz_documents WHERE id = $1', [doc.id]);
    }
  });

  it('reports the route as present rather than low confidence', async () => {
    const doc = await avizWithoutRoute();
    try {
      const res = await api().get('/api/avize').set(auth(ctx.adminToken));
      const row = res.body.find((r) => r.id === doc.id);
      expect(row.field_confidence.ruta_transport).toBe('ok');
    } finally {
      await query('DELETE FROM aviz_documents WHERE id = $1', [doc.id]);
    }
  });

  it('never overwrites a route the office typed', async () => {
    const doc = await makeAviz(ctx.company.id, { ruta_transport: 'Ruta de birou' });
    await query(
      `UPDATE aviz_documents SET extracted_data = $1::jsonb WHERE id = $2`,
      [JSON.stringify({ raw_text: RAW, provider: 'paddle' }), doc.id],
    );
    try {
      const res = await api().get('/api/avize').set(auth(ctx.adminToken));
      expect(res.body.find((r) => r.id === doc.id).ruta_transport).toBe('Ruta de birou');
    } finally {
      await query('DELETE FROM aviz_documents WHERE id = $1', [doc.id]);
    }
  });
});

describe('GET /api/avize, un TPO cu mai multe curse', () => {
  /**
   * A TPO is an order and an order can be driven more than once. Flagging every repeated TPO
   * as a duplicate put a double-billing warning on legitimate work, and a warning that fires
   * on the normal case stops being read before it ever meets the abnormal one.
   */
  it('does not call the second cursă of a TPO a duplicate', async () => {
    const tpo = `TPO-MULTI-${Date.now()}`;
    await makeAviz(ctx.company.id, {
      numar_tpo: tpo,
      numar_document_marfa: 'PSL-0044633',
      ruta_transport: 'Bol-Bucuresti/Viilor52',
      data_efectuare_cursa: '2026-08-10',
      numar_auto: 'B-34-BAU',
    });
    await makeAviz(ctx.company.id, {
      numar_tpo: tpo,
      numar_document_marfa: 'PSL-0044701',
      ruta_transport: 'Bol-Bucuresti/IuliuManiu600A',
      data_efectuare_cursa: '2026-08-11',
      numar_auto: 'B-34-BAU',
    });

    const res = await api().get('/api/avize').set(auth(ctx.adminToken));
    expect(res.status).toBe(200);
    const mine = res.body.filter((r) => r.numar_tpo === tpo);
    expect(mine).toHaveLength(2);
    expect(mine.map((r) => r.duplicate_tpo)).toEqual([false, false]);
    // Two rows, two routes, and both say the order was driven twice.
    expect(mine.map((r) => r.numar_curse)).toEqual([2, 2]);
    expect(new Set(mine.map((r) => r.ruta_transport)).size).toBe(2);
  });

  it('still catches the same aviz uploaded twice under that TPO', async () => {
    const tpo = `TPO-DUP-${Date.now()}`;
    for (const name of ['prima.pdf', 'aceeasi-din-greseala.pdf']) {
      await makeAviz(ctx.company.id, {
        numar_tpo: tpo,
        original_filename: name,
        numar_document_marfa: 'PSL-0044633',
        ruta_transport: 'Bol-Bucuresti/Viilor52',
        data_efectuare_cursa: '2026-08-10',
        numar_auto: 'B-34-BAU',
      });
    }

    const res = await api().get('/api/avize').set(auth(ctx.adminToken));
    const mine = res.body.filter((r) => r.numar_tpo === tpo);
    expect(mine).toHaveLength(2);
    expect(mine.map((r) => r.duplicate_tpo)).toEqual([true, true]);
  });
});

describe('PUT /api/entities/AvizDocument, avertismentul de la Salvează', () => {
  /**
   * The single-row check runs against the database rather than against a loaded list, so it is
   * a second implementation of the same question and has to give the same answer. It used to
   * ask only "does another row carry this TPO", which is what put "există deja un aviz cu
   * același TPO" on the screen every time an operator saved the second cursă.
   */
  it('stays quiet when the other row is a different cursă of the same TPO', async () => {
    const tpo = `TPO-SAVE-${Date.now()}`;
    await makeAviz(ctx.company.id, {
      numar_tpo: tpo, numar_document_marfa: 'PSL-0044633',
      ruta_transport: 'Bol-Bucuresti/Viilor52',
      data_efectuare_cursa: '2026-08-10', numar_auto: 'B-34-BAU',
    });
    const second = await makeAviz(ctx.company.id, {
      numar_tpo: tpo, numar_document_marfa: 'PSL-0044701',
      ruta_transport: 'Bol-Bucuresti/IuliuManiu600A',
      data_efectuare_cursa: '2026-08-11', numar_auto: 'B-34-BAU',
    });

    const res = await api().put(`/api/entities/AvizDocument/${second.id}`)
      .set(auth(ctx.adminToken)).send({ km_parcursi: 51 });
    expect(res.status).toBe(200);
    expect(res.body.duplicate_tpo).toBe(false);
  });

  it('warns when the other row is the same aviz', async () => {
    const tpo = `TPO-SAVE-DUP-${Date.now()}`;
    const common = {
      numar_tpo: tpo, numar_document_marfa: 'PSL-0044633',
      ruta_transport: 'Bol-Bucuresti/Viilor52',
      data_efectuare_cursa: '2026-08-10', numar_auto: 'B-34-BAU',
    };
    await makeAviz(ctx.company.id, common);
    const second = await makeAviz(ctx.company.id, common);

    const res = await api().put(`/api/entities/AvizDocument/${second.id}`)
      .set(auth(ctx.adminToken)).send({ km_parcursi: 51 });
    expect(res.status).toBe(200);
    expect(res.body.duplicate_tpo).toBe(true);
  });
});

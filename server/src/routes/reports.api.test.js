import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import app from '../app.js';
import { query } from '../db.js';
import {
  auth,
  closePool,
  dropCompany,
  makeAviz,
  request,
  seedCompany,
} from '../test/harness.js';

let ctx;
let raiTemplate;

beforeAll(async () => {
  ctx = await seedCompany('reports');
  // The default annex is created lazily on first read, the same way the screen gets it.
  const templates = await request(app).get('/api/avize/templates').set(auth(ctx.adminToken));
  raiTemplate = templates.body.find((t) => t.name === 'Anexa Factura RAI');
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

const api = () => request(app);

describe('GET /api/reports/sources', () => {
  it('describes every reportable field for the column picker', async () => {
    const res = await api().get('/api/reports/sources').set(auth(ctx.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.sources.length).toBeGreaterThan(0);
    expect(res.body.sources.every((s) => s.label && s.type)).toBe(true);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await api().get('/api/reports/sources')).status).toBe(401);
  });

  it('refuses a driver — reporting is an office screen', async () => {
    expect((await api().get('/api/reports/sources').set(auth(ctx.driverToken))).status).toBe(403);
  });
});

describe('POST /api/reports/templates/from-preset', () => {
  it('instantiates a preset as an editable template', async () => {
    const res = await api()
      .post('/api/reports/templates/from-preset')
      .set(auth(ctx.adminToken))
      .send({ preset_id: 'baumit_greutati', name: `Baumit ${Date.now()}` });
    expect(res.status).toBe(201);
    expect(res.body.preset_id).toBe('baumit_greutati');
    expect(res.body.columns.some((c) => c.source === 'gross_weight_kg')).toBe(true);
  });

  it('rejects a preset that does not exist', async () => {
    const res = await api()
      .post('/api/reports/templates/from-preset')
      .set(auth(ctx.adminToken))
      .send({ preset_id: 'inventat' });
    expect(res.status).toBe(400);
  });

  it('refuses a duplicate name instead of creating a second one', async () => {
    const name = `Duplicat ${Date.now()}`;
    await api().post('/api/reports/templates/from-preset').set(auth(ctx.adminToken))
      .send({ preset_id: 'centralizator_km', name });
    const again = await api().post('/api/reports/templates/from-preset').set(auth(ctx.adminToken))
      .send({ preset_id: 'centralizator_km', name });
    expect(again.status).toBe(409);
  });
});

describe('POST /api/reports/preview', () => {
  let template;

  beforeAll(async () => {
    const res = await api().post('/api/reports/templates/from-preset').set(auth(ctx.adminToken))
      .send({ preset_id: 'baumit_greutati', name: `Preview ${Date.now()}` });
    template = res.body;
    await makeAviz(ctx.company.id, { original_filename: 'p1.pdf', gross_weight_kg: 9000 });
    await makeAviz(ctx.company.id, { original_filename: 'p2.pdf', gross_weight_kg: null });
  });

  it('refuses a selection with no criteria, which would take the whole archive', async () => {
    const res = await api().post('/api/reports/preview').set(auth(ctx.adminToken))
      .send({ template_id: template.id, filters: {} });
    expect(res.status).toBe(400);
  });

  it('returns rows, totals and warnings without writing anything', async () => {
    const res = await api().post('/api/reports/preview').set(auth(ctx.adminToken))
      .send({ template_id: template.id, filters: { status: 'confirmed' } });
    expect(res.status).toBe(200);
    expect(res.body.row_count).toBe(2);
    expect(res.body.totals.gross_weight_kg.value).toBe(9000);
    // The row with no weighing must not be counted as a zero.
    expect(res.body.totals.gross_weight_kg.missing).toBe(1);

    const history = await api().get('/api/reports/exports').set(auth(ctx.adminToken));
    expect(history.body.total).toBe(0);
  });

  it('warns that a template without a weight column cannot be reconciled', async () => {
    const res = await api().post('/api/reports/preview').set(auth(ctx.adminToken))
      .send({ template_id: raiTemplate.id, filters: { status: 'confirmed' } });
    expect(res.body.warnings.map((w) => w.code)).toContain('weight_not_exported');
  });

  it('404s on a template belonging to nobody', async () => {
    const res = await api().post('/api/reports/preview').set(auth(ctx.adminToken))
      .send({ template_id: '11111111-1111-1111-1111-111111111111', filters: { status: 'confirmed' } });
    expect(res.status).toBe(404);
  });

  it('cannot read another company’s template', async () => {
    const other = await seedCompany('reports-other');
    try {
      const theirs = await request(app).post('/api/reports/templates/from-preset')
        .set(auth(other.adminToken)).send({ preset_id: 'rai_anexa', name: 'Al lor' });
      const res = await api().post('/api/reports/preview').set(auth(ctx.adminToken))
        .send({ template_id: theirs.body.id, filters: { status: 'confirmed' } });
      expect(res.status).toBe(404);
    } finally {
      await dropCompany(other.company.id);
    }
  });
});

describe('POST /api/reports/export', () => {
  let template;

  beforeAll(async () => {
    const res = await api().post('/api/reports/templates/from-preset').set(auth(ctx.adminToken))
      .send({ preset_id: 'baumit_greutati', name: `Export ${Date.now()}` });
    template = res.body;
  });

  it('returns a workbook and records what went into it', async () => {
    const res = await api().post('/api/reports/export').set(auth(ctx.adminToken))
      .send({ template_id: template.id, filters: { status: 'confirmed' }, note: 'Decont test' })
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (c) => chunks.push(c));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('.xlsx');
    expect(res.body.subarray(0, 2).toString()).toBe('PK');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const sheet = wb.worksheets[0];
    // header + two documents + the totals line
    expect(sheet.rowCount).toBe(4);

    const history = await api().get('/api/reports/exports').set(auth(ctx.adminToken));
    expect(history.body.exports[0]).toMatchObject({
      row_count: 2, reproducible: true, note: 'Decont test',
    });
  });

  it('refuses a selection that matches nothing', async () => {
    const res = await api().post('/api/reports/export').set(auth(ctx.adminToken))
      .send({ template_id: template.id, filters: { plate: 'NU EXISTA' } });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/reports/invoice-date', () => {
  it('stamps one billing date across a whole selection', async () => {
    const a = await makeAviz(ctx.company.id, { original_filename: 'fact-a.pdf', numar_auto: 'B 555 FAC' });
    const b = await makeAviz(ctx.company.id, { original_filename: 'fact-b.pdf', numar_auto: 'B 555 FAC' });

    const res = await api().post('/api/reports/invoice-date').set(auth(ctx.adminToken))
      .send({ filters: { plate: 'B 555 FAC' }, data_facturare: '2026-03-31' });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);

    const rows = await query(
      'SELECT id, data_facturare, data_efectuare_cursa FROM aviz_documents WHERE id = ANY($1::uuid[])',
      [[a.id, b.id]]
    );
    for (const row of rows.rows) {
      expect(row.data_facturare).not.toBeNull();
      // The trip date is deliberately untouched: the tariff is read as of the day the trip ran,
      // and moving it to match an invoice would silently reprice the line.
      expect(row.data_efectuare_cursa).not.toBeNull();
      expect(String(row.data_facturare)).not.toBe(String(row.data_efectuare_cursa));
    }
  });

  it('can clear the date again', async () => {
    await makeAviz(ctx.company.id, { original_filename: 'fact-c.pdf', numar_auto: 'B 556 FAC' });
    await api().post('/api/reports/invoice-date').set(auth(ctx.adminToken))
      .send({ filters: { plate: 'B 556 FAC' }, data_facturare: '2026-03-31' });

    const res = await api().post('/api/reports/invoice-date').set(auth(ctx.adminToken))
      .send({ filters: { plate: 'B 556 FAC' }, data_facturare: null });
    expect(res.status).toBe(200);
    const rows = await query(
      `SELECT data_facturare FROM aviz_documents WHERE company_id = $1 AND numar_auto = 'B 556 FAC'`,
      [ctx.company.id]
    );
    expect(rows.rows.every((r) => r.data_facturare === null)).toBe(true);
  });

  it('refuses a selection with no criteria', async () => {
    const res = await api().post('/api/reports/invoice-date').set(auth(ctx.adminToken))
      .send({ filters: {}, data_facturare: '2026-03-31' });
    expect(res.status).toBe(400);
  });

  it('refuses a date that is not a date', async () => {
    const res = await api().post('/api/reports/invoice-date').set(auth(ctx.adminToken))
      .send({ filters: { status: 'confirmed' }, data_facturare: 'luna viitoare' });
    expect(res.status).toBe(400);
  });

  it('never reaches another company’s documents', async () => {
    const other = await seedCompany('reports-invoice');
    try {
      const theirs = await makeAviz(other.company.id, {
        original_filename: 'al-lor.pdf', numar_auto: 'B 557 FAC',
      });
      await api().post('/api/reports/invoice-date').set(auth(ctx.adminToken))
        .send({ filters: { plate: 'B 557 FAC' }, data_facturare: '2026-03-31' });
      const row = await query('SELECT data_facturare FROM aviz_documents WHERE id = $1', [theirs.id]);
      expect(row.rows[0].data_facturare).toBeNull();
    } finally {
      await dropCompany(other.company.id);
    }
  });
});

describe('export history', () => {
  it('reproduces the file that was actually sent, not a fresh reading', async () => {
    const template = (await api().post('/api/reports/templates/from-preset')
      .set(auth(ctx.adminToken))
      .send({ preset_id: 'baumit_greutati', name: `Drift ${Date.now()}` })).body;
    const aviz = await makeAviz(ctx.company.id, {
      original_filename: 'drift.pdf', numar_auto: 'B 999 DRF', gross_weight_kg: 5000,
    });

    await api().post('/api/reports/export').set(auth(ctx.adminToken))
      .send({ template_id: template.id, filters: { plate: 'B 999 DRF' } })
      .buffer(true).parse((r, cb) => { r.on('data', () => {}); r.on('end', () => cb(null, null)); });

    const entry = (await api().get('/api/reports/exports').set(auth(ctx.adminToken))).body.exports[0];

    // The document is corrected after the sheet went out.
    await request(app).put(`/api/documents/${aviz.id}/corrections`).set(auth(ctx.adminToken))
      .send({ corrections: { gross_weight_kg: 7777 } });

    const detail = await api().get(`/api/reports/exports/${entry.id}`).set(auth(ctx.adminToken));
    expect(detail.body.drift.changed_since).toContain(aviz.id);
    expect(detail.body.drift.reproducible).toBe(true);

    const file = await api().get(`/api/reports/exports/${entry.id}/file`).set(auth(ctx.adminToken))
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (c) => chunks.push(c));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body);
    const sheet = wb.worksheets[0];
    const grossCol = template.columns.findIndex((c) => c.source === 'gross_weight_kg') + 1;
    expect(sheet.getRow(2).getCell(grossCol).value).toBe(5000);
  });

  it('404s on an export from another company', async () => {
    const other = await seedCompany('reports-hist');
    try {
      const res = await request(app)
        .get(`/api/reports/exports/${(await api().get('/api/reports/exports').set(auth(ctx.adminToken))).body.exports[0].id}`)
        .set(auth(other.adminToken));
      expect(res.status).toBe(404);
    } finally {
      await dropCompany(other.company.id);
    }
  });
});

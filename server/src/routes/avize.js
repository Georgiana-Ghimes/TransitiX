import fs from 'fs/promises';
import path from 'path';
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { serializeRow } from '../entities.js';
import {
  DEFAULT_RAI_COLUMNS,
  annexFieldDefaults,
  normalizeTemplateColumns,
} from '../lib/avizTemplate.js';
import {
  avizFieldConfidence,
  extractAvizFromFile,
  repairAvizFromStored,
  stubAvizFields,
} from '../lib/avizOcr.js';
import { buildAnnexWorkbook } from '../lib/avizExport.js';
import {
  isPgUniqueViolation,
  mergeReextractRow,
  nextAvizStatusOnSave,
  repairNeedsWrite,
} from '../lib/concurrency.js';
import { resolveUploadPath } from '../lib/cmrOcr.js';
import { sendEmail } from '../lib/email.js';
import { zipStore } from '../lib/zipStore.js';
import {
  annexDraftAmount,
  buildAvizListQuery,
  capAvizIds,
  flagDuplicateTpos,
  mapProviderToSource,
  pickConfirmedAvize,
  templateDeleteDecision,
  templateUpdateDecision,
  tpoExistsForOther,
  uniqueZipEntry,
} from '../lib/avizQuery.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import { allocateInvoiceNumber } from '../lib/invoiceNumber.js';

const router = Router();
router.use(authRequired, officeRequired);
const extractHits = new Map();

const ANNEX_COLUMNS = [
  'numar_tpo', 'data_efectuare_cursa', 'valoare_tpo', 'numar_auto',
  'ruta_transport', 'tip_marfa', 'cantitate_marfa', 'numar_document_marfa',
  'numar_curse', 'taxe_suplimentare', 'km_parcursi', 'tarif_km', 'observatii',
];

function emptyToNull(value) {
  return value === '' || value === undefined ? null : value;
}

function rowFromExtracted(extracted) {
  const defaults = annexFieldDefaults();
  const out = { ...defaults };
  for (const key of ANNEX_COLUMNS) {
    if (extracted[key] !== undefined) out[key] = emptyToNull(extracted[key]);
  }
  return out;
}

async function ensureDefaultTemplate(companyId) {
  return withTransaction(async (client) => {
    await client.query(`SELECT id FROM companies WHERE id = $1 FOR UPDATE`, [companyId]);
    const existing = await client.query(
      `SELECT * FROM report_templates WHERE company_id = $1 ORDER BY is_default DESC, created_at ASC`,
      [companyId]
    );
    if (existing.rows.length > 0) return existing.rows.map(serializeRow);
    try {
      const inserted = await client.query(
        `INSERT INTO report_templates (company_id, name, columns, is_default)
         VALUES ($1, $2, $3::jsonb, TRUE)
         RETURNING *`,
        [companyId, 'Anexa Factura RAI', JSON.stringify(DEFAULT_RAI_COLUMNS)]
      );
      return inserted.rows.map(serializeRow);
    } catch (err) {
      if (!isPgUniqueViolation(err)) throw err;
      const again = await client.query(
        `SELECT * FROM report_templates WHERE company_id = $1 ORDER BY is_default DESC, created_at ASC`,
        [companyId]
      );
      return again.rows.map(serializeRow);
    }
  });
}

async function writeTemplateDefault(client, companyId, makeDefault, exceptId = null) {
  if (!makeDefault) return;
  if (exceptId) {
    await client.query(
      `UPDATE report_templates SET is_default = FALSE, updated_at = NOW()
       WHERE company_id = $1 AND id <> $2`,
      [companyId, exceptId]
    );
    return;
  }
  await client.query(
    `UPDATE report_templates SET is_default = FALSE, updated_at = NOW() WHERE company_id = $1`,
    [companyId]
  );
}

function repairedUpdateValues(repaired) {
  return [
    repaired.numar_tpo,
    repaired.data_efectuare_cursa,
    repaired.numar_auto,
    repaired.ruta_transport,
    repaired.tip_marfa,
    repaired.cantitate_marfa,
    repaired.numar_document_marfa,
    repaired.id,
  ];
}

const DEFAULT_OBS_CODES = [
  { code: 'Z:B*', label: 'Zona B', sort_order: 1 },
  { code: 'IF*', label: 'Ilfov', sort_order: 2 },
  { code: 'Așteptare', label: 'Așteptare', sort_order: 3 },
];

function decorateAviz(row) {
  const serialized = serializeRow(row);
  const source = serialized.extraction_source
    || mapProviderToSource(serialized.extracted_data?.provider);
  return {
    ...serialized,
    extraction_source: source,
    field_confidence: avizFieldConfidence(serialized),
  };
}

async function logAvizExport(companyId, userId, { kind, templateId, avizIds, filename }) {
  await query(
    `INSERT INTO aviz_export_log (company_id, user_id, kind, template_id, aviz_ids, filename)
     VALUES ($1, $2, $3, $4, $5::uuid[], $6)`,
    [companyId, userId || null, kind || 'xlsx', templateId || null, avizIds || [], filename || null]
  );
}

async function loadAvizeByIds(companyId, avizIds) {
  const docs = await query(
    `SELECT * FROM aviz_documents
     WHERE company_id = $1 AND id = ANY($2::uuid[])
     ORDER BY created_at ASC`,
    [companyId, avizIds]
  );
  return docs.rows.map((row) => repairAvizFromStored(serializeRow(row)));
}

async function buildAnnexBuffer(companyId, templateId, avizIds) {
  const tmpl = await query(
    `SELECT * FROM report_templates WHERE id = $1 AND company_id = $2`,
    [templateId, companyId]
  );
  if (!tmpl.rows[0]) {
    const err = new Error('Template not found');
    err.status = 404;
    throw err;
  }
  const avize = await loadAvizeByIds(companyId, avizIds);
  if (avize.length === 0) {
    const err = new Error('Niciun aviz găsit pentru export');
    err.status = 400;
    throw err;
  }
  const template = serializeRow(tmpl.rows[0]);
  const workbook = await buildAnnexWorkbook(template, avize);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = String(tmpl.rows[0].name || 'Anexa').replace(/[^\w\-]+/g, '_').slice(0, 40);
  return { buffer, filename: `${safeName}-${stamp}.xlsx`, template, avize };
}

async function ensureObservationCodes(companyId) {
  const existing = await query(
    `SELECT * FROM aviz_observation_codes WHERE company_id = $1 ORDER BY sort_order ASC, code ASC`,
    [companyId]
  );
  if (existing.rows.length > 0) return existing.rows.map(serializeRow);
  for (const row of DEFAULT_OBS_CODES) {
    await query(
      `INSERT INTO aviz_observation_codes (company_id, code, label, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [companyId, row.code, row.label, row.sort_order]
    );
  }
  const again = await query(
    `SELECT * FROM aviz_observation_codes WHERE company_id = $1 ORDER BY sort_order ASC, code ASC`,
    [companyId]
  );
  return again.rows.map(serializeRow);
}

router.get('/', async (req, res) => {
  try {
    const { sql, params } = buildAvizListQuery({
      companyId: req.user.company_id,
      from: req.query.from,
      to: req.query.to,
      status: req.query.status,
      q: req.query.q,
    });
    const result = await query(sql, params);
    const rows = flagDuplicateTpos(result.rows.map(decorateAviz));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to list avize' });
  }
});

router.post('/repair', async (req, res) => {
  try {
    const docs = await query(
      `SELECT * FROM aviz_documents WHERE company_id = $1 ORDER BY created_at ASC`,
      [req.user.company_id]
    );
    const out = [];
    for (const row of docs.rows) {
      const stored = serializeRow(row);
      const repaired = repairAvizFromStored(stored);
      if (!repairNeedsWrite(stored, repaired)) {
        out.push(stored);
        continue;
      }
      const result = await query(
        `UPDATE aviz_documents SET
           numar_tpo = $1,
           data_efectuare_cursa = $2,
           numar_auto = $3,
           ruta_transport = $4,
           tip_marfa = $5,
           cantitate_marfa = $6,
           numar_document_marfa = $7,
           updated_at = NOW()
         WHERE id = $8 AND company_id = $9
         RETURNING *`,
        [...repairedUpdateValues(repaired), req.user.company_id]
      );
      if (result.rows[0]) out.push(serializeRow(result.rows[0]));
    }
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Repair failed' });
  }
});

router.get('/templates', async (req, res) => {
  try {
    const templates = await ensureDefaultTemplate(req.user.company_id);
    res.json(templates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to load templates' });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Template name required' });
    const columns = normalizeTemplateColumns(req.body?.columns);
    const isDefault = Boolean(req.body?.is_default);
    const row = await withTransaction(async (client) => {
      await client.query(`SELECT id FROM companies WHERE id = $1 FOR UPDATE`, [req.user.company_id]);
      await writeTemplateDefault(client, req.user.company_id, isDefault);
      const result = await client.query(
        `INSERT INTO report_templates (company_id, name, columns, is_default)
         VALUES ($1, $2, $3::jsonb, $4)
         RETURNING *`,
        [req.user.company_id, name, JSON.stringify(columns), isDefault]
      );
      return result.rows[0];
    });
    res.status(201).json(serializeRow(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to create template' });
  }
});

router.put('/templates/:id', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Template name required' });
    const columns = normalizeTemplateColumns(req.body?.columns);
    const isDefault = Boolean(req.body?.is_default);
    const row = await withTransaction(async (client) => {
      await client.query(`SELECT id FROM companies WHERE id = $1 FOR UPDATE`, [req.user.company_id]);
      const existing = await client.query(
        `SELECT * FROM report_templates WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.user.company_id]
      );
      if (!existing.rows[0]) return null;
      if (templateUpdateDecision(existing.rows[0]) === 'locked_rai') {
        const err = new Error('Anexa Factura RAI nu poate fi suprascrisă. Duplică-l ca șablon nou.');
        err.status = 400;
        throw err;
      }
      await writeTemplateDefault(client, req.user.company_id, isDefault, req.params.id);
      const result = await client.query(
        `UPDATE report_templates
         SET name = $1, columns = $2::jsonb, is_default = $3, updated_at = NOW()
         WHERE id = $4 AND company_id = $5
         RETURNING *`,
        [name, JSON.stringify(columns), isDefault, req.params.id, req.user.company_id]
      );
      return result.rows[0];
    });
    if (!row) return res.status(404).json({ message: 'Template not found' });
    res.json(serializeRow(row));
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Failed to save template' });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    const deleted = await withTransaction(async (client) => {
      await client.query(`SELECT id FROM companies WHERE id = $1 FOR UPDATE`, [req.user.company_id]);
      const count = await client.query(
        `SELECT COUNT(*)::int AS c FROM report_templates WHERE company_id = $1`,
        [req.user.company_id]
      );
      if (count.rows[0].c <= 1) return { error: 'keep_one' };
      const existing = await client.query(
        `SELECT * FROM report_templates WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.user.company_id]
      );
      const decision = templateDeleteDecision({
        count: count.rows[0].c,
        existing: existing.rows[0],
      });
      if (decision !== 'ok') return { error: decision };
      const result = await client.query(
        `DELETE FROM report_templates WHERE id = $1 AND company_id = $2 RETURNING id`,
        [req.params.id, req.user.company_id]
      );
      if (!result.rows[0]) return { error: 'not_found' };
      return { ok: true };
    });
    if (deleted.error === 'keep_one') {
      return res.status(400).json({ message: 'Păstrează cel puțin un șablon' });
    }
    if (deleted.error === 'locked_rai') {
      return res.status(400).json({ message: 'Anexa Factura RAI nu poate fi ștearsă' });
    }
    if (deleted.error === 'not_found') {
      return res.status(404).json({ message: 'Template not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to delete template' });
  }
});

router.post('/extract', async (req, res) => {
  try {
    const limit = hitRateLimit(extractHits, req.user.company_id, { max: 30, windowMs: 60_000 });
    if (!limit.ok) {
      return res.status(429).json({ message: 'Prea multe extrageri. Reîncearcă într-un minut.' });
    }
    const file_url = String(req.body?.file_url || '').trim();
    const original_filename = String(req.body?.original_filename || '').trim() || null;
    const id = req.body?.id || null;
    if (!file_url && !id) {
      return res.status(400).json({ message: 'file_url required' });
    }

    let fileUrl = file_url;
    if (!fileUrl && id) {
      const existing = await query(
        `SELECT file_url FROM aviz_documents WHERE id = $1 AND company_id = $2`,
        [id, req.user.company_id]
      );
      if (!existing.rows[0]) return res.status(404).json({ message: 'Aviz not found' });
      fileUrl = existing.rows[0].file_url;
    }

    let extracted;
    try {
      extracted = await extractAvizFromFile(fileUrl);
    } catch (ocrErr) {
      console.error('[aviz extract]', ocrErr);
      extracted = {
        ...stubAvizFields(),
        extraction_source: 'stub',
        extracted_data: { raw_text: '', parsed: stubAvizFields(), provider: 'stub', error: ocrErr.message },
      };
    }

    const extractedFields = rowFromExtracted(extracted);
    const extractedJson = JSON.stringify(extracted.extracted_data || { parsed: extracted });
    const extractStatus = extracted._stub ? 'uploaded' : 'extracted';

    let result;
    if (id) {
      result = await withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT * FROM aviz_documents WHERE id = $1 AND company_id = $2 FOR UPDATE`,
          [id, req.user.company_id]
        );
        if (!existing.rows[0]) return null;
        const current = existing.rows[0];
        const fields = mergeReextractRow(current, extractedFields);
        const status = nextAvizStatusOnSave(current.status, extractStatus);
        return client.query(
          `UPDATE aviz_documents SET
             original_filename = COALESCE($1, original_filename),
             status = $2,
             extracted_data = $3::jsonb,
             extraction_source = $4,
             numar_tpo = $5,
             data_efectuare_cursa = $6,
             valoare_tpo = $7,
             numar_auto = $8,
             ruta_transport = $9,
             tip_marfa = $10,
             cantitate_marfa = $11,
             numar_document_marfa = $12,
             numar_curse = $13,
             taxe_suplimentare = $14,
             km_parcursi = $15,
             tarif_km = $16,
             observatii = $17,
             updated_at = NOW()
           WHERE id = $18 AND company_id = $19
           RETURNING *`,
          [
            original_filename, status, extractedJson,
            extracted.extraction_source || mapProviderToSource(extracted.extracted_data?.provider),
            fields.numar_tpo, fields.data_efectuare_cursa, fields.valoare_tpo,
            fields.numar_auto, fields.ruta_transport, fields.tip_marfa,
            fields.cantitate_marfa, fields.numar_document_marfa, fields.numar_curse,
            fields.taxe_suplimentare, fields.km_parcursi, fields.tarif_km, fields.observatii,
            id, req.user.company_id,
          ]
        );
      });
      if (!result?.rows[0]) return res.status(404).json({ message: 'Aviz not found' });
    } else {
      result = await query(
        `INSERT INTO aviz_documents (
           company_id, file_url, original_filename, status, extracted_data, extraction_source,
           numar_tpo, data_efectuare_cursa, valoare_tpo, numar_auto, ruta_transport,
           tip_marfa, cantitate_marfa, numar_document_marfa, numar_curse,
           taxe_suplimentare, km_parcursi, tarif_km, observatii
         ) VALUES (
           $1, $2, $3, $4, $5::jsonb, $6,
           $7, $8, $9, $10, $11,
           $12, $13, $14, $15,
           $16, $17, $18, $19
         ) RETURNING *`,
        [
          req.user.company_id, fileUrl, original_filename, extractStatus, extractedJson,
          extracted.extraction_source || mapProviderToSource(extracted.extracted_data?.provider),
          extractedFields.numar_tpo, extractedFields.data_efectuare_cursa, extractedFields.valoare_tpo,
          extractedFields.numar_auto, extractedFields.ruta_transport, extractedFields.tip_marfa,
          extractedFields.cantitate_marfa, extractedFields.numar_document_marfa, extractedFields.numar_curse,
          extractedFields.taxe_suplimentare, extractedFields.km_parcursi, extractedFields.tarif_km, extractedFields.observatii,
        ]
      );
    }

    const row = decorateAviz(result.rows[0]);
    row.duplicate_tpo = await tpoExistsForOther(query, {
      companyId: req.user.company_id,
      tpo: row.numar_tpo,
      exceptId: row.id,
    });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Extract failed' });
  }
});

router.post('/export', async (req, res) => {
  try {
    const templateId = req.body?.template_id;
    const avizIds = capAvizIds(req.body?.aviz_ids);
    if (!templateId) return res.status(400).json({ message: 'template_id required' });
    if (avizIds.length === 0) return res.status(400).json({ message: 'Selectează cel puțin un aviz' });

    const { buffer, filename } = await buildAnnexBuffer(req.user.company_id, templateId, avizIds);
    await logAvizExport(req.user.company_id, req.user.id, {
      kind: 'xlsx',
      templateId,
      avizIds,
      filename,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Export failed' });
  }
});

router.post('/bulk-confirm', async (req, res) => {
  try {
    const ids = capAvizIds(req.body?.ids);
    if (ids.length === 0) return res.status(400).json({ message: 'Selectează cel puțin un aviz' });
    const result = await withTransaction(async (client) => {
      return client.query(
        `UPDATE aviz_documents
         SET status = 'confirmed', updated_at = NOW()
         WHERE company_id = $1 AND id = ANY($2::uuid[]) AND status <> 'confirmed'
         RETURNING *`,
        [req.user.company_id, ids]
      );
    });
    res.json(flagDuplicateTpos(result.rows.map(decorateAviz)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Bulk confirm failed' });
  }
});

router.get('/observation-codes', async (req, res) => {
  try {
    const codes = await ensureObservationCodes(req.user.company_id);
    res.json(codes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to load codes' });
  }
});

router.post('/observation-codes', async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ message: 'code required' });
    const label = String(req.body?.label || code).trim();
    const result = await query(
      `INSERT INTO aviz_observation_codes (company_id, code, label, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, code) DO UPDATE SET label = EXCLUDED.label
       RETURNING *`,
      [req.user.company_id, code, label, Number(req.body?.sort_order) || 0]
    );
    res.status(201).json(serializeRow(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to save code' });
  }
});

router.delete('/observation-codes/:id', async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM aviz_observation_codes WHERE id = $1 AND company_id = $2 RETURNING id`,
      [req.params.id, req.user.company_id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Code not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to delete code' });
  }
});

router.post('/email', async (req, res) => {
  try {
    const to = String(req.body?.to || '').trim();
    const templateId = req.body?.template_id;
    const avizIds = capAvizIds(req.body?.aviz_ids);
    if (!to) return res.status(400).json({ message: 'to required' });
    if (!templateId) return res.status(400).json({ message: 'template_id required' });
    if (avizIds.length === 0) return res.status(400).json({ message: 'Selectează cel puțin un aviz' });

    const { buffer, filename } = await buildAnnexBuffer(req.user.company_id, templateId, avizIds);
    const sent = await sendEmail({
      to,
      subject: `Anexa Factura ${filename}`,
      text: `Anexa cu ${avizIds.length} aviz(e) este atașată.`,
      attachments: [{ filename, content: buffer }],
    });
    await logAvizExport(req.user.company_id, req.user.id, {
      kind: sent.stub ? 'email-stub' : 'email',
      templateId,
      avizIds,
      filename,
    });
    res.json({
      ...sent,
      filename,
      download: Boolean(sent.stub),
      content_base64: sent.stub ? buffer.toString('base64') : undefined,
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Email failed' });
  }
});

router.post('/zip', async (req, res) => {
  try {
    const templateId = req.body?.template_id;
    const avizIds = capAvizIds(req.body?.aviz_ids);
    if (!templateId) return res.status(400).json({ message: 'template_id required' });
    if (avizIds.length === 0) return res.status(400).json({ message: 'Selectează cel puțin un aviz' });

    const { buffer, filename, avize } = await buildAnnexBuffer(req.user.company_id, templateId, avizIds);
    const files = [{ name: filename, data: buffer }];
    const used = new Set([filename]);
    let missing = 0;
    for (const aviz of avize) {
      const localPath = resolveUploadPath(aviz.file_url);
      if (!localPath) {
        missing += 1;
        continue;
      }
      try {
        const data = await fs.readFile(localPath);
        const orig = path.basename(aviz.original_filename || localPath);
        files.push({ name: uniqueZipEntry(`originale/${orig}`, used), data });
      } catch (err) {
        missing += 1;
        console.error('[aviz zip file]', err.message || err);
      }
    }
    const zip = zipStore(files);
    const zipName = filename.replace(/\.xlsx$/i, '.zip');
    await logAvizExport(req.user.company_id, req.user.id, {
      kind: 'zip',
      templateId,
      avizIds,
      filename: zipName,
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('X-Aviz-Missing-Files', String(missing));
    res.send(zip);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Zip failed' });
  }
});

router.get('/trip-suggestions', async (req, res) => {
  try {
    const date = String(req.query.date || '').slice(0, 10);
    const plate = String(req.query.plate || '').trim();
    const params = [req.user.company_id];
    const where = ['company_id = $1'];
    let i = 2;
    if (date) {
      where.push(`loading_date = $${i}`);
      params.push(date);
      i += 1;
    }
    if (plate) {
      where.push(`COALESCE(vehicle_plate, '') ILIKE $${i}`);
      params.push(`%${plate}%`);
      i += 1;
    }
    params.push(20);
    const result = await query(
      `SELECT id, cmr_number, vehicle_plate, loading_date, consignee_name, status
       FROM trips
       WHERE ${where.join(' AND ')}
       ORDER BY loading_date DESC
       LIMIT $${i}`,
      params
    );
    res.json(result.rows.map(serializeRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Trip suggestions failed' });
  }
});

router.post('/draft-invoice', async (req, res) => {
  try {
    const avizIds = capAvizIds(req.body?.aviz_ids);
    const rule = req.body?.amount_rule === 'km_tarif' ? 'km_tarif' : 'tpo';
    if (avizIds.length === 0) return res.status(400).json({ message: 'Selectează cel puțin un aviz' });
    const avize = await loadAvizeByIds(req.user.company_id, avizIds);
    const confirmed = pickConfirmedAvize(avize);
    if (confirmed.length === 0) {
      return res.status(400).json({ message: 'Selectează avize confirmate pentru ciornă' });
    }
    const subtotal = confirmed.reduce((sum, row) => sum + annexDraftAmount(row, rule), 0);
    const vatRate = 19;
    const vatAmount = Math.round(subtotal * vatRate) / 100;
    const total = Math.round((subtotal + vatAmount) * 100) / 100;
    const tpos = confirmed.map((row) => row.numar_tpo).filter(Boolean).join(', ');
    const tripId = confirmed.find((row) => row.trip_id)?.trip_id || null;
    let clientName = String(req.body?.client_name || '').trim();
    if (!clientName && tripId) {
      const trip = await query(
        `SELECT consignee_name FROM trips WHERE id = $1 AND company_id = $2`,
        [tripId, req.user.company_id]
      );
      clientName = String(trip.rows[0]?.consignee_name || '').trim();
    }
    if (!clientName) clientName = 'Client avize';
    const row = await withTransaction(async (client) => {
      const number = await allocateInvoiceNumber(client, req.user.company_id, 'TRX');
      const result = await client.query(
        `INSERT INTO invoices (
           company_id, trip_id, series, number, client_name, issue_date,
           description, subtotal, vat_rate, vat_amount, total_amount,
           currency, status, efactura_status, notes
         ) VALUES (
           $1, $2, 'TRX', $3, $4, CURRENT_DATE,
           $5, $6, $7, $8, $9,
           'RON', 'draft', 'not_sent', $10
         ) RETURNING *`,
        [
          req.user.company_id,
          tripId,
          number,
          clientName,
          `Servicii transport — avize ${tpos || confirmed.length}`,
          subtotal,
          vatRate,
          vatAmount,
          total,
          `Avize: ${tpos || confirmed.map((r) => r.id).join(', ')}. Regulă sumă: ${rule}. Fără e-Factura ANAF.`,
        ]
      );
      return result.rows[0];
    });
    res.status(201).json(serializeRow(row));
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      return res.status(409).json({ message: 'Numărul de factură există deja în această serie' });
    }
    console.error(err);
    res.status(500).json({ message: err.message || 'Draft invoice failed' });
  }
});

router.get('/reports', async (req, res) => {
  try {
    const from = String(req.query.from || '').slice(0, 10) || null;
    const to = String(req.query.to || '').slice(0, 10) || null;
    const dateWhere = [];
    const params = [req.user.company_id];
    let i = 2;
    if (from) {
      dateWhere.push(`data_efectuare_cursa >= $${i}`);
      params.push(from);
      i += 1;
    }
    if (to) {
      dateWhere.push(`data_efectuare_cursa <= $${i}`);
      params.push(to);
      i += 1;
    }
    const filter = dateWhere.length ? `AND ${dateWhere.join(' AND ')}` : '';
    const byPlate = await query(
      `SELECT COALESCE(NULLIF(numar_auto, ''), '—') AS plate,
              COUNT(*)::int AS count,
              COALESCE(SUM(km_parcursi), 0)::float AS km
       FROM aviz_documents
       WHERE company_id = $1 ${filter}
       GROUP BY 1
       ORDER BY km DESC, count DESC
       LIMIT 50`,
      params
    );
    const weekly = await query(
      `SELECT date_trunc('week', data_efectuare_cursa)::date AS week_start,
              COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed
       FROM aviz_documents
       WHERE company_id = $1 AND data_efectuare_cursa IS NOT NULL ${filter}
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT 12`,
      params
    );
    const exports = await query(
      `SELECT l.id, l.kind, l.filename, l.created_at, cardinality(l.aviz_ids) AS aviz_count,
              l.user_id, u.email AS user_email, u.name AS user_name
       FROM aviz_export_log l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.company_id = $1
       ORDER BY l.created_at DESC
       LIMIT 30`,
      [req.user.company_id]
    );
    res.json({
      by_plate: byPlate.rows,
      weekly: weekly.rows,
      exports: exports.rows.map(serializeRow),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Reports failed' });
  }
});

export default router;

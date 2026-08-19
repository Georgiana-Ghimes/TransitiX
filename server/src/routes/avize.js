import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { serializeRow } from '../entities.js';
import {
  DEFAULT_RAI_COLUMNS,
  annexFieldDefaults,
  normalizeTemplateColumns,
} from '../lib/avizTemplate.js';
import { extractAvizFromFile, stubAvizFields, repairAvizFromStored } from '../lib/avizOcr.js';
import { buildAnnexWorkbook } from '../lib/avizExport.js';
import {
  isPgUniqueViolation,
  mergeReextractRow,
  nextAvizStatusOnSave,
  repairNeedsWrite,
} from '../lib/concurrency.js';

const router = Router();
router.use(authRequired, officeRequired);

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
    res.status(500).json({ message: err.message || 'Failed to save template' });
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
             numar_tpo = $4,
             data_efectuare_cursa = $5,
             valoare_tpo = $6,
             numar_auto = $7,
             ruta_transport = $8,
             tip_marfa = $9,
             cantitate_marfa = $10,
             numar_document_marfa = $11,
             numar_curse = $12,
             taxe_suplimentare = $13,
             km_parcursi = $14,
             tarif_km = $15,
             observatii = $16,
             updated_at = NOW()
           WHERE id = $17 AND company_id = $18
           RETURNING *`,
          [
            original_filename, status, extractedJson,
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
           company_id, file_url, original_filename, status, extracted_data,
           numar_tpo, data_efectuare_cursa, valoare_tpo, numar_auto, ruta_transport,
           tip_marfa, cantitate_marfa, numar_document_marfa, numar_curse,
           taxe_suplimentare, km_parcursi, tarif_km, observatii
         ) VALUES (
           $1, $2, $3, $4, $5::jsonb,
           $6, $7, $8, $9, $10,
           $11, $12, $13, $14,
           $15, $16, $17, $18
         ) RETURNING *`,
        [
          req.user.company_id, fileUrl, original_filename, extractStatus, extractedJson,
          extractedFields.numar_tpo, extractedFields.data_efectuare_cursa, extractedFields.valoare_tpo,
          extractedFields.numar_auto, extractedFields.ruta_transport, extractedFields.tip_marfa,
          extractedFields.cantitate_marfa, extractedFields.numar_document_marfa, extractedFields.numar_curse,
          extractedFields.taxe_suplimentare, extractedFields.km_parcursi, extractedFields.tarif_km, extractedFields.observatii,
        ]
      );
    }

    res.json(serializeRow(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Extract failed' });
  }
});

router.post('/export', async (req, res) => {
  try {
    const templateId = req.body?.template_id;
    const avizIds = Array.isArray(req.body?.aviz_ids) ? req.body.aviz_ids.filter(Boolean) : [];
    if (!templateId) return res.status(400).json({ message: 'template_id required' });
    if (avizIds.length === 0) return res.status(400).json({ message: 'Selectează cel puțin un aviz' });

    const tmpl = await query(
      `SELECT * FROM report_templates WHERE id = $1 AND company_id = $2`,
      [templateId, req.user.company_id]
    );
    if (!tmpl.rows[0]) return res.status(404).json({ message: 'Template not found' });

    const docs = await query(
      `SELECT * FROM aviz_documents
       WHERE company_id = $1 AND id = ANY($2::uuid[])
       ORDER BY created_at ASC`,
      [req.user.company_id, avizIds]
    );
    if (docs.rows.length === 0) {
      return res.status(400).json({ message: 'Niciun aviz găsit pentru export' });
    }

    const template = serializeRow(tmpl.rows[0]);
    const avize = docs.rows.map((row) => repairAvizFromStored(serializeRow(row)));
    const workbook = await buildAnnexWorkbook(template, avize);
    const buffer = await workbook.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 10);
    const safeName = String(tmpl.rows[0].name || 'Anexa').replace(/[^\w\-]+/g, '_').slice(0, 40);
    const filename = `${safeName}-${stamp}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Export failed' });
  }
});

export default router;

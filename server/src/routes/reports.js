/**
 * Reporting: pick documents, preview the sheet, export it, and keep an honest history.
 *
 * The export log stores the rendered rows, not just the ids. A month later the documents may
 * have been corrected; without the snapshot there would be no way to reproduce the file the
 * customer actually received, and "here is roughly what we sent" is not an answer.
 */
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { serializeRow } from '../entities.js';
import { REPORT_SOURCES, SOURCE_GROUPS } from '../lib/reporting/sources.js';
import { getPreset, listPresets } from '../lib/reporting/presets.js';
import { buildReport, describeColumns } from '../lib/reporting/build.js';
import {
  buildSelectionQuery,
  describeSelection,
  isEmptySelection,
} from '../lib/reporting/select.js';
import { renderReportWorkbook } from '../lib/avizExport.js';
import { recordExport } from '../lib/reporting/exportLog.js';
import { normalizeTemplateColumns } from '../lib/avizTemplate.js';
import { repairAvizFromStored } from '../lib/avizOcr.js';

const router = Router();
router.use(authRequired, officeRequired);

function fail(res, err, fallback) {
  const status = err?.status || 500;
  if (status >= 500) console.error('[reports]', err);
  res.status(status).json({ message: err?.message || fallback });
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function loadTemplate(companyId, templateId) {
  const found = await query(
    'SELECT * FROM report_templates WHERE id = $1 AND company_id = $2',
    [templateId, companyId]
  );
  if (!found.rows[0]) throw httpError('Șablon inexistent', 404);
  return serializeRow(found.rows[0]);
}

async function selectDocuments(companyId, filters) {
  const { sql, params, filters: used } = buildSelectionQuery(companyId, filters);
  const found = await query(sql, params);
  return {
    documents: found.rows.map((row) => repairAvizFromStored(serializeRow(row))),
    filters: used,
  };
}

function exportFilename(templateName) {
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = String(templateName || 'Raport').replace(/[^\w-]+/g, '_').slice(0, 40);
  return `${safe}-${stamp}.xlsx`;
}

function sendWorkbookHeaders(res, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

/** The vocabulary the template builder offers. */
router.get('/sources', (_req, res) => {
  res.json({ sources: REPORT_SOURCES, groups: SOURCE_GROUPS });
});

router.get('/presets', (_req, res) => {
  res.json({ presets: listPresets() });
});

/** Instantiates a preset as an ordinary, editable template for this company. */
router.post('/templates/from-preset', async (req, res) => {
  try {
    const preset = getPreset(req.body?.preset_id);
    if (!preset) return res.status(400).json({ message: 'Preset necunoscut' });
    const name = String(req.body?.name || preset.name).trim().slice(0, 120) || preset.name;

    const created = await withTransaction(async (client) => {
      const clash = await client.query(
        'SELECT id FROM report_templates WHERE company_id = $1 AND lower(name) = lower($2)',
        [req.user.company_id, name]
      );
      if (clash.rows[0]) throw httpError('Există deja un șablon cu acest nume', 409);
      const row = await client.query(
        `INSERT INTO report_templates (company_id, name, columns, is_default, preset_id, description)
         VALUES ($1, $2, $3::jsonb, FALSE, $4, $5) RETURNING *`,
        [req.user.company_id, name, JSON.stringify(preset.columns), preset.id, preset.description]
      );
      return row.rows[0];
    });
    res.status(201).json(serializeRow(created));
  } catch (err) {
    fail(res, err, 'Crearea șablonului a eșuat');
  }
});

/** What the sheet will contain, before anything is written to a file. */
router.post('/preview', async (req, res) => {
  try {
    const template = await loadTemplate(req.user.company_id, req.body?.template_id);
    const filters = req.body?.filters ?? {};
    if (isEmptySelection(filters)) {
      return res.status(400).json({ message: 'Alege cel puțin un criteriu de selecție' });
    }
    const { documents, filters: used } = await selectDocuments(req.user.company_id, filters);
    const report = buildReport({ template, documents });
    res.json({
      template: { id: template.id, name: template.name, preset_id: template.preset_id },
      selection: { ...used, description: describeSelection(used) },
      ...report,
      documents: documents.map((d) => ({
        id: d.id,
        original_filename: d.original_filename,
        status: d.status,
        needs_review: d.needs_review,
        numar_tpo: d.numar_tpo,
        numar_auto: d.numar_auto,
        data_efectuare_cursa: d.data_efectuare_cursa,
        gross_weight_kg: d.gross_weight_kg,
      })),
    });
  } catch (err) {
    fail(res, err, 'Previzualizarea a eșuat');
  }
});

/** Generates the file and records exactly what went into it. */
router.post('/export', async (req, res) => {
  try {
    const template = await loadTemplate(req.user.company_id, req.body?.template_id);
    const filters = req.body?.filters ?? {};
    if (isEmptySelection(filters)) {
      return res.status(400).json({ message: 'Alege cel puțin un criteriu de selecție' });
    }
    const { documents, filters: used } = await selectDocuments(req.user.company_id, filters);
    if (!documents.length) {
      return res.status(400).json({ message: 'Selecția nu conține niciun document' });
    }

    const withTotals = req.body?.totals !== false;
    const report = buildReport({ template, documents });
    const columns = normalizeTemplateColumns(template.columns);
    const workbook = renderReportWorkbook({
      name: template.name,
      columns,
      rows: report.rows,
      totals: withTotals ? report.totals : null,
    });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const filename = exportFilename(template.name);

    await recordExport({
      companyId: req.user.company_id,
      userId: req.user.id,
      templateId: template.id,
      templateName: template.name,
      documents,
      filename,
      columns,
      rows: report.rows,
      totals: withTotals ? report.totals : null,
      warnings: report.warnings,
      filters: used,
      batchId: used.batch_id || null,
      note: req.body?.note,
    });

    sendWorkbookHeaders(res, filename);
    res.send(buffer);
  } catch (err) {
    fail(res, err, 'Exportul a eșuat');
  }
});

/**
 * Sets the billing date on a whole selection.
 *
 * An annex is invoiced on one date; asking an operator to type it onto eighty documents by hand
 * is how the column ends up half empty. This deliberately does not touch `data_efectuare_cursa`:
 * the tariff is read as of the day the trip ran, and moving that date to match an invoice would
 * silently reprice the line.
 */
router.post('/invoice-date', async (req, res) => {
  try {
    const filters = req.body?.filters ?? {};
    if (isEmptySelection(filters)) {
      return res.status(400).json({ message: 'Alege cel puțin un criteriu de selecție' });
    }
    const raw = req.body?.data_facturare;
    const value = raw === null || raw === '' ? null : String(raw).slice(0, 10);
    if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return res.status(400).json({ message: 'Dată invalidă' });
    }

    const { documents } = await selectDocuments(req.user.company_id, filters);
    if (!documents.length) {
      return res.status(400).json({ message: 'Selecția nu conține niciun document' });
    }

    const updated = await query(
      `UPDATE aviz_documents SET data_facturare = $1, updated_at = NOW()
       WHERE company_id = $2 AND id = ANY($3::uuid[])
       RETURNING id`,
      [value, req.user.company_id, documents.map((d) => d.id)]
    );
    res.json({ updated: updated.rowCount, data_facturare: value });
  } catch (err) {
    fail(res, err, 'Data de facturare nu a putut fi salvată');
  }
});

/** Export history. */
router.get('/exports', async (req, res) => {
  try {
    const where = ['l.company_id = $1'];
    const params = [req.user.company_id];
    let i = 2;
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      where.push(`l.created_at >= $${i}`);
      params.push(from);
      i += 1;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      where.push(`l.created_at < ($${i}::date + 1)`);
      params.push(to);
      i += 1;
    }
    if (req.query.template_id) {
      where.push(`l.template_id = $${i}::uuid`);
      params.push(req.query.template_id);
      i += 1;
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const listParams = [...params, limit, offset];

    const rows = await query(
      `SELECT l.id, l.kind, l.filename, l.created_at, l.row_count, l.filters, l.totals,
              l.template_id, l.template_name, l.note, l.batch_id,
              cardinality(l.aviz_ids) AS aviz_count,
              (l.snapshot IS NOT NULL) AS reproducible,
              jsonb_array_length(COALESCE(l.warnings, '[]'::jsonb)) AS warning_count,
              u.email AS user_email, u.name AS user_name
       FROM aviz_export_log l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY l.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      listParams
    );
    const total = await query(
      `SELECT COUNT(*)::int AS c FROM aviz_export_log l WHERE ${where.join(' AND ')}`,
      params
    );
    res.json({
      exports: rows.rows.map((row) => ({
        ...serializeRow(row),
        selection: describeSelection(row.filters || {}),
      })),
      total: total.rows[0]?.c ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    fail(res, err, 'Istoricul exporturilor nu a putut fi citit');
  }
});

async function loadExport(companyId, id) {
  const found = await query(
    `SELECT l.*, u.email AS user_email, u.name AS user_name
     FROM aviz_export_log l LEFT JOIN users u ON u.id = l.user_id
     WHERE l.id = $1 AND l.company_id = $2`,
    [id, companyId]
  );
  if (!found.rows[0]) throw httpError('Export inexistent', 404);
  return found.rows[0];
}

/**
 * One export in detail, plus whether the documents behind it still look the way they did.
 *
 * A confirmed document can still be corrected afterwards. Saying which rows have moved since is
 * the difference between a history that documents and one that merely lists.
 */
router.get('/exports/:id', async (req, res) => {
  try {
    const row = await loadExport(req.user.company_id, req.params.id);
    const ids = row.aviz_ids || [];
    const current = ids.length
      ? (await query(
        `SELECT id, original_filename, status, needs_review, numar_tpo, numar_auto,
                data_efectuare_cursa, gross_weight_kg, updated_at
         FROM aviz_documents WHERE company_id = $1 AND id = ANY($2::uuid[])`,
        [req.user.company_id, ids]
      )).rows
      : [];

    const byId = new Map(current.map((d) => [d.id, d]));
    const missing = ids.filter((id) => !byId.has(id));
    const changedSince = current
      .filter((d) => d.updated_at && new Date(d.updated_at) > new Date(row.created_at))
      .map((d) => d.id);

    const detail = serializeRow(row);
    delete detail.snapshot;

    res.json({
      export: {
        ...detail,
        selection: describeSelection(row.filters || {}),
        columns: row.snapshot?.columns ? describeColumns(row.snapshot.columns) : [],
      },
      rows: row.snapshot?.rows ?? [],
      documents: current.map(serializeRow),
      drift: {
        missing_documents: missing,
        changed_since: changedSince,
        reproducible: Boolean(row.snapshot?.rows),
      },
    });
  } catch (err) {
    fail(res, err, 'Exportul nu a putut fi citit');
  }
});

/** Re-download: renders the stored snapshot, so it is the same sheet, not a fresh one. */
router.get('/exports/:id/file', async (req, res) => {
  try {
    const row = await loadExport(req.user.company_id, req.params.id);
    if (!row.snapshot?.rows) {
      return res.status(409).json({
        message: 'Acest export este anterior salvării conținutului și nu poate fi reprodus identic. '
          + 'Generează un raport nou cu aceleași criterii.',
      });
    }
    const workbook = renderReportWorkbook({
      name: row.template_name || 'Raport',
      columns: normalizeTemplateColumns(row.snapshot.columns),
      rows: row.snapshot.rows,
      totals: row.snapshot.totals || null,
    });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    sendWorkbookHeaders(res, row.filename || exportFilename(row.template_name));
    res.send(buffer);
  } catch (err) {
    fail(res, err, 'Re-descărcarea a eșuat');
  }
});

export default router;

import fs from 'fs/promises';
import path from 'path';
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { serializeRow } from '../entities.js';
import {
  DEFAULT_RAI_COLUMNS,
  hasUsableColumns,
  normalizeTemplateColumns,
  TEMPLATE_NAME_TAKEN,
} from '../lib/avizTemplate.js';
import { fieldConfidenceForUi, repairAvizFromStored } from '../lib/avizOcr.js';
import { listRouteRules, preferLearnedRoute } from '../lib/ocr/routeLearn.js';
import { extractBatchDocuments, failStaleUploadedAvize, logEvent } from './documents.js';
import {
  documentPageCount,
  interactiveOcrMaxPages,
  interactiveOcrTimeoutMs,
  ocrCapability,
  isOcrDown,
} from '../lib/ocr/readText.js';
import { materializePdfPageFiles, PdfSplitError } from '../lib/ocr/splitPdf.js';
import { renderReportWorkbook } from '../lib/avizExport.js';
import { buildReport } from '../lib/reporting/build.js';
import { recordExport } from '../lib/reporting/exportLog.js';
import { isPgUniqueViolation, repairNeedsWrite } from '../lib/concurrency.js';
import { resolveUploadPath } from '../lib/cmrOcr.js';
import { sendEmail } from '../lib/email.js';
import {
  isValidObservationCodeFormat,
  normalizeObservationCode,
  validateObservationCodeInput,
} from '../lib/observationCodes.js';
import { zipStore } from '../lib/zipStore.js';
import {
  buildAvizCountQuery,
  buildAvizListQuery,
  capAvizIds,
  flagDuplicateTpos,
  mapProviderToSource,
  pickConfirmedAvize,
  templateDeleteDecision,
  templateUpdateDecision,
  duplicateConsignmentExists,
  uniqueZipEntry,
} from '../lib/avizQuery.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import { allocateInvoiceNumber } from '../lib/invoiceNumber.js';
import {
  buildInvoiceDraft,
  describeDraft,
  headerTripId,
  vatRateFor,
} from '../lib/pricing/invoiceDraft.js';

const router = Router();
router.use(authRequired, officeRequired);
const extractHits = new Map();
const exportHits = new Map();
/** In-flight annex builds: same user + template + selection must not pile up. */
const exportInFlight = new Map();

function annexExportKey(userId, templateId, avizIds) {
  const ids = [...avizIds].map(String).sort();
  return `${userId}:${templateId}:${ids.join(',')}`;
}

/**
 * A batch to hang a document on. The extractor works per batch, and document_events are keyed
 * to one, so a single uploaded aviz gets its own rather than being read outside the pipeline.
 */
async function createAvizBatch(client, { companyId, userId, label }) {
  const created = await client.query(
    `INSERT INTO document_batches (company_id, user_id, document_type, label, file_count)
     VALUES ($1, $2, 'aviz', $3, 0) RETURNING id`,
    [companyId, userId, label ?? null]
  );
  return created.rows[0];
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

function templateNameTakenError() {
  const err = new Error(TEMPLATE_NAME_TAKEN);
  err.status = 409;
  err.code = 'TEMPLATE_NAME_TAKEN';
  return err;
}

async function assertTemplateNameFree(client, companyId, name, exceptId = null) {
  const clash = exceptId
    ? await client.query(
      `SELECT id FROM report_templates
       WHERE company_id = $1 AND lower(name) = lower($2) AND id <> $3`,
      [companyId, name, exceptId],
    )
    : await client.query(
      `SELECT id FROM report_templates
       WHERE company_id = $1 AND lower(name) = lower($2)`,
      [companyId, name],
    );
  if (clash.rows[0]) throw templateNameTakenError();
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
  { code: 'Z:B', label: 'Zona B', sort_order: 1 },
  { code: 'IF', label: 'Ilfov', sort_order: 2 },
  { code: 'ZA', label: 'Zona A', sort_order: 3 },
  { code: 'DM', label: 'Descărcare macara', sort_order: 4 },
];

/**
 * One aviz as the screen should see it.
 *
 * The repair runs here for the same reason it runs on export: PaddleOCR regularly leaves
 * `ruta_transport` empty on the row while the route is plainly there in the stored OCR text.
 * Export repaired it and the list did not, so the same document showed no route in the table
 * and the right one in the XLSX. A screen that disagrees with the file it produces is worse
 * than either being wrong alone, because neither can be trusted afterwards.
 *
 * `repairAvizFromStored` fills blanks (and replaces a false route like "Bolintin-Deal"), so an
 * office edit of a real route is never overwritten, and nothing is written back here: this
 * decorates a response, it does not change the document.
 */
function decorateAviz(row, { routeRules = [] } = {}) {
  const serialized = repairAvizFromStored(serializeRow(row));
  const corrected = Array.isArray(serialized.corrected_fields) ? serialized.corrected_fields : [];
  const raw = serialized.extracted_data?.raw_text;
  let ruta = serialized.ruta_transport;
  let extracted_data = serialized.extracted_data;
  if (routeRules.length && raw && !corrected.includes('ruta_transport')) {
    const learned = preferLearnedRoute(ruta, raw, routeRules, { corrected: false });
    if (learned.rule) {
      ruta = learned.route;
      extracted_data = { ...(extracted_data || {}), route_source: 'learned' };
    }
  }
  const withRoute = {
    ...serialized,
    ruta_transport: ruta,
    extracted_data,
  };
  const source = withRoute.extraction_source
    || mapProviderToSource(withRoute.extracted_data?.provider);
  const validation = withRoute.extracted_data?.validation ?? null;
  const field_confidence = fieldConfidenceForUi(withRoute);
  const heuristicReview = ['numar_tpo', 'numar_auto', 'ruta_transport', 'cantitate_marfa']
    .some((key) => field_confidence[key] === 'low');
  const existingRouting = validation?.routing ?? null;
  const validation_routing = heuristicReview
    && (!existingRouting || existingRouting === 'auto')
    ? 'hitl_optional'
    : existingRouting;
  return {
    ...withRoute,
    extraction_source: source,
    field_confidence,
    // Surface review when heuristics catch a wrong-but-plausible parse even if DB
    // needs_review was cleared or never set for that field.
    needs_review: Boolean(withRoute.needs_review) || heuristicReview,
    validation_routing,
    validation_findings: validation?.findings ?? null,
  };
}

async function decorateAvizForCompany(row, companyId) {
  const routeRules = await listRouteRules(query, companyId).catch(() => []);
  return decorateAviz(row, { routeRules });
}

/**
 * Records an export through the shared recorder, so history from this screen is as complete,
 * and as re-downloadable, as history from `/reports`. Before this the two paths wrote different
 * amounts of detail, and only one of them could reproduce its own file.
 */
async function logAvizExport(companyId, userId, { kind, templateId, avizIds, filename, built }) {
  await recordExport({
    companyId,
    userId,
    kind: kind || 'xlsx',
    templateId: templateId || null,
    templateName: built?.template?.name ?? null,
    documents: avizIds || [],
    filename: filename || null,
    columns: built?.columns ?? [],
    rows: built?.report?.rows ?? [],
    totals: null,
    warnings: built?.report?.warnings ?? [],
  });
}

async function loadAvizeByIds(companyId, avizIds) {
  const docs = await query(
    `SELECT * FROM aviz_documents
     WHERE company_id = $1 AND id = ANY($2::uuid[])
     ORDER BY created_at ASC`,
    [companyId, avizIds]
  );
  const routeRules = await listRouteRules(query, companyId).catch(() => []);
  return docs.rows.map((row) => {
    const repaired = repairAvizFromStored(serializeRow(row));
    const corrected = Array.isArray(repaired.corrected_fields) ? repaired.corrected_fields : [];
    const raw = repaired.extracted_data?.raw_text;
    if (!routeRules.length || !raw || corrected.includes('ruta_transport')) return repaired;
    const learned = preferLearnedRoute(repaired.ruta_transport, raw, routeRules);
    if (!learned.rule) return repaired;
    return {
      ...repaired,
      ruta_transport: learned.route,
      extracted_data: { ...(repaired.extracted_data || {}), route_source: 'learned' },
    };
  });
}

/**
 * Anexa / email / zip share Confirmă's HITL gate: unverified OCR must not reach a customer sheet.
 * Confirmed rows are allowed; `hitl_required` or `needs_review` on anything else is a hard stop.
 */
function annexExportReviewBlocked(docs) {
  return (docs || []).filter((d) => {
    if (!d || d.status === 'confirmed') return false;
    const routing = d.extracted_data?.validation?.routing ?? null;
    return Boolean(d.needs_review) || routing === 'hitl_required';
  });
}

function refuseAnnexIfNeedsReview(docs) {
  const blocked = annexExportReviewBlocked(docs);
  if (!blocked.length) return;
  const n = blocked.length;
  const err = new Error(
    n === 1
      ? '1 document necesită verificare. Deschide Verifică / Confirmă înainte de anexă.'
      : `${n} documente necesită verificare. Deschide Verifică / Confirmă înainte de anexă.`,
  );
  err.status = 409;
  err.code = 'NEEDS_REVIEW';
  err.blocked = blocked.map((d) => ({
    id: d.id,
    filename: d.original_filename,
    routing: d.extracted_data?.validation?.routing ?? null,
    needs_review: d.needs_review,
  }));
  throw err;
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
  refuseAnnexIfNeedsReview(avize);
  const template = serializeRow(tmpl.rows[0]);
  const report = buildReport({ template, documents: avize });
  // The annex keeps its exact agreed shape here, no totals row on the legacy path.
  // report.columns already includes Editează Include-în-XLSX weight column choices.
  const columns = report.columns;
  const workbook = renderReportWorkbook({
    name: template.name || 'Anexa',
    columns,
    rows: report.rows,
    totals: null,
  });
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = String(tmpl.rows[0].name || 'Anexa').replace(/[^\w-]+/g, '_').slice(0, 40);
  return { buffer, filename: `${safeName}-${stamp}.xlsx`, template, avize, columns, report };
}

/**
 * Strip trailing `*` from stored catalog codes (separator belongs only in Observații joins).
 * Drops the starred row when the clean code already exists.
 */
async function repairObservationCodeStars(companyId) {
  const listed = await query(
    `SELECT id, code, label FROM aviz_observation_codes WHERE company_id = $1`,
    [companyId]
  );
  for (const row of listed.rows || []) {
    const cleaned = normalizeObservationCode(row.code);
    if (!cleaned || cleaned === row.code) continue;
    if (!isValidObservationCodeFormat(cleaned)) continue;
    try {
      await query(
        `UPDATE aviz_observation_codes
         SET code = $1, label = COALESCE(NULLIF(TRIM(label), ''), $2)
         WHERE id = $3 AND company_id = $4`,
        [cleaned, row.label || cleaned, row.id, companyId]
      );
    } catch (err) {
      if (!isPgUniqueViolation(err)) throw err;
      await query(
        `DELETE FROM aviz_observation_codes WHERE id = $1 AND company_id = $2`,
        [row.id, companyId]
      );
    }
  }
}

async function ensureObservationCodes(companyId) {
  await repairObservationCodeStars(companyId);
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
    await failStaleUploadedAvize(req.user.company_id).catch(() => {});
    const filters = {
      companyId: req.user.company_id,
      from: req.query.from,
      to: req.query.to,
      status: req.query.status,
      q: req.query.q,
      uploadedFrom: req.query.uploaded_from,
      dateField: req.query.date_field,
    };
    const { sql, params, page } = buildAvizListQuery({
      ...filters,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    const countQ = buildAvizCountQuery(filters);
    const [result, countResult, routeRules] = await Promise.all([
      query(sql, params),
      query(countQ.sql, countQ.params),
      listRouteRules(query, req.user.company_id).catch(() => []),
    ]);
    const pageRows = result.rows.map((row) => decorateAviz(row, { routeRules }));
    // Duplicate flag must see siblings off-page: same PSL under the same TPO on page 2
    // still has to light up the badge on page 1.
    const tpos = [...new Set(
      pageRows.map((r) => String(r.numar_tpo || '').trim().toLowerCase()).filter(Boolean)
    )];
    let flagged = pageRows;
    if (tpos.length > 0) {
      const siblings = await query(
        `SELECT id, numar_tpo, numar_document_marfa, ruta_transport, data_efectuare_cursa,
                numar_auto, trip_id, extracted_data
         FROM aviz_documents
         WHERE company_id = $1 AND LOWER(numar_tpo) = ANY($2::text[])`,
        [req.user.company_id, tpos]
      );
      const byId = new Map(
        flagDuplicateTpos(siblings.rows.map((row) => decorateAviz(row, { routeRules })))
          .map((r) => [r.id, r.duplicate_tpo])
      );
      flagged = pageRows.map((r) => ({ ...r, duplicate_tpo: Boolean(byId.get(r.id)) }));
    } else {
      flagged = flagDuplicateTpos(pageRows);
    }
    // Keep the stored `numar_curse` (OCR / foaie / edit). Run-count derivation is for
    // annex export only — overwriting here made the Editează field snap back to 1.
    res.json({
      items: flagged,
      total: countResult.rows[0]?.total ?? 0,
      limit: page.limit,
      offset: page.offset,
    });
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
    if (!name) return res.status(400).json({ message: 'Dă un nume șablonului.' });
    if (!hasUsableColumns(req.body?.columns)) {
      return res.status(400).json({ message: 'Adaugă cel puțin o coloană în șablon.' });
    }
    const columns = normalizeTemplateColumns(req.body?.columns);
    const isDefault = Boolean(req.body?.is_default);
    const row = await withTransaction(async (client) => {
      await client.query(`SELECT id FROM companies WHERE id = $1 FOR UPDATE`, [req.user.company_id]);
      await assertTemplateNameFree(client, req.user.company_id, name);
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
    if (err.status === 409) return res.status(409).json({ message: err.message });
    if (isPgUniqueViolation(err)) return res.status(409).json({ message: TEMPLATE_NAME_TAKEN });
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Failed to create template' });
  }
});

router.put('/templates/:id', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Dă un nume șablonului.' });
    if (!hasUsableColumns(req.body?.columns)) {
      return res.status(400).json({ message: 'Adaugă cel puțin o coloană în șablon.' });
    }
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
      await assertTemplateNameFree(client, req.user.company_id, name, req.params.id);
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
    if (!row) return res.status(404).json({ message: 'Șablonul nu a fost găsit.' });
    res.json(serializeRow(row));
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ message: err.message });
    if (isPgUniqueViolation(err)) return res.status(409).json({ message: TEMPLATE_NAME_TAKEN });
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
      return res.status(404).json({ message: 'Șablonul nu a fost găsit.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to delete template' });
  }
});

/**
 * Fresh PDF with ≥2 distinct TRO/PSL in the text layer → one document per aviz.
 * A single aviz on several pages is left as one file. Re-extract never enters here.
 * @returns {Promise<object|null>} response payload, or null when the file stays one row
 */
async function extractSplitPdfUpload(req, { fileUrl, originalFilename }) {
  let split;
  try {
    split = await materializePdfPageFiles(fileUrl, {
      originalFilename,
      companyId: req.user.company_id,
    });
  } catch (err) {
    if (err instanceof PdfSplitError) throw err;
    // Unreadable / not a real PDF: fall through to the single-document path.
    return null;
  }
  if (!split?.files?.length) return null;

  const created = await withTransaction(async (client) => {
    const batch = await createAvizBatch(client, {
      companyId: req.user.company_id,
      userId: req.user.id,
      label: originalFilename,
    });
    const docs = [];
    for (const file of split.files) {
      const doc = (await client.query(
        `INSERT INTO aviz_documents (company_id, batch_id, document_type, file_url,
           original_filename, status, needs_review)
         VALUES ($1, $2, 'aviz', $3, $4, 'uploaded', TRUE) RETURNING *`,
        [req.user.company_id, batch.id, file.file_url, file.original_filename]
      )).rows[0];
      docs.push(doc);
      await logEvent(client, {
        companyId: req.user.company_id, documentId: doc.id, batchId: batch.id,
        userId: req.user.id, kind: 'uploaded', summary: file.original_filename,
        detail: { split_page: file.page, split_pages: split.pages, source_file_url: fileUrl },
      });
    }
    await logEvent(client, {
      companyId: req.user.company_id, documentId: null, batchId: batch.id,
      userId: req.user.id, kind: 'uploaded',
      summary: `Despărțit PDF în ${split.pages} avize`,
      detail: { split_pages: split.pages, source_file_url: fileUrl },
    });
    await client.query(
      `UPDATE document_batches SET file_count = $1 WHERE id = $2`,
      [docs.length, batch.id]
    );
    return { batchId: batch.id, docs };
  });

  const docIds = created.docs.map((d) => d.id);
  // Many children still outrun an interactive wait — background then.
  const background = created.docs.length >= interactiveOcrMaxPages();
  if (background) {
    extractBatchDocuments(req.user.company_id, created.batchId, req.user.id, {
      force: true,
      profileId: req.body?.profile_id,
      documentIds: docIds,
    }).catch((err) => console.error('[avize extract split background]', err?.message || err));
  } else {
    await extractBatchDocuments(req.user.company_id, created.batchId, req.user.id, {
      force: true,
      profileId: req.body?.profile_id,
      documentIds: docIds,
      timeoutMs: interactiveOcrTimeoutMs(1),
    });
  }

  const routeRules = await listRouteRules(query, req.user.company_id).catch(() => []);
  const rows = (await query(
    `SELECT * FROM aviz_documents WHERE company_id = $1 AND id = ANY($2::uuid[])
     ORDER BY created_at ASC, original_filename ASC`,
    [req.user.company_id, docIds]
  )).rows.map((row) => decorateAviz(row, { routeRules }));

  const first = rows[0];
  if (!first) return null;
  return {
    ...first,
    extraction_pending: background,
    pages: 1,
    split_pages: split.pages,
    documents: rows.map((r) => ({
      ...r,
      extraction_pending: background,
      split_pages: split.pages,
    })),
    reason: background ? 'split_background' : undefined,
    statusCode: background ? 202 : 200,
  };
}

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
      return res.status(400).json({ message: 'Trimite un fișier sau selectează un aviz existent.' });
    }

    // Mistral unreachable / misconfigured: refuse before the interactive wait.
    if (isOcrDown(await ocrCapability())) {
      return res.status(503).json({
        code: 'OCR_DOWN',
        message: 'Serviciul OCR nu răspunde. Verifică MISTRAL_API_KEY și conexiunea, apoi încearcă din nou.',
      });
    }

    // Fresh upload of a multi-page PDF: one aviz per page, never re-split on re-extract (`id`).
    if (!id && file_url) {
      const splitPayload = await extractSplitPdfUpload(req, {
        fileUrl: file_url,
        originalFilename: original_filename,
      });
      if (splitPayload) {
        const { statusCode, ...body } = splitPayload;
        return res.status(statusCode || 200).json(body);
      }
    }

    // Every aviz is read by one extractor: the profile engine in documents.js.
    // A document therefore has to belong to a batch before it can be read, rows uploaded from
    // this screen get one here, and rows that predate batches are attached to one on first use.
    let docId = id;
    let batchId = null;
    let storedFileUrl = file_url;

    if (id) {
      const existing = (await query(
        `SELECT id, batch_id, file_url, original_filename
         FROM aviz_documents WHERE id = $1 AND company_id = $2`,
        [id, req.user.company_id]
      )).rows[0];
      if (!existing) return res.status(404).json({ message: 'Avizul nu a fost găsit.' });
      storedFileUrl = file_url || existing.file_url;

      batchId = existing.batch_id || await withTransaction(async (client) => {
        const batch = await createAvizBatch(client, {
          companyId: req.user.company_id,
          userId: req.user.id,
          label: existing.original_filename,
        });
        await client.query(
          `UPDATE aviz_documents SET batch_id = $1, updated_at = NOW()
           WHERE id = $2 AND company_id = $3`,
          [batch.id, id, req.user.company_id]
        );
        await client.query(
          `UPDATE document_batches SET file_count = 1 WHERE id = $1`, [batch.id]
        );
        return batch.id;
      });
    } else {
      const created = await withTransaction(async (client) => {
        const batch = await createAvizBatch(client, {
          companyId: req.user.company_id,
          userId: req.user.id,
          label: original_filename,
        });
        const doc = (await client.query(
          `INSERT INTO aviz_documents (company_id, batch_id, document_type, file_url,
             original_filename, status, needs_review)
           VALUES ($1, $2, 'aviz', $3, $4, 'uploaded', TRUE) RETURNING id`,
          [req.user.company_id, batch.id, file_url, original_filename]
        )).rows[0];
        await logEvent(client, {
          companyId: req.user.company_id, documentId: doc.id, batchId: batch.id,
          userId: req.user.id, kind: 'uploaded', summary: original_filename,
        });
        await client.query(
          `UPDATE document_batches SET file_count = 1 WHERE id = $1`, [batch.id]
        );
        return { docId: doc.id, batchId: batch.id };
      });
      docId = created.docId;
      batchId = created.batchId;
    }

    const pages = await documentPageCount(storedFileUrl);
    // Re-extract (client sent `id`) and long scans never hold the HTTP request. A hard carnet
    // photo routinely hits OCR_TIMEOUT at the interactive budget; behind Cloudflare the tunnel
    // often drops earlier, so the UI never receives the 202 retry and stays on „Se re-extrage…”.
    // Background uses the full OCR_TIMEOUT_MS budget and the list polls until fields appear.
    const reextract = Boolean(req.body?.id);
    if (reextract || pages > interactiveOcrMaxPages()) {
      await query(
        `UPDATE aviz_documents SET status = 'uploaded', updated_at = NOW()
         WHERE id = $1 AND company_id = $2 AND status IN ('extracted', 'confirmed', 'uploaded')`,
        [docId, req.user.company_id]
      );
      extractBatchDocuments(req.user.company_id, batchId, req.user.id, {
        force: true,
        profileId: req.body?.profile_id,
        documentIds: [docId],
      }).catch((err) => console.error('[avize extract background]', err?.message || err));

      const pending = await query(
        `SELECT * FROM aviz_documents WHERE id = $1 AND company_id = $2`,
        [docId, req.user.company_id]
      );
      if (!pending.rows[0]) return res.status(404).json({ message: 'Avizul nu a fost găsit.' });
      return res.status(202).json({
        ...(await decorateAvizForCompany(pending.rows[0], req.user.company_id)),
        extraction_pending: true,
        pages,
        reason: reextract ? 'reextract_background' : 'long_document',
      });
    }

    const outcome = await extractBatchDocuments(req.user.company_id, batchId, req.user.id, {
      force: true,
      profileId: req.body?.profile_id,
      documentIds: [docId],
      // Somebody is watching a spinner, this one does not get the background budget.
      timeoutMs: interactiveOcrTimeoutMs(pages),
    });

    // Saying "re-extras" over a run that never read the page would be worse than the error.
    const failed = outcome.results?.find((r) => r.id === docId && r.error);
    if (failed) {
      const timedOut = failed.code === 'OCR_TIMEOUT';
      // Cold Paddle + auto-rotate often exceeds the interactive budget on the first photo.
      // Leaving a silent "uploaded" row forces a manual Re-extrage; continue with the full
      // background timeout instead and let the UI poll until fields appear.
      if (timedOut) {
        await query(
          `UPDATE aviz_documents SET status = 'uploaded', updated_at = NOW()
           WHERE id = $1 AND company_id = $2 AND status IN ('extracted', 'confirmed')`,
          [docId, req.user.company_id]
        );
        extractBatchDocuments(req.user.company_id, batchId, req.user.id, {
          force: true,
          profileId: req.body?.profile_id,
          documentIds: [docId],
        }).catch((err) => console.error('[avize extract background retry]', err?.message || err));

        const pending = await query(
          `SELECT * FROM aviz_documents WHERE id = $1 AND company_id = $2`,
          [docId, req.user.company_id]
        );
        if (!pending.rows[0]) return res.status(404).json({ message: 'Avizul nu a fost găsit.' });
        return res.status(202).json({
          ...(await decorateAvizForCompany(pending.rows[0], req.user.company_id)),
          extraction_pending: true,
          pages,
          reason: 'ocr_timeout_retry',
        });
      }
      return res.status(502).json({
        message: failed.error || 'Extragerea a eșuat',
      });
    }

    const result = await query(
      `SELECT * FROM aviz_documents WHERE id = $1 AND company_id = $2`,
      [docId, req.user.company_id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Avizul nu a fost găsit.' });

    const row = await decorateAvizForCompany(result.rows[0], req.user.company_id);
    row.duplicate_tpo = await duplicateConsignmentExists(query, {
      companyId: req.user.company_id,
      row,
      // Candidates are repaired too, so a stored row whose aviz number lives only in the OCR
      // text is compared by that number and not by the blank column.
      decorate: (other) => repairAvizFromStored(serializeRow(other)),
    });
    res.json(row);
  } catch (err) {
    if (err instanceof PdfSplitError) {
      return res.status(err.status || 400).json({ message: err.message, code: err.code });
    }
    console.error(err);
    res.status(500).json({ message: err.message || 'Extract failed' });
  }
});

router.post('/export', async (req, res) => {
  let flightKey = null;
  try {
    const templateId = req.body?.template_id;
    const avizIds = capAvizIds(req.body?.aviz_ids);
    if (!templateId) return res.status(400).json({ message: 'Alege un șablon pentru export.' });
    if (avizIds.length === 0) return res.status(400).json({ message: 'Selectează cel puțin un aviz' });

    const rate = hitRateLimit(exportHits, req.user.id, { max: 12, windowMs: 60_000 });
    if (!rate.ok) {
      return res.status(429).json({
        message: 'Prea multe exporturi. Așteaptă un moment, apoi încearcă din nou.',
      });
    }

    flightKey = annexExportKey(req.user.id, templateId, avizIds);
    if (exportInFlight.has(flightKey)) {
      return res.status(429).json({
        message: 'Același export e deja în curs. Așteaptă să se termine.',
      });
    }
    exportInFlight.set(flightKey, Date.now());

    const built = await buildAnnexBuffer(req.user.company_id, templateId, avizIds);
    const { buffer, filename } = built;
    await logAvizExport(req.user.company_id, req.user.id, {
      kind: 'xlsx', templateId, avizIds, filename, built,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    if (err?.code === 'NEEDS_REVIEW') {
      return res.status(409).json({
        code: err.code,
        message: err.message,
        blocked: err.blocked || [],
      });
    }
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Export failed' });
  } finally {
    if (flightKey) exportInFlight.delete(flightKey);
  }
});

router.post('/bulk-delete', async (req, res) => {
  try {
    const ids = capAvizIds(req.body?.ids);
    if (ids.length === 0) return res.status(400).json({ message: 'Selectează cel puțin un aviz' });

    const result = await withTransaction(async (client) => {
      const deleted = await client.query(
        `DELETE FROM aviz_documents
         WHERE company_id = $1 AND id = ANY($2::uuid[])
         RETURNING id, original_filename, numar_tpo, batch_id`,
        [req.user.company_id, ids]
      );
      // Events cascade-delete with the row; keep a company-level trail with document_id null
      // so „cine a șters ce” survives after the aviz is gone.
      for (const row of deleted.rows) {
        await logEvent(client, {
          companyId: req.user.company_id,
          documentId: null,
          batchId: row.batch_id,
          userId: req.user.id,
          kind: 'deleted',
          summary: row.original_filename || row.numar_tpo || row.id,
          detail: { aviz_id: row.id, numar_tpo: row.numar_tpo || null },
        });
      }
      return deleted;
    });

    res.json({
      deleted: result.rows.length,
      ids: result.rows.map((r) => r.id),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Bulk delete failed' });
  }
});

router.post('/bulk-confirm', async (req, res) => {
  try {
    const ids = capAvizIds(req.body?.ids);
    if (ids.length === 0) return res.status(400).json({ message: 'Selectează cel puțin un aviz' });
    const force = Boolean(req.body?.force);
    const forceReason = String(req.body?.force_reason || '').trim();

    const docs = (await query(
      `SELECT * FROM aviz_documents WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [req.user.company_id, ids]
    )).rows;

    const blocked = docs.filter((d) => {
      const routing = d.extracted_data?.validation?.routing;
      const needsHitl = d.needs_review || routing === 'hitl_required';
      return needsHitl && !force;
    });
    if (blocked.length) {
      return res.status(409).json({
        code: 'NEEDS_REVIEW',
        message: `${blocked.length} document(e) au nevoie de verificare (OCR/validare). Corectează-le sau, ca admin, trimite force cu motiv.`,
        blocked: blocked.map((d) => ({
          id: d.id,
          filename: d.original_filename,
          routing: d.extracted_data?.validation?.routing ?? null,
          needs_review: d.needs_review,
        })),
      });
    }
    if (force && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Doar un administrator poate forța confirmarea.' });
    }
    if (force && !forceReason) {
      return res.status(400).json({ message: 'La force este obligatoriu un motiv scurt.' });
    }

    const result = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE aviz_documents
         SET status = 'confirmed', needs_review = FALSE, updated_at = NOW()
         WHERE company_id = $1 AND id = ANY($2::uuid[]) AND status <> 'confirmed'
         RETURNING *`,
        [req.user.company_id, ids]
      );
      for (const row of updated.rows) {
        await logEvent(client, {
          companyId: req.user.company_id,
          documentId: row.id,
          batchId: row.batch_id,
          userId: req.user.id,
          kind: 'confirmed',
          summary: row.original_filename,
          detail: force ? { force: true, force_reason: forceReason } : undefined,
        });
      }
      return updated;
    });
    const routeRules = await listRouteRules(query, req.user.company_id).catch(() => []);
    res.json(flagDuplicateTpos(result.rows.map((row) => decorateAviz(row, { routeRules }))));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Bulk confirm failed' });
  }
});

/** Confirm one aviz (gates on validation / needs_review). */
router.post('/doc/:id/confirm', async (req, res) => {
  try {
    const force = Boolean(req.body?.force);
    const forceReason = String(req.body?.force_reason || '').trim();
    const doc = (await query(
      `SELECT * FROM aviz_documents WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id]
    )).rows[0];
    if (!doc) return res.status(404).json({ message: 'Aviz inexistent' });

    const routing = doc.extracted_data?.validation?.routing;
    const needsHitl = doc.needs_review || routing === 'hitl_required';
    if (needsHitl && !force) {
      return res.status(409).json({
        code: 'NEEDS_REVIEW',
        message: 'Documentul are câmpuri de verificat. Deschide verificarea HITL sau forțează ca admin.',
        routing: routing ?? null,
        needs_review: doc.needs_review,
        findings: doc.extracted_data?.validation?.findings ?? [],
      });
    }
    if (force && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Doar un administrator poate forța confirmarea.' });
    }
    if (force && !forceReason) {
      return res.status(400).json({ message: 'La force este obligatoriu un motiv scurt.' });
    }

    const updated = await withTransaction(async (client) => {
      const row = (await client.query(
        `UPDATE aviz_documents
         SET status = 'confirmed', needs_review = FALSE, updated_at = NOW()
         WHERE id = $1 AND company_id = $2
         RETURNING *`,
        [doc.id, req.user.company_id]
      )).rows[0];
      await logEvent(client, {
        companyId: req.user.company_id,
        documentId: doc.id,
        batchId: doc.batch_id,
        userId: req.user.id,
        kind: 'confirmed',
        summary: doc.original_filename,
        detail: force ? { force: true, force_reason: forceReason } : undefined,
      });
      return row;
    });

    res.json(await decorateAvizForCompany(updated, req.user.company_id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Confirmarea a eșuat' });
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
    const checked = validateObservationCodeInput({
      code: req.body?.code,
      label: req.body?.label,
    });
    if (!checked.ok) return res.status(400).json({ message: checked.message });

    const dup = await query(
      `SELECT id FROM aviz_observation_codes
       WHERE company_id = $1 AND UPPER(code) = $2
       LIMIT 1`,
      [req.user.company_id, checked.code]
    );
    if (dup.rows[0]) {
      return res.status(409).json({ message: `Codul „${checked.code}” există deja.` });
    }

    const result = await query(
      `INSERT INTO aviz_observation_codes (company_id, code, label, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.user.company_id, checked.code, checked.label, Number(req.body?.sort_order) || 0]
    );
    res.status(201).json(serializeRow(result.rows[0]));
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      return res.status(409).json({ message: 'Codul există deja.' });
    }
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
    if (!result.rows[0]) return res.status(404).json({ message: 'Codul nu a fost găsit.' });
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
    if (!to) return res.status(400).json({ message: 'Completează adresa de email a destinatarului.' });
    if (!templateId) return res.status(400).json({ message: 'Alege un șablon pentru export.' });
    if (avizIds.length === 0) return res.status(400).json({ message: 'Selectează cel puțin un aviz' });

    const built = await buildAnnexBuffer(req.user.company_id, templateId, avizIds);
    const { buffer, filename } = built;
    const sent = await sendEmail({
      to,
      subject: `Anexa Factura ${filename}`,
      text: `Anexa cu ${avizIds.length} aviz(e) este atașată.`,
      attachments: [{ filename, content: buffer }],
    });
    await logAvizExport(req.user.company_id, req.user.id, {
      kind: sent.stub ? 'email-stub' : 'email',
      templateId, avizIds, filename, built,
    });
    res.json({
      ...sent,
      filename,
      email_sent: !sent.stub,
      download: Boolean(sent.stub),
      content_base64: sent.stub ? buffer.toString('base64') : undefined,
      message: sent.stub
        ? 'Resend nu este configurat, emailul nu a fost trimis. Descarcă anexa manual.'
        : undefined,
    });
  } catch (err) {
    if (err?.code === 'NEEDS_REVIEW') {
      return res.status(409).json({
        code: err.code,
        message: err.message,
        blocked: err.blocked || [],
      });
    }
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Email failed' });
  }
});

router.post('/zip', async (req, res) => {
  try {
    const templateId = req.body?.template_id;
    const avizIds = capAvizIds(req.body?.aviz_ids);
    if (!templateId) return res.status(400).json({ message: 'Alege un șablon pentru export.' });
    if (avizIds.length === 0) return res.status(400).json({ message: 'Selectează cel puțin un aviz' });

    const built = await buildAnnexBuffer(req.user.company_id, templateId, avizIds);
    const { buffer, filename, avize } = built;
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
      kind: 'zip', templateId, avizIds, filename: zipName, built,
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('X-Aviz-Missing-Files', String(missing));
    res.send(zip);
  } catch (err) {
    if (err?.code === 'NEEDS_REVIEW') {
      return res.status(409).json({
        code: err.code,
        message: err.message,
        blocked: err.blocked || [],
      });
    }
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

/**
 * A draft invoice built from what the pricing engine computed.
 *
 * The amounts are the trip's `trip_charges`, the same lines the TPO is made of, not a figure
 * re-derived here. There used to be two money paths: the engine decomposed a trip into charges
 * while this endpoint summed `aviz_documents.valoare_tpo`, a column an operator types into. They
 * could disagree, and nothing compared them, so an invoice could go out on a number nothing had
 * recalculated.
 *
 * A trip with no charges is reported, never substituted. An invoice built on a figure of unknown
 * origin is worse than one that refuses to be built.
 */
router.post('/draft-invoice', async (req, res) => {
  try {
    const avizIds = capAvizIds(req.body?.aviz_ids);
    if (avizIds.length === 0) return res.status(400).json({ message: 'Selectează cel puțin un aviz' });

    const avize = await loadAvizeByIds(req.user.company_id, avizIds);
    const confirmed = pickConfirmedAvize(avize);
    if (confirmed.length === 0) {
      return res.status(400).json({ message: 'Selectează avize confirmate pentru ciornă' });
    }

    const tripIds = [...new Set(confirmed.map((row) => row.trip_id).filter(Boolean))];
    if (tripIds.length === 0) {
      return res.status(422).json({
        message: 'Niciun aviz din selecție nu e legat de o cursă, deci nu există TPO de facturat. '
          + 'Leagă avizele de curse întâi.',
      });
    }

    const [tripRows, chargeRows, companyRow] = await Promise.all([
      query(
        `SELECT id, tpo_number, cmr_number, tpo_total, consignee_name
         FROM trips WHERE company_id = $1 AND id = ANY($2::uuid[])`,
        [req.user.company_id, tripIds]
      ),
      query(
        `SELECT * FROM trip_charges WHERE company_id = $1 AND trip_id = ANY($2::uuid[])
         ORDER BY trip_id, created_at`,
        [req.user.company_id, tripIds]
      ),
      query('SELECT name, vat_regime FROM companies WHERE id = $1', [req.user.company_id]),
    ]);

    const chargesByTrip = new Map();
    for (const charge of chargeRows.rows) {
      if (!chargesByTrip.has(charge.trip_id)) chargesByTrip.set(charge.trip_id, []);
      chargesByTrip.get(charge.trip_id).push(charge);
    }

    const draft = buildInvoiceDraft(tripRows.rows, chargesByTrip, {
      vatRate: vatRateFor(companyRow.rows[0]),
    });

    if (draft.lines.length === 0) {
      return res.status(422).json({
        message: 'Niciuna dintre curse nu are TPO calculat, deci nu există ce factura.',
        warnings: draft.warnings,
      });
    }

    let clientName = String(req.body?.client_name || '').trim();
    if (!clientName) {
      const named = tripRows.rows.find((t) => t.consignee_name);
      clientName = String(named?.consignee_name || '').trim() || 'Client avize';
    }

    const pricedTrips = tripRows.rows.filter((t) => draft.priced_trip_ids.includes(t.id));

    const row = await withTransaction(async (client) => {
      const number = await allocateInvoiceNumber(client, req.user.company_id, 'TRX');
      const invoice = (await client.query(
        `INSERT INTO invoices (
           company_id, trip_id, series, number, client_name, issue_date,
           description, subtotal, vat_rate, vat_amount, total_amount,
           currency, status, efactura_status, notes, aviz_ids, source
         ) VALUES (
           $1, $2, 'TRX', $3, $4, CURRENT_DATE,
           $5, $6, $7, $8, $9,
           $10, 'draft', 'not_sent', $11, $12::uuid[], 'trip_charges'
         ) RETURNING *`,
        [
          req.user.company_id,
          headerTripId(draft.priced_trip_ids),
          number,
          clientName,
          describeDraft(pricedTrips),
          draft.subtotal,
          draft.vat_rate,
          draft.vat_amount,
          draft.total_amount,
          draft.currency,
          draft.warnings.length
            ? draft.warnings.map((w) => w.message).join(' ')
            : null,
          confirmed.map((r) => r.id),
        ]
      )).rows[0];

      for (const [index, line] of draft.lines.entries()) {
        await client.query(
          `INSERT INTO invoice_lines (company_id, invoice_id, trip_id, charge_id, seq,
             kind, code, label, reference, quantity, unit_amount, amount, currency)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            req.user.company_id, invoice.id, line.trip_id, line.charge_id, index,
            line.kind, line.code, line.label, line.reference,
            line.quantity, line.unit_amount, line.amount, line.currency,
          ]
        );
      }
      return invoice;
    });

    res.status(201).json({
      ...serializeRow(row),
      lines: draft.lines,
      warnings: draft.warnings,
    });
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

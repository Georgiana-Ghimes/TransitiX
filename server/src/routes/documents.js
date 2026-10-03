import { Router } from 'express';
import multer from 'multer';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { pool, query, withTransaction } from '../db.js';
import { serializeRow } from '../entities.js';
import { uploadRoot, publicUploadUrl } from '../uploadPath.js';
import { uniqueUploadFilename } from '../lib/concurrency.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import { backgroundOcrTimeoutMs, readDocumentText } from '../lib/ocr/readText.js';
import { lookupOcrText, storeOcrText } from '../lib/ocr/textCache.js';
import { applyCorrections, extractDocument, reExtract, summariseExtraction } from '../lib/ocr/extract.js';
import { validateAvizExtraction } from '../lib/ocr/validateAviz.js';
import { summariseFeedback } from '../lib/ocr/feedback.js';
import { normalizeBlock } from '../lib/ocr/ocrBlocks.js';
import { OCR_PROFILES, profilesFor } from '../lib/ocr/profiles.js';
import { normalizeGoodsUnit } from '../lib/avizTemplate.js';
import { isGenericCountUnit } from '../lib/ocr/fields.js';
import { ensureVehicleForPlate } from '../lib/fleet/plateRegistry.js';
import { ROUTING } from '../lib/ocr/avizFieldSchema.js';
import { materializePdfPageFiles, PdfSplitError } from '../lib/ocr/splitPdf.js';
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (req, file, cb) => cb(null, uniqueUploadFilename(file.originalname, { companyId: req.user?.company_id })),
});

/** Twenty avize at once is the stated requirement; the cap leaves headroom above it. */
export const MAX_BATCH_FILES = 40;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_BATCH_FILES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') {
      return cb(new Error('Doar imagini sau PDF sunt acceptate'));
    }
    cb(null, true);
  },
});

/**
 * Multer speaks English to developers: `Unexpected field`, `File too large`. A driver in a cab
 * reading that learns neither what went wrong nor what the limit is.
 *
 * @param {Error} err       the error multer handed back
 * @param {number} maxFiles how many files this route accepts, so the message can say so
 */
export function uploadErrorMessage(err, maxFiles = MAX_BATCH_FILES) {
  const mb = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);
  switch (err?.code) {
    case 'LIMIT_FILE_SIZE':
      return `Fișierul este prea mare. Limita este de ${mb} MB per fișier.`;
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return `Prea multe fișiere odată. Trimite maximum ${maxFiles} și repetă pentru restul.`;
    case 'LIMIT_PART_COUNT':
    case 'LIMIT_FIELD_COUNT':
      return 'Cererea conține prea multe câmpuri.';
    default:
      // The file-type refusal from `fileFilter` already reads as a sentence.
      return err?.message || 'Încărcarea nu a reușit. Încearcă din nou.';
  }
}

const router = Router();
export const uploadHits = new Map();

router.use(authRequired, officeRequired);

function sendError(res, err, fallback) {
  const status = err?.status || 500;
  if (status >= 500) console.error('[documents]', err);
  res.status(status).json({ message: err?.message || fallback });
}

export async function logEvent(client, { companyId, documentId, batchId, userId, kind, summary, detail }) {
  await client.query(
    `INSERT INTO document_events (company_id, document_id, batch_id, user_id, kind, summary, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [companyId, documentId ?? null, batchId ?? null, userId ?? null, kind, summary ?? null,
     detail == null ? null : JSON.stringify(detail)]
  );
}

/** Columns an extraction may write on a document row. */
const EXTRACT_COLUMNS = [
  'numar_tpo', 'data_efectuare_cursa', 'numar_auto', 'ruta_transport', 'tip_marfa',
  'cantitate_marfa', 'numar_document_marfa', 'gross_weight_kg', 'net_weight_kg',
  'pallets', 'quantity_unit',
  // The carnet writes `NR. CURSE` on the page. Without this the profile read it and `toColumns`
  // dropped it, so the row kept the column default and the driver's own count never arrived.
  'numar_curse',
  // Numbered sheet slots 3 / 12–14 (DRIVER_SHEET_GUIDE): optional annex figures the driver
  // may write. Without these columns a minimal "3. 450" line extracts and then vanishes.
  'valoare_tpo', 'taxe_suplimentare', 'km_parcursi', 'tarif_km',
];

/** Maps extractor field names onto the document columns. */
function toColumns(values) {
  const out = {};
  for (const [name, value] of Object.entries(values ?? {})) {
    if (name === 'quantity') out.cantitate_marfa = value;
    else if (EXTRACT_COLUMNS.includes(name)) out[name] = value;
  }
  // RAI Tip marfa expects the packaging unit; OCR often parks it only in quantity_unit.
  // A bare count is not a packaging unit, though. An aviz reading `Cantitate 768.00 buc` two
  // lines above `Numarul de galeti 768.00` is describing buckets both times, and only the
  // second says so — writing "bucati" onto the customer's annex puts a word there that names
  // nothing. Left empty instead, so the repair pass and the operator each still get a turn.
  if ((out.tip_marfa == null || String(out.tip_marfa).trim() === '')
      && out.quantity_unit && !isGenericCountUnit(out.quantity_unit)) {
    out.tip_marfa = normalizeGoodsUnit(out.quantity_unit) || String(out.quantity_unit).trim();
  }
  return out;
}

/** One batch at a time, parallel driver uploads must not OCR the same rows twice. */
const batchExtractChains = new Map();

function runBatchExtract(batchKey, fn) {
  const prev = batchExtractChains.get(batchKey) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn).finally(() => {
    if (batchExtractChains.get(batchKey) === next) batchExtractChains.delete(batchKey);
  });
  batchExtractChains.set(batchKey, next);
  return next;
}

export async function markExtractFailed(companyId, docId, err) {
  const message = err?.code === 'OCR_TIMEOUT'
    ? 'OCR a depășit timpul alocat. Folosește Re-extrage.'
    : (err?.message || String(err));
  await query(
    `UPDATE aviz_documents SET
       status = 'extracted',
       needs_review = TRUE,
       extraction_source = 'none',
       extracted_data = COALESCE(extracted_data, '{}'::jsonb) || $1::jsonb,
       updated_at = NOW()
     WHERE id = $2 AND company_id = $3 AND status = 'uploaded'`,
    [JSON.stringify({ extract_error: message }), docId, companyId]
  );
}

/**
 * Uploads whose OCR job never came back (process restart, hung sidecar) stay on
 * „Se procesează…” forever. After a short grace (not the full 5‑minute background
 * budget), treat them as failed so the driver/office can Re-extrage instead of
 * staring at a spinner.
 *
 * Do not shield „in-flight” rows from this. 1.13.2 did, and a job waiting on Paddle
 * (or stuck behind another) kept the spinner forever — fail-stale skipped it, and the
 * driver never got Eșuat. A late OCR answer still cannot overwrite: the success UPDATE
 * requires status='uploaded', so an already-failed row stays failed.
 */
export async function failStaleUploadedAvize(companyId, {
  olderThanMs = Number(process.env.OCR_STALE_UPLOADED_MS) || 90_000,
} = {}) {
  if (!companyId) return { failed: 0 };
  const message = 'OCR nu a terminat la timp. Folosește Re-extrage.';
  // `updated_at`, not `created_at`: a re-extract flips an old row back to `uploaded`, and the
  // original upload day would otherwise make this fire immediately — or never, if we keyed
  // only on create and a hung re-extract left „Se procesează…” forever.
  const result = await query(
    `UPDATE aviz_documents SET
       status = 'extracted',
       needs_review = TRUE,
       extraction_source = 'none',
       extracted_data = COALESCE(extracted_data, '{}'::jsonb) || $1::jsonb,
       updated_at = NOW()
     WHERE company_id = $2
       AND status = 'uploaded'
       AND updated_at < NOW() - ($3 * INTERVAL '1 millisecond')
     RETURNING id`,
    [JSON.stringify({ extract_error: message }), companyId, olderThanMs]
  );
  return { failed: result.rowCount || 0 };
}

/**
 * Runs OCR over every document in a batch that has not been extracted yet.
 * Shared by the office extract endpoint and the driver upload path.
 *
 * @param {string[]} [options.documentIds]  When set (driver upload), only these rows are OCR'd,
 *   not every other stuck `uploaded` row still sitting in the open batch.
 */
export async function extractBatchDocuments(companyId, batchId, userId, {
  force = false,
  profileId,
  documentIds,
  timeoutMs,
} = {}) {
  const batchKey = `${companyId}:${batchId}`;
  const targetIds = Array.isArray(documentIds) ? [...documentIds] : [];
  return runBatchExtract(batchKey, async () => {
  try {
  // Opportunistic: clear rows that never left „Se procesează…” after the budget window.
  await failStaleUploadedAvize(companyId).catch(() => {});

  let docs = (await query(
    `SELECT * FROM aviz_documents WHERE company_id = $1 AND batch_id = $2 ORDER BY created_at`,
    [companyId, batchId]
  )).rows;

  if (targetIds.length) {
    const wanted = new Set(targetIds);
    docs = docs.filter((d) => wanted.has(d.id));
  }

  const results = [];
  for (const doc of docs) {
    if (!force && doc.status !== 'uploaded') {
      results.push({ id: doc.id, skipped: true, reason: 'already_extracted' });
      continue;
    }
    // Profile set but still `uploaded` means a previous run wrote fields then crashed
    // before flipping status — or a bad skip left the spinner on. Re-run, don't skip.
    if (doc.ocr_profile_id && !force && doc.status !== 'uploaded') {
      results.push({
        id: doc.id,
        skipped: true,
        ...summariseExtraction({
          profile_id: doc.ocr_profile_id,
          confidence: Number(doc.ocr_confidence ?? 0),
          status: doc.needs_review ? 'review' : 'ok',
          needs_review: doc.needs_review,
          fields: {},
        }),
      });
      continue;
    }

    // Re-extract: show "Se procesează…" and let the office list poll. Confirmed must drop too,
    // rewriting OCR fields while leaving "Confirmat" would let unreviewed data go to billing.
    if (force && (doc.status === 'extracted' || doc.status === 'confirmed')) {
      await query(
        `UPDATE aviz_documents SET status = 'uploaded', updated_at = NOW()
         WHERE id = $1 AND company_id = $2 AND status IN ('extracted', 'confirmed')`,
        [doc.id, companyId]
      );
      doc.status = 'uploaded';
    }

    // The SELECT above can be minutes old by the time a row's turn comes. A row failed,
    // filled in by hand or deleted meanwhile would have its answer discarded — skip the OCR.
    const live = await query(
      `SELECT status FROM aviz_documents WHERE id = $1 AND company_id = $2`,
      [doc.id, companyId]
    );
    if (live.rows[0]?.status !== 'uploaded') {
      results.push({ id: doc.id, filename: doc.original_filename, skipped: true, reason: 'already_settled' });
      continue;
    }

    try {
      // Bytes already transcribed are not read again. „Re-extrage" (`force`) only accepts a
      // cached read that found a logistics code — a weak transcript is the reason somebody
      // pressed the button, so that one goes back to the sidecar.
      let text = await lookupOcrText(companyId, doc.file_url, { strongOnly: force });
      if (text) {
        console.info(`[documents] ${doc.id} text reused from cache (${text.text.length}ch, ${text.source})`);
      } else {
        text = await readDocumentText(doc.file_url, { timeoutMs });
        await storeOcrText(companyId, doc.file_url, text);
      }
      const extraction = extractDocument(text.text, {
        documentType: doc.document_type,
        profileId,
      });

      const corrected = doc.corrected_fields ?? [];
      const merged = corrected.length
        ? reExtract(text.text, {
          documentType: doc.document_type,
          profileId,
          corrections: doc.extracted_data?.values ?? {},
          correctedFields: corrected,
        })
        : extraction;

      // Route is structural only: Expeditor + Adresa de livrare slices (no LLM).
      const columns = toColumns(merged.values);
      const fieldsForValidation = { ...(merged.fields || {}) };
      if (fieldsForValidation.quantity && !fieldsForValidation.cantitate_marfa) {
        fieldsForValidation.cantitate_marfa = fieldsForValidation.quantity;
      }
      const validation = await validateAvizExtraction({
        values: {
          ...merged.values,
          ...columns,
          cantitate_marfa: columns.cantitate_marfa ?? merged.values.quantity ?? merged.values.cantitate_marfa,
        },
        fields: fieldsForValidation,
        companyId,
        documentId: doc.id,
        queryFn: query,
      });
      const needsReview = Boolean(validation.needs_review);
      const sets = Object.keys(columns).map((c, i) => `${c} = $${i + 7}`);

      // Only commit while the row is still `uploaded`. failStale / markExtractFailed may have
      // already flipped it to Eșuat; a late OCR answer must not silently fill fields.
      const written = await withTransaction(async (client) => {
        const update = await client.query(
          `UPDATE aviz_documents SET
             ocr_profile_id = $1, ocr_confidence = $2, field_confidence = $3,
             needs_review = $4, extraction_source = $5,
             extracted_data = COALESCE(extracted_data, '{}'::jsonb) || $6::jsonb
             ${sets.length ? `, ${sets.join(', ')}` : ''},
             status = 'extracted',
             updated_at = NOW()
           WHERE id = $${7 + Object.keys(columns).length}
             AND company_id = $${8 + Object.keys(columns).length}
             AND status = 'uploaded'
           RETURNING id`,
          [
            merged.profile_id, merged.confidence,
            JSON.stringify(merged.fields), needsReview, text.source,
            JSON.stringify({
              raw_text: text.text,
              values: merged.values,
              review_fields: merged.review_fields,
              validation,
              ...(Array.isArray(text.blocks) && text.blocks.length
                ? { ocr_blocks: text.blocks }
                : {}),
              ...(text.pages ? { pages: text.pages } : {}),
              ...(text.truncated ? { pages_truncated: true } : {}),
            }),
            ...Object.values(columns),
            doc.id, companyId,
          ]
        );
        if (!update.rowCount) return null;

        // A plate the OCR just read opens a vehicle record, inside this transaction, so a
        // document and the lorry it names cannot land on opposite sides of a failure. A filing
        // problem never fails the extraction though: the document is what the operator sent.
        let registeredPlate = null;
        try {
          const { vehicle, created } = await ensureVehicleForPlate(
            client, companyId, columns.numar_auto,
          );
          if (created) registeredPlate = vehicle.plate;
        } catch (err) {
          console.error('[documents] plăcuța nu a putut fi înregistrată', err);
        }

        await logEvent(client, {
          companyId, documentId: doc.id, batchId,
          userId, kind: doc.ocr_profile_id ? 're_extracted' : 'extracted',
          summary: merged.profile_name ?? 'nerecunoscut',
          detail: {
            confidence: merged.confidence,
            review_fields: merged.review_fields,
            routing: validation.routing,
            failed_rules: validation.failed_rules,
            text_source: text.source,
            text_cached: Boolean(text.cached),
            pages: text.pages ?? null,
            pages_truncated: Boolean(text.truncated),
            ...(registeredPlate ? { vehicle_registered: registeredPlate } : {}),
          },
        });
        return update.rows[0];
      });

      if (!written) {
        results.push({
          id: doc.id,
          filename: doc.original_filename,
          skipped: true,
          reason: 'already_settled',
        });
        continue;
      }

      results.push({
        id: doc.id,
        filename: doc.original_filename,
        ...summariseExtraction({ ...merged, needs_review: needsReview }),
        routing: validation.routing,
        failed_rules: validation.failed_rules,
      });
    } catch (err) {
      const timedOut = err?.code === 'OCR_TIMEOUT';
      // Interactive path pins a short `timeoutMs` and /avize/extract retries in background.
      // Background path leaves `timeoutMs` unset — if that clock also expires, mark failed or
      // the row stays on „Se procesează…” forever.
      const backgroundBudget = timeoutMs == null;
      if (timedOut) console.warn('[documents] extract doc', doc.id, err);
      else console.error('[documents] extract doc', doc.id, err);
      if (!timedOut || backgroundBudget) {
        await markExtractFailed(companyId, doc.id, err).catch(() => {});
      }
      results.push({
        id: doc.id,
        filename: doc.original_filename,
        error: err?.message || 'extract_failed',
        code: err?.code || null,
      });
    }
  }

  // A batch only ever moves forward. Extraction now runs in the background for driver uploads,
  // so a confirmation that lands while OCR is still working would otherwise be undone by this
  // line the moment the last page finishes, the operator's decision quietly reverted.
  await query(
    `UPDATE document_batches SET status = 'extracted', updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND status IN ('uploaded', 'extracted')`,
    [batchId, companyId]
  );

  return {
    batch_id: batchId,
    extracted: results.filter((r) => !r.skipped && !r.error).length,
    needs_review: results.filter((r) => r.needs_review).length,
    results,
  };
  } catch (err) {
    // A throw outside the per-doc try left every row on „Se procesează…” forever.
    console.error('[documents] extract batch', batchId, err?.message || err);
    const toFail = targetIds.length
      ? targetIds
      : (await query(
        `SELECT id FROM aviz_documents WHERE company_id = $1 AND batch_id = $2 AND status = 'uploaded'`,
        [companyId, batchId]
      )).rows.map((r) => r.id);
    await Promise.all(toFail.map((id) => markExtractFailed(companyId, id, err).catch(() => {})));
    throw err;
  }
  });
}

/** The profiles available, so the review screen can offer an override. */
router.get('/profiles', (req, res) => {
  const list = profilesFor(req.query.type).map((p) => ({
    id: p.id,
    name: p.name,
    document_type: p.documentType,
    fields: Object.keys(p.fields ?? {}),
  }));
  res.json({ profiles: list, total: OCR_PROFILES.length });
});

/** Multi-file upload. Creates a batch and one document row per file. */
router.post('/batches', (req, res) => {
  const limit = hitRateLimit(uploadHits, req.user.company_id, { max: 20, windowMs: 60_000 });
  if (!limit.ok) {
    return res.status(429).json({ message: 'Prea multe încărcări. Reîncearcă într-un minut.' });
  }

  upload.array('files', MAX_BATCH_FILES)(req, res, async (err) => {
    if (err) return res.status(400).json({ message: uploadErrorMessage(err, MAX_BATCH_FILES) });
    const files = req.files ?? [];
    if (!files.length) return res.status(400).json({ message: 'Niciun fișier încărcat' });

    try {
      const documentType = ['aviz', 'cmr', 'other'].includes(req.body?.document_type)
        ? req.body.document_type
        : 'aviz';

      // Multi-page PDFs become one row per page before the batch is opened, so file_count
      // matches what the extractor will actually see.
      const entries = [];
      for (const file of files) {
        const fileUrl = publicUploadUrl(file.filename);
        let split = null;
        if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '')) {
          try {
            split = await materializePdfPageFiles(fileUrl, {
              originalFilename: file.originalname,
              companyId: req.user.company_id,
            });
          } catch (splitErr) {
            if (splitErr instanceof PdfSplitError) throw splitErr;
            split = null;
          }
        }
        if (split?.files?.length) {
          for (const page of split.files) {
            entries.push({
              file_url: page.file_url,
              original_filename: page.original_filename,
              detail: {
                size: file.size,
                mimetype: file.mimetype,
                split_page: page.page,
                split_pages: split.pages,
                source_file_url: fileUrl,
              },
            });
          }
        } else {
          entries.push({
            file_url: fileUrl,
            original_filename: file.originalname,
            detail: { size: file.size, mimetype: file.mimetype },
          });
        }
      }
      if (entries.length > MAX_BATCH_FILES) {
        throw Object.assign(
          new Error(
            `După despărțirea PDF-urilor ar fi ${entries.length} avize. `
            + `Maximum este ${MAX_BATCH_FILES} odată — încarcă mai puține fișiere.`
          ),
          { status: 400 }
        );
      }

      const result = await withTransaction(async (client) => {
        const batch = (await client.query(
          `INSERT INTO document_batches (company_id, user_id, document_type, label, file_count)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [req.user.company_id, req.user.id, documentType, req.body?.label ?? null, entries.length]
        )).rows[0];

        const documents = [];
        for (const entry of entries) {
          const doc = (await client.query(
            `INSERT INTO aviz_documents (company_id, batch_id, document_type, file_url,
               original_filename, status, needs_review)
             VALUES ($1,$2,$3,$4,$5,'uploaded',TRUE) RETURNING *`,
            [req.user.company_id, batch.id, documentType,
             entry.file_url, entry.original_filename]
          )).rows[0];
          documents.push(doc);
          await logEvent(client, {
            companyId: req.user.company_id, documentId: doc.id, batchId: batch.id,
            userId: req.user.id, kind: 'uploaded', summary: entry.original_filename,
            detail: entry.detail,
          });
        }
        const splitCount = entries.filter((e) => e.detail?.split_pages).length;
        if (splitCount > 0) {
          await logEvent(client, {
            companyId: req.user.company_id, documentId: null, batchId: batch.id,
            userId: req.user.id, kind: 'uploaded',
            summary: `Lot cu PDF-uri despărțite (${documents.length} avize)`,
            detail: { file_count: documents.length, uploaded_files: files.length },
          });
        }
        return { batch, documents };
      });

      res.status(201).json({
        batch: serializeRow(result.batch),
        documents: result.documents.map(serializeRow),
      });
    } catch (error) {
      sendError(res, error, 'Crearea lotului a eșuat');
    }
  });
});

/** Runs OCR over every document in a batch that has not been extracted yet. */
router.post('/batches/:id/extract', async (req, res) => {
  try {
    const batch = (await query(
      'SELECT * FROM document_batches WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.company_id]
    )).rows[0];
    if (!batch) return res.status(404).json({ message: 'Lot inexistent' });

    const result = await extractBatchDocuments(req.user.company_id, batch.id, req.user.id, {
      force: Boolean(req.body?.force),
      profileId: req.body?.profile_id,
    });
    res.json(result);
  } catch (err) {
    sendError(res, err, 'Extragerea a eșuat');
  }
});

/** Batch with its documents, the review list. */
router.get('/batches/:id', async (req, res) => {
  try {
    const batch = (await query(
      'SELECT * FROM document_batches WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.company_id]
    )).rows[0];
    if (!batch) return res.status(404).json({ message: 'Lot inexistent' });

    const docs = (await query(
      `SELECT * FROM aviz_documents WHERE company_id = $1 AND batch_id = $2 ORDER BY created_at`,
      [req.user.company_id, batch.id]
    )).rows;

    res.json({
      batch: serializeRow(batch),
      documents: docs.map(serializeRow),
      needs_review: docs.filter((d) => d.needs_review).length,
    });
  } catch (err) {
    sendError(res, err, 'Nu am putut încărca lotul');
  }
});

router.get('/batches', async (req, res) => {
  try {
    const rows = await query(
      `SELECT b.*, (SELECT count(*) FROM aviz_documents d
                    WHERE d.batch_id = b.id AND d.needs_review) AS review_count
       FROM document_batches b
       WHERE b.company_id = $1
       ORDER BY b.created_at DESC LIMIT 100`,
      [req.user.company_id]
    );
    res.json({ batches: rows.rows.map(serializeRow) });
  } catch (err) {
    sendError(res, err, 'Nu am putut încărca loturile');
  }
});

/** HITL queue: documents that need human review after validation. */
router.get('/review-queue', async (req, res) => {
  try {
    const routing = String(req.query.routing || '').trim();
    const params = [req.user.company_id];
    let routingFilter = '';
    if (routing === ROUTING.HITL_REQUIRED || routing === ROUTING.HITL_OPTIONAL) {
      params.push(routing);
      routingFilter = `AND extracted_data->'validation'->>'routing' = $${params.length}`;
    }
    const rows = await query(
      `SELECT id, original_filename, file_url, status, needs_review, ocr_confidence,
              field_confidence, numar_tpo, numar_auto, data_efectuare_cursa,
              extracted_data, created_at, updated_at, uploaded_from
       FROM aviz_documents
       WHERE company_id = $1
         AND status IN ('extracted', 'uploaded')
         AND (
           needs_review = TRUE
           OR extracted_data->'validation'->>'routing' IN ('hitl_required', 'hitl_optional')
         )
         ${routingFilter}
       ORDER BY
         CASE extracted_data->'validation'->>'routing'
           WHEN 'hitl_required' THEN 0
           WHEN 'hitl_optional' THEN 1
           ELSE 2
         END,
         updated_at DESC
       LIMIT 200`,
      params
    );
    res.json({
      documents: rows.rows.map((row) => {
        const validation = row.extracted_data?.validation ?? null;
        return {
          id: row.id,
          original_filename: row.original_filename,
          file_url: row.file_url,
          status: row.status,
          needs_review: row.needs_review,
          ocr_confidence: row.ocr_confidence,
          numar_tpo: row.numar_tpo,
          numar_auto: row.numar_auto,
          data_efectuare_cursa: row.data_efectuare_cursa,
          routing: validation?.routing ?? (row.needs_review ? ROUTING.HITL_REQUIRED : ROUTING.AUTO),
          findings: validation?.findings ?? [],
          review_fields: row.extracted_data?.review_fields ?? [],
          uploaded_from: row.uploaded_from,
          updated_at: row.updated_at,
        };
      }),
    });
  } catch (err) {
    sendError(res, err, 'Nu am putut încărca coada de verificare');
  }
});

/**
 * Faza 4 — feedback loop. Aggregates `corrected` events over a window against the
 * documents extracted in it. Read by a person; nothing is tuned automatically.
 */
router.get('/feedback', async (req, res) => {
  try {
    const DAY = 'YYYY-MM-DD';
    const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const to = isDay(req.query.to) ? String(req.query.to) : new Date().toISOString().slice(0, 10);
    let from = isDay(req.query.from) ? String(req.query.from) : null;
    if (!from) {
      const d = new Date(`${to}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 30);
      from = d.toISOString().slice(0, 10);
    }
    if (from > to) return res.status(400).json({ message: `Interval invalid (${DAY}): „de la” e după „până la”.` });

    const [docs, events] = await Promise.all([
      query(
        `SELECT id, status,
                extracted_data->'validation'->>'routing' AS routing,
                extracted_data->'validation'->'failed_rules' AS failed_rules
         FROM aviz_documents
         WHERE company_id = $1
           AND status <> 'uploaded'
           AND created_at >= $2::date
           AND created_at < ($3::date + INTERVAL '1 day')`,
        [req.user.company_id, from, to]
      ),
      query(
        `SELECT e.document_id, e.detail, e.created_at, u.name AS user_name, u.email AS user_email
         FROM document_events e
         LEFT JOIN users u ON u.id = e.user_id
         WHERE e.company_id = $1
           AND e.kind = 'corrected'
           AND e.created_at >= $2::date
           AND e.created_at < ($3::date + INTERVAL '1 day')`,
        [req.user.company_id, from, to]
      ),
    ]);

    const documents = docs.rows.map((r) => ({
      id: r.id,
      status: r.status,
      routing: r.routing ?? null,
      failed_rules: Array.isArray(r.failed_rules) ? r.failed_rules : [],
    }));
    res.json({ window: { from, to }, ...summariseFeedback({ events: events.rows, documents }) });
  } catch (err) {
    sendError(res, err, 'Nu am putut calcula calitatea OCR');
  }
});

/** HITL payload for one document (values, scores, failed rules, blocks). */
router.get('/:id/review', async (req, res) => {
  try {
    const doc = (await query(
      'SELECT * FROM aviz_documents WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.company_id]
    )).rows[0];
    if (!doc) return res.status(404).json({ message: 'Document inexistent' });

    const validation = doc.extracted_data?.validation ?? null;
    const fields = doc.field_confidence ?? {};
    // Column values go through the same serializer as the row: pg hands a DATE back as local
    // midnight, and the raw object would reach the input as `…T21:00:00.000Z`, the day before.
    const row = serializeRow(doc);
    const values = {
      ...(doc.extracted_data?.values ?? {}),
      numar_tpo: row.numar_tpo,
      numar_auto: row.numar_auto,
      data_efectuare_cursa: row.data_efectuare_cursa,
      ruta_transport: row.ruta_transport,
      tip_marfa: row.tip_marfa,
      cantitate_marfa: row.cantitate_marfa,
      numar_document_marfa: row.numar_document_marfa,
      gross_weight_kg: row.gross_weight_kg,
      net_weight_kg: row.net_weight_kg,
      numar_curse: row.numar_curse,
      km_parcursi: row.km_parcursi,
      tarif_km: row.tarif_km,
      valoare_tpo: row.valoare_tpo,
      taxe_suplimentare: row.taxe_suplimentare,
      observatii: row.observatii,
    };

    const findings = validation?.findings ?? [];
    const issues = findings.map((f) => ({
      field: f.field,
      rule: f.rule,
      severity: f.severity,
      title: f.title,
      message: f.message,
      source: f.source || 'rule_failed',
      confidence: f.field && fields[f.field]?.confidence != null
        ? fields[f.field].confidence
        : null,
      value: f.field ? values[f.field] ?? null : null,
    }));

    res.json({
      document: row,
      values,
      fields,
      validation,
      issues,
      review_fields: doc.extracted_data?.review_fields ?? [],
      // Rows extracted before blocks were normalised still carry the provider's raw shape;
      // normalising on the way out means the drawer never sees two spellings of a bbox.
      ocr_blocks: Array.isArray(doc.extracted_data?.ocr_blocks)
        ? doc.extracted_data.ocr_blocks.map((b) => normalizeBlock(
          b,
          Number.isInteger(b?.page) ? b.page : 0,
          { width: b?.page_width, height: b?.page_height },
        ))
        : null,
      routing: validation?.routing ?? (doc.needs_review ? ROUTING.HITL_REQUIRED : ROUTING.AUTO),
    });
  } catch (err) {
    sendError(res, err, 'Nu am putut încărca detaliile de verificare');
  }
});

/** Clears review flag after operator verified (does not Confirm). */
router.post('/:id/approve-review', async (req, res) => {
  try {
    const doc = (await query(
      'SELECT * FROM aviz_documents WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.company_id]
    )).rows[0];
    if (!doc) return res.status(404).json({ message: 'Document inexistent' });

    const updated = await withTransaction(async (client) => {
      const prevValidation = doc.extracted_data?.validation ?? {};
      const row = (await client.query(
        `UPDATE aviz_documents SET
           needs_review = FALSE,
           extracted_data = COALESCE(extracted_data, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
         WHERE id = $2 AND company_id = $3
         RETURNING *`,
        [
          JSON.stringify({
            validation: {
              ...prevValidation,
              routing: ROUTING.AUTO,
              needs_review: false,
              approved_at: new Date().toISOString(),
              approved_by: req.user.id,
            },
          }),
          doc.id,
          req.user.company_id,
        ]
      )).rows[0];
      await logEvent(client, {
        companyId: req.user.company_id,
        documentId: doc.id,
        batchId: doc.batch_id,
        userId: req.user.id,
        kind: 'review_approved',
        summary: doc.original_filename,
        detail: { previous_routing: prevValidation.routing ?? null },
      });
      return row;
    });

    res.json({ document: serializeRow(updated), needs_review: false });
  } catch (err) {
    sendError(res, err, 'Aprobarea verificării a eșuat');
  }
});

/** Operator corrections on one document. */
router.put('/:id/corrections', async (req, res) => {
  try {
    const doc = (await query(
      'SELECT * FROM aviz_documents WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.company_id]
    )).rows[0];
    if (!doc) return res.status(404).json({ message: 'Document inexistent' });

    const corrections = req.body?.corrections ?? {};
    if (!Object.keys(corrections).length) {
      return res.status(400).json({ message: 'Nicio corecție trimisă' });
    }

    const current = {
      profile_id: doc.ocr_profile_id,
      profile_name: null,
      fields: doc.field_confidence ?? {},
      values: doc.extracted_data?.values ?? {},
      confidence: Number(doc.ocr_confidence ?? 0),
      status: doc.needs_review ? 'review' : 'ok',
      review_fields: doc.extracted_data?.review_fields ?? [],
    };
    const previousValues = { ...(doc.extracted_data?.values ?? {}) };
    for (const col of [
      'numar_tpo', 'numar_auto', 'data_efectuare_cursa', 'ruta_transport',
      'tip_marfa', 'cantitate_marfa', 'numar_document_marfa', 'gross_weight_kg',
      'net_weight_kg', 'numar_curse', 'km_parcursi', 'tarif_km', 'valoare_tpo',
      'taxe_suplimentare', 'observatii',
    ]) {
      if (doc[col] != null && previousValues[col] === undefined) previousValues[col] = doc[col];
    }

    const merged = applyCorrections(current, corrections, { previouslyCorrected: doc.corrected_fields ?? [] });
    const columns = toColumns(merged.values);
    const fieldsForValidation = { ...(merged.fields || {}) };
    if (fieldsForValidation.quantity && !fieldsForValidation.cantitate_marfa) {
      fieldsForValidation.cantitate_marfa = fieldsForValidation.quantity;
    }
    const validation = await validateAvizExtraction({
      values: { ...previousValues, ...merged.values, ...columns },
      fields: fieldsForValidation,
      companyId: req.user.company_id,
      documentId: doc.id,
      queryFn: query,
    });
    const needsReview = Boolean(validation.needs_review);

    const fieldChanges = Object.entries(corrections).map(([field, next]) => ({
      field,
      old_value: previousValues[field] ?? previousValues[field === 'cantitate_marfa' ? 'quantity' : field] ?? null,
      new_value: next,
      operator_id: req.user.id,
      operator_name: req.user.name ?? null,
      timestamp: new Date().toISOString(),
    }));

    const sets = Object.keys(columns).map((c, i) => `${c} = $${i + 5}`);

    const updated = await withTransaction(async (client) => {
      const row = (await client.query(
        `UPDATE aviz_documents SET
           field_confidence = $1, corrected_fields = $2, needs_review = $3,
           extracted_data = COALESCE(extracted_data, '{}'::jsonb) || $4::jsonb
           ${sets.length ? `, ${sets.join(', ')}` : ''},
           updated_at = NOW()
         WHERE id = $${5 + Object.keys(columns).length} AND company_id = $${6 + Object.keys(columns).length}
         RETURNING *`,
        [
          JSON.stringify(merged.fields), merged.corrected_fields, needsReview,
          JSON.stringify({
            values: merged.values,
            review_fields: merged.review_fields,
            validation,
          }),
          ...Object.values(columns),
          doc.id, req.user.company_id,
        ]
      )).rows[0];

      await logEvent(client, {
        companyId: req.user.company_id, documentId: doc.id, batchId: doc.batch_id,
        userId: req.user.id, kind: 'corrected',
        summary: Object.keys(corrections).join(', '),
        detail: { corrections, field_changes: fieldChanges, routing: validation.routing },
      });
      return row;
    });

    res.json({
      document: serializeRow(updated),
      needs_review: needsReview,
      validation,
      field_changes: fieldChanges,
    });
  } catch (err) {
    sendError(res, err, 'Salvarea corecțiilor a eșuat');
  }
});

/** Full history of one document. */
router.get('/:id/history', async (req, res) => {
  try {
    const rows = await query(
      `SELECT e.*, u.name AS user_name
       FROM document_events e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.company_id = $1 AND e.document_id = $2
       ORDER BY e.created_at DESC`,
      [req.user.company_id, req.params.id]
    );
    res.json({ events: rows.rows.map(serializeRow) });
  } catch (err) {
    sendError(res, err, 'Nu am putut încărca istoricul');
  }
});

/**
 * Confirms selected documents from a batch.
 * Only what the operator ticked is confirmed, the rest stay in review.
 */
router.post('/batches/:id/confirm', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.document_ids) ? req.body.document_ids : [];
    if (!ids.length) return res.status(400).json({ message: 'Selectează cel puțin un document' });

    const docs = (await query(
      `SELECT * FROM aviz_documents
       WHERE company_id = $1 AND batch_id = $2 AND id = ANY($3::uuid[])`,
      [req.user.company_id, req.params.id, ids]
    )).rows;
    if (!docs.length) return res.status(404).json({ message: 'Documentele nu aparțin acestui lot' });

    const blocked = docs.filter((d) => d.needs_review && !req.body?.force);
    if (blocked.length) {
      return res.status(409).json({
        message: `${blocked.length} documente au câmpuri necorectate. Corectează-le sau trimite force.`,
        blocked: blocked.map((d) => ({ id: d.id, filename: d.original_filename })),
      });
    }

    await withTransaction(async (client) => {
      for (const doc of docs) {
        await client.query(
          `UPDATE aviz_documents SET status = 'confirmed', needs_review = FALSE, updated_at = NOW()
           WHERE id = $1 AND company_id = $2`,
          [doc.id, req.user.company_id]
        );
        await logEvent(client, {
          companyId: req.user.company_id, documentId: doc.id, batchId: doc.batch_id,
          userId: req.user.id, kind: 'confirmed', summary: doc.original_filename,
        });
      }
      await client.query(
        `UPDATE document_batches SET status = 'confirmed', updated_at = NOW()
         WHERE id = $1 AND company_id = $2
           AND NOT EXISTS (SELECT 1 FROM aviz_documents d
                           WHERE d.batch_id = $1 AND d.status <> 'confirmed')`,
        [req.params.id, req.user.company_id]
      );
    });

    res.json({ confirmed: docs.length, document_ids: docs.map((d) => d.id) });
  } catch (err) {
    sendError(res, err, 'Confirmarea a eșuat');
  }
});

export default router;

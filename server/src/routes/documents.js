import { Router } from 'express';
import multer from 'multer';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { pool, query, withTransaction } from '../db.js';
import { serializeRow } from '../entities.js';
import { uploadRoot, publicUploadUrl } from '../uploadPath.js';
import { uniqueUploadFilename } from '../lib/concurrency.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import { readDocumentText } from '../lib/ocr/readText.js';
import { applyCorrections, extractDocument, reExtract, summariseExtraction } from '../lib/ocr/extract.js';
import { OCR_PROFILES, profilesFor } from '../lib/ocr/profiles.js';

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
];

/** Maps extractor field names onto the document columns. */
function toColumns(values) {
  const out = {};
  for (const [name, value] of Object.entries(values ?? {})) {
    if (name === 'quantity') out.cantitate_marfa = value;
    else if (EXTRACT_COLUMNS.includes(name)) out[name] = value;
  }
  return out;
}

/** One batch at a time — parallel driver uploads must not OCR the same rows twice. */
const batchExtractChains = new Map();

function runBatchExtract(batchKey, fn) {
  const prev = batchExtractChains.get(batchKey) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn).finally(() => {
    if (batchExtractChains.get(batchKey) === next) batchExtractChains.delete(batchKey);
  });
  batchExtractChains.set(batchKey, next);
  return next;
}

async function markExtractFailed(companyId, docId, err) {
  const message = err?.message || String(err);
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
 * Runs OCR over every document in a batch that has not been extracted yet.
 * Shared by the office extract endpoint and the driver upload path.
 *
 * @param {string[]} [options.documentIds]  When set (driver upload), only these rows are OCR'd —
 *   not every other stuck `uploaded` row still sitting in the open batch.
 */
export async function extractBatchDocuments(companyId, batchId, userId, {
  force = false,
  profileId,
  documentIds,
  timeoutMs,
} = {}) {
  const batchKey = `${companyId}:${batchId}`;
  return runBatchExtract(batchKey, async () => {
  let docs = (await query(
    `SELECT * FROM aviz_documents WHERE company_id = $1 AND batch_id = $2 ORDER BY created_at`,
    [companyId, batchId]
  )).rows;

  if (Array.isArray(documentIds) && documentIds.length) {
    const wanted = new Set(documentIds);
    docs = docs.filter((d) => wanted.has(d.id));
  }

  const results = [];
  for (const doc of docs) {
    if (!force && doc.status !== 'uploaded') {
      results.push({ id: doc.id, skipped: true, reason: 'already_extracted' });
      continue;
    }
    if (doc.ocr_profile_id && !force) {
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

    // Re-extract: show "Se procesează…" and let the office list poll. Confirmed rows stay put —
    // only a finished-but-empty extract needs to look pending again.
    if (force && doc.status === 'extracted') {
      await query(
        `UPDATE aviz_documents SET status = 'uploaded', updated_at = NOW()
         WHERE id = $1 AND company_id = $2 AND status = 'extracted'`,
        [doc.id, companyId]
      );
      doc.status = 'uploaded';
    }

    try {
      const text = await readDocumentText(doc.file_url, { timeoutMs });
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

      const columns = toColumns(merged.values);
      const sets = Object.keys(columns).map((c, i) => `${c} = $${i + 7}`);

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE aviz_documents SET
             ocr_profile_id = $1, ocr_confidence = $2, field_confidence = $3,
             needs_review = $4, extraction_source = $5,
             extracted_data = COALESCE(extracted_data, '{}'::jsonb) || $6::jsonb
             ${sets.length ? `, ${sets.join(', ')}` : ''},
             status = CASE WHEN status = 'uploaded' THEN 'extracted' ELSE status END,
             updated_at = NOW()
           WHERE id = $${7 + Object.keys(columns).length} AND company_id = $${8 + Object.keys(columns).length}`,
          [
            merged.profile_id, merged.confidence,
            JSON.stringify(merged.fields), merged.needs_review, text.source,
            JSON.stringify({
              raw_text: text.text,
              values: merged.values,
              review_fields: merged.review_fields,
              // A partial read must stay visible on the row: the figures came from fewer pages
              // than the document has, and nothing downstream could tell otherwise.
              ...(text.pages ? { pages: text.pages } : {}),
              ...(text.truncated ? { pages_truncated: true } : {}),
            }),
            ...Object.values(columns),
            doc.id, companyId,
          ]
        );
        await logEvent(client, {
          companyId, documentId: doc.id, batchId,
          userId, kind: doc.ocr_profile_id ? 're_extracted' : 'extracted',
          summary: merged.profile_name ?? 'nerecunoscut',
          detail: {
            confidence: merged.confidence,
            review_fields: merged.review_fields,
            text_source: text.source,
            pages: text.pages ?? null,
            pages_truncated: Boolean(text.truncated),
          },
        });
      });

      results.push({ id: doc.id, filename: doc.original_filename, ...summariseExtraction(merged) });
    } catch (err) {
      console.error('[documents] extract doc', doc.id, err);
      // A timeout is us giving up on the clock, not a page nobody can read. Marking it would
      // move it out of `uploaded` and the queue would stop offering it.
      if (err?.code !== 'OCR_TIMEOUT') await markExtractFailed(companyId, doc.id, err).catch(() => {});
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
  // line the moment the last page finishes — the operator's decision quietly reverted.
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

      const result = await withTransaction(async (client) => {
        const batch = (await client.query(
          `INSERT INTO document_batches (company_id, user_id, document_type, label, file_count)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [req.user.company_id, req.user.id, documentType, req.body?.label ?? null, files.length]
        )).rows[0];

        const documents = [];
        for (const file of files) {
          const doc = (await client.query(
            `INSERT INTO aviz_documents (company_id, batch_id, document_type, file_url,
               original_filename, status, needs_review)
             VALUES ($1,$2,$3,$4,$5,'uploaded',TRUE) RETURNING *`,
            [req.user.company_id, batch.id, documentType,
             publicUploadUrl(file.filename), file.originalname]
          )).rows[0];
          documents.push(doc);
          await logEvent(client, {
            companyId: req.user.company_id, documentId: doc.id, batchId: batch.id,
            userId: req.user.id, kind: 'uploaded', summary: file.originalname,
            detail: { size: file.size, mimetype: file.mimetype },
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

/** Batch with its documents — the review list. */
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
    const merged = applyCorrections(current, corrections, { previouslyCorrected: doc.corrected_fields ?? [] });

    const columns = toColumns(merged.values);
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
          JSON.stringify(merged.fields), merged.corrected_fields, merged.needs_review,
          JSON.stringify({ values: merged.values, review_fields: merged.review_fields }),
          ...Object.values(columns),
          doc.id, req.user.company_id,
        ]
      )).rows[0];

      await logEvent(client, {
        companyId: req.user.company_id, documentId: doc.id, batchId: doc.batch_id,
        userId: req.user.id, kind: 'corrected',
        summary: Object.keys(corrections).join(', '),
        detail: { corrections },
      });
      return row;
    });

    res.json({ document: serializeRow(updated), needs_review: merged.needs_review });
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
 * Only what the operator ticked is confirmed — the rest stay in review.
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

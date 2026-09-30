/**
 * Documents sent from the road.
 *
 * Photos / PDFs land in the same aviz_documents + document_batches pipeline as office
 * uploads (created_from: driver). Trip is optional, the cab can send paperwork before
 * the office links a cursă on /avize.
 *
 * After OCR the driver must confirm logistics fields (TPO, date, plate, qty/weight).
 * Missing required fields block "confirmare" — office still sees the row for backup.
 */
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { serializeRow } from '../entities.js';
import { publicUploadUrl } from '../uploadPath.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import {
  DRIVER_WRITABLE_KEYS,
  missingDriverLogistics,
  pickLogisticsRow,
} from '../lib/ocr/driverLogistics.js';
import { logEvent, upload, extractBatchDocuments, failStaleUploadedAvize, markExtractFailed, uploadErrorMessage } from './documents.js';
import { ocrCapability } from '../lib/ocr/readText.js';

const router = Router();
router.use(authRequired);

/** A phone sends a few photos at a time, not a month's archive. */
const DRIVER_FILE_CAP = 8;

const DRIVER_LIST_COLUMNS = `
  id, batch_id, original_filename, file_url, document_type, status, needs_review,
  numar_tpo, data_efectuare_cursa, numar_auto, ruta_transport, tip_marfa,
  cantitate_marfa, gross_weight_kg, numar_document_marfa, numar_curse,
  field_confidence, trip_id, created_at, uploaded_from, extraction_source
`;

const driverHits = new Map();

function sendError(res, err, fallback) {
  const status = err?.status || 500;
  if (status >= 500) console.error('[driver-documents]', err);
  res.status(status).json({ message: err?.message || fallback });
}

function withMissing(doc) {
  const row = serializeRow(doc);
  const logistics = pickLogisticsRow(row);
  const missing = missingDriverLogistics(logistics);
  return {
    ...row,
    missing_fields: missing,
    logistics_complete: missing.length === 0,
  };
}

function coerceWritableFields(body = {}) {
  const out = {};
  for (const key of DRIVER_WRITABLE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    let value = body[key];
    if (value === '' || value === undefined) value = null;
    if (value != null && ['cantitate_marfa', 'gross_weight_kg', 'numar_curse'].includes(key)) {
      const n = Number(String(value).replace(',', '.'));
      value = Number.isFinite(n) ? n : null;
    } else if (value != null) {
      value = String(value).trim() || null;
    }
    out[key] = value;
  }
  return out;
}

/**
 * The trip, if it is this driver's.
 *
 * Office users go through the normal upload screen; this route exists for the cab, so it checks
 * the trip is assigned to the person sending it.
 */
async function driverTrip(user, tripId) {
  if (!tripId) return null;
  const found = await query(
    `SELECT t.id, t.cmr_number, t.company_id, d.user_id AS driver_user_id
     FROM trips t
     LEFT JOIN drivers d ON d.id = t.driver_id
     WHERE t.id = $1 AND t.company_id = $2`,
    [tripId, user.company_id]
  );
  const trip = found.rows[0];
  if (!trip) return null;
  if (user.role === 'driver' && trip.driver_user_id !== user.id) return null;
  return trip;
}

/** One open batch per trip (or one unscoped open batch per driver when no trip). */
async function batchForUpload(client, { companyId, userId, trip, documentType }) {
  if (trip) {
    const existing = await client.query(
      `SELECT * FROM document_batches
       WHERE company_id = $1 AND trip_id = $2 AND status <> 'confirmed'
       ORDER BY created_at DESC LIMIT 1`,
      [companyId, trip.id]
    );
    if (existing.rows[0]) return existing.rows[0];

    const created = await client.query(
      `INSERT INTO document_batches (company_id, user_id, document_type, label, file_count,
         trip_id, created_from)
       VALUES ($1, $2, $3, $4, 0, $5, 'driver') RETURNING *`,
      [companyId, userId, documentType, `Cursă ${trip.cmr_number || trip.id.slice(0, 8)}`, trip.id]
    );
    return created.rows[0];
  }

  const existing = await client.query(
    `SELECT * FROM document_batches
     WHERE company_id = $1 AND user_id = $2 AND trip_id IS NULL
       AND created_from = 'driver' AND status <> 'confirmed'
     ORDER BY created_at DESC LIMIT 1`,
    [companyId, userId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await client.query(
    `INSERT INTO document_batches (company_id, user_id, document_type, label, file_count,
       trip_id, created_from)
     VALUES ($1, $2, $3, $4, 0, NULL, 'driver') RETURNING *`,
    [companyId, userId, documentType, 'De pe drum']
  );
  return created.rows[0];
}

/** Recent documents this driver uploaded (any trip / none). */
router.get('/', async (req, res) => {
  try {
    // Hung „Se procesează…” → Eșuat after the stale window. Do NOT kick extract here:
    // the companion polls this list every few seconds while anything is pending, and each
    // kick used to queue another OCR job on the same rows, stacking Paddle until the VM died.
    // Upload already starts OCR once; after a restart, stale-fail then office/driver Re-extrage.
    await failStaleUploadedAvize(req.user.company_id).catch(() => {});

    // Sidecar dead: flip this driver's spinners to Eșuat now — do not wait 90s, and do not
    // start new OCR (that is what was killing the VM on every reload).
    if ((await ocrCapability()) === 'paddle-down') {
      const stuck = await query(
        `SELECT id FROM aviz_documents
         WHERE company_id = $1 AND uploaded_by = $2 AND uploaded_from = 'driver'
           AND status = 'uploaded'`,
        [req.user.company_id, req.user.id]
      );
      const down = new Error(
        'Serviciul OCR nu răspunde. Completează câmpurile sau biroul Re-extrage când OCR e pornit.',
      );
      down.code = 'OCR_DOWN';
      await Promise.all(
        stuck.rows.map((row) => markExtractFailed(req.user.company_id, row.id, down).catch(() => {})),
      );
    }

    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const docs = await query(
      `SELECT ${DRIVER_LIST_COLUMNS}
       FROM aviz_documents
       WHERE company_id = $1 AND uploaded_by = $2 AND uploaded_from = 'driver'
       ORDER BY created_at DESC
       LIMIT $3`,
      [req.user.company_id, req.user.id, limit]
    );

    res.json({
      documents: docs.rows.map(withMissing),
      max_files: DRIVER_FILE_CAP,
    });
  } catch (err) {
    sendError(res, err, 'Documentele nu au putut fi citite');
  }
});

/**
 * Driver confirms (or fills) logistics after OCR.
 * Hard-blocks when required fields are still empty — photo alone is not enough.
 */
router.patch('/:id/confirm', async (req, res) => {
  try {
    const doc = (await query(
      `SELECT * FROM aviz_documents
       WHERE id = $1 AND company_id = $2 AND uploaded_by = $3 AND uploaded_from = 'driver'`,
      [req.params.id, req.user.company_id, req.user.id]
    )).rows[0];
    if (!doc) return res.status(404).json({ message: 'Document inexistent' });
    if (doc.status === 'uploaded') {
      return res.status(409).json({
        message: 'OCR încă rulează. Așteaptă câteva secunde, apoi completează câmpurile.',
      });
    }

    const patch = coerceWritableFields(req.body?.fields ?? req.body ?? {});
    const merged = { ...pickLogisticsRow(doc), ...patch };
    const missing = missingDriverLogistics(merged);
    if (missing.length) {
      return res.status(400).json({
        message: 'Verifică câmpurile următoare — datele nu sunt complete',
        missing_fields: missing,
        document: withMissing({ ...doc, ...merged }),
      });
    }

    const sets = Object.keys(patch).map((c, i) => `${c} = $${i + 1}`);
    const updated = await withTransaction(async (client) => {
      const row = (await client.query(
        `UPDATE aviz_documents SET
           ${sets.length ? `${sets.join(', ')},` : ''}
           status = 'confirmed',
           needs_review = FALSE,
           updated_at = NOW()
         WHERE id = $${sets.length + 1} AND company_id = $${sets.length + 2}
         RETURNING *`,
        [...Object.values(patch), doc.id, req.user.company_id]
      )).rows[0];

      await logEvent(client, {
        companyId: req.user.company_id,
        documentId: doc.id,
        batchId: doc.batch_id,
        userId: req.user.id,
        kind: 'confirmed',
        summary: 'Șoferul a confirmat câmpurile logistice',
        detail: { fields: patch, by: 'driver' },
      });
      return row;
    });

    res.json({ document: withMissing(updated) });
  } catch (err) {
    sendError(res, err, 'Confirmarea a eșuat');
  }
});

/**
 * Manual aviz from the cab: logistics fields first, optional gallery photo as evidence.
 * Fields win — we do not OCR-overwrite what the driver typed.
 */
router.post('/manual', (req, res) => {
  const limit = hitRateLimit(driverHits, req.user.id, { max: 30, windowMs: 60_000 });
  if (!limit.ok) {
    return res.status(429).json({ message: 'Prea multe încărcări. Reîncearcă într-un minut.' });
  }

  upload.array('files', 1)(req, res, async (err) => {
    if (err) return res.status(400).json({ message: uploadErrorMessage(err, 1) });

    try {
      const fields = coerceWritableFields(req.body ?? {});
      const missing = missingDriverLogistics(fields);
      if (missing.length) {
        return res.status(400).json({
          message: 'Verifică câmpurile următoare — datele nu sunt complete',
          missing_fields: missing,
        });
      }

      const rawTripId = String(req.body?.trip_id || '').trim();
      let trip = null;
      if (rawTripId) {
        trip = await driverTrip(req.user, rawTripId);
        if (!trip) return res.status(404).json({ message: 'Cursă inexistentă' });
      }

      const documentType = ['aviz', 'cmr', 'other'].includes(req.body?.document_type)
        ? req.body.document_type
        : 'aviz';

      const file = (req.files ?? [])[0] || null;
      const fileUrl = file ? publicUploadUrl(file.filename) : 'manual://driver-entry';
      const originalName = file?.originalname || 'Aviz manual (șofer)';

      const colKeys = Object.keys(fields);
      const colPlaceholders = colKeys.map((_, i) => `$${i + 8}`).join(', ');
      const colNames = colKeys.length ? `, ${colKeys.join(', ')}` : '';
      const colVals = colKeys.map((k) => fields[k]);

      const result = await withTransaction(async (client) => {
        const batch = await batchForUpload(client, {
          companyId: req.user.company_id, userId: req.user.id, trip, documentType,
        });

        const doc = (await client.query(
          `INSERT INTO aviz_documents (
             company_id, batch_id, document_type, file_url, original_filename,
             status, needs_review, trip_id, uploaded_by, uploaded_from,
             extraction_source
             ${colNames}
           ) VALUES (
             $1,$2,$3,$4,$5,
             'extracted', TRUE, $6, $7, 'driver',
             'driver_manual'
             ${colKeys.length ? `, ${colPlaceholders}` : ''}
           ) RETURNING *`,
          [
            req.user.company_id, batch.id, documentType, fileUrl, originalName,
            trip?.id || null, req.user.id,
            ...colVals,
          ]
        )).rows[0];

        await logEvent(client, {
          companyId: req.user.company_id,
          documentId: doc.id,
          batchId: batch.id,
          userId: req.user.id,
          kind: 'uploaded',
          summary: originalName,
          detail: {
            fields,
            has_photo: Boolean(file),
            trip_id: trip?.id || null,
            by: 'driver_manual',
            needs_review: true,
          },
        });

        const counted = (await client.query(
          `UPDATE document_batches
           SET file_count = (SELECT COUNT(*) FROM aviz_documents WHERE batch_id = $1),
               updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [batch.id]
        )).rows[0];

        return { batch: counted, document: doc };
      });

      const { notifyDriverUpload } = await import('../lib/officeNotifications.js');
      await notifyDriverUpload(req.user.company_id, {
        driverName: req.user.name || req.user.full_name,
        documentType,
        fileCount: 1,
        trip,
      }).catch(() => {});

      res.status(201).json({
        batch: serializeRow(result.batch),
        document: withMissing(result.document),
      });
    } catch (error) {
      sendError(res, error, 'Salvarea avizului a eșuat');
    }
  });
});

/** Upload from the driver app. Lands in the office review queue like any other document. */
router.post('/', (req, res) => {
  const limit = hitRateLimit(driverHits, req.user.id, { max: 30, windowMs: 60_000 });
  if (!limit.ok) {
    return res.status(429).json({ message: 'Prea multe încărcări. Reîncearcă într-un minut.' });
  }

  upload.array('files', DRIVER_FILE_CAP)(req, res, async (err) => {
    if (err) return res.status(400).json({ message: uploadErrorMessage(err, DRIVER_FILE_CAP) });
    const files = (req.files ?? []).slice(0, DRIVER_FILE_CAP);
    if (!files.length) return res.status(400).json({ message: 'Niciun fișier trimis' });

    try {
      const rawTripId = String(req.body?.trip_id || '').trim();
      let trip = null;
      if (rawTripId) {
        trip = await driverTrip(req.user, rawTripId);
        if (!trip) return res.status(404).json({ message: 'Cursă inexistentă' });
      }

      const documentType = ['aviz', 'cmr', 'other'].includes(req.body?.document_type)
        ? req.body.document_type
        : 'aviz';

      const result = await withTransaction(async (client) => {
        const batch = await batchForUpload(client, {
          companyId: req.user.company_id, userId: req.user.id, trip, documentType,
        });

        const documents = [];
        for (const file of files) {
          const doc = (await client.query(
            `INSERT INTO aviz_documents (company_id, batch_id, document_type, file_url,
               original_filename, status, needs_review, trip_id, uploaded_by, uploaded_from)
             VALUES ($1,$2,$3,$4,$5,'uploaded',TRUE,$6,$7,'driver') RETURNING *`,
            [req.user.company_id, batch.id, documentType, publicUploadUrl(file.filename),
             file.originalname, trip?.id || null, req.user.id]
          )).rows[0];
          documents.push(doc);
          await logEvent(client, {
            companyId: req.user.company_id, documentId: doc.id, batchId: batch.id,
            userId: req.user.id, kind: 'uploaded', summary: file.originalname,
            detail: {
              size: file.size,
              mimetype: file.mimetype,
              from: 'driver',
              trip_id: trip?.id || null,
            },
          });
        }

        const counted = (await client.query(
          `UPDATE document_batches
           SET file_count = (SELECT COUNT(*) FROM aviz_documents WHERE batch_id = $1),
               updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [batch.id]
        )).rows[0];

        return { batch: counted, documents };
      });

      const { notifyCmrPending, notifyDriverUpload } = await import('../lib/officeNotifications.js');
      const driverName = req.user.name || req.user.full_name;
      // Always ping the office bell, including uploads without a trip (previous gap).
      await notifyDriverUpload(req.user.company_id, {
        driverName,
        documentType,
        fileCount: result.documents.length,
        trip,
      }).catch(() => {});
      // Trip-linked CMR still gets the classic pending-on-trip entry.
      if (trip && documentType === 'cmr') {
        await notifyCmrPending(req.user.company_id, {
          ...trip,
          driver_name: driverName,
        }).catch(() => {});
      }

      res.status(201).json({
        batch: serializeRow(result.batch),
        documents: result.documents.map(serializeRow),
      });

      const docIds = result.documents.map((d) => d.id);
      // Dead sidecar: fail the new rows now instead of holding „Se procesează…” until stale.
      if ((await ocrCapability()) === 'paddle-down') {
        const down = new Error(
          'Serviciul OCR nu răspunde. Completează câmpurile sau biroul Re-extrage când OCR e pornit.',
        );
        down.code = 'OCR_DOWN';
        await Promise.all(docIds.map((id) => markExtractFailed(req.user.company_id, id, down).catch(() => {})));
      } else {
        extractBatchDocuments(req.user.company_id, result.batch.id, req.user.id, { documentIds: docIds })
          .catch((extractErr) => {
            console.error('[driver-documents] extract', extractErr?.message || extractErr);
          });
      }
    } catch (error) {
      sendError(res, error, 'Încărcarea a eșuat');
    }
  });
});

/** What this driver has already sent for the trip, so the app can show it rather than re-ask. */
router.get('/trips/:tripId', async (req, res) => {
  try {
    const trip = await driverTrip(req.user, req.params.tripId);
    if (!trip) return res.status(404).json({ message: 'Cursă inexistentă' });
    const docs = await query(
      `SELECT id, original_filename, file_url, document_type, status, needs_review, created_at
       FROM aviz_documents
       WHERE company_id = $1 AND trip_id = $2
       ORDER BY created_at DESC`,
      [req.user.company_id, trip.id]
    );
    res.json({ documents: docs.rows.map(serializeRow), max_files: DRIVER_FILE_CAP });
  } catch (err) {
    sendError(res, err, 'Documentele nu au putut fi citite');
  }
});

export { DRIVER_FILE_CAP };
export default router;

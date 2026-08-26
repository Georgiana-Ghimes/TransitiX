/**
 * Documents sent from the road.
 *
 * A driver could already attach a photo to a trip, but it landed in `trip_documents` and stopped
 * there: no OCR, no review queue, no way into a report. A delivery note photographed at the ramp
 * is the same kind of thing as one the office scans later, so it goes into the same pipeline —
 * one batch per trip, so the office reviews a trip's paperwork together rather than one file at
 * a time.
 */
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { serializeRow } from '../entities.js';
import { publicUploadUrl } from '../uploadPath.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import { logEvent, upload, extractBatchDocuments } from './documents.js';

const router = Router();
router.use(authRequired);

/** A phone sends a few photos at a time, not a month's archive. */
const DRIVER_FILE_CAP = 8;

const driverHits = new Map();

function sendError(res, err, fallback) {
  const status = err?.status || 500;
  if (status >= 500) console.error('[driver-documents]', err);
  res.status(status).json({ message: err?.message || fallback });
}

/**
 * The trip, if it is this driver's.
 *
 * Office users go through the normal upload screen; this route exists for the cab, so it checks
 * the trip is assigned to the person sending it.
 */
async function driverTrip(user, tripId) {
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

/**
 * One batch per trip, reused.
 *
 * A driver who sends the delivery note at the ramp and the weighbridge ticket twenty minutes
 * later should not create two lots for one trip — the office would review them separately and
 * confirm one without the other.
 */
async function batchForTrip(client, { companyId, userId, trip, documentType }) {
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

/** Upload from the driver app. Lands in the office review queue like any other document. */
router.post('/', (req, res) => {
  const limit = hitRateLimit(driverHits, req.user.id, { max: 30, windowMs: 60_000 });
  if (!limit.ok) {
    return res.status(429).json({ message: 'Prea multe încărcări. Reîncearcă într-un minut.' });
  }

  upload.array('files', DRIVER_FILE_CAP)(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Încărcare eșuată' });
    const files = (req.files ?? []).slice(0, DRIVER_FILE_CAP);
    if (!files.length) return res.status(400).json({ message: 'Niciun fișier trimis' });

    try {
      const trip = await driverTrip(req.user, req.body?.trip_id);
      if (!trip) return res.status(404).json({ message: 'Cursă inexistentă' });

      const documentType = ['aviz', 'cmr', 'other'].includes(req.body?.document_type)
        ? req.body.document_type
        : 'aviz';

      const result = await withTransaction(async (client) => {
        const batch = await batchForTrip(client, {
          companyId: req.user.company_id, userId: req.user.id, trip, documentType,
        });

        const documents = [];
        for (const file of files) {
          const doc = (await client.query(
            `INSERT INTO aviz_documents (company_id, batch_id, document_type, file_url,
               original_filename, status, needs_review, trip_id, uploaded_by, uploaded_from)
             VALUES ($1,$2,$3,$4,$5,'uploaded',TRUE,$6,$7,'driver') RETURNING *`,
            [req.user.company_id, batch.id, documentType, publicUploadUrl(file.filename),
             file.originalname, trip.id, req.user.id]
          )).rows[0];
          documents.push(doc);
          await logEvent(client, {
            companyId: req.user.company_id, documentId: doc.id, batchId: batch.id,
            userId: req.user.id, kind: 'uploaded', summary: file.originalname,
            detail: { size: file.size, mimetype: file.mimetype, from: 'driver', trip_id: trip.id },
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

      // The office is told once per trip, not once per photo.
      const { notifyCmrPending } = await import('../lib/officeNotifications.js');
      await notifyCmrPending(req.user.company_id, trip).catch(() => {});

      res.status(201).json({
        batch: serializeRow(result.batch),
        documents: result.documents.map(serializeRow),
      });

      // Same OCR pipeline as Documente — never block the cab on Vision latency.
      extractBatchDocuments(req.user.company_id, result.batch.id, req.user.id).catch((err) => {
        console.error('[driver-documents] extract', err?.message || err);
      });
    } catch (error) {
      sendError(res, error, 'Încărcarea a eșuat');
    }
  });
});

/** What this driver has already sent for a trip, so the app can show it rather than re-ask. */
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

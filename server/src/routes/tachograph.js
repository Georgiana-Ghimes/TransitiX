import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { uploadRoot, publicUploadUrl } from '../uploadPath.js';
import { query } from '../db.js';
import { serializeRow } from '../entities.js';
import { uniqueUploadFilename } from '../lib/concurrency.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import {
  analyseTachographBuffer,
  isTachographFilename,
} from '../lib/compliance/tachograph.js';
import { createLogger } from '../lib/log.js';

const log = createLogger({ scope: 'tachograph' });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (req, file, cb) => {
    cb(null, uniqueUploadFilename(`tacho-${file.originalname}`, { companyId: req.user?.company_id }));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 32 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!isTachographFilename(file.originalname)) {
      return cb(new Error('Doar fișiere tahograf (.ddd, .tgd, .c1b, .v1b)'));
    }
    cb(null, true);
  },
});

const router = Router();
router.use(authRequired, officeRequired);
const importHits = new Map();

function sendError(res, err, fallback) {
  const status = err.status || 500;
  if (status >= 500) log.error('eroare', err);
  res.status(status).json({ message: err.message || fallback });
}

router.get('/imports', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const result = await query(
      `SELECT t.*, d.name AS driver_name, v.plate AS vehicle_plate
       FROM tachograph_imports t
       LEFT JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.company_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2`,
      [req.user.company_id, limit]
    );
    res.json(result.rows.map(serializeRow));
  } catch (err) {
    sendError(res, err, 'Lista importurilor tahograf a eșuat');
  }
});

router.get('/imports/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT t.*, d.name AS driver_name, v.plate AS vehicle_plate
       FROM tachograph_imports t
       LEFT JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.id = $1 AND t.company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Import inexistent' });
    res.json(serializeRow(result.rows[0]));
  } catch (err) {
    sendError(res, err, 'Importul nu s-a putut încărca');
  }
});

/**
 * Upload + archive a tachograph download. Partial TLV analysis only.
 * POST multipart field "file"; optional driver_id, vehicle_id.
 */
router.post('/import', (req, res) => {
  const limit = hitRateLimit(importHits, req.user.company_id, { max: 30, windowMs: 60_000 });
  if (!limit.ok) {
    return res.status(429).json({ message: 'Prea multe importuri. Reîncearcă într-un minut.' });
  }

  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ message: uploadErr.message || 'Upload eșuat' });
    }
    if (!req.file) return res.status(400).json({ message: 'Niciun fișier încărcat' });

    try {
      const buf = fs.readFileSync(req.file.path);
      const analysis = analyseTachographBuffer(buf, { filename: req.file.originalname });

      const driverId = req.body?.driver_id || null;
      const vehicleId = req.body?.vehicle_id || null;
      if (driverId) {
        const d = await query(
          `SELECT id FROM drivers WHERE id = $1 AND company_id = $2`,
          [driverId, req.user.company_id]
        );
        if (!d.rows[0]) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ message: 'Șofer invalid' });
        }
      }
      if (vehicleId) {
        const v = await query(
          `SELECT id FROM vehicles WHERE id = $1 AND company_id = $2`,
          [vehicleId, req.user.company_id]
        );
        if (!v.rows[0]) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ message: 'Vehicul invalid' });
        }
      }

      const fileUrl = publicUploadUrl(req.file.filename);
      const inserted = await query(
        `INSERT INTO tachograph_imports (
           company_id, driver_id, vehicle_id, imported_by,
           original_filename, stored_filename, file_url, size_bytes, sha256,
           kind, status, message, plates_guess, tags_summary, known_tag_count, tag_count
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16
         ) RETURNING *`,
        [
          req.user.company_id,
          driverId,
          vehicleId,
          req.user.id,
          req.file.originalname,
          req.file.filename,
          fileUrl,
          analysis.size_bytes,
          analysis.sha256,
          analysis.kind,
          analysis.status,
          analysis.message,
          JSON.stringify(analysis.plates_guess || []),
          JSON.stringify(analysis.tags || []),
          analysis.known_tag_count || 0,
          analysis.tag_count || 0,
        ]
      );

      res.status(201).json({
        import: serializeRow(inserted.rows[0]),
        analysis: {
          kind: analysis.kind,
          status: analysis.status,
          message: analysis.message,
          plates_guess: analysis.plates_guess,
          known_tag_count: analysis.known_tag_count,
          tag_count: analysis.tag_count,
          sha256: analysis.sha256,
        },
      });
    } catch (err) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      sendError(res, err, 'Importul tahograf a eșuat');
    }
  });
});

export default router;

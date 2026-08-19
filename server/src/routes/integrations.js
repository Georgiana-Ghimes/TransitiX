import { Router } from 'express';
import multer from 'multer';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { uploadRoot, publicUploadUrl } from '../uploadPath.js';
import { query, withTransaction } from '../db.js';
import { serializeRow } from '../entities.js';
import { sendEmail } from '../lib/email.js';
import {
  extractCmrFromImage,
  stubCmrFromTrip,
  visionConfigured,
} from '../lib/cmrOcr.js';
import { uniqueUploadFilename } from '../lib/concurrency.js';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    cb(null, uniqueUploadFilename(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') {
      return cb(new Error('Doar imagini sau PDF sunt acceptate'));
    }
    cb(null, true);
  },
});

const router = Router();

router.post('/upload', authRequired, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('[upload]', err);
      return res.status(400).json({ message: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ message: 'Niciun fișier încărcat' });
    const file_url = publicUploadUrl(req.file.filename);
    res.json({ file_url, filename: req.file.filename, size: req.file.size });
  });
});

/**
 * OCR / LLM endpoint.
 * CMR requests: Google Vision when GOOGLE_VISION_API_KEY is set; else trip prefill stub.
 * Planning AI (suggestions schema): still stubbed.
 */
router.post('/llm', authRequired, async (req, res) => {
  try {
    const {
      prompt,
      response_json_schema,
      trip_context,
      trip_id,
      file_urls,
    } = req.body || {};

    console.log('[llm/ocr]', {
      promptLength: prompt?.length || 0,
      trip_id: trip_id || trip_context?.id || null,
      files: Array.isArray(file_urls) ? file_urls.length : 0,
      vision: visionConfigured(),
    });

    if (response_json_schema?.properties?.suggestions) {
      return res.json({
        suggestions: [
          {
            type: 'backhaul',
            title: 'Oportunitate retur București → Cluj',
            suggestion:
              'Vehiculul liber după livrare poate prelua o încărcătură de retur pe rută similară. (sugestie stub)',
            potential_savings_eur: 180,
            potential_savings_km: 220,
            priority: 'high',
          },
          {
            type: 'fuel',
            title: 'Optimizare consum pe curse lungi',
            suggestion: 'Alocă vehiculele cu consum mai mic pe rutele >300 km. (sugestie stub)',
            potential_savings_eur: 95,
            potential_savings_km: 0,
            priority: 'medium',
          },
        ],
      });
    }

    let trip = trip_context || null;
    const tid = trip_id || trip_context?.id;
    if ((!trip || !trip.shipper_name) && tid) {
      const result = await query(
        `SELECT * FROM trips WHERE id = $1 AND company_id = $2`,
        [tid, req.user.company_id]
      );
      if (result.rows[0]) trip = serializeRow(result.rows[0]);
    }

    const imageUrl = Array.isArray(file_urls) ? file_urls.find(Boolean) : null;

    if (visionConfigured() && imageUrl) {
      try {
        const extracted = await extractCmrFromImage(imageUrl, trip);
        return res.json(extracted);
      } catch (ocrErr) {
        console.error('[vision ocr]', ocrErr.message || ocrErr);
        const fallback = stubCmrFromTrip(trip);
        fallback._note = `OCR Vision a eșuat (${ocrErr.message}). Am folosit datele din cursă.`;
        fallback._vision_error = ocrErr.message;
        return res.json(fallback);
      }
    }

    if (visionConfigured() && !imageUrl) {
      const fallback = stubCmrFromTrip(trip);
      fallback._note = 'Nicio imagine trimisă pentru OCR. Am folosit datele din cursă.';
      return res.json(fallback);
    }

    res.json(stubCmrFromTrip(trip));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'OCR failed' });
  }
});

router.post('/email', authRequired, async (req, res) => {
  try {
    const { to, subject, body } = req.body || {};
    const result = await sendEmail({
      to,
      subject,
      text: body,
    });
    if (!result.ok) {
      return res.status(400).json({ message: result.message || 'Email failed' });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Email failed' });
  }
});

router.post('/gps-simulate', authRequired, officeRequired, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.logs) ? req.body.logs : [];
    const created = await withTransaction(async (client) => {
      await client.query(`SELECT id FROM companies WHERE id = $1 FOR UPDATE`, [req.user.company_id]);
      await client.query(
        `UPDATE gps_logs SET is_current = FALSE, updated_at = NOW()
         WHERE company_id = $1 AND is_current = TRUE`,
        [req.user.company_id]
      );
      const rows = [];
      for (const item of items) {
        if (item?.vehicle_id == null || item?.latitude == null || item?.longitude == null) continue;
        const result = await client.query(
          `INSERT INTO gps_logs (
             company_id, vehicle_id, vehicle_plate, latitude, longitude,
             speed, heading, ignition, is_current
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, TRUE)
           RETURNING *`,
          [
            req.user.company_id,
            item.vehicle_id,
            item.vehicle_plate || null,
            item.latitude,
            item.longitude,
            item.speed ?? null,
            item.heading ?? null,
          ]
        );
        rows.push(serializeRow(result.rows[0]));
      }
      return rows;
    });
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'GPS simulate failed' });
  }
});

export default router;

import { Router } from 'express';
import multer from 'multer';
import { authRequired } from '../middleware/auth.js';
import { uploadRoot, publicUploadUrl } from '../uploadPath.js';
import { query } from '../db.js';
import { serializeRow } from '../entities.js';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
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
 * OCR / LLM stub.
 * For CMR OCR requests, prefers trip_context (or loads trip by trip_id)
 * so the dispatcher flow works without Google Vision yet.
 */
router.post('/llm', authRequired, async (req, res) => {
  try {
    const { prompt, response_json_schema, trip_context, trip_id } = req.body || {};
    console.log('[llm/ocr stub]', {
      promptLength: prompt?.length || 0,
      trip_id: trip_id || trip_context?.id || null,
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

    // MVP OCR: prefill from trip data so the confirmation flow is usable.
    // Replace with Google Vision / Textract when ready.
    res.json({
      cmr_number: trip?.cmr_number || null,
      date: trip?.loading_date || new Date().toISOString().slice(0, 10),
      shipper: trip?.shipper_name || null,
      consignee: trip?.consignee_name || null,
      goods_description: trip?.goods_description || null,
      weight: trip?.weight_kg != null ? String(trip.weight_kg) : null,
      packages: trip?.package_count != null ? String(trip.package_count) : null,
      _stub: true,
      _note:
        'OCR stub: date precompletate din cursă. Conectează Google Vision pentru extragere reală din imagine.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'OCR failed' });
  }
});

router.post('/email', authRequired, (req, res) => {
  const { to, subject, body } = req.body || {};
  console.log('[email stub]', { to, subject, body: String(body || '').slice(0, 300) });
  res.json({
    ok: true,
    stub: true,
    message: 'Email logged on server (Resend not configured yet)',
  });
});

export default router;

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { authRequired } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.resolve(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads');
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });
const router = Router();

router.post('/upload', authRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const file_url = `/uploads/${req.file.filename}`;
  res.json({ file_url });
});

/** Stub OCR / LLM — returns sample structure so UI flows keep working */
router.post('/llm', authRequired, (req, res) => {
  const { prompt, response_json_schema } = req.body || {};
  console.log('[llm stub] prompt length:', prompt?.length || 0);

  if (response_json_schema?.properties?.suggestions) {
    return res.json({
      suggestions: [
        {
          type: 'backhaul',
          title: 'Oportunitate retur București → Cluj',
          suggestion: 'Vehiculul liber după livrare poate prelua o încărcătură de retur pe rută similară. (sugestie stub — conectează un LLM real)',
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

  // OCR-style response
  res.json({
    cmr_number: null,
    date: null,
    shipper: null,
    consignee: null,
    goods_description: null,
    weight: null,
    packages: null,
    _note: 'OCR stub — configurează Google Vision / LLM pentru extragere reală',
  });
});

router.post('/email', authRequired, (req, res) => {
  const { to, subject, body } = req.body || {};
  console.log('[email stub]', { to, subject, body: body?.slice?.(0, 200) });
  res.json({ ok: true });
});

export default router;

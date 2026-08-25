import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { query, withTransaction } from '../db.js';
import { serializeRow } from '../entities.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import { MAX_IMPORT_ROWS, buildImportPlan, parseDelimited } from '../lib/orders/orderImport.js';

const router = Router();
const importHits = new Map();

router.use(authRequired, officeRequired);

/** The file is parsed and thrown away, so it never touches disk. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const XLSX_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

function looksLikeXlsx(file) {
  if (XLSX_MIME.has(file.mimetype)) return true;
  return /\.xlsx?$/i.test(file.originalname || '');
}

/** ExcelJS hands back objects for formulas, hyperlinks and rich text. */
function cellValue(value) {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return value.text;
    if ('result' in value) return value.result;
    if ('hyperlink' in value) return value.hyperlink;
    return null;
  }
  return value;
}

async function readSheet(file) {
  if (!looksLikeXlsx(file)) {
    return parseDelimited(file.buffer.toString('utf8'));
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows = [];
  // +2 for the header and one line of slack, so an oversized file is reported as truncated
  // by the planner rather than silently cut here.
  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (rows.length > MAX_IMPORT_ROWS + 1) return;
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber - 1] = cellValue(cell.value);
    });
    const normalized = Array.from(cells, (cell) => (cell === undefined ? null : cell));
    if (normalized.some((cell) => cell != null && String(cell).trim() !== '')) rows.push(normalized);
  });
  return rows;
}

/**
 * Import orders from a spreadsheet.
 *
 * Always returns the full plan, line by line. With `dry_run` the dispatcher sees exactly
 * what would be created; without it, only the clean lines are written — in one transaction,
 * so a file that is half broken never leaves half an import behind.
 */
router.post('/import', (req, res) => {
  const limit = hitRateLimit(importHits, req.user.company_id, { max: 20, windowMs: 60_000 });
  if (!limit.ok) {
    return res.status(429).json({ message: 'Prea multe importuri. Reîncearcă într-un minut.' });
  }

  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ message: uploadErr.message || 'Fișierul nu a putut fi citit' });
    }
    if (!req.file) return res.status(400).json({ message: 'Niciun fișier încărcat' });

    try {
      const companyId = req.user.company_id;
      const dryRun = String(req.body?.dry_run ?? 'true') !== 'false';
      const defaultDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.default_date || ''))
        ? String(req.body.default_date)
        : null;

      let rows;
      try {
        rows = await readSheet(req.file);
      } catch (err) {
        console.error('[orders import] parse', err);
        return res.status(400).json({ message: 'Fișierul nu a putut fi citit. Acceptăm .xlsx și .csv.' });
      }
      if (!rows.length) return res.status(400).json({ message: 'Fișierul este gol' });

      const [locations, clients, existing] = await Promise.all([
        query(
          `SELECT id, client_id, name, address, address_key, city, latitude, longitude,
                  default_service_time_min, is_active
           FROM locations WHERE company_id = $1`,
          [companyId]
        ),
        query(`SELECT id, name, is_active FROM clients WHERE company_id = $1`, [companyId]),
        query(`SELECT order_number FROM orders WHERE company_id = $1`, [companyId]),
      ]);

      const plan = buildImportPlan(rows, {
        locations: locations.rows,
        clients: clients.rows,
        existingNumbers: existing.rows.map((r) => r.order_number),
        defaultDate,
      });

      if (plan.fatal) return res.status(400).json({ message: plan.fatal, plan });
      if (dryRun) return res.json({ dry_run: true, imported: 0, plan });

      const ready = plan.rows.filter((row) => row.status === 'ok');
      if (!ready.length) {
        return res.status(400).json({ message: 'Nicio linie validă de importat', plan });
      }

      const created = await withTransaction(async (client) => {
        const out = [];
        for (const row of ready) {
          const order = row.order;
          const inserted = await client.query(
            `INSERT INTO orders (
               company_id, client_id, location_id, order_number, type, requested_date,
               window_start, window_end, service_time_min, weight_kg, volume_mc, pallets,
               requires, goods_description, notes, status
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'nou')
             RETURNING *`,
            [
              companyId, order.client_id, order.location_id, order.order_number, order.type,
              order.requested_date, order.window_start, order.window_end, order.service_time_min,
              order.weight_kg, order.volume_mc, order.pallets, order.requires,
              order.goods_description, order.notes,
            ]
          );
          out.push(serializeRow(inserted.rows[0]));
        }
        return out;
      });

      res.status(201).json({ dry_run: false, imported: created.length, orders: created, plan });
    } catch (err) {
      // A number that slipped past the duplicate check because another dispatcher imported
      // the same file a second earlier: the unique index is the real guard.
      if (err?.code === '23505') {
        return res.status(409).json({
          message: 'O comandă din fișier a fost creată între timp. Reia importul.',
        });
      }
      console.error('[orders import]', err);
      res.status(500).json({ message: err.message || 'Importul a eșuat' });
    }
  });
});

export default router;

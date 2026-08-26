import { Router } from 'express';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { query } from '../db.js';
import { buildUblInvoice } from '../lib/compliance/efactura.js';
import { serializeRow } from '../entities.js';

const router = Router();
router.use(authRequired, officeRequired);

function sendError(res, err, fallback) {
  const status = err.status || 500;
  if (status >= 500) console.error('[invoices]', err);
  res.status(status).json({
    message: err.message || fallback,
    ...(err.errors ? { errors: err.errors } : {}),
  });
}

/**
 * Download local UBL XML for an invoice. Never marks efactura_status as sent.
 * GET /api/invoices/:id/ubl
 */
/**
 * The lines an invoice is made of.
 *
 * A customer disputes a component, not a total — "why 120 for the crane". The invoice is built
 * from `trip_charges`, so the breakdown exists; without this it would exist only in the database.
 */
router.get('/:id/lines', async (req, res) => {
  try {
    const invoice = await query(
      'SELECT id FROM invoices WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.company_id]
    );
    if (!invoice.rows[0]) return res.status(404).json({ message: 'Factură inexistentă' });

    const lines = await query(
      `SELECT * FROM invoice_lines WHERE company_id = $1 AND invoice_id = $2 ORDER BY seq`,
      [req.user.company_id, req.params.id]
    );
    res.json({ lines: lines.rows.map(serializeRow) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Liniile nu au putut fi citite' });
  }
});

router.get('/:id/ubl', async (req, res) => {
  try {
    const invRes = await query(
      `SELECT * FROM invoices WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    const invoice = invRes.rows[0];
    if (!invoice) return res.status(404).json({ message: 'Factură inexistentă' });

    const coRes = await query(`SELECT * FROM companies WHERE id = $1`, [req.user.company_id]);
    const company = coRes.rows[0] || {};

    const { xml, filename } = buildUblInvoice(invoice, company);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Efactura-Mode', 'ubl-local');
    res.send(xml);
  } catch (err) {
    sendError(res, err, 'Exportul UBL a eșuat');
  }
});

export default router;

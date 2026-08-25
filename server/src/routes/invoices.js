import { Router } from 'express';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { query } from '../db.js';
import { buildUblInvoice } from '../lib/compliance/efactura.js';

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

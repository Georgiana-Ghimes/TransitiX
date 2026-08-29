import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, officeRequired, adminRequired } from '../middleware/auth.js';
import { getCompanyById, pickCompanyWritable, publicCompany } from '../lib/company.js';
import { invalidateComputedNotificationsCache } from '../lib/officeNotifications.js';

const router = Router();

router.use(authRequired, officeRequired);

router.get('/', async (req, res) => {
  try {
    const company = await getCompanyById(req.user.company_id);
    if (!company) return res.status(404).json({ message: 'Compania nu a fost găsită.' });
    res.json(company);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to load company' });
  }
});

router.put('/', adminRequired, async (req, res) => {
  try {
    const data = pickCompanyWritable(req.body || {});
    const keys = Object.keys(data);
    if (keys.length === 0) return res.status(400).json({ message: 'Nu ai modificat niciun câmp.' });

    const sets = keys.map((k, idx) => {
      if (k === 'settings') return `${k} = $${idx + 1}::jsonb`;
      return `${k} = $${idx + 1}`;
    });
    const values = [...Object.values(data), req.user.company_id];
    const result = await query(
      `UPDATE companies
       SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${keys.length + 1}
       RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Compania nu a fost găsită.' });
    // `document_expiry_days` sets the horizon the bell computes against, so a threshold change
    // has to reach the next inbox read rather than the next cache expiry.
    invalidateComputedNotificationsCache(req.user.company_id);
    res.json(publicCompany(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to save company' });
  }
});

export default router;

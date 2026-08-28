import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { serializeRow } from '../entities.js';
import {
  getComputedNotifications,
  getDismissalState,
  markNotificationRead,
  markAllComputedRead,
  deleteReadComputed,
} from '../lib/officeNotifications.js';

const router = Router();

router.use(authRequired, officeRequired);

router.get('/inbox', async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const dismissalState = await getDismissalState(companyId);
    const result = await query(
      `SELECT * FROM office_notifications
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [companyId]
    );
    const stored = result.rows.map(serializeRow);
    const computed = await getComputedNotifications(companyId, dismissalState);
    const items = [...stored, ...computed].sort(
      (a, b) => new Date(b.created_at || b.created_date) - new Date(a.created_at || a.created_date)
    );
    const unread_count = items.filter((n) => !n.is_read).length;
    const read_count = items.filter((n) => n.is_read).length;
    res.json({ items, unread_count, read_count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to load notifications' });
  }
});

router.put('/read-all', async (req, res) => {
  try {
    const companyId = req.user.company_id;
    await query(
      `UPDATE office_notifications
       SET is_read = TRUE, updated_at = NOW()
       WHERE company_id = $1 AND is_read = FALSE`,
      [companyId]
    );
    await markAllComputedRead(companyId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to mark all read' });
  }
});

router.delete('/read', async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const result = await query(
      `DELETE FROM office_notifications WHERE company_id = $1 AND is_read = TRUE RETURNING id`,
      [companyId]
    );
    await deleteReadComputed(companyId);
    res.json({ ok: true, deleted: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to delete read notifications' });
  }
});

router.put('/:id/read', async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const id = decodeURIComponent(req.params.id);

    if (id.startsWith('computed:')) {
      await markNotificationRead(companyId, id);
      return res.json({ ok: true, id, is_read: true, computed: true });
    }

    const result = await query(
      `UPDATE office_notifications
       SET is_read = TRUE, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [id, companyId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Notificarea nu a fost găsită.' });
    res.json(serializeRow(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to mark read' });
  }
});

export default router;

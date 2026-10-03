import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { serializeRow } from '../entities.js';
import { auditEntityChange } from '../lib/audit/events.js';
import { invalidateComputedNotificationsCache } from '../lib/officeNotifications.js';
import {
  buildFleetCountQuery,
  buildFleetFilterWhere,
  buildFleetIdsQuery,
  buildFleetListQuery,
  capFleetIds,
} from '../lib/fleet/fleetQuery.js';

const router = Router();
router.use(authRequired, officeRequired);

router.get('/', async (req, res) => {
  try {
    const filters = {
      companyId: req.user.company_id,
      q: req.query.q,
    };
    const { sql, params, page } = buildFleetListQuery({
      ...filters,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    const countQ = buildFleetCountQuery(filters);
    const [result, countResult] = await Promise.all([
      query(sql, params),
      query(countQ.sql, countQ.params),
    ]);
    const totals = countResult.rows[0] || {};
    res.json({
      items: result.rows.map(serializeRow),
      total: totals.total ?? 0,
      missing_mma: totals.missing_mma ?? 0,
      limit: page.limit,
      offset: page.offset,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to list fleet' });
  }
});

/** Ids for the current filter (all pages) — powers „Selectează toate”. */
router.get('/ids', async (req, res) => {
  try {
    const { sql, params } = buildFleetIdsQuery({
      companyId: req.user.company_id,
      q: req.query.q,
    });
    const result = await query(sql, params);
    res.json({ ids: result.rows.map((r) => r.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to list fleet ids' });
  }
});

router.post('/bulk-delete', async (req, res) => {
  try {
    const allMatching = Boolean(req.body?.all_matching);
    const filters = {
      companyId: req.user.company_id,
      q: req.body?.q,
    };

    const result = await withTransaction(async (client) => {
      let deleted;
      if (allMatching) {
        const { where, params } = buildFleetFilterWhere(filters);
        deleted = await client.query(
          `DELETE FROM vehicles
           WHERE ${where.join(' AND ')}
           RETURNING *`,
          params
        );
      } else {
        const ids = capFleetIds(req.body?.ids);
        if (ids.length === 0) {
          const err = new Error('Selectează cel puțin un autoturism');
          err.status = 400;
          throw err;
        }
        deleted = await client.query(
          `DELETE FROM vehicles
           WHERE company_id = $1 AND id = ANY($2::uuid[])
           RETURNING *`,
          [req.user.company_id, ids]
        );
      }
      for (const row of deleted.rows) {
        await auditEntityChange(client, req, {
          action: 'delete', entity: 'Vehicle', before: row,
        });
      }
      return deleted;
    });

    invalidateComputedNotificationsCache(req.user.company_id);
    res.json({
      deleted: result.rows.length,
      ids: result.rows.map((r) => r.id),
    });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ message: err.message });
    }
    console.error(err);
    res.status(500).json({ message: err.message || 'Bulk delete failed' });
  }
});

export default router;

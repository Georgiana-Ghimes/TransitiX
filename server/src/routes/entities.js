import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired, officeRequired } from '../middleware/auth.js';
import {
  ENTITY_MAP,
  parseOrder,
  serializeRow,
  pickWritable,
} from '../entities.js';
import {
  notifyTripStatusChange,
  notifyCmrPending,
  dismissCmrPending,
} from '../lib/officeNotifications.js';
import {
  DRIVER_TRIP_WRITABLE,
  entityAllowedForRole,
  nextAvizStatusOnSave,
} from '../lib/concurrency.js';

const router = Router();

router.use(authRequired);

function requireEntityAction(action) {
  return (req, res, next) => {
    if (!entityAllowedForRole(req.user?.role, req.params.entity, action)) {
      return res.status(403).json({ message: 'Office access only' });
    }
    next();
  };
}

function writableForRequest(req, cfg) {
  if (req.user.role === 'driver' && req.params.entity === 'Trip') {
    return pickWritable({ writable: DRIVER_TRIP_WRITABLE, jsonFields: cfg.jsonFields }, req.body);
  }
  return pickWritable(cfg, req.body);
}

async function insertEntity(client, cfg, data) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, idx) => `$${idx + 1}`);
  const result = await client.query(
    `INSERT INTO ${cfg.table} (${keys.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values
  );
  return result.rows[0];
}

async function insertWithGpsGuard(client, companyId, entity, item) {
  const cfg = ENTITY_MAP[entity];
  const data = pickWritable(cfg, item);
  data.company_id = companyId;
  if (entity === 'GPSLog' && data.is_current && data.vehicle_id) {
    await client.query(
      `UPDATE gps_logs SET is_current = FALSE, updated_at = NOW()
       WHERE company_id = $1 AND vehicle_id = $2 AND is_current = TRUE`,
      [companyId, data.vehicle_id]
    );
  }
  return insertEntity(client, cfg, data);
}

router.get('/:entity', requireEntityAction('list'), async (req, res) => {
  try {
    const cfg = ENTITY_MAP[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown entity' });

    const order = parseOrder(req.query.order);
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const result = await query(
      `SELECT * FROM ${cfg.table} WHERE company_id = $1 ORDER BY ${order} LIMIT $2`,
      [req.user.company_id, limit]
    );
    res.json(result.rows.map(serializeRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'List failed' });
  }
});

router.post('/:entity/filter', requireEntityAction('filter'), async (req, res) => {
  try {
    const cfg = ENTITY_MAP[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown entity' });

    const filters = req.body?.filters || req.body || {};
    const order = parseOrder(req.body?.order || req.query.order);
    const limit = Math.min(Number(req.body?.limit || req.query.limit) || 200, 1000);

    const allowedKeys = new Set(['id', ...cfg.writable]);
    const clauses = ['company_id = $1'];
    const params = [req.user.company_id];
    let i = 2;
    for (const [key, value] of Object.entries(filters)) {
      if (!allowedKeys.has(key)) continue;
      if (value === undefined) continue;
      clauses.push(`${key} = $${i++}`);
      params.push(value);
    }
    params.push(limit);

    const result = await query(
      `SELECT * FROM ${cfg.table} WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT $${i}`,
      params
    );
    res.json(result.rows.map(serializeRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Filter failed' });
  }
});

router.post('/:entity/bulk', requireEntityAction('create'), async (req, res) => {
  try {
    const cfg = ENTITY_MAP[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown entity' });

    const items = Array.isArray(req.body) ? req.body : req.body?.items || [];
    const created = await withTransaction(async (client) => {
      const rows = [];
      for (const item of items) {
        const row = await insertWithGpsGuard(client, req.user.company_id, req.params.entity, item);
        rows.push(serializeRow(row));
      }
      return rows;
    });
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Bulk create failed' });
  }
});

router.put('/:entity/bulk', requireEntityAction('update'), async (req, res) => {
  try {
    const cfg = ENTITY_MAP[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown entity' });

    const items = Array.isArray(req.body) ? req.body : req.body?.items || [];
    const updated = [];
    for (const item of items) {
      if (!item.id) continue;
      const { id, ...rest } = item;
      const data = pickWritable(cfg, rest);
      data.updated_at = new Date().toISOString();
      const keys = Object.keys(data);
      if (keys.length === 0) continue;
      const sets = keys.map((k, idx) => `${k} = $${idx + 1}`);
      const values = [...Object.values(data), id, req.user.company_id];
      const result = await query(
        `UPDATE ${cfg.table}
         SET ${sets.join(', ')}
         WHERE id = $${keys.length + 1} AND company_id = $${keys.length + 2}
         RETURNING *`,
        values
      );
      if (result.rows[0]) updated.push(serializeRow(result.rows[0]));
    }
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Bulk update failed' });
  }
});

router.post('/:entity/:id/adjust', requireEntityAction('update'), async (req, res) => {
  try {
    if (req.params.entity !== 'WarehouseProduct') {
      return res.status(404).json({ message: 'Unknown entity' });
    }
    const delta = Number(req.body?.delta);
    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({ message: 'delta required' });
    }
    const result = await query(
      `UPDATE warehouse_products
       SET quantity = GREATEST(0, quantity + $1), updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [delta, req.params.id, req.user.company_id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Not found' });
    res.json(serializeRow(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Adjust failed' });
  }
});

router.get('/:entity/:id', requireEntityAction('get'), async (req, res) => {
  try {
    const cfg = ENTITY_MAP[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown entity' });

    const result = await query(
      `SELECT * FROM ${cfg.table} WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Not found' });
    res.json(serializeRow(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Get failed' });
  }
});

router.post('/:entity', requireEntityAction('create'), async (req, res) => {
  try {
    const cfg = ENTITY_MAP[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown entity' });

    const row = serializeRow(await withTransaction(async (client) => (
      insertWithGpsGuard(client, req.user.company_id, req.params.entity, req.body)
    )));

    if (req.params.entity === 'TripDocument' && row.original_image_url && !row.is_confirmed && row.trip_id) {
      const tripRes = await query(
        `SELECT id, cmr_number FROM trips WHERE id = $1 AND company_id = $2`,
        [row.trip_id, req.user.company_id]
      );
      if (tripRes.rows[0]) {
        await notifyCmrPending(req.user.company_id, tripRes.rows[0]);
      }
    }

    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Create failed' });
  }
});

router.put('/:entity/:id', requireEntityAction('update'), async (req, res) => {
  try {
    const cfg = ENTITY_MAP[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown entity' });

    const data = writableForRequest(req, cfg);
    data.updated_at = new Date().toISOString();
    const keys = Object.keys(data);
    if (keys.length === 0) return res.status(400).json({ message: 'No fields to update' });

    let previous = null;
    if (req.params.entity === 'Trip' && data.status !== undefined) {
      const prev = await query(
        `SELECT * FROM ${cfg.table} WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.user.company_id]
      );
      previous = prev.rows[0] || null;
    }

    if (req.params.entity === 'AvizDocument') {
      const prev = await query(
        `SELECT status FROM aviz_documents WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.user.company_id]
      );
      if (!prev.rows[0]) return res.status(404).json({ message: 'Not found' });
      if (data.status !== undefined) {
        data.status = nextAvizStatusOnSave(prev.rows[0].status, data.status);
      }
    }

    const result = await withTransaction(async (client) => {
      if (req.params.entity === 'GPSLog' && data.is_current) {
        const prev = await client.query(
          `SELECT vehicle_id FROM gps_logs WHERE id = $1 AND company_id = $2`,
          [req.params.id, req.user.company_id]
        );
        const vehicleId = data.vehicle_id || prev.rows[0]?.vehicle_id;
        if (vehicleId) {
          await client.query(
            `UPDATE gps_logs SET is_current = FALSE, updated_at = NOW()
             WHERE company_id = $1 AND vehicle_id = $2 AND is_current = TRUE AND id <> $3`,
            [req.user.company_id, vehicleId, req.params.id]
          );
        }
      }
      const sets = keys.map((k, idx) => `${k} = $${idx + 1}`);
      const values = [...Object.values(data), req.params.id, req.user.company_id];
      return client.query(
        `UPDATE ${cfg.table}
         SET ${sets.join(', ')}
         WHERE id = $${keys.length + 1} AND company_id = $${keys.length + 2}
         RETURNING *`,
        values
      );
    });
    if (!result.rows[0]) return res.status(404).json({ message: 'Not found' });
    const row = serializeRow(result.rows[0]);

    if (req.params.entity === 'Trip' && previous && data.status !== undefined) {
      await notifyTripStatusChange(
        req.user.company_id,
        row,
        previous.status,
        row.status
      );
    }

    if (req.params.entity === 'TripDocument') {
      if (row.original_image_url && !row.is_confirmed && row.trip_id) {
        const tripRes = await query(
          `SELECT id, cmr_number FROM trips WHERE id = $1 AND company_id = $2`,
          [row.trip_id, req.user.company_id]
        );
        if (tripRes.rows[0]) await notifyCmrPending(req.user.company_id, tripRes.rows[0]);
      }
      if (row.is_confirmed && row.trip_id) {
        await dismissCmrPending(req.user.company_id, row.trip_id);
      }
    }

    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Update failed' });
  }
});

router.delete('/:entity/:id', officeRequired, requireEntityAction('delete'), async (req, res) => {
  try {
    const cfg = ENTITY_MAP[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown entity' });

    const result = await query(
      `DELETE FROM ${cfg.table} WHERE id = $1 AND company_id = $2 RETURNING id`,
      [req.params.id, req.user.company_id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Not found' });
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Delete failed' });
  }
});

export default router;

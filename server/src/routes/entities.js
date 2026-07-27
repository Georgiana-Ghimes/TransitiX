import { Router } from 'express';
import { query } from '../db.js';
import { authRequired } from '../middleware/auth.js';
import {
  ENTITY_MAP,
  parseOrder,
  serializeRow,
  pickWritable,
} from '../entities.js';

const router = Router();

router.use(authRequired);

router.get('/:entity', async (req, res) => {
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

router.post('/:entity/filter', async (req, res) => {
  try {
    const cfg = ENTITY_MAP[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown entity' });

    const filters = req.body?.filters || req.body || {};
    const order = parseOrder(req.body?.order || req.query.order);
    const limit = Math.min(Number(req.body?.limit || req.query.limit) || 200, 1000);

    const clauses = ['company_id = $1'];
    const params = [req.user.company_id];
    let i = 2;
    for (const [key, value] of Object.entries(filters)) {
      if (!/^[a-z_]+$/i.test(key)) continue;
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

router.post('/:entity/bulk', async (req, res) => {
  try {
    const cfg = ENTITY_MAP[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown entity' });

    const items = Array.isArray(req.body) ? req.body : req.body?.items || [];
    const created = [];
    for (const item of items) {
      const data = pickWritable(cfg, item);
      data.company_id = req.user.company_id;
      const keys = Object.keys(data);
      const values = Object.values(data);
      const placeholders = keys.map((_, idx) => `$${idx + 1}`);
      const result = await query(
        `INSERT INTO ${cfg.table} (${keys.join(', ')})
         VALUES (${placeholders.join(', ')})
         RETURNING *`,
        values
      );
      created.push(serializeRow(result.rows[0]));
    }
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Bulk create failed' });
  }
});

router.put('/:entity/bulk', async (req, res) => {
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

router.get('/:entity/:id', async (req, res) => {
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

router.post('/:entity', async (req, res) => {
  try {
    const cfg = ENTITY_MAP[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown entity' });

    const data = pickWritable(cfg, req.body);
    data.company_id = req.user.company_id;

    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, idx) => `$${idx + 1}`);

    const result = await query(
      `INSERT INTO ${cfg.table} (${keys.join(', ')})
       VALUES (${placeholders.join(', ')})
       RETURNING *`,
      values
    );
    res.status(201).json(serializeRow(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Create failed' });
  }
});

router.put('/:entity/:id', async (req, res) => {
  try {
    const cfg = ENTITY_MAP[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown entity' });

    const data = pickWritable(cfg, req.body);
    data.updated_at = new Date().toISOString();
    const keys = Object.keys(data);
    if (keys.length === 0) return res.status(400).json({ message: 'No fields to update' });

    const sets = keys.map((k, idx) => `${k} = $${idx + 1}`);
    const values = [...Object.values(data), req.params.id, req.user.company_id];

    const result = await query(
      `UPDATE ${cfg.table}
       SET ${sets.join(', ')}
       WHERE id = $${keys.length + 1} AND company_id = $${keys.length + 2}
       RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Not found' });
    res.json(serializeRow(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Update failed' });
  }
});

router.delete('/:entity/:id', async (req, res) => {
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

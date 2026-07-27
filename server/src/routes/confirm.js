import { Router } from 'express';
import { query } from '../db.js';
import { serializeRow } from '../entities.js';

const router = Router();

router.get('/:token', async (req, res) => {
  try {
    const conf = await query(
      `SELECT * FROM client_confirmations WHERE token = $1 LIMIT 1`,
      [req.params.token]
    );
    if (!conf.rows[0]) return res.status(404).json({ message: 'Invalid token' });

    const confirmation = serializeRow(conf.rows[0]);
    let trip = null;
    if (confirmation.trip_id) {
      const t = await query(`SELECT * FROM trips WHERE id = $1`, [confirmation.trip_id]);
      trip = serializeRow(t.rows[0]);
    }
    res.json({ confirmation, trip });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load confirmation' });
  }
});

router.post('/:token', async (req, res) => {
  try {
    const conf = await query(
      `SELECT * FROM client_confirmations WHERE token = $1 LIMIT 1`,
      [req.params.token]
    );
    if (!conf.rows[0]) return res.status(404).json({ message: 'Invalid token' });
    if (conf.rows[0].status === 'confirmed') {
      return res.json(serializeRow(conf.rows[0]));
    }

    const {
      confirmed_by_name,
      observations,
      has_damage,
      damage_description,
      damage_image_url,
    } = req.body || {};

    const result = await query(
      `UPDATE client_confirmations SET
         status = 'confirmed',
         confirmed_at = NOW(),
         confirmed_by_name = $1,
         confirmed_by_ip = $2,
         observations = $3,
         has_damage = COALESCE($4, FALSE),
         damage_description = $5,
         damage_image_url = $6,
         updated_at = NOW()
       WHERE token = $7
       RETURNING *`,
      [
        confirmed_by_name || null,
        req.ip,
        observations || null,
        has_damage ?? false,
        damage_description || null,
        damage_image_url || null,
        req.params.token,
      ]
    );
    res.json(serializeRow(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Confirmation failed' });
  }
});

export default router;

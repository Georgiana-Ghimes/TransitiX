import { Router } from 'express';
import { query } from '../db.js';
import { serializeRow } from '../entities.js';
import { notifyClientConfirmed } from '../lib/officeNotifications.js';
import { createLogger } from '../lib/log.js';

const log = createLogger({ scope: 'confirm' });

const router = Router();

function isExpired(row) {
  if (!row?.expires_at) return false;
  return new Date(row.expires_at).getTime() < Date.now();
}

router.get('/:token', async (req, res) => {
  try {
    const conf = await query(
      `SELECT * FROM client_confirmations WHERE token = $1 LIMIT 1`,
      [req.params.token]
    );
    if (!conf.rows[0]) return res.status(404).json({ message: 'Invalid token' });

    const row = conf.rows[0];
    if (isExpired(row) || row.status === 'expired') {
      if (row.status !== 'expired') {
        await query(
          `UPDATE client_confirmations SET status = 'expired', updated_at = NOW() WHERE id = $1`,
          [row.id]
        );
        row.status = 'expired';
      }
      return res.status(410).json({ message: 'Confirmation link has expired' });
    }

    const confirmation = serializeRow(row);
    let trip = null;
    if (confirmation.trip_id) {
      const t = await query(`SELECT * FROM trips WHERE id = $1`, [confirmation.trip_id]);
      trip = serializeRow(t.rows[0]);
    }
    res.json({ confirmation, trip });
  } catch (err) {
    log.error('eroare', err);
    res.status(500).json({ message: 'Failed to load confirmation' });
  }
});

router.post('/:token', async (req, res) => {
  try {
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
         AND status = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())
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

    if (!result.rows[0]) {
      const conf = await query(
        `SELECT * FROM client_confirmations WHERE token = $1 LIMIT 1`,
        [req.params.token]
      );
      if (!conf.rows[0]) return res.status(404).json({ message: 'Invalid token' });
      if (conf.rows[0].status === 'confirmed') {
        return res.json(serializeRow(conf.rows[0]));
      }
      if (isExpired(conf.rows[0]) || conf.rows[0].status === 'expired') {
        await query(
          `UPDATE client_confirmations SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status <> 'confirmed'`,
          [conf.rows[0].id]
        );
        return res.status(410).json({ message: 'Confirmation link has expired' });
      }
      return res.status(409).json({ message: 'Confirmation already processed' });
    }

    const confirmation = serializeRow(result.rows[0]);
    let trip = null;
    if (confirmation.trip_id) {
      const t = await query(`SELECT * FROM trips WHERE id = $1`, [confirmation.trip_id]);
      trip = t.rows[0] || null;
    }
    await notifyClientConfirmed(confirmation.company_id, trip, {
      has_damage: has_damage ?? false,
      confirmed_by_name,
    });

    res.json(confirmation);
  } catch (err) {
    log.error('eroare', err);
    res.status(500).json({ message: 'Confirmation failed' });
  }
});

export default router;

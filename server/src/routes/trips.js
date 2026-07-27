import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { serializeRow } from '../entities.js';

const router = Router();

/** Generate (or reuse pending) client confirmation link for a trip */
router.post('/:tripId/confirmation-link', authRequired, async (req, res) => {
  try {
    const tripId = req.params.tripId;
    const tripResult = await query(
      `SELECT * FROM trips WHERE id = $1 AND company_id = $2`,
      [tripId, req.user.company_id]
    );
    const trip = tripResult.rows[0];
    if (!trip) return res.status(404).json({ message: 'Cursa nu a fost găsită' });

    const existing = await query(
      `SELECT * FROM client_confirmations
       WHERE trip_id = $1 AND company_id = $2 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [tripId, req.user.company_id]
    );

    let confirmation;
    if (existing.rows[0]) {
      confirmation = serializeRow(existing.rows[0]);
    } else {
      const token = crypto.randomBytes(24).toString('hex');
      const email =
        trip.consignee_email ||
        req.body?.client_email ||
        null;
      const inserted = await query(
        `INSERT INTO client_confirmations (
           company_id, trip_id, cmr_number, token, client_name, client_email,
           status, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW() + INTERVAL '30 days')
         RETURNING *`,
        [
          req.user.company_id,
          tripId,
          trip.cmr_number,
          token,
          trip.consignee_name,
          email,
        ]
      );
      confirmation = serializeRow(inserted.rows[0]);
    }

    const origin = req.body?.origin || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
    const link = `${origin.replace(/\/$/, '')}/confirm/${confirmation.token}`;

    console.log('[confirmation-link]', {
      trip: trip.cmr_number,
      link,
      email: confirmation.client_email,
    });

    res.json({ confirmation, link, trip: serializeRow(trip) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to create confirmation link' });
  }
});

export default router;

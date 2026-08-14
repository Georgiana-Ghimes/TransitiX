import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { serializeRow } from '../entities.js';

const router = Router();

router.use(authRequired, officeRequired);

function escapeLike(value) {
  return String(value).replace(/[%_\\]/g, '\\$&');
}

/** Lightweight office search — avoids prefetching hundreds of entities in the browser. */
router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ trips: [], vehicles: [], drivers: [] });
    }

    const companyId = req.user.company_id;
    const like = `%${escapeLike(q)}%`;
    const limit = Math.min(Number(req.query.limit) || 5, 10);

    const [trips, vehicles, drivers] = await Promise.all([
      query(
        `SELECT id, cmr_number, driver_name, vehicle_plate, shipper_name, consignee_name, status
         FROM trips
         WHERE company_id = $1
           AND (
             cmr_number ILIKE $2 ESCAPE '\\'
             OR driver_name ILIKE $2 ESCAPE '\\'
             OR vehicle_plate ILIKE $2 ESCAPE '\\'
             OR shipper_name ILIKE $2 ESCAPE '\\'
             OR consignee_name ILIKE $2 ESCAPE '\\'
           )
         ORDER BY created_at DESC
         LIMIT $3`,
        [companyId, like, limit]
      ),
      query(
        `SELECT id, plate, brand, model, status
         FROM vehicles
         WHERE company_id = $1
           AND (
             plate ILIKE $2 ESCAPE '\\'
             OR brand ILIKE $2 ESCAPE '\\'
             OR model ILIKE $2 ESCAPE '\\'
           )
         ORDER BY created_at DESC
         LIMIT $3`,
        [companyId, like, limit]
      ),
      query(
        `SELECT id, name, email, phone, license_number, status
         FROM drivers
         WHERE company_id = $1
           AND (
             name ILIKE $2 ESCAPE '\\'
             OR email ILIKE $2 ESCAPE '\\'
             OR phone ILIKE $2 ESCAPE '\\'
             OR license_number ILIKE $2 ESCAPE '\\'
           )
         ORDER BY created_at DESC
         LIMIT $3`,
        [companyId, like, limit]
      ),
    ]);

    res.json({
      trips: trips.rows.map(serializeRow),
      vehicles: vehicles.rows.map(serializeRow),
      drivers: drivers.rows.map(serializeRow),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Search failed' });
  }
});

export default router;

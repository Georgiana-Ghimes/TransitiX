import { Router } from 'express';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { pool, query } from '../db.js';
import { serializeRow } from '../entities.js';
import {
  DEFAULT_SEGMENTS,
  itemsFromStops,
  lateralBalance,
  packItems,
  resolveCargoBay,
  segmentFill,
  sideViewRects,
} from '../lib/loading/packer.js';
import { createLogger } from '../lib/log.js';

const log = createLogger({ scope: 'loading' });

const router = Router();
router.use(authRequired, officeRequired);

function sendError(res, err, fallback) {
  const status = err.status || 500;
  if (status >= 500) log.error('eroare', err);
  res.status(status).json({ message: err.message || fallback });
}

async function loadRouteStops(companyId, routeId) {
  const result = await query(
    `SELECT s.id, s.seq, s.kind, s.status, s.order_id, s.location_id,
            o.order_number, o.weight_kg, o.volume_mc, o.pallets, o.product_id,
            o.goods_description
     FROM route_stops s
     LEFT JOIN orders o ON o.id = s.order_id
     WHERE s.company_id = $1 AND s.route_id = $2
     ORDER BY s.seq`,
    [companyId, routeId]
  );
  return result.rows;
}

/**
 * Pack a route's cargo into its vehicle bay.
 * Body: { strategy?: 'lifo' | 'warehouse' }
 */
router.post('/routes/:routeId/pack', async (req, res) => {
  try {
    const strategy = String(req.body?.strategy || 'lifo');
    if (!['lifo', 'warehouse'].includes(strategy)) {
      return res.status(400).json({ message: 'strategy trebuie să fie lifo sau warehouse' });
    }

    const routeRes = await query(
      `SELECT r.*, v.plate AS vehicle_plate,
              v.cargo_length_m, v.cargo_width_m, v.cargo_height_m,
              v.axle_front_m, v.axle_rear_m, v.axle_front_max_kg, v.axle_rear_max_kg,
              v.capacity_kg, v.capacity_mc, v.capacity_pallets
       FROM routes r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE r.id = $1 AND r.company_id = $2`,
      [req.params.routeId, req.user.company_id]
    );
    const route = routeRes.rows[0];
    if (!route) return res.status(404).json({ message: 'Rută inexistentă' });
    if (!route.vehicle_id) {
      return res.status(422).json({ message: 'Alocă un vehicul pe rută înainte de planul de încărcare' });
    }

    const stops = await loadRouteStops(req.user.company_id, route.id);
    const productIds = [...new Set(stops.map((s) => s.product_id).filter(Boolean))];
    const productsById = {};
    if (productIds.length) {
      const products = await query(
        `SELECT * FROM warehouse_products WHERE company_id = $1 AND id = ANY($2::uuid[])`,
        [req.user.company_id, productIds]
      );
      for (const p of products.rows) productsById[p.id] = p;
    }

    const items = itemsFromStops(stops, { productsById });
    if (!items.length) {
      return res.status(422).json({
        message: 'Nicio încărcătură pe opriri — setează paleți, volum sau greutate pe comenzi',
      });
    }

    const segmentCount = Math.max(1, Math.min(12, Number(req.body?.segments) || DEFAULT_SEGMENTS));
    const packed = packItems(items, route, { strategy });
    res.json({
      route: serializeRow({
        id: route.id,
        code: route.code,
        vehicle_id: route.vehicle_id,
        vehicle_plate: route.vehicle_plate,
      }),
      strategy,
      bay: packed.bay,
      fill: packed.fill,
      axle: packed.axle,
      placements: packed.placements,
      unplaced: packed.unplaced,
      side_view: sideViewRects(packed.placements),
      segments: segmentFill(packed.placements, packed.bay, { count: segmentCount }),
      balance: lateralBalance(packed.placements, packed.bay),
      stops: stops.map(serializeRow),
    });
  } catch (err) {
    sendError(res, err, 'Planul de încărcare a eșuat');
  }
});

/**
 * Fleet list for the load planner, searchable by plate, brand or model.
 * Each vehicle carries its resolved cargo bay so the screen can draw the profile before any
 * route is chosen — and can say plainly when the dimensions are assumed rather than measured.
 */
router.get('/vehicles', async (req, res) => {
  try {
    const search = String(req.query.q || '').trim().toLowerCase();
    const result = await query(
      `SELECT * FROM vehicles WHERE company_id = $1 AND is_active = TRUE ORDER BY plate`,
      [req.user.company_id]
    );
    const vehicles = result.rows
      .map(serializeRow)
      .filter((v) => {
        if (!search) return true;
        return [v.plate, v.brand, v.model, v.chassis_number]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(search));
      })
      .map((v) => ({ ...v, bay: resolveCargoBay(v) }));
    res.json({ vehicles, count: vehicles.length });
  } catch (err) {
    sendError(res, err, 'Nu am putut încărca flota');
  }
});

/** Routes that a given vehicle is assigned to, newest first — what it has to load. */
router.get('/vehicles/:id/routes', async (req, res) => {
  try {
    const result = await query(
      `SELECT r.id, r.code, r.route_date, r.status,
              r.planned_distance_km, r.planned_duration_min,
              (SELECT count(*) FROM route_stops s WHERE s.route_id = r.id) AS stop_count
       FROM routes r
       WHERE r.company_id = $1 AND r.vehicle_id = $2
       ORDER BY r.route_date DESC, r.code
       LIMIT 60`,
      [req.user.company_id, req.params.id]
    );
    res.json({ routes: result.rows.map(serializeRow) });
  } catch (err) {
    sendError(res, err, 'Nu am putut încărca rutele vehiculului');
  }
});

export default router;

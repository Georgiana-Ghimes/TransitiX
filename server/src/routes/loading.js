import { Router } from 'express';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { pool, query } from '../db.js';
import { serializeRow } from '../entities.js';
import {
  itemsFromStops,
  packItems,
  sideViewRects,
} from '../lib/loading/packer.js';

const router = Router();
router.use(authRequired, officeRequired);

function sendError(res, err, fallback) {
  const status = err.status || 500;
  if (status >= 500) console.error('[loading]', err);
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
      stops: stops.map(serializeRow),
    });
  } catch (err) {
    sendError(res, err, 'Planul de încărcare a eșuat');
  }
});

export default router;

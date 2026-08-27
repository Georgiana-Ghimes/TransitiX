import { Router } from 'express';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { query } from '../db.js';
import { serializeRow } from '../entities.js';
import { costActivity, resolveCostRates } from '../lib/analytics/costModel.js';
import { buildCockpit } from '../lib/analytics/kpis.js';
import { createLogger } from '../lib/log.js';

const log = createLogger({ scope: 'analytics' });

const router = Router();
router.use(authRequired, officeRequired);

function sendError(res, err, fallback) {
  const status = err.status || 500;
  if (status >= 500) log.error('eroare', err);
  res.status(status).json({ message: err.message || fallback });
}

function parseDay(value, fallback) {
  const s = String(value || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return fallback;
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Cockpit KPIs for a date range (inclusive).
 * GET /api/analytics/cockpit?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
router.get('/cockpit', async (req, res) => {
  try {
    const to = parseDay(req.query.to, todayIso());
    const from = parseDay(req.query.from, daysAgoIso(30));
    const companyId = req.user.company_id;

    const companyRes = await query(`SELECT * FROM companies WHERE id = $1`, [companyId]);
    const company = companyRes.rows[0] || {};

    const routesRes = await query(
      `SELECT r.*, v.plate AS vehicle_plate, v.fuel_consumption, v.cost_per_km, v.cost_per_hour,
              v.fuel_price_per_l, v.wage_per_hour, v.toll_per_km, v.depreciation_per_km, v.maintenance_per_km,
              v.capacity_kg, v.capacity_mc
       FROM routes r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE r.company_id = $1
         AND r.route_date >= $2::date
         AND r.route_date <= $3::date
         AND r.status <> 'anulata'
       ORDER BY r.route_date DESC, r.code`,
      [companyId, from, to]
    );
    const routes = routesRes.rows;

    const routeIds = routes.map((r) => r.id);
    let stops = [];
    if (routeIds.length) {
      const stopsRes = await query(
        `SELECT s.* FROM route_stops s
         WHERE s.company_id = $1 AND s.route_id = ANY($2::uuid[])`,
        [companyId, routeIds]
      );
      stops = stopsRes.rows;
    }

    const ordersRes = await query(
      `SELECT id, status, weight_kg, volume_mc, requested_date
       FROM orders
       WHERE company_id = $1
         AND requested_date >= $2::date
         AND requested_date <= $3::date`,
      [companyId, from, to]
    );

    const costs = routes.map((route) => {
      const rates = resolveCostRates(route, company);
      const activity = costActivity({
        distance_km: route.actual_distance_km ?? route.planned_distance_km,
        duration_min: route.actual_duration_min ?? route.planned_duration_min,
        rates,
      });
      if (!activity) return { route_id: route.id, total: null };
      return { route_id: route.id, ...activity };
    });

    const cockpit = buildCockpit({
      routes: routes.map(serializeRow),
      stops: stops.map(serializeRow),
      costs,
      orders: ordersRes.rows.map(serializeRow),
    });

    res.json({
      from,
      to,
      ...cockpit,
    });
  } catch (err) {
    sendError(res, err, 'Cockpit-ul nu s-a putut încărca');
  }
});

export default router;

import { Router } from 'express';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { pool, query, withTransaction } from '../db.js';
import { serializeRow } from '../entities.js';
import { osrmConfigured, osrmTable } from '../lib/geo/osrm.js';
import {
  applyOrder,
  buildLegs,
  checkCapacity,
  checkRequirements,
  checkTimeWindows,
  moveStop,
  removeStop,
  routeTotals,
  scheduleStops,
  sortStops,
} from '../lib/routing/routePlan.js';

const router = Router();
router.use(authRequired, officeRequired);

/**
 * A route's stops joined with everything the planner needs: where the stop is, what it
 * carries and when it may be served.
 */
async function loadStops(db, companyId, routeId) {
  const result = await db.query(
    `SELECT s.*,
            l.name AS location_name, l.address, l.city, l.county,
            l.latitude, l.longitude,
            o.order_number, o.weight_kg, o.volume_mc, o.pallets, o.requires,
            COALESCE(o.window_start, l.window_start) AS window_start,
            COALESCE(o.window_end,   l.window_end)   AS window_end,
            c.name AS client_name
     FROM route_stops s
     LEFT JOIN locations l ON l.id = s.location_id
     LEFT JOIN orders o    ON o.id = s.order_id
     LEFT JOIN clients c   ON c.id = o.client_id
     WHERE s.company_id = $1 AND s.route_id = $2
     ORDER BY s.seq`,
    [companyId, routeId]
  );
  return result.rows.map(serializeRow);
}

async function loadRoute(db, companyId, routeId) {
  const result = await db.query(
    `SELECT r.*, v.plate AS vehicle_plate, v.capacity_kg, v.capacity_mc, d.name AS driver_name
     FROM routes r
     LEFT JOIN vehicles v ON v.id = r.vehicle_id
     LEFT JOIN drivers  d ON d.id = r.driver_id
     WHERE r.company_id = $1 AND r.id = $2`,
    [companyId, routeId]
  );
  return result.rows[0] ? serializeRow(result.rows[0]) : null;
}

/** Combines route_date + starts_at into the instant the schedule walks from. */
function routeStartAt(route) {
  if (!route?.route_date) return null;
  const time = String(route.starts_at || '08:00').slice(0, 5);
  const date = String(route.route_date).slice(0, 10);
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * Recomputes legs from OSRM, reschedules, and stores the totals on the route.
 * Best-effort about OSRM, like every other geo call: a route with no measured legs is
 * still a usable plan, it just cannot show ETAs yet.
 */
async function recomputeRoute(db, companyId, routeId) {
  const route = await loadRoute(db, companyId, routeId);
  if (!route) return null;

  let stops = sortStops(await loadStops(db, companyId, routeId));
  const positioned = stops.filter((s) => s.latitude != null && s.longitude != null);
  let osrm = { ok: false, reason: 'osrm_neconfigurat' };

  if (osrmConfigured() && positioned.length >= 2) {
    try {
      const matrix = await osrmTable(positioned.map((s) => ({
        latitude: Number(s.latitude), longitude: Number(s.longitude),
      })));
      const indexById = new Map(positioned.map((s, i) => [s.id, i]));
      stops = buildLegs(stops, matrix, (s) => indexById.get(s.id));
      osrm = { ok: true };
    } catch (err) {
      osrm = { ok: false, reason: 'osrm_indisponibil', message: err.message };
    }
  } else if (positioned.length < 2) {
    osrm = { ok: false, reason: 'coordonate_insuficiente' };
  }

  stops = scheduleStops(stops, { startAt: routeStartAt(route) });
  const totals = routeTotals(stops);

  await withTransaction(async (client) => {
    for (const stop of stops) {
      await client.query(
        `UPDATE route_stops
         SET seq = $1, leg_distance_km = $2, leg_duration_min = $3,
             planned_arrival = $4, planned_departure = $5, updated_at = NOW()
         WHERE id = $6 AND company_id = $7`,
        [
          stop.seq, stop.leg_distance_km ?? null, stop.leg_duration_min ?? null,
          stop.planned_arrival ?? null, stop.planned_departure ?? null,
          stop.id, companyId,
        ]
      );
    }
    await client.query(
      `UPDATE routes SET planned_distance_km = $1, planned_duration_min = $2, updated_at = NOW()
       WHERE id = $3 AND company_id = $4`,
      [totals.distance_km, totals.duration_min, routeId, companyId]
    );
  });

  return {
    route: { ...route, planned_distance_km: totals.distance_km, planned_duration_min: totals.duration_min },
    stops,
    totals,
    osrm,
    windowViolations: checkTimeWindows(stops),
    capacityProblems: checkCapacity(totals, route),
    missingCapabilities: checkRequirements(stops, []),
  };
}

function sendError(res, err, fallback) {
  const status = err?.status || 500;
  if (status >= 500) console.error('[routes]', err);
  res.status(status).json({ message: err?.message || fallback });
}

/** Full plan for one route — stops, ETAs, totals and every warning. */
router.get('/:id/plan', async (req, res) => {
  try {
    const route = await loadRoute(pool, req.user.company_id, req.params.id);
    if (!route) return res.status(404).json({ message: 'Rută inexistentă' });
    const stops = scheduleStops(await loadStops(pool, req.user.company_id, req.params.id), {
      startAt: routeStartAt(route),
    });
    const totals = routeTotals(stops);
    res.json({
      route,
      stops,
      totals,
      windowViolations: checkTimeWindows(stops),
      capacityProblems: checkCapacity(totals, route),
    });
  } catch (err) {
    sendError(res, err, 'Nu am putut încărca planul rutei');
  }
});

/** Assigns an order to a route as a new stop. */
router.post('/:id/stops', async (req, res) => {
  try {
    const { order_id, at_index } = req.body || {};
    if (!order_id) return res.status(400).json({ message: 'order_id este obligatoriu' });

    const orderRes = await query(
      `SELECT * FROM orders WHERE id = $1 AND company_id = $2`,
      [order_id, req.user.company_id]
    );
    const order = orderRes.rows[0];
    if (!order) return res.status(404).json({ message: 'Comandă inexistentă' });
    if (!order.location_id) {
      return res.status(400).json({ message: 'Comanda nu are o locație asociată' });
    }

    const existing = await loadStops(pool, req.user.company_id, req.params.id);
    const seq = existing.length + 1;

    let created;
    try {
      const inserted = await query(
        `INSERT INTO route_stops
           (company_id, route_id, seq, location_id, order_id, kind, service_time_min)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          req.user.company_id, req.params.id, seq, order.location_id, order.id,
          order.type === 'ridicare' ? 'ridicare' : 'livrare',
          order.service_time_min ?? 15,
        ]
      );
      created = inserted.rows[0];
    } catch (err) {
      // The partial unique index on order_id is what enforces "one route per order".
      if (err?.code === '23505') {
        return res.status(409).json({ message: 'Comanda este deja planificată pe o rută' });
      }
      throw err;
    }

    await query(
      `UPDATE orders SET status = 'planificat', updated_at = NOW() WHERE id = $1 AND company_id = $2`,
      [order.id, req.user.company_id]
    );

    if (at_index != null) {
      const stops = moveStop(await loadStops(pool, req.user.company_id, req.params.id), created.id, at_index);
      await persistSequence(req.user.company_id, stops);
    }

    res.status(201).json(await recomputeRoute(pool, req.user.company_id, req.params.id));
  } catch (err) {
    sendError(res, err, 'Adăugarea opririi a eșuat');
  }
});

/** Writes a new stop order. The unique (route_id, seq) is deferred so a full rewrite works. */
async function persistSequence(companyId, stops) {
  await withTransaction(async (client) => {
    for (const stop of stops) {
      await client.query(
        `UPDATE route_stops SET seq = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
        [stop.seq, stop.id, companyId]
      );
    }
  });
}

/** Reorders stops, either by explicit id list or by moving one stop to an index. */
router.put('/:id/sequence', async (req, res) => {
  try {
    const { stop_ids, stop_id, to_index } = req.body || {};
    const current = await loadStops(pool, req.user.company_id, req.params.id);
    if (!current.length) return res.status(404).json({ message: 'Ruta nu are opriri' });

    let next;
    if (Array.isArray(stop_ids) && stop_ids.length) next = applyOrder(current, stop_ids);
    else if (stop_id) next = moveStop(current, stop_id, to_index);
    else return res.status(400).json({ message: 'Trimite stop_ids sau stop_id + to_index' });

    await persistSequence(req.user.company_id, next);
    res.json(await recomputeRoute(pool, req.user.company_id, req.params.id));
  } catch (err) {
    sendError(res, err, 'Reordonarea a eșuat');
  }
});

/** Removes a stop and returns its order to the unplanned pool. */
router.delete('/:id/stops/:stopId', async (req, res) => {
  try {
    const current = await loadStops(pool, req.user.company_id, req.params.id);
    const target = current.find((s) => s.id === req.params.stopId);
    if (!target) return res.status(404).json({ message: 'Oprire inexistentă' });

    await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM route_stops WHERE id = $1 AND company_id = $2`,
        [req.params.stopId, req.user.company_id]
      );
      if (target.order_id) {
        await client.query(
          `UPDATE orders SET status = 'nou', updated_at = NOW() WHERE id = $1 AND company_id = $2`,
          [target.order_id, req.user.company_id]
        );
      }
      for (const stop of removeStop(current, req.params.stopId)) {
        await client.query(
          `UPDATE route_stops SET seq = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
          [stop.seq, stop.id, req.user.company_id]
        );
      }
    });

    res.json(await recomputeRoute(pool, req.user.company_id, req.params.id));
  } catch (err) {
    sendError(res, err, 'Ștergerea opririi a eșuat');
  }
});

router.post('/:id/recompute', async (req, res) => {
  try {
    const result = await recomputeRoute(pool, req.user.company_id, req.params.id);
    if (!result) return res.status(404).json({ message: 'Rută inexistentă' });
    res.json(result);
  } catch (err) {
    sendError(res, err, 'Recalculul rutei a eșuat');
  }
});

export default router;

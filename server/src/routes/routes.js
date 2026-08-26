import { Router } from 'express';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { pool, query, withTransaction } from '../db.js';
import { serializeRow } from '../entities.js';
import { osrmConfigured } from '../lib/geo/osrm.js';
import { cachedMatrix } from '../lib/geo/matrixCache.js';
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
import { buildTripDrafts, cmrEligibleStops, fullAddress } from '../lib/routing/routeCmr.js';

const router = Router();
router.use(authRequired);

/**
 * A route's stops joined with everything the planner needs: where the stop is, what it
 * carries and when it may be served. The contact columns are here because the same rows
 * feed the CMR generator and the driver app, which both need someone to call.
 */
async function loadStops(db, companyId, routeId) {
  const result = await db.query(
    `SELECT s.*,
            l.name AS location_name, l.address, l.city, l.county,
            l.latitude, l.longitude, l.contact_person, l.phone, l.access_notes,
            o.order_number, o.weight_kg, o.volume_mc, o.pallets, o.requires,
            o.goods_description, o.notes AS order_notes,
            COALESCE(o.window_start, l.window_start) AS window_start,
            COALESCE(o.window_end,   l.window_end)   AS window_end,
            c.name AS client_name, c.cui AS client_cui,
            c.phone AS client_phone, c.email AS client_email
     FROM route_stops s
     LEFT JOIN locations l ON l.id = s.location_id
     LEFT JOIN orders o    ON o.id = s.order_id
     LEFT JOIN clients c   ON c.id = o.client_id
     WHERE s.company_id = $1 AND s.route_id = $2
     ORDER BY s.seq`,
    [companyId, routeId]
  );
  // `address_full` is composed once here so the board, the CMR and the driver app all show
  // the same street-city-county string.
  return result.rows.map((row) => {
    const stop = serializeRow(row);
    return { ...stop, address_full: fullAddress(stop) };
  });
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
      const matrix = await cachedMatrix(db, companyId, positioned.map((s) => ({
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

const OFFICE_ROLES = new Set(['admin', 'dispatcher', 'finance']);

/**
 * The driver profile behind the signed-in user. Matched by `user_id` first and by email as
 * a fallback, the same rule the driver app uses — a profile created before the account was
 * linked still resolves.
 */
async function driverForUser(db, user) {
  const result = await db.query(
    `SELECT * FROM drivers
     WHERE company_id = $1 AND (user_id = $2 OR (email IS NOT NULL AND LOWER(email) = LOWER($3)))
     ORDER BY (user_id = $2) DESC
     LIMIT 1`,
    [user.company_id, user.id, user.email || '']
  );
  return result.rows[0] || null;
}

/*
 * Driver-facing endpoints. Everything below `router.use(officeRequired)` is dispatcher-only;
 * these two are the exception, so a driver can see the stop list and report progress.
 */

/** The signed-in driver's routes for one day, each with its scheduled stops. */
router.get('/mine', async (req, res) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
      ? String(req.query.date)
      : new Date().toISOString().slice(0, 10);

    const driver = await driverForUser(pool, req.user);
    const isOffice = OFFICE_ROLES.has(req.user.role);
    if (!driver && !isOffice) return res.json({ driver: null, date, routes: [] });

    const params = driver ? [req.user.company_id, date, driver.id] : [req.user.company_id, date];
    const list = await pool.query(
      `SELECT r.*, v.plate AS vehicle_plate, v.capacity_kg, v.capacity_mc, d.name AS driver_name
       FROM routes r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       LEFT JOIN drivers  d ON d.id = r.driver_id
       WHERE r.company_id = $1 AND r.route_date = $2 AND r.status <> 'anulata'
         ${driver ? 'AND r.driver_id = $3' : 'AND r.driver_id IS NOT NULL'}
       ORDER BY r.starts_at, r.code`,
      params
    );

    const routes = [];
    for (const row of list.rows) {
      const route = serializeRow(row);
      const stops = scheduleStops(await loadStops(pool, req.user.company_id, route.id), {
        startAt: routeStartAt(route),
      });
      routes.push({ route, stops, totals: routeTotals(stops) });
    }

    res.json({
      driver: driver ? serializeRow(driver) : null,
      preview: !driver && isOffice,
      date,
      routes,
    });
  } catch (err) {
    sendError(res, err, 'Nu am putut încărca ruta zilei');
  }
});

const STOP_STATUSES = new Set(['planificat', 'sosit', 'finalizat', 'esuat', 'sarit']);
const ORDER_STATUS_FOR_STOP = { sosit: 'pe_ruta', finalizat: 'livrat', esuat: 'esuat', planificat: 'planificat' };

/**
 * A driver reporting progress on one stop.
 *
 * Timestamps are stamped by the server, not sent by the phone: a clock that is off by an
 * hour would otherwise land in the proof-of-delivery record.
 */
router.put('/:id/stops/:stopId/status', async (req, res) => {
  try {
    const status = String(req.body?.status || '');
    if (!STOP_STATUSES.has(status)) {
      return res.status(400).json({ message: 'Status necunoscut pentru oprire' });
    }

    const route = await loadRoute(pool, req.user.company_id, req.params.id);
    if (!route) return res.status(404).json({ message: 'Rută inexistentă' });

    if (!OFFICE_ROLES.has(req.user.role)) {
      const driver = await driverForUser(pool, req.user);
      if (!driver || route.driver_id !== driver.id) {
        return res.status(403).json({ message: 'Ruta nu îți este alocată' });
      }
    }

    const stops = await loadStops(pool, req.user.company_id, req.params.id);
    const target = stops.find((s) => s.id === req.params.stopId);
    if (!target) return res.status(404).json({ message: 'Oprire inexistentă' });

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE route_stops
         SET status = $1,
             actual_arrival = CASE
               WHEN $1 = 'planificat' THEN NULL
               WHEN actual_arrival IS NULL THEN NOW()
               ELSE actual_arrival END,
             actual_departure = CASE
               WHEN $1 IN ('finalizat', 'esuat') THEN COALESCE(actual_departure, NOW())
               ELSE NULL END,
             updated_at = NOW()
         WHERE id = $2 AND company_id = $3`,
        [status, target.id, req.user.company_id]
      );

      if (target.order_id && ORDER_STATUS_FOR_STOP[status]) {
        await client.query(
          `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
          [ORDER_STATUS_FOR_STOP[status], target.order_id, req.user.company_id]
        );
      }

      // The route's own status follows its stops, so nobody has to remember to set it.
      const others = stops.filter((s) => s.id !== target.id).map((s) => s.status);
      const all = [...others, status];
      const done = all.every((s) => s === 'finalizat' || s === 'esuat' || s === 'sarit');
      const started = all.some((s) => s !== 'planificat');
      const next = done ? 'finalizata' : started ? 'in_executie' : 'lansata';
      if (route.status !== next && route.status !== 'anulata') {
        await client.query(
          `UPDATE routes SET status = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
          [next, route.id, req.user.company_id]
        );
      }
    });

    const fresh = scheduleStops(await loadStops(pool, req.user.company_id, req.params.id), {
      startAt: routeStartAt(route),
    });
    res.json({ route: await loadRoute(pool, req.user.company_id, req.params.id), stops: fresh });
  } catch (err) {
    sendError(res, err, 'Actualizarea opririi a eșuat');
  }
});

/**
 * ePOD for one stop — signature / photos / refusal. Closes the stop as finalizat or esuat.
 * Drivers may only write on their assigned route; office may write any company route.
 */
router.post('/:id/stops/:stopId/pod', async (req, res) => {
  try {
    const {
      saveProofDataUrl,
      stopStatusForOutcome,
      validatePodInput,
    } = await import('../lib/telematics/epod.js');
    const { createOfficeNotification } = await import('../lib/officeNotifications.js');

    const parsed = validatePodInput(req.body || {});
    if (!parsed.ok) return res.status(400).json({ message: parsed.error });

    const route = await loadRoute(pool, req.user.company_id, req.params.id);
    if (!route) return res.status(404).json({ message: 'Rută inexistentă' });

    if (!OFFICE_ROLES.has(req.user.role)) {
      const driver = await driverForUser(pool, req.user);
      if (!driver || route.driver_id !== driver.id) {
        return res.status(403).json({ message: 'Ruta nu îți este alocată' });
      }
    }

    const stops = await loadStops(pool, req.user.company_id, req.params.id);
    const target = stops.find((s) => s.id === req.params.stopId);
    if (!target) return res.status(404).json({ message: 'Oprire inexistentă' });
    if (['finalizat', 'esuat', 'sarit'].includes(target.status)) {
      const existing = await query(
        `SELECT * FROM delivery_proofs WHERE company_id = $1 AND route_stop_id = $2`,
        [req.user.company_id, target.id]
      );
      if (existing.rows[0]) {
        return res.json({
          proof: serializeRow(existing.rows[0]),
          route: await loadRoute(pool, req.user.company_id, req.params.id),
          stops: scheduleStops(stops, { startAt: routeStartAt(route) }),
        });
      }
      return res.status(409).json({ message: 'Oprirea e deja închisă fără dovadă' });
    }

    let signatureUrl = parsed.value.signature_url;
    if (parsed.value.signature_data_url) {
      const saved = saveProofDataUrl(req.user.company_id, parsed.value.signature_data_url, {
        kind: 'signature',
      });
      if (!saved.ok) return res.status(400).json({ message: saved.error });
      signatureUrl = saved.url;
    }

    const tripLookup = await query(
      `SELECT id FROM trips WHERE company_id = $1 AND route_stop_id = $2 LIMIT 1`,
      [req.user.company_id, target.id]
    );
    const tripId = tripLookup.rows[0]?.id || null;

    const status = stopStatusForOutcome(parsed.value.outcome);
    let proofRow;

    await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO delivery_proofs (
           company_id, route_id, route_stop_id, trip_id,
           outcome, recipient_name, signature_url, photo_urls,
           refusal_reason, notes, latitude, longitude, captured_by
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13
         )
         ON CONFLICT (company_id, route_stop_id) DO UPDATE SET
           outcome = EXCLUDED.outcome,
           recipient_name = EXCLUDED.recipient_name,
           signature_url = EXCLUDED.signature_url,
           photo_urls = EXCLUDED.photo_urls,
           refusal_reason = EXCLUDED.refusal_reason,
           notes = EXCLUDED.notes,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           captured_by = EXCLUDED.captured_by,
           captured_at = NOW(),
           updated_at = NOW()
         RETURNING *`,
        [
          req.user.company_id,
          route.id,
          target.id,
          tripId,
          parsed.value.outcome,
          parsed.value.recipient_name,
          signatureUrl,
          JSON.stringify(parsed.value.photo_urls),
          parsed.value.refusal_reason,
          parsed.value.notes,
          parsed.value.latitude,
          parsed.value.longitude,
          req.user.id,
        ]
      );
      proofRow = inserted.rows[0];

      await client.query(
        `UPDATE route_stops
         SET status = $1,
             actual_arrival = COALESCE(actual_arrival, NOW()),
             actual_departure = COALESCE(actual_departure, NOW()),
             updated_at = NOW()
         WHERE id = $2 AND company_id = $3`,
        [status, target.id, req.user.company_id]
      );

      if (target.order_id && ORDER_STATUS_FOR_STOP[status]) {
        await client.query(
          `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
          [ORDER_STATUS_FOR_STOP[status], target.order_id, req.user.company_id]
        );
      }

      const others = stops.filter((s) => s.id !== target.id).map((s) => s.status);
      const all = [...others, status];
      const done = all.every((s) => s === 'finalizat' || s === 'esuat' || s === 'sarit');
      const started = all.some((s) => s !== 'planificat');
      const next = done ? 'finalizata' : started ? 'in_executie' : 'lansata';
      if (route.status !== next && route.status !== 'anulata') {
        await client.query(
          `UPDATE routes SET status = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
          [next, route.id, req.user.company_id]
        );
      }
    });

    try {
      await createOfficeNotification({
        company_id: req.user.company_id,
        type: 'trip_status',
        title: parsed.value.outcome === 'refuzat'
          ? `Refuz la oprirea ${target.seq}`
          : `ePOD · oprirea ${target.seq}`,
        message: [
          route.code || 'Rută',
          target.location_name || target.client_name || '',
          parsed.value.recipient_name || parsed.value.refusal_reason || '',
        ].filter(Boolean).join(' · '),
        link: '/dispatch',
      });
    } catch { /* optional */ }

    try {
      const { publish } = await import('../lib/telematics/liveHub.js');
      publish(req.user.company_id, 'pod', serializeRow(proofRow));
    } catch { /* optional */ }

    const freshStops = scheduleStops(
      await loadStops(pool, req.user.company_id, req.params.id),
      { startAt: routeStartAt(route) }
    );
    res.status(201).json({
      proof: serializeRow(proofRow),
      route: await loadRoute(pool, req.user.company_id, req.params.id),
      stops: freshStops,
    });
  } catch (err) {
    sendError(res, err, 'Salvarea dovezii a eșuat');
  }
});

router.get('/:id/stops/:stopId/pod', async (req, res) => {
  try {
    const route = await loadRoute(pool, req.user.company_id, req.params.id);
    if (!route) return res.status(404).json({ message: 'Rută inexistentă' });

    if (!OFFICE_ROLES.has(req.user.role)) {
      const driver = await driverForUser(pool, req.user);
      if (!driver || route.driver_id !== driver.id) {
        return res.status(403).json({ message: 'Ruta nu îți este alocată' });
      }
    }

    const result = await query(
      `SELECT * FROM delivery_proofs
       WHERE company_id = $1 AND route_id = $2 AND route_stop_id = $3`,
      [req.user.company_id, route.id, req.params.stopId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Nicio dovadă pe această oprire' });
    res.json(serializeRow(result.rows[0]));
  } catch (err) {
    sendError(res, err, 'Citirea dovezii a eșuat');
  }
});

router.use(officeRequired);

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

const TRIP_COLUMNS = [
  'route_id', 'route_stop_id', 'cmr_number', 'driver_id', 'vehicle_id', 'driver_name', 'vehicle_plate',
  'shipper_name', 'shipper_address', 'shipper_cui', 'shipper_contact', 'shipper_phone', 'shipper_email',
  'consignee_name', 'consignee_address', 'consignee_cui', 'consignee_contact', 'consignee_phone', 'consignee_email',
  'loading_date', 'loading_time', 'estimated_delivery_date', 'estimated_delivery_time',
  'goods_description', 'weight_kg', 'volume_mc', 'package_count', 'special_instructions',
  'internal_notes', 'status',
];

/**
 * One CMR per order stop on the route.
 *
 * Idempotent by design: stops that already produced a document are skipped, so a dispatcher
 * who adds a stop and presses the button again gets the one missing CMR rather than a
 * duplicate set. `route_stop_id` carries that link and a partial unique index enforces it.
 */
router.post('/:id/trips', async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const route = await loadRoute(pool, companyId, req.params.id);
    if (!route) return res.status(404).json({ message: 'Rută inexistentă' });

    const stops = scheduleStops(await loadStops(pool, companyId, req.params.id), {
      startAt: routeStartAt(route),
    });
    const eligible = cmrEligibleStops(stops);
    if (!eligible.length) {
      return res.status(400).json({ message: 'Ruta nu are opriri cu comenzi — nu e nimic de emis' });
    }

    const day = String(route.route_date || '').slice(0, 10).replace(/-/g, '');
    const [company, already, numbers] = await Promise.all([
      query(`SELECT name, address, cui, phone, email FROM companies WHERE id = $1`, [companyId]),
      query(
        `SELECT route_stop_id FROM trips
         WHERE company_id = $1 AND route_stop_id = ANY($2::uuid[])`,
        [companyId, eligible.map((s) => s.id)]
      ),
      query(
        `SELECT cmr_number FROM trips WHERE company_id = $1 AND cmr_number LIKE $2`,
        [companyId, `CMR-${day.slice(0, 4)}-${day.slice(4)}-%`]
      ),
    ]);

    const skipStopIds = already.rows.map((r) => r.route_stop_id);
    const drafts = buildTripDrafts({
      route,
      stops,
      company: company.rows[0] || null,
      existingNumbers: numbers.rows.map((r) => r.cmr_number),
      skipStopIds,
    });

    if (!drafts.length) {
      return res.json({
        created: [],
        skipped: skipStopIds.length,
        message: 'Toate opririle au deja CMR emis',
      });
    }
    if (drafts.some((draft) => !draft.cmr_number)) {
      return res.status(400).json({ message: 'Ruta nu are o dată validă — nu pot numerota CMR-urile' });
    }

    const placeholders = TRIP_COLUMNS.map((_, i) => `$${i + 2}`).join(', ');
    const created = await withTransaction(async (client) => {
      const out = [];
      for (const draft of drafts) {
        const inserted = await client.query(
          `INSERT INTO trips (company_id, ${TRIP_COLUMNS.join(', ')})
           VALUES ($1, ${placeholders})
           RETURNING *`,
          [companyId, ...TRIP_COLUMNS.map((col) => draft[col] ?? null)]
        );
        out.push(serializeRow(inserted.rows[0]));
      }
      return out;
    });

    res.status(201).json({ created, skipped: skipStopIds.length });
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({
        message: 'Un CMR cu acest număr tocmai a fost creat. Reîncearcă.',
      });
    }
    sendError(res, err, 'Generarea CMR-urilor a eșuat');
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

/**
 * Launch a planned route: status → lansata, then request UIT (stub/ANAF adapter).
 */
router.post('/:id/launch', async (req, res) => {
  try {
    const { requestUitForRoute, isStubUit } = await import('../lib/compliance/etransport.js');
    const route = await loadRoute(pool, req.user.company_id, req.params.id);
    if (!route) return res.status(404).json({ message: 'Rută inexistentă' });
    if (['anulata', 'finalizata'].includes(route.status)) {
      return res.status(409).json({ message: `Ruta e ${route.status} — nu o poți lansa` });
    }

    await query(
      `UPDATE routes SET status = 'lansata', updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [route.id, req.user.company_id]
    );

    let uit = null;
    if (!route.uit_code) {
      await query(
        `UPDATE routes SET uit_status = 'pending', uit_requested_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND company_id = $2`,
        [route.id, req.user.company_id]
      );
      const companyRes = await query(`SELECT id, name, fiscal_code FROM companies WHERE id = $1`, [req.user.company_id]);
      const result = await requestUitForRoute(
        { ...route, status: 'lansata' },
        { company: companyRes.rows[0] }
      );
      if (result.ok && result.uit_code) {
        await query(
          `UPDATE routes SET uit_code = $1, uit_status = $2, uit_source = $3,
             uit_error = NULL, updated_at = NOW()
           WHERE id = $4 AND company_id = $5`,
          [result.uit_code, result.status || 'obtained', result.source || null,
           route.id, req.user.company_id]
        );
        uit = result;
      } else {
        await query(
          `UPDATE routes SET uit_status = $1, uit_error = $2, updated_at = NOW()
           WHERE id = $3 AND company_id = $4`,
          [result.status || 'failed', result.message || 'UIT eșuat', route.id, req.user.company_id]
        );
        uit = result;
      }
    } else {
      uit = {
        ok: true,
        status: route.uit_status || 'manual',
        uit_code: route.uit_code,
        source: route.uit_source || 'manual',
        stub: isStubUit(route.uit_code),
      };
    }

    const fresh = await loadRoute(pool, req.user.company_id, req.params.id);
    res.json({ route: serializeRow(fresh), uit });
  } catch (err) {
    sendError(res, err, 'Lansarea rutei a eșuat');
  }
});

export default router;

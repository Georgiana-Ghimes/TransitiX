import { Router } from 'express';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { pool, query } from '../db.js';
import { serializeRow } from '../entities.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import {
  generateTelematicsKey,
  hashTelematicsKey,
  ingestPosition,
  ingestPositions,
  looksLikeTelematicsKey,
} from '../lib/telematics/ingest.js';
import { createLogger } from '../lib/log.js';

const log = createLogger({ scope: 'telematics' });

const router = Router();
const ingestHits = new Map();
const driverHits = new Map();

function sendError(res, err, fallback) {
  const status = err.status || 500;
  if (status >= 500) log.error('eroare', err);
  res.status(status).json({ message: err.message || fallback });
}

function extractApiKey(req) {
  const header = req.headers['x-telematics-key'] || req.headers['x-api-key'];
  if (header) return String(header).trim();
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer tx_')) return auth.slice(7).trim();
  return null;
}

async function companyFromApiKey(key) {
  if (!looksLikeTelematicsKey(key)) return null;
  const result = await query(
    `SELECT id, name FROM companies WHERE telematics_api_key_hash = $1`,
    [hashTelematicsKey(key)]
  );
  return result.rows[0] || null;
}

/**
 * Provider webhook — no JWT. Authenticate with the company telematics key.
 * Body: { positions: [...] } or a single position object.
 */
router.post('/ingest', async (req, res) => {
  try {
    const key = extractApiKey(req);
    if (!key) {
      return res.status(401).json({ message: 'Lipsește cheia X-Telematics-Key' });
    }
    const company = await companyFromApiKey(key);
    if (!company) {
      return res.status(401).json({ message: 'Cheie telematics invalidă' });
    }

    const limit = hitRateLimit(ingestHits, company.id, { max: 600, windowMs: 60_000 });
    if (!limit.ok) {
      return res.status(429).json({ message: 'Prea multe poziții. Reîncearcă într-un minut.' });
    }

    const body = req.body || {};
    const samples = Array.isArray(body.positions)
      ? body.positions
      : Array.isArray(body)
        ? body
        : [body];

    if (!samples.length) {
      return res.status(400).json({ message: 'Nicio poziție în corp' });
    }
    if (samples.length > 200) {
      return res.status(400).json({ message: 'Maxim 200 de poziții pe cerere' });
    }

    const result = await ingestPositions(pool, company.id, samples, { defaultSource: 'webhook' });
    res.status(202).json({
      accepted: result.accepted.length,
      rejected: result.rejected,
    });
  } catch (err) {
    sendError(res, err, 'Ingest telematics eșuat');
  }
});

/**
 * Driver phone → one position. Vehicle comes from the driver's active route today when
 * not supplied, so the app does not have to know fleet IDs.
 */
router.post('/position', authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'driver' && req.user.role !== 'admin' && req.user.role !== 'dispatcher') {
      return res.status(403).json({ message: 'Doar șoferul sau biroul pot trimite poziții' });
    }

    const limit = hitRateLimit(driverHits, req.user.id, { max: 120, windowMs: 60_000 });
    if (!limit.ok) {
      return res.status(429).json({ message: 'Prea multe poziții. Reîncearcă mai târziu.' });
    }

    const body = { ...(req.body || {}), source: 'driver_app' };

    if (!body.vehicle_id && !body.vehicle_plate) {
      const driver = await query(
        `SELECT id FROM drivers WHERE company_id = $1 AND user_id = $2 LIMIT 1`,
        [req.user.company_id, req.user.id]
      );
      const driverId = driver.rows[0]?.id;
      if (driverId) {
        const route = await query(
          `SELECT id, vehicle_id FROM routes
           WHERE company_id = $1 AND driver_id = $2
             AND route_date = CURRENT_DATE
             AND status IN ('lansata', 'in_executie', 'planificata')
             AND vehicle_id IS NOT NULL
           ORDER BY
             CASE status WHEN 'in_executie' THEN 0 WHEN 'lansata' THEN 1 ELSE 2 END,
             updated_at DESC
           LIMIT 1`,
          [req.user.company_id, driverId]
        );
        if (route.rows[0]) {
          body.vehicle_id = route.rows[0].vehicle_id;
          body.route_id = body.route_id || route.rows[0].id;
        }
      }
    }

    if (!body.vehicle_id && !body.vehicle_plate) {
      return res.status(422).json({
        message: 'Nu am un vehicul pe ruta de azi — trimite vehicle_id sau așteaptă alocarea',
      });
    }

    const row = await ingestPosition(pool, req.user.company_id, body, {
      defaultSource: 'driver_app',
    });
    if (!row) {
      return res.status(404).json({ message: 'Vehiculul nu a fost găsit' });
    }
    res.status(201).json(serializeRow(row));
  } catch (err) {
    sendError(res, err, 'Trimiterea poziției a eșuat');
  }
});

/** Current positions for the live board — same shape the map already expects, plus source. */
router.get('/live', authRequired, officeRequired, async (req, res) => {
  try {
    const result = await query(
      `SELECT g.*, t.source AS telematics_source, t.recorded_at AS telematics_recorded_at,
              t.accuracy_m
       FROM gps_logs g
       LEFT JOIN LATERAL (
         SELECT source, recorded_at, accuracy_m
         FROM telematics_positions tp
         WHERE tp.company_id = g.company_id AND tp.vehicle_id = g.vehicle_id
         ORDER BY tp.recorded_at DESC
         LIMIT 1
       ) t ON TRUE
       WHERE g.company_id = $1 AND g.is_current = TRUE
       ORDER BY g.updated_at DESC`,
      [req.user.company_id]
    );
    res.json(result.rows.map(serializeRow));
  } catch (err) {
    sendError(res, err, 'Citirea pozițiilor a eșuat');
  }
});

/** Trail for one vehicle (raw breadcrumb). */
router.get('/trail/:vehicleId', authRequired, officeRequired, async (req, res) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 24 * 3600 * 1000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      return res.status(400).json({ message: 'from/to invalide' });
    }
    const result = await query(
      `SELECT * FROM telematics_positions
       WHERE company_id = $1 AND vehicle_id = $2
         AND recorded_at >= $3 AND recorded_at <= $4
       ORDER BY recorded_at ASC
       LIMIT 5000`,
      [req.user.company_id, req.params.vehicleId, from, to]
    );
    res.json(result.rows.map(serializeRow));
  } catch (err) {
    sendError(res, err, 'Citirea traseului a eșuat');
  }
});

/**
 * Routes available for historical replay on a calendar day.
 * A route is listed when it has a vehicle and at least one stop or telematics sample that day.
 */
router.get('/replay', authRequired, officeRequired, async (req, res) => {
  try {
    const date = String(req.query.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'date=YYYY-MM-DD este obligatoriu' });
    }
    const result = await query(
      `SELECT r.id, r.code, r.status, r.route_date, r.vehicle_id, r.driver_id,
              r.planned_distance_km, r.planned_duration_min,
              v.plate AS vehicle_plate, d.name AS driver_name,
              (SELECT COUNT(*)::int FROM route_stops s WHERE s.route_id = r.id) AS stop_count,
              (SELECT COUNT(*)::int FROM telematics_positions tp
                WHERE tp.company_id = r.company_id
                  AND tp.vehicle_id = r.vehicle_id
                  AND tp.recorded_at >= $2::date
                  AND tp.recorded_at < ($2::date + INTERVAL '1 day')
              ) AS trail_points
       FROM routes r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       LEFT JOIN drivers d ON d.id = r.driver_id
       WHERE r.company_id = $1
         AND r.route_date = $2::date
         AND r.vehicle_id IS NOT NULL
         AND r.status <> 'anulata'
       ORDER BY r.code`,
      [req.user.company_id, date]
    );
    res.json(result.rows.map(serializeRow));
  } catch (err) {
    sendError(res, err, 'Lista de reluări a eșuat');
  }
});

/**
 * One route: planned OSRM geometry (if routing is up) + realized telematics trail for the day.
 */
router.get('/replay/:routeId', authRequired, officeRequired, async (req, res) => {
  try {
    const {
      downsampleTrail,
      replayKpis,
      toLatLngPath,
      trailLengthM,
    } = await import('../lib/telematics/replay.js');
    const { osrmConfigured, osrmRoute } = await import('../lib/geo/osrm.js');

    const routeRes = await query(
      `SELECT r.*, v.plate AS vehicle_plate, d.name AS driver_name
       FROM routes r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       LEFT JOIN drivers d ON d.id = r.driver_id
       WHERE r.id = $1 AND r.company_id = $2`,
      [req.params.routeId, req.user.company_id]
    );
    const route = routeRes.rows[0];
    if (!route) return res.status(404).json({ message: 'Rută inexistentă' });
    if (!route.vehicle_id) {
      return res.status(422).json({ message: 'Ruta nu are vehicul — nu există traseu de reluat' });
    }

    const stopsRes = await query(
      `SELECT s.id, s.seq, s.kind, s.status, s.planned_arrival, s.actual_arrival,
              s.planned_departure, s.actual_departure,
              l.name AS location_name, l.latitude, l.longitude,
              o.order_number, c.name AS client_name
       FROM route_stops s
       LEFT JOIN locations l ON l.id = s.location_id
       LEFT JOIN orders o ON o.id = s.order_id
       LEFT JOIN clients c ON c.id = o.client_id
       WHERE s.company_id = $1 AND s.route_id = $2
       ORDER BY s.seq`,
      [req.user.company_id, route.id]
    );
    const stops = stopsRes.rows.map(serializeRow);

    const day = String(route.route_date).slice(0, 10);
    const trailRes = await query(
      `SELECT latitude, longitude, speed, recorded_at, source, route_id
       FROM telematics_positions
       WHERE company_id = $1 AND vehicle_id = $2
         AND recorded_at >= $3::date
         AND recorded_at < ($3::date + INTERVAL '1 day')
       ORDER BY recorded_at ASC
       LIMIT 8000`,
      [req.user.company_id, route.vehicle_id, day]
    );
    // Prefer samples tagged with this route; fall back to the whole vehicle day.
    const tagged = trailRes.rows.filter((p) => p.route_id === route.id);
    const rawTrail = tagged.length >= 5 ? tagged : trailRes.rows;
    const trail = downsampleTrail(rawTrail);
    const actualDistanceM = trailLengthM(trail);

    let planned = null;
    const stopPoints = stops
      .filter((s) => s.latitude != null && s.longitude != null)
      .map((s) => ({ latitude: Number(s.latitude), longitude: Number(s.longitude) }));

    if (osrmConfigured() && stopPoints.length >= 2) {
      try {
        const routed = await osrmRoute(stopPoints, { overview: 'full' });
        const coords = routed?.geometry?.coordinates || [];
        planned = {
          coordinates: toLatLngPath(coords),
          distance_m: routed.distance_km != null ? Math.round(Number(routed.distance_km) * 1000) : null,
          duration_s: routed.duration_min != null ? Math.round(Number(routed.duration_min) * 60) : null,
          distance_km: routed.distance_km ?? null,
          duration_min: routed.duration_min ?? null,
        };
      } catch (err) {
        log.error('replay osrm', err.message);
      }
    }

    const exceptions = await query(
      `SELECT * FROM route_exceptions
       WHERE company_id = $1 AND route_id = $2
       ORDER BY detected_at ASC
       LIMIT 200`,
      [req.user.company_id, route.id]
    );

    const kpis = replayKpis({
      plannedDistanceM: planned?.distance_m
        ?? (route.planned_distance_km != null ? Number(route.planned_distance_km) * 1000 : null),
      actualDistanceM,
      stops,
    });

    res.json({
      route: serializeRow(route),
      stops,
      planned,
      actual: {
        points: trail,
        coordinates: toLatLngPath(trail),
        distance_m: actualDistanceM,
        sample_count: rawTrail.length,
      },
      exceptions: exceptions.rows.map(serializeRow),
      kpis,
    });
  } catch (err) {
    sendError(res, err, 'Reluarea rutei a eșuat');
  }
});

/**
 * Live board SSE. EventSource cannot set Authorization headers, so the access token
 * may arrive as ?access_token= — same pattern as /uploads preview.
 */
router.get('/stream', (req, res, next) => {
  if (!req.headers.authorization && req.query?.access_token) {
    req.headers.authorization = `Bearer ${String(req.query.access_token)}`;
  }
  next();
}, authRequired, officeRequired, async (req, res) => {
  const { subscribe, publish } = await import('../lib/telematics/liveHub.js');

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  res.write(`event: hello\ndata: ${JSON.stringify({ company_id: req.user.company_id })}\n\n`);

  const unsub = subscribe(req.user.company_id, res);
  const ping = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);
    } catch {
      clearInterval(ping);
      unsub();
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(ping);
    unsub();
  });

  // Touch publish so the import is not tree-shaken in odd bundlers; no-op if alone.
  void publish;
});

/** Open (or all) route exceptions for the live board. */
router.get('/exceptions', authRequired, officeRequired, async (req, res) => {
  try {
    const openOnly = String(req.query.open ?? '1') !== '0';
    const routeId = req.query.route_id ? String(req.query.route_id) : null;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const params = [req.user.company_id];
    const clauses = ['e.company_id = $1'];
    if (openOnly) clauses.push('e.resolved_at IS NULL');
    if (routeId) {
      params.push(routeId);
      clauses.push(`e.route_id = $${params.length}`);
    }
    params.push(limit);
    const result = await query(
      `SELECT e.*,
              r.code AS route_code,
              v.plate AS vehicle_plate
       FROM route_exceptions e
       LEFT JOIN routes r ON r.id = e.route_id
       LEFT JOIN vehicles v ON v.id = e.vehicle_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY
         CASE e.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         e.detected_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(result.rows.map(serializeRow));
  } catch (err) {
    sendError(res, err, 'Citirea excepțiilor a eșuat');
  }
});

/** Dispatcher acknowledges an open exception (still open until resolved). */
router.post('/exceptions/:id/ack', authRequired, officeRequired, async (req, res) => {
  try {
    const result = await query(
      `UPDATE route_exceptions
       SET acknowledged_at = COALESCE(acknowledged_at, NOW()),
           acknowledged_by = COALESCE(acknowledged_by, $3),
           updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND resolved_at IS NULL
       RETURNING *`,
      [req.params.id, req.user.company_id, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Excepție negăsită sau deja închisă' });
    }
    try {
      const { publish } = await import('../lib/telematics/liveHub.js');
      publish(req.user.company_id, 'exception_ack', serializeRow(result.rows[0]));
    } catch { /* optional */ }
    res.json(serializeRow(result.rows[0]));
  } catch (err) {
    sendError(res, err, 'Confirmarea excepției a eșuat');
  }
});

/** Close an exception (ack + resolve). */
router.post('/exceptions/:id/resolve', authRequired, officeRequired, async (req, res) => {
  try {
    const result = await query(
      `UPDATE route_exceptions
       SET acknowledged_at = COALESCE(acknowledged_at, NOW()),
           acknowledged_by = COALESCE(acknowledged_by, $3),
           resolved_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND resolved_at IS NULL
       RETURNING *`,
      [req.params.id, req.user.company_id, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Excepție negăsită sau deja închisă' });
    }
    try {
      const { publish } = await import('../lib/telematics/liveHub.js');
      publish(req.user.company_id, 'exception_resolved', { id: result.rows[0].id });
    } catch { /* optional */ }
    res.json(serializeRow(result.rows[0]));
  } catch (err) {
    sendError(res, err, 'Închiderea excepției a eșuat');
  }
});

/** Rotate the company webhook key. Returns the plaintext once. */
router.post('/key', authRequired, officeRequired, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Doar administratorul poate roti cheia' });
    }
    const key = generateTelematicsKey();
    await query(
      `UPDATE companies SET telematics_api_key_hash = $1, updated_at = NOW()
       WHERE id = $2`,
      [hashTelematicsKey(key), req.user.company_id]
    );
    res.status(201).json({
      api_key: key,
      header: 'X-Telematics-Key',
      ingest_url: '/api/telematics/ingest',
      message: 'Salvează cheia acum — nu o mai afișăm.',
    });
  } catch (err) {
    sendError(res, err, 'Generarea cheii a eșuat');
  }
});

export default router;

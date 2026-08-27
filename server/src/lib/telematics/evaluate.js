/**
 * After a position is stored: load the vehicle's live route, detect exceptions,
 * persist new ones, cascade ETAs when a stop is late, notify the office.
 */

import { sendEmail } from '../email.js';
import { createOfficeNotification } from '../officeNotifications.js';
import {
  cascadeEta,
  detectExceptions,
  updateIdleSince,
} from './exceptions.js';
import { createLogger } from '../log.js';

const log = createLogger({ scope: 'telematics/evaluate' });

/**
 * Best-effort mail to clients on stops pushed by an ETA cascade.
 * Stubbed when Resend is not configured (same as the rest of the mail path).
 */
export async function notifyClientsOfDelay(stops, { fromSeq, delayMin, routeCode } = {}) {
  const seq = Number(fromSeq);
  const delay = Math.round(Number(delayMin) || 0);
  if (!Number.isFinite(seq) || delay <= 0) return { sent: 0 };

  const seen = new Set();
  let sent = 0;
  for (const stop of stops || []) {
    if (!(Number(stop.seq) >= seq)) continue;
    if (['finalizat', 'esuat', 'sarit'].includes(stop.status)) continue;
    const to = String(stop.client_email || '').trim();
    if (!to || seen.has(to.toLowerCase())) continue;
    seen.add(to.toLowerCase());

    const eta = stop.planned_arrival
      ? new Date(new Date(stop.planned_arrival).getTime() + delay * 60_000)
      : null;
    const etaText = eta && Number.isFinite(eta.getTime())
      ? eta.toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : 'în curs de actualizare';

    try {
      await sendEmail({
        to,
        subject: `Actualizare ETA${routeCode ? ` — ${routeCode}` : ''}`,
        text: [
          stop.client_name ? `Bună ziua, ${stop.client_name},` : 'Bună ziua,',
          '',
          `Livrarea${stop.order_number ? ` ${stop.order_number}` : ''} are o întârziere estimată de ~${delay} minute.`,
          `Noul ETA orientativ: ${etaText}.`,
          '',
          'Transitix',
        ].join('\n'),
      });
      sent += 1;
    } catch (err) {
      log.error('telematics eta-mail', err.message);
    }
  }
  return { sent };
}

/** In-process idle clocks per vehicle — fine for a single API node. */
const idleSinceByVehicle = new Map();

export function _resetIdleStateForTests() {
  idleSinceByVehicle.clear();
}

async function loadLiveRoute(db, companyId, vehicleId, routeId = null) {
  const params = [companyId, vehicleId];
  let filter = `r.company_id = $1 AND r.vehicle_id = $2
                AND r.status IN ('lansata', 'in_executie', 'planificata')
                AND r.route_date = CURRENT_DATE`;
  if (routeId) {
    params.push(routeId);
    filter = `r.company_id = $1 AND r.id = $3 AND r.vehicle_id = $2`;
  }
  const routes = await db.query(
    `SELECT r.* FROM routes r
     WHERE ${filter}
     ORDER BY
       CASE r.status WHEN 'in_executie' THEN 0 WHEN 'lansata' THEN 1 ELSE 2 END,
       r.updated_at DESC
     LIMIT 1`,
    params
  );
  const route = routes.rows[0];
  if (!route) return null;

  const stops = await db.query(
    `SELECT s.*,
            l.latitude, l.longitude,
            COALESCE(o.window_start, l.window_start) AS window_start,
            COALESCE(o.window_end,   l.window_end)   AS window_end,
            o.order_number, c.email AS client_email, c.name AS client_name
     FROM route_stops s
     LEFT JOIN locations l ON l.id = s.location_id
     LEFT JOIN orders o ON o.id = s.order_id
     LEFT JOIN clients c ON c.id = o.client_id
     WHERE s.company_id = $1 AND s.route_id = $2
     ORDER BY s.seq`,
    [companyId, route.id]
  );
  return { route, stops: stops.rows };
}

async function openExceptionExists(db, companyId, draft) {
  const result = await db.query(
    `SELECT id FROM route_exceptions
     WHERE company_id = $1
       AND type = $2
       AND vehicle_id IS NOT DISTINCT FROM $3
       AND route_id IS NOT DISTINCT FROM $4
       AND route_stop_id IS NOT DISTINCT FROM $5
       AND resolved_at IS NULL
     LIMIT 1`,
    [companyId, draft.type, draft.vehicle_id, draft.route_id, draft.route_stop_id]
  );
  return result.rows[0] || null;
}

async function insertException(db, companyId, draft) {
  const result = await db.query(
    `INSERT INTO route_exceptions (
       company_id, route_id, route_stop_id, vehicle_id,
       type, severity, message, payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING *`,
    [
      companyId,
      draft.route_id,
      draft.route_stop_id,
      draft.vehicle_id,
      draft.type,
      draft.severity,
      draft.message,
      JSON.stringify(draft.payload || {}),
    ]
  );
  return result.rows[0];
}

/**
 * Apply cascadeEta to DB stops starting at fromSeq.
 */
export async function applyEtaCascade(db, companyId, routeId, { fromSeq, delayMin }) {
  const loaded = await db.query(
    `SELECT * FROM route_stops WHERE company_id = $1 AND route_id = $2 ORDER BY seq`,
    [companyId, routeId]
  );
  const { stops, shifted } = cascadeEta(loaded.rows, { fromSeq, delayMin, now: new Date() });
  if (!shifted) return { shifted: 0, stops: loaded.rows };

  for (const stop of stops) {
    if (!(Number(stop.seq) >= Number(fromSeq))) continue;
    if (['finalizat', 'esuat', 'sarit'].includes(stop.status)) continue;
    await db.query(
      `UPDATE route_stops
       SET planned_arrival = $1, planned_departure = $2, updated_at = NOW()
       WHERE id = $3 AND company_id = $4`,
      [stop.planned_arrival, stop.planned_departure, stop.id, companyId]
    );
  }

  // Route totals: stretch planned duration by the same delay once.
  await db.query(
    `UPDATE routes
     SET planned_duration_min = COALESCE(planned_duration_min, 0) + $1,
         updated_at = NOW()
     WHERE id = $2 AND company_id = $3`,
    [Math.round(delayMin), routeId, companyId]
  );

  return { shifted, stops };
}

/**
 * Run detection for a freshly ingested position. Best-effort: never throws to the ingest path.
 */
export async function evaluatePosition(db, companyId, positionRow, {
  notify = createOfficeNotification,
} = {}) {
  try {
    if (!positionRow?.vehicle_id) return { exceptions: [], cascaded: null };

    const live = await loadLiveRoute(
      db, companyId, positionRow.vehicle_id, positionRow.route_id || null
    );

    const key = `${companyId}:${positionRow.vehicle_id}`;
    const prevIdle = idleSinceByVehicle.get(key) ?? null;
    const idleSinceMs = updateIdleSince({
      position: positionRow,
      stops: live?.stops || [],
      idleSinceMs: prevIdle,
      now: positionRow.recorded_at || new Date(),
    });
    if (idleSinceMs == null) idleSinceByVehicle.delete(key);
    else idleSinceByVehicle.set(key, idleSinceMs);

    if (!live) return { exceptions: [], cascaded: null };

    const drafts = detectExceptions({
      position: {
        ...positionRow,
        vehicle_id: positionRow.vehicle_id,
      },
      route: live.route,
      stops: live.stops,
      now: positionRow.recorded_at || new Date(),
      idleSinceMs,
    });

    const created = [];
    let cascaded = null;

    for (const draft of drafts) {
      const existing = await openExceptionExists(db, companyId, draft);
      if (existing) continue;

      const row = await insertException(db, companyId, draft);
      created.push(row);

      await notify({
        company_id: companyId,
        type: 'route_exception',
        title: draft.message,
        message: `Ruta ${live.route.code || live.route.id} · ${draft.type}`,
        link: '/dispatch',
      });

      if (draft.type === 'intarziere' && draft.payload?.by_min > 0 && draft.route_stop_id) {
        const stop = live.stops.find((s) => s.id === draft.route_stop_id);
        if (stop) {
          cascaded = await applyEtaCascade(db, companyId, live.route.id, {
            fromSeq: stop.seq,
            delayMin: draft.payload.by_min,
          });
          // Mail uses pre-cascade clocks + delay so the client sees the new ETA without
          // a second DB round-trip that would drop client_email.
          await notifyClientsOfDelay(live.stops, {
            fromSeq: stop.seq,
            delayMin: draft.payload.by_min,
            routeCode: live.route.code,
          });
        }
      }
    }

    return { exceptions: created, cascaded };
  } catch (err) {
    log.error('telematics evaluate', err.message);
    return { exceptions: [], cascaded: null, error: err.message };
  }
}

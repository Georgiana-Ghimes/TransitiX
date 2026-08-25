/**
 * Turn a solved scenario into the day's routes.
 *
 * Pure helpers first: what to delete, what to insert, how a seconds-from-midnight arrival
 * becomes a timestamp. The transactional write is promoteScenario.
 */

import { withTransaction } from '../../db.js';
import { parseRouteDate } from './scenario.js';

const LOCKED_ROUTE_STATUSES = ['lansata', 'in_executie', 'finalizata'];
const REPLACEABLE_ROUTE_STATUSES = ['draft', 'planificata'];

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Instant for a seconds-from-midnight value on the route date, in the server's local TZ. */
export function plannedInstant(routeDate, secondsFromMidnight) {
  if (secondsFromMidnight == null || !Number.isFinite(Number(secondsFromMidnight))) return null;
  const base = new Date(`${routeDate}T00:00:00`);
  if (!Number.isFinite(base.getTime())) return null;
  return new Date(base.getTime() + Math.round(Number(secondsFromMidnight)) * 1000);
}

export function routeCodeFor(index, vehiclePlate) {
  const plate = String(vehiclePlate || '').trim().replace(/\s+/g, '');
  if (plate) return `R-${plate}`.slice(0, 32);
  return `R-${String(index + 1).padStart(2, '0')}`;
}

/**
 * Stops ready for INSERT. Depot stops without a location_id fall back to the route depot
 * at write time; they are still listed here so the sequence stays intact.
 */
export function buildPromotedStops(route, routeDate) {
  return (route?.stops || []).map((stop) => ({
    seq: stop.seq,
    kind: stop.kind,
    order_id: stop.order_id || null,
    location_id: stop.location_id || null,
    service_time_min: stop.service_time_min ?? 15,
    planned_arrival: plannedInstant(routeDate, stop.arrival_sec),
    planned_departure: plannedInstant(routeDate, stop.departure_sec),
    leg_distance_km: stop.leg_distance_km ?? null,
    leg_duration_min: stop.leg_duration_min ?? null,
  }));
}

export function startsAtFromRoute(route) {
  const first = (route?.stops || []).find((s) => s.kind === 'depot_start') || route?.stops?.[0];
  if (first?.arrival_sec == null) return '08:00';
  const sec = Math.max(0, Math.round(Number(first.arrival_sec)));
  const hh = String(Math.floor(sec / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Promotes a solved scenario into real routes for that day.
 *
 * Refuses if any route that day is already live — the optimizer proposes, it does not
 * yank a truck off the road. Replaces only draft / planificata routes.
 */
export async function promoteScenario(db, {
  companyId,
  scenarioId,
  transaction = withTransaction,
} = {}) {
  const loaded = await db.query(
    `SELECT * FROM route_scenarios WHERE company_id = $1 AND id = $2`,
    [companyId, scenarioId]
  );
  const scenario = loaded.rows[0];
  if (!scenario) throw httpError('Scenariul nu a fost găsit', 404);
  if (scenario.status !== 'rulat' && scenario.status !== 'promovat') {
    throw httpError('Doar un scenariu rulat poate fi promovat în plan', 422);
  }

  const routeDate = parseRouteDate(scenario.route_date);
  if (!routeDate) throw httpError('Scenariul are o dată invalidă', 422);

  const locked = await db.query(
    `SELECT id, code, status FROM routes
     WHERE company_id = $1 AND route_date = $2::date
       AND status = ANY($3::text[])`,
    [companyId, routeDate, LOCKED_ROUTE_STATUSES]
  );
  if (locked.rows.length) {
    throw httpError(
      `Ziua are rute deja lansate (${locked.rows.map((r) => r.code).join(', ')}). `
      + 'Optimizatorul nu le înlocuiește.',
      409
    );
  }

  const plateById = new Map();
  const vehicleIds = (scenario.solution?.routes || [])
    .map((r) => r.vehicle_id)
    .filter(Boolean);
  if (vehicleIds.length) {
    const plates = await db.query(
      `SELECT id, plate FROM vehicles WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [companyId, vehicleIds]
    );
    for (const row of plates.rows) plateById.set(row.id, row.plate);
  }

  return transaction(async (tx) => {
    await tx.query(
      `UPDATE route_scenarios
       SET is_committed = FALSE,
           status = CASE WHEN status = 'promovat' THEN 'rulat' ELSE status END,
           updated_at = NOW()
       WHERE company_id = $1 AND route_date = $2::date AND is_committed = TRUE
         AND id <> $3`,
      [companyId, routeDate, scenarioId]
    );

    const doomed = await tx.query(
      `SELECT id FROM routes
       WHERE company_id = $1 AND route_date = $2::date
         AND status = ANY($3::text[])`,
      [companyId, routeDate, REPLACEABLE_ROUTE_STATUSES]
    );
    const doomedIds = doomed.rows.map((r) => r.id);
    if (doomedIds.length) {
      await tx.query(
        `UPDATE orders SET status = 'nou', updated_at = NOW()
         WHERE company_id = $1
           AND id IN (
             SELECT order_id FROM route_stops
             WHERE company_id = $1 AND route_id = ANY($2::uuid[]) AND order_id IS NOT NULL
           )
           AND status IN ('planificat', 'pe_ruta')`,
        [companyId, doomedIds]
      );
      await tx.query(
        `DELETE FROM routes WHERE company_id = $1 AND id = ANY($2::uuid[])`,
        [companyId, doomedIds]
      );
    }

    const created = [];
    const assignedOrderIds = [];

    for (let i = 0; i < (scenario.solution?.routes || []).length; i += 1) {
      const route = scenario.solution.routes[i];
      const code = routeCodeFor(i, plateById.get(route.vehicle_id));
      const inserted = await tx.query(
        `INSERT INTO routes (
           company_id, route_date, code, vehicle_id, driver_id, depot_location_id,
           starts_at, planned_distance_km, planned_duration_min, planned_cost,
           status, scenario_id
         ) VALUES (
           $1, $2::date, $3, $4, $5, $6, $7::time, $8, $9, $10, 'planificata', $11
         ) RETURNING *`,
        [
          companyId,
          routeDate,
          code,
          route.vehicle_id,
          route.driver_id,
          route.depot_location_id,
          startsAtFromRoute(route),
          route.distance_km,
          route.duration_min == null ? null : Math.round(route.duration_min),
          route.cost,
          scenarioId,
        ]
      );
      const routeRow = inserted.rows[0];
      const stops = buildPromotedStops(route, routeDate);
      let seq = 0;

      for (const stop of stops) {
        const locationId = stop.location_id
          || (['depot_start', 'depot_end', 'pauza', 'repaus'].includes(stop.kind)
            ? route.depot_location_id
            : null);
        if (!locationId && stop.order_id) {
          throw httpError('Oprire din scenariu fără locație', 422);
        }
        if (!locationId) continue;
        seq += 1;

        await tx.query(
          `INSERT INTO route_stops (
             company_id, route_id, seq, location_id, order_id, kind, service_time_min,
             planned_arrival, planned_departure, leg_distance_km, leg_duration_min, status
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'planificat'
           )`,
          [
            companyId, routeRow.id, seq, locationId, stop.order_id, stop.kind,
            stop.service_time_min, stop.planned_arrival, stop.planned_departure,
            stop.leg_distance_km,
            stop.leg_duration_min == null ? null : Math.round(stop.leg_duration_min),
          ]
        );
        if (stop.order_id) assignedOrderIds.push(stop.order_id);
      }
      created.push(routeRow);
    }

    if (assignedOrderIds.length) {
      await tx.query(
        `UPDATE orders SET status = 'planificat', updated_at = NOW()
         WHERE company_id = $1 AND id = ANY($2::uuid[])
           AND status IN ('nou', 'planificat')`,
        [companyId, assignedOrderIds]
      );
    }

    await tx.query(
      `UPDATE route_scenarios
       SET is_committed = TRUE, status = 'promovat', updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [scenarioId, companyId]
    );

    return { scenario_id: scenarioId, route_date: routeDate, routes: created };
  });
}

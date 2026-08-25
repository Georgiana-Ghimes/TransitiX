/**
 * One solve: load the day's work, measure it, ask VROOM, store a scenario.
 *
 * The three pure steps (collect → measure → solve) live in solver.js / matrixCache /
 * vroom.js. This file is the glue that talks to Postgres and decides what to load.
 */

import { MAX_MATRIX_POINTS, osrmConfigured } from '../geo/osrm.js';
import { cachedMatrix } from '../geo/matrixCache.js';
import { buildSolverInput, collectPoints, parseSolution } from './solver.js';
import { applyDrivingRules } from './drivingRules.js';
import { vroomConfigured, vroomSolve, vroomTimeLimitSec } from './vroom.js';
import {
  assignDrivers,
  defaultScenarioName,
  parseRouteDate,
  shapeKpis,
  shapeSolution,
} from './scenario.js';

const OPEN_ORDER_STATUSES = ['nou', 'planificat'];
const MAX_VEHICLES = 50;

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function asUuidList(value) {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  return value.map((id) => String(id)).filter(Boolean);
}

async function loadOrders(db, companyId, routeDate, orderIds) {
  const params = [companyId, routeDate];
  let filter = `o.company_id = $1 AND o.requested_date = $2::date
                AND o.status = ANY($3::text[])`;
  params.push(OPEN_ORDER_STATUSES);

  if (orderIds?.length) {
    params.push(orderIds);
    filter += ` AND o.id = ANY($${params.length}::uuid[])`;
  }

  const result = await db.query(
    `SELECT o.*,
            l.latitude, l.longitude, l.name AS location_name,
            l.address, l.city, l.county,
            COALESCE(o.window_start, l.window_start) AS window_start,
            COALESCE(o.window_end,   l.window_end)   AS window_end
     FROM orders o
     LEFT JOIN locations l ON l.id = o.location_id
     WHERE ${filter}
     ORDER BY o.order_number
     LIMIT ${MAX_MATRIX_POINTS}`,
    params
  );
  return result.rows;
}

async function loadVehicles(db, companyId, vehicleIds) {
  const params = [companyId];
  let filter = `v.company_id = $1 AND v.is_active = TRUE
                AND v.status IN ('available', 'in_trip')`;
  if (vehicleIds?.length) {
    params.push(vehicleIds);
    filter += ` AND v.id = ANY($${params.length}::uuid[])`;
  }

  const result = await db.query(
    `SELECT v.*,
            h.latitude AS home_latitude, h.longitude AS home_longitude,
            h.name AS home_name
     FROM vehicles v
     LEFT JOIN locations h ON h.id = v.home_location_id AND h.company_id = v.company_id
     WHERE ${filter}
     ORDER BY v.plate
     LIMIT ${MAX_VEHICLES}`,
    params
  );

  return result.rows.map((row) => ({
    ...row,
    home: row.home_location_id && row.home_latitude != null
      ? {
        id: row.home_location_id,
        latitude: Number(row.home_latitude),
        longitude: Number(row.home_longitude),
        name: row.home_name,
      }
      : null,
  }));
}

async function loadDrivers(db, companyId) {
  const result = await db.query(
    `SELECT * FROM drivers
     WHERE company_id = $1 AND is_active = TRUE
       AND status IN ('disponibil', 'in_cursa')
     ORDER BY name
     LIMIT ${MAX_VEHICLES}`,
    [companyId]
  );
  return result.rows;
}

async function loadPreferredPairs(db, companyId, routeDate) {
  const result = await db.query(
    `SELECT vehicle_id, driver_id FROM routes
     WHERE company_id = $1 AND route_date = $2::date
       AND vehicle_id IS NOT NULL AND driver_id IS NOT NULL
       AND status <> 'anulata'`,
    [companyId, routeDate]
  );
  return result.rows;
}

async function loadDepot(db, companyId, depotLocationId) {
  if (depotLocationId) {
    const result = await db.query(
      `SELECT * FROM locations
       WHERE company_id = $1 AND id = $2 AND is_active = TRUE`,
      [companyId, depotLocationId]
    );
    return result.rows[0] || null;
  }
  const result = await db.query(
    `SELECT * FROM locations
     WHERE company_id = $1 AND kind = 'depot' AND is_active = TRUE
       AND latitude IS NOT NULL AND longitude IS NOT NULL
     ORDER BY name
     LIMIT 1`,
    [companyId]
  );
  return result.rows[0] || null;
}

async function countScenarios(db, companyId, routeDate) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS n FROM route_scenarios
     WHERE company_id = $1 AND route_date = $2::date`,
    [companyId, routeDate]
  );
  return result.rows[0]?.n ?? 0;
}

async function markFailed(db, companyId, scenarioId, message) {
  await db.query(
    `UPDATE route_scenarios
     SET status = 'esuat', error_message = $1, updated_at = NOW()
     WHERE id = $2 AND company_id = $3`,
    [message, scenarioId, companyId]
  );
}

/**
 * Runs the optimizer for one calendar day and stores the result as a route_scenario.
 *
 * Failures after the draft row exists leave it with status `esuat`, so the dispatcher can
 * see what was tried. A 503 (solver / routing not configured) does not write — there was
 * nothing to try.
 */
export async function runSolve(db, {
  companyId,
  userId = null,
  routeDate,
  name = null,
  orderIds = null,
  vehicleIds = null,
  depotLocationId = null,
  timeLimitSec = null,
  matrix = cachedMatrix,
  solve = vroomSolve,
} = {}) {
  const date = parseRouteDate(routeDate);
  if (!date) throw httpError('Data rutei trebuie să fie YYYY-MM-DD', 400);

  if (!osrmConfigured()) {
    throw httpError(
      'OSRM nu este configurat. Setează OSRM_URL în server/.env înainte de a rula optimizatorul.',
      503
    );
  }
  if (!vroomConfigured()) {
    throw httpError(
      'Optimizatorul nu este configurat. Setează VROOM_URL în server/.env (vezi docker-compose.vroom.yml).',
      503
    );
  }

  const ids = {
    orders: asUuidList(orderIds),
    vehicles: asUuidList(vehicleIds),
  };

  const [orders, vehiclesRaw, drivers, preferred, depot, existingCount] = await Promise.all([
    loadOrders(db, companyId, date, ids.orders),
    loadVehicles(db, companyId, ids.vehicles),
    loadDrivers(db, companyId),
    loadPreferredPairs(db, companyId, date),
    loadDepot(db, companyId, depotLocationId),
    countScenarios(db, companyId, date),
  ]);

  if (!orders.length) {
    throw httpError('Nu există comenzi deschise pentru această dată', 422);
  }
  if (!vehiclesRaw.length) {
    throw httpError('Nu există vehicule active de planificat', 422);
  }

  const vehicles = assignDrivers(vehiclesRaw, drivers, preferred);
  const scenarioName = String(name || '').trim() || defaultScenarioName(date, existingCount);
  const limit = timeLimitSec != null && Number.isFinite(Number(timeLimitSec))
    ? Math.max(1, Math.trunc(Number(timeLimitSec)))
    : vroomTimeLimitSec();

  const params = {
    route_date: date,
    order_ids: orders.map((o) => o.id),
    vehicle_ids: vehicles.map((v) => v.id),
    depot_location_id: depot?.id ?? null,
    time_limit_sec: limit,
    order_count: orders.length,
    vehicle_count: vehicles.length,
  };

  const draft = await db.query(
    `INSERT INTO route_scenarios (company_id, route_date, name, params, status, created_by)
     VALUES ($1, $2::date, $3, $4::jsonb, 'draft', $5)
     RETURNING *`,
    [companyId, date, scenarioName, JSON.stringify(params), userId]
  );
  const scenarioId = draft.rows[0].id;

  const { points } = collectPoints({ orders, vehicles, depot });

  if (points.length < 2) {
    const message = 'Prea puține locații geocodate pentru a măsura o matrice';
    await markFailed(db, companyId, scenarioId, message);
    throw httpError(message, 422);
  }

  let measured;
  try {
    measured = await matrix(db, companyId, points);
  } catch (err) {
    const message = err.message || 'Măsurarea distanțelor a eșuat';
    await markFailed(db, companyId, scenarioId, message);
    throw err.status ? err : httpError(message, 502);
  }

  const { problem, index, dropped } = buildSolverInput({
    orders, vehicles, depot, matrix: measured,
  });
  problem.options = { ...(problem.options || {}), g: false, t: limit };

  if (!problem.jobs.length) {
    const message = 'Nicio comandă nu a putut fi planificată (lipsă coordonate sau drum)';
    const kpis = shapeKpis(
      { kpis: { objective: index.objective, routes: 0, unassigned: dropped.length } },
      { cache: measured.cache || null }
    );
    const result = await db.query(
      `UPDATE route_scenarios
       SET status = 'rulat', kpis = $1::jsonb, solution = $2::jsonb,
           error_message = $3, updated_at = NOW()
       WHERE id = $4 AND company_id = $5
       RETURNING *`,
      [
        JSON.stringify(kpis),
        JSON.stringify(shapeSolution({ routes: [], unassigned: dropped })),
        message,
        scenarioId,
        companyId,
      ]
    );
    return result.rows[0];
  }

  if (!problem.vehicles.length) {
    const message = 'Niciun vehicul nu are depozit de pornire';
    await markFailed(db, companyId, scenarioId, message);
    throw httpError(message, 422);
  }

  let response;
  try {
    response = await solve(problem, { timeoutMs: (limit + 30) * 1000 });
  } catch (err) {
    const message = err.message || 'Optimizatorul a eșuat';
    await markFailed(db, companyId, scenarioId, message);
    throw err.status ? err : httpError(message, 502);
  }

  const plan = applyDrivingRules(parseSolution(response, { index, dropped }), {
    windowsByOrderId: new Map(
      orders
        .filter((o) => o.window_start || o.window_end)
        .map((o) => [o.id, { window_start: o.window_start, window_end: o.window_end }])
    ),
  });
  const solution = shapeSolution(plan);
  const kpis = shapeKpis(plan, {
    cache: measured.cache || null,
    dropped: dropped.length,
  });

  const result = await db.query(
    `UPDATE route_scenarios
     SET status = 'rulat', kpis = $1::jsonb, solution = $2::jsonb,
         error_message = NULL, updated_at = NOW()
     WHERE id = $3 AND company_id = $4
     RETURNING *`,
    [JSON.stringify(kpis), JSON.stringify(solution), scenarioId, companyId]
  );
  return result.rows[0];
}

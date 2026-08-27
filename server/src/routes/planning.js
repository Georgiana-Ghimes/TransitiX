import { Router } from 'express';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { pool, query } from '../db.js';
import { serializeRow } from '../entities.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import { runSolve } from '../lib/planning/runSolve.js';
import { promoteScenario } from '../lib/planning/promote.js';
import { parseRouteDate } from '../lib/planning/scenario.js';
import { vroomConfigured, vroomPing } from '../lib/planning/vroom.js';
import { osrmConfigured, osrmPing } from '../lib/geo/osrm.js';
import { createLogger } from '../lib/log.js';

const log = createLogger({ scope: 'planning' });

const router = Router();
const solveHits = new Map();

router.use(authRequired, officeRequired);

function sendError(res, err, fallback) {
  const status = err.status || 500;
  if (status >= 500) log.error('eroare', err);
  res.status(status).json({ message: err.message || fallback });
}

function serializeScenario(row) {
  if (!row) return null;
  const out = serializeRow(row);
  // JSONB comes back as objects already; keep them as-is.
  return out;
}

/** Is the optimizer stack reachable? Same idea as /api/geo/health. */
router.get('/health', async (_req, res) => {
  const [routing, solver] = await Promise.all([osrmPing(), vroomPing()]);
  res.json({
    configured: osrmConfigured() && vroomConfigured(),
    ok: routing.ok && solver.ok,
    routing,
    solver,
  });
});

/**
 * Run the optimizer for a calendar day. Returns the stored scenario (status `rulat` or,
 * when every order was dropped before solving, `rulat` with an explanatory error_message).
 */
router.post('/solve', async (req, res) => {
  const limit = hitRateLimit(solveHits, req.user.company_id, { max: 10, windowMs: 60_000 });
  if (!limit.ok) {
    return res.status(429).json({ message: 'Prea multe optimizări. Reîncearcă într-un minut.' });
  }

  try {
    const body = req.body || {};
    const row = await runSolve(pool, {
      companyId: req.user.company_id,
      userId: req.user.id,
      routeDate: body.route_date || body.date,
      name: body.name,
      orderIds: body.order_ids,
      vehicleIds: body.vehicle_ids,
      depotLocationId: body.depot_location_id,
      timeLimitSec: body.time_limit_sec,
    });
    res.status(201).json(serializeScenario(row));
  } catch (err) {
    sendError(res, err, 'Optimizarea a eșuat');
  }
});

/** Scenarios for one day, newest first. Omits the heavy `solution` blob unless asked. */
router.get('/scenarios', async (req, res) => {
  try {
    const date = parseRouteDate(req.query.date || req.query.route_date);
    if (!date) {
      return res.status(400).json({ message: 'Parametrul date trebuie să fie YYYY-MM-DD' });
    }
    const withSolution = String(req.query.include || '') === 'solution';
    const cols = withSolution
      ? '*'
      : `id, company_id, route_date, name, params, kpis, status, error_message,
         is_committed, created_by, created_at, updated_at`;
    const result = await query(
      `SELECT ${cols} FROM route_scenarios
       WHERE company_id = $1 AND route_date = $2::date
       ORDER BY created_at DESC`,
      [req.user.company_id, date]
    );
    res.json(result.rows.map(serializeScenario));
  } catch (err) {
    sendError(res, err, 'Listarea scenariilor a eșuat');
  }
});

router.get('/scenarios/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM route_scenarios WHERE company_id = $1 AND id = $2`,
      [req.user.company_id, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Scenariul nu a fost găsit' });
    res.json(serializeScenario(result.rows[0]));
  } catch (err) {
    sendError(res, err, 'Citirea scenariului a eșuat');
  }
});

/**
 * Replace the day's draft / planned routes with this scenario's solution.
 * Live routes (lansată / în execuție / finalizată) block the promotion.
 */
router.post('/scenarios/:id/promote', async (req, res) => {
  try {
    const result = await promoteScenario(pool, {
      companyId: req.user.company_id,
      scenarioId: req.params.id,
    });
    const scenario = await query(
      `SELECT * FROM route_scenarios WHERE company_id = $1 AND id = $2`,
      [req.user.company_id, req.params.id]
    );
    res.json({
      ...result,
      routes: result.routes.map(serializeRow),
      scenario: serializeScenario(scenario.rows[0]),
    });
  } catch (err) {
    sendError(res, err, 'Promovarea scenariului a eșuat');
  }
});

router.delete('/scenarios/:id', async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM route_scenarios
       WHERE company_id = $1 AND id = $2 AND is_committed = FALSE
       RETURNING id`,
      [req.user.company_id, req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({
        message: 'Scenariul nu a fost găsit sau este deja promovat în plan',
      });
    }
    res.status(204).end();
  } catch (err) {
    sendError(res, err, 'Ștergerea scenariului a eșuat');
  }
});

export default router;

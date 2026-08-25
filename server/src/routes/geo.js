import { Router } from 'express';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import { pool, query } from '../db.js';
import {
  MAX_MATRIX_POINTS,
  MAX_ROUTE_POINTS,
  osrmNearest,
  osrmPing,
  osrmRoute,
  osrmTable,
} from '../lib/geo/osrm.js';
import { applyToLocation, geocodeAddress } from '../lib/geo/geocode.js';
import { photonPing } from '../lib/geo/photon.js';
import {
  DISTANCE_REASON_LABELS,
  computeTripDistance,
  refreshTripDistance,
} from '../lib/geo/tripDistance.js';

const router = Router();
const geoHits = new Map();

router.use(authRequired, officeRequired);

/** Matrix calls are the expensive ones; one window covers every geo endpoint per company. */
router.use((req, res, next) => {
  const limit = hitRateLimit(geoHits, req.user.company_id, { max: 120, windowMs: 60_000 });
  if (!limit.ok) {
    return res.status(429).json({ message: 'Prea multe cereri de rutare. Reîncearcă într-un minut.' });
  }
  next();
});

function sendError(res, err, fallback) {
  const status = err?.status || 500;
  if (status >= 500 && status !== 503) console.error('[geo]', err);
  res.status(status).json({ message: err?.message || fallback });
}

router.get('/health', async (_req, res) => {
  const [routing, geocoding] = await Promise.all([osrmPing(), photonPing()]);
  res.json({
    ...routing,
    geocoding,
    max_route_points: MAX_ROUTE_POINTS,
    max_matrix_points: MAX_MATRIX_POINTS,
  });
});

/** Ranked candidates for one address — what the map review screen shows the dispatcher. */
router.post('/geocode', async (req, res) => {
  try {
    const { address, refresh } = req.body || {};
    if (!address || !String(address).trim()) {
      return res.status(400).json({ message: 'Adresa este obligatorie' });
    }
    const result = await geocodeAddress(pool, req.user.company_id, String(address), {
      refresh: Boolean(refresh),
    });
    res.json(result);
  } catch (err) {
    sendError(res, err, 'Geocodarea a eșuat');
  }
});

/**
 * Geocodes one stored location and saves the pin when the result is usable.
 * `geocode_verified` is deliberately untouched — only a person confirming on the map sets it,
 * which is what `PUT /api/entities/Location/:id` is for.
 */
router.post('/locations/:id/geocode', async (req, res) => {
  try {
    const found = await query(
      `SELECT id, address, city, county FROM locations WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    const location = found.rows[0];
    if (!location) return res.status(404).json({ message: 'Locație inexistentă' });

    const full = [location.address, location.city, location.county].filter(Boolean).join(', ');
    const result = await geocodeAddress(pool, req.user.company_id, full, {
      refresh: Boolean(req.body?.refresh),
    });
    const saved = await applyToLocation(pool, req.user.company_id, location.id, result);
    res.json({ ...result, saved, query: full });
  } catch (err) {
    sendError(res, err, 'Geocodarea locației a eșuat');
  }
});

/**
 * Recomputes one trip's distance on demand. `force` overrides a manual value — the only way
 * to hand a hand-typed distance back to the geocoder without clearing the field first.
 */
router.post('/trips/:id/distance', async (req, res) => {
  try {
    const found = await query(
      `SELECT * FROM trips WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    const trip = found.rows[0];
    if (!trip) return res.status(404).json({ message: 'Cursă inexistentă' });

    if (req.body?.force) {
      const computed = await computeTripDistance(pool, req.user.company_id, trip);
      if (!computed.ok) {
        return res.json({ ...computed, message: DISTANCE_REASON_LABELS[computed.reason] || null });
      }
      await query(
        `UPDATE trips SET distance_km = $1, distance_source = 'osrm', updated_at = NOW()
         WHERE id = $2 AND company_id = $3`,
        [computed.distance_km, trip.id, req.user.company_id]
      );
      return res.json({ ...computed, saved: true });
    }

    const result = await refreshTripDistance(pool, req.user.company_id, trip);
    res.json({ ...result, message: result.ok ? null : (DISTANCE_REASON_LABELS[result.reason] || null) });
  } catch (err) {
    sendError(res, err, 'Recalculul distanței a eșuat');
  }
});

router.post('/route', async (req, res) => {
  try {
    const { points, overview } = req.body || {};
    res.json(await osrmRoute(points, overview ? { overview } : {}));
  } catch (err) {
    sendError(res, err, 'Calculul rutei a eșuat');
  }
});

router.post('/matrix', async (req, res) => {
  try {
    const { points, sources, destinations } = req.body || {};
    res.json(await osrmTable(points, { sources, destinations }));
  } catch (err) {
    sendError(res, err, 'Calculul matricei a eșuat');
  }
});

/** Snaps a point to the road network — how we tell a good geocode from one in a field. */
router.post('/nearest', async (req, res) => {
  try {
    const { point, number } = req.body || {};
    res.json(await osrmNearest(point, { number }));
  } catch (err) {
    sendError(res, err, 'Interogarea nearest a eșuat');
  }
});

export default router;

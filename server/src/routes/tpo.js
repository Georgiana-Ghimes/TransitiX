import { Router } from 'express';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { pool, query, withTransaction } from '../db.js';
import { serializeRow } from '../entities.js';
import { osrmConfigured, osrmRoute } from '../lib/geo/osrm.js';
import { addressKey } from '../lib/geo/address.js';
import { buildLegs, describeLeg, measureLegs, summariseLegs } from '../lib/pricing/tripKm.js';
import { calculateTpo, summariseCharges } from '../lib/pricing/tpo.js';

const router = Router();
router.use(authRequired, officeRequired);

function sendError(res, err, fallback) {
  const status = err?.status || 500;
  if (status >= 500) console.error('[tpo]', err);
  res.status(status).json({ message: err?.message || fallback });
}

/** Resolves a free-text address to a geocoded location we already know about. */
async function placeForAddress(companyId, address, label) {
  const key = addressKey(address);
  if (!key) return { label, latitude: null, longitude: null };
  const found = await query(
    `SELECT id, name, city, county, postcode, latitude, longitude
     FROM locations
     WHERE company_id = $1 AND address_key = $2
     LIMIT 1`,
    [companyId, key]
  );
  const row = found.rows[0];
  if (!row) return { label, latitude: null, longitude: null };
  return {
    label: label ?? row.name,
    locationId: row.id,
    city: row.city,
    county: row.county,
    postcode: row.postcode,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
  };
}

/**
 * The depot the trip starts and ends at: the one set on the trip, else the company default.
 * Without it the round trip cannot be measured, and the brief is explicit that it must be.
 */
async function resolveDepot(companyId, trip) {
  const id = trip.depot_location_id
    ?? (await query('SELECT default_depot_location_id FROM companies WHERE id = $1', [companyId]))
      .rows[0]?.default_depot_location_id;
  if (!id) return null;
  const found = await query(
    `SELECT id, name, city, county, latitude, longitude FROM locations WHERE id = $1 AND company_id = $2`,
    [id, companyId]
  );
  const row = found.rows[0];
  if (!row) return null;
  return {
    label: row.name ?? 'Garaj',
    locationId: row.id,
    city: row.city,
    county: row.county,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
  };
}

/**
 * Unloading points for a trip. A trip attached to a route uses the route's stops — several
 * drops on one trip is still ONE trip — otherwise it falls back to the consignee address.
 */
async function resolveUnloadings(companyId, trip) {
  if (trip.route_id) {
    const stops = await query(
      `SELECT s.seq, l.id, l.name, l.city, l.county, l.postcode, l.latitude, l.longitude
       FROM route_stops s
       JOIN locations l ON l.id = s.location_id
       WHERE s.company_id = $1 AND s.route_id = $2 AND s.kind = 'livrare'
       ORDER BY s.seq`,
      [companyId, trip.route_id]
    );
    if (stops.rowCount) {
      return stops.rows.map((row) => ({
        label: row.name,
        locationId: row.id,
        city: row.city,
        county: row.county,
        postcode: row.postcode,
        latitude: row.latitude == null ? null : Number(row.latitude),
        longitude: row.longitude == null ? null : Number(row.longitude),
      }));
    }
  }
  const single = await placeForAddress(companyId, trip.consignee_address, trip.consignee_name);
  return single ? [single] : [];
}

async function loadPricingContext(companyId, trip) {
  const [vehicleRes, tariffRes, zoneRes, zoneRateRes, surchargeRes, surchargeRateRes] = await Promise.all([
    trip.vehicle_id
      ? query('SELECT * FROM vehicles WHERE id = $1 AND company_id = $2', [trip.vehicle_id, companyId])
      : Promise.resolve({ rows: [] }),
    trip.contract_id
      ? query('SELECT * FROM contract_tariffs WHERE company_id = $1 AND contract_id = $2', [companyId, trip.contract_id])
      : Promise.resolve({ rows: [] }),
    query('SELECT * FROM tax_zones WHERE company_id = $1 AND is_active = TRUE', [companyId]),
    query('SELECT * FROM tax_zone_rates WHERE company_id = $1', [companyId]),
    query('SELECT * FROM surcharge_types WHERE company_id = $1 AND is_active = TRUE', [companyId]),
    query('SELECT * FROM surcharge_rates WHERE company_id = $1', [companyId]),
  ]);

  const zoneRates = new Map();
  for (const rate of zoneRateRes.rows) {
    if (!zoneRates.has(rate.tax_zone_id)) zoneRates.set(rate.tax_zone_id, []);
    zoneRates.get(rate.tax_zone_id).push(rate);
  }

  const ratesByType = new Map();
  for (const rate of surchargeRateRes.rows) {
    if (!ratesByType.has(rate.surcharge_type_id)) ratesByType.set(rate.surcharge_type_id, []);
    ratesByType.get(rate.surcharge_type_id).push(rate);
  }

  return {
    vehicle: vehicleRes.rows[0] ?? {},
    tariffs: tariffRes.rows,
    zones: zoneRes.rows,
    zoneRates,
    surchargeTypes: surchargeRes.rows,
    ratesByType,
  };
}

/**
 * Recomputes kilometres and TPO for one trip.
 *
 * `persist` writes the legs and charge lines; without it the endpoint is a dry run, which is
 * what the trip screen uses to preview a price before anyone commits to it.
 */
async function computeForTrip(companyId, trip, { persist = false } = {}) {
  const [depot, loading, unloadings] = await Promise.all([
    resolveDepot(companyId, trip),
    placeForAddress(companyId, trip.shipper_address, trip.shipper_name),
    resolveUnloadings(companyId, trip),
  ]);

  const legs = buildLegs(depot, loading, unloadings);
  const measured = osrmConfigured()
    ? await measureLegs(legs, { route: osrmRoute })
    : legs.map((leg) => ({ ...leg, distance_km: null, duration_min: null, source: 'estimate', reason: 'osrm_neconfigurat' }));
  const kmSummary = summariseLegs(measured);

  const ctx = await loadPricingContext(companyId, trip);

  // Only surcharges the trip actually asks for. The crane flag is the one the brief names.
  const surcharges = [];
  if (trip.crane_unload) {
    const craneType = ctx.surchargeTypes.find((t) => String(t.code).toUpperCase() === 'DM');
    if (craneType) {
      surcharges.push({ type: craneType, rates: ctx.ratesByType.get(craneType.id) ?? [], quantity: 1 });
    }
  }

  const places = [loading, ...unloadings].filter(Boolean);

  const result = calculateTpo({
    trip,
    vehicle: ctx.vehicle,
    tariffs: ctx.tariffs,
    kmSummary,
    zones: ctx.zones,
    zoneRates: ctx.zoneRates,
    places,
    surcharges,
  });

  if (!depot) {
    result.warnings.push({
      code: 'fara_garaj',
      message: 'Nu există garaj configurat — kilometrii dus-întors la bază nu pot fi calculați',
    });
  }

  if (persist) {
    await withTransaction(async (client) => {
      await client.query('DELETE FROM trip_legs WHERE trip_id = $1 AND company_id = $2', [trip.id, companyId]);
      for (const leg of measured) {
        await client.query(
          `INSERT INTO trip_legs (company_id, trip_id, seq, kind, from_label, to_label,
             from_location_id, to_location_id, distance_km, duration_min, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [companyId, trip.id, leg.seq, leg.kind, leg.from_label, leg.to_label,
           leg.from_location_id, leg.to_location_id, leg.distance_km, leg.duration_min, leg.source]
        );
      }

      // Manual lines are the operator's, not ours — only the auto ones are replaced.
      await client.query(
        `DELETE FROM trip_charges WHERE trip_id = $1 AND company_id = $2 AND source = 'auto'`,
        [trip.id, companyId]
      );
      for (const line of result.lines) {
        if (line.source !== 'auto') continue;
        await client.query(
          `INSERT INTO trip_charges (company_id, trip_id, kind, code, label, quantity,
             unit_amount, amount, currency, source, detail)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [companyId, trip.id, line.kind, line.code, line.label, line.quantity,
           line.unit_amount, line.amount, line.currency, line.source, JSON.stringify(line.detail ?? null)]
        );
      }

      await client.query(
        `UPDATE trips SET tpo_total = $1, tpo_currency = $2, tpo_calculated_at = NOW(),
           distance_km = COALESCE($3, distance_km), updated_at = NOW()
         WHERE id = $4 AND company_id = $5`,
        [result.total, result.currency, kmSummary.complete ? Math.round(kmSummary.distance_km) : null,
         trip.id, companyId]
      );
    });
  }

  return {
    trip_id: trip.id,
    cmr_number: trip.cmr_number,
    tpo_number: trip.tpo_number,
    legs: measured.map(describeLeg),
    kilometres: kmSummary,
    charges: result.lines,
    totals: summariseCharges(result.lines),
    total: result.total,
    currency: result.currency,
    warnings: result.warnings,
    basis: result.basis,
    persisted: persist,
  };
}

async function fetchTrip(companyId, tripId) {
  const found = await query('SELECT * FROM trips WHERE id = $1 AND company_id = $2', [tripId, companyId]);
  return found.rows[0] ? serializeRow(found.rows[0]) : null;
}

/** Preview or commit the TPO for one trip. */
router.post('/trips/:id/calculate', async (req, res) => {
  try {
    const trip = await fetchTrip(req.user.company_id, req.params.id);
    if (!trip) return res.status(404).json({ message: 'Cursă inexistentă' });
    res.json(await computeForTrip(req.user.company_id, trip, { persist: Boolean(req.body?.persist) }));
  } catch (err) {
    sendError(res, err, 'Calculul TPO a eșuat');
  }
});

/**
 * Everything filed under one TPO number.
 *
 * One TPO commonly covers several trips — the goods did not fit in one truck, or the site
 * could not take a big one. Two unloading points on one trip is NOT two trips.
 */
router.get('/:tpoNumber', async (req, res) => {
  try {
    const trips = await query(
      `SELECT t.*, v.plate, v.vehicle_class, v.mma_kg
       FROM trips t
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.company_id = $1 AND t.tpo_number = $2
       ORDER BY t.loading_date, t.cmr_number`,
      [req.user.company_id, req.params.tpoNumber]
    );
    if (!trips.rowCount) return res.status(404).json({ message: 'TPO inexistent' });

    const charges = await query(
      `SELECT * FROM trip_charges
       WHERE company_id = $1 AND trip_id = ANY($2::uuid[])
       ORDER BY trip_id, kind`,
      [req.user.company_id, trips.rows.map((t) => t.id)]
    );

    const byTrip = new Map();
    for (const charge of charges.rows) {
      if (!byTrip.has(charge.trip_id)) byTrip.set(charge.trip_id, []);
      byTrip.get(charge.trip_id).push(serializeRow(charge));
    }

    const rows = trips.rows.map((trip) => ({
      ...serializeRow(trip),
      charges: byTrip.get(trip.id) ?? [],
    }));

    const total = rows.reduce((sum, t) => sum + Number(t.tpo_total ?? 0), 0);

    res.json({
      tpo_number: req.params.tpoNumber,
      trip_count: rows.length,
      trips: rows,
      total: Math.round(total * 100) / 100,
      currency: rows[0]?.tpo_currency ?? 'RON',
    });
  } catch (err) {
    sendError(res, err, 'Nu am putut încărca TPO-ul');
  }
});

/** Recalculates every trip on a TPO in one go. */
router.post('/:tpoNumber/recalculate', async (req, res) => {
  try {
    const trips = await query(
      'SELECT * FROM trips WHERE company_id = $1 AND tpo_number = $2',
      [req.user.company_id, req.params.tpoNumber]
    );
    if (!trips.rowCount) return res.status(404).json({ message: 'TPO inexistent' });

    const results = [];
    for (const row of trips.rows) {
      results.push(await computeForTrip(req.user.company_id, serializeRow(row), { persist: true }));
    }
    res.json({
      tpo_number: req.params.tpoNumber,
      results,
      total: Math.round(results.reduce((sum, r) => sum + r.total, 0) * 100) / 100,
    });
  } catch (err) {
    sendError(res, err, 'Recalculul TPO a eșuat');
  }
});

export { computeForTrip };
export default router;

/**
 * Telematics helpers — keys, sample validation, and the write that keeps gps_logs in sync.
 *
 * gps_logs is deliberately not deleted: the map page already filters on is_current. Every
 * real position lands in telematics_positions (history) and is projected onto one current
 * gps_logs row per vehicle (last known).
 */

import crypto from 'crypto';
import { withTransaction } from '../../db.js';
import { createLogger } from '../log.js';

const log = createLogger({ scope: 'telematics/ingest' });

export const TELEMATICS_SOURCES = [
  'driver_app', 'simulate', 'webfleet', 'frotcom', 'teltonika', 'webhook', 'other',
];

/** Prefix makes accidental pastes of JWT / DB URLs fail the lookup instead of matching. */
export function generateTelematicsKey() {
  return `tx_${crypto.randomBytes(24).toString('hex')}`;
}

export function hashTelematicsKey(key) {
  return crypto.createHash('sha256').update(String(key || ''), 'utf8').digest('hex');
}

export function looksLikeTelematicsKey(key) {
  return /^tx_[a-f0-9]{48}$/i.test(String(key || '').trim());
}

/**
 * Normalize one position sample from any source into the shape ingest writes.
 * Returns { ok: false, error } or { ok: true, sample }.
 */
export function normalizePositionSample(raw = {}, { defaultSource = 'webhook' } = {}) {
  const latitude = Number(raw.latitude ?? raw.lat);
  const longitude = Number(raw.longitude ?? raw.lon ?? raw.lng);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { ok: false, error: 'latitude invalidă' };
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { ok: false, error: 'longitude invalidă' };
  }

  const vehicleId = raw.vehicle_id || raw.vehicleId || null;
  const plate = raw.vehicle_plate || raw.plate || null;
  if (!vehicleId && !plate) {
    return { ok: false, error: 'vehicle_id sau vehicle_plate este obligatoriu' };
  }

  let recordedAt;
  if (raw.recorded_at || raw.timestamp || raw.ts) {
    recordedAt = new Date(raw.recorded_at || raw.timestamp || raw.ts);
  } else {
    recordedAt = new Date();
  }
  if (!Number.isFinite(recordedAt.getTime())) {
    return { ok: false, error: 'recorded_at invalid' };
  }
  // Reject samples more than a day in the future — clock skew, not prophecy.
  if (recordedAt.getTime() - Date.now() > 24 * 3600 * 1000) {
    return { ok: false, error: 'recorded_at este în viitor' };
  }

  const source = TELEMATICS_SOURCES.includes(raw.source) ? raw.source : defaultSource;
  const speed = raw.speed == null || raw.speed === '' ? null : Number(raw.speed);
  const heading = raw.heading == null || raw.heading === '' ? null : Number(raw.heading);
  const accuracy = raw.accuracy_m == null && raw.accuracy == null
    ? null
    : Number(raw.accuracy_m ?? raw.accuracy);

  return {
    ok: true,
    sample: {
      vehicle_id: vehicleId,
      vehicle_plate: plate ? String(plate).trim() : null,
      route_id: raw.route_id || null,
      trip_id: raw.trip_id || null,
      latitude,
      longitude,
      speed: Number.isFinite(speed) ? speed : null,
      heading: Number.isFinite(heading) ? heading : null,
      ignition: raw.ignition == null ? null : Boolean(raw.ignition),
      accuracy_m: Number.isFinite(accuracy) ? accuracy : null,
      recorded_at: recordedAt,
      source,
      payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : null,
    },
  };
}

async function resolveVehicle(client, companyId, sample) {
  if (sample.vehicle_id) {
    const result = await client.query(
      `SELECT id, plate FROM vehicles WHERE company_id = $1 AND id = $2`,
      [companyId, sample.vehicle_id]
    );
    return result.rows[0] || null;
  }
  const result = await client.query(
    `SELECT id, plate FROM vehicles
     WHERE company_id = $1 AND UPPER(REPLACE(plate, ' ', '')) = UPPER(REPLACE($2, ' ', ''))
     LIMIT 1`,
    [companyId, sample.vehicle_plate]
  );
  return result.rows[0] || null;
}

/**
 * Write one sample into history and project it onto gps_logs.is_current.
 * Returns the telematics row, or null when the vehicle cannot be resolved.
 */
export async function ingestPosition(db, companyId, rawSample, {
  defaultSource = 'webhook',
  transaction = withTransaction,
  skipEvaluate = false,
} = {}) {
  const normalized = normalizePositionSample(rawSample, { defaultSource });
  if (!normalized.ok) {
    const err = new Error(normalized.error);
    err.status = 400;
    throw err;
  }
  const sample = normalized.sample;

  const row = await transaction(async (client) => {
    const vehicle = await resolveVehicle(client, companyId, sample);
    if (!vehicle) return null;

    const inserted = await client.query(
      `INSERT INTO telematics_positions (
         company_id, vehicle_id, route_id, trip_id,
         latitude, longitude, speed, heading, ignition, accuracy_m,
         recorded_at, source, payload
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
       ) RETURNING *`,
      [
        companyId, vehicle.id, sample.route_id, sample.trip_id,
        sample.latitude, sample.longitude, sample.speed, sample.heading,
        sample.ignition, sample.accuracy_m, sample.recorded_at, sample.source,
        sample.payload ? JSON.stringify(sample.payload) : null,
      ]
    );

    // Projection: one current gps_logs row per vehicle. Clear then insert, matching the
    // entity guard and the simulate endpoint.
    await client.query(
      `UPDATE gps_logs SET is_current = FALSE, updated_at = NOW()
       WHERE company_id = $1 AND vehicle_id = $2 AND is_current = TRUE`,
      [companyId, vehicle.id]
    );
    await client.query(
      `INSERT INTO gps_logs (
         company_id, vehicle_id, vehicle_plate, trip_id,
         latitude, longitude, speed, heading, ignition, is_current
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, TRUE), TRUE)`,
      [
        companyId, vehicle.id, vehicle.plate, sample.trip_id,
        sample.latitude, sample.longitude, sample.speed, sample.heading, sample.ignition,
      ]
    );

    return inserted.rows[0];
  });

  if (row && !skipEvaluate) {
    try {
      const { evaluatePosition } = await import('./evaluate.js');
      const evalResult = await evaluatePosition(db, companyId, row);
      try {
        const { publish } = await import('./liveHub.js');
        publish(companyId, 'position', {
          id: row.id,
          vehicle_id: row.vehicle_id,
          route_id: row.route_id,
          latitude: row.latitude,
          longitude: row.longitude,
          speed: row.speed,
          heading: row.heading,
          ignition: row.ignition,
          source: row.source,
          recorded_at: row.recorded_at,
        });
        for (const ex of evalResult?.exceptions || []) {
          publish(companyId, 'exception', ex);
        }
        if (evalResult?.cascaded?.shifted) {
          publish(companyId, 'eta', {
            route_id: row.route_id,
            shifted: evalResult.cascaded.shifted,
          });
        }
      } catch {
        // Live board is optional — never fail ingest on a hung subscriber.
      }
    } catch (err) {
      log.error('telematics evaluate', err.message);
    }
  }
  return row;
}

/** Batch ingest — continues past unresolved vehicles, reports counts. */
export async function ingestPositions(db, companyId, samples, opts = {}) {
  const list = Array.isArray(samples) ? samples : [];
  const accepted = [];
  const rejected = [];
  for (let i = 0; i < list.length; i += 1) {
    try {
      const row = await ingestPosition(db, companyId, list[i], opts);
      if (!row) rejected.push({ index: i, error: 'vehicul necunoscut' });
      else accepted.push(row);
    } catch (err) {
      rejected.push({ index: i, error: err.message || 'eșuat' });
    }
  }
  return { accepted, rejected };
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateTelematicsKey,
  hashTelematicsKey,
  ingestPosition,
  looksLikeTelematicsKey,
  normalizePositionSample,
} from './ingest.js';

describe('telematics keys', () => {
  it('generates a recognizable key and hashes it stably', () => {
    const key = generateTelematicsKey();
    expect(looksLikeTelematicsKey(key)).toBe(true);
    expect(hashTelematicsKey(key)).toBe(hashTelematicsKey(key));
    expect(hashTelematicsKey(key)).not.toBe(key);
    expect(looksLikeTelematicsKey('Bearer abc')).toBe(false);
  });
});

describe('normalizePositionSample', () => {
  it('accepts lat/lon aliases and fills recorded_at', () => {
    const { ok, sample } = normalizePositionSample({
      lat: 44.4, lon: 26.1, plate: 'B 01 AAA', speed: '72',
    });
    expect(ok).toBe(true);
    expect(sample.latitude).toBe(44.4);
    expect(sample.longitude).toBe(26.1);
    expect(sample.vehicle_plate).toBe('B 01 AAA');
    expect(sample.speed).toBe(72);
    expect(sample.recorded_at).toBeInstanceOf(Date);
  });

  it('rejects a missing vehicle and out-of-range coordinates', () => {
    expect(normalizePositionSample({ latitude: 44, longitude: 26 }).ok).toBe(false);
    expect(normalizePositionSample({ latitude: 200, longitude: 26, vehicle_id: 'v1' }).ok).toBe(false);
  });

  it('rejects a timestamp a week in the future', () => {
    const future = new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString();
    expect(normalizePositionSample({
      vehicle_id: 'v1', latitude: 44, longitude: 26, recorded_at: future,
    }).ok).toBe(false);
  });
});

describe('ingestPosition', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes history and projects onto gps_logs.is_current', async () => {
    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('FROM vehicles')) {
          return { rows: [{ id: 'v1', plate: 'B 01 AAA' }] };
        }
        if (sql.includes('INSERT INTO telematics_positions')) {
          return {
            rows: [{
              id: 'tp1', company_id: 'co', vehicle_id: 'v1',
              latitude: params[4], longitude: params[5], source: params[11],
            }],
          };
        }
        return { rows: [] };
      },
    };
    const transaction = async (fn) => fn(client);

    const row = await ingestPosition(
      {},
      'co',
      { vehicle_id: 'v1', latitude: 44.5, longitude: 26.2, speed: 50 },
      { defaultSource: 'driver_app', transaction, skipEvaluate: true }
    );

    expect(row.vehicle_id).toBe('v1');
    expect(calls.some((c) => c.sql.includes('INSERT INTO telematics_positions'))).toBe(true);
    expect(calls.some((c) => c.sql.includes('UPDATE gps_logs') && c.sql.includes('is_current = FALSE'))).toBe(true);
    expect(calls.some((c) => c.sql.includes('INSERT INTO gps_logs'))).toBe(true);
  });

  it('returns null when the plate is unknown rather than inventing a vehicle', async () => {
    const client = {
      query: async (sql) => {
        if (sql.includes('FROM vehicles')) return { rows: [] };
        return { rows: [] };
      },
    };
    const row = await ingestPosition(
      {},
      'co',
      { plate: 'NECUNOSCUT', latitude: 44.5, longitude: 26.2 },
      { transaction: async (fn) => fn(client), skipEvaluate: true }
    );
    expect(row).toBeNull();
  });
});

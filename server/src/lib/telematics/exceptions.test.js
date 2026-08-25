import { describe, expect, it } from 'vitest';
import {
  cascadeEta,
  detectExceptions,
  haversineM,
  nextOpenStop,
  updateIdleSince,
} from './exceptions.js';

const DEPOT = { latitude: 44.4, longitude: 26.1 };
const STOP_A = { latitude: 44.41, longitude: 26.12 };
const FAR = { latitude: 45.0, longitude: 26.5 };

describe('haversineM', () => {
  it('is ~0 for the same point and kilometres for Bucharest→far', () => {
    expect(haversineM(DEPOT, DEPOT)).toBeLessThan(1);
    expect(haversineM(DEPOT, FAR)).toBeGreaterThan(50_000);
  });
});

describe('nextOpenStop', () => {
  it('skips closed stops and breaks', () => {
    const next = nextOpenStop([
      { seq: 1, kind: 'depot_start', status: 'finalizat' },
      { seq: 2, kind: 'pauza', status: 'planificat' },
      { seq: 3, kind: 'livrare', status: 'planificat', id: 's3' },
    ]);
    expect(next.id).toBe('s3');
  });
});

describe('detectExceptions', () => {
  const route = { id: 'r1', vehicle_id: 'v1', code: 'R-1' };
  const stops = [
    {
      id: 's1', seq: 2, kind: 'livrare', status: 'planificat',
      ...STOP_A,
      planned_arrival: new Date(Date.now() - 40 * 60_000).toISOString(),
      window_start: '08:00',
    },
  ];

  it('flags a late open stop', () => {
    const found = detectExceptions({
      position: { ...FAR, vehicle_id: 'v1', speed: 40 },
      route,
      stops,
      now: new Date(),
    });
    expect(found.some((e) => e.type === 'intarziere')).toBe(true);
    expect(found.find((e) => e.type === 'intarziere').payload.by_min).toBeGreaterThanOrEqual(15);
  });

  it('flags excessive speed', () => {
    const found = detectExceptions({
      position: { ...STOP_A, vehicle_id: 'v1', speed: 110 },
      route,
      stops: [{ ...stops[0], planned_arrival: new Date(Date.now() + 60_000).toISOString() }],
    });
    expect(found.some((e) => e.type === 'viteza')).toBe(true);
  });

  it('flags off-route when far from every stop', () => {
    const found = detectExceptions({
      position: { ...FAR, vehicle_id: 'v1', speed: 40 },
      route,
      stops: [{ ...stops[0], planned_arrival: new Date(Date.now() + 3_600_000).toISOString() }],
    });
    expect(found.some((e) => e.type === 'abatere_traseu')).toBe(true);
  });

  it('flags unplanned stop after prolonged idle away from plan', () => {
    const found = detectExceptions({
      position: { ...FAR, vehicle_id: 'v1', speed: 0 },
      route,
      stops: [{ ...stops[0], planned_arrival: new Date(Date.now() + 3_600_000).toISOString() }],
      idleSinceMs: Date.now() - 25 * 60_000,
      now: new Date(),
    });
    expect(found.some((e) => e.type === 'oprire_neplanificata' || e.type === 'stationare')).toBe(true);
  });

  it('does not flag late when the truck is already at the stop', () => {
    const found = detectExceptions({
      position: { ...STOP_A, vehicle_id: 'v1', speed: 0 },
      route,
      stops,
      now: new Date(),
    });
    expect(found.some((e) => e.type === 'intarziere')).toBe(false);
  });
});

describe('cascadeEta', () => {
  it('shifts only open stops from the given seq onward', () => {
    const base = Date.parse('2026-08-25T10:00:00');
    const stops = [
      { seq: 1, status: 'finalizat', planned_arrival: new Date(base).toISOString() },
      { seq: 2, status: 'planificat', planned_arrival: new Date(base + 3600_000).toISOString(), planned_departure: new Date(base + 4500_000).toISOString() },
      { seq: 3, status: 'planificat', planned_arrival: new Date(base + 7200_000).toISOString() },
    ];
    const { stops: next, shifted } = cascadeEta(stops, { fromSeq: 2, delayMin: 20 });
    expect(shifted).toBe(2);
    expect(Date.parse(next[0].planned_arrival)).toBe(base);
    expect(Date.parse(next[1].planned_arrival) - Date.parse(stops[1].planned_arrival)).toBe(20 * 60_000);
    expect(next[1].eta_delay_min).toBe(20);
  });
});

describe('updateIdleSince', () => {
  it('starts and clears the idle clock', () => {
    const now = Date.now();
    const started = updateIdleSince({
      position: { ...FAR, speed: 0 },
      stops: [{ ...STOP_A }],
      idleSinceMs: null,
      now,
    });
    expect(started).toBe(now);

    const cleared = updateIdleSince({
      position: { ...STOP_A, speed: 30 },
      stops: [{ ...STOP_A }],
      idleSinceMs: started,
      now: now + 60_000,
    });
    expect(cleared).toBeNull();
  });
});

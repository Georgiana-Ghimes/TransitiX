import { describe, expect, it } from 'vitest';
import {
  assignDrivers,
  defaultScenarioName,
  parseRouteDate,
  shapeKpis,
  shapeSolution,
} from './scenario.js';

describe('parseRouteDate', () => {
  it('accepts a real calendar day', () => {
    expect(parseRouteDate('2026-08-25')).toBe('2026-08-25');
  });

  it('accepts a Date from node-pg without turning it into a weekday name', () => {
    expect(parseRouteDate(new Date(Date.UTC(2026, 7, 25)))).toBe('2026-08-25');
  });

  it('rejects junk and impossible dates', () => {
    expect(parseRouteDate('25.08.2026')).toBeNull();
    expect(parseRouteDate('2026-02-30')).toBeNull();
    expect(parseRouteDate('')).toBeNull();
  });
});

describe('defaultScenarioName', () => {
  it('numbers from how many already exist that day', () => {
    expect(defaultScenarioName('2026-08-25', 0)).toBe('Scenariu 1 · 2026-08-25');
    expect(defaultScenarioName('2026-08-25', 2)).toBe('Scenariu 3 · 2026-08-25');
  });
});

describe('assignDrivers', () => {
  const vehicles = [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }];
  const drivers = [
    { id: 'd1', name: 'Ana', shift_start: '07:00' },
    { id: 'd2', name: 'Bogdan' },
  ];

  it('keeps preferred pairings from routes already drafted that day', () => {
    const paired = assignDrivers(vehicles, drivers, [
      { vehicle_id: 'v2', driver_id: 'd2' },
    ]);
    expect(paired[1].driver.id).toBe('d2');
    expect(paired[0].driver.id).toBe('d1');
    expect(paired[2].driver).toBeNull();
  });

  it('does not give the same driver to two vehicles', () => {
    const paired = assignDrivers(vehicles, drivers, [
      { vehicle_id: 'v1', driver_id: 'd1' },
      { vehicle_id: 'v2', driver_id: 'd1' },
    ]);
    expect(paired[0].driver.id).toBe('d1');
    expect(paired[1].driver.id).toBe('d2');
  });

  it('leaves vehicles without a driver when the pool is empty', () => {
    expect(assignDrivers(vehicles, [])[0].driver).toBeNull();
  });
});

describe('shapeSolution', () => {
  it('keeps only what a promoter needs, as plain JSON', () => {
    const shaped = shapeSolution({
      routes: [{
        vehicle_id: 'v1',
        driver_id: 'd1',
        depot_location_id: 'dep',
        distance_km: 40,
        duration_min: 90,
        service_min: 30,
        waiting_min: 5,
        cost: 12.5,
        violations: [],
        stops: [{
          seq: 1,
          kind: 'livrare',
          order_id: 'o1',
          location_id: 'l1',
          arrival_sec: 32_400,
          departure_sec: 33_000,
          service_time_min: 10,
          waiting_min: 0,
          leg_distance_km: 12,
          leg_duration_min: 20,
          extra: 'drop-me',
        }],
      }],
      unassigned: [{ order_id: 'o2', reason: 'nealocat' }],
    });

    expect(shaped.routes[0].stops[0].extra).toBeUndefined();
    expect(shaped.routes[0].stops[0].arrival_sec).toBe(32_400);
    expect(shaped.unassigned).toEqual([{ order_id: 'o2', reason: 'nealocat' }]);
  });
});

describe('shapeKpis', () => {
  it('merges extras without losing the plan totals', () => {
    expect(shapeKpis(
      { kpis: { distance_km: 40, routes: 2 } },
      { cache: { hits: 10 }, dropped: 1 }
    )).toEqual({ distance_km: 40, routes: 2, cache: { hits: 10 }, dropped: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import {
  BREAK_MIN,
  DAILY_REST_MIN,
  MAX_CONTINUOUS_DRIVE_MIN,
  MAX_DAILY_DRIVE_MIN,
  applyDrivingRules,
  applyDrivingRulesToRoute,
} from './drivingRules.js';

function stop(overrides = {}) {
  return {
    kind: 'livrare',
    order_id: null,
    location_id: 'loc',
    service_time_min: 10,
    waiting_min: 0,
    leg_distance_km: 0,
    leg_duration_min: 0,
    arrival_sec: 0,
    departure_sec: 0,
    ...overrides,
  };
}

function route(stops, overrides = {}) {
  return {
    vehicle_id: 'v1',
    driver_id: 'd1',
    depot_location_id: 'dep',
    violations: [],
    stops,
    ...overrides,
  };
}

describe('applyDrivingRulesToRoute', () => {
  it('leaves a short route untouched', () => {
    const result = applyDrivingRulesToRoute(route([
      stop({ kind: 'depot_start', location_id: 'dep', arrival_sec: 28_800, service_time_min: 0 }),
      stop({
        order_id: 'o1', location_id: 'a',
        leg_duration_min: 60, leg_distance_km: 40, service_time_min: 15,
      }),
      stop({ kind: 'depot_end', location_id: 'dep', leg_duration_min: 60, leg_distance_km: 40 }),
    ]));

    expect(result.breaks_inserted).toBe(0);
    expect(result.rests_inserted).toBe(0);
    expect(result.stops.map((s) => s.kind)).toEqual(['depot_start', 'livrare', 'depot_end']);
    expect(result.stops[1].arrival_sec).toBe(28_800 + 60 * 60);
  });

  it('inserts a 45-minute break before continuous driving would exceed 4h30', () => {
    const result = applyDrivingRulesToRoute(route([
      stop({ kind: 'depot_start', location_id: 'dep', arrival_sec: 21_600, service_time_min: 0 }),
      stop({
        order_id: 'o1', location_id: 'a',
        leg_duration_min: MAX_CONTINUOUS_DRIVE_MIN + 30,
        leg_distance_km: 300,
        service_time_min: 15,
      }),
    ]));

    expect(result.breaks_inserted).toBe(1);
    expect(result.stops.map((s) => s.kind)).toEqual(['depot_start', 'pauza', 'livrare']);
    expect(result.stops[1].service_time_min).toBe(BREAK_MIN);
    expect(result.stops[1].leg_duration_min).toBe(MAX_CONTINUOUS_DRIVE_MIN);
    expect(result.stops[2].leg_duration_min).toBe(30);
    // Clocks: start 06:00, drive 4h30, break 45, drive 30 → arrive 11:45
    expect(result.stops[2].arrival_sec).toBe(21_600 + (270 + 45 + 30) * 60);
  });

  it('inserts a daily rest once driving would exceed 9 hours', () => {
    // Three legs of 200 min = 600 min driving (> 540), with short services.
    const result = applyDrivingRulesToRoute(route([
      stop({ kind: 'depot_start', location_id: 'dep', arrival_sec: 21_600, service_time_min: 0 }),
      stop({ order_id: 'o1', location_id: 'a', leg_duration_min: 200, leg_distance_km: 150 }),
      stop({ order_id: 'o2', location_id: 'b', leg_duration_min: 200, leg_distance_km: 150 }),
      stop({ order_id: 'o3', location_id: 'c', leg_duration_min: 200, leg_distance_km: 150 }),
    ]));

    expect(result.rests_inserted).toBeGreaterThanOrEqual(1);
    expect(result.stops.some((s) => s.kind === 'repaus')).toBe(true);
    expect(result.stops.find((s) => s.kind === 'repaus').service_time_min).toBe(DAILY_REST_MIN);
    // Continuous breaks may also appear (200+200=400 > 270).
    expect(result.breaks_inserted + result.rests_inserted).toBeGreaterThanOrEqual(2);
  });

  it('never leaves a stretch of driving longer than 4h30 in the rebuilt route', () => {
    const result = applyDrivingRulesToRoute(route([
      stop({ kind: 'depot_start', location_id: 'dep', arrival_sec: 0, service_time_min: 0 }),
      stop({ order_id: 'o1', leg_duration_min: 500, leg_distance_km: 400 }),
      stop({ order_id: 'o2', leg_duration_min: 400, leg_distance_km: 300 }),
    ]));

    let since = 0;
    let today = 0;
    for (const s of result.stops) {
      since += s.leg_duration_min || 0;
      today += s.leg_duration_min || 0;
      expect(since).toBeLessThanOrEqual(MAX_CONTINUOUS_DRIVE_MIN);
      expect(today).toBeLessThanOrEqual(MAX_DAILY_DRIVE_MIN);
      if (s.kind === 'pauza') since = 0;
      if (s.kind === 'repaus') {
        since = 0;
        today = 0;
      }
    }
  });

  it('flags a window that the inserted break pushes past closing time', () => {
    const windows = new Map([
      ['o1', { window_start: '08:00', window_end: '11:00' }],
    ]);
    const result = applyDrivingRulesToRoute(route([
      stop({ kind: 'depot_start', location_id: 'dep', arrival_sec: 21_600, service_time_min: 0 }),
      stop({
        order_id: 'o1', location_id: 'a',
        // 4h30 + 30 of driving from 06:00, plus a 45 min break → arrive 11:45 > 11:00
        leg_duration_min: MAX_CONTINUOUS_DRIVE_MIN + 30,
        leg_distance_km: 300,
        service_time_min: 15,
      }),
    ]), { windowsByOrderId: windows });

    expect(result.violations).toEqual([
      expect.objectContaining({ order_id: 'o1', type: 'intarziere' }),
    ]);
    expect(result.violations[0].by_min).toBe(45);
  });

  it('keeps distance: split legs still add up to the original kilometres', () => {
    const result = applyDrivingRulesToRoute(route([
      stop({ kind: 'depot_start', location_id: 'dep', arrival_sec: 0, service_time_min: 0 }),
      stop({
        order_id: 'o1',
        leg_duration_min: MAX_CONTINUOUS_DRIVE_MIN + 90,
        leg_distance_km: 360,
      }),
    ]));
    const km = result.stops.reduce((sum, s) => sum + (s.leg_distance_km || 0), 0);
    expect(km).toBeCloseTo(360, 5);
  });
});

describe('applyDrivingRules', () => {
  it('aggregates break counts into kpis and claims zero driving-rule violations', () => {
    const plan = applyDrivingRules({
      routes: [
        route([
          stop({ kind: 'depot_start', location_id: 'dep', arrival_sec: 0, service_time_min: 0 }),
          stop({ order_id: 'o1', leg_duration_min: 300, leg_distance_km: 200 }),
        ]),
      ],
      kpis: { objective: 'timp', routes: 1 },
      unassigned: [],
    });

    expect(plan.kpis.breaks_inserted).toBe(1);
    expect(plan.kpis.driving_rule_violations).toBe(0);
    expect(plan.kpis.routes).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyOrder,
  buildLegs,
  checkCapacity,
  checkRequirements,
  checkTimeWindows,
  insertStop,
  minutesFromTime,
  moveStop,
  normalizeSequence,
  removeStop,
  routeTotals,
  scheduleStops,
  sortStops,
  summarizeRoute,
} from './routePlan.js';

const stop = (id, seq, over = {}) => ({ id, seq, kind: 'livrare', service_time_min: 15, ...over });

const ROUTE = [
  stop('depot', 1, { kind: 'depot_start', service_time_min: 0 }),
  stop('a', 2),
  stop('b', 3),
  stop('c', 4),
];

describe('sortStops', () => {
  it('orders by seq regardless of array order', () => {
    expect(sortStops([stop('b', 3), stop('a', 2)]).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('pushes stops with no seq to the end instead of treating them as zero', () => {
    expect(sortStops([stop('x', undefined), stop('a', 1)]).map((s) => s.id)).toEqual(['a', 'x']);
  });
});

describe('normalizeSequence', () => {
  it('renumbers from 1 with no gaps', () => {
    expect(normalizeSequence([stop('a', 5), stop('b', 9)]).map((s) => s.seq)).toEqual([1, 2]);
  });
});

describe('moveStop', () => {
  it('moves a stop later and renumbers everything', () => {
    const moved = moveStop(ROUTE, 'a', 3);
    expect(moved.map((s) => s.id)).toEqual(['depot', 'b', 'c', 'a']);
    expect(moved.map((s) => s.seq)).toEqual([1, 2, 3, 4]);
  });

  it('moves a stop earlier', () => {
    expect(moveStop(ROUTE, 'c', 1).map((s) => s.id)).toEqual(['depot', 'c', 'a', 'b']);
  });

  it('keeps the depot pinned first even when dragged into the middle', () => {
    expect(moveStop(ROUTE, 'depot', 3).map((s) => s.id)).toEqual(['depot', 'a', 'b', 'c']);
  });

  it('keeps a depot_end pinned last', () => {
    const withEnd = [...ROUTE, stop('end', 5, { kind: 'depot_end' })];
    expect(moveStop(withEnd, 'end', 1).map((s) => s.id)).toEqual(['depot', 'a', 'b', 'c', 'end']);
  });

  it('clamps an out-of-range target index', () => {
    expect(moveStop(ROUTE, 'a', 99).map((s) => s.id)).toEqual(['depot', 'b', 'c', 'a']);
    expect(moveStop(ROUTE, 'c', -5).map((s) => s.id)).toEqual(['depot', 'c', 'a', 'b']);
  });

  it('is a no-op for an unknown stop', () => {
    expect(moveStop(ROUTE, 'nope', 0).map((s) => s.id)).toEqual(['depot', 'a', 'b', 'c']);
  });
});

describe('insertStop / removeStop', () => {
  it('inserts at a position and renumbers', () => {
    const next = insertStop(ROUTE, stop('new', 0), 2);
    expect(next.map((s) => s.id)).toEqual(['depot', 'a', 'new', 'b', 'c']);
    expect(next.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('appends when no index is given', () => {
    expect(insertStop(ROUTE, stop('new', 0)).map((s) => s.id)).toEqual(['depot', 'a', 'b', 'c', 'new']);
  });

  it('removes and closes the gap', () => {
    const next = removeStop(ROUTE, 'b');
    expect(next.map((s) => s.id)).toEqual(['depot', 'a', 'c']);
    expect(next.map((s) => s.seq)).toEqual([1, 2, 3]);
  });
});

describe('applyOrder', () => {
  it('applies an explicit id order', () => {
    expect(applyOrder(ROUTE, ['depot', 'c', 'b', 'a']).map((s) => s.id))
      .toEqual(['depot', 'c', 'b', 'a']);
  });

  it('keeps stops the caller did not mention, at the end', () => {
    expect(applyOrder(ROUTE, ['depot', 'c']).map((s) => s.id))
      .toEqual(['depot', 'c', 'a', 'b']);
  });

  it('ignores ids that are not on the route', () => {
    expect(applyOrder(ROUTE, ['ghost', 'depot', 'a', 'b', 'c']).map((s) => s.id))
      .toEqual(['depot', 'a', 'b', 'c']);
  });
});

describe('buildLegs', () => {
  const matrix = {
    distances_km: [[0, 10, 25], [10, 0, 18], [25, 18, 0]],
    durations_min: [[0, 12, 30], [12, 0, 20], [30, 20, 0]],
  };
  const indexOf = (s) => ({ a: 0, b: 1, c: 2 }[s.id]);

  it('gives the first stop a zero leg and the rest their matrix values', () => {
    const legs = buildLegs([stop('a', 1), stop('b', 2), stop('c', 3)], matrix, indexOf);
    expect(legs.map((s) => s.leg_distance_km)).toEqual([0, 10, 18]);
    expect(legs.map((s) => s.leg_duration_min)).toEqual([0, 12, 20]);
  });

  it('leaves a leg null when the matrix has no value, rather than assuming zero', () => {
    const sparse = { distances_km: [[0, null], [null, 0]], durations_min: [[0, null], [null, 0]] };
    const legs = buildLegs([stop('a', 1), stop('b', 2)], sparse, (s) => ({ a: 0, b: 1 }[s.id]));
    expect(legs[1].leg_distance_km).toBe(null);
  });
});

describe('scheduleStops', () => {
  const legged = [
    stop('a', 1, { service_time_min: 10, leg_duration_min: 0 }),
    stop('b', 2, { service_time_min: 20, leg_duration_min: 30 }),
    stop('c', 3, { service_time_min: 15, leg_duration_min: 45 }),
  ];

  it('accumulates travel and service time', () => {
    const scheduled = scheduleStops(legged, { startAt: '2026-08-26T06:00:00.000Z' });
    const at = (i) => new Date(scheduled[i].planned_arrival).toISOString();
    expect(at(0)).toBe('2026-08-26T06:00:00.000Z');
    // 06:00 + 10 service + 30 travel
    expect(at(1)).toBe('2026-08-26T06:40:00.000Z');
    // + 20 service + 45 travel
    expect(at(2)).toBe('2026-08-26T07:45:00.000Z');
  });

  it('sets departure to arrival plus service time', () => {
    const scheduled = scheduleStops(legged, { startAt: '2026-08-26T06:00:00.000Z' });
    expect(new Date(scheduled[1].planned_departure) - new Date(scheduled[1].planned_arrival))
      .toBe(20 * 60_000);
  });

  it('stops the clock at a missing leg instead of inventing times after it', () => {
    const broken = [
      stop('a', 1, { leg_duration_min: 0 }),
      stop('b', 2, { leg_duration_min: null }),
      stop('c', 3, { leg_duration_min: 20 }),
    ];
    const scheduled = scheduleStops(broken, { startAt: '2026-08-26T06:00:00.000Z' });
    expect(scheduled[0].planned_arrival).not.toBe(null);
    expect(scheduled[1].planned_arrival).toBe(null);
    expect(scheduled[2].planned_arrival).toBe(null);
  });

  it('returns null times when there is no start instant', () => {
    expect(scheduleStops(legged, {}).every((s) => s.planned_arrival === null)).toBe(true);
  });

  it('falls back to the default service time when a stop has none', () => {
    const scheduled = scheduleStops(
      [stop('a', 1, { service_time_min: null, leg_duration_min: 0 }),
       stop('b', 2, { service_time_min: null, leg_duration_min: 0 })],
      { startAt: '2026-08-26T06:00:00.000Z', defaultServiceMin: 25 }
    );
    expect(new Date(scheduled[1].planned_arrival) - new Date(scheduled[0].planned_arrival))
      .toBe(25 * 60_000);
  });
});

describe('minutesFromTime', () => {
  it('parses HH:MM and HH:MM:SS', () => {
    expect(minutesFromTime('08:30')).toBe(510);
    expect(minutesFromTime('08:30:00')).toBe(510);
  });

  it('returns null for junk', () => {
    expect(minutesFromTime(null)).toBe(null);
    expect(minutesFromTime('nope')).toBe(null);
    expect(minutesFromTime('99:99')).toBe(null);
  });
});

describe('checkTimeWindows', () => {
  /** Build an arrival at a given local hour so the check is timezone-independent. */
  const arriveAt = (hour, minute, over = {}) => {
    const d = new Date(2026, 7, 26, hour, minute, 0);
    return stop('s', 1, { planned_arrival: d.toISOString(), ...over });
  };

  it('flags a late arrival with the overshoot', () => {
    const v = checkTimeWindows([arriveAt(17, 30, { window_start: '08:00', window_end: '16:00' })]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ type: 'intarziere', by_min: 90 });
  });

  it('flags arriving before the window opens', () => {
    const v = checkTimeWindows([arriveAt(6, 0, { window_start: '08:00', window_end: '16:00' })]);
    expect(v[0]).toMatchObject({ type: 'prea_devreme', by_min: 120 });
  });

  it('says nothing when the arrival is inside the window', () => {
    expect(checkTimeWindows([arriveAt(10, 0, { window_start: '08:00', window_end: '16:00' })]))
      .toEqual([]);
  });

  it('ignores stops with no window or no planned arrival', () => {
    expect(checkTimeWindows([arriveAt(3, 0), stop('x', 2, { window_end: '10:00' })])).toEqual([]);
  });
});

describe('routeTotals', () => {
  const loaded = [
    stop('depot', 1, { kind: 'depot_start', service_time_min: 0, leg_distance_km: 0, leg_duration_min: 0 }),
    stop('a', 2, { leg_distance_km: 10, leg_duration_min: 12, weight_kg: 500, volume_mc: 2, pallets: 2 }),
    stop('b', 3, { leg_distance_km: 18, leg_duration_min: 20, weight_kg: 300, volume_mc: 1.5, pallets: 1 }),
  ];

  it('sums legs, service time and load', () => {
    expect(routeTotals(loaded)).toMatchObject({
      stops: 2,
      distance_km: 28,
      duration_min: 62, // 12 + 20 travel, 15 + 15 service, depot 0
      weight_kg: 800,
      volume_mc: 3.5,
      pallets: 3,
      complete: true,
    });
  });

  it('marks the totals incomplete when a leg is missing', () => {
    const gap = [...loaded];
    gap[2] = { ...gap[2], leg_distance_km: null };
    expect(routeTotals(gap).complete).toBe(false);
  });

  it('handles an empty route', () => {
    expect(routeTotals([])).toMatchObject({ stops: 0, distance_km: 0, complete: true });
  });
});

describe('checkCapacity', () => {
  const totals = { weight_kg: 26_000, volume_mc: 100 };

  it('reports what is over and by how much', () => {
    const problems = checkCapacity(totals, { capacity_kg: 24_000, capacity_mc: 95 });
    expect(problems.map((p) => p.field)).toEqual(['weight_kg', 'volume_mc']);
    expect(problems[0]).toMatchObject({ over: 2000, unit: 'kg' });
  });

  it('says nothing when everything fits', () => {
    expect(checkCapacity(totals, { capacity_kg: 30_000, capacity_mc: 120 })).toEqual([]);
  });

  it('treats an unknown capacity as unknown, not as zero', () => {
    expect(checkCapacity(totals, { capacity_kg: null, capacity_mc: '' })).toEqual([]);
    expect(checkCapacity(totals, {})).toEqual([]);
  });

  it('handles no vehicle assigned yet', () => {
    expect(checkCapacity(totals, null)).toEqual([]);
  });
});

describe('checkRequirements', () => {
  it('lists capabilities the vehicle lacks', () => {
    const stops = [stop('a', 1, { requires: ['ADR', 'frigo'] }), stop('b', 2, { requires: ['frigo'] })];
    expect(checkRequirements(stops, ['frigo'])).toEqual(['ADR']);
  });

  it('is case-insensitive and deduplicates', () => {
    const stops = [stop('a', 1, { requires: ['ADR'] }), stop('b', 2, { requires: ['adr'] })];
    expect(checkRequirements(stops, [])).toEqual(['ADR']);
  });

  it('returns nothing when no stop requires anything', () => {
    expect(checkRequirements([stop('a', 1)], [])).toEqual([]);
  });
});

describe('summarizeRoute', () => {
  it('schedules, totals and validates in one call', () => {
    const stops = [
      stop('a', 1, { leg_duration_min: 0, leg_distance_km: 0, weight_kg: 20_000, service_time_min: 10 }),
      stop('b', 2, { leg_duration_min: 30, leg_distance_km: 40, weight_kg: 8000, service_time_min: 10 }),
    ];
    const result = summarizeRoute(stops, {
      vehicle: { capacity_kg: 24_000 },
      startAt: '2026-08-26T05:00:00.000Z',
    });
    expect(result.totals.weight_kg).toBe(28_000);
    expect(result.capacityProblems).toHaveLength(1);
    expect(result.stops[1].planned_arrival).not.toBe(null);
  });
});

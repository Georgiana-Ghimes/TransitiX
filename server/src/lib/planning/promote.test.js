import { describe, expect, it } from 'vitest';
import {
  buildPromotedStops,
  plannedInstant,
  routeCodeFor,
  startsAtFromRoute,
} from './promote.js';

describe('plannedInstant', () => {
  it('adds seconds from midnight onto the route date', () => {
    const instant = plannedInstant('2026-08-25', 9 * 3600 + 30 * 60);
    expect(instant.getHours()).toBe(9);
    expect(instant.getMinutes()).toBe(30);
    expect(instant.getFullYear()).toBe(2026);
  });

  it('returns null for missing clocks rather than inventing midnight', () => {
    expect(plannedInstant('2026-08-25', null)).toBeNull();
  });
});

describe('routeCodeFor', () => {
  it('prefers the plate so the board is readable', () => {
    expect(routeCodeFor(0, 'B 01 AAA')).toBe('R-B01AAA');
  });

  it('falls back to a numbered code', () => {
    expect(routeCodeFor(3, null)).toBe('R-04');
  });
});

describe('startsAtFromRoute', () => {
  it('reads the depot departure clock', () => {
    expect(startsAtFromRoute({
      stops: [{ kind: 'depot_start', arrival_sec: 7 * 3600 }],
    })).toBe('07:00');
  });

  it('defaults when the solver left no clock', () => {
    expect(startsAtFromRoute({ stops: [] })).toBe('08:00');
  });
});

describe('buildPromotedStops', () => {
  it('turns seconds into timestamps the board can show', () => {
    const stops = buildPromotedStops({
      stops: [{
        seq: 2, kind: 'livrare', order_id: 'o1', location_id: 'l1',
        arrival_sec: 32_400, departure_sec: 33_300,
        service_time_min: 15, leg_distance_km: 12, leg_duration_min: 20,
      }],
    }, '2026-08-25');
    expect(stops[0].planned_arrival.getHours()).toBe(9);
    expect(stops[0].planned_departure.getMinutes()).toBe(15);
    expect(stops[0].order_id).toBe('o1');
  });
});

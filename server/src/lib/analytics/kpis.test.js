import { describe, expect, it } from 'vitest';
import {
  buildCockpit,
  emptyKmShare,
  fillRates,
  planVsActual,
  punctuality,
} from './kpis.js';

describe('punctuality', () => {
  it('counts on-time within grace', () => {
    const base = Date.parse('2026-08-25T10:00:00Z');
    const result = punctuality({
      graceMin: 15,
      stops: [
        {
          kind: 'livrare',
          planned_arrival: new Date(base).toISOString(),
          actual_arrival: new Date(base + 10 * 60_000).toISOString(),
        },
        {
          kind: 'livrare',
          planned_arrival: new Date(base).toISOString(),
          actual_arrival: new Date(base + 40 * 60_000).toISOString(),
        },
      ],
    });
    expect(result.on_time).toBe(1);
    expect(result.late).toBe(1);
    expect(result.rate_pct).toBe(50);
  });
});

describe('emptyKmShare / fillRates / planVsActual', () => {
  it('computes empty share and fill', () => {
    expect(emptyKmShare({
      legs: [
        { distance_km: 20, empty: true },
        { distance_km: 80, empty: false },
      ],
    }).empty_pct).toBe(20);
    expect(fillRates({ used_kg: 8000, capacity_kg: 10000 }).weight_pct).toBe(80);
    expect(planVsActual({
      planned_distance_km: 100,
      actual_distance_km: 112,
      planned_duration_min: 120,
      actual_duration_min: 140,
    }).distance.delta_km).toBe(12);
  });
});

describe('buildCockpit', () => {
  it('aggregates routes and costs', () => {
    const cockpit = buildCockpit({
      routes: [
        { id: 'r1', code: 'R-01', planned_distance_km: 100, actual_distance_km: 110 },
      ],
      stops: [],
      costs: [{ route_id: 'r1', total: 250 }],
      orders: [{ status: 'livrat' }, { status: 'nou' }],
    });
    expect(cockpit.kpis.routes).toBe(1);
    expect(cockpit.kpis.cost_total).toBe(250);
    expect(cockpit.kpis.orders_delivered).toBe(1);
    expect(cockpit.kpis.delta_km).toBe(10);
  });
});

import { describe, expect, it } from 'vitest';
import {
  canDropOnRoute,
  dayTotals,
  formatDuration,
  formatEta,
  formatKm,
  nextRouteCode,
  parseDragPayload,
  previewFit,
  routeStatusMeta,
  routeWarnings,
  stopMarkerColor,
  unplannedOrders,
} from './dispatchUi.js';

describe('routeStatusMeta', () => {
  it('labels every known status', () => {
    for (const s of ['draft', 'planificata', 'lansata', 'in_executie', 'finalizata', 'anulata']) {
      expect(routeStatusMeta(s).label).toBeTruthy();
    }
  });

  it('falls back instead of returning undefined', () => {
    expect(routeStatusMeta('ceva')).toBe(routeStatusMeta('draft'));
  });
});

describe('formatDuration', () => {
  it('splits hours and minutes', () => {
    expect(formatDuration(407)).toBe('6h 47m');
    expect(formatDuration(47)).toBe('47m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(0)).toBe('0m');
  });

  it('shows a dash for nothing usable', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration('abc')).toBe('—');
    expect(formatDuration(-5)).toBe('—');
  });
});

describe('formatEta', () => {
  it('renders local time, not UTC', () => {
    // 05:00Z is 08:00 in Europe/Bucharest, which is what a dispatcher must see.
    const local = new Date(2026, 7, 27, 8, 0).toISOString();
    expect(formatEta(local)).toBe('08:00');
  });

  it('shows placeholders for a missing or unparseable time', () => {
    expect(formatEta(null)).toBe('--:--');
    expect(formatEta('not a date')).toBe('--:--');
  });
});

describe('formatKm', () => {
  it('formats with the Romanian separator', () => {
    expect(formatKm(325.57)).toMatch(/325[,.]6 km/);
  });

  it('shows a dash for nothing usable', () => {
    expect(formatKm(null)).toBe('—');
  });
});

describe('nextRouteCode', () => {
  it('starts at R-01', () => {
    expect(nextRouteCode([])).toBe('R-01');
  });

  it('continues past the highest existing code', () => {
    expect(nextRouteCode(['R-01', 'R-02'])).toBe('R-03');
  });

  it('ignores codes that do not match the pattern', () => {
    expect(nextRouteCode(['R-01', 'manual', 'RUTA-9'])).toBe('R-02');
  });

  it('does not reuse a gap left by a deleted route', () => {
    expect(nextRouteCode(['R-01', 'R-05'])).toBe('R-06');
  });
});

describe('previewFit', () => {
  const totals = { weight_kg: 20_000, volume_mc: 80 };

  it('warns when the order would push the vehicle over', () => {
    const warnings = previewFit({ weight_kg: 8000 }, totals, { capacity_kg: 24_000 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ field: 'weight_kg', over: 4000 });
  });

  it('says nothing when it fits', () => {
    expect(previewFit({ weight_kg: 2000 }, totals, { capacity_kg: 24_000 })).toEqual([]);
  });

  it('treats an unknown capacity as unknown, not as zero', () => {
    expect(previewFit({ weight_kg: 8000 }, totals, { capacity_kg: null })).toEqual([]);
    expect(previewFit({ weight_kg: 8000 }, totals, {})).toEqual([]);
  });

  it('handles a route with no vehicle yet', () => {
    expect(previewFit({ weight_kg: 8000 }, totals, null)).toEqual([]);
  });
});

describe('routeWarnings', () => {
  it('reports a capacity overflow as an error', () => {
    const out = routeWarnings({ capacityProblems: [{ label: 'greutate', over: 2000, unit: 'kg' }] });
    expect(out[0]).toMatchObject({ level: 'error' });
    expect(out[0].text).toContain('+2000 kg');
  });

  it('names the single late stop but counts several', () => {
    expect(routeWarnings({ windowViolations: [{ seq: 3, type: 'intarziere', by_min: 25 }] })[0].text)
      .toBe('Oprirea 3 întârzie cu 25 min');
    expect(routeWarnings({
      windowViolations: [
        { seq: 3, type: 'intarziere', by_min: 25 },
        { seq: 4, type: 'intarziere', by_min: 40 },
      ],
    })[0].text).toBe('2 opriri întârzie față de fereastră');
  });

  it('treats arriving early as a warning, not an error', () => {
    const out = routeWarnings({ windowViolations: [{ seq: 2, type: 'prea_devreme', by_min: 30 }] });
    expect(out[0].level).toBe('warn');
  });

  it('flags incomplete legs', () => {
    expect(routeWarnings({ totals: { complete: false } })[0].text).toMatch(/ETA-urile sunt incomplete/);
  });

  it('says nothing about a clean route', () => {
    expect(routeWarnings({ totals: { complete: true }, windowViolations: [], capacityProblems: [] }))
      .toEqual([]);
  });
});

describe('unplannedOrders', () => {
  const orders = [
    { order_number: 'CMD-2', status: 'nou', requested_date: '2026-08-27', client_name: 'Alfa' },
    { order_number: 'CMD-1', status: 'nou', requested_date: '2026-08-27', client_name: 'Beta' },
    { order_number: 'CMD-3', status: 'planificat', requested_date: '2026-08-27' },
    { order_number: 'CMD-4', status: 'nou', requested_date: '2026-08-28' },
  ];

  it('keeps only unplanned orders for the chosen day, sorted', () => {
    expect(unplannedOrders(orders, { date: '2026-08-27' }).map((o) => o.order_number))
      .toEqual(['CMD-1', 'CMD-2']);
  });

  it('searches number and client', () => {
    expect(unplannedOrders(orders, { date: '2026-08-27', search: 'alfa' }).map((o) => o.order_number))
      .toEqual(['CMD-2']);
  });

  it('handles a timestamp in requested_date', () => {
    const withTs = [{ order_number: 'X', status: 'nou', requested_date: '2026-08-27T00:00:00.000Z' }];
    expect(unplannedOrders(withTs, { date: '2026-08-27' })).toHaveLength(1);
  });

  it('returns everything unplanned when no date is given', () => {
    expect(unplannedOrders(orders, {})).toHaveLength(3);
  });
});

describe('dayTotals', () => {
  it('counts orders and sums route figures', () => {
    const totals = dayTotals(
      [{ status: 'nou' }, { status: 'planificat' }, { status: 'anulat' }],
      [{ planned_distance_km: 120.4, planned_duration_min: 200 },
       { planned_distance_km: 80.2, planned_duration_min: 150 }]
    );
    expect(totals).toMatchObject({
      orders: 3, unplanned: 1, planned: 1, routes: 2, distance_km: 200.6, duration_min: 350,
    });
  });

  it('handles routes with no computed figures yet', () => {
    expect(dayTotals([], [{}])).toMatchObject({ distance_km: 0, duration_min: 0 });
  });
});

describe('drag payloads', () => {
  it('accepts an order dropped on any route', () => {
    expect(canDropOnRoute({ kind: 'order', orderId: 'o1' }, 'r1')).toBe(true);
  });

  it('keeps a stop inside its own route', () => {
    expect(canDropOnRoute({ kind: 'stop', stopId: 's1', routeId: 'r1' }, 'r1')).toBe(true);
    expect(canDropOnRoute({ kind: 'stop', stopId: 's1', routeId: 'r1' }, 'r2')).toBe(false);
  });

  it('rejects nothing and nonsense', () => {
    expect(canDropOnRoute(null, 'r1')).toBe(false);
    expect(canDropOnRoute({ kind: 'other' }, 'r1')).toBe(false);
  });

  it('parses only well-formed payloads', () => {
    expect(parseDragPayload('{"kind":"order","orderId":"o1"}')).toMatchObject({ kind: 'order' });
    expect(parseDragPayload('{"kind":"stop","stopId":"s1","routeId":"r1"}')).toMatchObject({ kind: 'stop' });
    expect(parseDragPayload('{"kind":"order"}')).toBe(null);
    expect(parseDragPayload('not json')).toBe(null);
    expect(parseDragPayload('')).toBe(null);
  });
});

describe('stopMarkerColor', () => {
  const stop = { id: 's1', planned_arrival: '2026-08-27T05:00:00.000Z' };

  it('marks a late stop red and an early one amber', () => {
    expect(stopMarkerColor(stop, [{ stop_id: 's1', type: 'intarziere' }])).toBe('#C0392B');
    expect(stopMarkerColor(stop, [{ stop_id: 's1', type: 'prea_devreme' }])).toBe('#F5A623');
  });

  it('greys out a stop with no ETA', () => {
    expect(stopMarkerColor({ id: 's2', planned_arrival: null })).toBe('#94A3B8');
  });

  it('uses the normal colour for a clean stop', () => {
    expect(stopMarkerColor(stop, [{ stop_id: 'other', type: 'intarziere' }])).toBe('#1D4E89');
  });
});

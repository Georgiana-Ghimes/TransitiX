import { describe, expect, it } from 'vitest';
import {
  canDropOnRoute,
  dayTotals,
  formatDuration,
  formatEta,
  formatKm,
  nextOrderNumber,
  nextRouteCode,
  orderLocationOptions,
  parseDragPayload,
  previewFit,
  routeStatusMeta,
  routeWarnings,
  stopMarkerColor,
  unplannedOrders,
  validateOrder,
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

describe('nextOrderNumber', () => {
  it('builds the first number for a day', () => {
    expect(nextOrderNumber('2026-08-27', [])).toBe('CMD-20260827-01');
  });

  it('continues past the highest existing number', () => {
    expect(nextOrderNumber('2026-08-27', ['CMD-20260827-01', 'CMD-20260827-04']))
      .toBe('CMD-20260827-05');
  });

  it('does not reuse a gap left by a deleted order', () => {
    expect(nextOrderNumber('2026-08-27', ['CMD-20260827-09'])).toBe('CMD-20260827-10');
  });

  it('ignores numbers from other days and other shapes', () => {
    expect(nextOrderNumber('2026-08-27', ['CMD-20260826-07', 'CMD-DEMO-3', 'altceva']))
      .toBe('CMD-20260827-01');
  });

  it('accepts a timestamp as the date', () => {
    expect(nextOrderNumber('2026-08-27T00:00:00.000Z', [])).toBe('CMD-20260827-01');
  });

  it('returns empty without a date', () => {
    expect(nextOrderNumber(null, [])).toBe('');
  });
});

describe('orderLocationOptions', () => {
  const locations = [
    { id: 'l1', name: 'Depozit Sud', city: 'bucuresti', client_id: 'c1', latitude: 44, longitude: 26 },
    { id: 'l2', name: 'Hala Nord', city: 'cluj napoca', client_id: 'c2' },
    { id: 'l3', name: 'Punct liber', city: 'arad', client_id: null, latitude: 46, longitude: 21 },
    { id: 'l4', name: 'Inactiv', city: 'x', client_id: 'c1', is_active: false },
  ];

  it('lists active locations with a readable label', () => {
    const options = orderLocationOptions(locations);
    expect(options.map((o) => o.id)).toEqual(['l1', 'l2', 'l3']);
    expect(options[0].label).toBe('Depozit Sud — bucuresti');
  });

  it('narrows to a client plus unattached locations', () => {
    expect(orderLocationOptions(locations, 'c1').map((o) => o.id)).toEqual(['l1', 'l3']);
  });

  it('flags which locations have coordinates', () => {
    const options = orderLocationOptions(locations);
    expect(options.find((o) => o.id === 'l2').geocoded).toBe(false);
    expect(options.find((o) => o.id === 'l3').geocoded).toBe(true);
  });
});

describe('validateOrder', () => {
  const valid = { order_number: 'CMD-1', location_id: 'l1', requested_date: '2026-08-27' };

  it('accepts a complete order', () => {
    expect(validateOrder(valid)).toEqual({ ok: true, errors: {} });
  });

  it('requires a location — without one the order can never be planned', () => {
    const { ok, errors } = validateOrder({ ...valid, location_id: null });
    expect(ok).toBe(false);
    expect(errors.location_id).toMatch(/locație/);
  });

  it('requires a number and a date', () => {
    expect(validateOrder({ ...valid, order_number: '  ' }).errors.order_number).toBeTruthy();
    expect(validateOrder({ ...valid, requested_date: '' }).errors.requested_date).toBeTruthy();
  });

  it('rejects a window that ends before it starts', () => {
    expect(validateOrder({ ...valid, window_start: '16:00', window_end: '08:00' }).errors.window_end)
      .toBeTruthy();
    expect(validateOrder({ ...valid, window_start: '08:00', window_end: '16:00' }).ok).toBe(true);
  });

  it('allows an open-ended window', () => {
    expect(validateOrder({ ...valid, window_start: '08:00', window_end: '' }).ok).toBe(true);
  });

  it('rejects negative or non-numeric quantities', () => {
    expect(validateOrder({ ...valid, weight_kg: -5 }).errors.weight_kg).toBeTruthy();
    expect(validateOrder({ ...valid, pallets: 'abc' }).errors.pallets).toBeTruthy();
  });

  it('treats an empty quantity as simply unset', () => {
    expect(validateOrder({ ...valid, weight_kg: '', volume_mc: null }).ok).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  fillColor,
  filterVehicles,
  formatKg,
  formatMeters,
  formatPct,
  groupByStop,
  itemRows,
  loadWarnings,
  stopColor,
  strategyIsIndistinguishable,
  vehicleModelLabel,
} from './loadPlannerUi.js';

const placement = (over = {}) => ({
  id: 'p1', stop_seq: 1, order_number: 'CMD-1', sku: 'LWMB-075',
  x: 0, y: 0, z: 0, length_m: 1.2, width_m: 0.8, height_m: 1.5, weight_kg: 500, ...over,
});

describe('stopColor', () => {
  it('gives the same stop the same colour every time', () => {
    expect(stopColor(3)).toBe(stopColor(3));
  });

  it('wraps around instead of running out', () => {
    expect(stopColor(99)).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('greys out a stop with no sequence', () => {
    expect(stopColor(null)).toBe('#94A3B8');
    expect(stopColor(undefined)).toBe('#94A3B8');
  });
});

describe('fillColor', () => {
  it('treats over-full as an error, not as excellent', () => {
    expect(fillColor(101)).toBe('#C0392B');
    expect(fillColor(95)).toBe('#27AE60');
  });

  it('shades the middle of the range', () => {
    expect(fillColor(60)).toBe('#1D4E89');
    expect(fillColor(20)).toBe('#F5A623');
  });

  it('shows an empty compartment as empty', () => {
    expect(fillColor(0)).toBe('#E2E8F0');
    expect(fillColor(null)).toBe('#E2E8F0');
  });
});

describe('formatters', () => {
  it('rounds percentages', () => {
    expect(formatPct(84.6)).toBe('85%');
    expect(formatPct(null)).toBe('—');
  });

  it('formats weights without decimals', () => {
    expect(formatKg(4233.3)).toMatch(/4\D?233 kg/);
    expect(formatKg(null)).toBe('—');
  });

  it('formats metres', () => {
    expect(formatMeters(13.6)).toMatch(/13[,.]6 m/);
    expect(formatMeters(null)).toBe('—');
  });

  it('does not turn zero into a dash', () => {
    expect(formatKg(0)).toMatch(/0 kg/);
    expect(formatPct(0)).toBe('0%');
  });
});

describe('filterVehicles', () => {
  const fleet = [
    { plate: 'B-301-TRX', brand: 'Mercedes-Benz', model: 'Actros', chassis_number: 'WDB123' },
    { plate: 'CJ-12-LOG', brand: 'Iveco', model: 'S-Way', chassis_number: 'ZCF456' },
  ];

  it('matches the model code, which is what the user searches by', () => {
    expect(filterVehicles(fleet, 'actros').map((v) => v.plate)).toEqual(['B-301-TRX']);
    expect(filterVehicles(fleet, 'S-Way').map((v) => v.plate)).toEqual(['CJ-12-LOG']);
  });

  it('also matches plate, brand and chassis', () => {
    expect(filterVehicles(fleet, 'cj-12')).toHaveLength(1);
    expect(filterVehicles(fleet, 'iveco')).toHaveLength(1);
    expect(filterVehicles(fleet, 'wdb')).toHaveLength(1);
  });

  it('returns everything for an empty search', () => {
    expect(filterVehicles(fleet, '   ')).toHaveLength(2);
  });
});

describe('vehicleModelLabel', () => {
  it('joins brand and model', () => {
    expect(vehicleModelLabel({ brand: 'Volvo', model: 'FH' })).toBe('Volvo FH');
  });

  it('copes with a missing half', () => {
    expect(vehicleModelLabel({ brand: 'Volvo' })).toBe('Volvo');
    expect(vehicleModelLabel({})).toBe('—');
  });
});

describe('groupByStop', () => {
  it('returns stops in loading order — last delivered is loaded first', () => {
    const groups = groupByStop([
      placement({ stop_seq: 1 }), placement({ stop_seq: 3 }), placement({ stop_seq: 2 }),
    ]);
    expect(groups.map((g) => g.stop_seq)).toEqual([3, 2, 1]);
  });

  it('totals weight, volume and item count per stop', () => {
    const groups = groupByStop([placement({ stop_seq: 2 }), placement({ stop_seq: 2 })]);
    expect(groups[0]).toMatchObject({ item_count: 2, weight_kg: 1000 });
    expect(groups[0].volume_mc).toBeCloseTo(2 * 1.2 * 0.8 * 1.5, 3);
  });

  it('handles an empty load', () => {
    expect(groupByStop([])).toEqual([]);
  });
});

describe('itemRows', () => {
  it('collapses identical pallets into one line with a quantity', () => {
    const rows = itemRows([placement(), placement({ id: 'p2' }), placement({ id: 'p3' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sku: 'LWMB-075', quantity: 3, weight_kg: 1500 });
  });

  it('keeps the same article for different stops apart', () => {
    const rows = itemRows([placement({ stop_seq: 1 }), placement({ id: 'p2', stop_seq: 2 })]);
    expect(rows).toHaveLength(2);
  });

  it('sorts by stop then article', () => {
    const rows = itemRows([
      placement({ stop_seq: 2, sku: 'B' }),
      placement({ id: 'p2', stop_seq: 1, sku: 'Z' }),
      placement({ id: 'p3', stop_seq: 1, sku: 'A' }),
    ]);
    expect(rows.map((r) => `${r.stop_seq}${r.sku}`)).toEqual(['1A', '1Z', '2B']);
  });

  it('groups pallets with no SKU rather than dropping them', () => {
    const rows = itemRows([placement({ sku: null }), placement({ id: 'p2', sku: null })]);
    expect(rows[0].quantity).toBe(2);
  });
});

describe('loadWarnings', () => {
  it('says nothing about a clean plan', () => {
    expect(loadWarnings({ unplaced: [], axle: {}, balance: {}, bay: {} })).toEqual([]);
  });

  it('reports items that do not fit as an error', () => {
    const out = loadWarnings({ unplaced: [{}, {}] });
    expect(out[0]).toMatchObject({ level: 'error' });
    expect(out[0].text).toContain('2 colete');
  });

  it('uses the singular for one item', () => {
    expect(loadWarnings({ unplaced: [{}] })[0].text).toContain('1 colet nu încape');
  });

  it('reports an overloaded axle with the overshoot', () => {
    const out = loadWarnings({ axle: { rear_kg: 17000, rear_max_kg: 16000 } });
    expect(out[0].text).toBe('Axa spate depășită cu 1000 kg');
  });

  it('says nothing when an axle limit is unknown', () => {
    expect(loadWarnings({ axle: { rear_kg: 17000, rear_max_kg: null } })).toEqual([]);
  });

  it('warns only on a real lateral imbalance', () => {
    expect(loadWarnings({ balance: { imbalance_pct: 10 } })).toEqual([]);
    expect(loadWarnings({ balance: { imbalance_pct: 35 } })[0].level).toBe('warn');
  });

  it('flags an assumed cargo bay so the numbers are not trusted blindly', () => {
    expect(loadWarnings({ bay: { assumed: true } })[0].text).toMatch(/presupuse/);
  });

  it('handles a missing plan', () => {
    expect(loadWarnings(null)).toEqual([]);
  });
});

describe('strategyIsIndistinguishable', () => {
  it('is true when nothing carries a SKU or picking zone', () => {
    expect(strategyIsIndistinguishable({
      placements: [placement({ sku: null }), placement({ id: 'p2', sku: null })],
    })).toBe(true);
  });

  it('is false as soon as one item has a SKU', () => {
    expect(strategyIsIndistinguishable({
      placements: [placement({ sku: null }), placement({ id: 'p2', sku: 'A' })],
    })).toBe(false);
  });

  it('counts a picking zone too', () => {
    expect(strategyIsIndistinguishable({
      placements: [placement({ sku: null, picking_zone: 'Z1' })],
    })).toBe(false);
  });

  it('also looks at items that did not fit', () => {
    expect(strategyIsIndistinguishable({
      placements: [placement({ sku: null })],
      unplaced: [placement({ id: 'u1', sku: 'B' })],
    })).toBe(false);
  });

  it('says nothing about an empty load', () => {
    expect(strategyIsIndistinguishable({ placements: [], unplaced: [] })).toBe(false);
  });
});

describe('loadWarnings — strategy notice', () => {
  it('explains why the two strategies look identical', () => {
    const out = loadWarnings({ placements: [placement({ sku: null })] });
    expect(out.some((w) => /Ordine depozit/.test(w.text))).toBe(true);
  });

  it('stays quiet once articles carry SKUs', () => {
    const out = loadWarnings({ placements: [placement({ sku: 'LWMB' })] });
    expect(out.some((w) => /Ordine depozit/.test(w.text))).toBe(false);
  });
});

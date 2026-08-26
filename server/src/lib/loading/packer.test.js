import { describe, expect, it } from 'vitest';
import {
  computeAxleLoads,
  itemsFromStops,
  lateralBalance,
  orderItems,
  packItems,
  resolveCargoBay,
  segmentFill,
  sideViewRects,
} from './packer.js';

const BAY_VEHICLE = {
  cargo_length_m: 6,
  cargo_width_m: 2.4,
  cargo_height_m: 2.4,
  axle_front_m: 0.8,
  axle_rear_m: 4.5,
  axle_front_max_kg: 5000,
  axle_rear_max_kg: 10000,
};

describe('resolveCargoBay', () => {
  it('uses vehicle dims when set and falls back to EU trailer', () => {
    expect(resolveCargoBay(BAY_VEHICLE).assumed).toBe(false);
    expect(resolveCargoBay({}).length_m).toBe(13.6);
    expect(resolveCargoBay({}).assumed).toBe(true);
  });
});

describe('itemsFromStops + orderItems', () => {
  it('builds one box per pallet and LIFO puts later stops first', () => {
    const items = itemsFromStops([
      { id: 's1', seq: 1, kind: 'livrare', pallets: 1, weight_kg: 400 },
      { id: 's2', seq: 2, kind: 'livrare', pallets: 1, weight_kg: 400 },
      { id: 'd', seq: 0, kind: 'depot_start', pallets: 2 },
    ]);
    expect(items).toHaveLength(2);
    const ordered = orderItems(items, 'lifo');
    expect(ordered[0].stop_seq).toBe(2);
    expect(ordered[1].stop_seq).toBe(1);
  });
});

describe('packItems', () => {
  it('packs a short LIFO day and reports fill ≥ 0', () => {
    const items = itemsFromStops([
      { id: 's1', seq: 1, kind: 'livrare', pallets: 2, weight_kg: 800 },
      { id: 's2', seq: 2, kind: 'livrare', pallets: 2, weight_kg: 800 },
      { id: 's3', seq: 3, kind: 'livrare', pallets: 2, weight_kg: 800 },
    ]);
    const result = packItems(items, BAY_VEHICLE, { strategy: 'lifo' });
    expect(result.placements.length).toBe(6);
    expect(result.unplaced).toHaveLength(0);
    expect(result.fill.volume_pct).toBeGreaterThan(5);
    // LIFO load order: latest stop packed first; also tends toward the nose (lower x).
    expect(result.placements[0].stop_seq).toBe(3);
    const avgX = (seq) => {
      const rows = result.placements.filter((p) => p.stop_seq === seq);
      return rows.reduce((s, p) => s + p.x, 0) / rows.length;
    };
    expect(avgX(3)).toBeLessThanOrEqual(avgX(1));
  });

  it('leaves overflow unplaced rather than intersecting the wall', () => {
    const tiny = {
      cargo_length_m: 2,
      cargo_width_m: 1,
      cargo_height_m: 1.6,
      axle_front_m: 0.3,
      axle_rear_m: 1.5,
    };
    const items = itemsFromStops([
      { id: 's1', seq: 1, kind: 'livrare', pallets: 8, weight_kg: 4000 },
    ]);
    const result = packItems(items, tiny, { strategy: 'lifo' });
    expect(result.unplaced.length).toBeGreaterThan(0);
    expect(result.placements.length + result.unplaced.length).toBe(8);
  });
});

describe('computeAxleLoads', () => {
  it('warns when rear axle is overloaded', () => {
    const bay = resolveCargoBay(BAY_VEHICLE);
    const axle = computeAxleLoads(
      [{ x: 4, length_m: 1.2, weight_kg: 12000, width_m: 0.8, height_m: 1, y: 0, z: 0 }],
      bay
    );
    expect(axle.warnings.some((w) => /spate/i.test(w))).toBe(true);
  });
});

describe('sideViewRects', () => {
  it('projects to x/z rectangles', () => {
    const rects = sideViewRects([
      { id: 'a', x: 1, z: 0, length_m: 1.2, height_m: 1.5, stop_seq: 2, weight_kg: 100 },
    ]);
    expect(rects[0]).toMatchObject({ x: 1, z: 0, length_m: 1.2, height_m: 1.5 });
  });
});

describe('segmentFill', () => {
  const bay = { length_m: 12, width_m: 2.4, height_m: 2.4 };
  const box = (x, over = {}) => ({
    x, y: 0, z: 0, length_m: 1.2, width_m: 2.4, height_m: 2.4, weight_kg: 600, stop_seq: 1, ...over,
  });

  it('splits the bay into the requested number of compartments', () => {
    const segments = segmentFill([], bay, { count: 6 });
    expect(segments).toHaveLength(6);
    expect(segments.map((s) => s.label)).toEqual(['001', '002', '003', '004', '005', '006']);
    expect(segments[0]).toMatchObject({ from_m: 0, to_m: 2 });
  });

  it('reports an empty bay as empty', () => {
    expect(segmentFill([], bay).every((s) => s.volume_pct === 0)).toBe(true);
  });

  it('fills only the compartment the load sits in', () => {
    const segments = segmentFill([box(0)], bay, { count: 6 });
    expect(segments[0].volume_pct).toBeGreaterThan(0);
    expect(segments[1].volume_pct).toBe(0);
  });

  it('splits a pallet straddling two compartments by overlap, not by its origin', () => {
    // Compartment boundary at 2.0 m; this pallet spans 1.4–2.6 m, so 60/40.
    const segments = segmentFill([box(1.4)], bay, { count: 6 });
    expect(segments[0].weight_kg).toBeCloseTo(300, 0);
    expect(segments[1].weight_kg).toBeCloseTo(300, 0);
    expect(segments[0].weight_kg + segments[1].weight_kg).toBeCloseTo(600, 0);
  });

  it('reaches 100% when a compartment is completely full', () => {
    const full = [box(0, { length_m: 2 })];
    expect(segmentFill(full, bay, { count: 6 })[0].volume_pct).toBe(100);
  });

  it('lists which stops are loaded in each compartment', () => {
    const segments = segmentFill([box(0, { stop_seq: 3 }), box(1.2, { stop_seq: 1 })], bay, { count: 6 });
    expect(segments[0].stops).toEqual([1, 3]);
  });

  it('returns nothing for a bay with no dimensions', () => {
    expect(segmentFill([box(0)], { length_m: 0, width_m: 0, height_m: 0 })).toEqual([]);
  });
});

describe('lateralBalance', () => {
  const bay = { length_m: 12, width_m: 2.4, height_m: 2.4 };
  const box = (y, width_m, weight_kg = 1000) => ({
    x: 0, y, z: 0, length_m: 1.2, width_m, height_m: 1.2, weight_kg,
  });

  it('puts a load against the left wall entirely on the driver side', () => {
    expect(lateralBalance([box(0, 1.2)], bay)).toMatchObject({ driver_kg: 1000, passenger_kg: 0 });
  });

  it('puts a load against the right wall entirely on the passenger side', () => {
    expect(lateralBalance([box(1.2, 1.2)], bay)).toMatchObject({ driver_kg: 0, passenger_kg: 1000 });
  });

  it('splits a load straddling the centre line proportionally', () => {
    // 0.6–1.8 m across a 2.4 m bay: half each side of the 1.2 m centre line.
    expect(lateralBalance([box(0.6, 1.2)], bay)).toMatchObject({ driver_kg: 500, passenger_kg: 500 });
  });

  it('reports the imbalance as its own number', () => {
    const result = lateralBalance([box(0, 1.2, 2000), box(1.2, 1.2, 1000)], bay);
    expect(result.total_kg).toBe(3000);
    expect(result.imbalance_kg).toBe(1000);
    expect(result.imbalance_pct).toBeCloseTo(33.3, 1);
  });

  it('handles an empty load and a bay with no width', () => {
    expect(lateralBalance([], bay)).toMatchObject({ total_kg: 0, imbalance_pct: 0 });
    expect(lateralBalance([box(0, 1.2)], { width_m: 0 })).toMatchObject({ total_kg: 0 });
  });
});

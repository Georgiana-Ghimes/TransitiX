import { describe, expect, it } from 'vitest';
import {
  computeAxleLoads,
  itemsFromStops,
  orderItems,
  packItems,
  resolveCargoBay,
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

import { describe, expect, it } from 'vitest';
import {
  cargoSections,
  floorCapacity,
  placementToBox,
  rotatedFootprint,
  vehicleFloorCapacity,
  vehicleVolumeM3,
} from './geometry';
import { createLoadUnit } from './loadUnits';
import { requireVehicleTemplate } from '../data/vehicleTemplates';
import type { CargoArea, Placement } from './types';

const EURO = { lengthMm: 1200, widthMm: 800, heightMm: 1450 };

describe('rotatedFootprint', () => {
  it('swaps length and width at 90 and 270 degrees', () => {
    expect(rotatedFootprint(EURO, 90)).toEqual({ lengthMm: 800, widthMm: 1200, heightMm: 1450 });
    expect(rotatedFootprint(EURO, 270)).toEqual({ lengthMm: 800, widthMm: 1200, heightMm: 1450 });
  });

  it('leaves the footprint alone at 0 and 180 degrees', () => {
    expect(rotatedFootprint(EURO, 0)).toEqual({ lengthMm: 1200, widthMm: 800, heightMm: 1450 });
    expect(rotatedFootprint(EURO, 180)).toEqual({ lengthMm: 1200, widthMm: 800, heightMm: 1450 });
  });

  it('never changes the height', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      expect(rotatedFootprint(EURO, rotation).heightMm).toBe(1450);
    }
  });
});

describe('floorCapacity', () => {
  const curtainsider: CargoArea = { lengthMm: 13620, widthMm: 2480, heightMm: 2700 };

  it('derives what geometrically fits, without any magic number', () => {
    // 17 rows of 2 with the pallets turned sideways: 17x800 = 13600 mm, 2x1200 = 2400 mm.
    expect(floorCapacity(curtainsider, EURO)).toBe(34);
  });

  it('produces the trade figure of 33 once handling clearance is allowed', () => {
    // Clearance rules out the 17x2 sideways layout, leaving the 11x3 one the trade quotes.
    expect(floorCapacity(curtainsider, EURO, { clearanceMm: 20 })).toBe(33);
  });

  it('drops to 32 when clearance no longer allows three pallets across', () => {
    // 3 x (800 + 30) = 2490 mm exceeds the 2480 mm width — a genuine cliff, worth pinning.
    expect(floorCapacity(curtainsider, EURO, { clearanceMm: 30 })).toBe(32);
  });

  it('derives industrial pallet capacity for the same trailer', () => {
    expect(floorCapacity(curtainsider, { lengthMm: 1200, widthMm: 1000, heightMm: 1450 })).toBe(26);
  });

  it('scales with the cargo area', () => {
    const half: CargoArea = { lengthMm: 6810, widthMm: 2480, heightMm: 2700 };
    expect(floorCapacity(half, EURO)).toBeLessThan(floorCapacity(curtainsider, EURO));
  });

  it('returns 0 when the unit cannot fit at all', () => {
    expect(floorCapacity({ lengthMm: 1000, widthMm: 700, heightMm: 2000 }, EURO)).toBe(0);
  });

  it('handles a degenerate cargo area', () => {
    expect(floorCapacity({ lengthMm: 0, widthMm: 0, heightMm: 0 }, EURO)).toBe(0);
  });
});

describe('vehicle geometry', () => {
  it('counts both bodies of a drawbar combination', () => {
    const drawbar = requireVehicleTemplate('drawbar_2x7_45');
    expect(cargoSections(drawbar)).toHaveLength(2);
    const single = requireVehicleTemplate('swap_body_7_45');
    expect(vehicleFloorCapacity(drawbar, EURO)).toBe(vehicleFloorCapacity(single, EURO) * 2);
  });

  it('sums volume across sections', () => {
    const drawbar = requireVehicleTemplate('drawbar_2x7_45');
    expect(vehicleVolumeM3(drawbar)).toBeGreaterThan(vehicleVolumeM3(requireVehicleTemplate('swap_body_7_45')));
  });
});

describe('placementToBox', () => {
  const unit = createLoadUnit({ id: 'u1', type: 'euro_pallet', quantity: 1, weightKg: 500, stopNumber: 2 });
  const byId = new Map([[unit.id, unit]]);
  const placement: Placement = {
    id: 'p1', loadUnitId: 'u1', position: { x: 100, y: 200, z: 0 }, rotation: 0, quantity: 1,
  };

  it('carries dimensions, weight and stop through to the box', () => {
    const box = placementToBox(placement, byId);
    expect(box).toMatchObject({ id: 'p1', x: 100, y: 200, lengthMm: 1200, widthMm: 800, weightKg: 500, stopNumber: 2 });
  });

  it('applies the rotation to the footprint', () => {
    const box = placementToBox({ ...placement, rotation: 90 }, byId);
    expect(box).toMatchObject({ lengthMm: 800, widthMm: 1200 });
  });

  it('returns null for a placement whose load unit is gone', () => {
    expect(placementToBox({ ...placement, loadUnitId: 'missing' }, byId)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { requireVehicleTemplate } from '../data/vehicleTemplates';
import { createLoadUnit } from '../domain/loadUnits';
import { emptyPlan } from '../domain/plan';
import type { LoadPlan, LoadUnit, Placement, Rotation } from '../domain/types';
import { validatePlacement, validatePlan } from './validate';

const vehicle = requireVehicleTemplate('curtainsider_13_6');

function pallet(id: string, over: Partial<Parameters<typeof createLoadUnit>[0]> = {}): LoadUnit {
  return createLoadUnit({
    id, type: 'euro_pallet', quantity: 40, weightKg: 500, ...over,
  });
}

function at(id: string, unitId: string, x: number, y: number, z = 0, rotation: Rotation = 0): Placement {
  return { id, loadUnitId: unitId, position: { x, y, z }, rotation, quantity: 1 };
}

function planWith(units: LoadUnit[], placements: Placement[]): LoadPlan {
  return { ...emptyPlan(vehicle.id, units), placements };
}

describe('bounds', () => {
  const unit = pallet('u1');

  it('accepts a pallet inside the trailer', () => {
    expect(validatePlacement(vehicle, [unit], at('p1', 'u1', 0, 0)).ok).toBe(true);
  });

  it('rejects a pallet hanging out of the back', () => {
    const result = validatePlacement(vehicle, [unit], at('p1', 'u1', 13000, 0));
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('out_of_bounds_length');
  });

  it('rejects a pallet past the side wall', () => {
    const result = validatePlacement(vehicle, [unit], at('p1', 'u1', 0, 2000));
    expect(result.errors.map((e) => e.code)).toContain('out_of_bounds_width');
  });

  it('rejects a negative coordinate', () => {
    expect(validatePlacement(vehicle, [unit], at('p1', 'u1', -100, 0)).ok).toBe(false);
  });

  it('rejects a stack taller than the roof', () => {
    const tall = pallet('u2', { dimensions: { heightMm: 1450 } });
    const result = validatePlacement(vehicle, [tall], at('p1', 'u2', 0, 0, 2000));
    expect(result.errors.map((e) => e.code)).toContain('out_of_bounds_height');
  });

  it('reports how far past the limit it went', () => {
    const result = validatePlacement(vehicle, [unit], at('p1', 'u1', 13000, 0));
    expect(result.errors[0].overBy).toBe(13000 + 1200 - vehicle.cargo.lengthMm);
  });
});

describe('collision', () => {
  const unit = pallet('u1');

  it('rejects two pallets at the same coordinates', () => {
    const result = validatePlacement(vehicle, [unit], at('p2', 'u1', 0, 0), [at('p1', 'u1', 0, 0)]);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('collision');
  });

  it('rejects a partial overlap', () => {
    const result = validatePlacement(vehicle, [unit], at('p2', 'u1', 600, 0), [at('p1', 'u1', 0, 0)]);
    expect(result.errors[0].code).toBe('collision');
  });

  it('allows pallets that merely touch', () => {
    const result = validatePlacement(vehicle, [unit], at('p2', 'u1', 1200, 0), [at('p1', 'u1', 0, 0)]);
    expect(result.ok).toBe(true);
  });

  it('names both placements so the UI can highlight them', () => {
    const result = validatePlacement(vehicle, [unit], at('p2', 'u1', 0, 0), [at('p1', 'u1', 0, 0)]);
    expect(result.errors[0].placementIds).toEqual(['p2', 'p1']);
  });

  it('reports a collision once per pair at plan level', () => {
    const plan = planWith([unit], [at('p1', 'u1', 0, 0), at('p2', 'u1', 0, 0)]);
    expect(validatePlan(vehicle, plan).errors.filter((e) => e.code === 'collision')).toHaveLength(1);
  });
});

describe('rotation', () => {
  it('lets a rotated pallet fit where the unrotated one would not', () => {
    const unit = pallet('u1');
    // Only 900 mm of width left: 800 wide fits, 1200 does not.
    const blocker = pallet('u2', { dimensions: { lengthMm: 13620, widthMm: 1580 } });
    const existing = [at('p1', 'u2', 0, 0)];
    const straight = validatePlacement(vehicle, [unit, blocker], at('p2', 'u1', 0, 1580, 0, 0), existing);
    const turned = validatePlacement(vehicle, [unit, blocker], at('p2', 'u1', 0, 1580, 0, 90), existing);
    expect(straight.ok).toBe(true);
    expect(turned.ok).toBe(false);
  });
});

describe('payload', () => {
  it('accepts a load exactly at the limit', () => {
    const unit = pallet('u1', { weightKg: 1000, quantity: 24 });
    const placements = Array.from({ length: 24 }, (_, i) => at(`p${i}`, 'u1', i * 500, 0));
    const errors = validatePlan(vehicle, planWith([unit], placements)).errors;
    expect(errors.some((e) => e.code === 'payload_exceeded')).toBe(false);
  });

  it('rejects one kilogram over the limit', () => {
    const unit = pallet('u1', { weightKg: 1000, quantity: 25 });
    const heavy = pallet('u2', { weightKg: 1, quantity: 1 });
    const placements = [
      ...Array.from({ length: 24 }, (_, i) => at(`p${i}`, 'u1', i * 500, 0)),
      at('extra', 'u2', 0, 1000),
    ];
    const errors = validatePlan(vehicle, planWith([unit, heavy], placements)).errors;
    expect(errors.some((e) => e.code === 'payload_exceeded')).toBe(true);
  });
});

describe('axle weight', () => {
  it('flags an axle overloaded by piling everything at the nose', () => {
    const unit = pallet('u1', { weightKg: 1500, quantity: 12 });
    const placements = Array.from({ length: 12 }, (_, i) => at(`p${i}`, 'u1', 0, (i % 3) * 800, Math.floor(i / 3) * 10));
    const result = validatePlan(vehicle, planWith([unit], placements));
    expect(result.errors.some((e) => e.code === 'axle_overloaded')).toBe(true);
  });

  it('names which axle is over', () => {
    const unit = pallet('u1', { weightKg: 1500, quantity: 12 });
    const placements = Array.from({ length: 12 }, (_, i) => at(`p${i}`, 'u1', 0, (i % 3) * 800, Math.floor(i / 3) * 10));
    const finding = validatePlan(vehicle, planWith([unit], placements))
      .errors.find((e) => e.code === 'axle_overloaded');
    expect(finding?.axleId).toBeTruthy();
  });
});

describe('stacking', () => {
  // 1200 mm high, so two of them clear the 2700 mm roof - a 1450 mm pair never could.
  const short = { dimensions: { heightMm: 1200 } };

  it('refuses to stack on a unit marked not stackable', () => {
    const base = pallet('u1', { ...short, stackable: false });
    const top = pallet('u2', short);
    const result = validatePlacement(
      vehicle, [base, top], at('p2', 'u2', 0, 0, 1200), [at('p1', 'u1', 0, 0)]
    );
    expect(result.errors.map((e) => e.code)).toContain('not_stackable');
  });

  it('allows stacking on a stackable unit', () => {
    const base = pallet('u1', short);
    const top = pallet('u2', short);
    const result = validatePlacement(
      vehicle, [base, top], at('p2', 'u2', 0, 0, 1200), [at('p1', 'u1', 0, 0)]
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a stack heavier than the base allows', () => {
    const base = pallet('u1', { ...short, maxStackWeightKg: 300 });
    const top = pallet('u2', { ...short, weightKg: 500 });
    const result = validatePlacement(
      vehicle, [base, top], at('p2', 'u2', 0, 0, 1200), [at('p1', 'u1', 0, 0)]
    );
    expect(result.errors.map((e) => e.code)).toContain('stack_weight_exceeded');
  });


  it('rejects a second layer that would not clear the roof', () => {
    const base = pallet('u1');
    const top = pallet('u2');
    const result = validatePlacement(
      vehicle, [base, top], at('p2', 'u2', 0, 0, 1450), [at('p1', 'u1', 0, 0)]
    );
    expect(result.errors.map((e) => e.code)).toContain('out_of_bounds_height');
  });

  it('rejects a unit floating with nothing beneath it', () => {
    const unit = pallet('u1');
    const result = validatePlacement(vehicle, [unit], at('p1', 'u1', 0, 0, 1450));
    expect(result.errors.map((e) => e.code)).toContain('unsupported_stack');
  });
});

describe('unloading order', () => {
  it('warns when early-stop goods are buried behind later-stop goods', () => {
    const early = pallet('u1', { stopNumber: 1 });
    const late = pallet('u2', { stopNumber: 3 });
    const plan = planWith([early, late], [at('p1', 'u1', 0, 0), at('p2', 'u2', 1200, 0)]);
    const result = validatePlan(vehicle, plan);
    expect(result.warnings.some((w) => w.code === 'unloading_order')).toBe(true);
  });

  it('stays quiet when the order is correct', () => {
    const early = pallet('u1', { stopNumber: 1 });
    const late = pallet('u2', { stopNumber: 3 });
    const plan = planWith([early, late], [at('p1', 'u2', 0, 0), at('p2', 'u1', 1200, 0)]);
    expect(validatePlan(vehicle, plan).warnings.some((w) => w.code === 'unloading_order')).toBe(false);
  });

  it('does not warn when the two sit in different lanes', () => {
    const early = pallet('u1', { stopNumber: 1 });
    const late = pallet('u2', { stopNumber: 3 });
    const plan = planWith([early, late], [at('p1', 'u1', 0, 0), at('p2', 'u2', 1200, 900)]);
    expect(validatePlan(vehicle, plan).warnings.some((w) => w.code === 'unloading_order')).toBe(false);
  });

  it('is a warning, not an error — a dispatcher may accept double handling', () => {
    const early = pallet('u1', { stopNumber: 1 });
    const late = pallet('u2', { stopNumber: 3 });
    const plan = planWith([early, late], [at('p1', 'u1', 0, 0), at('p2', 'u2', 1200, 0)]);
    expect(validatePlan(vehicle, plan).ok).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { requireVehicleTemplate } from '../data/vehicleTemplates';
import { createLoadUnit } from '../domain/loadUnits';
import { emptyPlan } from '../domain/plan';
import { computeStatistics, palletSpaceCapacity } from '../domain/statistics';
import { validatePlan } from '../validation/validate';
import { autoLoad, compareForLoading } from './autoLoad';

const vehicle = requireVehicleTemplate('curtainsider_13_6');

describe('compareForLoading', () => {
  it('loads later stops first so they end up at the front wall', () => {
    const a = createLoadUnit({ type: 'euro_pallet', quantity: 1, weightKg: 100, stopNumber: 1 });
    const b = createLoadUnit({ type: 'euro_pallet', quantity: 1, weightKg: 100, stopNumber: 5 });
    expect([a, b].sort(compareForLoading)[0].stopNumber).toBe(5);
  });

  it('puts heavier units first within the same stop', () => {
    const light = createLoadUnit({ type: 'euro_pallet', quantity: 1, weightKg: 100, stopNumber: 2 });
    const heavy = createLoadUnit({ type: 'euro_pallet', quantity: 1, weightKg: 900, stopNumber: 2 });
    expect([light, heavy].sort(compareForLoading)[0].weightKg).toBe(900);
  });
});

describe('autoLoad', () => {
  it('places a small load completely', () => {
    const unit = createLoadUnit({ id: 'u1', type: 'euro_pallet', quantity: 10, weightKg: 400 });
    const result = autoLoad(vehicle, [unit]);
    expect(result.placements).toHaveLength(10);
    expect(result.unplaced).toHaveLength(0);
  });

  it('produces a plan with no collisions or bounds errors', () => {
    const units = [
      createLoadUnit({ id: 'u1', type: 'euro_pallet', quantity: 12, weightKg: 400, stopNumber: 1 }),
      createLoadUnit({ id: 'u2', type: 'industrial_pallet', quantity: 6, weightKg: 500, stopNumber: 2 }),
    ];
    const result = autoLoad(vehicle, units);
    const plan = { ...emptyPlan(vehicle.id, units), placements: result.placements };
    const errors = validatePlan(vehicle, plan).errors
      .filter((e) => e.code === 'collision' || e.code.startsWith('out_of_bounds'));
    expect(errors).toEqual([]);
  });

  it('reports what it could not fit instead of silently dropping it', () => {
    const unit = createLoadUnit({ id: 'u1', type: 'euro_pallet', quantity: 400, weightKg: 10 });
    const result = autoLoad(vehicle, [unit], { allowStacking: false });
    expect(result.unplaced).toHaveLength(1);
    expect(result.placements.length + result.unplaced[0].quantity).toBe(400);
  });

  it('fills the floor to at least the derived pallet capacity', () => {
    const unit = createLoadUnit({ id: 'u1', type: 'euro_pallet', quantity: 33, weightKg: 100 });
    const result = autoLoad(vehicle, [unit], { allowStacking: false });
    expect(result.placements.length).toBeGreaterThanOrEqual(30);
    expect(result.placements.length).toBeLessThanOrEqual(palletSpaceCapacity(vehicle));
  });

  it('never stacks on a unit that forbids it', () => {
    const base = createLoadUnit({ id: 'u1', type: 'euro_pallet', quantity: 33, weightKg: 100, stackable: false });
    const result = autoLoad(vehicle, [base], { allowStacking: true });
    expect(result.placements.every((p) => p.position.z === 0)).toBe(true);
  });

  it('loads the last stop nearest the front wall', () => {
    const first = createLoadUnit({ id: 'u1', type: 'euro_pallet', quantity: 3, weightKg: 100, stopNumber: 1 });
    const last = createLoadUnit({ id: 'u2', type: 'euro_pallet', quantity: 3, weightKg: 100, stopNumber: 9 });
    const result = autoLoad(vehicle, [first, last]);
    const minX = (unitId: string) => Math.min(
      ...result.placements.filter((p) => p.loadUnitId === unitId).map((p) => p.position.x)
    );
    expect(minX('u2')).toBeLessThan(minX('u1'));
  });

  it('keeps statistics consistent with what it placed', () => {
    const unit = createLoadUnit({ id: 'u1', type: 'euro_pallet', quantity: 10, weightKg: 500 });
    const result = autoLoad(vehicle, [unit]);
    const stats = computeStatistics(vehicle, { ...emptyPlan(vehicle.id, [unit]), placements: result.placements });
    expect(stats.placedCount).toBe(10);
    expect(stats.weight.usedKg).toBe(5000);
  });

  it('handles an empty load list', () => {
    expect(autoLoad(vehicle, [])).toEqual({ placements: [], unplaced: [] });
  });

  it('spreads across both bodies of a drawbar combination', () => {
    const drawbar = requireVehicleTemplate('drawbar_2x7_45');
    const unit = createLoadUnit({ id: 'u1', type: 'euro_pallet', quantity: 30, weightKg: 200 });
    const result = autoLoad(drawbar, [unit], { allowStacking: false });
    const sections = new Set(result.placements.map((p) => p.sectionId));
    expect(sections.size).toBe(2);
  });
});

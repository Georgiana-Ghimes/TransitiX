import { describe, expect, it } from 'vitest';
import { requireVehicleTemplate } from '@/loadplanner/data/vehicleTemplates';
import { createLoadUnit } from '@/loadplanner/domain/loadUnits';
import { emptyPlan } from '@/loadplanner/domain/plan';
import { computeStatistics } from '@/loadplanner/domain/statistics';
import { autoLoad } from '@/loadplanner/planner/autoLoad';
import { validatePlan } from '@/loadplanner/validation/validate';

describe('performance', () => {
  const vehicle = requireVehicleTemplate('curtainsider_13_6');

  it('auto-loads and validates 500 units within a usable budget', () => {
    const units = Array.from({ length: 10 }, (_, i) => createLoadUnit({
      id: `u${i}`, type: 'parcel', quantity: 50, weightKg: 15, stopNumber: (i % 5) + 1,
    }));

    const t0 = performance.now();
    const result = autoLoad(vehicle, units, { stepMm: 200 });
    const tAuto = performance.now() - t0;

    const plan = { ...emptyPlan(vehicle.id, units), placements: result.placements };
    const t1 = performance.now();
    const validation = validatePlan(vehicle, plan);
    const stats = computeStatistics(vehicle, plan);
    const tValidate = performance.now() - t1;

    console.log(`  autoLoad ${result.placements.length} units: ${tAuto.toFixed(0)}ms`);
    console.log(`  validate + stats: ${tValidate.toFixed(0)}ms`);
    console.log(`  errors: ${validation.errors.length}, weight: ${stats.weight.usedKg}kg`);

    expect(result.placements.length).toBeGreaterThan(100);
    expect(tAuto).toBeLessThan(20000);
    expect(tValidate).toBeLessThan(20000);
  });
});

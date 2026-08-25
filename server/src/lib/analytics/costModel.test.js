import { describe, expect, it } from 'vitest';
import { costActivity, resolveCostRates } from './costModel.js';

describe('resolveCostRates', () => {
  it('composes fuel + toll + maintenance when cost_per_km is unset', () => {
    const rates = resolveCostRates(
      { fuel_consumption: 30, toll_per_km: 0.2, maintenance_per_km: 0.1 },
      { default_fuel_price_per_l: 7 }
    );
    // 7 * 30 / 100 = 2.1 fuel + 0.2 + 0.1 = 2.4
    expect(rates.fuel_per_km).toBe(2.1);
    expect(rates.per_km).toBe(2.4);
  });

  it('prefers explicit cost_per_km', () => {
    const rates = resolveCostRates({ cost_per_km: 3.5, fuel_consumption: 30 }, { default_fuel_price_per_l: 7 });
    expect(rates.per_km).toBe(3.5);
  });
});

describe('costActivity', () => {
  it('returns null without rates', () => {
    expect(costActivity({ distance_km: 100, rates: {} })).toBeNull();
  });

  it('costs km and hours', () => {
    const result = costActivity({
      distance_km: 100,
      duration_min: 120,
      stops: 4,
      weight_kg: 2000,
      rates: { per_km: 2.5, per_hour: 40, fuel_per_km: 2.1 },
    });
    expect(result.total).toBe(330); // 250 + 80
    expect(result.per_stop).toBe(82.5);
    expect(result.breakdown.fuel).toBe(210);
  });
});

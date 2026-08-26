import { describe, expect, it } from 'vitest';
import {
  VEHICLE_CLASSES,
  bracketLabel,
  formatAmount,
  groupTariffs,
  isInForce,
  parseAmount,
  validateSurchargeRate,
  validateTariff,
  validateZoneRate,
  validityLabel,
} from './commercial.js';

describe('parseAmount', () => {
  it('reads a Romanian decimal', () => {
    expect(parseAmount('1,95')).toBe(1.95);
    expect(parseAmount('1 234,50')).toBe(1234.5);
  });

  it('leaves blank blank rather than turning it into zero', () => {
    // A tariff of 0 lei is a decision; an empty box is not.
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount('   ')).toBeNull();
  });

  it('returns nothing for junk', () => {
    expect(parseAmount('vreo doua')).toBeNull();
  });

  it('keeps a real zero', () => {
    expect(parseAmount('0')).toBe(0);
  });
});

describe('formatAmount', () => {
  it('formats with two decimals by default', () => {
    expect(formatAmount(1.9)).toBe('1,90');
  });

  it('shows nothing for an empty value', () => {
    expect(formatAmount('')).toBe('');
  });
});

describe('validityLabel', () => {
  it('reads a closed period', () => {
    expect(validityLabel({ valid_from: '2026-01-01', valid_to: '2026-06-30' }))
      .toBe('01.01.2026 → 30.06.2026');
  });

  it('reads an open end', () => {
    expect(validityLabel({ valid_from: '2026-07-01' })).toBe('din 01.07.2026');
  });

  it('handles a row with no dates at all', () => {
    expect(validityLabel({})).toBe('oricând');
  });
});

describe('isInForce', () => {
  const on = '2026-03-15';

  it('accepts a period covering the date', () => {
    expect(isInForce({ valid_from: '2026-01-01', valid_to: '2026-06-30' }, on)).toBe(true);
  });

  it('rejects one that has expired', () => {
    expect(isInForce({ valid_from: '2025-01-01', valid_to: '2026-02-28' }, on)).toBe(false);
  });

  it('rejects one that has not started', () => {
    expect(isInForce({ valid_from: '2026-04-01' }, on)).toBe(false);
  });

  it('treats an open end as still in force', () => {
    expect(isInForce({ valid_from: '2026-01-01' }, on)).toBe(true);
  });
});

describe('groupTariffs', () => {
  const rows = [
    { id: 1, vehicle_class: '10t', valid_from: '2026-01-01', km_rate: 1.8 },
    { id: 2, vehicle_class: '10t', valid_from: '2026-07-01', km_rate: 1.95 },
    { id: 3, vehicle_class: '2.5t', valid_from: '2026-01-01', km_rate: 1.2 },
  ];

  it('groups by class', () => {
    expect(groupTariffs(rows).map((g) => g.vehicle_class)).toEqual(['2.5t', '10t']);
  });

  it('puts the newest period first inside a class', () => {
    // The list is mostly history; the current rate has to be at the top.
    const tens = groupTariffs(rows).find((g) => g.vehicle_class === '10t');
    expect(tens.rows.map((r) => r.id)).toEqual([2, 1]);
  });

  it('sorts classes the way a person reads them, not alphabetically', () => {
    const sorted = groupTariffs([
      { vehicle_class: '20t', valid_from: '2026-01-01' },
      { vehicle_class: '2.5t', valid_from: '2026-01-01' },
      { vehicle_class: '10t', valid_from: '2026-01-01' },
    ]);
    expect(sorted.map((g) => g.vehicle_class)).toEqual(['2.5t', '10t', '20t']);
  });

  it('does not lose a row with no class', () => {
    expect(groupTariffs([{ valid_from: '2026-01-01' }])[0].vehicle_class).toBe('—');
  });

  it('handles an empty list', () => {
    expect(groupTariffs([])).toEqual([]);
  });
});

describe('bracketLabel', () => {
  it('reads a closed bracket', () => {
    expect(bracketLabel({ mma_min_kg: 3500, mma_max_kg: 7500 }).replace(/\s/g, ''))
      .toBe('3.500–7.500kg');
  });

  it('reads an open top', () => {
    expect(bracketLabel({ mma_min_kg: 12000 })).toContain('peste');
  });

  it('reads an open bottom', () => {
    expect(bracketLabel({ mma_max_kg: 3500 })).toContain('până la');
  });

  it('says so when the rate applies to every vehicle', () => {
    expect(bracketLabel({})).toBe('orice MMA');
  });
});

describe('validateTariff', () => {
  const ok = { contract_id: 'c1', vehicle_class: '10t', valid_from: '2026-01-01', km_rate: '1,95' };

  it('accepts a tariff with a per-km rate only', () => {
    expect(validateTariff(ok)).toEqual({});
  });

  it('accepts a tariff with a per-trip rate only', () => {
    expect(validateTariff({ ...ok, km_rate: '', trip_rate: '250' })).toEqual({});
  });

  it('refuses a tariff with no rate at all', () => {
    // It would produce a TPO line of zero that looks deliberate.
    expect(validateTariff({ ...ok, km_rate: '' }).trip_rate).toBeTruthy();
  });

  it('needs a contract and a class', () => {
    const errors = validateTariff({ valid_from: '2026-01-01', km_rate: '1' });
    expect(errors.contract_id).toBeTruthy();
    expect(errors.vehicle_class).toBeTruthy();
  });

  it('needs a start date, because lookups are as of a date', () => {
    expect(validateTariff({ ...ok, valid_from: '' }).valid_from).toBeTruthy();
  });

  it('refuses a period that ends before it starts', () => {
    expect(validateTariff({ ...ok, valid_to: '2025-12-01' }).valid_to).toBeTruthy();
  });

  it('refuses a negative rate', () => {
    expect(validateTariff({ ...ok, km_rate: '-1' }).km_rate).toBeTruthy();
  });
});

describe('validateZoneRate', () => {
  it('accepts a well-formed bracket', () => {
    expect(validateZoneRate({ amount: '75', valid_from: '2026-01-01' })).toEqual({});
  });

  it('needs an amount', () => {
    expect(validateZoneRate({ valid_from: '2026-01-01' }).amount).toBeTruthy();
  });

  it('refuses an upside-down bracket', () => {
    const errors = validateZoneRate({
      amount: '75', valid_from: '2026-01-01', mma_min_kg: '12000', mma_max_kg: '3500',
    });
    expect(errors.mma_max_kg).toBeTruthy();
  });
});

describe('validateSurchargeRate', () => {
  it('needs an amount and a start date', () => {
    expect(validateSurchargeRate({}).amount).toBeTruthy();
    expect(validateSurchargeRate({ amount: '120' }).valid_from).toBeTruthy();
  });

  it('accepts a complete rate', () => {
    expect(validateSurchargeRate({ amount: '120', valid_from: '2026-01-01' })).toEqual({});
  });
});

describe('VEHICLE_CLASSES', () => {
  it('offers the bands the client named', () => {
    for (const band of ['2.5t', '10t', '20t']) expect(VEHICLE_CLASSES).toContain(band);
  });
});

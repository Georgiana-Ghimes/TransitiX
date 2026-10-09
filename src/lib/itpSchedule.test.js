import { describe, expect, it } from 'vitest';
import {
  addCalendarMonths,
  itpIntervalMonths,
  nextItpExpiry,
  resolveItpKind,
  rollItpExpiry,
} from './itpSchedule.js';

describe('itpSchedule', () => {
  it('defaults companion fleet to goods (12 months)', () => {
    expect(resolveItpKind({ mma_kg: 26000 })).toBe('goods');
    expect(itpIntervalMonths({ mma_kg: 3500 })).toBe(12);
    expect(nextItpExpiry({ mma_kg: 40000 }, '2026-10-08')).toEqual({
      iso: '2027-10-08',
      months: 12,
      kind: 'goods',
      label: 'Transport marfă (1 an)',
    });
  });

  it('passenger: 24 months until 12 years, then 12', () => {
    expect(itpIntervalMonths(
      { itp_kind: 'passenger', year: 2020 },
      { asOf: new Date('2026-10-08') },
    )).toBe(24);
    expect(itpIntervalMonths(
      { itp_kind: 'passenger', year: 2010 },
      { asOf: new Date('2026-10-08') },
    )).toBe(12);
    expect(nextItpExpiry(
      { itp_kind: 'passenger', first_registration_date: '2014-03-01' },
      '2026-03-01',
    ).months).toBe(12);
  });

  it('trailer light is 24 months; taxi/bus 6', () => {
    expect(itpIntervalMonths({ itp_kind: 'trailer_light' })).toBe(24);
    expect(itpIntervalMonths({ itp_kind: 'taxi_bus' })).toBe(6);
    expect(nextItpExpiry({ itp_kind: 'taxi_bus' }, '2026-01-31').iso).toBe('2026-07-31');
  });

  it('addCalendarMonths clamps end-of-month', () => {
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addCalendarMonths('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('rollItpExpiry advances from current expiry', () => {
    expect(rollItpExpiry({ mma_kg: 18000, itp_expiry: '2026-05-10' }).iso).toBe('2027-05-10');
  });

  it('rollItpExpiry falls back to today when missing', () => {
    const today = new Date(2026, 9, 8); // 8 Oct 2026
    expect(rollItpExpiry({ mma_kg: 18000 }, { today }).iso).toBe('2027-10-08');
  });
});

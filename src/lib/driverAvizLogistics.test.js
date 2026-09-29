import { describe, expect, it } from 'vitest';
import {
  DRIVER_SHEET_GUIDE,
  driverLogisticsComplete,
  missingDriverLogistics,
} from './driverAvizLogistics.js';

describe('driverAvizLogistics', () => {
  it('exposes an 8-slot writing guide for the carnet photo', () => {
    expect(DRIVER_SHEET_GUIDE).toHaveLength(8);
    expect(DRIVER_SHEET_GUIDE[0].hint).toMatch(/TPO/i);
  });

  it('requires TPO, date, plate and qty-or-weight before confirm', () => {
    expect(missingDriverLogistics({}).length).toBeGreaterThan(0);
    expect(driverLogisticsComplete({
      numar_tpo: 'TPO-0025813',
      data_efectuare_cursa: '2026-08-11',
      numar_auto: 'B-112-VFM',
      cantitate_marfa: 10,
    })).toBe(true);
  });
});

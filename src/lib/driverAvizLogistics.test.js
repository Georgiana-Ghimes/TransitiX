import { describe, expect, it } from 'vitest';
import {
  DRIVER_SHEET_GUIDE,
  driverLogisticsComplete,
  missingDriverLogistics,
} from './driverAvizLogistics.js';

describe('driverAvizLogistics', () => {
  it('exposes the 14-slot writing guide for a handwritten sheet photo', () => {
    expect(DRIVER_SHEET_GUIDE).toHaveLength(14);
    expect(DRIVER_SHEET_GUIDE[0].hint).toMatch(/TPO/i);
    expect(DRIVER_SHEET_GUIDE[3].hint).toMatch(/plăcuță|placuta|auto/i);
    expect(DRIVER_SHEET_GUIDE[7].hint).toMatch(/brută|bruta/i);
    expect(DRIVER_SHEET_GUIDE[8].hint).toMatch(/netă|neta/i);
    expect(DRIVER_SHEET_GUIDE[13].hint).toMatch(/Tarif/i);
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

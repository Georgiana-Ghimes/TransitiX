import { describe, expect, it } from 'vitest';
import {
  DRIVER_REQUIRED_KEYS,
  driverLogisticsComplete,
  missingDriverLogistics,
} from './driverLogistics.js';
import { numberedLineValue } from './numberedSheet.js';

describe('driverLogistics', () => {
  it('blocks when TPO / date / plate / qty-or-weight are empty', () => {
    const missing = missingDriverLogistics({});
    expect(missing.map((m) => m.key)).toEqual(
      expect.arrayContaining([...DRIVER_REQUIRED_KEYS, 'cantitate_sau_greutate']),
    );
    expect(driverLogisticsComplete({})).toBe(false);
  });

  it('passes when required logistics are filled', () => {
    const row = {
      numar_tpo: 'TPO-0025813',
      data_efectuare_cursa: '2026-08-11',
      numar_auto: 'B-112-VFM',
      gross_weight_kg: 15744,
    };
    expect(missingDriverLogistics(row)).toEqual([]);
    expect(driverLogisticsComplete(row)).toBe(true);
  });

  it('accepts cantitate instead of greutate', () => {
    expect(driverLogisticsComplete({
      numar_tpo: 'TPO-1',
      data_efectuare_cursa: '2026-01-01',
      numar_auto: 'CJ-12-ABC',
      cantitate_marfa: 12,
    })).toBe(true);
  });
});

describe('numberedSheet', () => {
  it('reads a numbered carnet line', () => {
    const text = [
      '1. TPO-0025813',
      '2. 11.08.2026',
      '3. B 112 VFM',
      '4. Bucuresti → Ploiesti',
      '6. 15744 kg',
    ].join('\n');
    expect(numberedLineValue(text, 1)).toBe('TPO-0025813');
    expect(numberedLineValue(text, 3)).toBe('B 112 VFM');
    expect(numberedLineValue(text, 6)).toContain('15744');
  });
});

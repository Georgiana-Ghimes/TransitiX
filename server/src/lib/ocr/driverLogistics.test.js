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
  it('reads a numbered carnet line (DRIVER_SHEET_GUIDE slots)', () => {
    const text = [
      '1. TPO-0025813',
      '2. 11.08.2026',
      '4. B 112 VFM',
      '5. Bucuresti → Ploiesti',
      '8. 15744 kg',
      '9. 15000',
    ].join('\n');
    expect(numberedLineValue(text, 1)).toBe('TPO-0025813');
    expect(numberedLineValue(text, 4)).toBe('B 112 VFM');
    expect(numberedLineValue(text, 8)).toContain('15744');
    expect(numberedLineValue(text, 9)).toContain('15000');
    expect(numberedLineValue(text, 3)).toBe('');
  });

  it('treats blank / dash optional lines as empty', () => {
    expect(numberedLineValue('3. -\n4. B 1 ABC', 3)).toBe('');
    expect(numberedLineValue('11. gol', 11)).toBe('');
  });
});

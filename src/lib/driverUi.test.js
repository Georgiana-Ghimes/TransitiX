import { describe, expect, it } from 'vitest';
import {
  DRIVER_MAIN_PAD_BOTTOM,
  driverFieldCls,
  driverNavBtn,
  driverNavLabel,
  driverPrimaryBtn,
} from './driverUi.js';

describe('driverUi tokens', () => {
  it('uses large touch targets and base type on fields/buttons', () => {
    expect(driverFieldCls).toMatch(/min-h-14/);
    expect(driverFieldCls).toMatch(/text-base/);
    expect(driverPrimaryBtn).toMatch(/min-h-14/);
    expect(driverPrimaryBtn).toMatch(/text-base/);
  });

  it('keeps nav labels readable (not 10px) and multi-line', () => {
    expect(driverNavLabel).toMatch(/text-xs/);
    expect(driverNavLabel).not.toMatch(/text-\[10px\]/);
    expect(driverNavLabel).toMatch(/whitespace-normal/);
    expect(driverNavBtn).toMatch(/min-h-16/);
  });

  it('reserves taller bottom inset for large nav', () => {
    expect(DRIVER_MAIN_PAD_BOTTOM).toMatch(/7rem/);
  });
});

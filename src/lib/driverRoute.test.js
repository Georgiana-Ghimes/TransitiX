import { describe, expect, it } from 'vitest';
import {
  currentStop,
  dayLabel,
  formatStopLoad,
  formatWindow,
  isStopClosed,
  routeProgress,
  shiftDay,
  stopActions,
  stopAddress,
  stopPhone,
  stopStatusMeta,
} from './driverRoute.js';

const STOPS = [
  { id: 'a', seq: 1, status: 'finalizat' },
  { id: 'b', seq: 2, status: 'sosit' },
  { id: 'c', seq: 3, status: 'planificat' },
];

describe('currentStop', () => {
  it('is the first stop not yet closed', () => {
    expect(currentStop(STOPS).id).toBe('b');
  });

  it('is nothing once every stop is closed', () => {
    expect(currentStop([{ status: 'finalizat' }, { status: 'esuat' }, { status: 'sarit' }])).toBeNull();
  });

  it('is the first stop on a fresh route', () => {
    expect(currentStop([{ id: 'x', status: 'planificat' }]).id).toBe('x');
  });
});

describe('routeProgress', () => {
  it('counts closed stops, whatever way they closed', () => {
    expect(routeProgress([
      { status: 'finalizat' }, { status: 'esuat' }, { status: 'planificat' }, { status: 'sosit' },
    ])).toEqual({ done: 2, total: 4, percent: 50 });
  });

  it('does not divide by zero on an empty route', () => {
    expect(routeProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });
});

describe('stopActions', () => {
  it('offers arrival before anything else', () => {
    expect(stopActions({ status: 'planificat' }).map((a) => a.status)).toEqual(['sosit']);
  });

  it('offers done or failed once arrived', () => {
    expect(stopActions({ status: 'sosit' }).map((a) => a.status)).toEqual(['finalizat', 'esuat']);
  });

  it('offers nothing on a closed stop — undoing is the dispatcher’s job', () => {
    expect(stopActions({ status: 'finalizat' })).toEqual([]);
    expect(stopActions({ status: 'esuat' })).toEqual([]);
    expect(stopActions(null)).toEqual([]);
  });
});

describe('isStopClosed / stopStatusMeta', () => {
  it('treats skipped as closed', () => {
    expect(isStopClosed({ status: 'sarit' })).toBe(true);
    expect(isStopClosed({ status: 'sosit' })).toBe(false);
  });

  it('falls back to the planned label for an unknown status', () => {
    expect(stopStatusMeta('ceva').label).toBe('De făcut');
    expect(stopStatusMeta('finalizat').label).toBe('Gata');
  });
});

describe('stop formatting', () => {
  it('shows only the quantities that are set', () => {
    expect(formatStopLoad({ weight_kg: 1200, pallets: 4 })).toBe('1.200 kg · 4 paleți');
    expect(formatStopLoad({ pallets: 1 })).toBe('1 palet');
    expect(formatStopLoad({ weight_kg: 0, pallets: 0 })).toBe('');
  });

  it('does not turn a missing quantity into zero', () => {
    expect(formatStopLoad({ weight_kg: null, volume_mc: null })).toBe('');
  });

  it('formats a partial delivery window', () => {
    expect(formatWindow({ window_start: '08:00:00', window_end: '12:00:00' })).toBe('08:00–12:00');
    expect(formatWindow({ window_end: '12:00' })).toBe('…–12:00');
    expect(formatWindow({})).toBe('');
  });

  it('prefers the composed address and the location phone', () => {
    expect(stopAddress({ address_full: 'str. 1, Oradea, BH', city: 'Oradea' })).toBe('str. 1, Oradea, BH');
    expect(stopAddress({ address: 'str. 1', city: 'Oradea' })).toBe('str. 1, Oradea');
    expect(stopPhone({ phone: '0733', client_phone: '0722' })).toBe('0733');
    expect(stopPhone({ client_phone: '0722' })).toBe('0722');
    expect(stopPhone({})).toBeNull();
  });
});

describe('day helpers', () => {
  it('shifts across a month boundary', () => {
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('names the days around today', () => {
    const today = new Date(2026, 7, 27);
    expect(dayLabel('2026-08-27', today)).toBe('Azi');
    expect(dayLabel('2026-08-28', today)).toBe('Mâine');
    expect(dayLabel('2026-08-26', today)).toBe('Ieri');
    expect(dayLabel('2026-09-04', today)).toBe('04.09.2026');
  });
});

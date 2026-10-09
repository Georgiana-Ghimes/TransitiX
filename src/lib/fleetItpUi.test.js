import { describe, expect, it } from 'vitest';
import {
  filterItpVehicles,
  itpExpired,
  itpStatusFor,
  summariseItpFleet,
} from './fleetItpUi.js';

describe('fleetItpUi', () => {
  const now = new Date('2026-10-08T12:00:00');

  it('classifies missing / expired / soon / ok', () => {
    expect(itpStatusFor(null, { now }).status).toBe('missing');
    expect(itpStatusFor('2026-10-01', { now, horizonDays: 30 }).status).toBe('expired');
    expect(itpStatusFor('2026-10-20', { now, horizonDays: 30 }).status).toBe('soon');
    expect(itpStatusFor('2027-01-01', { now, horizonDays: 30 }).status).toBe('ok');
  });

  it('summarises and filters the fleet', () => {
    const vehicles = [
      { id: '1', plate: 'B-1', itp_expiry: '2026-10-01', is_active: true },
      { id: '2', plate: 'B-2', itp_expiry: '2026-10-20', is_active: true },
      { id: '3', plate: 'B-3', itp_expiry: null, is_active: true },
      { id: '4', plate: 'B-4', itp_expiry: '2027-06-01', is_active: true },
      { id: '5', plate: 'B-5', itp_expiry: '2026-10-01', is_active: false },
    ];
    const opts = { now, horizonDays: 30 };
    expect(summariseItpFleet(vehicles, opts)).toEqual({
      missing: 1, expired: 1, soon: 1, ok: 1, total: 4,
    });
    expect(filterItpVehicles(vehicles, 'expired', opts).map((v) => v.id)).toEqual(['1']);
    expect(filterItpVehicles(vehicles, 'missing', opts).map((v) => v.id)).toEqual(['3']);
    expect(itpExpired('2026-10-01', now)).toBe(true);
    expect(itpExpired('2026-10-20', now)).toBe(false);
  });
});

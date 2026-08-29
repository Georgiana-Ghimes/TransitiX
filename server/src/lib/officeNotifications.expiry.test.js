import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPIRY_HORIZON_DAYS,
  expiryHorizonDays,
} from './officeNotifications.js';
import { expiryHorizonDays as clientHorizon } from '../../../src/lib/documentExpiry.js';

describe('expiryHorizonDays', () => {
  it('uses the widest threshold the company configured', () => {
    expect(expiryHorizonDays({ document_expiry_days: [30, 15, 7, 1] })).toBe(30);
    expect(expiryHorizonDays({ document_expiry_days: [7, 60] })).toBe(60);
  });

  it('falls back to 30 days when the setting is absent or unusable', () => {
    expect(expiryHorizonDays(undefined)).toBe(DEFAULT_EXPIRY_HORIZON_DAYS);
    expect(expiryHorizonDays({})).toBe(DEFAULT_EXPIRY_HORIZON_DAYS);
    expect(expiryHorizonDays({ document_expiry_days: [] })).toBe(30);
    expect(expiryHorizonDays({ document_expiry_days: ['x', 0, -5] })).toBe(30);
  });

  // The bell and the Dashboard/Documente screens are separate implementations; the counts only
  // line up as long as they read the setting the same way.
  it('agrees with the client-side helper', () => {
    for (const days of [[30, 15, 7, 1], [7, 60], [], undefined, ['x', 0]]) {
      expect(expiryHorizonDays({ document_expiry_days: days }))
        .toBe(clientHorizon({ settings: { document_expiry_days: days } }));
    }
  });
});

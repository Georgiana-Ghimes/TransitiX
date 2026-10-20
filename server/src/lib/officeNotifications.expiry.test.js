import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPIRY_HORIZON_DAYS,
  expiryHorizonDays,
  sortInboxNotifications,
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

describe('sortInboxNotifications', () => {
  it('keeps unread above read even when the read row has a newer stamp', () => {
    const now = '2026-09-06T18:00:00.000Z';
    const older = '2026-09-06T17:00:00.000Z';
    const sorted = sortInboxNotifications([
      { id: 'read-new', is_read: true, created_at: now, title: 'Medical expirat' },
      { id: 'unread-old', is_read: false, created_at: older, title: 'Permis expiră' },
      { id: 'unread-new', is_read: false, created_at: now, title: 'Tahograf expiră' },
      { id: 'read-old', is_read: true, created_at: older, title: 'Cursă nealocată' },
    ]);
    expect(sorted.map((n) => n.id)).toEqual([
      'unread-new',
      'unread-old',
      'read-new',
      'read-old',
    ]);
  });
});

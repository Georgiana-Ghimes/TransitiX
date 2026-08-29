import { describe, expect, it, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../db.js', () => ({ query: (...args) => query(...args) }));

const { notifyDriverUpload } = await import('../lib/officeNotifications.js');

describe('notifyDriverUpload', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  it('creates a bell entry for an upload without a trip', async () => {
    await notifyDriverUpload('co-1', {
      driverName: 'Ion Popescu',
      documentType: 'aviz',
      fileCount: 2,
      trip: null,
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO office_notifications/);
    expect(params[0]).toBe('co-1');
    expect(params[1]).toBe('driver_upload');
    expect(params[2]).toMatch(/2 fișiere/);
    expect(params[3]).toMatch(/fără cursă/i);
    expect(params[4]).toBe('/avize');
    expect(params[5]).toBeNull();
  });

  it('mentions the trip when one was selected', async () => {
    await notifyDriverUpload('co-1', {
      driverName: 'Ion',
      documentType: 'cmr',
      fileCount: 1,
      trip: { id: 't1', cmr_number: 'CMR-99' },
    });
    const [, params] = query.mock.calls[0];
    expect(params[3]).toMatch(/CMR-99/);
    expect(params[3]).not.toMatch(/fără cursă/i);
    expect(params[5]).toBe('t1');
    expect(params[6]).toBe('CMR-99');
  });
});

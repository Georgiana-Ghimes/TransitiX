import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { etransportConfigured, etransportMode, requestUitForRoute } from './etransport.js';

describe('etransport stub', () => {
  const prev = process.env.ETRANSPORT_MODE;

  afterEach(() => {
    if (prev == null) delete process.env.ETRANSPORT_MODE;
    else process.env.ETRANSPORT_MODE = prev;
  });

  it('defaults to stub mode', () => {
    delete process.env.ETRANSPORT_MODE;
    expect(etransportMode()).toBe('stub');
    expect(etransportConfigured()).toBe(true);
  });

  it('can be turned off', () => {
    process.env.ETRANSPORT_MODE = 'off';
    expect(etransportConfigured()).toBe(false);
  });

  it('returns a stable stub UIT for the same route', async () => {
    process.env.ETRANSPORT_MODE = 'stub';
    const route = { id: '11111111-1111-1111-1111-111111111111', route_date: '2026-08-25' };
    const a = await requestUitForRoute(route, { company: { id: 'co' } });
    const b = await requestUitForRoute(route, { company: { id: 'co' } });
    expect(a.ok).toBe(true);
    expect(a.stub).toBe(true);
    expect(a.uit_code).toMatch(/^RO[A-F0-9]{16}$/);
    expect(a.uit_code).toBe(b.uit_code);
  });
});

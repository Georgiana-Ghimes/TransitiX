import { describe, expect, it } from 'vitest';
import { hitRateLimit, rateLimit } from './rateLimit.js';

describe('hitRateLimit', () => {
  it('allows up to max hits in the window then blocks', () => {
    const store = new Map();
    expect(hitRateLimit(store, 'co', { max: 2, now: 1000 }).ok).toBe(true);
    expect(hitRateLimit(store, 'co', { max: 2, now: 1001 }).ok).toBe(true);
    const blocked = hitRateLimit(store, 'co', { max: 2, now: 1002 });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets after the window', () => {
    const store = new Map();
    hitRateLimit(store, 'co', { max: 1, windowMs: 100, now: 0 });
    expect(hitRateLimit(store, 'co', { max: 1, windowMs: 100, now: 99 }).ok).toBe(false);
    expect(hitRateLimit(store, 'co', { max: 1, windowMs: 100, now: 100 }).ok).toBe(true);
  });
});

describe('rateLimit middleware', () => {
  it('returns 429 after max requests from the same IP', () => {
    const mw = rateLimit({ max: 2, windowMs: 60_000 });
    const req = { ip: '10.0.0.1' };
    const calls = [];
    const res = {
      set: () => {},
      status: (code) => ({ json: (body) => calls.push({ code, body }) }),
    };
    mw(req, res, () => calls.push('next'));
    mw(req, res, () => calls.push('next'));
    mw(req, res, () => calls.push('next'));
    expect(calls).toEqual(['next', 'next', { code: 429, body: { message: 'Prea multe încercări. Reîncearcă mai târziu.' } }]);
  });
});

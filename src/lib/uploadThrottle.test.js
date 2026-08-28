import { describe, expect, it } from 'vitest';
import { CLIENT_UPLOAD_MAX, throttleState } from './uploadThrottle.js';

const now = 1_700_000_000_000;
const nSends = (n, at = now) => Array.from({ length: n }, () => at);

describe('throttleState', () => {
  it('lets an ordinary run of uploads through', () => {
    expect(throttleState(nSends(5), now).allowed).toBe(true);
  });

  it('trips before the server would, so the driver never sees a 429 first', () => {
    expect(CLIENT_UPLOAD_MAX).toBeLessThan(30);
    expect(throttleState(nSends(CLIENT_UPLOAD_MAX), now).allowed).toBe(false);
  });

  it('says how long the wait actually is', () => {
    // Twenty sends 40s ago: the window clears 20s from now.
    const state = throttleState(nSends(CLIENT_UPLOAD_MAX, now - 40_000), now);
    expect(state.allowed).toBe(false);
    expect(state.retryInSeconds).toBe(20);
  });

  it('forgets sends that left the window', () => {
    const state = throttleState(nSends(CLIENT_UPLOAD_MAX, now - 61_000), now);
    expect(state.allowed).toBe(true);
    expect(state.recent).toHaveLength(0);
  });

  it('never promises a wait of zero seconds', () => {
    const state = throttleState(nSends(CLIENT_UPLOAD_MAX, now - 59_999), now);
    expect(state.retryInSeconds).toBeGreaterThanOrEqual(1);
  });
});

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { HSTS_MAX_AGE, securityHeaders, trustProxySetting } from './security.js';

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });
beforeEach(() => { delete process.env.TRUST_PROXY; });

describe('trustProxySetting', () => {
  /**
   * With nothing in front, `X-Forwarded-For` is attacker-controlled text. Off is the only safe
   * default; the deployment that has a proxy says so.
   */
  it('does not believe forwarded headers unless told to', () => {
    expect(trustProxySetting()).toBe(false);
    process.env.TRUST_PROXY = '0';
    expect(trustProxySetting()).toBe(false);
    process.env.TRUST_PROXY = 'false';
    expect(trustProxySetting()).toBe(false);
  });

  it('trusts one hop when simply switched on', () => {
    process.env.TRUST_PROXY = '1';
    expect(trustProxySetting()).toBe(1);
    process.env.TRUST_PROXY = 'true';
    expect(trustProxySetting()).toBe(1);
  });

  it('passes a hop count through for a longer chain', () => {
    process.env.TRUST_PROXY = '2';
    expect(trustProxySetting()).toBe(2);
  });
});

describe('securityHeaders', () => {
  it('sends the headers that hold on any scheme', () => {
    const h = securityHeaders({ secure: false });
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('claims HSTS only once the connection is encrypted', () => {
    expect(securityHeaders({ secure: false })['Strict-Transport-Security']).toBeUndefined();
    expect(securityHeaders({ secure: true })['Strict-Transport-Security'])
      .toBe(`max-age=${HSTS_MAX_AGE}`);
  });

  it('survives a request object that says nothing', () => {
    expect(() => securityHeaders(undefined)).not.toThrow();
    expect(securityHeaders(undefined)['Strict-Transport-Security']).toBeUndefined();
  });

  /** A policy written blind would break the screen quietly; only the safe directive is set. */
  it('does not ship an untested full content policy', () => {
    expect(securityHeaders({ secure: true })['Content-Security-Policy']).not.toMatch(/script-src/);
  });
});

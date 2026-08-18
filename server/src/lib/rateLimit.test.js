import { describe, expect, it } from 'vitest';
import { rateLimit } from './rateLimit.js';

function mock(ip = '1.1.1.1') {
  const req = { ip };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  let nextCalled = 0;
  const next = () => { nextCalled += 1; };
  return { req, res, next, nextCount: () => nextCalled };
}

describe('rateLimit', () => {
  it('allows up to max then returns 429', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2 });
    const a = mock();
    limiter(a.req, a.res, a.next);
    limiter(a.req, a.res, a.next);
    expect(a.nextCount()).toBe(2);
    limiter(a.req, a.res, a.next);
    expect(a.res.statusCode).toBe(429);
    expect(a.nextCount()).toBe(2);
  });
});

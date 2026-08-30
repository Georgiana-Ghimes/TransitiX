import { describe, expect, it, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  adminRequired,
  authRequired,
  officeRequired,
  platformAdminRequired,
  signAccessToken,
  signRefreshToken,
} from './auth.js';

const TEST_SECRET = 'vitest-jwt-secret';

function mockReqRes(userHeaders = {}) {
  const req = { headers: userHeaders, user: undefined };
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
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, wasNextCalled: () => nextCalled };
}

describe('auth middleware', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.JWT_EXPIRES_IN = '1h';
  });

  it('signs access and refresh tokens', () => {
    const user = { id: 'u1', company_id: 'c1', role: 'admin', email: 'a@test.ro' };
    const access = signAccessToken(user);
    const refresh = signRefreshToken(user);
    const accessPayload = jwt.verify(access, TEST_SECRET);
    const refreshPayload = jwt.verify(refresh, TEST_SECRET);
    expect(accessPayload.sub).toBe('u1');
    expect(accessPayload.company_id).toBe('c1');
    expect(refreshPayload.type).toBe('refresh');
    expect(refreshPayload.company_id).toBe('c1');
  });

  it('authRequired rejects missing token', () => {
    const { req, res, next, wasNextCalled } = mockReqRes();
    authRequired(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(wasNextCalled()).toBe(false);
  });

  it('authRequired accepts valid bearer token', () => {
    const token = signAccessToken({ id: 'u1', company_id: 'c1', role: 'admin', email: 'a@test.ro' });
    const { req, res, next, wasNextCalled } = mockReqRes({ authorization: `Bearer ${token}` });
    authRequired(req, res, next);
    expect(wasNextCalled()).toBe(true);
    expect(req.user).toMatchObject({ id: 'u1', role: 'admin' });
  });

  it('authRequired rejects refresh token as access token', () => {
    const refresh = signRefreshToken({ id: 'u1' });
    const { req, res, next, wasNextCalled } = mockReqRes({ authorization: `Bearer ${refresh}` });
    authRequired(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(wasNextCalled()).toBe(false);
  });

  it('officeRequired allows admin and blocks drivers', () => {
    const allowed = mockReqRes();
    allowed.req.user = { role: 'admin' };
    officeRequired(allowed.req, allowed.res, allowed.next);
    expect(allowed.wasNextCalled()).toBe(true);

    const denied = mockReqRes();
    denied.req.user = { role: 'driver' };
    officeRequired(denied.req, denied.res, denied.next);
    expect(denied.res.statusCode).toBe(403);
    expect(denied.wasNextCalled()).toBe(false);
  });

  it('adminRequired allows admin and blocks dispatcher', () => {
    const allowed = mockReqRes();
    allowed.req.user = { role: 'admin' };
    adminRequired(allowed.req, allowed.res, allowed.next);
    expect(allowed.wasNextCalled()).toBe(true);

    const denied = mockReqRes();
    denied.req.user = { role: 'dispatcher' };
    adminRequired(denied.req, denied.res, denied.next);
    expect(denied.res.statusCode).toBe(403);
    expect(denied.wasNextCalled()).toBe(false);
  });

  it('officeRequired blocks platform_admin (GOD uses /platform, not tenant tools)', () => {
    const denied = mockReqRes();
    denied.req.user = { role: 'platform_admin' };
    officeRequired(denied.req, denied.res, denied.next);
    expect(denied.res.statusCode).toBe(403);
    expect(denied.wasNextCalled()).toBe(false);
  });

  it('platformAdminRequired allows only platform_admin', () => {
    const allowed = mockReqRes();
    allowed.req.user = { role: 'platform_admin' };
    platformAdminRequired(allowed.req, allowed.res, allowed.next);
    expect(allowed.wasNextCalled()).toBe(true);

    const denied = mockReqRes();
    denied.req.user = { role: 'admin' };
    platformAdminRequired(denied.req, denied.res, denied.next);
    expect(denied.res.statusCode).toBe(403);
    expect(denied.wasNextCalled()).toBe(false);
  });
});

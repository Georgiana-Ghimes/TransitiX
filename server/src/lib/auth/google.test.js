import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetGoogleCertCache, verifyGoogleIdToken } from './google.js';

const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const NOW = Date.UTC(2026, 8, 17, 12, 0, 0);
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' });

function sign(claims = {}, { kid = 'k1', key = privateKey } = {}) {
  return jwt.sign({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1081',
    email: 'Ana@Gmail.com',
    email_verified: true,
    name: 'Ana Pop',
    iat: Math.floor(NOW / 1000) - 10,
    exp: Math.floor(NOW / 1000) + 3600,
    ...claims,
  }, key, { algorithm: 'RS256', keyid: kid });
}

function certsFetch(certs = { k1: PEM }) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => certs, headers: { get: () => 'max-age=600' } };
  };
  return { fetchImpl, calls };
}

const opts = (extra = {}) => ({ clientId: CLIENT_ID, now: NOW, ...certsFetch(), ...extra });

beforeEach(() => resetGoogleCertCache());

describe('verifyGoogleIdToken', () => {
  it('returns the identity of a genuine token, address lowercased', async () => {
    const id = await verifyGoogleIdToken(sign(), opts());
    expect(id).toMatchObject({ sub: '1081', email: 'ana@gmail.com', name: 'Ana Pop' });
  });

  it('is off, not permissive, without a client id', async () => {
    await expect(verifyGoogleIdToken(sign(), opts({ clientId: null })))
      .rejects.toMatchObject({ status: 503 });
  });

  it('refuses a token meant for another application', async () => {
    await expect(verifyGoogleIdToken(sign({ aud: 'altcineva' }), opts()))
      .rejects.toMatchObject({ status: 401 });
  });

  it('refuses a token from another issuer', async () => {
    await expect(verifyGoogleIdToken(sign({ iss: 'https://evil.example' }), opts()))
      .rejects.toMatchObject({ status: 401 });
  });

  it('refuses an expired token', async () => {
    const expired = sign({ exp: Math.floor(NOW / 1000) - 60 });
    await expect(verifyGoogleIdToken(expired, opts())).rejects.toMatchObject({ status: 401 });
  });

  it('refuses a token signed by anyone but Google', async () => {
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(verifyGoogleIdToken(sign({}, { key: other }), opts()))
      .rejects.toMatchObject({ status: 401 });
  });

  it('refuses an address Google has not verified', async () => {
    await expect(verifyGoogleIdToken(sign({ email_verified: false }), opts()))
      .rejects.toMatchObject({ status: 403 });
  });

  it('refetches the certificates once for a key it has not seen', async () => {
    const { fetchImpl, calls } = certsFetch({ k1: PEM });
    await expect(verifyGoogleIdToken(sign({}, { kid: 'k2' }), { clientId: CLIENT_ID, now: NOW, fetchImpl }))
      .rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(2);
  });

  it('caches the certificates between calls', async () => {
    const { fetchImpl, calls } = certsFetch();
    await verifyGoogleIdToken(sign(), { clientId: CLIENT_ID, now: NOW, fetchImpl });
    await verifyGoogleIdToken(sign(), { clientId: CLIENT_ID, now: NOW, fetchImpl });
    expect(calls).toHaveLength(1);
  });
});

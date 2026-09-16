/**
 * Google sign-in: checking the ID token the browser receives from Google Identity Services.
 *
 * The browser's word is worth nothing, so the token is verified here: signature against Google's
 * published certificates, issuer, audience (our client id), expiry, and `email_verified`. An
 * unverified Google address proves nothing about who owns the mailbox, and letting it in would
 * hand somebody the account of whoever the address belongs to.
 *
 * Unset `GOOGLE_CLIENT_ID` means the feature is off, not "accept any audience".
 */
import jwt from 'jsonwebtoken';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v1/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export function googleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || '').trim() || null;
}

let cache = { certs: null, expiresAt: 0 };

/** Test hook: forget the cached certificates. */
export function resetGoogleCertCache() {
  cache = { certs: null, expiresAt: 0 };
}

function maxAgeMs(cacheControl) {
  const match = /max-age=(\d+)/i.exec(String(cacheControl || ''));
  return match ? Number(match[1]) * 1000 : 60 * 60 * 1000;
}

async function loadCerts(fetchImpl, now) {
  if (cache.certs && cache.expiresAt > now) return cache.certs;
  const res = await fetchImpl(CERTS_URL);
  if (!res.ok) throw googleError('Google nu a răspuns la verificare. Încearcă din nou.', 503);
  const certs = await res.json();
  cache = { certs, expiresAt: now + maxAgeMs(res.headers?.get?.('cache-control')) };
  return certs;
}

function googleError(message, status = 401) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Returns `{ sub, email, name, picture }` for a genuine token, throws with `status` otherwise.
 * `fetchImpl` and `now` exist for tests.
 */
export async function verifyGoogleIdToken(credential, {
  clientId = googleClientId(),
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  if (!clientId) throw googleError('Autentificarea cu Google nu este configurată pe server.', 503);
  const token = String(credential || '').trim();
  if (!token) throw googleError('Lipsește răspunsul de la Google. Încearcă din nou.', 400);

  const decoded = jwt.decode(token, { complete: true });
  const kid = decoded?.header?.kid;
  if (!kid) throw googleError('Răspunsul Google nu este valid.');

  let certs = await loadCerts(fetchImpl, now);
  if (!certs[kid]) {
    // Google rotates keys; a kid we have not seen may simply be newer than our cache.
    resetGoogleCertCache();
    certs = await loadCerts(fetchImpl, now);
  }
  const pem = certs[kid];
  if (!pem) throw googleError('Răspunsul Google nu este valid.');

  let payload;
  try {
    payload = jwt.verify(token, pem, {
      algorithms: ['RS256'],
      audience: clientId,
      issuer: ISSUERS,
      clockTimestamp: Math.floor(now / 1000),
    });
  } catch {
    throw googleError('Sesiunea Google a expirat sau nu este validă. Încearcă din nou.');
  }

  if (payload.email_verified !== true && payload.email_verified !== 'true') {
    throw googleError('Adresa contului Google nu este verificată de Google.', 403);
  }
  if (!payload.sub || !payload.email) throw googleError('Răspunsul Google nu conține adresa de email.');

  return {
    sub: String(payload.sub),
    email: String(payload.email).trim().toLowerCase(),
    name: String(payload.name || '').trim() || null,
    hosted_domain: payload.hd || null,
  };
}

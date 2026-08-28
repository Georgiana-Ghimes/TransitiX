/**
 * What the app has to get right when it is reachable from the internet.
 *
 * TLS itself is not terminated here and should not be: the tunnel already presents a real
 * certificate at Cloudflare's edge, and a self-signed one on the VM would be a downgrade. What
 * is missing on this side is knowing that the proxy is there, and sending the headers that only
 * mean something once the connection is encrypted.
 */

/**
 * Whether to believe `X-Forwarded-*`.
 *
 * Off by default on purpose. Trusting those headers with no proxy in front lets any client
 * claim any address, which turns `req.ip` into whatever an attacker types. Set `TRUST_PROXY=1`
 * only when something really does sit in front — the tunnel, or a reverse proxy.
 *
 * A number is passed through as the hop count, which is what you want with more than one proxy.
 */
export function trustProxySetting() {
  const raw = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false' || raw === 'off') return false;
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops > 0) return hops;
  return 1;
}

/** Six months. Long enough to be worth setting, short enough to back out of. */
export const HSTS_MAX_AGE = 15_552_000;

/**
 * The headers to send for one request.
 *
 * `Strict-Transport-Security` is only sent over HTTPS — announcing it on a plain-HTTP request
 * is meaningless, and on `localhost` it would pin a developer's browser to a scheme the dev
 * server does not speak.
 *
 * There is deliberately no full `Content-Security-Policy` here: the app loads its own bundle,
 * inline styles and blob-URL previews, so a policy written blind would break the screen quietly
 * rather than protect it. `frame-ancestors` is the part that needs no tuning.
 *
 * @param {{ secure?: boolean }} req
 */
export function securityHeaders(req) {
  const headers = {
    // Stops a browser second-guessing a declared type — the uploads route serves user files.
    'X-Content-Type-Options': 'nosniff',
    // Clickjacking: nothing here is meant to be framed. Both, because older browsers ignore CSP.
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    // Do not leak a document path to a third-party site through the referrer.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-DNS-Prefetch-Control': 'off',
  };

  if (req?.secure) {
    headers['Strict-Transport-Security'] = `max-age=${HSTS_MAX_AGE}`;
  }

  return headers;
}

/** Express middleware wrapper around `securityHeaders`. */
export function securityHeadersMiddleware(req, res, next) {
  for (const [name, value] of Object.entries(securityHeaders(req))) {
    res.setHeader(name, value);
  }
  next();
}

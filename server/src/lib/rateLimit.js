/**
 * In-process fixed window. Fine for a single API node; not a cluster limiter.
 * `store` is a Map so tests can inject a fresh one.
 */
export function hitRateLimit(store, key, { windowMs = 60_000, max = 20, now = Date.now() } = {}) {
  const k = String(key || '');
  if (!k || max < 1) return { ok: true, remaining: max };
  const bucket = store.get(k);
  if (!bucket || now - bucket.start >= windowMs) {
    store.set(k, { start: now, count: 1 });
    return { ok: true, remaining: Math.max(0, max - 1) };
  }
  if (bucket.count >= max) {
    return { ok: false, remaining: 0, retryAfterMs: Math.max(0, windowMs - (now - bucket.start)) };
  }
  bucket.count += 1;
  return { ok: true, remaining: Math.max(0, max - bucket.count) };
}

/** Express middleware (login/register). Uses the same in-process window as `hitRateLimit`. */
export function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  const store = new Map();
  return function rateLimitMiddleware(req, res, next) {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const result = hitRateLimit(store, key, { windowMs, max });
    if (!result.ok) {
      const retrySec = Math.max(1, Math.ceil((result.retryAfterMs || windowMs) / 1000));
      res.set('Retry-After', String(retrySec));
      return res.status(429).json({ message: 'Prea multe încercări. Reîncearcă mai târziu.' });
    }
    next();
  };
}

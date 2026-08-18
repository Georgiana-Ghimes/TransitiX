/** Simple in-memory sliding window. Fine for a single API process. */
export function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, keyFn } = {}) {
  const hits = new Map();

  return (req, res, next) => {
    const key = (keyFn ? keyFn(req) : req.ip) || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;
    const stamps = (hits.get(key) || []).filter((t) => t > windowStart);
    if (stamps.length >= max) {
      return res.status(429).json({ message: 'Too many attempts. Try again later.' });
    }
    stamps.push(now);
    hits.set(key, stamps);
    next();
  };
}

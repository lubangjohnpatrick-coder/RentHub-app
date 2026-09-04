'use strict';

// Lightweight in-process rate limiting for abuse resistance. This is defense in
// depth for the current single-service deployment; an edge/distributed limiter
// should replace or supplement it if the app scales to multiple instances.
function createLimiter({ windowMs, max, keyPrefix = 'api' }) {
  const buckets = new Map();
  let lastSweep = 0;

  return function rateLimit(req, res, next) {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      lastSweep = now;
      for (const [key, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(key);
      }
    }

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests. Please try again shortly.', request_id: req.requestId });
    }
    next();
  };
}

const apiRateLimit = createLimiter({ windowMs: 60 * 1000, max: 300, keyPrefix: 'api' });
const authRateLimit = createLimiter({ windowMs: 5 * 60 * 1000, max: 80, keyPrefix: 'auth' });

module.exports = { createLimiter, apiRateLimit, authRateLimit };

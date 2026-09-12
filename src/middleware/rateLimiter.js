'use strict';

/**
 * Minimal in-memory fixed-window rate limiter (dependency-free).
 * Suitable for a single-instance deployment; swap for Redis-backed
 * limiting when horizontally scaled.
 */

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const MAX = Number(process.env.RATE_LIMIT_MAX) || 30;

const hits = new Map(); // ip -> { count, resetAt }

// Periodically evict stale buckets so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) {
    if (rec.resetAt <= now) hits.delete(ip);
  }
}, WINDOW_MS).unref();

module.exports = function rateLimiter(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let rec = hits.get(ip);

  if (!rec || rec.resetAt <= now) {
    rec = { count: 0, resetAt: now + WINDOW_MS };
    hits.set(ip, rec);
  }

  rec.count += 1;
  const remaining = Math.max(0, MAX - rec.count);
  res.setHeader('X-RateLimit-Limit', String(MAX));
  res.setHeader('X-RateLimit-Remaining', String(remaining));

  if (rec.count > MAX) {
    const retryAfter = Math.ceil((rec.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'rate_limited',
      message: 'Too many requests. Please slow down.',
    });
  }

  next();
};

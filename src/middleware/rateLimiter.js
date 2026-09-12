'use strict';

/**
 * Minimal in-memory fixed-window rate limiting (dependency-free).
 *
 * Two buckets, because two different things are being protected:
 *
 *   - The API generally, against a client stuck in a loop. The desk polls every
 *     few seconds across several endpoints and a page load makes a handful of
 *     calls, so this has to be generous enough that ordinary use never reaches
 *     it — a limit that stops staff working is not a security control.
 *   - Public tracking, against someone walking the tracking-number space. A
 *     person types one number at a time; nothing legitimate needs a burst.
 *
 * Suitable for a single instance; swap for a Redis-backed limiter when this is
 * horizontally scaled, since each instance counts only what it sees.
 */

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const MAX = Number(process.env.RATE_LIMIT_MAX) || 240;
const TRACK_MAX = Number(process.env.RATE_LIMIT_TRACK_MAX) || 30;

/**
 * @param {{max?: number, windowMs?: number, message?: string}} options
 */
function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || WINDOW_MS;
  const max = options.max || MAX;
  const message = options.message || 'Too many requests. Please slow down.';

  const hits = new Map(); // ip -> { count, resetAt }

  // Periodically evict stale buckets so the map does not grow unbounded.
  setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of hits) {
      if (rec.resetAt <= now) hits.delete(ip);
    }
  }, windowMs).unref();

  return function rateLimiter(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let rec = hits.get(ip);

    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(ip, rec);
    }

    rec.count += 1;
    const remaining = Math.max(0, max - rec.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (rec.count > max) {
      const retryAfter = Math.ceil((rec.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'rate_limited', message });
    }

    return next();
  };
}

/** The general API limiter. */
const apiLimiter = createRateLimiter();

/** Public tracking lookups: tighter, and its own count. */
const trackLimiter = createRateLimiter({
  max: TRACK_MAX,
  message: 'Too many tracking lookups from this address. Wait a minute and try again.',
});

module.exports = apiLimiter;
module.exports.createRateLimiter = createRateLimiter;
module.exports.apiLimiter = apiLimiter;
module.exports.trackLimiter = trackLimiter;

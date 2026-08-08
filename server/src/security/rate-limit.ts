import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref?.();

export function rateLimit(
  options: { windowMs?: number; max?: number; scope?: string } = {},
) {
  const windowMs = options.windowMs ?? env.RATE_LIMIT_WINDOW_MS;
  const max = options.max ?? env.RATE_LIMIT_MAX;
  const scope = options.scope ?? 'global';

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = `${scope}:${ip}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(max - 1));
      return next();
    }

    if (bucket.count >= max) {
      logger.warn('rate_limit_exceeded', { scope, ip, count: bucket.count });
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: 'rate_limited', message: 'Too many requests' });
      return;
    }

    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(max - bucket.count));
    next();
  };
}

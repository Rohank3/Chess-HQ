import { Router } from 'express';
import { ping } from '../db/health.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const db = await ping();
  const ok = db;
  res.status(db ? 200 : 503).json({
    status: ok ? ('ok' as const) : ('degraded' as const),
    uptime: process.uptime(),
    timestamp: Date.now(),
    database: db ? 'up' : 'down',
  });
});

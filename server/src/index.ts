import { createServer } from 'node:http';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Server } from 'socket.io';
import { env, isProduction } from './config/env.js';
import { logger } from './utils/logger.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { statsRouter } from './routes/stats.js';
import { challengesRouter } from './routes/challenges.js';
import { createSocketLayer } from './sockets/index.js';
import { runMigrations } from './db/migrate.js';

const app = express();

// Render sits behind exactly one trusted proxy hop; on localhost there's no
// proxy. Setting this from env lets `req.ip` resolve to the real client
// address (out of X-Forwarded-For) so the per-IP rate-limit buckets aren't
// all clumped on the proxy's single address. Must be set before any
// middleware that reads `req.ip`.
app.set('trust proxy', env.TRUST_PROXY_HOPS);

// Helmet with an explicit, tightened CSP rather than the defaults. The
// client is a Vite production bundle (hashed, same-origin external script)
// so scriptSrc is locked to 'self' with no 'unsafe-inline'/'unsafe-eval'.
// styleSrc allows 'unsafe-inline' because Tailwind v4 injects a runtime
// <style> block in dev and an inlined critical-CSS block in the prod build
// (Tailwind v4 doesn't emit linkable stylesheets for utilities). No inline
// scripts exist in index.html (verified), so no script exception is
// needed. frameAncestors/objectSrc/baseUri are locked hard.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        // connectSrc allows the browser to fetch/ws to same origin (the
        // API) plus the configured CLIENT_ORIGIN (the browser's own origin
        // for cross-origin fetch+ws in prod where API and client split
        // hosts). http:/https:/ws:/wss: protocols are listed so the
        // directive holds in dev (http/ws) and prod (https/wss).
        connectSrc: ["'self'", env.CLIENT_ORIGIN, 'http:', 'https:', 'ws:', 'wss:'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
  }),
);
app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
);
app.use(express.json({ limit: '64kb' }));

app.use((req: Request, res: Response, next: NextFunction) => {
  // Honor an inbound X-Request-Id if present and well-formed (so a proxy or
  // upstream can propagate a trace id); otherwise mint a fresh UUID. The
  // identifier is mirrored into the response's X-Request-Id header so a
  // client reporting an incident gives us a correlatable id without having
  // to grep by timestamp.
  const inbound = req.headers['x-request-id'];
  const id =
    typeof inbound === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(inbound)
      ? inbound
      : crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
});

app.use('/api', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/stats', statsRouter);
app.use('/api/challenges', challengesRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const error = err as {
    message?: string;
    status?: number;
    code?: string;
    publicMessage?: string;
    stack?: string;
  };
  const status = error.status ?? 500;
  const isOperational = typeof error.status === 'number' && status >= 400 && status < 500;
  logger.error('unhandled_error', {
    requestId: req.id,
    status,
    code: error.code,
    message: error.message,
    isOperational,
    stack: isProduction && !isOperational ? undefined : error.stack,
  });
  // In production, never leak internal error codes (e.g. Postgres
  // '42P01') or raw messages to the client — only operational errors
  // (4xx HttpErrors) carry safe public codes/messages.
  res.status(status).json({
    error: isProduction && !isOperational ? 'internal_error' : (error.code ?? 'internal_error'),
    message: isProduction ? error.publicMessage : (error.publicMessage ?? error.message),
  });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: env.CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: 12_000,
  pingTimeout: 10_000,
  connectTimeout: 10_000,
  maxHttpBufferSize: 1e5,
});

createSocketLayer(io);

// Apply migrations before listening. The Render start command already
// prepends db:migrate, but a recycled/empty database (Render can
// re-provision the free Postgres) would otherwise leave the app serving 500s
// ("relation users does not exist") until the next redeploy. Running the
// idempotent runner here makes every boot self-healing; a failure crashes
// the process so Render surfaces it instead of serving errors.
await runMigrations();

httpServer.listen(env.PORT, () => {
  logger.info('server_listening', { port: env.PORT, env: env.NODE_ENV });
});

export { app, httpServer, io };

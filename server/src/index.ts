import { createServer } from 'node:http';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env, isProduction } from './config/env.js';
import { logger } from './utils/logger.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
);
app.use(express.json({ limit: '64kb' }));

app.use((req: Request, _res: Response, next: NextFunction) => {
  req.id = crypto.randomUUID();
  next();
});

app.use('/api', healthRouter);
app.use('/api/auth', authRouter);

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
  res.status(status).json({
    error: error.code ?? 'internal_error',
    message: isProduction ? error.publicMessage : (error.publicMessage ?? error.message),
  });
});

const httpServer = createServer(app);

httpServer.listen(env.PORT, () => {
  logger.info('server_listening', { port: env.PORT, env: env.NODE_ENV });
});

export { app, httpServer };

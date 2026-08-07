import { createServer } from 'node:http';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env, isProduction } from './config/env.js';
import { logger } from './utils/logger.js';
import { healthRouter } from './routes/health.js';

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

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const error = err as {
    message?: string;
    status?: number;
    code?: string;
    stack?: string;
  };
  logger.error('unhandled_error', {
    message: error.message,
    stack: isProduction ? undefined : error.stack,
  });
  res.status(error.status ?? 500).json({
    error: error.code ?? 'internal_error',
    message: isProduction ? undefined : error.message,
  });
});

const httpServer = createServer(app);

httpServer.listen(env.PORT, () => {
  logger.info('server_listening', { port: env.PORT, env: env.NODE_ENV });
});

export { app, httpServer };

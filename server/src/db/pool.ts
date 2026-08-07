import { Pool, type PoolConfig } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const config: PoolConfig = {
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: `chess-hq-${env.NODE_ENV}`,
};

export const pool = new Pool(config);

pool.on('error', (err) => {
  logger.error('db_pool_error', { message: err.message });
});

pool.on('connect', (client) => {
  client.on('error', (err) => {
    logger.error('db_client_error', { message: err.message });
  });
});

export type { Pool };

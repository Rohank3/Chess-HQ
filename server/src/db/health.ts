import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

export async function ping(): Promise<boolean> {
  try {
    const result = await pool.query<{ ok?: number }>('SELECT 1 AS ok');
    return result.rows.length === 1;
  } catch (err) {
    logger.error('db_ping_failed', { message: (err as Error).message });
    return false;
  }
}

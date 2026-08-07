import { pool, type Pool } from './pool.js';

export type DbClient = Pick<Pool, 'query'>;

export async function withTransaction<T>(
  fn: (client: DbClient) => Promise<T>,
  options: { readOnly?: boolean } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(options.readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // original error must propagate, but we log the rollback failure for triage
      console.error('ROLLBACK_FAILED', (rollbackErr as Error).message);
    }
    throw err;
  } finally {
    client.release();
  }
}

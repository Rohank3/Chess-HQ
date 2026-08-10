import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

const here = dirname(fileURLToPath(import.meta.url));
// Resolve from the server root so the runner works both from source (tsx:
// <server>/src/db/migrate.ts) and from the compiled output (node:
// <server>/dist/db/migrate.js). tsc never copies the *.sql files into dist/,
// so a module-relative lookup would point at dist/db/migrations and crash
// with ENOENT in production.
const serverRoot = resolve(here, '..', '..');
const migrationsDir = resolve(serverRoot, 'src/db/migrations');

const ENSURE_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id          text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
  );
`;

const listMigrationFiles = (dir: string): { id: string; path: string }[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ id: f, path: resolve(dir, f) }));

export async function runMigrations(
  options: { dryRun?: boolean } = {},
): Promise<{ applied: string[]; skipped: string[] }> {
  const applied: string[] = [];
  const skipped: string[] = [];

  const files = listMigrationFiles(migrationsDir);
  const client = await pool.connect();
  try {
    await client.query(ENSURE_TABLE);
    const seen = new Set<string>();
    const result = await client.query<{ id: string }>(
      'SELECT id FROM _migrations ORDER BY id ASC',
    );
    for (const row of result.rows) seen.add(row.id);

    for (const file of files) {
      if (seen.has(file.id)) {
        logger.info('migration_skipped', { id: file.id });
        skipped.push(file.id);
        continue;
      }
      if (options.dryRun) {
        logger.info('migration_dry_run', { id: file.id });
        continue;
      }

      const sql = readFileSync(file.path, 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (id) VALUES ($1)', [file.id]);
        await client.query('COMMIT');
        logger.info('migration_applied', { id: file.id });
        applied.push(file.id);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error('migration_failed', { id: file.id, error: (err as Error).message });
        throw err;
      }
    }
  } finally {
    client.release();
  }

  return { applied, skipped };
}

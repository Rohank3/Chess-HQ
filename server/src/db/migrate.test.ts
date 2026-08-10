import nodeTest, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, 'migrations/001_init.sql');
const nullableTerminationPath = resolve(here, 'migrations/002_games_termination_nullable.sql');

nodeTest(
  '002 makes games.termination nullable so active-game INSERTs succeed',
  async (_t: TestContext) => {
    const sql = readFileSync(nullableTerminationPath, 'utf8');
    assert.ok(
      sql.includes('ALTER TABLE games ALTER COLUMN termination DROP NOT NULL'),
      '002 must drop the NOT NULL on games.termination (createGame inserts active games without it)',
    );
  },
);

nodeTest(
  'the SQL DDL in 001_init.sql contains all required invariants',
  async (_t: TestContext) => {
    const sql = readFileSync(migrationPath, 'utf8');
    assert.ok(
      sql.includes('CREATE TABLE IF NOT EXISTS users'),
      'users table must be created',
    );
    assert.ok(
      sql.includes('CREATE TABLE IF NOT EXISTS games'),
      'games table must be created',
    );
    assert.ok(
      sql.includes('users_auth_xor'),
      'guest vs persistent auth invariant must exist',
    );
    assert.ok(
      sql.includes('games_winner_termination_agree'),
      'winner/termination agreement invariant must exist',
    );
    assert.ok(
      sql.includes('games_active_white_idx'),
      'active-games index for white must exist (reconnect path)',
    );
    assert.ok(
      sql.includes('games_active_black_idx'),
      'active-games index for black must exist (reconnect path)',
    );
    assert.ok(
      sql.includes('gen_random_uuid()'),
      'UUIDs must be generated server-side, never client-supplied',
    );
  },
);

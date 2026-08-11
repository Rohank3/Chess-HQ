import nodeTest, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, 'migrations/001_init.sql');
const nullableTerminationPath = resolve(here, 'migrations/002_games_termination_nullable.sql');
const friendshipsPath = resolve(here, 'migrations/003_friendships.sql');
const emailVerificationPath = resolve(here, 'migrations/004_email_verification.sql');
const emailCasePath = resolve(here, 'migrations/005_email_case_normalization.sql');

nodeTest(
  '003 creates the friendships table with a symmetric pair-unique index',
  async (_t: TestContext) => {
    const sql = readFileSync(friendshipsPath, 'utf8');
    assert.ok(
      sql.includes('CREATE TABLE IF NOT EXISTS friendships'),
      'friendships table must be created',
    );
    assert.ok(
      sql.includes("status IN ('pending', 'accepted')"),
      'friendship status must be pending/accepted',
    );
    assert.ok(
      sql.includes('friendships_pair_unique') &&
        sql.includes('LEAST(requester_id, addressee_id)') &&
        sql.includes('GREATEST(requester_id, addressee_id)'),
      'one row per unordered pair via the LEAST/GREATEST unique expression index',
    );
  },
);

nodeTest(
  '004 adds email-verification state and requires email for registered users',
  async (_t: TestContext) => {
    const sql = readFileSync(emailVerificationPath, 'utf8');
    assert.ok(
      sql.includes('email_verified_at') &&
        sql.includes('verify_token_hash') &&
        sql.includes('reset_token_hash'),
      'verification + reset token state columns must be added',
    );
    assert.ok(
      sql.includes('users_email_required') &&
        sql.includes('CHECK (is_guest = TRUE OR email IS NOT NULL) NOT VALID'),
      'registered users must carry an email, guests exempt, legacy rows untouched',
    );
  },
);

nodeTest(
  '005 normalizes email casing and enforces case-insensitive uniqueness',
  async (_t: TestContext) => {
    const sql = readFileSync(emailCasePath, 'utf8');
    assert.ok(
      sql.includes('users_email_lower_idx') && sql.includes('LOWER(email)'),
      'a unique index on LOWER(email) must enforce case-insensitive uniqueness',
    );
    assert.ok(
      sql.includes('discarded-'),
      'case-duplicate losers must be moved to a synthetic placeholder email',
    );
    assert.ok(
      sql.includes('email_verified_at IS NOT NULL') && sql.includes('created_at DESC'),
      'the kept row must be the verified one, else the newest',
    );
  },
);

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

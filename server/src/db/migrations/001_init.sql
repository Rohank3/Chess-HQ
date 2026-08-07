-- 001_init.sql — initial schema for Chess-HQ
-- Tables: users, games. Designed for the Elo + matchmaking + game-history read patterns
-- the rest of the app uses.
--
-- Conventions:
--   * All primary keys are uuid DEFAULT gen_random_uuid() (Postgres 13+ builtin).
--   * All timestamps are timestamptz, stored as UTC.
--   * Snake_case column names so SQL stays readable without quoting.
--   * Foreign keys stay ON DELETE RESTRICT for entities we want to preserve (history)
--     and ON DELETE CASCADE only for derived/board-state tables (none in this migration).

-- pgcrypto is pre-installed on managed providers (Render Postgres, Supabase, RDS).
-- gen_random_uuid() is also built into core Postgres 13+ so this CREATE EXTENSION is
-- belt-and-braces for older self-hosted instances.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- users --
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE
                  CHECK (char_length(username) BETWEEN 3 AND 24
                         AND username ~ '^[A-Za-z0-9_-]+$'),
  email         text NULL UNIQUE
                  CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  password_hash text NULL,
  is_guest      boolean NOT NULL DEFAULT FALSE,

  elo           integer NOT NULL DEFAULT 1200
                  CHECK (elo >= 100 AND elo <= 4000),
  games_played  integer NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  wins          integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses        integer NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws         integer NOT NULL DEFAULT 0 CHECK (draws >= 0),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- A guest account is the "play as guest" ephemeral identity: it has no
  -- password and no email but still occupies the users.role pool for Elo.
  -- A persistent account must have a password_hash; guests must not.
  CONSTRAINT users_auth_xor
    CHECK ((is_guest = TRUE  AND password_hash IS NULL)
        OR (is_guest = FALSE AND password_hash IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS users_elo_idx ON users(elo);
CREATE INDEX IF NOT EXISTS users_username_lower_idx
  ON users(LOWER(username));

-- A drop function in case we re-run; updated_at is the only piece we keep
-- touched trigger on (the rest of the ints are bumped by application code in tx).
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_touch_updated_at ON users;
CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------- games --
-- A games row covers the full lifetime: created at matchmaking, mutated per move
-- (fens / moves[]), closed at game-over with winner + termination + Elo deltas.
-- One row per game, not a move-log table; move history lives in moves[] and pgn.
CREATE TABLE IF NOT EXISTS games (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  white_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  black_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  white_elo_before integer NULL CHECK (white_elo_before IS NULL
                                       OR (white_elo_before >= 100 AND white_elo_before <= 4000)),
  black_elo_before integer NULL CHECK (black_elo_before IS NULL
                                       OR (black_elo_before >= 100 AND black_elo_before <= 4000)),
  white_elo_after  integer NULL CHECK (white_elo_after IS NULL
                                       OR (white_elo_after >= 100 AND white_elo_after <= 4000)),
  black_elo_after  integer NULL CHECK (black_elo_after IS NULL
                                       OR (black_elo_after <= 4000)),

  -- winner NULL = draw (the CHECK below constrains to the two players or null).
  winner          uuid NULL
                    CHECK (winner IS NULL OR winner = white_user_id OR winner = black_user_id),
  termination     text NOT NULL CHECK (termination IN (
                    'checkmate', 'stalemate',
                    'draw_threefold', 'draw_fiftymove', 'draw_insufficient',
                    'draw_agreed', 'resignation', 'timeout', 'aborted')),

  -- The authoritative SAN move list; pgn is the derived archive form.
  moves           text[] NOT NULL DEFAULT '{}',
  pgn             text NULL,
  fen             text NOT NULL
                    DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',

  -- Structured time-control so matchmaking can match by cadence.
  time_control    text NOT NULL CHECK (time_control IN
                    ('bullet', 'blitz', 'rapid', 'classical', 'custom')),
  initial_ms      integer NOT NULL CHECK (initial_ms > 0),
  increment_ms    integer NOT NULL DEFAULT 0 CHECK (increment_ms >= 0),

  -- Live clock during play; (white_ms, black_ms, last_move_at) is the snapshot
  -- the server broadcasts to clients. last_move_at is null until the first move.
  white_ms        integer NOT NULL,
  black_ms        integer NOT NULL,
  last_move_at    timestamptz NULL,

  -- Draw offer protocol server-side validated: only one outstanding offer at a
  -- time; offered_by must be one of the two players; expires_at lets the
  -- watchdog reap stale offers.
  draw_offered_by uuid NULL
                    CHECK (draw_offered_by IS NULL
                           OR draw_offered_by = white_user_id
                           OR draw_offered_by = black_user_id),
  draw_offer_expires_at timestamptz NULL

                    CHECK (draw_offer_expires_at IS NULL
                           OR (draw_offered_by IS NOT NULL
                               AND draw_offer_expires_at >= started_at)),

  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Elo snapshot before play is only meaningful if both players had it at game
  -- start. After the game both white_elo_after and black_elo_after are set
  -- together (the Elo transaction updates them atomically).
  CONSTRAINT games_elo_before_consistency
    CHECK ((white_elo_before IS NULL) = (black_elo_before IS NULL)),
  CONSTRAINT games_elo_after_consistency
    CHECK (ended_at IS NULL
           OR ((white_elo_after IS NULL) = (black_elo_after IS NULL))),
  -- Once the game has ended, winner + termination must agree.
  -- (timeout/resignation/checkmate imply non-null winner; draws imply null)
  CONSTRAINT games_winner_termination_agree
    CHECK (
      (ended_at IS NULL)
      OR (winner IS NULL  AND termination IN
          ('stalemate', 'draw_threefold', 'draw_fiftymove',
           'draw_insufficient', 'draw_agreed', 'aborted'))
      OR (winner IS NOT NULL AND termination IN
          ('checkmate', 'resignation', 'timeout'))
    ),
  CONSTRAINT users_distinct CHECK (white_user_id <> black_user_id)
);

-- Indexes targeted at the query patterns we actually issue:
--  - Active games for a user, by colour (join-room-on-reconnect in step 6)
CREATE INDEX IF NOT EXISTS games_active_white_idx
  ON games(white_user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS games_active_black_idx
  ON games(black_user_id) WHERE ended_at IS NULL;

--  - Match history "my last N games" (most recent first)
CREATE INDEX IF NOT EXISTS games_history_white_idx
  ON games(ended_at DESC) WHERE white_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS games_history_black_idx
  ON games(ended_at DESC) WHERE black_user_id IS NOT NULL;

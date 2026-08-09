import { pool } from '../db/pool.js';
import { withTransaction, type DbClient } from '../db/client.js';
import { applyElo, type EloInput } from './elo.js';
import { logger } from '../utils/logger.js';

export interface CreateGameInput {
  whiteUserId: string;
  blackUserId: string;
  whiteEloBefore: number;
  blackEloBefore: number;
  timeControl: string;
  initialMs: number;
  incrementMs: number;
}

/**
 * Game row mapped to camelCase. The DB column names are snake_case
 * (white_user_id, black_user_id, time_control, ...); pg returns rows keyed
 * by the SQL column name, so callers must not pretend row.whiteUserId exists
 * on a freshly-fetched row. The `RawGameRow` type below is the literal DB
 * shape; `GameRow` is the mapped, caller-friendly shape. The two stay
 * aligned through `mapGameRow`.
 */
export interface GameRow {
  id: string;
  whiteUserId: string;
  blackUserId: string;
  whiteEloBefore: number | null;
  blackEloBefore: number | null;
  whiteEloAfter: number | null;
  blackEloAfter: number | null;
  winner: string | null;
  termination: string;
  moves: string[];
  pgn: string | null;
  fen: string;
  timeControl: string;
  initialMs: number;
  incrementMs: number;
  whiteMs: number;
  blackMs: number;
  lastMoveAt: string | null;
  drawOfferedBy: string | null;
  drawOfferExpiresAt: string | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
}

/** Raw Postgres row: snake_case keys, matching the column names exactly. */
interface RawGameRow {
  id: string;
  white_user_id: string;
  black_user_id: string;
  white_elo_before: number | null;
  black_elo_before: number | null;
  white_elo_after: number | null;
  black_elo_after: number | null;
  winner: string | null;
  termination: string;
  moves: string[];
  pgn: string | null;
  fen: string;
  time_control: string;
  initial_ms: number;
  increment_ms: number;
  white_ms: number;
  black_ms: number;
  last_move_at: string | null;
  draw_offered_by: string | null;
  draw_offer_expires_at: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

const SELECT_COLUMNS = `
  id, white_user_id, black_user_id,
  white_elo_before, black_elo_before,
  white_elo_after, black_elo_after,
  winner, termination, moves, pgn, fen,
  time_control, initial_ms, increment_ms,
  white_ms, black_ms, last_move_at,
  draw_offered_by, draw_offer_expires_at,
  started_at, ended_at, created_at
`;

function mapGameRow(row: RawGameRow): GameRow {
  return {
    id: row.id,
    whiteUserId: row.white_user_id,
    blackUserId: row.black_user_id,
    whiteEloBefore: row.white_elo_before,
    blackEloBefore: row.black_elo_before,
    whiteEloAfter: row.white_elo_after,
    blackEloAfter: row.black_elo_after,
    winner: row.winner,
    termination: row.termination,
    moves: row.moves,
    pgn: row.pgn,
    fen: row.fen,
    timeControl: row.time_control,
    initialMs: row.initial_ms,
    incrementMs: row.increment_ms,
    whiteMs: row.white_ms,
    blackMs: row.black_ms,
    lastMoveAt: row.last_move_at,
    drawOfferedBy: row.draw_offered_by,
    drawOfferExpiresAt: row.draw_offer_expires_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

export async function createGame(input: CreateGameInput): Promise<GameRow> {
  const result = await pool.query<RawGameRow>(
    `INSERT INTO games (
       white_user_id, black_user_id,
       white_elo_before, black_elo_before,
       time_control, initial_ms, increment_ms,
       white_ms, black_ms
     )
     VALUES ($1, $2, $3, $4, $5::text, $6, $7, $8, $8)
     RETURNING ${SELECT_COLUMNS}`,
    [
      input.whiteUserId,
      input.blackUserId,
      input.whiteEloBefore,
      input.blackEloBefore,
      input.timeControl,
      input.initialMs,
      input.incrementMs,
      input.initialMs,
    ],
  );

  const row = result.rows[0]!;
  logger.info('game_created', {
    gameId: row.id,
    white: input.whiteUserId,
    black: input.blackUserId,
    timeControl: input.timeControl,
  });
  return mapGameRow(row);
}

/** Throw if the row is missing -- callers want a hard failure on a vanished game. */
export async function getGame(gameId: string): Promise<GameRow> {
  const result = await pool.query<RawGameRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM games
     WHERE id = $1`,
    [gameId],
  );
  const row = result.rows[0];
  if (!row) throw new GameNotFoundError(gameId);
  return mapGameRow(row);
}

export class GameNotFoundError extends Error {
  constructor(gameId: string) {
    super(`game not found: ${gameId}`);
    this.name = 'GameNotFoundError';
  }
}

/**
 * Record a draw offer: sets draw_offered_by to the offerer and
 * draw_offer_expires_at to now + ttlMs. The schema's
 * games_draw_offer_expires_at CHECK requires the offerer to be set when
 * the expiry is set, so the two columns are always written together.
 */
export async function setDrawOffer(
  gameId: string,
  offererUserId: string,
  ttlMs: number,
): Promise<GameRow> {
  const result = await pool.query<RawGameRow>(
    `UPDATE games SET
       draw_offered_by = $2,
       draw_offer_expires_at = now() + ($3::bigint || ' milliseconds')::interval
     WHERE id = $1 AND ended_at IS NULL
     RETURNING ${SELECT_COLUMNS}`,
    [gameId, offererUserId, ttlMs],
  );
  const row = result.rows[0];
  if (!row) throw new GameNotFoundError(gameId);
  return mapGameRow(row);
}

/**
 * Clear any pending draw offer (used on decline, and also on the next
 * move: a draw offer doesn't survive the opponent moving -- once they
 * move, they've effectively declined). Safe to call when no offer is
 * outstanding (no-op UPDATE).
 */
export async function clearDrawOffer(gameId: string): Promise<GameRow> {
  const result = await pool.query<RawGameRow>(
    `UPDATE games SET
       draw_offered_by = NULL,
       draw_offer_expires_at = NULL
     WHERE id = $1 AND ended_at IS NULL
     RETURNING ${SELECT_COLUMNS}`,
    [gameId],
  );
  const row = result.rows[0];
  if (!row) throw new GameNotFoundError(gameId);
  return mapGameRow(row);
}

export interface RecordMoveInput {
  gameId: string;
  fen: string;
  san: string;
  whiteMs: number;
  blackMs: number;
  lastMoveAt: Date;
}

/**
 * Persist one move: appends SAN to the text[] moves column, updates the
 * live clock columns, and advances the FEN snapshot. Single UPDATE -- no
 * transaction needed since this is one atomic statement.
 */
export async function recordMove(input: RecordMoveInput): Promise<GameRow> {
  const result = await pool.query<RawGameRow>(
    `UPDATE games SET
       moves = array_append(moves, $2::text),
       fen = $3,
       white_ms = $4,
       black_ms = $5,
       last_move_at = $6
     WHERE id = $1 AND ended_at IS NULL
     RETURNING ${SELECT_COLUMNS}`,
    [input.gameId, input.san, input.fen, input.whiteMs, input.blackMs, input.lastMoveAt],
  );
  const row = result.rows[0];
  if (!row) throw new GameNotFoundError(input.gameId);
  return mapGameRow(row);
}

export type Termination =
  | 'checkmate'
  | 'stalemate'
  | 'draw_threefold'
  | 'draw_fiftymove'
  | 'draw_insufficient'
  | 'draw_agreed'
  | 'resignation'
  | 'timeout'
  | 'aborted';

export interface EndGameInput {
  gameId: string;
  /** Winner's user id, or null for a draw. */
  winnerUserId: string | null;
  termination: Termination;
}

interface PlayerStatRow {
  id: string;
  elo: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
}

/**
 * The end-of-game transaction. Atomically:
 *   1. settles the games row (winner, termination, elo_after_* snapshots,
 *      ended_at, draw-offer cols cleared),
 *   2. recomputes and writes each player's Elo + games_played + w/l/d
 *      counters in the users table.
 *
 * The elo_after-vs-users.elo invariant is the schema's
 * games_elo_before_consistency / games_elo_after_consistency pair, and the
 * pairing that matters most for the dashboard's delta display. Winning must
 * persist BOTH the games snapshot AND the user's live rating, otherwise a
 * refresh after game-over would show the new Elo but the old match row
 * (or vice-versa). The transaction guarantees one-or-the-other-never.
 *
 * Both player rows are SELECTed ... FOR UPDATE inside this transaction, so
 * two games ending on the same user simultaneously cannot race each other
 * to a stale Elo read. If the game is already ended when this runs (e.g.
 * the clock watchdog and a resign fire concurrently), the persisted row is
 * returned untouched -- first-writer-wins, no double Elo application.
 */
export async function endGame(input: EndGameInput): Promise<GameRow> {
  return withTransaction(async (client) => {
    const game = await getGameForUpdate(client, input.gameId);

    if (game.endedAt !== null) {
      logger.info('endGame_skip_already_ended', { gameId: input.gameId });
      return game;
    }

    const white = await loadPlayerStats(client, game.whiteUserId);
    const black = await loadPlayerStats(client, game.blackUserId);

    // Score is from White's perspective: 1 = White wins, 0.5 = draw,
    // 0 = Black wins.
    let scoreWhite: number;
    if (input.winnerUserId === null) {
      scoreWhite = 0.5;
    } else if (input.winnerUserId === game.whiteUserId) {
      scoreWhite = 1;
    } else if (input.winnerUserId === game.blackUserId) {
      scoreWhite = 0;
    } else {
      throw new Error(
        `endGame: winner ${input.winnerUserId} is not a player in game ${input.gameId}`,
      );
    }

    const eloInput: EloInput = {
      ratingA: white.elo,
      ratingB: black.elo,
      gamesPlayedA: white.games_played,
      gamesPlayedB: black.games_played,
      scoreA: scoreWhite,
    };
    const outcome = applyElo(eloInput);

    await client.query(
      `UPDATE games SET
         winner = $2,
         termination = $3::text,
         white_elo_after = $4,
         black_elo_after = $5,
         ended_at = now(),
         draw_offered_by = NULL,
         draw_offer_expires_at = NULL
       WHERE id = $1`,
      [
        input.gameId,
        input.winnerUserId,
        input.termination,
        Math.round(outcome.ratingA),
        Math.round(outcome.ratingB),
      ],
    );

    await applyUserStats(client, game.whiteUserId, {
      elo: Math.round(outcome.ratingA),
      gamesPlayed: outcome.gamesPlayedA,
      wins: white.wins + (scoreWhite === 1 ? 1 : 0),
      losses: white.losses + (scoreWhite === 0 ? 1 : 0),
      draws: white.draws + (scoreWhite === 0.5 ? 1 : 0),
    });
    await applyUserStats(client, game.blackUserId, {
      elo: Math.round(outcome.ratingB),
      gamesPlayed: outcome.gamesPlayedB,
      wins: black.wins + (scoreWhite === 0 ? 1 : 0),
      losses: black.losses + (scoreWhite === 1 ? 1 : 0),
      draws: black.draws + (scoreWhite === 0.5 ? 1 : 0),
    });

    logger.info('game_ended', {
      gameId: input.gameId,
      termination: input.termination,
      winner: input.winnerUserId,
      whiteEloBefore: white.elo,
      blackEloBefore: black.elo,
      whiteEloAfter: Math.round(outcome.ratingA),
      blackEloAfter: Math.round(outcome.ratingB),
    });

    return getGameForUpdate(client, input.gameId);
  });
}

interface UserStatUpdate {
  elo: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
}

async function loadPlayerStats(client: DbClient, userId: string): Promise<PlayerStatRow> {
  const result = await client.query<PlayerStatRow>(
    `SELECT id, elo, games_played, wins, losses, draws
     FROM users
     WHERE id = $1
     FOR UPDATE`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`player not found: ${userId}`);
  return row;
}

async function applyUserStats(
  client: DbClient,
  userId: string,
  update: UserStatUpdate,
): Promise<void> {
  await client.query(
    `UPDATE users SET
       elo = $2,
       games_played = $3,
       wins = $4,
       losses = $5,
       draws = $6
     WHERE id = $1`,
    [userId, update.elo, update.gamesPlayed, update.wins, update.losses, update.draws],
  );
}

async function getGameForUpdate(client: DbClient, gameId: string): Promise<GameRow> {
  const result = await client.query<RawGameRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM games
     WHERE id = $1
     FOR UPDATE`,
    [gameId],
  );
  const row = result.rows[0];
  if (!row) throw new GameNotFoundError(gameId);
  return mapGameRow(row);
}

export async function getActiveGamesForUser(userId: string): Promise<{ id: string }[]> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM games
     WHERE (white_user_id = $1 OR black_user_id = $1)
       AND ended_at IS NULL
     ORDER BY started_at DESC`,
    [userId],
  );
  return result.rows;
}

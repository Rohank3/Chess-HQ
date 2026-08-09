import { pool } from '../db/pool.js';
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

export interface GameRow {
  id: string;
  whiteUserId: string;
  blackUserId: string;
  whiteEloBefore: number | null;
  blackEloBefore: number | null;
  timeControl: string;
  initialMs: number;
  incrementMs: number;
  whiteMs: number;
  blackMs: number;
  fen: string;
  startedAt: string;
}

export async function createGame(input: CreateGameInput): Promise<GameRow> {
  const result = await pool.query<GameRow>(
    `INSERT INTO games (
       white_user_id, black_user_id,
       white_elo_before, black_elo_before,
       time_control, initial_ms, increment_ms,
       white_ms, black_ms
     )
     VALUES ($1, $2, $3, $4, $5::text, $6, $7, $8, $8)
     RETURNING
       id, white_user_id, black_user_id,
       white_elo_before, black_elo_before,
       time_control, initial_ms, increment_ms,
       white_ms, black_ms, fen, started_at`,
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
  return row;
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

import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/authHttp.js';
import { statsQuerySchema } from '../security/validation.js';
import { badRequest } from '../utils/http-error.js';

export const statsRouter = Router();

/**
 * GET /api/stats/me
 *
 * The dashboard's single required read: the caller's profile (elo,
 * games_played, w/l/d) plus a page of recent games, each row hydrated with
 * the opponent's username and the player's own colour + Elo delta.
 *
 * Single queries, no transactions -- this is a read path. The
 * games_history_white_idx / games_history_black_idx partial indexes (Step 2)
 * give us index-ordered DESC reads on `ended_at` filtered by user, so the
 * pager is an index seek + LIMIT/OFFSET rather than a filesort.
 */
statsRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;

    const profileResult = await pool.query<{
      username: string;
      elo: number;
      games_played: number;
      wins: number;
      losses: number;
      draws: number;
    }>(
      `SELECT username, elo, games_played, wins, losses, draws
       FROM users
       WHERE id = $1`,
      [userId],
    );
    const profile = profileResult.rows[0];
    if (!profile) return res.json({ profile: null, recentGames: [] });

    // Pagination: ?limit=20&offset=0. The zod schema clamps limit to
    // [1, 50] (so a caller can't pull the entire games table in one request)
    // and coerces offset to a non-negative int. A non-numeric input returns a
    // clean validation_error via safeParse rather than a NaN fallthrough.
    const parsed = statsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return next(badRequest('validation_error', parsed.error.issues[0]?.message));
    }
    const { limit, offset } = parsed.data;

    // For each recent game we want to know:
    //   - gameId, ended_at, termination, time_control
    //   - the player's colour in that game
    //   - the opponent's username
    //   - the player's elo before/after, so the dashboard can show the delta
    //
    // The "am I white or black" branch is computed inline so the join to the
    // opponent's username picks the right FK column.
    const gamesResult = await pool.query<{
      id: string;
      ended_at: string;
      termination: string;
      time_control: string;
      my_color: 'w' | 'b';
      opponent_id: string;
      opponent_username: string;
      my_elo_before: number | null;
      my_elo_after: number | null;
      my_result: 'win' | 'loss' | 'draw';
    }>(
      `SELECT
         g.id,
         g.ended_at,
         g.termination,
         g.time_control,
         CASE WHEN g.white_user_id = $1 THEN 'w' ELSE 'b' END AS my_color,
         CASE WHEN g.white_user_id = $1 THEN g.black_user_id ELSE g.white_user_id END AS opponent_id,
         opponent.username AS opponent_username,
         CASE WHEN g.white_user_id = $1 THEN g.white_elo_before ELSE g.black_elo_before END AS my_elo_before,
         CASE WHEN g.white_user_id = $1 THEN g.white_elo_after ELSE g.black_elo_after END AS my_elo_after,
         CASE
           WHEN g.winner IS NULL THEN 'draw'
           WHEN g.winner = $1 THEN 'win'
           ELSE 'loss'
         END AS my_result
       FROM games g
       JOIN users opponent
         ON opponent.id = CASE WHEN g.white_user_id = $1 THEN g.black_user_id ELSE g.white_user_id END
       WHERE (g.white_user_id = $1 OR g.black_user_id = $1)
         AND g.ended_at IS NOT NULL
       ORDER BY g.ended_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    const recentGames = gamesResult.rows.map((row) => ({
      id: row.id,
      endedAt: row.ended_at,
      termination: row.termination,
      timeControl: row.time_control,
      myColor: row.my_color,
      opponent: { id: row.opponent_id, username: row.opponent_username },
      myEloBefore: row.my_elo_before,
      myEloAfter: row.my_elo_after,
      myResult: row.my_result,
      eloDelta:
        row.my_elo_before !== null && row.my_elo_after !== null
          ? row.my_elo_after - row.my_elo_before
          : null,
    }));

    res.json({
      profile: {
        username: profile.username,
        elo: profile.elo,
        gamesPlayed: profile.games_played,
        wins: profile.wins,
        losses: profile.losses,
        draws: profile.draws,
      },
      recentGames,
    });
  } catch (err) {
    next(err);
  }
});

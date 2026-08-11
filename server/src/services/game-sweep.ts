import { endGame, getAllActiveGames } from './games.js';
import { isUserOnline, lastOfflineAtFor } from '../sockets/lobby.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Abandoned-game sweep.
 *
 * Policy:
 *   - A game where BOTH players have moved is NEVER aborted. It is a real
 *     game and only the clock may end it -- the timeout watchdog handles
 *     that by draining the side-to-move's bank. (moves strictly alternate
 *     white/black, so a move count >= 2 guarantees both sides have played.)
 *   - A game where at least one player never moved (move count 0 or 1) MAY
 *     be aborted if both players have been fully offline -- no live socket
 *     at all -- for longer than the grace period. Nobody has invested
 *     anything in such a game, so aborting it is clean and fair: no Elo
 *     change, termination 'aborted'.
 *
 * The grace period is sized from the game's own clock so short games settle
 * fast and long games get a real window: it is always below the clock
 * itself, so the abort fires before the timeout watchdog would.
 *
 * Why a sweep at all, when the clock already ends games? Two gaps: long
 * time controls (a 60-minute game can sit for an hour) and server restarts,
 * where the in-memory watchdogs die with the process and are only reattached
 * when someone subscribes again. A zero-move game whose players never come
 * back would linger as "active" on the dashboard forever without this.
 *
 * The "since when" anchor: `lastOfflineAtFor` records when a user's last
 * socket dropped in THIS process. A user who never connected (e.g. a
 * challenge game where the joiner's tab died before the handshake) has no
 * record -- the game's started_at is the honest fallback, so such a game
 * only aborts after the same grace period from creation.
 */

const SWEEP_INTERVAL_MS = 60_000;

/**
 * How long both players must have been offline before an unplayed game is
 * aborted, as a function of the game's initial clock. Clamped so short
 * games don't abort in seconds and long games don't wait forever.
 */
export function abandonGraceMs(initialMs: number): number {
  const scaled = Math.round(initialMs * env.ABANDONED_GAME_GRACE_FRACTION);
  return Math.min(env.ABANDONED_GAME_GRACE_MAX_MS, Math.max(env.ABANDONED_GAME_GRACE_MIN_MS, scaled));
}

export function startAbandonedGameSweep(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void sweepAbandonedGames();
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

/** Abort every eligible active game whose players have both been offline past
 *  the duration-scaled grace. Returns how many games were aborted. */
export async function sweepAbandonedGames(): Promise<number> {
  const active = await getAllActiveGames();
  const now = Date.now();

  let aborted = 0;
  for (const game of active) {
    // A real game -- both sides have played -- is never swept; the clock is
    // the only thing that may end it.
    if (game.moves.length >= 2) continue;

    if (isUserOnline(game.whiteUserId) || isUserOnline(game.blackUserId)) {
      continue; // at least one player is around -- their game stays live
    }
    const grace = abandonGraceMs(game.initialMs);
    const startedAtMs = Date.parse(game.startedAt);
    const whiteSince = lastOfflineAtFor(game.whiteUserId) ?? startedAtMs;
    const blackSince = lastOfflineAtFor(game.blackUserId) ?? startedAtMs;
    if (now - whiteSince < grace || now - blackSince < grace) {
      continue; // one side only recently went quiet -- give them time
    }
    try {
      await endGame({ gameId: game.id, winnerUserId: null, termination: 'aborted' });
      aborted += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('abandoned_game_abort_failed', { gameId: game.id, message });
    }
  }
  if (aborted > 0) {
    logger.info('abandoned_games_aborted', { count: aborted });
  }
  return aborted;
}

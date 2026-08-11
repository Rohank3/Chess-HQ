import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { Chess, type Move } from 'chess.js';
import { gameState } from '../services/game-state.js';
import {
  clearDrawOffer,
  endGame,
  getActiveGamesForUser,
  getGame,
  recordMove,
  setDrawOffer,
  type GameRow,
  type Termination,
} from '../services/games.js';
import {
  applyMove,
  flagFallen,
  peekFlags,
  type ClockState,
  type Side,
} from '../services/clock.js';
import { env, isProduction } from '../config/env.js';
import { pool } from '../db/pool.js';
import { roomForGame } from './index.js';
import { logger } from '../utils/logger.js';
import type { AuthenticatedSocket } from '../middleware/authSocket.js';

/**
 * Authoritative game-move socket handlers.
 *
 * The contract a client can rely on:
 *   - the server is the only writer of game state. A client-supplied move
 *     is validated for legality, applied, persisted, and broadcast; the
 *     client never advances its own board optimistically beyond the drag UI
 *     until the server's game:state arrives.
 *   - the ack envelope is the established { ok, error?, message? } shape.
 *
 * Trust model (carried over from Step 6):
 *   - identity is trusted (io.use verified the JWT, socket.data.userId is
 *     real). A client cannot forge a user id.
 *   - the gameId is checked against the games row's player ids -- a user
 *     outside the game gets 'forbidden'.
 *   - the side-to-move is read off the chess.js instance, not off the
 *     client. The clock is similarly server-authoritative (Step 7).
 *   - chess.js@1.4 throws on illegal moves; the try/catch around move()
 *     converts the throw into a typed ack, never into a server crash.
 *
 * Clock authority:
 *   - games are created with last_move_at stamped at creation, so White's
 *     clock runs from the moment the game exists. Each game:move advances
 *     the mover's clock by (now - lastMoveAt) and awards the increment
 *     AFTER the deduction -- including the first move, which is timed
 *     against the creation stamp.
 *   - broadcast snapshots always carry the authoritative clock so the
 *     clients' countdowns re-anchor to the server on every move.
 *   - a per-game 250ms watchdog runs while a clock is ticking; when the
 *     side-to-move's flag falls (bank <= 0), the watchdog calls endGame
 *     with termination:'timeout', winner=the opponent. Because lastMoveAt
 *     is set at creation, the watchdog is live from t=0, so a stranded
 *     game (nobody ever moves) still resolves by timeout. The watchdog is
 *     cleared on every game over path, so a finished game releases its
 *     timer at once.
 *
 * Draw offers:
 *   - game:draw:offer persists (draw_offered_by, draw_offer_expires_at),
 *     broadcasts a game:draw:offered event to the opponent, and is cleared
 *     if the opponent moves (moving = declining) or the TTL elapses.
 *   - game:draw:accept calls endGame with termination:'draw_agreed' and
 *     winner:null.
 *   - game:draw:decline clears the offer columns.
 */

const moveSchema = z.object({
  gameId: z.string().uuid(),
  from: z.string().min(2).max(2),
  to: z.string().min(2).max(2),
  promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
});

const gameActionSchema = z.object({
  gameId: z.string().uuid(),
});

const WATCHDOG_INTERVAL_MS = 250;

/** Per-game timeout watchdogs so a finished game releases its timer. */
const watchdogs = new Map<string, NodeJS.Timeout>();

interface GameSnapshot {
  gameId: string;
  fen: string;
  /** 'w' if it is white to move, else 'b'. */
  turn: 'w' | 'b';
  lastMove: { from: string; to: string; san: string } | null;
  captured: CapturedDelta;
  /** Authoritative clocks in milliseconds. */
  clocks: { whiteMs: number; blackMs: number; lastMoveAt: string | null };
  /** Set only while a draw offer is outstanding. */
  drawOffer?: { offeredBy: 'w' | 'b'; expiresAt: string };
  /** Whether the game is now over and why. Set only on the terminal snapshot. */
  gameOver?: {
    winner: string | null;
    termination: Termination;
    whiteEloBefore: number | null;
    blackEloBefore: number | null;
    whiteEloAfter: number | null;
    blackEloAfter: number | null;
  };
}

interface PieceCounts {
  p: number;
  n: number;
  b: number;
  r: number;
  q: number;
}

interface CapturedDelta {
  white: PieceCounts;
  black: PieceCounts;
}

export function registerGameHandlers(io: Server, socket: Socket): void {
  // A pull-side complement to `game:rejoined`: the server pushes active
  // games on every fresh socket connection, but a client that stays
  // connected while its user is elsewhere in the app never reconnects, so
  // it would miss that a challenge was accepted in the meantime. This ack
  // lets the client ask "do I have a live game right now?" on mount and
  // adopt the newest one.
  socket.on('game:active', async (_raw, ack) => {
    try {
      const userId = socket.data.userId as string;
      const rows = await getActiveGamesForUser(userId);
      // Same `{ gameId }[]` shape as the `game:rejoined` push so the client
      // adopts either source with one code path.
      const games = rows.map((row) => ({ gameId: row.id }));
      ack?.({ ok: true, games });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('game_active_failed', { sid: socket.id, message });
      ack?.({ ok: false, error: 'internal_error', message: safeErrorMessage(err) });
    }
  });

  // The initial-state fetch. `game:state` is otherwise only broadcast on a
  // move or at game-over, so a freshly matched game (or a reconnecting
  // socket) would never learn the current position/clocks without this.
  // Joining the room here also covers reconnects (a new socket id arrives
  // without room membership from the original handshake).
  socket.on('game:subscribe', async (raw, ack) => {
    try {
      const parsed = gameActionSchema.safeParse(raw);
      if (!parsed.success) {
        ack?.({
          ok: false,
          error: 'validation_error',
          message: parsed.error.issues[0]?.message,
        });
        return;
      }
      const { gameId } = parsed.data;
      const userId = socket.data.userId as string;

      const game = await getGame(gameId);
      const myColor = colorOf(userId, game);
      if (myColor === null) {
        ack?.({ ok: false, error: 'forbidden', message: 'Not a player in this game' });
        return;
      }

      socket.join(roomForGame(gameId));
      const chess = await gameState.loadOrRehydrate(gameId);
      const isOver = game.endedAt !== null;
      // Safety net: any subscribed live game gets a watchdog even if its
      // creation site didn't start one (e.g. legacy rows or a missed hook).
      if (!isOver) ensureWatchdog(io, gameId, game);
      socket.emit('game:state', snapshot(chess, game, null, isOver));
      // The ack carries the viewer's colour + opponent so a deep-linked or
      // reloaded room (no location.state to seed from) can rebuild the full
      // header: board orientation, drag rules, and the opponent strip all
      // depend on them, and the snapshot alone doesn't say which side you are.
      ack?.({
        ok: true,
        status: 'subscribed',
        gameId,
        color: myColor,
        opponent: await loadOpponentSummary(userId, game),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('game_subscribe_failed', { sid: socket.id, message });
      ack?.({ ok: false, error: 'internal_error', message: safeErrorMessage(err) });
    }
  });

  socket.on('game:move', async (raw, ack) => {
    try {
      const parsed = moveSchema.safeParse(raw);
      if (!parsed.success) {
        ack?.({
          ok: false,
          error: 'validation_error',
          message: parsed.error.issues[0]?.message,
        });
        return;
      }

      const { gameId, from, to, promotion } = parsed.data;
      const userId = socket.data.userId as string;

      const game = await getGame(gameId);

      if (game.endedAt !== null) {
        ack?.({ ok: false, error: 'game_already_over' });
        return;
      }
      const moverColor = colorOf(userId, game);
      if (moverColor === null) {
        ack?.({ ok: false, error: 'forbidden', message: 'Not a player in this game' });
        return;
      }

      const chess = await gameState.loadOrRehydrate(gameId);

      if (chess.turn() !== moverColor) {
        ack?.({ ok: false, error: 'not_your_turn' });
        // A client that spams moves out of turn is either buggy or
        // malicious -- treat it as a strike and disconnect after the
        // threshold so the server isn't a free DB-read amplifier.
        if (recordIllegal(socket)) return;
        return;
      }

      let applied: Move;
      try {
        applied = promotion
          ? chess.move({ from, to, promotion })
          : chess.move({ from, to });
      } catch {
        ack?.({ ok: false, error: 'illegal_move', message: 'Illegal move' });
        recordIllegal(socket);
        return;
      }

      // Advance the clock authoritatively. lastMoveAt on the games row is a
      // timestamptz; for the maths we keep a numeric ms stamp.
      const nowMs = Date.now();
      const clockBefore: ClockState = {
        whiteMs: game.whiteMs,
        blackMs: game.blackMs,
        lastMoveAt: game.lastMoveAt ? Date.parse(game.lastMoveAt) : null,
      };
      const { state: clockAfter } = applyMove({
        state: clockBefore,
        mover: moverColor,
        nowMs,
        incrementMs: game.incrementMs,
      });

      const fen = chess.fen();

      // Persist the move AND the new clock columns. If a draw offer was
      // pending, the opponent moving == declining: clear it on the same
      // UPDATE so a stale offer never survives a move.
      const gameAfterMove = await recordMove({
        gameId,
        fen,
        san: applied.san,
        whiteMs: clockAfter.whiteMs,
        blackMs: clockAfter.blackMs,
        lastMoveAt: new Date(nowMs),
      });
      if (gameAfterMove.drawOfferedBy !== null) {
        await clearDrawOffer(gameId);
        gameAfterMove.drawOfferedBy = null;
        gameAfterMove.drawOfferExpiresAt = null;
      }

      // Detect chess-terminal game-over (checkmate/stalemate/draws).
      const over = detectGameOver(chess, game);
      if (over) {
        await finish(io, over, chess, applied);
        ack?.({ ok: true, status: 'game_over', gameId });
        return;
      }

      // The watchdog handles timeout. Now that a clock is ticking (a
      // lastMoveAt exists), ensure the per-game timer is running.
      ensureWatchdog(io, gameId, gameAfterMove);

      broadcast(io, gameId, snapshot(chess, gameAfterMove, applied, false));
      ack?.({ ok: true, status: 'ok', gameId, fen, clocks: clockAfter });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('game_move_failed', { sid: socket.id, message });
      ack?.({ ok: false, error: 'internal_error', message: safeErrorMessage(err) });
    }
  });

  socket.on('game:resign', async (raw, ack) => {
    try {
      const parsed = gameActionSchema.safeParse(raw);
      if (!parsed.success) {
        ack?.({
          ok: false,
          error: 'validation_error',
          message: parsed.error.issues[0]?.message,
        });
        return;
      }

      const { gameId } = parsed.data;
      const userId = socket.data.userId as string;

      const game = await getGame(gameId);
      if (game.endedAt !== null) {
        ack?.({ ok: false, error: 'game_already_over' });
        return;
      }
      const moverColor = colorOf(userId, game);
      if (moverColor === null) {
        ack?.({ ok: false, error: 'forbidden', message: 'Not a player in this game' });
        return;
      }

      const winnerUserId = moverColor === 'w' ? game.blackUserId : game.whiteUserId;
      await finish(
        io,
        { gameId, winnerUserId, termination: 'resignation' },
        await gameState.loadOrRehydrate(gameId),
        null,
      );
      ack?.({ ok: true, status: 'game_over', gameId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('game_resign_failed', { sid: socket.id, message });
      ack?.({ ok: false, error: 'internal_error', message: safeErrorMessage(err) });
    }
  });

  socket.on('game:draw:offer', async (raw, ack) => {
    try {
      const parsed = gameActionSchema.safeParse(raw);
      if (!parsed.success) {
        ack?.({
          ok: false,
          error: 'validation_error',
          message: parsed.error.issues[0]?.message,
        });
        return;
      }
      const { gameId } = parsed.data;
      const userId = socket.data.userId as string;

      const game = await getGame(gameId);
      if (game.endedAt !== null) {
        ack?.({ ok: false, error: 'game_already_over' });
        return;
      }
      const color = colorOf(userId, game);
      if (color === null) {
        ack?.({ ok: false, error: 'forbidden', message: 'Not a player in this game' });
        return;
      }

      const updated = await setDrawOffer(gameId, userId, env.DRAW_OFFER_TTL_MS);
      io.to(roomForGame(gameId)).emit('game:draw:offered', {
        gameId,
        offeredBy: color,
        expiresAt: updated.drawOfferExpiresAt,
      });
      ack?.({ ok: true, status: 'offered' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('draw_offer_failed', { sid: socket.id, message });
      ack?.({ ok: false, error: 'internal_error', message: safeErrorMessage(err) });
    }
  });

  socket.on('game:draw:accept', async (raw, ack) => {
    try {
      const parsed = gameActionSchema.safeParse(raw);
      if (!parsed.success) {
        ack?.({
          ok: false,
          error: 'validation_error',
          message: parsed.error.issues[0]?.message,
        });
        return;
      }
      const { gameId } = parsed.data;
      const userId = socket.data.userId as string;

      const game = await getGame(gameId);
      if (game.endedAt !== null) {
        ack?.({ ok: false, error: 'game_already_over' });
        return;
      }
      if (colorOf(userId, game) === null) {
        ack?.({ ok: false, error: 'forbidden', message: 'Not a player in this game' });
        return;
      }
      // Only the OPPONENT of the offerer may accept their own draw offer.
      // The offerer accepting their own offer would be a self-confirming
      // bug -- they already wanted the draw, accepting is a no-op signal.
      if (game.drawOfferedBy === null) {
        ack?.({ ok: false, error: 'no_draw_offer' });
        return;
      }
      if (game.drawOfferedBy === userId) {
        ack?.({ ok: false, error: 'cannot_accept_own_offer' });
        return;
      }

      const chess = await gameState.loadOrRehydrate(gameId);
      await finish(
        io,
        { gameId, winnerUserId: null, termination: 'draw_agreed' },
        chess,
        null,
      );
      ack?.({ ok: true, status: 'game_over', gameId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('draw_accept_failed', { sid: socket.id, message });
      ack?.({ ok: false, error: 'internal_error', message: safeErrorMessage(err) });
    }
  });

  socket.on('game:draw:decline', async (raw, ack) => {
    try {
      const parsed = gameActionSchema.safeParse(raw);
      if (!parsed.success) {
        ack?.({
          ok: false,
          error: 'validation_error',
          message: parsed.error.issues[0]?.message,
        });
        return;
      }
      const { gameId } = parsed.data;
      const userId = socket.data.userId as string;

      const game = await getGame(gameId);
      if (game.endedAt !== null) {
        ack?.({ ok: false, error: 'game_already_over' });
        return;
      }
      if (colorOf(userId, game) === null) {
        ack?.({ ok: false, error: 'forbidden', message: 'Not a player in this game' });
        return;
      }
      if (game.drawOfferedBy === null) {
        ack?.({ ok: false, error: 'no_draw_offer' });
        return;
      }

      await clearDrawOffer(gameId);
      io.to(roomForGame(gameId)).emit('game:draw:declined', { gameId });
      ack?.({ ok: true, status: 'declined' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('draw_decline_failed', { sid: socket.id, message });
      ack?.({ ok: false, error: 'internal_error', message: safeErrorMessage(err) });
    }
  });
}

// ---------------------------------------------------------------------------
// Game-over flow + watchdog
// ---------------------------------------------------------------------------

async function finish(
  io: Server,
  end: { gameId: string; winnerUserId: string | null; termination: Termination },
  chess: Chess,
  lastMove: Move | null,
): Promise<void> {
  // Stop the timeout watchdog FIRST so a racing tick can't double-end the
  // game via endGame's first-writer-wins guard.
  stopWatchdog(end.gameId);
  const finalRow = await endGame(end);
  gameState.evict(end.gameId);
  // The freshly-applied chess instance has the final position; reuse it
  // rather than re-parsing finalRow.fen so the broadcast shape is exact.
  io.to(roomForGame(end.gameId)).emit(
    'game:state',
    snapshot(chess, finalRow, lastMove, true),
  );
  io.to(roomForGame(end.gameId)).emit('game:over', {
    gameId: end.gameId,
    winner: end.winnerUserId,
    termination: end.termination,
    whiteEloBefore: finalRow.whiteEloBefore,
    blackEloBefore: finalRow.blackEloBefore,
    whiteEloAfter: finalRow.whiteEloAfter,
    blackEloAfter: finalRow.blackEloAfter,
  });
}

/**
 * Ensure the per-game timeout watchdog is running. The watchdog ticks every
 * WATCHDOG_INTERVAL_MS and projects the side-to-move's clock against the
 * current wall-clock; if the flag is down, it calls finish with
 * termination:'timeout' and the opponent as the winner. unref'd so it can't
 * keep the event loop alive after the socket loop closes.
 *
 * Exported for the game-creation sites (matchmaking, challenge accept) so
 * the watchdog is live from t=0 -- with last_move_at stamped at creation,
 * White's clock is already running and a stranded game must still resolve
 * by timeout even if nobody ever subscribes.
 */
export function ensureWatchdog(io: Server, gameId: string, game: GameRow): void {
  if (watchdogs.has(gameId)) return;
  if (game.lastMoveAt === null) return; // defensive: legacy rows only
  if (game.endedAt !== null) return;

  const timer = setInterval(() => {
    void timeoutTick(io, gameId);
  }, WATCHDOG_INTERVAL_MS);
  timer.unref?.();
  watchdogs.set(gameId, timer);
}

async function timeoutTick(io: Server, gameId: string): Promise<void> {
  try {
    const game = await getGame(gameId);
    if (game.endedAt !== null) {
      stopWatchdog(gameId);
      return;
    }
    if (game.lastMoveAt === null) return;

    const lastMoveAt = Date.parse(game.lastMoveAt);
    const clock: ClockState = {
      whiteMs: game.whiteMs,
      blackMs: game.blackMs,
      lastMoveAt,
    };
    // The side to move must be derived from the chess instance to match
    // turn state. The in-memory instance tells the truth here; if it isn't
    // loaded, reattach via get-game and a turnless guess won't help.
    const chess = await gameState.loadOrRehydrate(gameId);
    const toMove: Side = chess.turn();
    const projected = peekFlags(clock, Date.now(), toMove);
    if (flagFallen(projected, toMove)) {
      const winner = toMove === 'w' ? game.blackUserId : game.whiteUserId;
      logger.info('game_timeout', {
        gameId,
        loser: toMove === 'w' ? game.whiteUserId : game.blackUserId,
      });
      await finish(
        io,
        { gameId, winnerUserId: winner, termination: 'timeout' },
        chess,
        null,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    logger.error('timeout_watchdog_failed', { gameId, message });
  }
}

function stopWatchdog(gameId: string): void {
  const timer = watchdogs.get(gameId);
  if (timer) {
    clearInterval(timer);
    watchdogs.delete(gameId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function colorOf(userId: string, game: GameRow): 'w' | 'b' | null {
  if (userId === game.whiteUserId) return 'w';
  if (userId === game.blackUserId) return 'b';
  return null;
}

interface OpponentSummary {
  id: string;
  username: string;
  elo: number;
}

/** The OTHER player's public profile, for the room header on a reloaded
 *  game where the client has no navigation state to restore the opponent
 *  from. Elo-before from the games row; username from the users table. */
async function loadOpponentSummary(userId: string, game: GameRow): Promise<OpponentSummary | null> {
  const opponentId = userId === game.whiteUserId ? game.blackUserId : game.whiteUserId;
  const result = await pool.query<{ username: string }>(
    'SELECT username FROM users WHERE id = $1',
    [opponentId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: opponentId,
    username: row.username,
    elo: userId === game.whiteUserId ? (game.blackEloBefore ?? 1200) : (game.whiteEloBefore ?? 1200),
  };
}

/**
 * Increment the per-socket illegal-move counter and disconnect the socket
 * once it crosses `env.MAX_ILLEGAL_MOVES`. The count lives on `socket.data`
 * (seeded to 0 by the auth handshake in `authSocket.ts`) so it dies with the
 * connection -- no module-level WeakMap to reap, and a fresh connection from
 * the same user starts at zero (a real "oops, misclicked" budget reset).
 *
 * Returns `true` once the threshold is reached so the caller can short-circuit
 * any remaining handler work. The `spam_guard` ack fires ahead of the
 * disconnect so the client can surface a "you've been disconnected for spam"
 * message before the transport tears down. The spam vector this guards
 * against is `game:move`; the resign/draw:offer/draw:accept/draw:decline
 * handlers are low-rate and intentionally not counted.
 */
function recordIllegal(socket: Socket): boolean {
  const data = socket as AuthenticatedSocket;
  data.data.illegalMoves = (data.data.illegalMoves ?? 0) + 1;
  if (data.data.illegalMoves >= env.MAX_ILLEGAL_MOVES) {
    logger.warn('socket_disconnect_spam', {
      sid: socket.id,
      count: data.data.illegalMoves,
    });
    socket.emit('game:illegal', { ok: false, error: 'spam_guard', message: 'Too many illegal moves' });
    socket.disconnect(true);
    return true;
  }
  return false;
}

/** Scrub a thrown error's message before it leaves the socket in
 *  production -- the HTTP error handler already does this; the socket path
 *  previously leaked raw `err.message` (which can carry internal paths or
 *  pg error text) to any authenticated client. Returns a safe external
 *  string for ack envelopes. */
function safeErrorMessage(err: unknown): string {
  return isProduction ? 'Internal error' : (err instanceof Error ? err.message : 'Internal error');
}

/**
 * Map chess.js game-over predicates onto our termination enum (the
 * CHECK-constrained set in the schema). Returns null for a non-terminal
 * position. `game` is passed so the winning side can be resolved for
 * decisive endings: on checkmate chess.js's `turn()` is the side that has
 * just been mated, so the winner is the opposite player.
 */
function detectGameOver(
  chess: Chess,
  game: GameRow,
): { gameId: string; winnerUserId: string | null; termination: Termination } | null {
  if (!chess.isGameOver()) return null;

  if (chess.isCheckmate()) {
    const winner = chess.turn() === 'w' ? game.blackUserId : game.whiteUserId;
    return {
      gameId: game.id,
      winnerUserId: winner,
      termination: 'checkmate',
    };
  }
  if (chess.isStalemate()) {
    return { gameId: game.id, winnerUserId: null, termination: 'stalemate' };
  }
  if (chess.isThreefoldRepetition()) {
    return { gameId: game.id, winnerUserId: null, termination: 'draw_threefold' };
  }
  if (chess.isDrawByFiftyMoves()) {
    return { gameId: game.id, winnerUserId: null, termination: 'draw_fiftymove' };
  }
  if (chess.isInsufficientMaterial()) {
    return { gameId: game.id, winnerUserId: null, termination: 'draw_insufficient' };
  }
  // chess.js lumps all draws under isDraw(); we've already split the named
  // ones above, so a falling-through isDraw() without a named cause is
  // treated as a generic draw_insufficient (rare in practice).
  if (chess.isDraw()) {
    return { gameId: game.id, winnerUserId: null, termination: 'draw_insufficient' };
  }
  return null;
}

/**
 * Build the snapshot object broadcast to players. `lastMove` is null for
 * the resign/draw/timeout paths (no move was played), so the client can
 * distinguish "your opponent moved the game to an end state" from "your
 * opponent resigned without moving".
 */
function snapshot(
  chess: Chess,
  game: GameRow,
  lastMove: Move | null,
  gameOver: boolean,
): GameSnapshot {
  const captured = computeCaptured(chess);
  const snap: GameSnapshot = {
    gameId: game.id,
    fen: chess.fen(),
    turn: chess.turn(),
    lastMove: lastMove ? { from: lastMove.from, to: lastMove.to, san: lastMove.san } : null,
    captured,
    clocks: {
      whiteMs: game.whiteMs,
      blackMs: game.blackMs,
      lastMoveAt: game.lastMoveAt,
    },
  };
  if (game.drawOfferedBy !== null && game.drawOfferExpiresAt !== null) {
    const offeredBy = game.drawOfferedBy === game.whiteUserId ? 'w' : 'b';
    snap.drawOffer = { offeredBy, expiresAt: game.drawOfferExpiresAt };
  }
  if (gameOver) {
    snap.gameOver = {
      winner: game.winner,
      termination: game.termination as Termination,
      // Elo deltas ride along so a RELOADED finished game (which never sees
      // the live game:over event) can still render the result modal with
      // rating changes -- otherwise a refreshed game-over page showed a
      // dead board with no result and no way back to matchmaking.
      whiteEloBefore: game.whiteEloBefore,
      blackEloBefore: game.blackEloBefore,
      whiteEloAfter: game.whiteEloAfter,
      blackEloAfter: game.blackEloAfter,
    };
  }
  return snap;
}

/**
 * Derived captured-pieces view: comparing the pieces still on the board
 * against the standard starting counts (8 pawns, 2 knights, 2 bishops, 2
 * rooks, 1 queen each). Returns counts of pieces the OPPONENT has lost,
 * grouped by the color that captured them. The client uses this to render
 * the tray of taken material.
 */
function computeCaptured(chess: Chess): CapturedDelta {
  // Pieces still on the board, grouped by their owning color.
  const onBoard: Record<'w' | 'b', PieceCounts> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };
  for (const row of chess.board()) {
    for (const square of row) {
      if (!square) continue;
      const key = square.type as keyof PieceCounts;
      onBoard[square.color][key] += 1;
    }
  }
  // captured.byWhite = pieces Black has lost = starting counts - Black still on board.
  // captured.byBlack = pieces White has lost = starting counts - White still on board.
  return {
    white: {
      p: Math.max(0, 8 - onBoard.b.p),
      n: Math.max(0, 2 - onBoard.b.n),
      b: Math.max(0, 2 - onBoard.b.b),
      r: Math.max(0, 2 - onBoard.b.r),
      q: Math.max(0, 1 - onBoard.b.q),
    },
    black: {
      p: Math.max(0, 8 - onBoard.w.p),
      n: Math.max(0, 2 - onBoard.w.n),
      b: Math.max(0, 2 - onBoard.w.b),
      r: Math.max(0, 2 - onBoard.w.r),
      q: Math.max(0, 1 - onBoard.w.q),
    },
  };
}

/** Emit the live game:state snapshot to everyone in the game room. Used
 * only on the non-terminal game:move path -- the terminal path emits its
 * own snapshot inside finish() alongside the game:over event. */
function broadcast(io: Server, gameId: string, snapshot: GameSnapshot): void {
  io.to(roomForGame(gameId)).emit('game:state', snapshot);
}

// Exports for test access (the watchdog map is exercised indirectly via
// the lifecycle in Step 6's tests; documented here so callers know the
// surface).
export function clearAllWatchdogs(): void {
  for (const timer of watchdogs.values()) clearInterval(timer);
  watchdogs.clear();
}

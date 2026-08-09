import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { Chess, type Move } from 'chess.js';
import { gameState } from '../services/game-state.js';
import {
  endGame,
  getGame,
  recordMove,
  type GameRow,
  type Termination,
} from '../services/games.js';
import { roomForGame } from './index.js';
import { logger } from '../utils/logger.js';

/**
 * Authoritative game-move socket handlers.
 *
 * The contract a client can rely on:
 *   - the server is the only writer of game state. A client-supplied move is
 *     validated for legality, applied, persisted, and broadcast; the client
 *     never advances its own board optimistically beyond the optimistic UI
 *     until the server's game:state arrives.
 *   - the ack envelope is the established { ok, error?, message? } shape.
 *
 * Trust model:
 *   - identity is trusted (io.use verified the JWT, socket.data.userId is
 *     real). The client cannot forge a user id.
 *   - the gameId is checked against the games row's player ids -- a user
 *     outside the game gets 'forbidden'.
 *   - the side-to-move is read off the chess.js instance, not off the
 *     client. A client claiming "it's my turn" is ignored; chess.turn() is
 *     the authority.
 *   - chess.js@1.4 throws on illegal moves; the try/catch around move()
 *     converts the throw into a typed ack, never into a server crash.
 */

const moveSchema = z.object({
  gameId: z.string().uuid(),
  from: z.string().min(2).max(2),
  to: z.string().min(2).max(2),
  promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
});

const resignSchema = z.object({
  gameId: z.string().uuid(),
});

interface GameSnapshot {
  gameId: string;
  fen: string;
  /** 'w' if it is white to move, else 'b'. */
  turn: 'w' | 'b';
  lastMove: { from: string; to: string; san: string } | null;
  captured: { white: PieceCounts; black: PieceCounts };
  /** Whether the game is now over and why. Set only on the terminal snapshot. */
  gameOver?: {
    winner: string | null;
    termination: Termination;
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

      // ACL: the mover must be one of the two players.
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

      // Turn check: chess.js turn() must match the mover's color BEFORE the
      // move is applied.
      if (chess.turn() !== moverColor) {
        ack?.({ ok: false, error: 'not_your_turn' });
        return;
      }

      // Apply the move. chess.js@1.4 throws on illegal moves; we convert
      // the throw into a typed ack and never let it propagate.
      let applied: Move;
      try {
        applied = promotion
          ? chess.move({ from, to, promotion })
          : chess.move({ from, to });
      } catch {
        ack?.({ ok: false, error: 'illegal_move', message: 'Illegal move' });
        return;
      }

      const fen = chess.fen();

      // Record and broadcast move. Clocks are advanced in step 7; for
      // step 6 we pass through the persisted clock columns unchanged so
      // the schema's NOT NULL invariants stay satisfied.
      const updated = await recordMove({
        gameId,
        fen,
        san: applied.san,
        whiteMs: game.whiteMs,
        blackMs: game.blackMs,
        lastMoveAt: new Date(),
      });

      // Detect terminal state and route to endGame if present.
      const over = detectGameOver(chess, game);
      if (over) {
        const finalRow = await endGame(over);
        gameState.evict(gameId);
        broadcast(io, gameId, snapshot(chess, finalRow, applied, true));
        ack?.({ ok: true, status: 'game_over', gameId });
        return;
      }

      broadcast(io, gameId, snapshot(chess, updated, applied, false));
      ack?.({ ok: true, status: 'ok', gameId, fen });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('game_move_failed', { sid: socket.id, message });
      ack?.({ ok: false, error: 'internal_error', message });
    }
  });

  socket.on('game:resign', async (raw, ack) => {
    try {
      const parsed = resignSchema.safeParse(raw);
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

      // Resign: the opponent wins.
      const winnerUserId =
        moverColor === 'w' ? game.blackUserId : game.whiteUserId;
      const finalRow = await endGame({
        gameId,
        winnerUserId,
        termination: 'resignation',
      });
      gameState.evict(gameId);
      broadcast(io, gameId, snapshot(new Chess(finalRow.fen), finalRow, null, true));
      ack?.({ ok: true, status: 'game_over', gameId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('game_resign_failed', { sid: socket.id, message });
      ack?.({ ok: false, error: 'internal_error', message });
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function colorOf(userId: string, game: GameRow): 'w' | 'b' | null {
  if (userId === game.whiteUserId) return 'w';
  if (userId === game.blackUserId) return 'b';
  return null;
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
 * the resign path (no move was played), so the client can distinguish
 * "your opponent moved the game to an end state" from "your opponent
 * resigned without moving".
 */
function snapshot(
  chess: Chess,
  game: GameRow,
  lastMove: Move | null,
  gameOver: boolean,
): GameSnapshot {
  const captured = computeCaptured(chess);
  return {
    gameId: game.id,
    fen: chess.fen(),
    turn: chess.turn(),
    lastMove: lastMove ? { from: lastMove.from, to: lastMove.to, san: lastMove.san } : null,
    captured,
    ...(gameOver
      ? {
          gameOver: {
            winner: game.winner,
            termination: game.termination as Termination,
          },
        }
      : {}),
  };
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


function broadcast(io: Server, gameId: string, snapshot: GameSnapshot): void {
  io.to(roomForGame(gameId)).emit('game:state', snapshot);
}

import type { Server, Socket } from 'socket.io';
import { matchmakingQueue } from '../services/matchmaking.js';
import { queueJoinSchema, type QueueEntry } from '../services/matchmaking.types.js';
import { createGame } from '../services/games.js';
import { gameState } from '../services/game-state.js';
import { pool } from '../db/pool.js';
import { roomForGame } from './index.js';
import { ensureWatchdog } from './game.js';
import { logger } from '../utils/logger.js';

function toPlayerSummary(
  entry: QueueEntry,
  eloSnapshot?: number,
): { id: string; username: string; elo: number } {
  return {
    id: entry.userId,
    username: entry.username,
    elo: eloSnapshot ?? entry.elo,
  };
}

interface UserProfile {
  username: string;
  elo: number;
  is_guest: boolean;
}

async function loadProfile(userId: string): Promise<UserProfile | null> {
  const result = await pool.query<UserProfile>(
    'SELECT username, elo, is_guest FROM users WHERE id = $1',
    [userId],
  );
  return result.rows[0] ?? null;
}

export function registerMatchmakingHandlers(io: Server, socket: Socket): void {
  socket.on('queue:join', async (raw, ack) => {
    try {
      const parsed = queueJoinSchema.safeParse(raw);
      if (!parsed.success) {
        ack?.({
          ok: false,
          error: 'validation_error',
          message: parsed.error.issues[0]?.message,
        });
        return;
      }

      const profile = await loadProfile(socket.data.userId);
      if (!profile) {
        ack?.({ ok: false, error: 'no_account', message: 'Account not found' });
        return;
      }

      // Guests are allowed to queue: this app has no separate casual/ranked
      // split, so "play as guest" is the primary quick path and blocking it
      // left guests with no way to start a game. Guests start at 1200 Elo
      // and their games count normally.

      const entry: QueueEntry = {
        userId: socket.data.userId,
        username: socket.data.username,
        elo: profile.elo,
        socketId: socket.id,
        timeControl: parsed.data.timeControl,
        initialMs: parsed.data.initialMs,
        incrementMs: parsed.data.incrementMs,
        joinedAt: Date.now(),
      };

      const result = matchmakingQueue.enqueue(entry);
      if (!result.matched) {
        ack?.({ ok: true, status: 'queued' });
        return;
      }

      const game = await createGame({
        whiteUserId: result.pair.white.userId,
        blackUserId: result.pair.black.userId,
        whiteEloBefore: result.pair.white.elo,
        blackEloBefore: result.pair.black.elo,
        timeControl: entry.timeControl,
        initialMs: entry.initialMs,
        incrementMs: entry.incrementMs,
      });

      io.in([result.pair.white.socketId, result.pair.black.socketId]).socketsJoin(
        roomForGame(game.id),
      );

      // Seed the in-memory chess.js instance so the first game:move is O(1)
      // (no DB rehydrate needed).
      gameState.seed(game.id, game.fen);
      // Clock runs from creation; the timeout watchdog must too.
      ensureWatchdog(io, game.id, game);

      const opponentWhite = toPlayerSummary(result.pair.white);
      const opponentBlack = toPlayerSummary(result.pair.black);

      io.to(result.pair.white.socketId).emit('queue:matched', {
        gameId: game.id,
        color: 'w' as const,
        opponent: opponentBlack,
        timeControl: entry.timeControl,
        initialMs: entry.initialMs,
        incrementMs: entry.incrementMs,
      });
      io.to(result.pair.black.socketId).emit('queue:matched', {
        gameId: game.id,
        color: 'b' as const,
        opponent: opponentWhite,
        timeControl: entry.timeControl,
        initialMs: entry.initialMs,
        incrementMs: entry.incrementMs,
      });

      const myColor =
        socket.data.userId === result.pair.white.userId ? ('w' as const) : ('b' as const);
      ack?.({ ok: true, status: 'matched', gameId: game.id, color: myColor });
      logger.info('match_made', {
        gameId: game.id,
        white: result.pair.white.userId,
        black: result.pair.black.userId,
        eloDelta: Math.abs(result.pair.white.elo - result.pair.black.elo),
      });
    } catch (err) {
      // Log the real cause server-side, and surface it to the queuing
      // player so a matchmaking failure is self-diagnosing (Postgres
      // constraint names are not sensitive for this demo).
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('queue_join_failed', { socketId: socket.id, message });
      ack?.({ ok: false, error: 'internal_error', message });
    }
  });

  socket.on('queue:leave', () => {
    const removed = matchmakingQueue.dequeue(socket.data.userId);
    if (removed) {
      logger.info('queue_left', { userId: socket.data.userId });
    }
  });

  const leaveOnDisconnect = () => {
    const removed = matchmakingQueue.dequeBySocket(socket.id);
    if (removed) {
      logger.info('queue_left_on_disconnect', { userId: removed.userId, sid: socket.id });
    }
  };
  socket.on('disconnect', leaveOnDisconnect);
}

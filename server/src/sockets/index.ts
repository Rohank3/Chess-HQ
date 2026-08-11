import type { Server } from 'socket.io';
import type { AuthenticatedSocket } from '../middleware/authSocket.js';
import { attachSocketAuth } from '../middleware/authSocket.js';
import { matchmakingQueue } from '../services/matchmaking.js';
import { startAbandonedGameSweep } from '../services/game-sweep.js';
import { registerMatchmakingHandlers } from './matchmaking.js';
import { registerChallengeHandlers } from './challenges.js';
import { registerGameHandlers } from './game.js';
import { registerUserSocket, unregisterUserSocket, rejoinActiveGames } from './lobby.js';
import { logger } from '../utils/logger.js';

export function createSocketLayer(io: Server): void {
  attachSocketAuth(io);
  matchmakingQueue.startCleanup();
  startAbandonedGameSweep();

  io.on('connection', (rawSocket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const { userId, username } = socket.data;

    registerUserSocket(userId, socket.id);
    logger.info('socket_connected', { userId, username, sid: socket.id });

    rejoinActiveGames(io, userId, socket.id)
      .then((rejoined) => {
        if (rejoined.length > 0) {
          socket.emit('game:rejoined', { games: rejoined });
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'unknown';
        logger.error('socket_rejoin_failed', { userId, sid: socket.id, message });
      });

    registerMatchmakingHandlers(io, socket);
    registerChallengeHandlers(io, socket);
    registerGameHandlers(io, socket);

    socket.on('disconnect', (reason) => {
      unregisterUserSocket(userId, socket.id);
      logger.info('socket_disconnected', { userId, sid: socket.id, reason });
    });

    socket.on('error', (err) => {
      logger.error('socket_error', {
        userId,
        sid: socket.id,
        message: err instanceof Error ? err.message : 'unknown',
      });
    });
  });

  io.engine.on('connection_error', (err) => {
    const reason =
      err.req && (err.req as { _query?: Record<string, string> })._query?.EIO
        ? 'transport'
        : 'auth';
    logger.warn('socket_connection_error', {
      reason,
      code: err.code,
      message: err.message,
    });
  });
}

export const roomForGame = (gameId: string): string => `game:${gameId}`;

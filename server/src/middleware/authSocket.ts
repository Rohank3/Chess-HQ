import type { Server, Socket } from 'socket.io';
import { verifyToken } from '../security/jwt.js';
import { logger } from '../utils/logger.js';

export function attachSocketAuth(io: Server): void {
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length === 0) {
      logger.warn('socket_unauthorized', { reason: 'missing_token', sid: socket.id });
      return next(new Error('missing_token'));
    }

    try {
      const payload = verifyToken(token);
      socket.data.userId = payload.sub;
      socket.data.username = payload.name;
      socket.data.isGuest = payload.guest;
      next();
    } catch (err) {
      const reason =
        err instanceof Error && err.message.includes('exp')
          ? 'token_expired'
          : 'invalid_token';
      logger.warn('socket_unauthorized', { reason, sid: socket.id });
      return next(new Error(reason));
    }
  });
}

export interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    username: string;
    isGuest: boolean;
  };
}

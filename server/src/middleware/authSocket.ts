import type { Server, Socket } from 'socket.io';
import { TokenExpiredError } from 'jsonwebtoken';
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
      socket.data.illegalMoves = 0;
      next();
    } catch (err) {
      // Sniff the typed `TokenExpiredError` rather than the raw message
      // string (the prior `err.message.includes('exp')` was brittle -- a
      // future jsonwebtoken refactor could rephrase that message). The
      // client's useSocket handler matches these reason verbs verbatim, so
      // keeping them stable is part of the contract.
      const reason = err instanceof TokenExpiredError ? 'token_expired' : 'invalid_token';
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
    illegalMoves: number;
  };
}

import type { Server } from 'socket.io';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

type Sockets = Map<string, string>;
const userSockets = new Map<string, Sockets>();

export function registerUserSocket(userId: string, socketId: string): void {
  let sockets = userSockets.get(userId);
  if (!sockets) {
    sockets = new Map<string, string>();
    userSockets.set(userId, sockets);
  }
  sockets.set(socketId, socketId);
}

export function unregisterUserSocket(userId: string, socketId: string): void {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    userSockets.delete(userId);
  }
}

export function getSocketIdsForUser(userId: string): string[] {
  const sockets = userSockets.get(userId);
  if (!sockets) return [];
  return Array.from(sockets.values());
}

export function isUserOnline(userId: string): boolean {
  const sockets = userSockets.get(userId);
  return sockets !== undefined && sockets.size > 0;
}

export async function rejoinActiveGames(
  io: Server,
  userId: string,
  socketId: string,
): Promise<{ gameId: string }[]> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM games
     WHERE (white_user_id = $1 OR black_user_id = $1)
       AND ended_at IS NULL
     ORDER BY started_at DESC`,
    [userId],
  );

  const rejoined: { gameId: string }[] = [];
  for (const row of result.rows) {
    io.in(socketId).socketsJoin(`game:${row.id}`);
    rejoined.push({ gameId: row.id });
  }

  if (rejoined.length > 0) {
    logger.info('socket_rejoined_games', {
      userId,
      socketId,
      count: rejoined.length,
    });
  }
  return rejoined;
}

export function resetLobbyRegistry(): void {
  userSockets.clear();
}

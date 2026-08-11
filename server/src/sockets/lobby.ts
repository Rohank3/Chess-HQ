import type { Server } from 'socket.io';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

type Sockets = Map<string, string>;
const userSockets = new Map<string, Sockets>();

// When a user's LAST socket dropped, the wall-clock time of that drop. Used
// by the abandoned-game sweep to decide "both players have been fully offline
// for a long time" -- the registry only knows who is connected NOW, not since
// when. Cleared as soon as the user registers any socket again.
const lastOfflineAt = new Map<string, number>();

export function registerUserSocket(userId: string, socketId: string): void {
  let sockets = userSockets.get(userId);
  if (!sockets) {
    sockets = new Map<string, string>();
    userSockets.set(userId, sockets);
    lastOfflineAt.delete(userId);
  }
  sockets.set(socketId, socketId);
}

export function unregisterUserSocket(userId: string, socketId: string): void {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    userSockets.delete(userId);
    lastOfflineAt.set(userId, Date.now());
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

/** When the user's last socket dropped, or null if they are online or were
 *  never connected in this process. The abandoned-game sweep falls back to
 *  the game's started_at for the never-connected case. */
export function lastOfflineAtFor(userId: string): number | null {
  return lastOfflineAt.get(userId) ?? null;
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
  lastOfflineAt.clear();
}

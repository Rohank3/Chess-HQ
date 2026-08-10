import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { getChallenge, removeChallenge, restoreChallenge } from '../services/challenges.js';
import { createGame } from '../services/games.js';
import { gameState } from '../services/game-state.js';
import { pool } from '../db/pool.js';
import { roomForGame } from './index.js';
import { getSocketIdsForUser } from './lobby.js';
import { logger } from '../utils/logger.js';

const challengeIdSchema = z.object({ challengeId: z.string().uuid() });

interface UserProfile {
  id: string;
  username: string;
  elo: number;
}

async function loadProfile(userId: string): Promise<UserProfile | null> {
  const result = await pool.query<UserProfile>(
    'SELECT id, username, elo FROM users WHERE id = $1',
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Challenge accept flow. The challenge is claimed on accept (removed from the
 * lobby) so two simultaneous acceptors can't double-join; the first-accepted
 * game is authoritative. The creator is White, the joiner Black. Both sides
 * get a `challenge:accepted` payload shaped like `queue:matched` so the
 * client reuses one game-room adoption path.
 */
export function registerChallengeHandlers(io: Server, socket: Socket): void {
  socket.on('challenge:join', async (raw, ack) => {
    try {
      const parsed = challengeIdSchema.safeParse(raw);
      if (!parsed.success) {
        ack?.({ ok: false, error: 'validation_error', message: parsed.error.issues[0]?.message });
        return;
      }

      const challenge = getChallenge(parsed.data.challengeId);
      if (!challenge) {
        ack?.({ ok: false, error: 'challenge_not_found', message: 'Challenge not found or expired' });
        return;
      }
      if (challenge.creatorUserId === socket.data.userId) {
        ack?.({ ok: false, error: 'cannot_join_own', message: 'You cannot accept your own challenge' });
        return;
      }

      const [creator, joiner] = await Promise.all([
        loadProfile(challenge.creatorUserId),
        loadProfile(socket.data.userId),
      ]);
      if (!creator || !joiner) {
        ack?.({ ok: false, error: 'no_account', message: 'Account not found' });
        return;
      }

      // Claim the challenge before creating the game so a second acceptor
      // cannot race the same lobby. If creating the game fails, put the
      // challenge back so the link survives a failed attempt instead of
      // silently dying (the old order made every failed accept burn the
      // challenge, so retries always reported 'expired').
      removeChallenge(challenge.id);

      let game;
      try {
        game = await createGame({
          whiteUserId: creator.id,
          blackUserId: joiner.id,
          whiteEloBefore: creator.elo,
          blackEloBefore: joiner.elo,
          timeControl: 'custom',
          initialMs: challenge.initialMs,
          incrementMs: challenge.incrementMs,
        });
      } catch (err) {
        restoreChallenge(challenge);
        throw err;
      }

      const creatorSockets = getSocketIdsForUser(creator.id);
      for (const sid of creatorSockets) {
        io.in(sid).socketsJoin(roomForGame(game.id));
      }
      io.in(socket.id).socketsJoin(roomForGame(game.id));

      // Seed the in-memory chess.js instance so the first game:move is O(1).
      gameState.seed(game.id, game.fen);

      const joinerSummary = { id: joiner.id, username: joiner.username, elo: joiner.elo };
      const creatorSummary = { id: creator.id, username: creator.username, elo: creator.elo };

      for (const sid of creatorSockets) {
        io.to(sid).emit('challenge:accepted', {
          gameId: game.id,
          color: 'w' as const,
          opponent: joinerSummary,
          timeControl: 'custom',
          initialMs: challenge.initialMs,
          incrementMs: challenge.incrementMs,
        });
      }
      io.to(socket.id).emit('challenge:accepted', {
        gameId: game.id,
        color: 'b' as const,
        opponent: creatorSummary,
        timeControl: 'custom',
        initialMs: challenge.initialMs,
        incrementMs: challenge.incrementMs,
      });

      ack?.({ ok: true, status: 'accepted', gameId: game.id, color: 'b' as const });
      logger.info('challenge_accepted', {
        gameId: game.id,
        challengeId: challenge.id,
        creator: creator.id,
        joiner: joiner.id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('challenge_join_failed', { socketId: socket.id, message });
      // Surface the real cause to the accepting player: a failed accept is
      // a debugging event, and the message (e.g. a Postgres constraint
      // name) is not sensitive. This is what makes the next failure
      // self-diagnosing in the UI instead of a dead-end 'Internal error'.
      ack?.({ ok: false, error: 'internal_error', message });
    }
  });

  socket.on('challenge:cancel', async (raw, ack) => {
    try {
      const parsed = challengeIdSchema.safeParse(raw);
      if (!parsed.success) {
        ack?.({ ok: false, error: 'validation_error', message: parsed.error.issues[0]?.message });
        return;
      }
      const challenge = getChallenge(parsed.data.challengeId);
      if (!challenge) {
        ack?.({ ok: false, error: 'challenge_not_found', message: 'Challenge not found or expired' });
        return;
      }
      if (challenge.creatorUserId !== socket.data.userId) {
        ack?.({ ok: false, error: 'forbidden', message: 'Only the creator can cancel' });
        return;
      }
      removeChallenge(challenge.id);
      ack?.({ ok: true, status: 'cancelled' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('challenge_cancel_failed', { socketId: socket.id, message });
      ack?.({ ok: false, error: 'internal_error', message: 'Internal error' });
    }
  });
}

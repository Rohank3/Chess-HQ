import { Router } from 'express';
import { z } from 'zod';
import {
  createChallenge,
  getChallenge,
  getIncomingChallengesFor,
  countActiveChallengesFor,
  PER_USER_CHALLENGE_LIMIT,
} from '../services/challenges.js';
import { requireAuth } from '../middleware/authHttp.js';
import { badRequest, notFound, tooManyRequests, forbidden } from '../utils/http-error.js';
import { pool } from '../db/pool.js';
import { areFriends } from '../services/friends.js';
import { emitToUser } from '../sockets/lobby.js';

export const challengesRouter = Router();

// Clamp the custom clock to sane ranges (mirror the queue's validation).
const createChallengeSchema = z.object({
  initialMs: z.number().int().min(1_000).max(60 * 60 * 1000),
  incrementMs: z.number().int().min(0).max(60 * 1000).default(0),
  // A direct friend challenge: only this user may accept, and they are
  // notified in realtime instead of via a shareable link.
  targetUserId: z.string().uuid().optional(),
});

function challengeJson(challenge: {
  id: string;
  initialMs: number;
  incrementMs: number;
  creatorUserId: string;
  creatorUsername: string;
  creatorElo: number;
  expiresAt: number;
}) {
  return {
    id: challenge.id,
    initialMs: challenge.initialMs,
    incrementMs: challenge.incrementMs,
    creatorUserId: challenge.creatorUserId,
    creatorUsername: challenge.creatorUsername,
    creatorElo: challenge.creatorElo,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
  };
}

/**
 * POST /api/challenges — create a challenge. Without targetUserId this is a
 * shareable link challenge anyone can accept; with targetUserId it is a
 * direct friend challenge: only that user may accept, and they get a
 * `challenge:incoming` socket event so their dashboard can surface it.
 * Requires auth.
 */
challengesRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const parsed = createChallengeSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(badRequest('validation_error', parsed.error.issues[0]?.message));
    }

    if (countActiveChallengesFor(req.user!.id) >= PER_USER_CHALLENGE_LIMIT) {
      return next(
        tooManyRequests(
          'too_many_challenges',
          'Cancel an open challenge before creating another',
        ),
      );
    }

    const profileResult = await pool.query<{ elo: number }>(
      'SELECT elo FROM users WHERE id = $1',
      [req.user!.id],
    );
    const profile = profileResult.rows[0];
    if (!profile) return next(notFound('no_account', 'Account not found'));

    // Direct challenges are friend-only, registered-only, and never to self.
    let targetUserId: string | undefined;
    if (parsed.data.targetUserId) {
      if (req.user!.isGuest) {
        return next(forbidden('guests_only', 'Guest accounts cannot challenge friends directly'));
      }
      const target = parsed.data.targetUserId;
      if (target === req.user!.id) {
        return next(badRequest('cannot_challenge_self', 'You cannot challenge yourself'));
      }
      const targetResult = await pool.query<{ is_guest: boolean }>(
        'SELECT is_guest FROM users WHERE id = $1',
        [target],
      );
      const targetRow = targetResult.rows[0];
      if (!targetRow) {
        return next(notFound('target_not_found', 'That user does not exist'));
      }
      if (targetRow.is_guest) {
        return next(badRequest('guest_target', 'Guests cannot be challenged directly — they have no account'));
      }
      if (!(await areFriends(req.user!.id, target))) {
        return next(
          forbidden('not_friends', 'You can only challenge friends directly — send a friend request first'),
        );
      }
      targetUserId = target;
    }

    const challenge = createChallenge({
      creatorUserId: req.user!.id,
      creatorUsername: req.user!.username,
      creatorElo: profile.elo,
      initialMs: parsed.data.initialMs,
      incrementMs: parsed.data.incrementMs,
      ...(targetUserId ? { targetUserId } : {}),
    });

    if (targetUserId) {
      emitToUser(targetUserId, 'challenge:incoming', { challenge: challengeJson(challenge) });
    }

    res.status(201).json({ ...challengeJson(challenge), targetUserId: targetUserId ?? null });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/challenges/incoming — every live direct challenge addressed to
 * the signed-in user (friend challenges waiting to be accepted). The
 * dashboard renders this section; realtime `challenge:incoming` events keep
 * it fresh while mounted. Guests have no friends, so they always get [].
 */
challengesRouter.get('/incoming', requireAuth, async (req, res, next) => {
  try {
    const challenges = getIncomingChallengesFor(req.user!.id).map(challengeJson);
    res.json({ challenges });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/challenges/:id — public read so the challenge page can render
 * before the visitor authenticates. 404 if missing/expired. A direct
 * challenge stays readable (the intended acceptor renders it), but the
 * socket join layer enforces the target-only rule.
 */
challengesRouter.get('/:id', async (req, res, next) => {
  try {
    const challenge = getChallenge(req.params.id);
    if (!challenge) {
      return next(notFound('challenge_not_found', 'Challenge not found or expired'));
    }
    res.json({ ...challengeJson(challenge), targetUserId: challenge.targetUserId ?? null });
  } catch (err) {
    next(err);
  }
});

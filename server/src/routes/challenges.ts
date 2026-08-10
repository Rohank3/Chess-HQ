import { Router } from 'express';
import { z } from 'zod';
import {
  createChallenge,
  getChallenge,
  countActiveChallengesFor,
  PER_USER_CHALLENGE_LIMIT,
} from '../services/challenges.js';
import { requireAuth } from '../middleware/authHttp.js';
import { badRequest, notFound, tooManyRequests } from '../utils/http-error.js';
import { pool } from '../db/pool.js';

export const challengesRouter = Router();

// Clamp the custom clock to sane ranges (mirror the queue's validation).
const createChallengeSchema = z.object({
  initialMs: z.number().int().min(1_000).max(60 * 60 * 1000),
  incrementMs: z.number().int().min(0).max(60 * 1000).default(0),
});

/**
 * POST /api/challenges — create a shareable challenge with a custom clock.
 * Requires auth. Returns the challenge id + the details the client needs to
 * render the share link and the challenge page.
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

    const challenge = createChallenge({
      creatorUserId: req.user!.id,
      creatorUsername: req.user!.username,
      creatorElo: profile.elo,
      initialMs: parsed.data.initialMs,
      incrementMs: parsed.data.incrementMs,
    });

    res.status(201).json({
      id: challenge.id,
      initialMs: challenge.initialMs,
      incrementMs: challenge.incrementMs,
      creatorUserId: challenge.creatorUserId,
      creatorUsername: challenge.creatorUsername,
      creatorElo: challenge.creatorElo,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/challenges/:id — public read so the challenge page can render
 * before the visitor authenticates. 404 if missing/expired.
 */
challengesRouter.get('/:id', async (req, res, next) => {
  try {
    const challenge = getChallenge(req.params.id);
    if (!challenge) {
      return next(notFound('challenge_not_found', 'Challenge not found or expired'));
    }
    res.json({
      id: challenge.id,
      initialMs: challenge.initialMs,
      incrementMs: challenge.incrementMs,
      creatorUserId: challenge.creatorUserId,
      creatorUsername: challenge.creatorUsername,
      creatorElo: challenge.creatorElo,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

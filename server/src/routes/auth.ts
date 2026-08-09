import { Router } from 'express';
import { randomFillSync } from 'node:crypto';
import { pool } from '../db/pool.js';
import { hashPassword, verifyPassword } from '../security/argon.js';
import { signToken } from '../security/jwt.js';
import { registerSchema, loginSchema } from '../security/validation.js';
import { requireAuth } from '../middleware/authHttp.js';
import { rateLimit } from '../security/rate-limit.js';
import { badRequest, conflict, unauthorized } from '../utils/http-error.js';
import { env } from '../config/env.js';

export const authRouter = Router();

function publicUser(row: {
  id: string;
  username: string;
  elo: number;
  is_guest: boolean;
}) {
  return {
    id: row.id,
    username: row.username,
    elo: row.elo,
    isGuest: row.is_guest,
  };
}

authRouter.post(
  '/register',
  rateLimit({ scope: 'register', max: 5, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(badRequest('validation_error', parsed.error.issues[0]?.message));
      }
      const { username, email, password } = parsed.data;

      const dupeUsername = await pool.query<{ id: string }>(
        'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
        [username],
      );
      if (dupeUsername.rowCount !== 0) {
        return next(conflict('username_taken', 'That username is already taken'));
      }

      if (email) {
        const dupeEmail = await pool.query<{ id: string }>(
          'SELECT id FROM users WHERE email = $1',
          [email],
        );
        if (dupeEmail.rowCount !== 0) {
          return next(conflict('email_taken', 'That email is already registered'));
        }
      }

      const passwordHash = await hashPassword(password);
      const result = await pool.query<{
        id: string;
        username: string;
        elo: number;
        is_guest: boolean;
      }>(
        `INSERT INTO users (username, email, password_hash, is_guest)
       VALUES ($1, $2, $3, FALSE)
       RETURNING id, username, elo, is_guest`,
        [username, email ?? null, passwordHash],
      );
      const user = result.rows[0]!;
      const token = signToken({ sub: user.id, name: user.username, guest: false });
      res.status(201).json({ token, user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/login',
  rateLimit({ scope: 'login', max: 10, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(badRequest('validation_error', parsed.error.issues[0]?.message));
      }
      const { identifier, password } = parsed.data;

      const result = await pool.query<{
        id: string;
        username: string;
        email: string | null;
        password_hash: string | null;
        elo: number;
        is_guest: boolean;
      }>(
        `SELECT id, username, email, password_hash, elo, is_guest
       FROM users
       WHERE LOWER(username) = LOWER($1)
       LIMIT 1`,
        [identifier],
      );
      const user = result.rows[0];
      if (!user || user.is_guest || !user.password_hash) {
        return next(unauthorized('invalid_credentials', 'Invalid username or password'));
      }

      const ok = await verifyPassword(user.password_hash, password);
      if (!ok) {
        return next(unauthorized('invalid_credentials', 'Invalid username or password'));
      }

      const token = signToken({ sub: user.id, name: user.username, guest: false });
      res.json({ token, user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query<{ username: string; elo: number; is_guest: boolean }>(
      'SELECT username, elo, is_guest FROM users WHERE id = $1 AND is_guest = FALSE',
      [req.user!.id],
    );
    const user = result.rows[0];
    if (!user) return next(unauthorized('invalid_token', 'User no longer exists'));
    res.json({ user: publicUser({ id: req.user!.id, ...user }) });
  } catch (err) {
    next(err);
  }
});

// --- Guest flow ---------------------------------------------------------------
// A "play as guest" session is a use-and-discard account: a random username,
// no password row (satisfies the users_auth_xor CHECK), and a short-lived
// access token. Guests are screened out of the ranked queue (Step 5), so
// this flow is deliberately casual-only -- visible in the lobby but not on
// any leaderboard. The flow avoids a sign-up form so a brand-new visitor can
// be inside a game within seconds.
function randomGuestSuffix(): string {
  // 6 base62 characters gives ~62^6 = 5.7e10 combinations; collision risk at
  // hobby scale is negligible, and we re-try on a UNIQUE violation anyway
  // when the DB is reachable.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const buf = randomFillSync(new Uint8Array(6)) as Uint8Array;
  for (let i = 0; i < 6; i++) out += alphabet[buf[i]! % 62];
  return out;
}

async function mintGuestUsername(): Promise<string> {
  // The users.username regex allows [A-Za-z0-9_-], so `Guest_<base62>` is
  // always valid. Try a handful of suffixes before falling back so a streak
  // of collisions (vanishingly unlikely) doesn't reject the request.
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `Guest_${randomGuestSuffix()}`;
    const dupe = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
      [candidate],
    );
    if (dupe.rowCount === 0) return candidate;
  }
  return `Guest_${randomGuestSuffix()}${randomGuestSuffix()}`;
}

authRouter.post(
  '/guest',
  rateLimit({ scope: 'guest', max: 10, windowMs: 60_000 }),
  async (_req, res, next) => {
    try {
      const username = await mintGuestUsername();
      const result = await pool.query<{
        id: string;
        username: string;
        elo: number;
        is_guest: boolean;
      }>(
        `INSERT INTO users (username, is_guest)
         VALUES ($1, TRUE)
         RETURNING id, username, elo, is_guest`,
        [username],
      );
      const created = result.rows[0]!;
      const token = signToken(
        { sub: created.id, name: created.username, guest: true },
        env.JWT_GUEST_TTL,
      );
      res.status(201).json({ token, user: publicUser(created) });
    } catch (err) {
      next(err);
    }
  },
);

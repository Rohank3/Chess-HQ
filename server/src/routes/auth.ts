import { Router } from 'express';
import { randomFillSync } from 'node:crypto';
import { pool } from '../db/pool.js';
import { hashPassword, verifyPassword } from '../security/argon.js';
import { signToken, refreshToken } from '../security/jwt.js';
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../security/validation.js';
import { generateEmailToken, hashEmailToken } from '../security/tokens.js';
import { sendMail } from '../services/mailer.js';
import { requireAuth } from '../middleware/authHttp.js';
import { rateLimit } from '../security/rate-limit.js';
import { badRequest, conflict, forbidden, unauthorized } from '../utils/http-error.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const authRouter = Router();

function publicUser(row: {
  id: string;
  username: string;
  elo: number;
  is_guest: boolean;
  email_verified_at: string | null;
}) {
  return {
    id: row.id,
    username: row.username,
    elo: row.elo,
    isGuest: row.is_guest,
    emailVerified: row.email_verified_at !== null,
  };
}

function verificationLink(token: string): string {
  return `${env.CLIENT_ORIGIN}/verify-email?token=${token}`;
}

function resetLink(token: string): string {
  return `${env.CLIENT_ORIGIN}/reset-password?token=${token}`;
}

/** Mint a fresh verification token, persist its hash, and email the link.
 *  Used at registration and by the resend endpoint. */
async function issueVerificationEmail(
  userId: string,
  email: string,
): Promise<void> {
  const token = generateEmailToken();
  await pool.query(
    `UPDATE users
     SET verify_token_hash = $2, verify_token_expires_at = now() + interval '24 hours'
     WHERE id = $1`,
    [userId, hashEmailToken(token)],
  );
  await sendMail({
    to: email,
    subject: 'Confirm your Chess-HQ email',
    text:
      `Welcome to Chess-HQ!\n\n` +
      `Confirm your email to enable password recovery:\n${verificationLink(token)}\n\n` +
      `This link expires in 24 hours. If you didn't create an account, you can ignore this email.`,
  });
}

/** Best-effort mail send: a delivery failure must not break the request the
 *  user just made (registration, forgot-password). The dashboard resend
 *  button covers the recovery path. */
async function sendMailSafe(
  job: () => Promise<void>,
  context: string,
): Promise<void> {
  try {
    await job();
  } catch (err) {
    logger.error('mail_send_failed', {
      context,
      message: err instanceof Error ? err.message : 'unknown',
    });
  }
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

      // Email is now mandatory for registered accounts (the schema enforces
      // it), so the uniqueness check always runs.
      const dupeEmail = await pool.query<{ id: string }>(
        'SELECT id FROM users WHERE email = $1',
        [email],
      );
      if (dupeEmail.rowCount !== 0) {
        return next(conflict('email_taken', 'That email is already registered'));
      }

      const passwordHash = await hashPassword(password);
      const result = await pool.query<{
        id: string;
        username: string;
        elo: number;
        is_guest: boolean;
        email_verified_at: string | null;
      }>(
        `INSERT INTO users (username, email, password_hash, is_guest)
       VALUES ($1, $2, $3, FALSE)
       RETURNING id, username, elo, is_guest, email_verified_at`,
        [username, email, passwordHash],
      );
      const user = result.rows[0]!;
      // Email the verification link (best-effort; the "check your inbox"
      // page's resend button covers a failed delivery). NO session is issued
      // here: the account is created in a pending state and cannot be used
      // until the emailed link is clicked — verification is a gate on
      // registration, not an afterthought.
      await sendMailSafe(() => issueVerificationEmail(user.id, email), 'register');
      res.status(201).json({ ok: true });
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
        email_verified_at: string | null;
      }>(
        `SELECT id, username, email, password_hash, elo, is_guest, email_verified_at
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

      // An account is only usable after its email is verified: registration
      // created it in a pending state, and this is the activation gate.
      if (!user.email_verified_at) {
        return next(
          forbidden('email_not_verified', 'Verify your email to activate your account.'),
        );
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
    // Guests are included: the auth bootstrap calls /me on every page load
    // and clears the session on a 401, so excluding guests here logged them
    // out on every refresh. The row carries is_guest, so the client can
    // still tell the two apart.
    const result = await pool.query<{
      username: string;
      elo: number;
      is_guest: boolean;
      email_verified_at: string | null;
    }>('SELECT username, elo, is_guest, email_verified_at FROM users WHERE id = $1', [
      req.user!.id,
    ]);
    const user = result.rows[0];
    if (!user) return next(unauthorized('invalid_token', 'User no longer exists'));
    res.json({ user: publicUser({ id: req.user!.id, ...user }) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/refresh
 *
 * Re-sign a *still-valid* access token into a fresh one with the default
 * access TTL. The client's current bearer is verified by `requireAuth`
 * (so an *expired* token never reaches this handler -- it 401s at the
 * middleware, which is the intended "you can refresh an active session but
 * not resurrect a dead one" boundary). We re-verify inside refreshToken too
 * for defence-in-depth, then re-sign the same identity.
 *
 * The fresh `elo` is read from the DB so the refreshed client reflects any
 * rating change since the original token was minted (the JWT carries name
 * but not elo). If the underlying account is gone (e.g. a guest row pruned
 * between mint and refresh), the request 401s -- no token is minted for a
 * phantom identity.
 */
authRouter.post(
  '/refresh',
  rateLimit({ scope: 'refresh', max: 10, windowMs: 60_000 }),
  requireAuth,
  async (req, res, next) => {
    try {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
      if (!token) return next(unauthorized('missing_token', 'Authorization header is required'));

      const fresh = refreshToken(token);

      const result = await pool.query<{
        username: string;
        elo: number;
        is_guest: boolean;
        email_verified_at: string | null;
      }>('SELECT username, elo, is_guest, email_verified_at FROM users WHERE id = $1', [
        req.user!.id,
      ]);
      const user = result.rows[0];
      if (!user) return next(unauthorized('invalid_token', 'User no longer exists'));

      res.json({ token: fresh, user: publicUser({ id: req.user!.id, ...user }) });
    } catch (err) {
      next(err);
    }
  },
);

// --- Email verification + password recovery ------------------------------------

/**
 * POST /api/auth/verify-email { token }
 *
 * Consumes the emailed verification token (unauthenticated — the link is
 * the proof of ownership). Marks the email verified and clears the token;
 * invalid/expired/used tokens get a uniform error so a guessed link can't
 * be probed for existence.
 */
authRouter.post(
  '/verify-email',
  rateLimit({ scope: 'verify', max: 10, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const parsed = verifyEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(badRequest('validation_error', parsed.error.issues[0]?.message));
      }
      const tokenHash = hashEmailToken(parsed.data.token);
      const found = await pool.query<{ id: string }>(
        `SELECT id FROM users
         WHERE verify_token_hash = $1 AND verify_token_expires_at > now()
         LIMIT 1`,
        [tokenHash],
      );
      const user = found.rows[0];
      if (!user) {
        return next(badRequest('invalid_or_expired', 'This verification link is invalid or has expired.'));
      }
      // The token row is kept until its natural expiry rather than deleted:
      // a replayed link then returns success instead of "expired" (the token
      // can only ever verify the same account, so re-verification is a no-op
      // and harmless). This makes the endpoint idempotent, which matters in
      // dev where React StrictMode fires the page's verify POST twice.
      await pool.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [user.id]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/auth/resend-verification { email }
 *
 * Re-issues the verification email for a pending (unverified) account.
 * Unauthenticated on purpose — a brand-new user can't sign in until they
 * verify, so the "didn't get the email?" page must work without a session.
 * The response is identical whether or not such an account exists (no user
 * enumeration); rate-limited so an eager clicker can't flood an inbox.
 */
authRouter.post(
  '/resend-verification',
  rateLimit({ scope: 'resend', max: 3, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(200).json({ ok: true });
      }
      const { email } = parsed.data;
      const row = await pool.query<{
        id: string;
        email_verified_at: string | null;
        is_guest: boolean;
      }>(
        'SELECT id, email_verified_at, is_guest FROM users WHERE email = $1 LIMIT 1',
        [email],
      );
      const user = row.rows[0];
      // Only send to real pending accounts; everyone else gets the uniform
      // success envelope.
      if (user && !user.is_guest && !user.email_verified_at) {
        await sendMailSafe(() => issueVerificationEmail(user.id, email), 'resend');
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/auth/forgot-password { email }
 *
 * Emails a one-time password-reset link to a verified address. The response
 * is identical whether or not the email belongs to an account (no user
 * enumeration), and unverified addresses get a "verify first" email instead
 * of a reset link — the whole point of verification.
 */
authRouter.post(
  '/forgot-password',
  rateLimit({ scope: 'forgot', max: 5, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        // Keep the envelope uniform: malformed input is the caller's fault
        // but still tells an enumerator nothing about account existence.
        return res.status(200).json({ ok: true });
      }
      const { email } = parsed.data;
      const row = await pool.query<{
        id: string;
        username: string;
        email_verified_at: string | null;
        is_guest: boolean;
      }>(
        'SELECT id, username, email_verified_at, is_guest FROM users WHERE email = $1 LIMIT 1',
        [email],
      );
      const user = row.rows[0];

      if (!user || user.is_guest) {
        // No such account — behave identically to success.
        return res.status(200).json({ ok: true });
      }

      if (!user.email_verified_at) {
        // Account exists but the email was never verified: no reset link
        // (that would defeat verification), but do send a nudge to finish
        // verification — the requester already proved they control the
        // address by typing it.
        await sendMailSafe(
          () =>
            sendMail({
              to: email,
              subject: 'Verify your Chess-HQ email to reset your password',
              text:
                `Someone requested a password reset for ${user.username}, but this email ` +
                `address hasn't been verified yet.\n\n` +
                `Confirm your email first, then request the reset again — use the ` +
                `verification link emailed when you registered, or resend one from the ` +
                `"check your inbox" page after signing up.\n\n` +
                `If this wasn't you, ignore this email.`,
            }),
          'forgot_unverified',
        );
        return res.status(200).json({ ok: true });
      }

      // Verified: mint a reset token (1h, single-use) and email the link.
      const token = generateEmailToken();
      await pool.query(
        `UPDATE users
         SET reset_token_hash = $2, reset_token_expires_at = now() + interval '1 hour'
         WHERE id = $1`,
        [user.id, hashEmailToken(token)],
      );
      await sendMailSafe(
        () =>
          sendMail({
            to: email,
            subject: 'Reset your Chess-HQ password',
            text:
              `Hi ${user.username},\n\n` +
              `Reset your password here (expires in 1 hour):\n${resetLink(token)}\n\n` +
              `If you didn't request this, you can ignore this email — your password won't change.`,
          }),
        'forgot',
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/auth/reset-password { token, password }
 *
 * Sets a new password with a valid reset token. Consuming it invalidates
 * every outstanding token on the account (reset + verification) so a stale
 * link can't be replayed after a successful reset.
 */
authRouter.post(
  '/reset-password',
  rateLimit({ scope: 'reset', max: 5, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(badRequest('validation_error', parsed.error.issues[0]?.message));
      }
      const tokenHash = hashEmailToken(parsed.data.token);
      const found = await pool.query<{ id: string }>(
        `SELECT id FROM users
         WHERE reset_token_hash = $1 AND reset_token_expires_at > now()
         LIMIT 1`,
        [tokenHash],
      );
      const user = found.rows[0];
      if (!user) {
        return next(badRequest('invalid_or_expired', 'This reset link is invalid or has expired.'));
      }
      const passwordHash = await hashPassword(parsed.data.password);
      await pool.query(
        `UPDATE users
         SET password_hash = $2,
             reset_token_hash = NULL,
             reset_token_expires_at = NULL,
             verify_token_hash = NULL,
             verify_token_expires_at = NULL
         WHERE id = $1`,
        [user.id, passwordHash],
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

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
      res.status(201).json({
        token,
        user: publicUser({ ...created, email_verified_at: null }),
      });
    } catch (err) {
      next(err);
    }
  },
);

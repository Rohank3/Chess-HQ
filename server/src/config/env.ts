import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotenv(path: string): void {
  try {
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // env file is optional; real validation happens via zod below
  }
}

if (process.env.NODE_ENV !== 'production') {
  loadDotenv(resolve(process.cwd(), '.env'));
  loadDotenv(resolve(process.cwd(), '.env.local'));
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters (use `openssl rand -hex 32`)'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  // Guest tokens are deliberately shorter so a "play as guest" session is a
  // use-and-discard flow: 2h is enough for a couple of games, short enough
  // that a leaked guest token can't be reused tomorrow.
  JWT_GUEST_TTL: z.string().default('2h'),
  // Origins never carry a path, but a stray trailing slash in the dashboard
  // value silently breaks the exact-match CORS compare ("'...netlify.app/'
  // is not equal to the supplied origin"). Normalize it so a paste mistake
  // can't take the whole site down.
  CLIENT_ORIGIN: z
    .string()
    .url()
    .default('http://localhost:5173')
    .transform((v) => v.replace(/\/+$/, '')),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Outbound email. `none` (default) logs messages to the console instead of
  // sending — perfect for dev and keeps tests hermetic. `resend` sends via
  // Resend's REST API (free tier: 3,000 emails/month, 100/day) and requires
  // RESEND_API_KEY — but note the shared onboarding@resend.dev sender can
  // only deliver to the Resend account's own inbox; sending to arbitrary
  // recipients requires a verified domain. `smtp` sends via any SMTP server
  // (e.g. Gmail: smtp.gmail.com + an App Password) and requires SMTP_HOST /
  // SMTP_USER / SMTP_PASS.
  EMAIL_PROVIDER: z.enum(['none', 'resend', 'smtp']).default('none'),
  // The From address on every message. With Resend's free tier this must be
  // `onboarding@resend.dev` until you verify your own domain (then e.g.
  // `Chess-HQ <no-reply@yourdomain.com>`). With SMTP it should be the
  // mailbox you authenticate as (or an alias it may send from).
  EMAIL_FROM: z.string().default('Chess-HQ <onboarding@resend.dev>'),
  RESEND_API_KEY: z.string().optional(),
  // SMTP provider (EMAIL_PROVIDER=smtp). Gmail: SMTP_HOST=smtp.gmail.com,
  // SMTP_PORT=465, SMTP_SECURE=true (or 587 + false for STARTTLS), user =
  // the Gmail address, pass = a 16-char App Password (Google account →
  // Security → App passwords). Any SMTP server works — these are generic.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? true : v === 'true' || v === '1')),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // How long a draw offer stays open before a stale-offer watchdog reaps
  // it. A 30s expiry mirrors the Lichess default -- enough for a real
  // opponent to read the offer and respond, short enough that an abandoned
  // offer doesn't leave a game in a "offer pending" limbo forever.
  DRAW_OFFER_TTL_MS: z.coerce.number().int().positive().default(30_000),
  // Abandoned-game sweep timing. The sweep only aborts games where at
  // least one player never moved (a game both players have engaged in is
  // left entirely to the clock); the grace period before that abort scales
  // with the game's own clock so a bullet game settles fast while a
  // classical game gets a long window: grace = clamp(initialMs * FRACTION,
  // MIN, MAX). Defaults: 40% of the clock, floored at 30s, capped at 15m --
  // always comfortably under the clock itself, so the abort beats the
  // timeout watchdog on the games it applies to.
  ABANDONED_GAME_GRACE_FRACTION: z.coerce.number().positive().max(1).default(0.4),
  ABANDONED_GAME_GRACE_MIN_MS: z.coerce.number().int().positive().default(30_000),
  ABANDONED_GAME_GRACE_MAX_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60_000),
  // Per-socket illegal-move threshold. A socket that pushes this many
  // illegal/not-your-turn moves is force-disconnected -- the cheapest move-
  // spam guard that still lets a real player misclick a few times. The count
  // lives on socket.data so it dies with the connection (no global map to
  // reap). 5 is picked as "generous to clumsy humans, hostile to bots".
  MAX_ILLEGAL_MOVES: z.coerce.number().int().positive().default(5),
  // How many proxy hops sit in front of the server. Render puts exactly one
  // trusted proxy in front, so prod sets TRUST_PROXY_HOPS=1 and Express's
  // req.ip reads the real client address out of X-Forwarded-For (which the
  // rate-limit buckets on). Dev is 0 so req.ip is the direct socket peer.
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),
});

export type AppEnv = z.infer<typeof schema>;

function loadEnv(): AppEnv {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

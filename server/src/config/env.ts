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
  // How long a draw offer stays open before a stale-offer watchdog reaps
  // it. A 30s expiry mirrors the Lichess default -- enough for a real
  // opponent to read the offer and respond, short enough that an abandoned
  // offer doesn't leave a game in a "offer pending" limbo forever.
  DRAW_OFFER_TTL_MS: z.coerce.number().int().positive().default(30_000),
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

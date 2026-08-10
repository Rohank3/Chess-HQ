import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface JwtPayload {
  sub: string;
  name: string;
  guest: boolean;
}

export interface VerifiedToken extends JwtPayload {
  iat: number;
  exp: number;
}

type ExpiresIn = Exclude<SignOptions['expiresIn'], undefined>;

export function signToken(payload: JwtPayload, expiresIn?: string): string {
  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: (expiresIn ?? env.JWT_ACCESS_TTL) as ExpiresIn,
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyToken(token: string): VerifiedToken {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as VerifiedToken;
}

/**
 * Re-sign a *still-valid* access token into a fresh one with the default
 * access TTL. The caller passes the bearer token it currently holds; we
 * verify it (which throws on a tampered or *expired* token -- so an expired
 * token CANNOT be refreshed, by design) and re-sign the same identity
 * (sub/name/guest) with a fresh `exp`.
 *
 * Stateless rotation: no jti, no DB side-table, no revocation list. The
 * security posture is "an attacker who steals a live token could refresh it
 * just like the real user" -- which is true of any stateless access token,
 * and is exactly the same posture the original `/login` token already has.
 * Refresh therefore grants no new capability beyond extending an active
 * session; an *expired* session is unreachable, matching the plan's
 * "from a still-valid one" wording. Guests keep their `guest: true` claim
 * (the guest gate is re-checked against the DB on every queue:join, so a
 * refreshed guest token is still screened out of the ranked queue).
 */
export function refreshToken(token: string): string {
  const verified = verifyToken(token);
  const payload: JwtPayload = {
    sub: verified.sub,
    name: verified.name,
    guest: verified.guest,
  };
  return signToken(payload, env.JWT_ACCESS_TTL);
}

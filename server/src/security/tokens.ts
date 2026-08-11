import { createHash, randomBytes } from 'node:crypto';

/**
 * One-time email tokens (email verification, password reset).
 *
 * The raw token is 32 random bytes (256 bits of entropy) hex-encoded — it is
 * handed to the user in the emailed link and never stored. Only its sha256
 * hash is persisted, so a database leak does not expose live tokens. A token
 * is consumed by a successful verify/reset, rotated by a resend/forgot, and
 * expires on its own deadline (24h verify, 1h reset).
 */
export function generateEmailToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashEmailToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

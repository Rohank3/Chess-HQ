import { randomUUID } from 'node:crypto';

export interface Challenge {
  id: string;
  creatorUserId: string;
  creatorUsername: string;
  creatorElo: number;
  initialMs: number;
  incrementMs: number;
  createdAt: number;
  expiresAt: number;
  /** When set, only this user may accept the challenge (direct friend challenge). */
  targetUserId?: string;
}

const CHALLENGE_TTL_MS = 30 * 60 * 1000;
const PER_USER_LIMIT = 5;

/**
 * In-memory challenge lobby, consistent with the in-memory matchmaking queue:
 * the app is deliberately single-instance, so a process-local Map is fine and
 * dies with the process. A challenge expires 30 minutes after creation; the
 * expiry is enforced lazily on read (no timer to manage).
 */
const challenges = new Map<string, Challenge>();

export function createChallenge(input: {
  creatorUserId: string;
  creatorUsername: string;
  creatorElo: number;
  initialMs: number;
  incrementMs: number;
  targetUserId?: string;
}): Challenge {
  const now = Date.now();
  const challenge: Challenge = {
    id: randomUUID(),
    ...input,
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
  };
  challenges.set(challenge.id, challenge);
  return challenge;
}

/**
 * Every live challenge addressed to this user (direct friend challenges),
 * oldest first. Enforces expiry lazily like getChallenge. Link challenges
 * (no target) are deliberately excluded — they are accepted via their URL.
 */
export function getIncomingChallengesFor(userId: string): Challenge[] {
  const now = Date.now();
  const incoming: Challenge[] = [];
  for (const challenge of challenges.values()) {
    if (challenge.targetUserId !== userId) continue;
    if (now > challenge.expiresAt) {
      challenges.delete(challenge.id);
      continue;
    }
    incoming.push(challenge);
  }
  incoming.sort((a, b) => a.createdAt - b.createdAt);
  return incoming;
}

/** Read a live challenge, lazily dropping it once expired. */
export function getChallenge(id: string): Challenge | null {
  const challenge = challenges.get(id) ?? null;
  if (!challenge) return null;
  if (Date.now() > challenge.expiresAt) {
    challenges.delete(id);
    return null;
  }
  return challenge;
}

/** Remove (and return) a challenge — used on accept and cancel. */
export function removeChallenge(id: string): Challenge | null {
  const challenge = challenges.get(id) ?? null;
  if (challenge) challenges.delete(id);
  return challenge;
}

/**
 * Put a previously-claimed challenge back in the lobby. Used when an accept
 * fails after the claim (e.g. game creation threw): a failed attempt must
 * not burn the creator's link. No-op if it already expired while we were
 * creating the game.
 */
export function restoreChallenge(challenge: Challenge): void {
  if (Date.now() <= challenge.expiresAt) {
    challenges.set(challenge.id, challenge);
  }
}

/** How many live challenges this user currently has open. */
export function countActiveChallengesFor(userId: string): number {
  let count = 0;
  for (const challenge of challenges.values()) {
    if (challenge.creatorUserId === userId) count += 1;
  }
  return count;
}

export const PER_USER_CHALLENGE_LIMIT = PER_USER_LIMIT;

/** Test hook. */
export function clearAllChallenges(): void {
  challenges.clear();
}

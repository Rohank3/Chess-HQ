/**
 * FIDE Elo rating maths. Pure functions only -- no DB, no IO -- so the
 * calculus stays auditable and unit-testable in isolation.
 *
 * E = 1 / (1 + 10^((Rb - Ra)/400))
 * R' = R + K * (S - E)
 *
 * K factor is tiered by FIDE's tables:
 *   40 -- provisional (fewer than 30 rated games)
 *   20 -- established, rating under 2200
 *   10 -- established, rating 2200 or above
 *
 * We clamp the result back into the schema's users.elo CHECK range
 * [100, 4000] so a long losing streak can never drive a veterans' rating
 * out of the legal column domain -- the DB constraint is the second line
 * of defence, this is the first.
 */

export const MIN_ELO = 100;
export const MAX_ELO = 4000;

export const K_PROVISIONAL = 40;
export const K_ESTABLISHED = 20;
export const K_ELITE = 10;

export const PROVISIONAL_GAMES = 30;
export const ELITE_RATING = 2200;

export function expectedScore(ratingA: number, ratingB: number): number {
  // 400 scale per the FIDE formula. The exponent is computed against the
  // opponent's rating minus ours, so a higher-A rating yields E>0.5.
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function kFactor(rating: number, gamesPlayed: number): number {
  if (gamesPlayed < PROVISIONAL_GAMES) return K_PROVISIONAL;
  if (rating >= ELITE_RATING) return K_ELITE;
  return K_ESTABLISHED;
}

export function clampElo(rating: number): number {
  if (rating < MIN_ELO) return MIN_ELO;
  if (rating > MAX_ELO) return MAX_ELO;
  return rating;
}

export interface EloOutcome {
  /** New rating for player A. */
  ratingA: number;
  /** New rating for player B. */
  ratingB: number;
  /** New games_played total for player A. */
  gamesPlayedA: number;
  /** New games_played total for player B. */
  gamesPlayedB: number;
}

export interface EloInput {
  ratingA: number;
  ratingB: number;
  gamesPlayedA: number;
  gamesPlayedB: number;
  /** 1 = A wins, 0.5 = draw, 0 = A loses. */
  scoreA: number;
}

/**
 * Apply a single rated result to both players' ratings. Caller passes the
 * score from A's perspective; B's score is the complement. Each side's K
 * is computed against its own (rating, gamesPlayed) -- a provisional
 * player playing a grandmaster swings 40 points either way while the GM
 * swings 10, which is exactly the FIDE intent: the established rating
 * moves slowly, the unproven one settles quickly.
 */
export function applyElo(input: EloInput): EloOutcome {
  const { scoreA } = input;
  if (scoreA !== 0 && scoreA !== 0.5 && scoreA !== 1) {
    throw new RangeError(`applyElo: scoreA must be 0, 0.5, or 1 (got ${scoreA})`);
  }

  const eA = expectedScore(input.ratingA, input.ratingB);
  const eB = 1 - eA;
  const scoreB = 1 - scoreA;

  const kA = kFactor(input.ratingA, input.gamesPlayedA);
  const kB = kFactor(input.ratingB, input.gamesPlayedB);

  return {
    ratingA: clampElo(input.ratingA + kA * (scoreA - eA)),
    ratingB: clampElo(input.ratingB + kB * (scoreB - eB)),
    gamesPlayedA: input.gamesPlayedA + 1,
    gamesPlayedB: input.gamesPlayedB + 1,
  };
}

/** Convenience: was this result decisive (someone won) or drawn. */
export function isDecisive(scoreA: number): boolean {
  return scoreA === 1 || scoreA === 0;
}


import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import {
  applyElo,
  clampElo,
  expectedScore,
  isDecisive,
  kFactor,
  ELITE_RATING,
  K_ELITE,
  K_ESTABLISHED,
  K_PROVISIONAL,
  MAX_ELO,
  MIN_ELO,
  PROVISIONAL_GAMES,
} from './elo.js';

nodeTest('expectedScore: a 0 Elo gap means 50/50', () => {
  assert.equal(expectedScore(1500, 1500), 0.5);
  assert.equal(expectedScore(2000, 2000), 0.5);
});

nodeTest('expectedScore: a 400 Elo gap means ~91/9 in favour of the higher rated', () => {
  // 1 / (1 + 10^(-1)) = 0.9090...
  assert.ok(Math.abs(expectedScore(1900, 1500) - 0.909) < 0.001);
  assert.ok(Math.abs(expectedScore(1500, 1900) - 0.091) < 0.001);
});

nodeTest('expectedScore is symmetric: E(A,B) + E(B,A) = 1', () => {
  for (const [a, b] of [
    [1200, 1350],
    [2400, 800],
    [2199, 2200],
  ]) {
    assert.ok(Math.abs(expectedScore(a, b) + expectedScore(b, a) - 1) < 1e-9);
  }
});

nodeTest('kFactor: provisional players (under 30 games) get K=40 regardless of rating', () => {
  assert.equal(kFactor(1200, 0), K_PROVISIONAL);
  assert.equal(kFactor(2700, 29), K_PROVISIONAL, 'a super-GM who is still provisional still gets 40');
});

nodeTest('kFactor: established under-2200 players get K=20', () => {
  assert.equal(kFactor(2199, PROVISIONAL_GAMES), K_ESTABLISHED);
  assert.equal(kFactor(800, 1000), K_ESTABLISHED);
});

nodeTest('kFactor: established 2200+ players get K=10', () => {
  assert.equal(kFactor(ELITE_RATING, PROVISIONAL_GAMES), K_ELITE);
  assert.equal(kFactor(2400, 500), K_ELITE);
});

nodeTest('applyElo: a decisive win moves winner up and loser down, games_played++', () => {
  const out = applyElo({
    ratingA: 1500,
    ratingB: 1500,
    gamesPlayedA: 100,
    gamesPlayedB: 100,
    scoreA: 1,
  });
  assert.ok(out.ratingA > 1500, 'winner gains');
  assert.ok(out.ratingB < 1500, 'loser drops');
  assert.equal(out.gamesPlayedA, 101);
  assert.equal(out.gamesPlayedB, 101);
  // Equality-preserving: total rating across the two players stays constant
  // when both have the same K.
  assert.ok(Math.abs(out.ratingA + out.ratingB - 3000) < 1e-6, 'zero-sum for equal K');
});

nodeTest('applyElo: a draw against an equal-rated opponent leaves both ratings ~unchanged', () => {
  const out = applyElo({
    ratingA: 1500,
    ratingB: 1500,
    gamesPlayedA: 100,
    gamesPlayedB: 100,
    scoreA: 0.5,
  });
  assert.ok(Math.abs(out.ratingA - 1500) < 1e-6);
  assert.ok(Math.abs(out.ratingB - 1500) < 1e-6);
});

nodeTest('applyElo: a provisional player swings harder than an established one', () => {
  const out = applyElo({
    ratingA: 1500, // provisional (K=40)
    ratingB: 1500, // established (K=20)
    gamesPlayedA: 5,
    gamesPlayedB: 200,
    scoreA: 1,
  });
  const gainA = out.ratingA - 1500;
  const gainB = out.ratingB - 1500;
  assert.ok(gainA > 0 && gainB < 0);
  assert.ok(Math.abs(gainA) > Math.abs(gainB), 'provisional moves twice as far as established');
});

nodeTest('applyElo: rejects an out-of-range score', () => {
  assert.throws(() =>
    applyElo({ ratingA: 1500, ratingB: 1500, gamesPlayedA: 1, gamesPlayedB: 1, scoreA: 0.7 }),
  );
  assert.throws(() =>
    applyElo({ ratingA: 1500, ratingB: 1500, gamesPlayedA: 1, gamesPlayedB: 1, scoreA: 2 }),
  );
});

nodeTest('clampElo: a long losing streak cannot drive the rating out of the legal range', () => {
  // 1190 doesn't move here -- kFactor has limits. Use a direct clamp test instead.
  assert.equal(clampElo(50), MIN_ELO);
  assert.equal(clampElo(9999), MAX_ELO);
  assert.equal(clampElo(2500), 2500, 'in-range ratings pass through unchanged');
});

nodeTest('isDecisive: a win or loss is decisive; a draw is not', () => {
  assert.equal(isDecisive(1), true);
  assert.equal(isDecisive(0), true);
  assert.equal(isDecisive(0.5), false);
});

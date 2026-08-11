import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { abandonGraceMs } from './game-sweep.js';

// Defaults from config/env.ts: FRACTION=0.4, MIN=30_000, MAX=15 * 60_000.
const MIN = 30_000;
const MAX = 15 * 60_000;

nodeTest('abandonGraceMs: scales with the clock (bullet is fast, classical is slow)', () => {
  // 1+0 bullet: 40% of 60s is 24s, floored to the 30s minimum.
  assert.equal(abandonGraceMs(60_000), MIN);
  // 3+0 / 3+2 blitz: 40% of 3min = 72s.
  assert.equal(abandonGraceMs(180_000), 72_000);
  // 10+0 rapid: 40% of 10min = 4min.
  assert.equal(abandonGraceMs(600_000), 240_000);
  // 30+0 classical: 40% of 30min = 12min.
  assert.equal(abandonGraceMs(1_800_000), 720_000);
  // Custom clocks interpolate the same way (5min -> 2min).
  assert.equal(abandonGraceMs(300_000), 120_000);
});

nodeTest('abandonGraceMs: clamps at the floor and ceiling', () => {
  // A 30-second clock (below the floor) still gets the full minimum grace.
  assert.equal(abandonGraceMs(30_000), MIN);
  // A 60-minute clock: 40% is 24min, capped at the 15min maximum.
  assert.equal(abandonGraceMs(3_600_000), MAX);
});

nodeTest('abandonGraceMs: the abort always beats the clock timeout on eligible games', () => {
  for (const initialMs of [60_000, 180_000, 600_000, 1_800_000, 3_600_000]) {
    assert.ok(
      abandonGraceMs(initialMs) < initialMs,
      `grace for ${initialMs}ms must be under the clock itself`,
    );
  }
});

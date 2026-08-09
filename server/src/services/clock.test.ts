import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMove,
  flagFallen,
  peekFlags,
  sideToMove,
  type ClockState,
  type Side,
} from './clock.js';

function initialClock(whiteMs: number, blackMs: number, lastMoveAt: number | null = null): ClockState {
  return { whiteMs, blackMs, lastMoveAt };
}

nodeTest('applyMove: the first move debits no time and awards no increment', () => {
  const state = initialClock(180_000, 180_000); // lastMoveAt null
  const out = applyMove({ state, mover: 'w', nowMs: 1000, incrementMs: 2000 });
  // lastMoveAt advances to nowMs, neither bank changes, elapsed is 0.
  assert.equal(out.elapsedMs, 0);
  assert.equal(out.state.whiteMs, 180_000);
  assert.equal(out.state.blackMs, 180_000);
  assert.equal(out.state.lastMoveAt, 1000);
});

nodeTest('applyMove: a subsequent move debits the mover and awards the increment', () => {
  // Last move was at t=1000 by White; next event is t=6000 by Black.
  // Elapsed on Black's clock = 5000ms; Black's bank: 180000 - 5000 + 2000.
  const state = initialClock(180_000, 180_000, 1000);
  const out = applyMove({ state, mover: 'b', nowMs: 6000, incrementMs: 2000 });
  assert.equal(out.elapsedMs, 5000);
  assert.equal(out.state.blackMs, 180_000 - 5000 + 2000);
  assert.equal(out.state.whiteMs, 180_000, 'opponent untouched');
  assert.equal(out.state.lastMoveAt, 6000);
});

nodeTest('applyMove: only the mover is touched, not the opponent', () => {
  const state = initialClock(120_000, 90_000, 500);
  const out = applyMove({ state, mover: 'w', nowMs: 1500, incrementMs: 0 });
  // White used 1000ms, no increment.
  assert.equal(out.state.whiteMs, 119_000);
  assert.equal(out.state.blackMs, 90_000, 'Black bank unchanged');
});

nodeTest('applyMove: a bank going negative is clamped to zero', () => {
  const state = initialClock(1000, 60_000, 0);
  // White uses 5000ms on a 1000ms bank -> clamped to 0, not -4000.
  const out = applyMove({ state, mover: 'w', nowMs: 5000, incrementMs: 0 });
  assert.equal(out.state.whiteMs, 0);
});

nodeTest('applyMove: a backward clock read (now < lastMoveAt) is treated as 0 elapsed', () => {
  // Defends against clock skew between the watchdog's Date.now() and the
  // move-event timestamp; an out-of-order tick can't *credit* a player.
  const state = initialClock(60_000, 60_000, 5000);
  const out = applyMove({ state, mover: 'w', nowMs: 3000, incrementMs: 0 });
  assert.equal(out.state.whiteMs, 60_000, 'no credit for a backwards clock');
  assert.equal(out.elapsedMs, 0);
});

nodeTest('flagFallen: zero is treated as flag-fallen so the watchdog fires', () => {
  assert.equal(flagFallen({ whiteMs: 0, blackMs: 60000, lastMoveAt: 5 }, 'w'), true);
  assert.equal(flagFallen({ whiteMs: 1, blackMs: 60000, lastMoveAt: 5 }, 'w'), false);
  assert.equal(flagFallen({ whiteMs: 60000, blackMs: 0, lastMoveAt: 5 }, 'b'), true);
});

nodeTest('sideToMove: before the first move, White is to move', () => {
  assert.equal(sideToMove({ whiteMs: 60000, blackMs: 60000, lastMoveAt: null }, null), 'w');
});

nodeTest('sideToMove: after White moved, Black is to move, and vice versa', () => {
  const s = { whiteMs: 60000, blackMs: 60000, lastMoveAt: 100 };
  assert.equal(sideToMove(s, 'w' as Side), 'b');
  assert.equal(sideToMove(s, 'b' as Side), 'w');
});

nodeTest('peekFlags: projects the side-to-move bank without persisting a tick', () => {
  // Last move t=1000 by White; Black to move. Now t=11000.
  // Black should have lost 10000ms; returned Black bank = 60000 - 10000.
  const state = initialClock(60_000, 60_000, 1000);
  const projected = peekFlags(state, 11_000, 'b');
  assert.equal(projected.blackMs, 50_000);
  assert.equal(projected.whiteMs, 60_000, 'opponent bank untouched');
  assert.equal(projected.lastMoveAt, 1000, 'lastMoveAt not advanced by peek');
});

nodeTest('peekFlags: before the first move, returns state unchanged', () => {
  const state = initialClock(60_000, 60_000);
  const projected = peekFlags(state, 99_000, 'w');
  assert.equal(projected.whiteMs, 60_000);
  assert.equal(projected.blackMs, 60_000);
});

nodeTest('integration: a 3-ply sequence with increment matches the by-hand math', () => {
  // Blitz 3+2: 180s each, +2s increment.
  // t=0:   White plays move 1 (first move). White clock: 180000, no increment.
  // t=3000:Black plays move 1. Black clock: 180000 - 3000 + 2000 = 179000.
  // t=8000:White plays move 2. White clock: 180000 - 5000 + 2000 = 177000.
  let state = initialClock(180_000, 180_000);
  state = applyMove({ state, mover: 'w', nowMs: 0, incrementMs: 2000 }).state;
  assert.equal(state.whiteMs, 180_000);
  assert.equal(state.blackMs, 180_000);
  state = applyMove({ state, mover: 'b', nowMs: 3000, incrementMs: 2000 }).state;
  assert.equal(state.blackMs, 179_000);
  assert.equal(state.whiteMs, 180_000);
  state = applyMove({ state, mover: 'w', nowMs: 8000, incrementMs: 2000 }).state;
  assert.equal(state.whiteMs, 177_000);
  assert.equal(state.blackMs, 179_000);
});

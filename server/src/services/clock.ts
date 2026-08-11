/**
 * Server-authoritative chess clock maths. Pure functions over a small
 * clock state object; the snapshot is the games row's white_ms, black_ms,
 * and last_move_at columns (Step 2 schema). Two reasons the clock lives on
 * the server and not the client:
 *
 *   - a lying client could claim "I have 90 seconds left" when the opponent
 *     flag has actually fallen. The server's snapshot is the only number
 *     that ends a game on timeout.
 *   - reconnects need a single source of truth. A tab refresh can't lose
 *     or invent clock time.
 *
 * The state here is keyed by absolute wall-clock milliseconds (Date.now()).
 * Callers are responsible for getting that from a monotonic-ish source;
 * the maths don't care.
 *
 * Increment convention (FIDE/Lichess): the player who just moved receives
 * `incrementMs` added to their bank AFTER the elapsed time has been
 * deducted. Games are created with `lastMoveAt` stamped at creation (the
 * first clock event), so the FIRST move is timed against game creation and
 * receives its increment like every other move -- White's clock is live
 * from the moment the game exists, not frozen until the first move.
 *
 * The `lastMoveAt === null` branch below is kept as a safety net for any
 * row created before this convention (it simply records the stamp without
 * debiting), but new games never hit it.
 */

export interface ClockState {
  /** White's remaining bank in milliseconds. */
  whiteMs: number;
  /** Black's remaining bank in milliseconds. */
  blackMs: number;
  /**
   * The wall-clock time of the most recent clock event. Set at game
   * creation (so White's clock runs from the start); afterwards it is the
   * time of the most recent move. The side to move is the opposite of the
   * side that made the last move (White while lastMoveAt is the creation
   * stamp). Null only on legacy rows / safety-net callers.
   */
  lastMoveAt: number | null;
}

export type Side = 'w' | 'b';

export interface ClockMoveInput {
  state: ClockState;
  /** The side that just completed a move. */
  mover: Side;
  /** Wall-clock ms of the move event. */
  nowMs: number;
  /** Per-move increment in ms (loaded from the games row's increment_ms). */
  incrementMs: number;
}

export interface ClockMoveResult {
  state: ClockState;
  /** Elapsed ms the mover spent thinking -- 0 on the very first move. */
  elapsedMs: number;
}

/**
 * Apply one move's worth of clock bookkeeping.
 *
 * With a real `lastMoveAt` (always set for new games -- stamped at
 * creation): the mover's bank is debited `(now - lastMoveAt)`, the mover's
 * bank is then credited `incrementMs`, and lastMoveAt is advanced. The
 * opponent's bank is untouched -- the *mover's* clock was running for the
 * entire interval since the previous move. (The clock runs against the
 * side to move; after they move, the other side's clock starts.) So we
 * debit the mover, not the opponent -- the interval between two moves is
 * the mover's thinking time on their own clock.
 *
 * Safety net: if `lastMoveAt === null` (a legacy row), no time is debited
 * and no increment is awarded; we simply record the stamp. This branch
 * exists only so old rows can't corrupt a clock -- new games never hit it.
 */
export function applyMove(input: ClockMoveInput): ClockMoveResult {
  const { state, mover, nowMs, incrementMs } = input;

  if (state.lastMoveAt === null) {
    // First move: no elapsed time has accumulated against any clock. We
    // store the stamp so the NEXT call can compute the second mover's
    // elapsed time.
    return {
      state: {
        whiteMs: state.whiteMs,
        blackMs: state.blackMs,
        lastMoveAt: nowMs,
      },
      elapsedMs: 0,
    };
  }

  const elapsedMs = Math.max(0, nowMs - state.lastMoveAt);
  const newWhiteMs = mover === 'w' ? state.whiteMs - elapsedMs + incrementMs : state.whiteMs;
  const newBlackMs = mover === 'b' ? state.blackMs - elapsedMs + incrementMs : state.blackMs;

  return {
    state: {
      whiteMs: Math.max(0, newWhiteMs),
      blackMs: Math.max(0, newBlackMs),
      lastMoveAt: nowMs,
    },
    elapsedMs,
  };
}

/** Has the given side's flag (run out of time) fallen? A flag at exactly
 * zero has fallen -- we want zero to read as "out of time" so the watchdog
 * fires deterministically rather than leaving a 0ms player live forever. */
export function flagFallen(state: ClockState, side: Side): boolean {
  return side === 'w' ? state.whiteMs <= 0 : state.blackMs <= 0;
}

/**
 * The side whose clock is currently running (the side to move). null for
 * the pre-first-move state, where technically White's clock is "running"
 * but no clock event has occurred yet -- callers should treat null as
 * "no flag can have fallen yet" rather than inflating a fake tick.
 */
export function sideToMove(state: ClockState, lastMover: Side | null): Side | null {
  if (state.lastMoveAt === null) return 'w';
  if (lastMover === null) return null;
  return lastMover === 'w' ? 'b' : 'w';
}

/**
 * Debit a side's bank for the time elapsed since the last move, WITHOUT
 * advancing lastMoveAt -- used by the timeout watchdog to check "would
 * the side to move's flag fall right now?" without committing a tick.
 *
 * Returns the projected remaining balances, so the watchdog can compare
 * against zero and fire endGame on timeout if it would.
 */
export function peekFlags(state: ClockState, nowMs: number, toMove: Side): ClockState {
  if (state.lastMoveAt === null) return state; // no clock running yet
  const elapsed = Math.max(0, nowMs - state.lastMoveAt);
  return {
    whiteMs: toMove === 'w' ? Math.max(0, state.whiteMs - elapsed) : state.whiteMs,
    blackMs: toMove === 'b' ? Math.max(0, state.blackMs - elapsed) : state.blackMs,
    lastMoveAt: state.lastMoveAt,
  };
}

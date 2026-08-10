import { useEffect, useState } from 'react';
import type { Color } from './types';

export interface UseTimerProps {
  whiteMs: number;
  blackMs: number;
  lastMoveAt: string | null;
  turn: Color;
  isGameOver: boolean;
}

export interface UseTimerResult {
  whiteMs: number;
  blackMs: number;
  flagFallen: boolean;
}

const TICK_MS = 100;

/**
 * Client-side chess clock interpolation.
 *
 * The server is authority: every `game:state` carries the persisted
 * `{ whiteMs, blackMs, lastMoveAt }` (the bank totals and the wall-clock at
 * the last move). It never ticks periodically; the watchdog only fires on a
 * flag fall. The client must display an ALIVE countdown, so this hook
 * recomputes the side-to-move's bank every 100ms off `lastMoveAt` and lets
 * the other side's bank stay at its authored value.
 *
 * Re-syncs whenever the authored `whiteMs`/`blackMs`/`lastMoveAt` props
 * change (i.e. a fresh `game:state` arrived): the authored values REPLACE the
 * interpolated state, so client drift is corrected on every move broadcast.
 * While `lastMoveAt === null` (pre-first-move) the bank doesn't tick.
 *
 * `flagFallen` flips true when the live-interpolated side-to-move bank hits
 * zero. We don't fire anything on flag fall client-side; the server's watchdog
 * is the only thing allowed to actually end a game on time.
 */
export function useTimer(props: UseTimerProps): UseTimerResult {
  const { whiteMs, blackMs, lastMoveAt, turn, isGameOver } = props;
  const [state, setState] = useState<UseTimerResult>({
    whiteMs,
    blackMs,
    flagFallen: false,
  });

  // Sync authored values on every authoritative `game:state`.
  useEffect(() => {
    setState({ whiteMs, blackMs, flagFallen: Math.min(whiteMs, blackMs) <= 0 });
  }, [whiteMs, blackMs]);

  // Tick once every TICK_MS to debit the side-to-move against wall-clock time.
  useEffect(() => {
    if (isGameOver || lastMoveAt === null) return;
    const lastMs = Date.parse(lastMoveAt);
    if (!Number.isFinite(lastMs)) return;

    const tick = () => {
      const elapsed = Date.now() - lastMs;
      setState((prev) => {
        let nextWhite = prev.whiteMs;
        let nextBlack = prev.blackMs;
        if (turn === 'w') nextWhite = Math.max(0, whiteMs - elapsed);
        else nextBlack = Math.max(0, blackMs - elapsed);
        return {
          whiteMs: turn === 'w' ? nextWhite : whiteMs,
          blackMs: turn === 'b' ? nextBlack : blackMs,
          flagFallen: (turn === 'w' ? nextWhite : nextBlack) <= 0,
        };
      });
    };
    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [lastMoveAt, turn, isGameOver, whiteMs, blackMs]);

  return state;
}

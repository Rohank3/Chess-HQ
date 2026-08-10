import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { emitWithAck } from './emit';
import type { MatchedPayload, QueueJoinInput } from './types';

export type QueueState = 'idle' | 'searching' | 'matched' | 'error';

export interface UseMatchmakingResult {
  queueState: QueueState;
  error: string | null;
  match: MatchedPayload | null;
  joinedAt: number | null;
  /** width of the server's elo search delta at the current wait time, 50..400 */
  searchDelta: number;
  joinQueue: (input: QueueJoinInput) => Promise<void>;
  leaveQueue: () => void;
  reset: () => void;
}

const INITIAL_DELTA = 50;
const MAX_DELTA = 400;
const WIDEN_STEP = 10;
const WIDEN_EVERY_MS = 5_000;

/**
 * Drives the ranked matchmaking queue.
 *
 * The server's `queue:join` ack tells the joiner `status:'queued'` or
 * `status:'matched'`; the server separately emits `queue:matched` to BOTH
 * matched sockets (the joiner and the matching peer). We treat
 * `queue:matched` as the canonical "you've been matched" signal -- both
 * sockets see it -- and store the matched payload (gameId, color, opponent,
 * timeControl, initialMs, incrementMs) on `match`.
 *
 * The elo search delta the server uses widens as `min(50 + floor(waitSec/5)*10, 400)`.
 * The server doesn't broadcast the widening, so we recompute it client-side
 * off `joinedAt` purely for the UI's "search window" progress bar.
 *
 * Guests are blocked at the server (`guest_restricted` ack error); we surface
 * that one as the typed `error`.
 */
export function useMatchmaking(): UseMatchmakingResult {
  const { socket } = useSocket();
  const [queueState, setQueueState] = useState<QueueState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchedPayload | null>(null);
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const [searchDelta, setSearchDelta] = useState<number>(INITIAL_DELTA);
  const widenTimerRef = useRef<number | null>(null);

  const stopWidening = useCallback(() => {
    if (widenTimerRef.current !== null) {
      window.clearInterval(widenTimerRef.current);
      widenTimerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopWidening();
    setQueueState('idle');
    setError(null);
    setMatch(null);
    setJoinedAt(null);
    setSearchDelta(INITIAL_DELTA);
  }, [stopWidening]);

  // Subscribe to the canonical matched signal. Listener lives for the life
  // of the hook, filtered by gameId on the receiver side (n/a here -- an
  // arbitrary socket only ever receives a `queue:matched` when the server
  // pairs that socket).
  useEffect(() => {
    if (!socket) return;
    const onMatched = (payload: MatchedPayload) => {
      stopWidening();
      setJoinedAt(null);
      setMatch(payload);
      setQueueState('matched');
      setError(null);
    };
    socket.on('queue:matched', onMatched);
    return () => {
      socket.off('queue:matched', onMatched);
    };
  }, [socket, stopWidening]);

  const startWidening = useCallback(() => {
    stopWidening();
    widenTimerRef.current = window.setInterval(() => {
      setSearchDelta((d) => Math.min(MAX_DELTA, d + WIDEN_STEP));
    }, WIDEN_EVERY_MS);
  }, [stopWidening]);

  const leaveQueue = useCallback(() => {
    if (socket?.connected) socket.emit('queue:leave');
    stopWidening();
    setJoinedAt(null);
    setSearchDelta(INITIAL_DELTA);
    setQueueState('idle');
    setError(null);
  }, [socket, stopWidening]);

  const joinQueue = useCallback(
    async (input: QueueJoinInput) => {
      // If we already matched, no-op; the consumer should navigate to /game/<id>.
      if (queueState === 'matched') return;
      // Don't hang on a silent queue forever: if the socket is gone (or
      // never connected), the queued emit would never get an ack. Fail
      // fast with a visible error instead of an infinite spinner.
      if (!socket || (!socket.connected && !socket.active)) {
        setQueueState('error');
        setError('Not connected to the server — check your connection and try again.');
        return;
      }
      setQueueState('searching');
      setError(null);
      setJoinedAt(Date.now());
      setSearchDelta(INITIAL_DELTA);
      startWidening();
      const ack = await emitWithAck(socket, 'queue:join', input);
      if (!ack.ok) {
        stopWidening();
        setJoinedAt(null);
        // Prefer the server's real message over the generic error code.
        setError(ack.message ?? ack.error);
        setQueueState('error');
        return;
      }
      if (ack.status === 'matched') {
        // The matched event is the canonical one (carries opponent + color),
        // but if the ack got here first, treat it as matched too -- the server
        // is about to emit `queue:matched` and our listener will hydrate
        // the `match` payload. Don't reset joinedAt; the event handler will.
        setQueueState('matched');
        stopWidening();
      }
      // status === 'queued': stay searching; the matched handler will transition.
    },
    [queueState, socket, startWidening, stopWidening],
  );

  return {
    queueState,
    error,
    match,
    joinedAt,
    searchDelta,
    joinQueue,
    leaveQueue,
    reset,
  };
}


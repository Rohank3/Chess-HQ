import { useCallback, useEffect, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useToast } from '../context/ToastContext';
import { emitWithAck } from './emit';
import type {
  Ack,
  DrawDeclinedPayload,
  DrawOfferedPayload,
  GameOverPayload,
  GameSnapshot,
  MoveInput,
} from './types';

export interface UseGameInput {
  gameId: string | null;
}

export interface UseGameResult {
  snapshot: GameSnapshot | null;
  gameOver: GameOverPayload | null;
  drawOffer: { offeredBy: 'w' | 'b'; expiresAt: string } | null;
  sanHistory: string[];
  pendingIllegalRollback: boolean;
  lastAckError: string | null;
  makeMove: (input: MoveInput) => Promise<Ack>;
  resign: () => Promise<Ack>;
  offerDraw: () => Promise<Ack>;
  acceptDraw: () => Promise<Ack>;
  declineDraw: () => Promise<Ack>;
}

/**
 * Binds the client's socket subscription for one game. The server is
 * authoritative: every move/draw/over event the client can emit has an ack
 * envelope `{ ok, error?, message?, status?, ... }`; the actions return the
 * ack as a typed promise so the caller can decide how to handle a `forbidden`
 * or `illegal_move` rejection.
 *
 * One subscription lifecycle per `gameId`: bound in `useEffect` and torn down
 * in the cleanup, so the listeners never leak across navigations. Each
 * handler filters by `payload.gameId` to the bound gameId so a stale event
 * from a game we already left cannot overwrite the current state.
 *
 * `sanHistory` is accumulated client-side from each `game:state.lastMove.san`
 * that arrives for the bound game (a fresh snapshot only carries the *last*
 * move, so this append-only build is the client's source of truth for the
 * move-list panel). Duplicates (a re-broadcast of the same lastMove) are
 * suppressed by timestamp difference against the snapshot's lastMoveAt.
 */
export function useGame({ gameId }: UseGameInput): UseGameResult {
  const { socket } = useSocket();
  const { push } = useToast();
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [gameOver, setGameOver] = useState<GameOverPayload | null>(null);
  const [drawOffer, setDrawOffer] = useState<{ offeredBy: 'w' | 'b'; expiresAt: string } | null>(
    null,
  );
  const [sanHistory, setSanHistory] = useState<string[]>([]);
  const [pendingIllegalRollback, setPendingIllegalRollback] = useState(false);
  const [lastAckError, setLastAckError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId || !socket) return;

    // Ask the server for the current state. game:state is otherwise only
    // broadcast on a move/game-over, so a freshly adopted game (match or
    // challenge) would sit on a blank board with zeroed clocks forever
    // without this. Re-subscribing on every 'connect' covers reconnects.
    const subscribe = () => {
      socket.emit('game:subscribe', { gameId });
    };

    const onState = (snap: GameSnapshot) => {
      if (snap.gameId !== gameId) return;
      setSnapshot(snap);
      setPendingIllegalRollback(false);
      // Append the new san if it's a fresh move. We compare against the
      // last entry to suppress re-broadcasts; the server sends a snapshot
      // on every move and on the terminal path (where lastMove may be null).
      if (snap.lastMove) {
        const san = snap.lastMove.san;
        setSanHistory((prev) => {
          if (prev.length > 0 && prev[prev.length - 1] === san) return prev;
          return [...prev, san];
        });
      }
      if (snap.drawOffer) {
        setDrawOffer(snap.drawOffer);
      } else {
        setDrawOffer(null);
      }
    };
    const onOver = (over: GameOverPayload) => {
      if (over.gameId !== gameId) return;
      setGameOver(over);
    };
    const onDrawOffered = (p: DrawOfferedPayload) => {
      if (p.gameId !== gameId) return;
      setDrawOffer({ offeredBy: p.offeredBy, expiresAt: p.expiresAt });
    };
    const onDrawDeclined = (p: DrawDeclinedPayload) => {
      if (p.gameId !== gameId) return;
      setDrawOffer(null);
    };

    socket.on('game:state', onState);
    socket.on('game:over', onOver);
    socket.on('game:draw:offered', onDrawOffered);
    socket.on('game:draw:declined', onDrawDeclined);
    socket.on('connect', subscribe);

    subscribe();

    return () => {
      socket.off('game:state', onState);
      socket.off('game:over', onOver);
      socket.off('game:draw:offered', onDrawOffered);
      socket.off('game:draw:declined', onDrawDeclined);
      socket.off('connect', subscribe);
    };
  }, [gameId, socket]);

  // Reset everything when the gameId changes (or becomes null).
  useEffect(() => {
    setSnapshot(null);
    setGameOver(null);
    setDrawOffer(null);
    setSanHistory([]);
    setPendingIllegalRollback(false);
    setLastAckError(null);
  }, [gameId]);

  const rememberErr = useCallback(
    (ack: Ack) => {
      if (!ack.ok) {
        setLastAckError(ack.error);
        if (ack.message) push('error', ack.message);
      }
      return ack;
    },
    [push],
  );

  const makeMove = useCallback(
    async (input: MoveInput): Promise<Ack> => {
      const ack = await emitWithAck(socket, 'game:move', input);
      if (!ack.ok) {
        // illegal_move / not_your_turn / game_already_over from the server
        // mark the present board view as needing rollback; the next
        // `game:state` rebuilds the mirror off the authorised fen.
        setPendingIllegalRollback(true);
      }
      return rememberErr(ack);
    },
    [socket, rememberErr],
  );

  const resign = useCallback(async (): Promise<Ack> => {
    if (!gameId) return { ok: false, error: 'no_active_game', message: 'No active game' };
    const ack = await emitWithAck(socket, 'game:resign', { gameId });
    return rememberErr(ack);
  }, [gameId, socket, rememberErr]);

  const offerDraw = useCallback(async (): Promise<Ack> => {
    if (!gameId) return { ok: false, error: 'no_active_game', message: 'No active game' };
    const ack = await emitWithAck(socket, 'game:draw:offer', { gameId });
    return rememberErr(ack);
  }, [gameId, socket, rememberErr]);

  const acceptDraw = useCallback(async (): Promise<Ack> => {
    if (!gameId) return { ok: false, error: 'no_active_game', message: 'No active game' };
    const ack = await emitWithAck(socket, 'game:draw:accept', { gameId });
    return rememberErr(ack);
  }, [gameId, socket, rememberErr]);

  const declineDraw = useCallback(async (): Promise<Ack> => {
    if (!gameId) return { ok: false, error: 'no_active_game', message: 'No active game' };
    const ack = await emitWithAck(socket, 'game:draw:decline', { gameId });
    return rememberErr(ack);
  }, [gameId, socket, rememberErr]);

  return {
    snapshot,
    gameOver,
    drawOffer,
    sanHistory,
    pendingIllegalRollback,
    lastAckError,
    makeMove,
    resign,
    offerDraw,
    acceptDraw,
    declineDraw,
  };
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Chess } from 'chess.js';
import { useMatchmaking, type UseMatchmakingResult } from '../game/useMatchmaking';
import { useGame, type UseGameResult } from '../game/useGame';
import type { CommandColor, MoveInput, PieceCounts } from '../game/types';

// ---------- Piece + promotion constants (kept here; small + stable) --------

const PIECE_VALUES: PieceCounts = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const UNICODE_GLYPHS: Record<'w' | 'b', Record<string, string>> = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' },
};

export interface PendingPromotion {
  from: string;
  to: string;
  color: CommandColor;
}

interface GameContextValue {
  matchmaking: UseMatchmakingResult;
  game: UseGameResult;
  // identity-driven game state
  gameId: string | null;
  myColor: CommandColor | null;
  opponent: { id: string; username: string; elo: number } | null;
  // optimistic local chess mirror; the FEN the board renders.
  optimisticFen: string | null;
  // pending promotion state exposes the dialog and resolves submitMove.
  pendingPromotion: PendingPromotion | null;
  cancelPromotion: () => void;
  // called by the PromotionDialog once the user picks a piece.
  resolvePromotion: (promotion: 'q' | 'r' | 'b' | 'n') => void;
  // the synchronous handler used by react-chessboard's onPieceDrop. Returns
  // true to accept and keep the piece on the target square, false to snap back.
  submitMove: (args: { piece: { pieceType: string }; sourceSquare: string; targetSquare: string | null }) => boolean;
  // utility consumers (CapturedPieces) can read directly off the snapshot; we
  // also expose the unicode glyph map and material weighting for reuse.
  unicodeGlyphs: typeof UNICODE_GLYPHS;
}

const GameContext = createContext<GameContextValue | null>(null);

/**
 * The game-room provider. Ties together the matchmaking flow, the per-game
 * socket subscription, and the optimistic-render contract.
 *
 * Optimization model (server-authoritative):
 *   1. The user drags a piece; `submitMove` runs synchronously and consults
 *      a local chess.js mirror of the authoritative FEN for legality.
 *   2. If the move is illegal -- `chess.move()` throws -- return false so
 *      react-chessboard snaps the piece back. No round trip.
 *   3. If the move needs a promotion and the caller didn't pass one, capture
 *      the drag as `pendingPromotion`, return false (snap back), and let the
 *      PromotionDialog resolve it before re-submitting with the promotion.
 *   4. If legal + no promotion: optimistically advance the local mirror,
 *      set `optimisticFen` to the post-move FEN so the board animates
 *      instantly, return true. Fire `game.makeMove` async. On a server
 *      rejection (`illegal_move`/`not_your_turn`/`game_already_over`) or when
 *      the next `game:state` lands, reconcile `optimisticFen` to the
 *      server's authoritative FEN -- a brief rewind is the only honest UX.
 *
 * The `optimisticFen` is a reflection of EITHER the server's last snapshot
 * fen OR the optimistically-applied local move ahead of the next snapshot.
 * It only diverges during the few hundred ms between `game:move` and the
 * next `game:state`; once the snapshot lands, it snaps back to the server.
 */
export function GameProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const matchmaking = useMatchmaking();
  const { queueState, match } = matchmaking;

  // The active game identity. Set when `queue:matched` arrives OR when the
  // host mounted this provider with a seeded `seedGameId` (later: rejoin path).
  const [gameId, setGameId] = useState<string | null>(null);
  const [myColor, setMyColor] = useState<CommandColor | null>(null);
  const [opponent, setOpponent] = useState<{ id: string; username: string; elo: number } | null>(
    null,
  );
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [optimisticFen, setOptimisticFen] = useState<string | null>(null);

  // The local chess.js mirror for the authoritative (server) FEN. This is a
  // ref -- it's a working copy of the board, not something we want to use as
  // React state. The board's `position` prop is `optimisticFen` (state), and
  // this mirror is the source for legal-move + promotion-detection checks.
  const authoritativeRef = useRef<Chess | null>(null);

  const game = useGame({ gameId });

  // When the matchmaking layer transitions to 'matched', adopt the matched
  // gameId + color + opponent. The page can then navigate to /game/<id>.
  useEffect(() => {
    if (queueState === 'matched' && match) {
      setGameId(match.gameId);
      setMyColor(match.color);
      setOpponent(match.opponent);
    }
  }, [queueState, match]);

  // Re-sync the local chess mirror from the authoritative snapshot.
  useEffect(() => {
    if (game.snapshot) {
      try {
        authoritativeRef.current = new Chess(game.snapshot.fen);
      } catch {
        authoritativeRef.current = null;
      }
      // The optimistic fen always re-converges to the server's authoritative fen
      // once a snapshot arrives -- it's the trusted reset point.
      setOptimisticFen(game.snapshot.fen);
    }
  }, [game.snapshot]);

  const cancelPromotion = useCallback(() => setPendingPromotion(null), []);

  const submitMove: GameContextValue['submitMove'] = useCallback(
    ({ piece, sourceSquare, targetSquare }) => {
      if (!gameId || !myColor || !authoritativeRef.current || targetSquare === null) return false;
      // The user can only drag during their own turn. The authoritativeRef
      // mirrors the server, so .turn() is the trusted value.
      if (authoritativeRef.current.turn() !== myColor) return false;

      // Detect a promotion pre-emptively: if the piece on `sourceSquare` is a
      // pawn and `targetSquare` is on the last rank, this needs a promotion
      // piece. The caller doesn't know which, so we snap-back and ask.
      const sourceStr = sourceSquare;
      const targetStr = targetSquare;
      const movingPiece = piece?.pieceType ?? '';
      const isLastRank =
        (myColor === 'w' && targetStr.endsWith('8')) ||
        (myColor === 'b' && targetStr.endsWith('1'));
      const needsPromotion = (movingPiece === 'p' || movingPiece === 'P') && isLastRank;
      if (needsPromotion) {
        setPendingPromotion({ from: sourceStr, to: targetStr, color: myColor });
        return false; // snap-back; the dialog will re-submit with promotion.
      }

      // Optimistic local pre-check: chess.js throws on illegal moves.
      const trial = new Chess(authoritativeRef.current.fen());
      try {
        trial.move({ from: sourceStr, to: targetStr });
      } catch {
        return false;
      }

      // Optimistic apply for the render. We re-run on the same authoritative
      // fen; if it throws here it's already failed above, so this is safe.
      const applied = new Chess(authoritativeRef.current.fen());
      try {
        applied.move({ from: sourceStr, to: targetStr });
        authoritativeRef.current = applied;
        setOptimisticFen(applied.fen());
      } catch {
        return false;
      }

      // Fire the server move async. On ack, no UI action; the next game:state
      // drives the reconcile. On !ok, we roll the optimistic mirror back to
      // the last authoritative fen.
      const input: MoveInput = { gameId, from: sourceStr, to: targetStr };
      void game.makeMove(input).then((ack) => {
        if (!ack.ok && game.snapshot) {
          // Roll the mirror + render back to the last authoritative fen so the
          // wrong move visually reverts. The user can try again.
          try {
            authoritativeRef.current = new Chess(game.snapshot.fen);
            setOptimisticFen(game.snapshot.fen);
          } catch {
            // best-effort revert; ignore corrupt fen
          }
        }
      });

      return true;
    },
    [gameId, myColor, game, game.snapshot],
  );

  // Resolve a promotion: the pendingPromotion is set; the user picked `q/r/b/n`.
  // This is invoked from the PromotionDialog, NOT from onPieceDrop.
  const resolvePromotion = useCallback(
    (promotion: 'q' | 'r' | 'b' | 'n') => {
      const pending = pendingPromotion;
      if (!pending || !gameId || !authoritativeRef.current || !myColor) {
        setPendingPromotion(null);
        return;
      }
      const trial = new Chess(authoritativeRef.current.fen());
      try {
        trial.move({ from: pending.from, to: pending.to, promotion });
      } catch {
        setPendingPromotion(null);
        return;
      }
      const applied = new Chess(authoritativeRef.current.fen());
      try {
        applied.move({ from: pending.from, to: pending.to, promotion });
        authoritativeRef.current = applied;
        setOptimisticFen(applied.fen());
      } catch {
        setPendingPromotion(null);
        return;
      }
      setPendingPromotion(null);
      const input: MoveInput = { gameId, from: pending.from, to: pending.to, promotion };
      void game.makeMove(input);
    },
    [pendingPromotion, gameId, myColor, game],
  );

  const value = useMemo<GameContextValue>(
    () => ({
      matchmaking,
      game,
      gameId,
      myColor,
      opponent,
      optimisticFen,
      pendingPromotion,
      cancelPromotion,
      resolvePromotion,
      submitMove,
      unicodeGlyphs: UNICODE_GLYPHS,
    }),
    [
      matchmaking,
      game,
      gameId,
      myColor,
      opponent,
      optimisticFen,
      pendingPromotion,
      cancelPromotion,
      resolvePromotion,
      submitMove,
    ],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameContext must be used inside a GameProvider');
  return ctx;
}

/** Hook reserved for caller-side material-balance arithmetic against the
 *  captured counts. Kept here so the weight map lives in one place. */
export function useCapturedMaterial(captured: {
  white: PieceCounts;
  black: PieceCounts;
}): { white: number; black: number } {
  const score = (side: PieceCounts): number =>
    side.p * PIECE_VALUES.p +
    side.n * PIECE_VALUES.n +
    side.b * PIECE_VALUES.b +
    side.r * PIECE_VALUES.r +
    side.q * PIECE_VALUES.q;
  return useMemo(() => ({ white: score(captured.white), black: score(captured.black) }), [captured]);
}

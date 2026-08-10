import { useGameContext } from '../context/GameContext';
import type { CommandColor } from '../game/types';

const PROMOTION_PIECES: ReadonlyArray<{ key: 'q' | 'r' | 'b' | 'n'; name: string }> = [
  { key: 'q', name: 'Queen' },
  { key: 'r', name: 'Rook' },
  { key: 'b', name: 'Bishop' },
  { key: 'n', name: 'Knight' },
];

const GLYPHS: Record<CommandColor, Record<'q' | 'r' | 'b' | 'n', string>> = {
  w: { q: '♕', r: '♖', b: '♗', n: '♘' },
  b: { q: '♛', r: '♜', b: '♝', n: '♞' },
};

/**
 * Promotion chooser. The GameContext's `submitMove` detects a pending
 * promotion (pawn hits the last rank with no promotion field), captures the
 * (from, to) drag, snaps the piece back, and sets `pendingPromotion`. This
 * component renders as long as the pending state is live and resolves the
 * move with the chosen piece through `resolvePromotion`.
 *
 * v5's `onPieceDrop` is synchronous, so the snap-back-then-ask flow is the
 * only honest UX short of bugging react-chessboard's internals.
 */
export function PromotionDialog(): React.JSX.Element | null {
  const { pendingPromotion, resolvePromotion, cancelPromotion } = useGameContext();
  if (!pendingPromotion) return null;
  const color: CommandColor = pendingPromotion.color;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
      onClick={cancelPromotion}
    >
      <div
        role="dialog"
        aria-label="Choose promotion piece"
        className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-medium tracking-wide text-slate-400 uppercase">
          Promote pawn to…
        </h2>
        <div className="mt-4 flex gap-2">
          {PROMOTION_PIECES.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-label={`Promote to ${p.name}`}
              onClick={() => resolvePromotion(p.key)}
              className="flex size-16 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-3xl text-slate-100 transition hover:border-neon-500 hover:bg-slate-800 hover:text-neon-400"
            >
              {GLYPHS[color][p.key]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={cancelPromotion}
          className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-2 text-xs font-semibold text-slate-400 transition hover:border-slate-600 hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

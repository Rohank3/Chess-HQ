import { useEffect, useRef } from 'react';
import { useGameContext } from '../context/GameContext';

/**
 * Scrollable SAN move list. The game:state snapshot only carries the latest
 * `lastMove.san`, so `useGame` accumulates the full history client-side in
 * its `sanHistory` state (dedup against the previous tail) -- we just render
 * that array. Auto-scrolls to the bottom on append.
 */
export function MoveListSidebar(): React.JSX.Element {
  const { game } = useGameContext();
  const history = game.sanHistory;
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [history.length]);

  // Pair up White/Black side-by-side -- index 0,1 = move 1; 2,3 = move 2; ...
  const rows: Array<{ n: number; w: string | null; b: string | null }> = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({
      n: Math.floor(i / 2) + 1,
      w: history[i] ?? null,
      b: history[i + 1] ?? null,
    });
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-4 py-3 text-xs font-medium tracking-wide text-slate-400 uppercase">
        Moves
      </div>
      <div
        ref={scrollerRef}
        className="scrollbar-slim flex-1 overflow-y-auto px-3 py-2"
      >
        {rows.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-slate-500">No moves yet.</p>
        ) : (
          <ol className="space-y-0.5 font-mono text-sm">
            {rows.map((row) => (
              <li key={row.n} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-right text-xs text-slate-500">
                  {row.n}.
                </span>
                <span className="flex-1 rounded px-1.5 py-0.5 text-slate-200">
                  {row.w ?? ''}
                </span>
                <span className="flex-1 rounded px-1.5 py-0.5 text-slate-400">
                  {row.b ?? ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

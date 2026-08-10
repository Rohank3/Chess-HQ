import { useGameContext, useCapturedMaterial } from '../context/GameContext';
import type { CommandColor, PieceCounts } from '../game/types';

interface CapturedPiecesProps {
  /** the color whose spoils this tray shows (= whose turn side it sits on). */
  by: CommandColor;
}

// Order pieces high-value-first so the tray reads naturally.
const ORDER: ReadonlyArray<keyof PieceCounts> = ['q', 'r', 'b', 'n', 'p'];

/**
 * A captured-pieces tray. The server's `captured` snapshot is grouped by
 * CAPTOR (see game.ts:578-609): `captured.white` = the pieces White has
 * captured (Black's lost pieces); `captured.black` = vice versa.
 *
 * So a tray of `by="w"` shows `captured.white` -- the spoils White has taken.
 * The +N material advantage label is `white - black` from White's tray,
 * the inverse from Black's.
 */
export function CapturedPieces({ by }: CapturedPiecesProps): React.JSX.Element {
  const { game, unicodeGlyphs } = useGameContext();
  const captured = game.snapshot?.captured;
  const empty: PieceCounts = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  // `captured.white` = White's spoils. Map our `by` (a CommandColor 'w'|'b')
  // onto the snake-case keys of CapturedDelta.
  const mine: PieceCounts = (captured ? (by === 'w' ? captured.white : captured.black) : empty) as PieceCounts;
  const material = useCapturedMaterial({
    white: captured?.white ?? empty,
    black: captured?.black ?? empty,
  });
  const advantage = by === 'w' ? material.white - material.black : material.black - material.white;

  return (
    <div className="flex h-6 items-center gap-0.5 text-slate-300">
      {ORDER.map((kind) => {
        const count = mine[kind];
        if (count <= 0) return null;
        // White's spoils are Black's lost pieces -- render the Black glyph.
        // Black's spoils are White's lost pieces -- render the White glyph.
        const glyphColor: CommandColor = by === 'w' ? 'b' : 'w';
        const glyph = unicodeGlyphs[glyphColor][kind];
        return (
          <span key={kind} className="flex items-center" aria-hidden>
            {Array.from({ length: count }).map((_, i) => (
              <span key={i} className="text-base leading-none">
                {glyph}
              </span>
            ))}
          </span>
        );
      })}
      {advantage > 0 && (
        <span className="ml-1.5 font-mono text-xs text-slate-400">+{advantage}</span>
      )}
    </div>
  );
}

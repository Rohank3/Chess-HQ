import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useGameContext } from '../context/GameContext';
import type { Termination } from '../game/types';

const TERMINATION_LABEL: Record<Termination, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  draw_threefold: 'Threefold repetition',
  draw_fiftymove: 'Fifty-move rule',
  draw_insufficient: 'Insufficient material',
  draw_agreed: 'Draw agreed',
  resignation: 'Resignation',
  timeout: 'Time out',
  aborted: 'Aborted',
};

/**
 * Game-over modal. Triggered by `game.gameOver` (the canonical end signal
 * from the server; it carries the Elo before/after deltas which we display).
 * Result framing is from the local player's perspective: if `winner` matches
 * my userId → Victory; opponent won → Defeat; null winner → Draw.
 */
export function GameOverModal(): React.JSX.Element | null {
  const { user } = useAuth();
  const { game, opponent, matchmaking } = useGameContext();
  const navigate = useNavigate();
  const over = game.gameOver;
  if (!over) return null;

  const myWon = user && over.winner === user.id;
  const isDraw = over.winner === null;
  const title = isDraw ? 'Draw' : myWon ? 'Victory' : 'Defeat';
  const titleColor = isDraw
    ? 'text-slate-200'
    : myWon
      ? 'text-accent-emerald'
      : 'text-accent-rose';
  const borderColor = isDraw
    ? 'border-slate-700'
    : myWon
      ? 'border-accent-emerald/40'
      : 'border-accent-rose/40';

  // Elo deltas. Show them only for the player's own colour (we know myColor
  // from the matched context; compare against the white/black before/after
  // via myColor index).
  const myColor = matchmaking.match?.color;
  const myEloBefore = myColor === 'w' ? over.whiteEloBefore : over.blackEloBefore;
  const myEloAfter = myColor === 'w' ? over.whiteEloAfter : over.blackEloAfter;
  const delta = myEloBefore !== null && myEloAfter !== null ? myEloAfter - myEloBefore : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
      <div className={`w-full max-w-sm rounded-2xl border ${borderColor} bg-slate-900 p-8 shadow-xl`}>
        <h2 className={`text-3xl font-bold ${titleColor}`}>{title}</h2>
        <p className="mt-2 text-sm text-slate-400">
          {opponent ? `vs ${opponent.username}` : 'Opponent'} ·{' '}
          {TERMINATION_LABEL[over.termination] ?? over.termination}
        </p>

        {delta !== null && (
          <p className="mt-4 font-mono text-sm text-slate-300">
            Elo {myEloBefore} → {myEloAfter}{' '}
            <span className={delta > 0 ? 'text-accent-emerald' : delta < 0 ? 'text-accent-rose' : 'text-slate-400'}>
              {delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '±0'}
            </span>
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
          >
            Back to dashboard
          </button>
          <button
            type="button"
            onClick={() => navigate('/game')}
            className="flex-1 rounded-lg bg-neon-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-neon-400"
          >
            New game
          </button>
        </div>
      </div>
    </div>
  );
}

import { useGameContext } from '../context/GameContext';

// Match the server's widening ceiling (server: maxDeltaElo=400).
const MAX_DELTA = 400;

interface PresetProps {
  timeControl: string;
  label: string;
  detail: string;
  initialMs: number;
  incrementMs: number;
}

const PRESETS: PresetProps[] = [
  { timeControl: 'blitz', label: 'Blitz 3+2', detail: '3 min · +2s / move', initialMs: 180_000, incrementMs: 2_000 },
  { timeControl: 'blitz', label: 'Blitz 5+0', detail: '5 min · no increment', initialMs: 300_000, incrementMs: 0 },
  { timeControl: 'rapid', label: 'Rapid 10+0', detail: '10 min · no increment', initialMs: 600_000, incrementMs: 0 },
  { timeControl: 'rapid', label: 'Rapid 15+10', detail: '15 min · +10s / move', initialMs: 900_000, incrementMs: 10_000 },
];

/**
 * The queue/search card. Shown when `queueState === 'idle'` (waiting for the
 * user to pick a preset) OR `'searching'`. Renders a progress bar driven by
 * `matchmaking.searchDelta` (the client recomputed widening, 50..400).
 *
 * Errors from the server (-- e.g. `guest_restricted` when a guest tries to
 * queue) are shown as an accent-rose banner; the user can re-queue or go back.
 */
export function MatchmakingOverlay(): React.JSX.Element | null {
  const { matchmaking } = useGameContext();
  const { queueState, error, searchDelta, joinQueue, leaveQueue } = matchmaking;
  if (queueState === 'matched') return null;

  const searching = queueState === 'searching';
  const widthPct = Math.min(100, Math.round((Math.max(50, searchDelta) / MAX_DELTA) * 100));

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6">
      <div className="w-full rounded-2xl border border-slate-800 bg-slate-900/40 p-8">
        <div className="flex items-center gap-2.5">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4 text-neon-400"
            aria-hidden
          >
            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
          </svg>
          <h2 className="text-sm font-medium tracking-wide text-slate-400 uppercase">
            {searching ? 'Searching for an opponent…' : 'Find a game'}
          </h2>
        </div>

        {!searching && (
          <p className="mt-3 text-sm text-slate-400">
            Pick a time control and get paired with a player near your rating.
          </p>
        )}

        {searching && (
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-neon-500 shadow-[0_0_10px_-2px_var(--color-neon-500)] transition-[width] duration-500"
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Elo search window: ±{searchDelta}
            </p>
            <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs leading-relaxed text-slate-500">
              Keep this tab open. To test, open a second window, play as guest,
              and pick the same time control — you'll match instantly.
            </p>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-accent-rose/40 bg-accent-rose/10 px-3 py-2 text-sm text-accent-rose">
            {error}
          </p>
        )}

        {!searching && (
          <div className="mt-5 grid grid-cols-2 gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => joinQueue(preset)}
                className="group flex flex-col items-start rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3 text-left transition hover:border-neon-500 hover:bg-slate-800"
              >
                <span className="text-sm font-semibold text-slate-200 transition group-hover:text-neon-400">
                  {preset.label}
                </span>
                <span className="mt-0.5 text-xs text-slate-500">{preset.detail}</span>
              </button>
            ))}
          </div>
        )}

        {searching && (
          <button
            type="button"
            onClick={leaveQueue}
            className="mt-6 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
          >
            Cancel search
          </button>
        )}
      </div>
    </div>
  );
}

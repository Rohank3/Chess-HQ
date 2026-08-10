import { useState, type FormEvent } from 'react';
import { http } from '../api/http';
import { useSocket } from '../hooks/useSocket';
import { useGameContext } from '../context/GameContext';
import { useToast } from '../context/ToastContext';

// Match the server's widening ceiling (server: maxDeltaElo=400).
const MAX_DELTA = 400;

interface TimePreset {
  timeControl: string;
  label: string;
  detail: string;
  initialMs: number;
  incrementMs: number;
}

const GROUPS: ReadonlyArray<{ name: string; presets: TimePreset[] }> = [
  {
    name: 'Bullet',
    presets: [
      { timeControl: 'bullet', label: '1+0', detail: '1 min · no increment', initialMs: 60_000, incrementMs: 0 },
      { timeControl: 'bullet', label: '2+1', detail: '2 min · +1s / move', initialMs: 120_000, incrementMs: 1_000 },
    ],
  },
  {
    name: 'Blitz',
    presets: [
      { timeControl: 'blitz', label: '3+0', detail: '3 min · no increment', initialMs: 180_000, incrementMs: 0 },
      { timeControl: 'blitz', label: '3+2', detail: '3 min · +2s / move', initialMs: 180_000, incrementMs: 2_000 },
      { timeControl: 'blitz', label: '5+0', detail: '5 min · no increment', initialMs: 300_000, incrementMs: 0 },
    ],
  },
  {
    name: 'Rapid',
    presets: [
      { timeControl: 'rapid', label: '10+0', detail: '10 min · no increment', initialMs: 600_000, incrementMs: 0 },
      { timeControl: 'rapid', label: '15+10', detail: '15 min · +10s / move', initialMs: 900_000, incrementMs: 10_000 },
    ],
  },
  {
    name: 'Classical',
    presets: [
      { timeControl: 'classical', label: '30+0', detail: '30 min · no increment', initialMs: 1_800_000, incrementMs: 0 },
    ],
  },
];

function formatClock(initialMs: number, incrementMs: number): string {
  const minutes = Math.round(initialMs / 60_000);
  if (incrementMs === 0) return `${minutes} min`;
  return `${minutes} min · +${incrementMs / 1000}s / move`;
}

/**
 * The pre-game hub: pick a standard time control, or create a shareable
 * challenge with a custom clock. Replaces the old overlay — it's now the
 * page's main content until a game is adopted, so a freshly-arrived player
 * can never land on a blank board with no explanation.
 */
export function MatchmakingHub(): React.JSX.Element {
  const { matchmaking } = useGameContext();
  const { queueState, error, searchDelta, joinQueue, leaveQueue } = matchmaking;
  const { socket } = useSocket();
  const { push } = useToast();

  const [minutes, setMinutes] = useState(10);
  const [increment, setIncrement] = useState(0);
  const [creating, setCreating] = useState(false);
  const [challenge, setChallenge] = useState<{ id: string; link: string } | null>(null);

  const searching = queueState === 'searching';
  const widthPct = Math.min(100, Math.round((Math.max(50, searchDelta) / MAX_DELTA) * 100));

  async function createChallenge(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await http.post<{ id: string }>('/api/challenges', {
        initialMs: minutes * 60_000,
        incrementMs: increment * 1_000,
      });
      const id = res.data.id;
      const link = `${window.location.origin}/challenge/${id}`;
      setChallenge({ id, link });
      push('success', 'Challenge created — share the link.');
    } catch (err) {
      const { message } = err as { message?: string };
      push('error', message ?? 'Could not create the challenge.');
    } finally {
      setCreating(false);
    }
  }

  function cancelChallenge() {
    if (!challenge) return;
    if (socket?.connected) socket.emit('challenge:cancel', { challengeId: challenge.id });
    setChallenge(null);
  }

  async function copyLink() {
    if (!challenge) return;
    try {
      await navigator.clipboard.writeText(challenge.link);
      push('success', 'Challenge link copied.');
    } catch {
      push('warn', challenge.link);
    }
  }

  if (searching) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6">
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
              Searching for an opponent…
            </h2>
          </div>

          <div className="mt-5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-neon-500 shadow-[0_0_10px_-2px_var(--color-neon-500)] transition-[width] duration-500"
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-400">Elo search window: ±{searchDelta}</p>
            <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs leading-relaxed text-slate-500">
              Keep this tab open. To test solo, open a second window, play as
              guest, and pick the same time control — you'll match instantly.
            </p>
          </div>

          {error && (
            <p className="mt-4 rounded-lg border border-accent-rose/40 bg-accent-rose/10 px-3 py-2 text-sm text-accent-rose">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={leaveQueue}
            className="mt-6 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
          >
            Cancel search
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold text-slate-100">Start a game</h1>
        <p className="mt-2 text-sm text-slate-400">
          Pick a time control to matchmake, or create a challenge link with your own clock.
        </p>
      </div>

      {error && (
        <p className="mx-auto mb-6 max-w-md rounded-lg border border-accent-rose/40 bg-accent-rose/10 px-3 py-2 text-center text-sm text-accent-rose">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* Standard time controls */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="flex items-center gap-2 text-sm font-medium tracking-wide text-slate-400 uppercase">
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
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l2.5 2.5" />
              <path d="M9 2h6" />
            </svg>
            Find a game
          </h2>

          <div className="mt-4 space-y-4">
            {GROUPS.map((group) => (
              <div key={group.name}>
                <p className="text-xs font-medium text-slate-500">{group.name}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {group.presets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => void joinQueue(preset)}
                      className="group flex flex-col items-start rounded-lg border border-slate-700 bg-slate-900/60 px-3.5 py-2.5 text-left transition hover:border-neon-500 hover:bg-slate-800"
                    >
                      <span className="font-mono text-sm font-semibold text-slate-200 transition group-hover:text-neon-400">
                        {preset.label}
                      </span>
                      <span className="mt-0.5 text-xs text-slate-500">{preset.detail}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Custom challenge */}
        <section className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="flex items-center gap-2 text-sm font-medium tracking-wide text-slate-400 uppercase">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4 text-accent-violet"
              aria-hidden
            >
              <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-3 3a5 5 0 0 0-.5 7.5" />
              <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l3-3a5 5 0 0 0 .5-7.5" />
            </svg>
            Challenge a friend
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Set your own clock and get a shareable link. Anyone who opens it
            can accept and play you instantly.
          </p>

          {challenge ? (
            <div className="mt-5 rounded-lg border border-neon-500/30 bg-neon-500/10 p-4">
              <p className="text-xs font-medium tracking-wide text-neon-400 uppercase">
                Challenge link
              </p>
              <p className="mt-2 break-all font-mono text-xs text-slate-300">{challenge.link}</p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  className="flex-1 rounded-lg bg-neon-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-neon-400"
                >
                  Copy link
                </button>
                <button
                  type="button"
                  onClick={cancelChallenge}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
                >
                  Cancel
                </button>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Waiting for an opponent to accept. The game starts automatically.
              </p>
            </div>
          ) : (
            <form onSubmit={createChallenge} className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium tracking-wide text-slate-400 uppercase">
                    Minutes
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={minutes}
                    onChange={(e) => setMinutes(Math.min(60, Math.max(1, Number(e.target.value) || 1)))}
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-neon-500 focus:ring-2 focus:ring-neon-500/30"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium tracking-wide text-slate-400 uppercase">
                    Increment (s)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={increment}
                    onChange={(e) => setIncrement(Math.min(30, Math.max(0, Number(e.target.value) || 0)))}
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-neon-500 focus:ring-2 focus:ring-neon-500/30"
                  />
                </label>
              </div>
              <p className="text-xs text-slate-500">{formatClock(minutes * 60_000, increment * 1_000)}</p>
              <button
                type="submit"
                disabled={creating}
                className="w-full rounded-lg bg-neon-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-neon-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? 'Creating…' : 'Create challenge link'}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

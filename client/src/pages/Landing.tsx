import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface SubmitError {
  code: string;
  message: string;
}

const FEATURES: ReadonlyArray<{ title: string; body: string; icon: ReactNode }> = [
  {
    title: 'Real-time matches',
    body: 'Every move streams over a WebSocket the instant it happens. Both boards stay in sync, and the clocks tick live.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
      </svg>
    ),
  },
  {
    title: 'Elo matchmaking',
    body: 'The queue pairs you by rating, widening its search window from ±50 up to ±400 until it finds an opponent.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4.5" />
        <circle cx="12" cy="12" r="0.75" fill="currentColor" />
      </svg>
    ),
  },
  {
    title: 'Server-authoritative moves',
    body: 'Move legality is enforced on the server with chess.js. The board you see is the true game state, never a guess.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: 'Instant guest play',
    body: 'No signup required. Jump in as a guest and be inside a game within seconds.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
      </svg>
    ),
  },
];

const STEPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Pick a time control',
    body: 'Blitz 3+2 or Rapid 10+0 — choose the cadence that fits your game.',
  },
  {
    title: 'Get matched',
    body: 'The queue pairs you with a player near your rating. The search window widens automatically until a match is found.',
  },
  {
    title: 'Play',
    body: 'Make your moves, watch the synchronized clock, and claim the win. Results update your Elo immediately.',
  },
];

export function Landing(): React.JSX.Element {
  const { user, logout, loading, loginAsGuest } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [guestBusy, setGuestBusy] = useState(false);

  async function playAsGuest() {
    setGuestBusy(true);
    try {
      await loginAsGuest();
      push('success', 'Playing as a guest.');
      navigate('/game');
    } catch (err) {
      const { message } = err as SubmitError;
      push('error', message);
    } finally {
      setGuestBusy(false);
    }
  }

  return (
    <main className="relative isolate overflow-hidden">
      {/* Ambient glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_60rem_at_50%_-20%,rgba(34,211,238,0.14),transparent_60%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(40rem_40rem_at_85%_110%,rgba(139,92,246,0.1),transparent_60%)]"
      />

      {/* Hero */}
      <section className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center justify-center px-6 py-24 text-center">
        <p className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-slate-800 bg-slate-900/60 px-4 py-1.5 text-xs font-medium tracking-wide text-slate-300">
          <span className="size-1.5 rounded-full bg-neon-400 shadow-[0_0_8px_2px_var(--color-neon-400)]" aria-hidden />
          Real-time multiplayer chess
        </p>

        <h1 className="text-balance text-5xl font-bold tracking-tight text-slate-100 sm:text-6xl">
          Play chess, <span className="text-neon-400">in real time</span>.
        </h1>

        <p className="mt-6 max-w-2xl text-balance text-base text-slate-400 sm:text-lg">
          Elo matchmaking, a synchronized chess clock, and every move validated
          server-side — streamed live to both players over WebSockets. No
          downloads, no signup required to try it.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          {loading ? (
            <span className="text-sm text-slate-400">Loading…</span>
          ) : user ? (
            <>
              <Link
                to="/game"
                className="rounded-lg bg-neon-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_0_20px_-4px_var(--color-neon-500)] transition hover:bg-neon-400 hover:shadow-[0_0_28px_-2px_var(--color-neon-400)]"
              >
                Play now
              </Link>
              <Link
                to="/dashboard"
                className="rounded-lg border border-slate-700 bg-slate-900/60 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
              >
                Dashboard
              </Link>
              <button
                type="button"
                onClick={logout}
                className="rounded-lg px-4 py-3 text-sm font-semibold text-slate-400 transition hover:text-slate-200"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={playAsGuest}
                disabled={guestBusy}
                className="rounded-lg bg-neon-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_0_20px_-4px_var(--color-neon-500)] transition hover:bg-neon-400 hover:shadow-[0_0_28px_-2px_var(--color-neon-400)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {guestBusy ? 'Starting…' : 'Play as guest'}
              </button>
              <Link
                to="/register"
                className="rounded-lg border border-slate-700 bg-slate-900/60 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
              >
                Create account
              </Link>
              <Link
                to="/login"
                className="rounded-lg px-4 py-3 text-sm font-semibold text-slate-400 transition hover:text-slate-200"
              >
                Sign in
              </Link>
            </>
          )}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 transition hover:border-slate-700 hover:bg-slate-900/60"
            >
              <div className="flex size-10 items-center justify-center rounded-lg border border-neon-500/30 bg-neon-500/10 text-neon-400">
                {feature.icon}
              </div>
              <h2 className="mt-4 text-sm font-semibold text-slate-100">{feature.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-slate-800/60">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="text-center text-2xl font-semibold text-slate-100">How it works</h2>
          <ol className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
                <span className="font-mono text-xs font-semibold text-neon-400">0{i + 1}</span>
                <h3 className="mt-2 text-sm font-semibold text-slate-100">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/60 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-6 text-center sm:flex-row sm:justify-between">
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <span className="size-1.5 rounded-full bg-neon-400" aria-hidden />
            Chess-HQ
          </p>
          <p className="text-xs text-slate-600">
            A real-time multiplayer chess demo — moves validated server-side with chess.js.
          </p>
        </div>
      </footer>
    </main>
  );
}

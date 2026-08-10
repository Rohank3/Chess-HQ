import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface SubmitError {
  code: string;
  message: string;
}

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
      navigate('/dashboard');
    } catch (err) {
      const { message } = err as SubmitError;
      push('error', message);
    } finally {
      setGuestBusy(false);
    }
  }

  return (
    <main className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_60rem_at_50%_-20%,rgba(34,211,238,0.15),transparent_60%)]"
      />
      <section className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center justify-center px-6 py-20 text-center">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-4 py-1.5 text-xs font-medium tracking-wide text-neon-400 uppercase">
          <span className="size-1.5 rounded-full bg-neon-400 shadow-[0_0_8px_2px_var(--color-neon-400)]" />
          Real-time · Elo-ranked · Open-source
        </p>
        <h1 className="text-balance text-5xl font-bold tracking-tight text-slate-100 sm:text-6xl">
          Play chess, <span className="text-neon-400">in real time</span>.
        </h1>
        <p className="mt-6 max-w-2xl text-balance text-base text-slate-400 sm:text-lg">
          A multiplayer chess arena with Elo-based matchmaking, server-authoritative move
          validation, and a synchronized clock. No downloads, no plugins — play in your
          browser.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          {loading ? (
            <span className="text-sm text-slate-400">Loading…</span>
          ) : user ? (
            <>
              <Link
                to="/dashboard"
                className="rounded-lg bg-neon-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_0_20px_-4px_var(--color-neon-500)] transition hover:bg-neon-400 hover:shadow-[0_0_28px_-2px_var(--color-neon-400)]"
              >
                Welcome back, {user.username}. Open dashboard.
              </Link>
              <button
                type="button"
                onClick={logout}
                className="rounded-lg border border-slate-700 bg-slate-900/60 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="rounded-lg bg-neon-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_0_20px_-4px_var(--color-neon-500)] transition hover:bg-neon-400 hover:shadow-[0_0_28px_-2px_var(--color-neon-400)]"
              >
                Login / Register
              </Link>
              <button
                type="button"
                onClick={playAsGuest}
                disabled={guestBusy}
                className="rounded-lg border border-slate-700 bg-slate-900/60 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {guestBusy ? 'Starting…' : 'Play as Guest'}
              </button>
              <Link
                to="/game"
                className="rounded-lg border border-neon-600/40 bg-neon-600/10 px-6 py-3 text-sm font-semibold text-neon-400 transition hover:border-neon-500 hover:bg-neon-600/20"
              >
                Find a match
              </Link>
            </>
          )}
        </div>

        <dl className="mt-16 grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { k: '12ms', v: 'median move latency' },
            { k: 'Elo ±50', v: 'initial matchmaking delta' },
            { k: '0', v: 'client-authoritative state' },
          ].map((stat) => (
            <div
              key={stat.v}
              className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-left"
            >
              <dt className="text-2xl font-semibold text-slate-100">{stat.k}</dt>
              <dd className="mt-1 text-sm text-slate-400">{stat.v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}

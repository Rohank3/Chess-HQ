import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface SubmitError {
  code: string;
  message: string;
}

interface Feature {
  title: string;
  body: string;
  icon: ReactNode;
  accent: string;
}

const FEATURES: ReadonlyArray<Feature> = [
  {
    title: 'Real-time matches',
    body: 'Every move streams over a WebSocket the instant it happens. Both boards stay in sync, and the clocks tick live.',
    accent: 'border-neon-500/30 bg-neon-500/10 text-neon-400',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
      </svg>
    ),
  },
  {
    title: 'Elo matchmaking',
    body: 'The queue pairs you by rating, widening its search window from ±50 up to ±400 until it finds an opponent.',
    accent: 'border-accent-emerald/30 bg-accent-emerald/10 text-accent-emerald',
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
    accent: 'border-accent-violet/30 bg-accent-violet/10 text-accent-violet',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: 'Custom clock challenges',
    body: 'Set any time control you like, get a shareable link, and play a friend the moment they accept.',
    accent: 'border-accent-rose/30 bg-accent-rose/10 text-accent-rose',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-3 3a5 5 0 0 0-.5 7.5" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l3-3a5 5 0 0 0 .5-7.5" />
      </svg>
    ),
  },
  {
    title: 'Instant guest play',
    body: 'No signup required. Jump in as a guest and be inside a game within seconds.',
    accent: 'border-slate-600/40 bg-slate-600/10 text-slate-300',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
      </svg>
    ),
  },
  {
    title: 'Resign, draws, live clocks',
    body: 'Resign when you must, offer a draw, and watch the synchronized clock keep both sides honest.',
    accent: 'border-slate-600/40 bg-slate-600/10 text-slate-200',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 3v18" />
        <path d="M18 3v18" />
        <path d="M6 12h12" />
        <path d="M9 8h6" />
        <path d="M9 16h6" />
      </svg>
    ),
  },
];

const TIME_CONTROLS = ['Bullet', 'Blitz', 'Rapid', 'Classical'];

/**
 * A large tilted 3D chessboard for the hero — pure CSS perspective, no
 * assets. The board lies back in space (rotateX), and each piece is
 * counter-rotated so it stands upright on its square facing the viewer.
 * The whole group floats gently.
 */
function HeroBoard(): React.JSX.Element {
  const cells = Array.from({ length: 64 }, (_, i) => {
    const r = Math.floor(i / 8);
    const c = i % 8;
    return { key: i, dark: (r + c) % 2 === 1 };
  });

  // r=0 is rank 8 (far edge), r=7 is rank 1 (near edge).
  const pieces: ReadonlyArray<{
    glyph: string;
    light: boolean;
    r: number;
    c: number;
    size: number;
  }> = [
    { glyph: '♖', light: true, r: 7, c: 0, size: 44 },
    { glyph: '♘', light: true, r: 7, c: 1, size: 44 },
    { glyph: '♕', light: true, r: 7, c: 3, size: 48 },
    { glyph: '♔', light: true, r: 7, c: 4, size: 48 },
    { glyph: '♗', light: true, r: 7, c: 5, size: 44 },
    { glyph: '♙', light: true, r: 6, c: 0, size: 40 },
    { glyph: '♙', light: true, r: 6, c: 3, size: 40 },
    { glyph: '♙', light: true, r: 6, c: 4, size: 40 },
    { glyph: '♙', light: true, r: 6, c: 7, size: 40 },
    { glyph: '♜', light: false, r: 0, c: 0, size: 44 },
    { glyph: '♞', light: false, r: 0, c: 1, size: 44 },
    { glyph: '♛', light: false, r: 0, c: 3, size: 48 },
    { glyph: '♚', light: false, r: 0, c: 4, size: 48 },
    { glyph: '♝', light: false, r: 0, c: 5, size: 44 },
    { glyph: '♟', light: false, r: 1, c: 0, size: 40 },
    { glyph: '♟', light: false, r: 1, c: 3, size: 40 },
    { glyph: '♟', light: false, r: 1, c: 4, size: 40 },
    { glyph: '♟', light: false, r: 1, c: 7, size: 40 },
  ];

  return (
    <div
      className="relative mx-auto w-full max-w-[430px] select-none sm:max-w-[480px] lg:max-w-[540px]"
      aria-hidden
    >
      {/* Warm light pool the board floats over */}
      <div className="absolute inset-x-4 bottom-4 top-[45%] rounded-[50%] bg-neon-500/15 blur-3xl" />

      <div className="relative animate-float" style={{ perspective: '1500px' }}>
        <div
          style={{
            transformStyle: 'preserve-3d',
            transform: 'rotateX(57deg)',
          }}
        >
          <div className="grid grid-cols-8 overflow-hidden rounded-md border-4 border-slate-700/80 shadow-[0_50px_140px_-24px_rgba(34,211,238,0.3)]">
            {cells.map((cell) => (
              <div
                key={cell.key}
                className={`aspect-square ${cell.dark ? 'bg-[#b58863]' : 'bg-[#f0d9b5]'}`}
              />
            ))}
          </div>

          {pieces.map((p, i) => (
            <span
              key={`${p.glyph}-${i}`}
              className="absolute"
              style={{
                left: `${p.c * 12.5 + 6.25}%`,
                top: `${p.r * 12.5 + 1.5}%`,
                transform: 'translate(-50%, -0.3em) rotateX(-57deg)',
                fontSize: `${p.size}px`,
                lineHeight: 1,
                color: p.light ? '#f8fafc' : '#1e293b',
                textShadow: p.light
                  ? '0 0 1px #0f172a, 0 1px 1px #0f172a, 0 -1px 1px #0f172a, 0 10px 18px rgba(2,6,23,0.55)'
                  : '0 0 1px #e2e8f0, 0 1px 1px #e2e8f0, 0 -1px 1px #e2e8f0, 0 10px 18px rgba(2,6,23,0.65)',
              }}
            >
              {p.glyph}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
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
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(45rem_45rem_at_85%_25%,rgba(139,92,246,0.12),transparent_60%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(40rem_40rem_at_110%_100%,rgba(34,211,238,0.08),transparent_65%)]"
      />

      {/* Hero */}
      <section className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 px-6 pb-24 pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:gap-10 lg:pb-32 lg:pt-28">
        <div className="relative z-10 text-center lg:text-left">
          <p className="inline-flex items-center gap-2.5 rounded-full border border-slate-800 bg-slate-900/60 px-4 py-1.5 text-xs font-medium tracking-wide text-slate-300">
            <span
              className="size-1.5 rounded-full bg-neon-400 shadow-[0_0_8px_2px_var(--color-neon-400)]"
              aria-hidden
            />
            Real-time multiplayer chess
          </p>

          <h1 className="mt-6 text-balance text-5xl font-bold tracking-tight text-slate-100 sm:text-6xl lg:text-7xl">
            Play chess, <span className="text-neon-400">in real time</span>.
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-balance text-base text-slate-400 sm:text-lg lg:mx-0">
            Elo matchmaking, a synchronized chess clock, and every move
            validated server-side — streamed live to both players over
            WebSockets. No downloads, no signup required to try it.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
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

          <div className="mt-10 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
            <span className="text-xs text-slate-500">Time controls:</span>
            {TIME_CONTROLS.map((tc) => (
              <span
                key={tc}
                className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 font-mono text-xs text-slate-400"
              >
                {tc}
              </span>
            ))}
          </div>
        </div>

        <HeroBoard />
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <article
              key={feature.title}
              className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 transition hover:-translate-y-0.5 hover:border-slate-700 hover:bg-slate-900/60"
            >
              <div
                className={`flex size-10 items-center justify-center rounded-lg border ${feature.accent}`}
              >
                {feature.icon}
              </div>
              <h2 className="mt-4 text-sm font-semibold text-slate-100">{feature.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{feature.body}</p>
            </article>
          ))}
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

import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useActivity } from '../context/ActivityContext';
import { useSocket } from '../hooks/useSocket';
import { STATUS_LABEL, STATUS_STYLES, statusDotClass } from './connectionStyles';

/**
 * Sticky site header for signed-in pages. Returns null for signed-out
 * users so public pages keep their existing top-right <ConnectionStatus />
 * pill without any layout shift. Owns the inline connection indicator on
 * protected pages (so there's one fixed connection UI per screen, not the
 * double-fixed-pill you'd get by also rendering the standalone pill).
 */
export function Navbar(): React.JSX.Element | null {
  const { user, logout } = useAuth();
  const { status } = useSocket();
  const { inGame, searching } = useActivity();

  if (!user) return null;

  const guestSuffix = user.isGuest ? ' (guest)' : '';
  const activityLabel = searching
    ? 'Searching the matchmaking queue'
    : 'You are in an active game';

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2 rounded-full bg-neon-400 shadow-[0_0_8px_2px_var(--color-neon-400)]"
          />
          <span className="text-sm font-semibold tracking-tight text-slate-100">
            Chess-HQ
          </span>
        </Link>        <div className="flex items-center gap-3 sm:gap-4">
          <span
            className={`hidden items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${STATUS_STYLES[status]}`}
            title={STATUS_LABEL[status]}
            aria-label={`Connection: ${STATUS_LABEL[status]}`}
          >
            <span className={`size-1.5 rounded-full ${statusDotClass(status)}`} aria-hidden />
            {STATUS_LABEL[status]}
          </span>

          {(inGame || searching) && (
            <span
              className="hidden items-center gap-1.5 rounded-full border border-neon-500/40 bg-neon-500/10 px-2.5 py-1 text-xs font-medium text-neon-400 sm:inline-flex"
              title={activityLabel}
              aria-label={activityLabel}
            >
              <span className="relative flex size-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon-400 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-neon-400" />
              </span>
              {searching ? 'Searching' : 'In game'}
            </span>
          )}

          <Link
            to="/game"
            className="rounded-lg bg-neon-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-neon-400"
          >
            Play
          </Link>

          <Link
            to="/dashboard"
            className="flex items-baseline gap-2 text-sm text-slate-200 transition hover:text-slate-100"
          >
            <span className="hidden sm:inline">{user.username}{guestSuffix}</span>
            <span className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 font-mono text-xs text-neon-400">
              {user.elo}
            </span>
          </Link>

          <button
            type="button"
            onClick={logout}
            className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

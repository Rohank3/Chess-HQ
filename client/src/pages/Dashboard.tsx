import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStats } from '../hooks/useStats';
import { useFriends } from '../hooks/useFriends';
import { Spinner } from '../components/Spinner';
import { EloDonut } from '../components/EloDonut';
import { MatchHistoryTable } from '../components/MatchHistoryTable';
import { FriendsSection } from '../components/FriendsSection';
import { IncomingChallengesSection } from '../components/IncomingChallengesSection';

export function Dashboard(): React.JSX.Element {
  const { user, loading } = useAuth();
  const { data, error, refresh } = useStats();
  const friends = useFriends();

  if (loading) {
    return <Spinner label="Loading your dashboard…" />;
  }

  if (!user) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-slate-400">Sign in to view your dashboard.</p>
      </main>
    );
  }

  // The auth bootstrap already bias-towards-showing the username from the
  // token flight, but the stats read carries the authoritative w/l/d. Fall
  // back to the cached user if the stats read hasn't landed yet so the
  // card never flickers empty.
  const profile = data?.profile ?? null;
  const wins = profile?.wins ?? 0;
  const losses = profile?.losses ?? 0;
  const draws = profile?.draws ?? 0;
  const gamesPlayed = profile?.gamesPlayed ?? 0;
  const recentGames = data?.recentGames ?? [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      {/* Header card ------------------------------------------------------ */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">
              {user.isGuest ? 'Playing as guest' : 'Signed in'}
            </p>
            <h1 className="mt-1.5 text-3xl font-semibold text-slate-100">
              {user.username}
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Elo{' '}
              <span className="font-mono text-2xl text-neon-400">{user.elo}</span>{' '}
              · {gamesPlayed} game{gamesPlayed === 1 ? '' : 's'} played
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-4 sm:items-end">
            <dl className="flex gap-3">
              <div className="rounded-lg border border-accent-emerald/40 bg-accent-emerald/10 px-3 py-2 text-center">
                <dt className="text-xs font-medium tracking-wide text-accent-emerald uppercase">
                  Wins
                </dt>
                <dd className="mt-1 font-mono text-lg text-accent-emerald">{wins}</dd>
              </div>
              <div className="rounded-lg border border-accent-rose/40 bg-accent-rose/10 px-3 py-2 text-center">
                <dt className="text-xs font-medium tracking-wide text-accent-rose uppercase">
                  Losses
                </dt>
                <dd className="mt-1 font-mono text-lg text-accent-rose">{losses}</dd>
              </div>
              <div className="rounded-lg border border-slate-600/40 bg-slate-600/10 px-3 py-2 text-center">
                <dt className="text-xs font-medium tracking-wide text-slate-300 uppercase">
                  Draws
                </dt>
                <dd className="mt-1 font-mono text-lg text-slate-200">{draws}</dd>
              </div>
            </dl>
            <Link
              to="/game"
              className="rounded-lg bg-neon-500 px-5 py-2.5 text-center text-sm font-semibold text-slate-950 shadow-[0_0_16px_-4px_var(--color-neon-500)] transition hover:bg-neon-400 sm:w-auto"
            >
              Play a game
            </Link>
          </div>
        </div>
      </section>

      {/* Friends + incoming challenges (registered users only) ---------- */}
      {!user.isGuest && (
        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <IncomingChallengesSection friends={friends} />
          <FriendsSection friends={friends} />
        </section>
      )}

      {/* Stats + history grid -------------------------------------------- */}
      {error && !data ? (
        <section className="mt-6 rounded-2xl border border-accent-rose/40 bg-accent-rose/10 p-8 text-center">
          <p className="text-sm text-accent-rose">
            Couldn't load your stats. The server may be unreachable.
          </p>
          <button
            type="button"
            onClick={refresh}
            className="mt-4 rounded-lg border border-accent-rose/40 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-accent-rose transition hover:border-accent-rose hover:bg-slate-800"
          >
            Retry
          </button>
        </section>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8">
            <h2 className="text-xs font-medium tracking-wide text-slate-400 uppercase">
              Record
            </h2>
            <div className="mt-6 flex justify-center">
              <EloDonut wins={wins} losses={losses} draws={draws} />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8">
            <h2 className="text-xs font-medium tracking-wide text-slate-400 uppercase">
              Recent games
            </h2>
            <div className="mt-4">
              <MatchHistoryTable games={recentGames} />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

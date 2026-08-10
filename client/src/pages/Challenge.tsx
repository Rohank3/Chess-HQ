import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { http } from '../api/http';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { useToast } from '../context/ToastContext';
import { emitWithAck } from '../game/emit';
import type { ChallengeDetails } from '../game/types';

function formatClock(initialMs: number, incrementMs: number): string {
  const minutes = Math.round(initialMs / 60_000);
  if (incrementMs === 0) return `${minutes} min · no increment`;
  return `${minutes} min · +${incrementMs / 1000}s / move`;
}

/**
 * A shareable challenge link. Public route: the details render before the
 * visitor authenticates. Accepting requires a session (the server enforces
 * auth on both the create route and the socket handshake); on accept, the
 * joiner navigates to /game/<id> with the game seeded in location.state so
 * the GameProvider mounts already in-game.
 */
export function ChallengePage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { socket } = useSocket();
  const { push } = useToast();
  const navigate = useNavigate();

  const [details, setDetails] = useState<ChallengeDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    http
      .get<ChallengeDetails>(`/api/challenges/${id}`)
      .then((res) => {
        if (!cancelled) setDetails(res.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const isNetwork =
            (err as { code?: string })?.code === 'ERR_NETWORK' ||
            (err as { message?: string })?.message === 'Network Error';
          setLoadError(
            isNetwork
              ? "Couldn't reach the server. It may be waking up from sleep — try again in a minute."
              : 'This challenge has expired or no longer exists.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function accept() {
    if (!id) return;
    if (!user) {
      push('warn', 'Sign in to accept a challenge.');
      navigate('/login');
      return;
    }
    setJoining(true);
    const ack = await emitWithAck(socket, 'challenge:join', { challengeId: id });
    if (!ack.ok || !ack.gameId) {
      setJoining(false);
      const message = (ack as { message?: string }).message;
      push('error', message ?? 'Could not join the challenge.');
      return;
    }
    navigate(`/game/${ack.gameId}`, {
      state: details
        ? {
            seedGameId: ack.gameId,
            seedColor: 'b' as const,
            seedOpponent: {
              id: details.creatorUserId,
              username: details.creatorUsername,
              elo: details.creatorElo,
            },
          }
        : undefined,
    });
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span
            aria-hidden
            className="size-2 rounded-full bg-neon-400 shadow-[0_0_10px_3px_var(--color-neon-400)]"
          />
          <span className="text-sm font-semibold tracking-[0.25em] text-slate-200 uppercase">
            Chess-HQ
          </span>
        </div>

        {loadError ? (
          <>
            <h1 className="text-2xl font-semibold text-slate-100">
              {loadError.startsWith("Couldn't reach") ? 'Server unreachable' : 'Challenge expired'}
            </h1>
            <p className="mt-2 text-sm text-slate-400">{loadError}</p>
            <button
              type="button"
              onClick={() => navigate('/game')}
              className="mt-6 w-full rounded-lg bg-neon-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-neon-400"
            >
              Back to matchmaking
            </button>
          </>
        ) : !details ? (
          <p className="text-sm text-slate-400">Loading challenge…</p>
        ) : (
          <>
            <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">
              You've been challenged
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-100">
              {details.creatorUsername}{' '}
              <span className="text-sm font-normal text-slate-400">
                ({details.creatorElo})
              </span>{' '}
              wants to play
            </h1>
            <p className="mt-4 font-mono text-lg text-neon-400">
              {formatClock(details.initialMs, details.incrementMs)}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Custom clock · you'll play Black
            </p>

            <button
              type="button"
              onClick={() => void accept()}
              disabled={joining}
              className="mt-6 w-full rounded-lg bg-neon-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-neon-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {joining
                ? 'Joining…'
                : user
                  ? 'Accept challenge'
                  : 'Sign in to accept'}
            </button>
            <p className="mt-4 text-xs text-slate-500">
              {user
                ? `Playing as ${user.username}`
                : 'You will be asked to sign in first.'}
            </p>
          </>
        )}
      </div>
    </main>
  );
}

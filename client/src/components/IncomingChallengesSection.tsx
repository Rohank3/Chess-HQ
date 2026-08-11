import { useState } from 'react';
import { useToast } from '../context/ToastContext';
import type { ChallengeDetails } from '../game/types';
import type { UseFriendsResult } from '../hooks/useFriends';

function formatClock(initialMs: number, incrementMs: number): string {
  const minutes = Math.round(initialMs / 60_000);
  if (incrementMs === 0) return `${minutes} min`;
  return `${minutes} min · +${incrementMs / 1000}s / move`;
}

/**
 * Incoming direct friend challenges. Each card can be accepted (starts the
 * game immediately and navigates into the room as Black) or declined.
 */
export function IncomingChallengesSection({
  friends,
}: {
  friends: UseFriendsResult;
}): React.JSX.Element {
  const { push } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function accept(challenge: ChallengeDetails) {
    setBusyId(challenge.id);
    const res = await friends.acceptIncomingChallenge(challenge);
    setBusyId(null);
    if (!res.ok) push('error', res.message ?? 'Could not accept the challenge.');
  }

  async function decline(challenge: ChallengeDetails) {
    await friends.declineIncomingChallenge(challenge);
  }

  const challenges = friends.incomingChallenges;

  return (
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
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <path d="M3 6h18" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
        Incoming challenges
      </h2>

      {challenges.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          No incoming challenges. Challenge a friend from the list below.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {challenges.map((challenge) => (
            <li
              key={challenge.id}
              className="flex flex-col gap-3 rounded-lg border border-neon-500/30 bg-neon-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-semibold text-slate-100">
                  {challenge.creatorUsername}{' '}
                  <span className="font-normal text-slate-400">({challenge.creatorElo})</span>{' '}
                  <span className="text-slate-300">challenged you</span>
                </p>
                <p className="mt-0.5 font-mono text-xs text-neon-400">
                  {formatClock(challenge.initialMs, challenge.incrementMs)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busyId === challenge.id}
                  onClick={() => void accept(challenge)}
                  className="rounded-lg bg-neon-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-neon-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busyId === challenge.id ? 'Accepting…' : 'Accept'}
                </button>
                <button
                  type="button"
                  disabled={busyId === challenge.id}
                  onClick={() => void decline(challenge)}
                  className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:opacity-60"
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

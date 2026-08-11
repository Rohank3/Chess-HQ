import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import type { UseFriendsResult } from '../hooks/useFriends';

const TIME_PRESETS: ReadonlyArray<{ label: string; initialMs: number; incrementMs: number }> = [
  { label: '1+0', initialMs: 60_000, incrementMs: 0 },
  { label: '3+0', initialMs: 180_000, incrementMs: 0 },
  { label: '5+0', initialMs: 300_000, incrementMs: 0 },
  { label: '10+0', initialMs: 600_000, incrementMs: 0 },
  { label: '15+10', initialMs: 900_000, incrementMs: 10_000 },
];

function OnlineDot({ online }: { online?: boolean }): React.JSX.Element {
  return (
    <span
      className={`inline-block size-1.5 rounded-full ${
        online ? 'bg-accent-emerald shadow-[0_0_6px_1px_var(--color-accent-emerald)]' : 'bg-slate-600'
      }`}
      title={online ? 'Online' : 'Offline'}
      aria-label={online ? 'Online' : 'Offline'}
    />
  );
}

/**
 * The friends panel: add a registered user by username, handle incoming
 * friend requests, list friends with a direct Challenge action (custom clock
 * via the preset selector), and show the pending direct challenge waiting on
 * the friend's acceptance. Friends currently in a live game get a pulsing
 * "Live" badge and a Spectate button that opens the game read-only.
 */
export function FriendsSection({ friends }: { friends: UseFriendsResult }): React.JSX.Element {
  const { push } = useToast();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [adding, setAdding] = useState(false);
  const [clock, setClock] = useState(TIME_PRESETS[3]!);
  const [challengingId, setChallengingId] = useState<string | null>(null);

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = username.trim();
    if (!name) return;
    setAdding(true);
    const res = await friends.addFriend(name);
    setAdding(false);
    if (!res.ok) {
      push('error', res.message ?? 'Could not send the friend request.');
      return;
    }
    push('success', res.accepted ? 'You are now friends.' : 'Friend request sent.');
    setUsername('');
  }

  async function onChallenge(id: string, user: { id: string; username: string; elo: number }) {
    setChallengingId(id);
    const res = await friends.sendChallenge(user, clock.initialMs, clock.incrementMs);
    setChallengingId(null);
    if (!res.ok) {
      push('error', res.message ?? 'Could not send the challenge.');
      return;
    }
    push('success', `Challenge sent to ${user.username}.`);
  }

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
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        Friends
      </h2>

      {/* Add by username */}
      <form onSubmit={onAdd} className="mt-4 flex gap-2">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Add a friend by username"
          minLength={3}
          maxLength={24}
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-neon-500 focus:ring-2 focus:ring-neon-500/30"
        />
        <button
          type="submit"
          disabled={adding || username.trim().length < 3}
          className="shrink-0 rounded-lg bg-neon-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-neon-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {adding ? 'Adding…' : 'Add friend'}
        </button>
      </form>

      {/* Incoming friend requests */}
      {friends.incomingRequests.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Friend requests
          </p>
          <ul className="mt-2 space-y-2">
            {friends.incomingRequests.map((request) => (
              <li
                key={request.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5"
              >
                <span className="min-w-0 truncate text-sm text-slate-200">
                  <span className="font-semibold">{request.user.username}</span>{' '}
                  <span className="text-slate-500">({request.user.elo})</span>
                  <span className="text-slate-500"> wants to play you</span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void friends.acceptRequest(request.id)}
                    className="rounded-md bg-neon-500 px-3 py-1 text-xs font-semibold text-slate-950 transition hover:bg-neon-400"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => void friends.declineRequest(request.id)}
                    className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:bg-slate-800"
                  >
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The pending direct challenge I sent */}
      {friends.outgoingChallenge && (
        <div className="mt-5 rounded-lg border border-neon-500/30 bg-neon-500/10 p-4">
          <p className="text-xs font-medium tracking-wide text-neon-400 uppercase">
            Challenge sent
          </p>
          <p className="mt-1 text-sm text-slate-200">
            Waiting for <span className="font-semibold">{friends.outgoingChallenge.target.username}</span>{' '}
            to accept your{' '}
            <span className="font-mono text-neon-400">
              {Math.round(friends.outgoingChallenge.initialMs / 60_000)}+
              {friends.outgoingChallenge.incrementMs / 1000}
            </span>{' '}
            challenge…
          </p>
          <button
            type="button"
            onClick={friends.cancelChallenge}
            className="mt-3 rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
          >
            Cancel challenge
          </button>
        </div>
      )}

      {/* Friends list */}
      <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Your friends</p>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Clock
            <select
              value={clock.label}
              onChange={(e) => {
                const preset = TIME_PRESETS.find((p) => p.label === e.target.value) ?? TIME_PRESETS[3]!;
                setClock(preset);
              }}
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-neon-500"
            >
              {TIME_PRESETS.map((preset) => (
                <option key={preset.label} value={preset.label}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {friends.friends.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            No friends yet — add one by username above, or from the game room after a match.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {friends.friends.map((friend) => {
              const liveGame = friend.user.activeGame;
              return (
                <li
                  key={friend.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm text-slate-200">
                    <OnlineDot online={friend.user.online} />
                    <span className="truncate font-semibold">{friend.user.username}</span>
                    <span className="shrink-0 text-slate-500">({friend.user.elo})</span>
                    {liveGame && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent-emerald/40 bg-accent-emerald/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent-emerald">
                        <span
                          className="size-1.5 animate-pulse rounded-full bg-accent-emerald"
                          aria-hidden
                        />
                        Live
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 gap-2">
                    {liveGame && (
                      <button
                        type="button"
                        onClick={() => void navigate(`/game/${liveGame.gameId}`)}
                        className="rounded-md border border-accent-emerald/50 bg-accent-emerald/10 px-3 py-1 text-xs font-semibold text-accent-emerald transition hover:bg-accent-emerald/20"
                        title={`Watch ${liveGame.white.username} vs ${liveGame.black.username}`}
                      >
                        Spectate
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={challengingId === friend.id}
                      onClick={() => void onChallenge(friend.id, friend.user)}
                      className="rounded-md bg-neon-500 px-3 py-1 text-xs font-semibold text-slate-950 transition hover:bg-neon-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {challengingId === friend.id ? 'Sending…' : 'Challenge'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void friends.removeFriend(friend.id)}
                      className="rounded-md border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-xs font-semibold text-slate-400 transition hover:border-accent-rose/50 hover:text-accent-rose"
                      title="Remove friend"
                      aria-label={`Remove ${friend.user.username}`}
                    >
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Outgoing pending requests */}
      {friends.outgoingRequests.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Pending requests
          </p>
          <ul className="mt-2 space-y-2">
            {friends.outgoingRequests.map((request) => (
              <li
                key={request.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5"
              >
                <span className="min-w-0 truncate text-sm text-slate-400">
                  Requested <span className="font-semibold text-slate-300">{request.user.username}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void friends.removeFriend(request.id)}
                  className="shrink-0 rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:bg-slate-800"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

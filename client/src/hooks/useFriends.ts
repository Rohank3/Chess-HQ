import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { http } from '../api/http';
import { useSocket } from './useSocket';
import { useToast } from '../context/ToastContext';
import { emitWithAck } from '../game/emit';
import type {
  ChallengeAcceptedPayload,
  ChallengeCancelledPayload,
  ChallengeDeclinedPayload,
  ChallengeDetails,
  ChallengeIncomingPayload,
  FriendAcceptedPayload,
  FriendDeclinedPayload,
  FriendRequestPayload,
  FriendsResponse,
  FriendUser,
} from '../game/types';

export interface OutgoingChallenge {
  challengeId: string;
  target: FriendUser;
  initialMs: number;
  incrementMs: number;
}

export interface UseFriendsResult {
  loading: boolean;
  error: string | null;
  friends: FriendsResponse['friends'];
  incomingRequests: FriendsResponse['incoming'];
  outgoingRequests: FriendsResponse['outgoing'];
  incomingChallenges: ChallengeDetails[];
  /** The direct challenge I created and am waiting on, if any. */
  outgoingChallenge: OutgoingChallenge | null;
  refresh: () => Promise<void>;
  addFriend: (username: string) => Promise<{ ok: boolean; accepted?: boolean; message?: string }>;
  acceptRequest: (friendshipId: string) => Promise<{ ok: boolean; message?: string }>;
  declineRequest: (friendshipId: string) => Promise<{ ok: boolean; message?: string }>;
  removeFriend: (friendshipId: string) => Promise<{ ok: boolean; message?: string }>;
  sendChallenge: (
    friend: FriendUser,
    initialMs: number,
    incrementMs: number,
  ) => Promise<{ ok: boolean; message?: string }>;
  cancelChallenge: () => void;
  acceptIncomingChallenge: (challenge: ChallengeDetails) => Promise<{ ok: boolean; message?: string }>;
  declineIncomingChallenge: (challenge: ChallengeDetails) => Promise<void>;
}

function formatClock(initialMs: number, incrementMs: number): string {
  const minutes = Math.round(initialMs / 60_000);
  if (incrementMs === 0) return `${minutes} min`;
  return `${minutes} min · +${incrementMs / 1000}s / move`;
}

/**
 * Friends + direct challenges. Fetches the friend graph and the incoming
 * direct challenges on mount, then keeps both fresh from realtime socket
 * events (`friend:request`, `friend:accepted`, `friend:declined`,
 * `challenge:incoming`, `challenge:declined`, `challenge:cancelled`,
 * `challenge:accepted`).
 *
 * The creator-side `challenge:accepted` path navigates straight into the
 * game with the seeded identity (GameProvider adopts the seed on /game/:id),
 * so a friend who accepts from their dashboard starts the game for both
 * sides without a refresh.
 */
export function useFriends(): UseFriendsResult {
  const { socket } = useSocket();
  const { push } = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendsResponse['friends']>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendsResponse['incoming']>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendsResponse['outgoing']>([]);
  const [incomingChallenges, setIncomingChallenges] = useState<ChallengeDetails[]>([]);
  const [outgoingChallenge, setOutgoingChallenge] = useState<OutgoingChallenge | null>(null);

  const outgoingChallengeRef = useRef(outgoingChallenge);
  outgoingChallengeRef.current = outgoingChallenge;

  const refresh = useCallback(async () => {
    try {
      const [friendsRes, challengesRes] = await Promise.all([
        http.get<FriendsResponse>('/api/friends'),
        http.get<{ challenges: ChallengeDetails[] }>('/api/challenges/incoming'),
      ]);
      setFriends(friendsRes.data.friends);
      setIncomingRequests(friendsRes.data.incoming);
      setOutgoingRequests(friendsRes.data.outgoing);
      setIncomingChallenges(challengesRes.data.challenges);
      setError(null);
    } catch {
      setError("Couldn't load friends. The server may be unreachable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the friend list live while the dashboard is mounted: friends start
  // and end games, so their "Live" badges and Spectate buttons need periodic
  // refresh. The socket events above cover friendships/challenges, not game
  // state, so a light poll is the simple source of truth here.
  useEffect(() => {
    const timer = setInterval(() => {
      void refresh();
    }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Realtime updates ------------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    const onFriendRequest = (payload: FriendRequestPayload) => {
      setIncomingRequests((list) =>
        list.some((r) => r.id === payload.friendshipId)
          ? list
          : [...list, { id: payload.friendshipId, user: payload.requester, createdAt: null }],
      );
      push('info', `${payload.requester.username} sent you a friend request.`);
    };
    const onFriendAccepted = (payload: FriendAcceptedPayload) => {
      setOutgoingRequests((list) => list.filter((r) => r.id !== payload.friendshipId));
      setIncomingRequests((list) => list.filter((r) => r.id !== payload.friendshipId));
      setFriends((list) =>
        list.some((f) => f.user.id === payload.friend.id)
          ? list
          : [...list, { id: payload.friendshipId, user: payload.friend, createdAt: null }],
      );
    };
    const onFriendDeclined = (payload: FriendDeclinedPayload) => {
      setOutgoingRequests((list) => list.filter((r) => r.id !== payload.friendshipId));
    };
    const onChallengeIncoming = (payload: ChallengeIncomingPayload) => {
      setIncomingChallenges((list) =>
        list.some((c) => c.id === payload.challenge.id) ? list : [...list, payload.challenge],
      );
      push(
        'info',
        `${payload.challenge.creatorUsername} challenged you — ${formatClock(
          payload.challenge.initialMs,
          payload.challenge.incrementMs,
        )}.`,
      );
    };
    const onChallengeDeclined = (payload: ChallengeDeclinedPayload) => {
      setOutgoingChallenge((cur) => (cur && cur.challengeId === payload.challengeId ? null : cur));
      push('info', `${payload.targetUsername} declined your challenge.`);
    };
    const onChallengeCancelled = (payload: ChallengeCancelledPayload) => {
      setIncomingChallenges((list) => list.filter((c) => c.id !== payload.challengeId));
    };
    const onChallengeAccepted = (payload: ChallengeAcceptedPayload) => {
      // Only the creator of a direct challenge is sitting on the dashboard
      // waiting; a link-challenge creator waits on /game where GameProvider
      // handles this event. Either way, adopting the game needs a navigate
      // out of the dashboard (GameProvider is not mounted here).
      const pending = outgoingChallengeRef.current;
      if (!pending) return;
      setOutgoingChallenge(null);
      navigate(`/game/${payload.gameId}`, {
        state: {
          seedGameId: payload.gameId,
          seedColor: payload.color,
          seedOpponent: payload.opponent,
        },
      });
    };

    socket.on('friend:request', onFriendRequest);
    socket.on('friend:accepted', onFriendAccepted);
    socket.on('friend:declined', onFriendDeclined);
    socket.on('challenge:incoming', onChallengeIncoming);
    socket.on('challenge:declined', onChallengeDeclined);
    socket.on('challenge:cancelled', onChallengeCancelled);
    socket.on('challenge:accepted', onChallengeAccepted);
    return () => {
      socket.off('friend:request', onFriendRequest);
      socket.off('friend:accepted', onFriendAccepted);
      socket.off('friend:declined', onFriendDeclined);
      socket.off('challenge:incoming', onChallengeIncoming);
      socket.off('challenge:declined', onChallengeDeclined);
      socket.off('challenge:cancelled', onChallengeCancelled);
      socket.off('challenge:accepted', onChallengeAccepted);
    };
  }, [socket, navigate, push]);

  // Actions ---------------------------------------------------------------
  const addFriend = useCallback(async (username: string) => {
    try {
      const res = await http.post<{ id: string; accepted: boolean; friend: FriendUser }>(
        '/api/friends',
        { username },
      );
      const { id, accepted, friend } = res.data;
      if (accepted) {
        setFriends((list) => (list.some((f) => f.user.id === friend.id) ? list : [...list, { id, user: friend, createdAt: null }]));
        setIncomingRequests((list) => list.filter((r) => r.user.id !== friend.id));
      } else {
        setOutgoingRequests((list) =>
          list.some((r) => r.user.id === friend.id) ? list : [...list, { id, user: friend, createdAt: null }],
        );
      }
      return { ok: true, accepted };
    } catch (err) {
      const message = (err as { message?: string }).message;
      return { ok: false, message: message ?? 'Could not send the friend request.' };
    }
  }, []);

  const acceptRequest = useCallback(async (friendshipId: string) => {
    try {
      await http.post(`/api/friends/${friendshipId}/accept`);
      // The friend list is authoritative; refetch keeps ids consistent.
      await refresh();
      return { ok: true };
    } catch (err) {
      const message = (err as { message?: string }).message;
      return { ok: false, message: message ?? 'Could not accept the request.' };
    }
  }, [refresh]);

  const declineRequest = useCallback(async (friendshipId: string) => {
    try {
      await http.post(`/api/friends/${friendshipId}/decline`);
      setIncomingRequests((list) => list.filter((r) => r.id !== friendshipId));
      return { ok: true };
    } catch (err) {
      const message = (err as { message?: string }).message;
      return { ok: false, message: message ?? 'Could not decline the request.' };
    }
  }, []);

  const removeFriend = useCallback(async (friendshipId: string) => {
    try {
      await http.delete(`/api/friends/${friendshipId}`);
      setFriends((list) => list.filter((f) => f.id !== friendshipId));
      setOutgoingRequests((list) => list.filter((r) => r.id !== friendshipId));
      return { ok: true };
    } catch (err) {
      const message = (err as { message?: string }).message;
      return { ok: false, message: message ?? 'Could not remove that friendship.' };
    }
  }, []);

  const sendChallenge = useCallback(
    async (friend: FriendUser, initialMs: number, incrementMs: number) => {
      try {
        const res = await http.post<{ id: string }>('/api/challenges', {
          targetUserId: friend.id,
          initialMs,
          incrementMs,
        });
        setOutgoingChallenge({ challengeId: res.data.id, target: friend, initialMs, incrementMs });
        return { ok: true };
      } catch (err) {
        const message = (err as { message?: string }).message;
        return { ok: false, message: message ?? 'Could not send the challenge.' };
      }
    },
    [],
  );

  const cancelChallenge = useCallback(() => {
    const pending = outgoingChallengeRef.current;
    if (!pending) return;
    if (socket?.connected) socket.emit('challenge:cancel', { challengeId: pending.challengeId });
    setOutgoingChallenge(null);
  }, [socket]);

  const acceptIncomingChallenge = useCallback(
    async (challenge: ChallengeDetails) => {
      if (!socket || (!socket.connected && !socket.active)) {
        return { ok: false, message: 'Not connected to the server.' };
      }
      const ack = await emitWithAck(socket, 'challenge:join', { challengeId: challenge.id });
      if (!ack.ok || !ack.gameId) {
        return { ok: false, message: (ack as { message?: string }).message ?? 'Could not join the challenge.' };
      }
      setIncomingChallenges((list) => list.filter((c) => c.id !== challenge.id));
      navigate(`/game/${ack.gameId}`, {
        state: {
          seedGameId: ack.gameId,
          seedColor: ack.color ?? 'b',
          seedOpponent: {
            id: challenge.creatorUserId,
            username: challenge.creatorUsername,
            elo: challenge.creatorElo,
          },
        },
      });
      return { ok: true };
    },
    [socket, navigate],
  );

  const declineIncomingChallenge = useCallback(
    async (challenge: ChallengeDetails) => {
      if (socket?.connected) socket.emit('challenge:decline', { challengeId: challenge.id });
      setIncomingChallenges((list) => list.filter((c) => c.id !== challenge.id));
    },
    [socket],
  );

  return {
    loading,
    error,
    friends,
    incomingRequests,
    outgoingRequests,
    incomingChallenges,
    outgoingChallenge,
    refresh,
    addFriend,
    acceptRequest,
    declineRequest,
    removeFriend,
    sendChallenge,
    cancelChallenge,
    acceptIncomingChallenge,
    declineIncomingChallenge,
  };
}

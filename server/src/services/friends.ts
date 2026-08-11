import { pool } from '../db/pool.js';

export interface FriendUser {
  id: string;
  username: string;
  elo: number;
}

export interface ActiveGameInfo {
  gameId: string;
  white: FriendUser;
  black: FriendUser;
}

export interface FriendshipRow {
  id: string;
  user: FriendUser & { activeGame?: ActiveGameInfo | null };
  createdAt: string | null;
}

export interface FriendsList {
  friends: FriendshipRow[];
  incoming: FriendshipRow[];
  outgoing: FriendshipRow[];
}

export type SendFriendResult =
  | {
      kind: 'ok';
      friendshipId: string;
      /** true when the target had already requested us and the request auto-accepted. */
      accepted: boolean;
      /** The other user's profile. */
      friend: FriendUser;
      /** Our own profile (so callers can emit realtime events without a second query). */
      me: FriendUser;
    }
  | {
      kind: 'error';
      error:
        | 'user_not_found'
        | 'guest_target'
        | 'cannot_friend_self'
        | 'already_friends'
        | 'already_requested';
      message: string;
    };

const PAIR_CLAUSE = `
  (requester_id = $1 AND addressee_id = $2)
  OR (requester_id = $2 AND addressee_id = $1)
`;

/** Is there an accepted friendship between two users (either direction)? */
export async function areFriends(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM friendships
     WHERE status = 'accepted' AND ${PAIR_CLAUSE} LIMIT 1`,
    [a, b],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

async function loadUserByUsername(username: string): Promise<FriendUser & { isGuest: boolean } | null> {
  const result = await pool.query<FriendUser & { is_guest: boolean }>(
    'SELECT id, username, elo, is_guest FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
    [username],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, username: row.username, elo: row.elo, isGuest: row.is_guest };
}

async function loadUserById(id: string): Promise<(FriendUser & { isGuest: boolean }) | null> {
  const result = await pool.query<FriendUser & { is_guest: boolean }>(
    'SELECT id, username, elo, is_guest FROM users WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, username: row.username, elo: row.elo, isGuest: row.is_guest };
}

/**
 * Send a friend request to a username. Guests can neither send nor receive
 * requests. If the target has ALREADY requested us, the pair auto-accepts
 * (flipping the existing row) so two people who add each other become friends
 * without a second round-trip.
 */
export async function sendFriendRequest(
  requesterId: string,
  username: string,
): Promise<SendFriendResult> {
  const me = await loadUserById(requesterId);
  if (!me) {
    return { kind: 'error', error: 'user_not_found', message: 'Account not found' };
  }
  // Guests cannot have friends: the account itself must be registered.
  if (me.isGuest) {
    return {
      kind: 'error',
      error: 'guest_target',
      message: 'Guest accounts cannot add friends — sign in to use friends',
    };
  }

  const target = await loadUserByUsername(username);
  if (!target) {
    return { kind: 'error', error: 'user_not_found', message: 'No user with that username' };
  }
  if (target.isGuest) {
    return { kind: 'error', error: 'guest_target', message: 'Guests cannot be added as friends' };
  }
  if (target.id === requesterId) {
    return { kind: 'error', error: 'cannot_friend_self', message: 'You cannot add yourself' };
  }

  const existing = await pool.query<{ id: string; requester_id: string; status: string }>(
    `SELECT id, requester_id, status FROM friendships WHERE ${PAIR_CLAUSE} LIMIT 1`,
    [requesterId, target.id],
  );
  const row = existing.rows[0];

  if (row) {
    if (row.status === 'accepted') {
      return { kind: 'error', error: 'already_friends', message: 'You are already friends' };
    }
    if (row.requester_id === requesterId) {
      return {
        kind: 'error',
        error: 'already_requested',
        message: 'You already sent them a friend request',
      };
    }
    // They requested us first: accepting flips the existing row.
    await pool.query(
      `UPDATE friendships SET status = 'accepted', responded_at = now()
       WHERE id = $1 AND status = 'pending'`,
      [row.id],
    );
    return {
      kind: 'ok',
      friendshipId: row.id,
      accepted: true,
      friend: target,
      me: { id: me.id, username: me.username, elo: me.elo },
    };
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO friendships (requester_id, addressee_id)
     VALUES ($1, $2) RETURNING id`,
    [requesterId, target.id],
  );
  return {
    kind: 'ok',
    friendshipId: inserted.rows[0]!.id,
    accepted: false,
    friend: target,
    me: { id: me.id, username: me.username, elo: me.elo },
  };
}

/**
 * The live game each of the given user ids is currently in (if any). A user
 * can only be a player in one live game at a time, but we take the newest
 * row defensively. Elo shown is the game-time elo (before), falling back to
 * the user's current elo for unrated games.
 */
async function loadActiveGames(
  userIds: string[],
): Promise<Map<string, ActiveGameInfo>> {
  if (userIds.length === 0) return new Map();
  const result = await pool.query<{
    game_id: string;
    white_id: string;
    white_username: string;
    white_elo: number;
    black_id: string;
    black_username: string;
    black_elo: number;
  }>(
    `SELECT g.id AS game_id,
            wu.id AS white_id, wu.username AS white_username,
            COALESCE(g.white_elo_before, wu.elo) AS white_elo,
            bu.id AS black_id, bu.username AS black_username,
            COALESCE(g.black_elo_before, bu.elo) AS black_elo
     FROM games g
     JOIN users wu ON wu.id = g.white_user_id
     JOIN users bu ON bu.id = g.black_user_id
     WHERE g.ended_at IS NULL
       AND (g.white_user_id = ANY($1::uuid[]) OR g.black_user_id = ANY($1::uuid[]))
     ORDER BY g.started_at DESC`,
    [userIds],
  );
  const byUser = new Map<string, ActiveGameInfo>();
  for (const row of result.rows) {
    const info: ActiveGameInfo = {
      gameId: row.game_id,
      white: { id: row.white_id, username: row.white_username, elo: row.white_elo },
      black: { id: row.black_id, username: row.black_username, elo: row.black_elo },
    };
    if (!byUser.has(row.white_id)) byUser.set(row.white_id, info);
    if (!byUser.has(row.black_id)) byUser.set(row.black_id, info);
  }
  return byUser;
}

/** All three friendship buckets for a user. */
export async function listFriendships(userId: string): Promise<FriendsList> {
  const [friendsResult, incomingResult, outgoingResult] = await Promise.all([
    pool.query<{ id: string; user_id: string; username: string; elo: number }>(
      `SELECT f.id, u.id AS user_id, u.username, u.elo
       FROM friendships f
       JOIN users u
         ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = 'accepted'
       ORDER BY u.username ASC`,
      [userId],
    ),
    pool.query<{ id: string; user_id: string; username: string; elo: number; created_at: string }>(
      `SELECT f.id, u.id AS user_id, u.username, u.elo, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [userId],
    ),
    pool.query<{ id: string; user_id: string; username: string; elo: number; created_at: string }>(
      `SELECT f.id, u.id AS user_id, u.username, u.elo, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [userId],
    ),
  ]);

  const activeGames = await loadActiveGames(friendsResult.rows.map((r) => r.user_id));

  const toRows = (
    rows: Array<{ id: string; user_id: string; username: string; elo: number; created_at?: string }>,
  ): FriendshipRow[] =>
    rows.map((r) => ({
      id: r.id,
      user: {
        id: r.user_id,
        username: r.username,
        elo: r.elo,
        activeGame: activeGames.get(r.user_id) ?? null,
      },
      createdAt: r.created_at ?? null,
    }));

  return {
    friends: toRows(friendsResult.rows),
    incoming: toRows(incomingResult.rows),
    outgoing: toRows(outgoingResult.rows),
  };
}

/** Accept an incoming request. Returns both profiles for the ack + realtime event. */
export async function acceptFriendRequest(
  userId: string,
  friendshipId: string,
): Promise<
  | { ok: true; friendshipId: string; requester: FriendUser; acceptor: FriendUser }
  | { ok: false; message: string }
> {
  const updated = await pool.query<{ requester_id: string }>(
    `UPDATE friendships SET status = 'accepted', responded_at = now()
     WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
     RETURNING requester_id`,
    [friendshipId, userId],
  );
  const row = updated.rows[0];
  if (!row) return { ok: false, message: 'Friend request not found' };
  const [requester, acceptor] = await Promise.all([
    loadUserById(row.requester_id),
    loadUserById(userId),
  ]);
  return {
    ok: true,
    friendshipId,
    requester: requester ?? { id: row.requester_id, username: 'unknown', elo: 0 },
    acceptor: acceptor ?? { id: userId, username: 'unknown', elo: 0 },
  };
}

/** Decline an incoming request. Returns the requester's id so callers can notify them. */
export async function declineFriendRequest(
  userId: string,
  friendshipId: string,
): Promise<{ ok: true; requesterId: string } | { ok: false; message: string }> {
  const deleted = await pool.query<{ requester_id: string }>(
    `DELETE FROM friendships
     WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
     RETURNING requester_id`,
    [friendshipId, userId],
  );
  const row = deleted.rows[0];
  if (!row) return { ok: false, message: 'Friend request not found' };
  return { ok: true, requesterId: row.requester_id };
}

/** Remove a friendship (or cancel an outgoing request). Either side can do it. */
export async function removeFriendship(
  userId: string,
  friendshipId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const deleted = await pool.query(
    `DELETE FROM friendships
     WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)`,
    [friendshipId, userId],
  );
  if (deleted.rowCount === 0) return { ok: false, message: 'Friendship not found' };
  return { ok: true };
}

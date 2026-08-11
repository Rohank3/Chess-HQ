// Shared client-side types mirroring the server socket payloads exactly.
// snake_case event names are preserved verbatim so the client never drifts
// from the server contract (see server/src/sockets/{game,matchmaking}.ts).
// These are decode-only mirrors; the client imports nothing from the server.

export type CommandColor = 'w' | 'b';
export type Color = CommandColor;

// server/src/services/games.ts:243-252
export type Termination =
  | 'checkmate'
  | 'stalemate'
  | 'draw_threefold'
  | 'draw_fiftymove'
  | 'draw_insufficient'
  | 'draw_agreed'
  | 'resignation'
  | 'timeout'
  | 'aborted';

// Ack envelope shared by every emit-with-ack handler.
// server pattern: `{ ok, error?, message?, status?, ...context }`.
export interface AckOk {
  ok: true;
  status: string;
  // contextual fields, presence depends on the handler:
  gameId?: string;
  fen?: string;
  clocks?: ClockState;
  // game:subscribe ack carries the viewer's colour + the opponent summary
  // so a deep-linked/reloaded room can rebuild its header without navigation state.
  // Spectators get no colour/opponent, but both players so the room can render
  // a read-only header.
  color?: CommandColor | null;
  opponent?: PlayerSummary | null;
  white?: PlayerSummary;
  black?: PlayerSummary;
}
export interface AckErr {
  ok: false;
  error: string;
  message?: string;
}
export type Ack = AckOk | AckErr;

// server/src/sockets/game.ts:82-111 -- the canonical game state broadcast.
export interface ClockState {
  whiteMs: number;
  blackMs: number;
  lastMoveAt: string | null;
}

export interface PieceCounts {
  p: number;
  n: number;
  b: number;
  r: number;
  q: number;
}

export interface CapturedDelta {
  // `captured.white` = the pieces White has captured (= Black's lost pieces).
  // `captured.black` = the pieces White has lost (= Black's spoils).
  white: PieceCounts;
  black: PieceCounts;
}

export interface LastMove {
  from: string;
  to: string;
  san: string;
}

export interface GameSnapshot {
  gameId: string;
  fen: string;
  turn: CommandColor;
  lastMove: LastMove | null;
  captured: CapturedDelta;
  clocks: ClockState;
  drawOffer?: { offeredBy: CommandColor; expiresAt: string };
  gameOver?: {
    winner: string | null;
    termination: Termination;
    whiteEloBefore: number | null;
    blackEloBefore: number | null;
    whiteEloAfter: number | null;
    blackEloAfter: number | null;
  };
}

// server/src/sockets/matchmaking.ts:97-112
export interface PlayerSummary {
  id: string;
  username: string;
  elo: number;
}

export interface MatchedPayload {
  gameId: string;
  color: CommandColor;
  opponent: PlayerSummary;
  timeControl: string;
  initialMs: number;
  incrementMs: number;
}

export interface GameOverPayload {
  gameId: string;
  winner: string | null;
  termination: Termination;
  whiteEloBefore: number | null;
  blackEloBefore: number | null;
  whiteEloAfter: number | null;
  blackEloAfter: number | null;
}

export interface DrawOfferedPayload {
  gameId: string;
  offeredBy: CommandColor;
  expiresAt: string;
}

export interface DrawDeclinedPayload {
  gameId: string;
}

export interface RejoinedPayload {
  games: { gameId: string }[];
}

// Shareable custom-clock challenges.
export interface ChallengeDetails {
  id: string;
  initialMs: number;
  incrementMs: number;
  creatorUserId: string;
  creatorUsername: string;
  creatorElo: number;
  expiresAt: string;
}

export interface ChallengeAcceptedPayload {
  gameId: string;
  color: CommandColor;
  opponent: PlayerSummary;
  timeControl: string;
  initialMs: number;
  incrementMs: number;
}

export interface ChallengeJoinInput {
  challengeId: string;
}

// --- Friends + direct challenges -------------------------------------------

export interface FriendUser {
  id: string;
  username: string;
  elo: number;
  online?: boolean;
  /** The friend's current live game, if they are playing one right now. */
  activeGame?: {
    gameId: string;
    white: PlayerSummary;
    black: PlayerSummary;
  } | null;
}

export interface FriendshipEntry {
  id: string;
  user: FriendUser;
  createdAt: string | null;
}

export interface FriendsResponse {
  friends: FriendshipEntry[];
  incoming: FriendshipEntry[];
  outgoing: FriendshipEntry[];
}

// Server -> target socket event when a direct challenge is created.
export interface ChallengeIncomingPayload {
  challenge: ChallengeDetails;
}

// Server -> creator when the target declines.
export interface ChallengeDeclinedPayload {
  challengeId: string;
  targetUserId: string;
  targetUsername: string;
}

// Server -> target when the creator cancels.
export interface ChallengeCancelledPayload {
  challengeId: string;
  creatorUserId: string;
}

// Server -> addressee when someone requests them.
export interface FriendRequestPayload {
  friendshipId: string;
  requester: FriendUser;
}

// Server -> requester when the request is accepted.
export interface FriendAcceptedPayload {
  friendshipId: string;
  friend: FriendUser;
}

// Server -> requester when the request is declined.
export interface FriendDeclinedPayload {
  friendshipId: string;
}

// snake_case command payloads emitted by the client.
export interface QueueJoinInput {
  timeControl: string;
  initialMs: number;
  incrementMs: number;
}

export interface MoveInput {
  gameId: string;
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

export interface GameActionInput {
  gameId: string;
}

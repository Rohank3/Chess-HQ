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
  color?: CommandColor;
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
  gameOver?: { winner: string | null; termination: Termination };
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

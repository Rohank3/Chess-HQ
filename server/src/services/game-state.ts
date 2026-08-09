import { Chess } from 'chess.js';
import { getGame } from './games.js';
import { logger } from '../utils/logger.js';

/**
 * In-memory authoritative game state: one chess.js `Chess` instance per
 * active game id. The server never trusts client-supplied FEN -- the
 * instance here is the source of truth for move legality, turn, and
 * game-over detection.
 *
 * On a server restart every in-memory instance is gone, but every active
 * game row has its current `fen` column persisted (Step 6's recordMove).
 * loadOrRehydrate pulls that FEN out of Postgres and rebuilds a Chess
 * instance, so a restart mid-game is recoverable rather than a forfeit.
 * The map is bounded by the count of active games (the partial indexes from
 * Step 2 make rejoinActiveGames an index seek, not a scan), so memory growth
 * is a function of concurrent games, not lifetime games. evictGame is called
 * from endGame's caller so a finished game releases its instance at once.
 */
class GameStateStore {
  private readonly games = new Map<string, Chess>();

  /** Return the cached instance, or rehydrate one from the persisted FEN. */
  async loadOrRehydrate(gameId: string): Promise<Chess> {
    const cached = this.games.get(gameId);
    if (cached) return cached;

    const row = await getGame(gameId);
    // chess.js@1.4 loads a FEN via the constructor. An invalid stored FEN
    // would throw here -- treat that as a corrupt game and surface it
    // rather than silently re-seeding.
    const chess = new Chess(row.fen);
    this.games.set(gameId, chess);
    logger.info('game_rehydrated', { gameId, fen: row.fen });
    return chess;
  }

  /** Seed an instance for a freshly created game. Idempotent: refuses to
   * overwrite an existing entry, so a double-seed from a racing pair of
   * reconnects cannot clobber live state. */
  seed(gameId: string, fen: string): Chess {
    const existing = this.games.get(gameId);
    if (existing) return existing;
    const chess = new Chess(fen);
    this.games.set(gameId, chess);
    return chess;
  }

  /** Drop an instance. Safe to call on an unknown id (no-op). */
  evict(gameId: string): void {
    this.games.delete(gameId);
  }

  has(gameId: string): boolean {
    return this.games.has(gameId);
  }

  size(): number {
    return this.games.size;
  }

  /** Test-only: wipe the map. Never call this from production paths. */
  reset(): void {
    this.games.clear();
  }
}

export const gameState = new GameStateStore();
export type { Chess };

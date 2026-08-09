import {
  DEFAULT_QUEUE_CONFIG,
  type MatchedPair,
  type MatchConsumer,
  type QueueConfig,
  type QueueEntry,
  type TimeControl,
} from './matchmaking.types.js';
import { logger } from '../utils/logger.js';

export class MatchmakingQueue {
  private readonly config: QueueConfig;
  private readonly queues = new Map<TimeControl, Map<string, QueueEntry>>();
  private matchConsumer: MatchConsumer | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
  }

  onMatch(consumer: MatchConsumer): void {
    this.matchConsumer = consumer;
  }

  enqueue(entry: QueueEntry): { matched: false } | { matched: true; pair: MatchedPair } {
    const pool = this.ensurePool(entry.timeControl);

    const existing = pool.get(entry.userId);
    if (existing) {
      existing.joinedAt = Date.now();
      existing.elo = entry.elo;
      existing.socketId = entry.socketId;
      return { matched: false };
    }

    const opponent = this.findOpponent(pool, entry);
    if (opponent) {
      pool.delete(opponent.userId);
      const pair = this.assignColors(entry, opponent);
      this.dispatch(pair);
      return { matched: true, pair };
    }

    pool.set(entry.userId, entry);
    return { matched: false };
  }

  dequeue(userId: string): QueueEntry | null {
    for (const pool of this.queues.values()) {
      const entry = pool.get(userId);
      if (entry) {
        pool.delete(userId);
        return entry;
      }
    }
    return null;
  }

  dequeBySocket(socketId: string): QueueEntry | null {
    for (const pool of this.queues.values()) {
      for (const [userId, entry] of pool) {
        if (entry.socketId === socketId) {
          pool.delete(userId);
          return entry;
        }
      }
    }
    return null;
  }

  queueSize(timeControl: TimeControl): number {
    return this.ensurePool(timeControl).size;
  }

  totalSize(): number {
    let total = 0;
    for (const pool of this.queues.values()) total += pool.size;
    return total;
  }

  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.sweep(), this.config.cleanupIntervalMs);
    this.cleanupTimer.unref?.();
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private sweep(): void {
    const now = Date.now();
    let swept = 0;
    for (const pool of this.queues.values()) {
      for (const [userId, entry] of pool) {
        if (now - entry.joinedAt > this.config.staleMs) {
          pool.delete(userId);
          swept += 1;
        }
      }
    }
    if (swept > 0) {
      logger.info('matchmaking_swept', { count: swept });
    }
  }

  private findOpponent(
    pool: Map<string, QueueEntry>,
    candidate: QueueEntry,
  ): QueueEntry | null {
    const now = Date.now();
    let best: QueueEntry | null = null;
    let bestDeltaElo = Number.POSITIVE_INFINITY;
    let bestCombinedWait = 0;

    for (const entry of pool.values()) {
      if (entry.userId === candidate.userId) continue;
      if (
        entry.initialMs !== candidate.initialMs ||
        entry.incrementMs !== candidate.incrementMs
      ) {
        continue;
      }

      const allowedThis = this.windowFor(entry.joinedAt, now);
      const allowedThat = this.windowFor(candidate.joinedAt, now);
      const required = Math.abs(entry.elo - candidate.elo);

      if (required <= allowedThis || required <= allowedThat) {
        const combinedWait = now - entry.joinedAt + (now - candidate.joinedAt);
        if (
          required < bestDeltaElo ||
          (required === bestDeltaElo && combinedWait > bestCombinedWait)
        ) {
          best = entry;
          bestDeltaElo = required;
          bestCombinedWait = combinedWait;
        }
      }
    }

    return best;
  }

  private windowFor(joinedAt: number, now: number): number {
    const waitedSec = Math.max(0, (now - joinedAt) / 1000);
    const steps = Math.floor(waitedSec / this.config.widenSeconds);
    const grown = steps * this.config.widenStepElo;
    const window = this.config.initialDeltaElo + grown;
    return Math.min(window, this.config.maxDeltaElo);
  }

  private assignColors(a: QueueEntry, b: QueueEntry): MatchedPair {
    const lowerPlaysWhite = a.elo <= b.elo;
    if (lowerPlaysWhite) {
      if (Math.random() < 0.5) return { white: a, black: b };
      return { white: b, black: a };
    }
    if (Math.random() < 0.5) return { white: b, black: a };
    return { white: a, black: b };
  }

  private async dispatch(pair: MatchedPair): Promise<void> {
    await this.matchConsumer?.(pair.white, pair.black);
  }

  private ensurePool(timeControl: TimeControl): Map<string, QueueEntry> {
    let pool = this.queues.get(timeControl);
    if (!pool) {
      pool = new Map<string, QueueEntry>();
      this.queues.set(timeControl, pool);
    }
    return pool;
  }
}

export const matchmakingQueue = new MatchmakingQueue();
export type { QueueEntry };

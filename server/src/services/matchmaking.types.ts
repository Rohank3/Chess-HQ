import { z } from 'zod';

export const TIME_CONTROLS = ['bullet', 'blitz', 'rapid', 'classical', 'custom'] as const;
export type TimeControl = (typeof TIME_CONTROLS)[number];

export const timeControlSchema = z.enum(TIME_CONTROLS);

export const queueJoinSchema = z.object({
  timeControl: timeControlSchema,
  initialMs: z
    .number()
    .int()
    .positive()
    .max(60 * 60 * 1000),
  incrementMs: z
    .number()
    .int()
    .nonnegative()
    .max(60 * 1000)
    .default(0),
});

export type QueueJoinInput = z.infer<typeof queueJoinSchema>;

export interface QueueEntry {
  userId: string;
  username: string;
  elo: number;
  socketId: string;
  timeControl: TimeControl;
  initialMs: number;
  incrementMs: number;
  joinedAt: number;
}

export interface MatchedPair {
  white: QueueEntry;
  black: QueueEntry;
}

export type MatchConsumer = (white: QueueEntry, black: QueueEntry) => Promise<void>;

export interface QueueConfig {
  initialDeltaElo: number;
  widenSeconds: number;
  widenStepElo: number;
  maxDeltaElo: number;
  staleMs: number;
  cleanupIntervalMs: number;
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  initialDeltaElo: 50,
  widenSeconds: 5,
  widenStepElo: 10,
  maxDeltaElo: 400,
  staleMs: 5 * 60 * 1000,
  cleanupIntervalMs: 30_000,
};

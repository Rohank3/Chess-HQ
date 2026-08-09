import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { MatchmakingQueue } from './matchmaking.js';
import type { QueueConfig } from './matchmaking.types.js';

const fastWiden: Partial<QueueConfig> = {
  initialDeltaElo: 50,
  widenSeconds: 1,
  widenStepElo: 10,
  maxDeltaElo: 400,
  staleMs: 1000,
  cleanupIntervalMs: 60_000,
};

function makeEntry(userId: string, elo: number, socketId: string, joinedAtOffsetMs = 0) {
  return {
    userId,
    username: userId,
    elo,
    socketId,
    timeControl: 'blitz' as const,
    initialMs: 180_000,
    incrementMs: 2_000,
    joinedAt: Date.now() - joinedAtOffsetMs,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

nodeTest('immediate match when two players arrive within the initial delta', async () => {
  const queue = new MatchmakingQueue(fastWiden);
  const matched: { white: string; black: string }[] = [];
  queue.onMatch((white, black) => {
    matched.push({ white: white.userId, black: black.userId });
    return Promise.resolve();
  });

  const r1 = queue.enqueue(makeEntry('a', 1200, 'sa'));
  const r2 = queue.enqueue(makeEntry('b', 1230, 'sb'));
  assert.equal(r1.matched, false);
  assert.equal(r2.matched, true);
  assert.equal(matched.length, 1);
  const players = [matched[0]!.white, matched[0]!.black].toSorted();
  assert.deepEqual(players, ['a', 'b'], 'colors assigned one each from {a, b}');
  assert.equal(queue.queueSize('blitz'), 0);
});

nodeTest('no immediate match when Elo delta exceeds initial boundary', async () => {
  const queue = new MatchmakingQueue(fastWiden);
  const matched: string[] = [];
  queue.onMatch((white, black) => {
    matched.push(white.userId);
    matched.push(black.userId);
    return Promise.resolve();
  });

  const r1 = queue.enqueue(makeEntry('a', 1200, 'sa'));
  const r2 = queue.enqueue(makeEntry('b', 1280, 'sb'));
  assert.equal(r1.matched, false);
  assert.equal(r2.matched, false);
  assert.equal(matched.length, 0);
  assert.equal(queue.queueSize('blitz'), 2);
});

nodeTest(
  'the search window widens with wait time and eventually pairs distant players',
  async () => {
    const cfg: Partial<QueueConfig> = {
      initialDeltaElo: 50,
      widenSeconds: 0.1,
      widenStepElo: 30,
      maxDeltaElo: 400,
      staleMs: 5000,
      cleanupIntervalMs: 60_000,
    };
    const queue = new MatchmakingQueue(cfg);
    const matched: string[] = [];
    queue.onMatch((white, black) => {
      matched.push(white.userId);
      matched.push(black.userId);
      return Promise.resolve();
    });

    queue.enqueue(makeEntry('a', 1200, 'sa'));
    await sleep(500);
    const r2 = queue.enqueue(makeEntry('b', 1340, 'sb'));
    assert.equal(r2.matched, true, 'should be matched as window widened past 140');
    assert.deepEqual(matched.toSorted(), ['a', 'b']);
  },
);

nodeTest('the window is capped at maxDeltaElo', async () => {
  const cfg: Partial<QueueConfig> = {
    initialDeltaElo: 50,
    widenSeconds: 0.05,
    widenStepElo: 100,
    maxDeltaElo: 180,
    staleMs: 5000,
    cleanupIntervalMs: 60_000,
  };
  const queue = new MatchmakingQueue(cfg);
  const matched: string[] = [];
  queue.onMatch((white, black) => {
    matched.push(white.userId);
    matched.push(black.userId);
    return Promise.resolve();
  });

  queue.enqueue(makeEntry('a', 1200, 'sa'));
  await sleep(200);
  const r2 = queue.enqueue(makeEntry('b', 1500, 'sb'));
  assert.equal(r2.matched, false, '300 Elo delta never fits inside a 180 window cap');
  assert.equal(queue.queueSize('blitz'), 2, 'both players remain queued');
  assert.equal(matched.length, 0);
});

nodeTest('only players with the same initial+increment clock get paired', async () => {
  const queue = new MatchmakingQueue(fastWiden);
  const matched: string[] = [];
  queue.onMatch((white, black) => {
    matched.push(white.userId);
    matched.push(black.userId);
    return Promise.resolve();
  });

  queue.enqueue({
    ...makeEntry('a', 1200, 'sa'),
    initialMs: 180_000,
    incrementMs: 2_000,
  });
  const r2 = queue.enqueue({
    ...makeEntry('b', 1200, 'sb'),
    initialMs: 300_000,
    incrementMs: 0,
  });
  assert.equal(r2.matched, false);
  assert.equal(queue.queueSize('blitz'), 2);
  assert.equal(matched.length, 0);
});

nodeTest('matching is scoped per time control', async () => {
  const queue = new MatchmakingQueue(fastWiden);
  const matched: string[] = [];
  queue.onMatch((white, black) => {
    matched.push(white.userId);
    matched.push(black.userId);
    return Promise.resolve();
  });

  queue.enqueue({ ...makeEntry('a', 1200, 'sa'), timeControl: 'rapid' });
  const r2 = queue.enqueue({ ...makeEntry('b', 1200, 'sb'), timeControl: 'blitz' });
  assert.equal(r2.matched, false);
  assert.equal(queue.queueSize('rapid'), 1);
  assert.equal(queue.queueSize('blitz'), 1);
  assert.equal(matched.length, 0);
});

nodeTest('dequeue removes a queued player before they are matched', async () => {
  const queue = new MatchmakingQueue(fastWiden);
  queue.enqueue(makeEntry('a', 1200, 'sa'));
  assert.equal(queue.queueSize('blitz'), 1);
  const removed = queue.dequeue('a');
  assert.equal(removed?.userId, 'a');
  assert.equal(queue.queueSize('blitz'), 0);
});

nodeTest('dequeBySocket removes a queued player by their socket id', async () => {
  const queue = new MatchmakingQueue({ ...fastWiden, maxDeltaElo: 40 });
  queue.enqueue(makeEntry('a', 1200, 'sa'));
  queue.enqueue(makeEntry('b', 1300, 'sb'));
  assert.equal(queue.queueSize('blitz'), 2, 'no accidental match (Elos too far apart)');
  const removed = queue.dequeBySocket('sb');
  assert.equal(removed?.userId, 'b');
  assert.equal(queue.queueSize('blitz'), 1);
});

nodeTest(
  're-enqueueing the same user refreshes their queue position instead of double-queueing',
  async () => {
    const queue = new MatchmakingQueue(fastWiden);
    queue.enqueue(makeEntry('a', 1200, 'sa'));
    assert.equal(queue.queueSize('blitz'), 1);
    queue.enqueue({ ...makeEntry('a', 1200, 'sa'), elo: 1210 });
    assert.equal(queue.queueSize('blitz'), 1, 'still one entry for user a');
    const removed = queue.dequeue('a');
    assert.equal(removed?.elo, 1210, 'refreshed elo should persist');
  },
);

nodeTest('sweep removes only stale entries past the staleMs cutoff', async () => {
  const queue = new MatchmakingQueue({
    initialDeltaElo: 5,
    widenSeconds: 1,
    widenStepElo: 1,
    maxDeltaElo: 8,
    staleMs: 300,
    cleanupIntervalMs: 5,
  });
  queue.enqueue(makeEntry('a', 1200, 'sa', 400));
  queue.enqueue(makeEntry('b', 1300, 'sb', 0));
  queue.startCleanup();
  await sleep(20);
  assert.equal(
    queue.queueSize('blitz'),
    1,
    'a (400ms+ waited beyond staleMs=300) removed; b (~20ms waited, not stale) kept',
  );
  queue.stopCleanup();
});

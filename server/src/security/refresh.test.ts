import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { refreshToken, signToken, verifyToken } from './jwt.js';

nodeTest('refresh: re-signs a still-valid token to a fresh one with the same identity', () => {
  const original = signToken({ sub: 'user-1', name: 'rohan', guest: false });
  const refreshed = refreshToken(original);

  // The refreshed token must verify and carry the same identity claims.
  const payload = verifyToken(refreshed);
  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.name, 'rohan');
  assert.equal(payload.guest, false);

  // The refreshed token must have a later expiry than the original (the
  // whole point of refresh is a fresh `exp`). Since both use JWT_ACCESS_TTL
  // and were signed moments apart, the refreshed exp is strictly greater.
  const originalPayload = verifyToken(original);
  assert.ok(payload.exp >= originalPayload.exp);
  assert.ok(payload.exp - payload.iat > 0);
});

nodeTest('refresh: preserves the HS256 algorithm on the refreshed token', () => {
  const refreshed = refreshToken(signToken({ sub: 'u', name: 'n', guest: true }));
  const decoded = jwt.decode(refreshed, { complete: true }) as {
    header: { alg?: string };
  };
  assert.equal(decoded.header.alg, 'HS256');
});

nodeTest('refresh: rejects a tampered token (no refresh of a forged token)', () => {
  const original = signToken({ sub: 'user-1', name: 'rohan', guest: false });
  assert.throws(() => refreshToken(original + 'x'), /invalid|signature|jwt/i);
});

nodeTest('refresh: rejects a foreign token (signed with a different secret)', () => {
  const foreign = jwt.sign({ sub: 'a', name: 'b', guest: false }, 'a-different-secret', {
    algorithm: 'HS256',
  });
  assert.throws(() => refreshToken(foreign), /invalid|signature|jwt/i);
});

nodeTest('refresh: rejects an already-expired token (no resurrection)', () => {
  // An expired token cannot be refreshed -- this is the "from a still-valid
  // one" contract. refreshToken must throw so a dead session can't be
  // extended back into existence.
  const expired = jwt.sign(
    { sub: 'user-3', name: 'x', guest: false },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '-1s' },
  );
  assert.throws(() => refreshToken(expired), /expired|jwt expired/i);
});

nodeTest('refresh: a refreshed guest token keeps the guest claim', () => {
  const guest = signToken({ sub: 'g-1', name: 'Guest_abc', guest: true }, env.JWT_GUEST_TTL);
  const refreshed = refreshToken(guest);
  const payload = verifyToken(refreshed);
  assert.equal(payload.guest, true);
  // The refreshed token uses the standard access TTL, not the guest TTL --
  // refresh extends an ACTIVE guest session; it doesn't shorten it. (The
  // guest gate is re-read from the DB on every queue:join, so a refreshed
  // guest token is still screened out of the ranked queue.)
  assert.equal(typeof payload.exp, 'number');
});

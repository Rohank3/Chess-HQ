import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { signToken, verifyToken } from './jwt.js';

nodeTest('jwt: signToken round-trips through verifyToken', () => {
  const t = signToken({ sub: 'user-1', name: 'rohan', guest: false });
  const payload = verifyToken(t);
  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.name, 'rohan');
  assert.equal(payload.guest, false);
  assert.equal(typeof payload.iat, 'number');
  assert.equal(typeof payload.exp, 'number');
  assert.ok(payload.exp > payload.iat);
});

nodeTest('jwt: verifyToken rejects a tampered token', () => {
  const t = signToken({ sub: 'user-1', name: 'rohan', guest: false });
  assert.throws(
    () => verifyToken(t + 'x'),
    /invalid|signature|jwt/i,
    'a tampered token should throw',
  );
});

nodeTest('jwt: verifyToken rejects a token signed with a different secret', () => {
  const t = jwt.sign({ sub: 'a', name: 'b', guest: false }, 'a-different-secret');
  assert.throws(
    () => verifyToken(t),
    /invalid|signature|jwt/i,
    'a foreign token should throw',
  );
});

nodeTest('jwt: signToken uses the configured HS256 algorithm', () => {
  const t = signToken({ sub: 'user-2', name: 'n', guest: true });
  const decoded = jwt.decode(t, { complete: true }) as {
    header: { alg?: string };
  };
  assert.equal(decoded.header.alg, 'HS256');
});

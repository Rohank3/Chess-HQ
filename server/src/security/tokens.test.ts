import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { generateEmailToken, hashEmailToken } from './tokens.js';

nodeTest('tokens: generated tokens are 64 hex chars (32 random bytes)', () => {
  const token = generateEmailToken();
  assert.match(token, /^[0-9a-f]{64}$/);
});

nodeTest('tokens: two generated tokens differ', () => {
  assert.notEqual(generateEmailToken(), generateEmailToken());
});

nodeTest('tokens: the hash is deterministic and never the raw token', () => {
  const token = generateEmailToken();
  const hash = hashEmailToken(token);
  assert.equal(hash, hashEmailToken(token));
  assert.notEqual(hash, token);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

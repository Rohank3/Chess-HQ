import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './argon.js';

nodeTest('argon2id: hash is non-empty and encodes argon2id', async () => {
  const h = await hashPassword('correct horse battery staple');
  assert.ok(
    h.startsWith('$argon2id$'),
    `expected $argon2id$ prefix, got ${h.slice(0, 12)}`,
  );
  assert.ok(h.length > 80);
});

nodeTest(
  'argon2id: verify succeeds on correct password, fails on wrong password',
  async () => {
    const h = await hashPassword('hunter2-but-actually-long-enough');
    assert.equal(await verifyPassword(h, 'hunter2-but-actually-long-enough'), true);
    assert.equal(await verifyPassword(h, 'wrong-password'), false);
  },
);

nodeTest(
  'argon2id: verify returns false on a malformed hash instead of throwing',
  async () => {
    assert.equal(await verifyPassword('not-a-real-hash', 'anything'), false);
    assert.equal(await verifyPassword('', 'anything'), false);
  },
);

nodeTest('argon2id: hashes for the same password differ (random salt)', async () => {
  const a = await hashPassword('same-password-x');
  const b = await hashPassword('same-password-x');
  assert.notEqual(a, b, 'salt should make hashes distinct');
  assert.equal(await verifyPassword(a, 'same-password-x'), true);
  assert.equal(await verifyPassword(b, 'same-password-x'), true);
});

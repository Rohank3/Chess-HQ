import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { registerSchema, loginSchema } from './validation.js';

nodeTest('validation: register accepts a well-formed user', () => {
  const result = registerSchema.safeParse({
    username: 'rohan',
    email: 'rohan@example.com',
    password: 'long-enough-pw',
  });
  assert.ok(result.success, JSON.stringify(result.error));
});

nodeTest('validation: register rejects a short username', () => {
  const result = registerSchema.safeParse({
    username: 'ro',
    email: 'r@example.com',
    password: 'long-enough-pw',
  });
  assert.ok(!result.success);
});

nodeTest('validation: register rejects an invalid username charset', () => {
  const result = registerSchema.safeParse({
    username: 'rohan has spaces',
    email: 'r@example.com',
    password: 'long-enough-pw',
  });
  assert.ok(!result.success);
});

nodeTest('validation: register rejects a too-short password', () => {
  const result = registerSchema.safeParse({
    username: 'rohan',
    email: 'r@example.com',
    password: 'short',
  });
  assert.ok(!result.success);
});

nodeTest('validation: register accepts a null email (optional field)', () => {
  const result = registerSchema.safeParse({
    username: 'rohan',
    email: null,
    password: 'long-enough-pw',
  });
  assert.ok(result.success);
});

nodeTest('validation: register rejects a malformed email', () => {
  const result = registerSchema.safeParse({
    username: 'rohan',
    email: 'not-an-email',
    password: 'long-enough-pw',
  });
  assert.ok(!result.success);
});

nodeTest('validation: login accepts identifier + password', () => {
  const result = loginSchema.safeParse({ identifier: 'rohan', password: 'any-password' });
  assert.ok(result.success);
});

nodeTest('validation: login rejects empty identifier', () => {
  const result = loginSchema.safeParse({ identifier: '', password: 'any-password' });
  assert.ok(!result.success);
});

nodeTest('validation: login rejects empty password', () => {
  const result = loginSchema.safeParse({ identifier: 'rohan', password: '' });
  assert.ok(!result.success);
});

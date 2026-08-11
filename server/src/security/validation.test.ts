import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './validation.js';

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

nodeTest('validation: register rejects a missing email (required field)', () => {
  const result = registerSchema.safeParse({
    username: 'rohan',
    password: 'long-enough-pw',
  });
  assert.ok(!result.success);
});

nodeTest('validation: register rejects a null email (required field)', () => {
  const result = registerSchema.safeParse({
    username: 'rohan',
    email: null,
    password: 'long-enough-pw',
  });
  assert.ok(!result.success);
});

nodeTest('validation: register rejects a malformed email', () => {
  const result = registerSchema.safeParse({
    username: 'rohan',
    email: 'not-an-email',
    password: 'long-enough-pw',
  });
  assert.ok(!result.success);
});

nodeTest('validation: emails are normalized to lowercase', () => {
  const result = registerSchema.safeParse({
    username: 'rohan',
    email: 'Rohan@Example.COM',
    password: 'long-enough-pw',
  });
  assert.ok(result.success);
  assert.equal(result.data.email, 'rohan@example.com');
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

nodeTest('validation: verify-email rejects a short token', () => {
  const result = verifyEmailSchema.safeParse({ token: 'short' });
  assert.ok(!result.success);
});

nodeTest('validation: verify-email accepts a 64-char hex token', () => {
  const result = verifyEmailSchema.safeParse({
    token: 'a'.repeat(64),
  });
  assert.ok(result.success);
});

nodeTest('validation: forgot-password rejects a malformed email', () => {
  const result = forgotPasswordSchema.safeParse({ email: 'nope' });
  assert.ok(!result.success);
});

nodeTest('validation: reset-password enforces the password rules', () => {
  const bad = resetPasswordSchema.safeParse({ token: 'a'.repeat(64), password: 'short' });
  assert.ok(!bad.success);
  const good = resetPasswordSchema.safeParse({ token: 'a'.repeat(64), password: 'long-enough-pw' });
  assert.ok(good.success);
});

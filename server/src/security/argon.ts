import { hash, verify } from '@node-rs/argon2';

const ARGON2_ALGORITHM_ID = 2;
const ARGON2_OPTIONS = {
  algorithm: ARGON2_ALGORITHM_ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} satisfies Parameters<typeof hash>[1];

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  if (!hashed) return false;
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

import { z } from 'zod';

export const usernameSchema = z
  .string()
  .min(3, { message: 'Username must be at least 3 characters' })
  .max(24, { message: 'Username must be at most 24 characters' })
  .regex(/^[A-Za-z0-9_-]+$/, {
    message: 'Username may only contain letters, numbers, underscores, and dashes',
  });

export const passwordSchema = z
  .string()
  .min(8, { message: 'Password must be at least 8 characters' })
  .max(128, { message: 'Password must be at most 128 characters' });

export const emailSchema = z
  .string()
  .email({ message: 'Invalid email' })
  .max(254)
  .nullish();

export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  identifier: z.string().min(1, { message: 'Identifier is required' }).max(254),
  password: z.string().min(1, { message: 'Password is required' }).max(128),
});

/**
 * Pagination shape for the `/api/stats/me` recent-games pager. The server
 * still clamps the parsed values to a safe range, but routing through zod
 * means a non-numeric `?limit=abc` returns a clean `validation_error` ack
 * instead of a NaN fallthrough. `limit` is clamped to [1, 50] and `offset`
 * coerced to a non-negative int so a caller can't pull the whole games
 * table in one request or send the offset negative.
 */
export const statsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

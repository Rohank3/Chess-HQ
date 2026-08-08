import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface JwtPayload {
  sub: string;
  name: string;
  guest: boolean;
}

export interface VerifiedToken extends JwtPayload {
  iat: number;
  exp: number;
}

type ExpiresIn = Exclude<SignOptions['expiresIn'], undefined>;

export function signToken(payload: JwtPayload): string {
  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TTL as ExpiresIn,
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyToken(token: string): VerifiedToken {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as VerifiedToken;
}

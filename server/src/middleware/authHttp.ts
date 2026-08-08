import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../security/jwt.js';
import { unauthorized } from '../utils/http-error.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(unauthorized('missing_token', 'Authorization header is required'));
  }

  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyToken(token);
    req.user = {
      id: payload.sub,
      username: payload.name,
      email: null,
      isGuest: payload.guest,
    };
    next();
  } catch {
    return next(unauthorized('invalid_token', 'Token is invalid or expired'));
  }
}

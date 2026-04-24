import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../lib/logger';

// 🔒 JWT_SECRET y REFRESH_SECRET obligatorios
const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.REFRESH_SECRET || process.env.JWT_SECRET;

if (!JWT_SECRET) {
  logger.error('FATAL: JWT_SECRET no configurado');
  process.exit(1);
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    impersonatedBy?: string;
  };
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Token no proporcionado' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET!) as {
      id: string;
      email: string;
      impersonatedBy?: string;
    };

    (req as AuthRequest).user = {
      id: decoded.id,
      email: decoded.email,
      impersonatedBy: decoded.impersonatedBy,
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    } else {
      res.status(401).json({ error: 'Token inválido' });
    }
  }
};

/**
 * 🔑 Genera accessToken + refreshToken
 * accessToken: expira en 8h (balance seguridad/UX)
 * refreshToken: expira en 30d
 */
export const generateTokens = (userId: string, email: string) => {
  const accessToken = jwt.sign(
    { id: userId, email },
    JWT_SECRET!,
    { expiresIn: '8h', issuer: 'bizonne' }
  );

  const refreshToken = jwt.sign(
    { id: userId, type: 'refresh' },
    REFRESH_SECRET!,
    { expiresIn: '30d', issuer: 'bizonne' }
  );

  return { accessToken, refreshToken, expiresIn: 28800 };
};

/**
 * 🔄 Verifica un refresh token
 */
export const verifyRefreshToken = (token: string): { id: string } | null => {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET!) as { id: string; type: string };
    if (decoded.type !== 'refresh') return null;
    return { id: decoded.id };
  } catch {
    return null;
  }
};

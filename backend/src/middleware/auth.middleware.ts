import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// 🔒 SEGURIDAD: JWT_SECRET obligatorio — NO fallback hardcodeado
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET no está configurado en las variables de entorno');
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
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string; impersonatedBy?: string };

    (req as AuthRequest).user = {
      id: decoded.id,
      email: decoded.email,
      impersonatedBy: decoded.impersonatedBy
    };

    next();
  } catch (error) {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

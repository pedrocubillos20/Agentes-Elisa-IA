import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Extender el tipo Request para incluir userId y user
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      user?: any;
    }
  }
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];
    
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'elisa-ia-secret-key-change-in-production'
    ) as { userId: string; email: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    req.userId = user.id;
    req.user = user;
    next();
  } catch (error) {
    console.error('Error de autenticación:', error);
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

// Middleware opcional para verificar si es admin
export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de administrador.' });
    }
    next();
  } catch (error) {
    next(error);
  }
};

// Middleware para verificar si tiene API key de OpenAI
export const requireApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user?.openaiApiKey) {
      return res.status(400).json({ 
        error: 'API Key de OpenAI no configurada',
        code: 'OPENAI_KEY_REQUIRED'
      });
    }
    next();
  } catch (error) {
    next(error);
  }
};

// Middleware para verificar plan activo
export const requireActivePlan = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (req.user?.plan === 'FREE') {
      return res.status(403).json({ 
        error: 'Esta función requiere un plan de pago',
        code: 'PLAN_REQUIRED'
      });
    }
    next();
  } catch (error) {
    next(error);
  }
};

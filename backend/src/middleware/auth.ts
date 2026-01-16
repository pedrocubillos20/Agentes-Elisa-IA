import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Extender el tipo Request para incluir userId
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      user?: any;
    }
  }
}

// ==========================================
// MIDDLEWARE DE AUTENTICACIÓN
// ==========================================
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Obtener token del header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];

    // Verificar token
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };

    // Verificar que el usuario existe y está activo
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        isActive: true,
        isAdmin: true,
        plan: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: 'Cuenta desactivada' });
    }

    // Agregar userId al request
    req.userId = user.id;
    req.user = user;

    next();
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token inválido' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado' });
    }
    next(error);
  }
};

// ==========================================
// MIDDLEWARE DE ADMIN
// ==========================================
export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de administrador.' });
  }
  next();
};

// ==========================================
// MIDDLEWARE PARA VERIFICAR API KEY CONECTADA
// ==========================================
export const requireApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { apiKeyConnected: true },
  });

  if (!user?.apiKeyConnected) {
    return res.status(400).json({
      error: 'Debes conectar tu API Key de OpenAI primero',
      code: 'API_KEY_REQUIRED',
    });
  }

  next();
};

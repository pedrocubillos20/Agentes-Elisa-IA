import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// ==========================================
// ERROR HANDLER GLOBAL
// ==========================================
export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Log del error
  logger.error({
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body,
  });

  // Errores de Prisma
  if (err.code === 'P2002') {
    return res.status(400).json({
      error: 'Ya existe un registro con esos datos',
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      error: 'Registro no encontrado',
    });
  }

  // Error genérico
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Error interno del servidor';

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

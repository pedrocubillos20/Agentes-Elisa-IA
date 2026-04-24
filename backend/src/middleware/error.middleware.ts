/**
 * 🔥 ERROR MIDDLEWARE — Manejo centralizado de errores
 * 
 * CORRECCIÓN: Sin esto, los errores no manejados dan stack traces
 * completos al cliente (expone rutas internas, librerías, etc.)
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';

/** Captura errores de rutas async que no tienen try/catch */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/** Middleware global de errores — DEBE ser el último app.use() */
export const globalErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Log completo interno
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: (req as any).user?.id,
  });

  // Errores conocidos de Prisma
  if (err.code === 'P2025') {
    res.status(404).json({ error: 'Registro no encontrado' });
    return;
  }
  if (err.code === 'P2002') {
    res.status(409).json({ error: 'Ya existe un registro con esos datos' });
    return;
  }
  if (err.code === 'P2024') {
    res.status(503).json({ error: 'Servicio no disponible temporalmente. Intenta de nuevo.' });
    return;
  }

  // Errores de JWT
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    res.status(401).json({ error: 'Token inválido o expirado' });
    return;
  }

  // Error genérico — nunca exponer stack trace al cliente
  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : 'Error interno del servidor';
  res.status(status).json({ error: message });
};

/** Ruta 404 */
export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({ error: `Ruta ${req.path} no encontrada` });
};

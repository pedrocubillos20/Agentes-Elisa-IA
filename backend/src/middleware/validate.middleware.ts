/**
 * ✅ VALIDATE MIDDLEWARE — Zod validación centralizada
 * 
 * CORRECCIÓN: Sin este middleware, cualquier ruta acepta input
 * arbitrario (null, undefined, XSS, DoS via payloads enormes).
 * 
 * Uso:
 *   router.post('/login', validateBody(LoginSchema), handler);
 *   router.get('/items', validateQuery(QuerySchema), handler);
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import logger from '../lib/logger';

/** Valida req.body contra un schema Zod */
export const validateBody = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        logger.warn('Validation failed', { path: req.path, issues });
        res.status(400).json({
          error: 'Datos inválidos',
          issues,
        });
        return;
      }
      next(error);
    }
  };
};

/** Valida req.query contra un schema Zod */
export const validateQuery = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        res.status(400).json({ error: 'Query inválida', issues });
        return;
      }
      next(error);
    }
  };
};

/** Valida req.params contra un schema Zod */
export const validateParams = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ error: 'Parámetros inválidos' });
        return;
      }
      next(error);
    }
  };
};

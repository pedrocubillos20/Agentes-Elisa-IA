import prisma from './prisma';
import { ownerIdCache } from './cache';
import logger from './logger';

/**
 * ⚡ CACHED getOwnerId — SINGLE SOURCE OF TRUTH
 * Todas las rutas importan desde aquí.
 */
export const getOwnerId = async (userId: string): Promise<string> => {
  const cached = ownerIdCache.get(userId);
  if (cached) return cached;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { parentUserId: true }
  });
  const ownerId = user?.parentUserId || userId;

  ownerIdCache.set(userId, ownerId);
  return ownerId;
};

export const invalidateOwnerCache = (userId: string) => {
  ownerIdCache.delete(userId);
};

/**
 * ⚡ LOGGER — Re-export de Winston para retrocompatibilidad
 * CORRECCIÓN: Antes había un mini-logger básico aquí.
 * Ahora todos los módulos usan Winston via lib/logger.ts
 */
export { logger };

// Alias de compatibilidad para módulos que usaban el logger viejo
export const log = {
  info:  (msg: string) => logger.info(msg),
  warn:  (msg: string) => logger.warn(msg),
  error: (msg: string) => logger.error(msg),
  important: (msg: string) => logger.info(msg),
  dev:   (msg: string) => { if (process.env.NODE_ENV !== 'production') logger.debug(msg); },
};

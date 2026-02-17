import prisma from './prisma';
import { ownerIdCache } from './cache';

/**
 * ⚡ CACHED getOwnerId — SINGLE SOURCE OF TRUTH
 * 
 * ANTES: 9 copias duplicadas en 9 archivos, cada una con su propio Map
 * AHORA: Una sola función, un solo cache (LRU con límite de 500 entries)
 * 
 * Todas las rutas importan de aquí: import { getOwnerId } from '../lib/helpers';
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
 * ⚡ PRODUCTION LOGGER
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export const logger = {
  info: (...args: any[]) => { if (!IS_PRODUCTION) console.log(...args); },
  warn: (...args: any[]) => { console.warn(...args); },
  error: (...args: any[]) => { console.error(...args); },
  important: (...args: any[]) => { console.log(...args); }
};

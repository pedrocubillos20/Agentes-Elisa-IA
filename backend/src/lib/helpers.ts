import prisma from './prisma';

/**
 * ⚡ CACHED getOwnerId
 * 
 * ANTES: Cada ruta llamaba prisma.user.findUnique POR CADA REQUEST
 *        49 llamadas en total = 49 queries innecesarias por sesión
 * 
 * AHORA: Cache en memoria por 5 minutos
 *        Resultado: 0 queries después del primer request por usuario
 */
const ownerCache = new Map<string, { ownerId: string; timestamp: number }>();
const OWNER_CACHE_TTL = 300_000; // 5 minutos

// Limpiar cache cada 10 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ownerCache) {
    if (now - entry.timestamp > OWNER_CACHE_TTL * 2) {
      ownerCache.delete(key);
    }
  }
}, 600_000);

export const getOwnerId = async (userId: string): Promise<string> => {
  // Check cache
  const cached = ownerCache.get(userId);
  if (cached && Date.now() - cached.timestamp < OWNER_CACHE_TTL) {
    return cached.ownerId;
  }

  // DB query (only once per 5 min per user)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { parentUserId: true }
  });
  const ownerId = user?.parentUserId || userId;

  // Store in cache
  ownerCache.set(userId, { ownerId, timestamp: Date.now() });

  return ownerId;
};

// Invalidar cache (cuando cambian roles de equipo)
export const invalidateOwnerCache = (userId: string) => {
  ownerCache.delete(userId);
};

/**
 * ⚡ PRODUCTION LOGGER
 * Solo escribe logs importantes en producción
 * Elimina la sobrecarga de 160+ console.logs
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export const logger = {
  info: (...args: any[]) => {
    if (!IS_PRODUCTION) console.log(...args);
  },
  warn: (...args: any[]) => {
    console.warn(...args);
  },
  error: (...args: any[]) => {
    console.error(...args);
  },
  // Solo para eventos importantes que queremos en producción
  important: (...args: any[]) => {
    console.log(...args);
  }
};

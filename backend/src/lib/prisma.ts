import { PrismaClient } from '@prisma/client';
import logger from './logger';

/**
 * ⚡ PRISMA CLIENT — v7.3 CON RECONEXIÓN AUTOMÁTICA
 *
 * FIXES v7.3:
 * 1. Pool reducido a 5 (Railway free plan limit)
 * 2. Reconexión automática en P1017 / P1001 / closed
 * 3. Retry wrapper para queries críticos
 * 4. statement_cache_size=0 para pgbouncer compatibility
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const getDatabaseUrl = (): string => {
  const url = process.env.DATABASE_URL || '';
  if (!url) {
    logger.error('DATABASE_URL no configurado');
    process.exit(1);
  }
  if (url.includes('connection_limit')) return url;

  const separator = url.includes('?') ? '&' : '?';
  const params = [
    'connection_limit=5',        // Railway free: máx 5-10 conexiones
    'pool_timeout=20',           // 20s espera conexión disponible
    'connect_timeout=15',        // 15s para conectar
    'socket_timeout=60',         // 60s timeout de socket
  ];

  // pgbouncer para Supabase pooler (puerto 6543)
  if (url.includes(':6543') && !url.includes('pgbouncer')) {
    params.push('pgbouncer=true', 'statement_cache_size=0');
  }

  return `${url}${separator}${params.join('&')}`;
};

const createPrismaClient = () => new PrismaClient({
  datasources: { db: { url: getDatabaseUrl() } },
  log: [{ emit: 'event', level: 'error' }],
  transactionOptions: { maxWait: 10000, timeout: 30000 }
});

let prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

// Conectar logs a Winston
(prisma as any).$on('error', (e: any) => {
  logger.error('Prisma error', { message: e.message });
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// ===================================================
// 🔄 AUTO-RECONEXIÓN — Railway cierra conexiones idle
// ===================================================
let isReconnecting = false;

const reconnect = async () => {
  if (isReconnecting) return;
  isReconnecting = true;
  logger.warn('🔄 Prisma: reconectando a la base de datos...');
  try {
    await prisma.$disconnect();
  } catch (_) {}
  await new Promise(r => setTimeout(r, 2000));
  try {
    prisma = createPrismaClient();
    await prisma.$connect();
    logger.info('✅ Prisma: reconectado correctamente');
  } catch (e: any) {
    logger.error('❌ Prisma: fallo en reconexión', { error: e.message });
  }
  isReconnecting = false;
};

// Detectar errores de conexión y reconectar
const CONNECTION_ERRORS = ['P1017', 'P1001', 'P1002', 'closed', 'DbHandler', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'];

const isConnectionError = (e: any): boolean => {
  const msg = String(e?.message || e?.code || '').toLowerCase();
  return CONNECTION_ERRORS.some(k => msg.toLowerCase().includes(k.toLowerCase()));
};

// ===================================================
// 🛡️ withRetry — Wrapper con reconexión automática
// Úsalo en queries críticos: await withRetry(() => prisma.user.findUnique(...))
// ===================================================
export const withRetry = async <T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 1500
): Promise<T> => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (isConnectionError(e) && i < retries - 1) {
        logger.warn(`🔄 Prisma retry ${i + 1}/${retries}: ${e.message?.slice(0, 80)}`);
        await reconnect();
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      } else {
        throw e;
      }
    }
  }
  throw new Error('withRetry: max retries reached');
};

// Ping periódico cada 4 minutos para mantener conexión viva
const PING_INTERVAL = 4 * 60 * 1000;
setInterval(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e: any) {
    if (isConnectionError(e)) {
      logger.warn('🔄 Prisma ping falló — reconectando...');
      await reconnect();
    }
  }
}, PING_INTERVAL);

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`${signal} recibido — desconectando Prisma`);
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
};
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Proxy para reconexión transparente en cualquier query
const prismaProxy = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const val = (prisma as any)[prop];
    if (typeof val === 'function') {
      return (...args: any[]) => val.apply(prisma, args);
    }
    if (val && typeof val === 'object' && prop !== '$on') {
      return new Proxy(val, {
        get(_, method) {
          const fn = (prisma as any)[prop as string][method as string];
          if (typeof fn !== 'function') return fn;
          return async (...args: any[]) => {
            try {
              return await fn.apply((prisma as any)[prop as string], args);
            } catch (e: any) {
              if (isConnectionError(e)) {
                logger.warn(`🔄 Auto-reconexión en ${String(prop)}.${String(method)}`);
                await reconnect();
                return await (prisma as any)[prop as string][method as string](...args);
              }
              throw e;
            }
          };
        }
      });
    }
    return val;
  }
});

export default prismaProxy as unknown as PrismaClient;

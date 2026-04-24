import { PrismaClient } from '@prisma/client';
import logger from './logger';

/**
 * ⚡ PRISMA CLIENT — v7.2 OPTIMIZADO
 * 
 * CORRECCIÓN v7.2:
 * 1. Pool aumentado a 20 conexiones (antes 10 era insuficiente bajo carga)
 * 2. Pool timeout 30s (estable)
 * 3. Transaction timeout 45s
 * 4. Graceful shutdown + logs con Winston
 * 5. pgbouncer auto-detectado para Supabase
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

  // Si ya tiene parámetros de pool, no modificar
  if (url.includes('connection_limit') || url.includes('pool_timeout')) {
    return url;
  }

  const separator = url.includes('?') ? '&' : '?';
  const params = [
    'connection_limit=20',   // CORREGIDO: 20 conexiones (antes 10, antes 5)
    'pool_timeout=30',       // 30s wait for available connection
    'connect_timeout=10',    // 10s para establecer conexión
  ];

  // pgbouncer para Supabase pooler (puerto 6543)
  if (url.includes(':6543') && !url.includes('pgbouncer')) {
    params.push('pgbouncer=true');
  }

  return `${url}${separator}${params.join('&')}`;
};

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasources: {
    db: { url: getDatabaseUrl() }
  },
  log: process.env.NODE_ENV === 'production'
    ? [{ emit: 'event', level: 'error' }]
    : [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
  transactionOptions: {
    maxWait: 15000,  // 15s max wait for transaction slot
    timeout: 45000   // 45s max transaction duration
  }
});

// Conectar logs de Prisma a Winston
(prisma as any).$on('error', (e: any) => {
  logger.error('Prisma error', { message: e.message, target: e.target });
});
(prisma as any).$on('warn', (e: any) => {
  logger.warn('Prisma warning', { message: e.message });
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`${signal} recibido — desconectando Prisma`);
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default prisma;

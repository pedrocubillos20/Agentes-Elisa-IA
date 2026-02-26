import { PrismaClient } from '@prisma/client';

/**
 * ⚡ PRISMA CLIENT — v7.1 OPTIMIZADO PARA SUPABASE
 * 
 * FIX v7.1: Resuelve error P2024 "Timed out fetching connection from pool"
 * 
 * CAMBIOS:
 * 1. Pool de 10 conexiones (antes 5 — el dashboard usa 18+ queries)
 * 2. Pool timeout 30s (antes 15s — causaba cascading failures)
 * 3. Transaction timeout extendido a 45s
 * 4. Graceful shutdown handler
 * 
 * NOTA: El endpoint /dashboard ahora usa queries secuenciales en batches
 * de 5, lo cual reduce la presión sobre el pool.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const getDatabaseUrl = (): string => {
  const url = process.env.DATABASE_URL || '';
  
  // Si ya tiene parámetros, no modificar
  if (url.includes('connection_limit') || url.includes('pool_timeout')) {
    return url;
  }
  
  const separator = url.includes('?') ? '&' : '?';
  const params = [
    'connection_limit=10',    // 10 conexiones (dashboard batched + rest of app)
    'pool_timeout=30',        // 30s wait for available connection
  ];
  
  // pgbouncer para Supabase pooler (port 6543)
  if (url.includes(':6543') && !url.includes('pgbouncer')) {
    params.push('pgbouncer=true');
  }
  
  return `${url}${separator}${params.join('&')}`;
};

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasources: {
    db: { url: getDatabaseUrl() }
  },
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  transactionOptions: {
    maxWait: 15000,   // 15s max wait for transaction slot
    timeout: 45000    // 45s max transaction duration
  }
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Graceful shutdown
const shutdown = async () => {
  console.log('🔌 Prisma disconnecting...');
  await prisma.$disconnect();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default prisma;

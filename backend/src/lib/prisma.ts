import { PrismaClient } from '@prisma/client';

/**
 * ⚡ PRISMA CLIENT — OPTIMIZADO PARA SUPABASE
 * 
 * MEJORAS:
 * 1. Connection pool configurado (20 conexiones, 10s timeout)
 * 2. Compatible con Supabase Supavisor (transaction mode, port 6543)
 * 3. Transacciones con timeout extendido para saves grandes
 * 4. Solo log errores en producción
 * 
 * IMPORTANTE: En Supabase, usa la URL del Pooler (puerto 6543):
 *   postgres://postgres.[REF]:[PASS]@aws-0-xxx.pooler.supabase.com:6543/postgres
 *   Agrega: ?pgbouncer=true&connection_limit=20
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Build optimized connection URL
const getDatabaseUrl = (): string => {
  const url = process.env.DATABASE_URL || '';
  
  // If URL already has params, don't modify
  if (url.includes('connection_limit') || url.includes('pool_timeout')) {
    return url;
  }
  
  // Add connection pool params for Supabase
  const separator = url.includes('?') ? '&' : '?';
  const params = [
    'connection_limit=20',    // Max 20 connections in Prisma pool
    'pool_timeout=10',        // Wait 10s for available connection
  ];
  
  // Add pgbouncer=true if using Supabase pooler (port 6543)
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
    maxWait: 10000,   // 10s max wait for transaction slot
    timeout: 30000    // 30s max transaction duration
  }
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;

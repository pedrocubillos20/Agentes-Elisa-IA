import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  },
  // Solo log errores en producción
  log: process.env.NODE_ENV === 'production' 
    ? ['error'] 
    : ['error', 'warn'],
  // ⏱️ Increase transaction timeout for large JSON saves (media items)
  transactionOptions: {
    maxWait: 10000,   // 10s max wait for transaction slot
    timeout: 30000    // 30s max transaction duration
  }
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;

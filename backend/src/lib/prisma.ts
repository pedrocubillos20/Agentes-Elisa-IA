import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  // ⚡ Optimización de conexiones
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  },
  // Solo log errores en producción (reduce overhead)
  log: process.env.NODE_ENV === 'production' 
    ? ['error'] 
    : ['error', 'warn']
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;

import { PrismaClient } from '@prisma/client';

// Configuración para evitar el error "prepared statement already exists"
const prismaClientSingleton = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });
};

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

// En desarrollo, reutilizamos la conexión para evitar múltiples instancias
// En producción, creamos una nueva instancia
const prisma = globalThis.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

// Manejar cierre de conexión apropiadamente
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;

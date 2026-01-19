import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

const prisma = global.prisma || new PrismaClient({
  log: ['error', 'warn'],
  errorFormat: 'pretty',
});

// Manejar errores de conexión
prisma.$connect()
  .then(() => {
    console.log('✅ Conectado a la base de datos');
  })
  .catch((error) => {
    console.error('❌ Error conectando a la base de datos:', error);
  });

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export default prisma;

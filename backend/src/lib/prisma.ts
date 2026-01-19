import { PrismaClient } from '@prisma/client';

// Función para obtener la URL de la base de datos con configuración correcta
const getDatabaseUrl = (): string => {
  let url = process.env.DATABASE_URL || '';
  
  // Si la URL no tiene parámetros de pgbouncer, agregarlos
  // Esto es necesario para Supabase que usa PgBouncer
  if (url && !url.includes('pgbouncer=true')) {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}pgbouncer=true&connection_limit=1`;
  }
  
  return url;
};

// Configuración del cliente Prisma
const prismaClientSingleton = () => {
  const databaseUrl = getDatabaseUrl();
  
  console.log('🔌 Inicializando cliente Prisma...');
  
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' 
      ? ['query', 'error', 'warn'] 
      : ['error'],
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
};

// Tipo para el cliente Prisma
type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

// Variable global para almacenar la instancia
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

// Crear o reutilizar la instancia (singleton)
const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

// Guardar en global para reutilizar en desarrollo
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Manejar cierre de conexión al terminar el proceso
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;

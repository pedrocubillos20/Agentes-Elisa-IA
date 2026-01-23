import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import dotenv from 'dotenv';

dotenv.config();

// ============================================
// VALIDACIÓN DE VARIABLES DE ENTORNO
// ============================================
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'EVOLUTION_API_URL',
  'EVOLUTION_API_KEY',
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Variables de entorno faltantes:');
  missingVars.forEach(v => console.error(`   - ${v}`));
  console.error('\n⚠️  El servidor puede no funcionar correctamente.');
}

import authRoutes from './routes/auth.routes';
import whatsappRoutes from './routes/whatsapp.routes';
import assistantsRoutes from './routes/assistants.routes';
import conversationsRoutes from './routes/conversations.routes';
import prisma from './lib/prisma';

const app = express();
const httpServer = createServer(app);

// Socket.io para actualizaciones en tiempo real
const io = new SocketServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST']
  }
});

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Health check
app.get('/', (req, res) => {
  res.json({
    name: 'Elisa IA API',
    version: '3.0.0',
    status: 'online',
    timestamp: new Date().toISOString(),
    features: [
      'Evolution API WhatsApp',
      'OpenAI Integration',
      'Multi-user Support',
      'Real-time Messaging'
    ]
  });
});

app.get('/health', async (req, res) => {
  let dbStatus = 'unknown';
  
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (error) {
    dbStatus = 'disconnected';
    console.error('❌ Database health check failed:', error);
  }

  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: dbStatus,
    evolution_api: process.env.EVOLUTION_API_URL ? 'configured' : 'not_configured'
  });
});

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/assistants', assistantsRoutes);
app.use('/api/conversations', conversationsRoutes);

// Socket.io events
io.on('connection', (socket) => {
  console.log(`🔌 Cliente conectado: ${socket.id}`);

  socket.on('join-user', (userId: string) => {
    socket.join(`user-${userId}`);
    console.log(`👤 Usuario ${userId} unido a su sala`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Cliente desconectado: ${socket.id}`);
  });
});

// Exportar io para usar en otras partes
export { io };

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🤖 ELISA IA - Backend v3.0.0                       ║
║                                                       ║
║   🚀 Servidor corriendo en puerto ${PORT}              ║
║   📱 Evolution API: ${process.env.EVOLUTION_API_URL || 'No configurada'}
║   🔗 Frontend: ${process.env.FRONTEND_URL || '*'}
║                                                       ║
╚═══════════════════════════════════════════════════════╝
  `);
});

export default app;

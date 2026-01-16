import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Importar rutas
import authRoutes from './routes/auth.routes';
import businessRoutes from './routes/business.routes';
import assistantRoutes from './routes/assistant.routes';
import conversationRoutes from './routes/conversation.routes';
import webhookRoutes from './routes/webhook.routes';
import wompiRoutes from './routes/wompi.routes';
import adminRoutes from './routes/admin.routes';

// Importar middleware
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ==========================================
// MIDDLEWARE GLOBAL
// ==========================================

// Seguridad
app.use(helmet());

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por IP
  message: { error: 'Demasiadas solicitudes, intenta de nuevo más tarde' }
});
app.use('/api/', limiter);

// Logging
app.use(morgan('combined', {
  stream: { write: (message) => logger.info(message.trim()) }
}));

// Body parsing (excepto para webhooks de Stripe que necesitan raw body)
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ==========================================
// RUTAS DE LA API
// ==========================================

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/payments', wompiRoutes);
app.use('/api/admin', adminRoutes);

// ==========================================
// MANEJO DE ERRORES
// ==========================================

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Error handler global
app.use(errorHandler);

// ==========================================
// INICIAR SERVIDOR
// ==========================================

app.listen(PORT, () => {
  logger.info(`🚀 Servidor corriendo en puerto ${PORT}`);
  logger.info(`📍 Ambiente: ${process.env.NODE_ENV}`);
});

export default app;

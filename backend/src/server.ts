import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

dotenv.config();

import authRoutes from './routes/auth.routes';
import assistantRoutes from './routes/assistant.routes';
import whatsappRoutes from './routes/whatsapp.routes';
import chatRoutes from './routes/chat.routes';
import businessRoutes from './routes/business.routes';
import webhookRoutes from './routes/webhook.routes';
import paymentRoutes from './routes/payment.routes';
import configRoutes from './routes/config.routes';

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/assistants', assistantRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/config', configRoutes);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Initialize
console.log('🔧 Inicializando cliente Prisma...');
import prisma from './lib/prisma';

// Initialize WhatsApp service
import './services/whatsappService';

app.listen(PORT, () => {
  console.log(`🚀 Servidor Elisa IA corriendo en puerto ${PORT}`);
});

export default app;

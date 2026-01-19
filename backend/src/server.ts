import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Servir archivos estáticos (para PDFs)
app.use('/uploads', express.static(path.join('/app', 'uploads')));

// CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root
app.get('/', (req, res) => {
  res.json({ 
    message: 'Elisa IA Backend API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      business: '/api/business',
      assistants: '/api/assistants',
      payments: '/api/payments',
      webhooks: '/api/webhooks',
      chat: '/api/chat',
      config: '/api/config'
    }
  });
});

// Routes
import authRoutes from './routes/auth.routes';
import businessRoutes from './routes/business.routes';
import assistantRoutes from './routes/assistant.routes';
import paymentRoutes from './routes/payment.routes';
import webhookRoutes from './routes/webhook.routes';
import chatRoutes from './routes/chat.routes';
import whatsappRoutes from './routes/whatsapp.routes';
import configRoutes from './routes/config.routes';

app.use('/api/auth', authRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/assistants', assistantRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/config', configRoutes);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor Elisa IA corriendo en puerto ${PORT}`);
});

export default app;

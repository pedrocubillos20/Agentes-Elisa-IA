import express from 'express';
import cors from 'cors';
import path from 'path';

import authRoutes from './routes/auth.routes';
import assistantsRoutes from './routes/assistants.routes';
import conversationsRoutes from './routes/conversations.routes';
import whatsappRoutes from './routes/whatsapp.routes';
import productsRoutes from './routes/products.routes';
import clientsRoutes from './routes/clients.routes';
import appointmentsRoutes from './routes/appointments.routes';
import { authMiddleware } from './middleware/auth.middleware';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://agentes-elisa-ia.vercel.app',
    process.env.FRONTEND_URL || ''
  ].filter(Boolean),
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir archivos estáticos
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rutas públicas
app.use('/api/auth', authRoutes);

// Webhook de WhatsApp (público)
app.post('/api/whatsapp/webhook', (req, res, next) => {
  whatsappRoutes(req, res, next);
});

// Rutas protegidas
app.use('/api/assistants', authMiddleware, assistantsRoutes);
app.use('/api/conversations', authMiddleware, conversationsRoutes);
app.use('/api/whatsapp', authMiddleware, whatsappRoutes);
app.use('/api/products', authMiddleware, productsRoutes);
app.use('/api/clients', authMiddleware, clientsRoutes);
app.use('/api/appointments', authMiddleware, appointmentsRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'ELISA IA Backend v5.0.0 - CRM & Agenda',
    version: '5.0.0',
    modules: ['auth', 'whatsapp', 'assistants', 'conversations', 'clients', 'products', 'appointments'],
    timestamp: new Date().toISOString()
  });
});

app.get('/api', (req, res) => {
  res.json({
    message: 'Elisa IA API v5.0',
    endpoints: {
      auth: '/api/auth',
      assistants: '/api/assistants',
      conversations: '/api/conversations',
      whatsapp: '/api/whatsapp',
      products: '/api/products',
      clients: '/api/clients',
      appointments: '/api/appointments'
    }
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🤖 Elisa IA Backend v5.0 running on port ${PORT}`);
});

export default app;

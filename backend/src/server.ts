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

// ==========================================
// RUTAS PÚBLICAS
// ==========================================
app.use('/api/auth', authRoutes);

// ==========================================
// WEBHOOKS PÚBLICOS (sin autenticación)
// ==========================================

// Webhook de WhatsApp - WAHA envía aquí los mensajes
app.post('/api/webhook/whatsapp', (req, res, next) => {
  console.log('🔔 Webhook WhatsApp recibido en /api/webhook/whatsapp');
  whatsappRoutes(req, res, next);
});

// Alias para compatibilidad
app.post('/api/whatsapp/webhook', (req, res, next) => {
  console.log('🔔 Webhook WhatsApp recibido en /api/whatsapp/webhook');
  whatsappRoutes(req, res, next);
});

// Webhook para Wompi (pagos)
app.post('/api/webhook/wompi', (req, res) => {
  console.log('💳 Webhook Wompi recibido:', JSON.stringify(req.body, null, 2));
  // TODO: Procesar pagos de Wompi
  res.json({ success: true });
});

// ==========================================
// RUTAS PROTEGIDAS
// ==========================================
app.use('/api/assistants', authMiddleware, assistantsRoutes);
app.use('/api/conversations', authMiddleware, conversationsRoutes);
app.use('/api/whatsapp', authMiddleware, whatsappRoutes);
app.use('/api/products', authMiddleware, productsRoutes);
app.use('/api/clients', authMiddleware, clientsRoutes);
app.use('/api/appointments', authMiddleware, appointmentsRoutes);

// ==========================================
// HEALTH CHECK Y INFO
// ==========================================
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'ELISA IA Backend v5.1.0 - WAHA Integration',
    version: '5.1.0',
    modules: ['auth', 'whatsapp', 'assistants', 'conversations', 'clients', 'products', 'appointments'],
    whatsapp: {
      provider: 'WAHA',
      apiUrl: process.env.WAHA_API_URL || 'http://31.97.142.127:8080'
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/api', (req, res) => {
  res.json({
    message: 'Elisa IA API v5.1 - WAHA',
    endpoints: {
      auth: '/api/auth',
      assistants: '/api/assistants',
      conversations: '/api/conversations',
      whatsapp: '/api/whatsapp',
      products: '/api/products',
      clients: '/api/clients',
      appointments: '/api/appointments',
      webhooks: {
        whatsapp: '/api/webhook/whatsapp',
        wompi: '/api/webhook/wompi'
      }
    }
  });
});

// ==========================================
// ERROR HANDLING
// ==========================================

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado', path: req.path });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   🤖 ELISA IA Backend v5.1.0');
  console.log('   📱 WhatsApp Provider: WAHA');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   🌐 Server: http://localhost:${PORT}`);
  console.log(`   📡 WAHA API: ${process.env.WAHA_API_URL || 'http://31.97.142.127:8080'}`);
  console.log(`   🔗 Webhook: /api/webhook/whatsapp`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
});

export default app;

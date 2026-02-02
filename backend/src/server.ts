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
import teamRoutes from './routes/team.routes';
import { authMiddleware } from './middleware/auth.middleware';

const app = express();
const PORT = process.env.PORT || 3000;

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
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ===== RUTAS PÚBLICAS =====
app.use('/api/auth', authRoutes);

// ===== WEBHOOKS PÚBLICOS (sin auth) =====
app.post('/api/webhook/whatsapp', (req, res, next) => {
  console.log('🔔 Webhook WhatsApp recibido en /api/webhook/whatsapp');
  req.url = '/webhook';
  whatsappRoutes(req, res, next);
});
app.post('/api/whatsapp/webhook', (req, res, next) => {
  console.log('🔔 Webhook WhatsApp recibido en /api/whatsapp/webhook');
  req.url = '/webhook';
  whatsappRoutes(req, res, next);
});

// ===== RUTAS PROTEGIDAS =====
app.use('/api/assistants', authMiddleware, assistantsRoutes);
app.use('/api/conversations', authMiddleware, conversationsRoutes);
app.use('/api/whatsapp', authMiddleware, whatsappRoutes);
app.use('/api/products', authMiddleware, productsRoutes);
app.use('/api/clients', authMiddleware, clientsRoutes);
app.use('/api/appointments', authMiddleware, appointmentsRoutes);
app.use('/api/team', authMiddleware, teamRoutes);

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'ELISA IA Backend v5.2.0 - Teams + Typing + Media',
    version: '5.2.0',
    modules: ['auth', 'whatsapp', 'assistants', 'conversations', 'clients', 'products', 'appointments', 'team'],
    features: ['typing-indicators', 'recording-simulation', 'media-triggers', 'pause-resume', 'sub-users', 'permissions', 'gpt-fallback'],
    timestamp: new Date().toISOString()
  });
});

app.get('/api', (req, res) => {
  res.json({
    message: 'Elisa IA API v5.2',
    endpoints: {
      auth: '/api/auth', assistants: '/api/assistants', conversations: '/api/conversations',
      whatsapp: '/api/whatsapp', products: '/api/products', clients: '/api/clients',
      appointments: '/api/appointments', team: '/api/team',
      webhooks: { whatsapp: '/api/webhook/whatsapp' }
    }
  });
});

app.use((req, res) => { res.status(404).json({ error: 'No encontrado', path: req.path }); });
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Error interno' });
});

app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   🤖 ELISA IA Backend v5.2.0');
  console.log('   📱 WhatsApp: Typing + Recording + Media Triggers');
  console.log('   👥 Módulo Equipos: ACTIVO');
  console.log('   ⏸️  Pausa IA: ".." pausa / "." reactiva');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   🌐 http://localhost:${PORT}`);
  console.log(`   📡 WAHA: ${process.env.WAHA_API_URL || 'http://31.97.142.127:8080'}`);
  console.log(`   🔗 Webhook: /api/webhook/whatsapp`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
});

export default app;

import express from 'express';
import cors from 'cors';
import path from 'path';
import prisma from './lib/prisma';

import authRoutes from './routes/auth.routes';
import assistantsRoutes from './routes/assistants.routes';
import conversationsRoutes from './routes/conversations.routes';
import whatsappRoutes from './routes/whatsapp.routes';
import productsRoutes from './routes/products.routes';
import clientsRoutes from './routes/clients.routes';
import appointmentsRoutes from './routes/appointments.routes';
import teamRoutes from './routes/team.routes';
import subscriptionRoutes from './routes/subscription.routes';
import stagesRoutes from './routes/stages.routes';
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
// Webhook Wompi (público)
app.post('/api/subscription/webhook/wompi', (req, res, next) => {
  console.log('💳 Webhook Wompi recibido');
  req.url = '/webhook/wompi';
  subscriptionRoutes(req, res, next);
});
// Planes públicos (sin auth)
app.get('/api/subscription/plans', (req, res, next) => {
  req.url = '/plans';
  subscriptionRoutes(req, res, next);
});
// TRM / Tasa de cambio pública
app.get('/api/subscription/exchange-rate', (req, res, next) => {
  req.url = '/exchange-rate';
  subscriptionRoutes(req, res, next);
});

// ===== RUTAS PROTEGIDAS =====
app.use('/api/assistants', authMiddleware, assistantsRoutes);
app.use('/api/conversations', authMiddleware, conversationsRoutes);
app.use('/api/whatsapp', authMiddleware, whatsappRoutes);
app.use('/api/products', authMiddleware, productsRoutes);
app.use('/api/clients', authMiddleware, clientsRoutes);
app.use('/api/appointments', authMiddleware, appointmentsRoutes);
app.use('/api/team', authMiddleware, teamRoutes);
app.use('/api/subscription', authMiddleware, subscriptionRoutes);
app.use('/api/stages', authMiddleware, stagesRoutes);

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

// ===== DIAGNÓSTICO DE DATOS (solo admin) =====
app.get('/api/admin/diagnostic', async (req, res) => {
  try {
    // Verificar secret key
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_SECRET_KEY && adminKey !== 'bizonne-admin-2024') {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    // Obtener todos los usuarios
    const users = await prisma.user.findMany({
      where: { parentUserId: null }, // Solo usuarios principales
      select: { id: true, email: true, name: true, plan: true }
    });

    const diagnostic: any[] = [];

    for (const user of users) {
      const lines = await prisma.whatsappLine.findMany({
        where: { userId: user.id },
        select: { id: true, label: true, phone: true, sessionName: true }
      });

      const conversations = await prisma.conversation.count({ where: { userId: user.id } });
      const assistants = await prisma.assistant.count({ where: { userId: user.id } });
      const clients = await prisma.client.count({ where: { userId: user.id } });
      const appointments = await prisma.appointment.count({ where: { userId: user.id } });
      const products = await prisma.product.count({ where: { userId: user.id } });

      diagnostic.push({
        user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
        lines: lines,
        counts: { conversations, assistants, clients, appointments, products }
      });
    }

    // Verificar datos huérfanos (sin userId válido)
    const orphanConversations = await prisma.conversation.count({
      where: { userId: { notIn: users.map(u => u.id) } }
    });

    const orphanLines = await prisma.whatsappLine.count({
      where: { userId: { notIn: users.map(u => u.id) } }
    });

    res.json({
      status: 'ok',
      totalUsers: users.length,
      diagnostic,
      orphans: {
        conversations: orphanConversations,
        lines: orphanLines
      }
    });
  } catch (error: any) {
    console.error('Error diagnóstico:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== LIMPIEZA DE DATOS (solo admin) =====
app.post('/api/admin/fix-orphans', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_SECRET_KEY && adminKey !== 'bizonne-admin-2024') {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    const users = await prisma.user.findMany({
      where: { parentUserId: null },
      select: { id: true }
    });
    const userIds = users.map(u => u.id);

    // Eliminar datos huérfanos
    const deletedConversations = await prisma.conversation.deleteMany({
      where: { userId: { notIn: userIds } }
    });

    const deletedLines = await prisma.whatsappLine.deleteMany({
      where: { userId: { notIn: userIds } }
    });

    const deletedAssistants = await prisma.assistant.deleteMany({
      where: { userId: { notIn: userIds } }
    });

    res.json({
      status: 'cleaned',
      deleted: {
        conversations: deletedConversations.count,
        lines: deletedLines.count,
        assistants: deletedAssistants.count
      }
    });
  } catch (error: any) {
    console.error('Error limpieza:', error);
    res.status(500).json({ error: error.message });
  }
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

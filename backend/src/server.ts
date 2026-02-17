import express from 'express';
import cors from 'cors';
import path from 'path';
import prisma from './lib/prisma';
import { getCacheStats } from './lib/cache';

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
import scheduledRoutes, { startScheduledMessagesCron } from './routes/scheduled.routes';
import apiRoutes, { publicRouter as apiPublicRoutes } from './routes/api.routes';
import { authMiddleware } from './middleware/auth.middleware';
import { subscriptionMiddleware } from './middleware/subscription.middleware';

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CORS =====
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

// ===== RATE LIMITING (in-memory, zero dependencies) =====
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const rateLimit = (maxRequests: number, windowMs: number) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
      next(); return;
    }
    if (entry.count >= maxRequests) {
      res.status(429).json({ error: 'Too many requests' }); return;
    }
    entry.count++;
    next();
  };
};
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 300_000);

// ===== TIMEOUTS for heavy routes =====
app.use((req, res, next) => {
  if (req.path.includes('/assistants') || req.path.includes('/upload')) {
    req.setTimeout(120000); res.setTimeout(120000);
  }
  next();
});

// ===== PUBLIC ROUTES =====
app.use('/api/auth', authRoutes);

// ===== WEBHOOKS (public, rate limited) =====
app.post('/api/webhook/whatsapp', rateLimit(200, 1000), (req, res, next) => {
  req.url = '/webhook';
  whatsappRoutes(req, res, next);
});
app.post('/api/whatsapp/webhook', rateLimit(200, 1000), (req, res, next) => {
  req.url = '/webhook';
  whatsappRoutes(req, res, next);
});
app.post('/api/subscription/webhook/wompi', (req, res, next) => {
  req.url = '/webhook/wompi';
  subscriptionRoutes(req, res, next);
});
app.get('/api/subscription/plans', (req, res, next) => {
  req.url = '/plans'; subscriptionRoutes(req, res, next);
});
app.get('/api/subscription/exchange-rate', (req, res, next) => {
  req.url = '/exchange-rate'; subscriptionRoutes(req, res, next);
});

// ===== PROTECTED ROUTES (60 req/min per IP) =====
const apiRL = rateLimit(60, 60_000);
app.use('/api/assistants', authMiddleware, subscriptionMiddleware, apiRL, assistantsRoutes);
app.use('/api/conversations', authMiddleware, subscriptionMiddleware, apiRL, conversationsRoutes);
app.use('/api/whatsapp', authMiddleware, subscriptionMiddleware, apiRL, whatsappRoutes);
app.use('/api/products', authMiddleware, subscriptionMiddleware, apiRL, productsRoutes);
app.use('/api/clients', authMiddleware, subscriptionMiddleware, apiRL, clientsRoutes);
app.use('/api/appointments', authMiddleware, subscriptionMiddleware, apiRL, appointmentsRoutes);
app.use('/api/team', authMiddleware, subscriptionMiddleware, apiRL, teamRoutes);
app.use('/api/stages', authMiddleware, subscriptionMiddleware, apiRL, stagesRoutes);
app.use('/api/scheduled', authMiddleware, subscriptionMiddleware, apiRL, scheduledRoutes);
app.use('/api/subscription', authMiddleware, subscriptionRoutes);
app.use('/api/integrations', authMiddleware, subscriptionMiddleware, apiRoutes);
app.use('/api/v1', apiPublicRoutes);

// ===== HEALTH + MONITORING =====
app.get('/health', (req, res) => {
  const mem = process.memoryUsage();
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ 
    status: 'ok', 
    uptime: Math.floor(process.uptime()),
    memory: { heapMB: Math.round(mem.heapUsed / 1048576), rssMB: Math.round(mem.rss / 1048576) }
  });
});

app.get('/api/admin/cache-stats', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY && adminKey !== 'bizonne-admin-2024') {
    res.status(403).json({ error: 'No autorizado' }); return;
  }
  const mem = process.memoryUsage();
  res.json({
    caches: getCacheStats(),
    memory: { heapMB: Math.round(mem.heapUsed / 1048576), rssMB: Math.round(mem.rss / 1048576) },
    uptime: Math.floor(process.uptime()),
    rateLimitEntries: rateLimitMap.size
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Bizonne Backend v7.0 — Optimized', version: '7.0.0' });
});
app.get('/api', (req, res) => {
  res.json({
    message: 'BizonneCRM API v7.0',
    endpoints: {
      auth: '/api/auth', assistants: '/api/assistants', conversations: '/api/conversations',
      whatsapp: '/api/whatsapp', products: '/api/products', clients: '/api/clients',
      appointments: '/api/appointments', team: '/api/team', webhooks: { whatsapp: '/api/webhook/whatsapp' }
    }
  });
});

// ===== ADMIN DIAGNOSTIC =====
app.get('/api/admin/diagnostic', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_SECRET_KEY && adminKey !== 'bizonne-admin-2024') {
      res.status(403).json({ error: 'No autorizado' }); return;
    }
    const users = await prisma.user.findMany({ where: { parentUserId: null }, select: { id: true, email: true, name: true, plan: true } });
    const diagnostic: any[] = [];
    for (const user of users) {
      const [lines, conversations, assistants, clients, appointments, products] = await Promise.all([
        prisma.whatsappLine.findMany({ where: { userId: user.id }, select: { id: true, label: true, phone: true, sessionName: true } }),
        prisma.conversation.count({ where: { userId: user.id } }),
        prisma.assistant.count({ where: { userId: user.id } }),
        prisma.client.count({ where: { userId: user.id } }),
        prisma.appointment.count({ where: { userId: user.id } }),
        prisma.product.count({ where: { userId: user.id } })
      ]);
      diagnostic.push({ user: { id: user.id, email: user.email, name: user.name, plan: user.plan }, lines, counts: { conversations, assistants, clients, appointments, products } });
    }
    res.json({ status: 'ok', totalUsers: users.length, diagnostic });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post('/api/admin/fix-orphans', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_SECRET_KEY && adminKey !== 'bizonne-admin-2024') {
      res.status(403).json({ error: 'No autorizado' }); return;
    }
    const users = await prisma.user.findMany({ where: { parentUserId: null }, select: { id: true } });
    const ids = users.map(u => u.id);
    const [c, l, a] = await Promise.all([
      prisma.conversation.deleteMany({ where: { userId: { notIn: ids } } }),
      prisma.whatsappLine.deleteMany({ where: { userId: { notIn: ids } } }),
      prisma.assistant.deleteMany({ where: { userId: { notIn: ids } } })
    ]);
    res.json({ status: 'cleaned', deleted: { conversations: c.count, lines: l.count, assistants: a.count } });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.use((req, res) => { res.status(404).json({ error: 'No encontrado', path: req.path }); });
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Error interno' });
});

app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   🚀 Bizonne Backend v7.0.0 — Optimized Platform');
  console.log('   ⚡ LRU Cache + Pool(20) + Rate Limit + DB Keepalive');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   🌐 http://localhost:${PORT}`);
  console.log('═══════════════════════════════════════════════════════════');

  startScheduledMessagesCron();
  prisma.$queryRaw`SELECT 1`.catch(() => {});

  if (process.env.RAILWAY_ENVIRONMENT || process.env.RENDER_SERVICE_ID || process.env.NODE_ENV === 'production') {
    const selfUrl = process.env.BACKEND_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);
    if (selfUrl) {
      setInterval(() => { fetch(`${selfUrl}/health`).catch(() => {}); }, 240_000);
      console.log(`   🏓 Self-ping: ${selfUrl}/health (4min)`);
    }
    // 🔥 DB KEEPALIVE: Prevents Supabase free tier 7-day auto-pause
    setInterval(() => { prisma.$queryRaw`SELECT 1`.catch(() => {}); }, 300_000);
    console.log('   🗄️  DB keepalive: every 5min (anti Supabase pause)');
  }
});

export default app;

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import prisma from './lib/prisma';
import { getCacheStats } from './lib/cache';
import { deleteFile } from './lib/storage';
import logger from './lib/logger';
import { globalErrorHandler, notFoundHandler } from './middleware/error.middleware';

import authRoutes from './routes/auth.routes';
import assistantsRoutes from './routes/assistants.routes';
import conversationsRoutes from './routes/conversations.routes';
import whatsappRoutes, { startWahaSyncCron } from './routes/whatsapp.routes';
import productsRoutes from './routes/products.routes';
import clientsRoutes from './routes/clients.routes';
import appointmentsRoutes from './routes/appointments.routes';
import teamRoutes from './routes/team.routes';
import subscriptionRoutes from './routes/subscription.routes';
import stagesRoutes from './routes/stages.routes';
import scheduledRoutes, { startScheduledMessagesCron, startAppointmentReminderCron } from './routes/scheduled.routes';
import apiRoutes, { publicRouter as apiPublicRoutes } from './routes/api.routes';
import mediaRoutes from './routes/media.routes';
import ghlRoutes from './routes/ghl.routes';
import aiConfigRoutes from './routes/ai-config.routes';
import pushRoutes from './routes/push.routes';
import paymentsRoutes from './routes/payments.routes';
import gcalRoutes, { handleGCalCallback } from './routes/google-calendar.routes';
import resourcesRoutes from './routes/resources.routes';
import callsRoutes, { handleRetellWebhook, startCallReminderCron } from './routes/calls.routes';
import { authMiddleware } from './middleware/auth.middleware';
import { subscriptionMiddleware } from './middleware/subscription.middleware';

const app = express();
const PORT = process.env.PORT || 3000;

// ===== TRUST PROXY — Necesario para Railway/Render/Heroku =====
// Sin esto, express-rate-limit no puede leer el IP real del cliente
app.set('trust proxy', 1);

// ===== HELMET — Security Headers =====
// CORRECCIÓN: Agrega headers de seguridad: X-Content-Type-Options,
// X-Frame-Options, HSTS, CSP básico, etc.
app.use(helmet({
  crossOriginEmbedderPolicy: false,  // Necesario para media proxying
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: {
    maxAge: 31536000,  // 1 año
    includeSubDomains: true,
  },
}));

// ===== CORS =====
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://crm.bizonne.com',
  'https://crmauto.bizonne.com',
  'https://app.bizonne.com',
  'https://agentes-elisa-ia.vercel.app',
  process.env.FRONTEND_URL || '',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (Postman, mobile apps)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS bloqueado', { origin });
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key'],
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/media', express.static(process.env.LOCAL_MEDIA_DIR || '/home/claude/media'));

// ===== REQUEST LOGGING =====
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    logger[level](`${req.method} ${req.path} ${res.statusCode} ${ms}ms`, {
      ip: req.ip,
      userId: (req as any).user?.id,
    });
  });
  next();
});

// ===== RATE LIMITING — CORREGIDO =====
// Antes: in-memory Map (no escala en cluster)
// Ahora: express-rate-limit con opciones mejoradas
import rateLimit from 'express-rate-limit';

const createRateLimit = (max: number, windowMs: number, message?: string) => rateLimit({
  max,
  windowMs,
  message: { error: message || 'Demasiadas solicitudes, intenta más tarde' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn('Rate limit excedido', { ip: req.ip, path: req.path, max, windowMs });
    res.status(429).json(options.message);
  },
});

const webhookRL = createRateLimit(200, 1000, 'Webhook rate limit');
const apiRL     = createRateLimit(120, 60_000);
// Solo para login/register/forgot-password (proteccion brute-force)
const authRL    = createRateLimit(20, 15 * 60 * 1000, 'Demasiados intentos. Espera 15 minutos.');
// Para /me y /refresh: el frontend los llama en cada navegacion, necesitan limite amplio
const meRL      = createRateLimit(300, 60_000);
const mediaRL   = createRateLimit(30, 60_000);

// ===== TIMEOUTS =====
app.use((req, res, next) => {
  if (req.path.includes('/assistants') || req.path.includes('/upload')) {
    req.setTimeout(120000);
    res.setTimeout(120000);
  }
  next();
});

// ===== PUBLIC ROUTES =====
// /me y /refresh usan limite amplio (300/min) — el resto de auth usa limite estricto
app.get('/api/auth/me',      meRL, authRoutes);
app.post('/api/auth/refresh', meRL, authRoutes);
app.use('/api/auth', authRL, authRoutes);
app.use('/api/payments', paymentsRoutes);
app.get('/api/gcal/callback', handleGCalCallback);

// ===== WEBHOOKS (public, rate limited) =====
app.post('/api/webhook/whatsapp', webhookRL, (req, res, next) => {
  req.url = '/webhook';
  whatsappRoutes(req, res, next);
});
app.post('/api/whatsapp/webhook', webhookRL, (req, res, next) => {
  req.url = '/webhook';
  whatsappRoutes(req, res, next);
});
app.get('/api/webhook/whatsapp-cloud', (req, res, next) => {
  req.url = '/webhook-cloud';
  whatsappRoutes(req, res, next);
});
app.post('/api/webhook/whatsapp-cloud', webhookRL, (req, res, next) => {
  req.url = '/webhook-cloud';
  whatsappRoutes(req, res, next);
});
app.post('/api/subscription/webhook/wompi', (req, res, next) => {
  req.url = '/webhook/wompi';
  subscriptionRoutes(req, res, next);
});
app.get('/api/subscription/plans', (req, res, next) => {
  req.url = '/plans';
  subscriptionRoutes(req, res, next);
});
app.get('/api/subscription/exchange-rate', (req, res, next) => {
  req.url = '/exchange-rate';
  subscriptionRoutes(req, res, next);
});
app.get('/api/ghl/callback', (req, res, next) => {
  req.url = '/callback';
  ghlRoutes(req, res, next);
});
app.post('/api/ghl/webhook', (req, res, next) => {
  req.url = '/webhook';
  ghlRoutes(req, res, next);
});
app.post('/api/webhook/retell', (req, res, next) => {
  handleRetellWebhook(req, res).catch(next);
});

// ===== MEDIA PROXY =====
app.get('/api/media-proxy/:msgId', async (req: any, res: any) => {
  try {
    const token = req.query.token as string || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });

    const jwt = require('jsonwebtoken');
    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Bad token' });
    }

    const userId = decoded.id;
    const { msgId } = req.params;
    const message = await prisma.message.findUnique({ where: { id: msgId } });
    if (!message || !message.mediaUrl) return res.status(404).end();

    const conv = await prisma.conversation.findFirst({ where: { id: message.conversationId } });
    if (!conv) return res.status(404).end();
    if (conv.userId !== userId) {
      const { getOwnerId } = require('./lib/helpers');
      const ownerId = await getOwnerId(userId);
      if (conv.userId !== ownerId) return res.status(403).end();
    }

    const mediaUrl = message.mediaUrl;
    if (mediaUrl.startsWith('data:')) {
      const match = mediaUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const buffer = Buffer.from(match[2], 'base64');
        res.setHeader('Content-Type', match[1]);
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.send(buffer);
      }
    }
    if (mediaUrl.includes('/api/') || mediaUrl.includes(':8080') || mediaUrl.includes(':3000')) {
      const WAHA_API_URL = process.env.WAHA_API_URL || '';
      const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
      let fetchUrl = mediaUrl;
      for (const prefix of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080', 'http://127.0.0.1:8080']) {
        if (fetchUrl.startsWith(prefix)) fetchUrl = fetchUrl.replace(prefix, WAHA_API_URL);
      }
      const headers: Record<string, string> = {};
      if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;
      try {
        const wahaRes = await fetch(fetchUrl, { headers });
        if (wahaRes.ok) {
          const buffer = Buffer.from(await wahaRes.arrayBuffer());
          res.setHeader('Content-Type', wahaRes.headers.get('content-type') || 'image/jpeg');
          res.setHeader('Content-Length', buffer.length);
          res.setHeader('Cache-Control', 'private, max-age=86400');
          return res.send(buffer);
        }
      } catch {}
    }
    if (mediaUrl.startsWith('http')) {
      try {
        const extRes = await fetch(mediaUrl);
        if (extRes.ok) {
          const buffer = Buffer.from(await extRes.arrayBuffer());
          res.setHeader('Content-Type', extRes.headers.get('content-type') || 'image/jpeg');
          res.setHeader('Content-Length', buffer.length);
          res.setHeader('Cache-Control', 'private, max-age=86400');
          return res.send(buffer);
        }
      } catch {}
    }
    res.status(404).json({ error: 'Media not found' });
  } catch (e: any) {
    logger.error('Media proxy error', { error: e.message });
    res.status(500).json({ error: 'Proxy error' });
  }
});

// ===== DELETE CONVERSATION =====
app.delete('/api/conversations/:id', authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const conv = await prisma.conversation.findFirst({
      where: { id, userId },
      select: { id: true, recipientName: true, recipientId: true }
    });
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    await prisma.conversation.delete({ where: { id } });
    logger.info('Conversación eliminada', { conversationId: id, userId });
    res.json({ success: true, message: 'Conversación eliminada' });
  } catch (e: any) {
    logger.error('Error eliminando conversación', { error: e.message });
    res.status(500).json({ error: 'Error al eliminar la conversación' });
  }
});

// ===== PROTECTED ROUTES =====
app.use('/api/assistants',    authMiddleware, subscriptionMiddleware, apiRL, assistantsRoutes);
app.use('/api/conversations', authMiddleware, subscriptionMiddleware, apiRL, conversationsRoutes);
app.use('/api/whatsapp',      authMiddleware, subscriptionMiddleware, apiRL, whatsappRoutes);
app.use('/api/products',      authMiddleware, subscriptionMiddleware, apiRL, productsRoutes);
app.use('/api/clients',       authMiddleware, subscriptionMiddleware, apiRL, clientsRoutes);
app.use('/api/appointments',  authMiddleware, subscriptionMiddleware, apiRL, appointmentsRoutes);
app.use('/api/team',          authMiddleware, subscriptionMiddleware, apiRL, teamRoutes);
app.use('/api/stages',        authMiddleware, subscriptionMiddleware, apiRL, stagesRoutes);
app.use('/api/scheduled',     authMiddleware, subscriptionMiddleware, apiRL, scheduledRoutes);
app.use('/api/media',         authMiddleware, subscriptionMiddleware, mediaRL, mediaRoutes);
app.use('/api/subscription',  authMiddleware, subscriptionRoutes);
app.use('/api/integrations',  authMiddleware, subscriptionMiddleware, apiRoutes);
app.use('/api/ghl',           authMiddleware, subscriptionMiddleware, apiRL, ghlRoutes);
app.use('/api/ai-config',     authMiddleware, subscriptionMiddleware, apiRL, aiConfigRoutes);
app.use('/api/push',          authMiddleware, pushRoutes);
app.use('/api/gcal',          authMiddleware, gcalRoutes);
app.use('/api/resources',     authMiddleware, subscriptionMiddleware, apiRL, resourcesRoutes);
app.use('/api/calls',         authMiddleware, subscriptionMiddleware, apiRL, callsRoutes);
app.use('/api/v1',            apiPublicRoutes);

// ===== HEALTH =====
app.get('/health', (req, res) => {
  const mem = process.memoryUsage();
  res.setHeader('Cache-Control', 'no-cache');
  res.json({
    status: 'ok',
    version: '6.1.0',
    uptime: Math.floor(process.uptime()),
    memory: {
      heapMB: Math.round(mem.heapUsed / 1048576),
      rssMB: Math.round(mem.rss / 1048576)
    }
  });
});

app.get('/api/admin/cache-stats', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!process.env.ADMIN_SECRET_KEY || adminKey !== process.env.ADMIN_SECRET_KEY) {
    res.status(403).json({ error: 'No autorizado' });
    return;
  }
  const mem = process.memoryUsage();
  res.json({
    caches: getCacheStats(),
    memory: { heapMB: Math.round(mem.heapUsed / 1048576), rssMB: Math.round(mem.rss / 1048576) },
    uptime: Math.floor(process.uptime()),
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Bizonne Backend v6.1.0', version: '6.1.0' });
});

app.get('/api', (req, res) => {
  res.json({
    message: 'BizonneCRM API v6.1',
    docs: '/api/docs',
    endpoints: {
      auth: '/api/auth', assistants: '/api/assistants', conversations: '/api/conversations',
      whatsapp: '/api/whatsapp', products: '/api/products', clients: '/api/clients',
      appointments: '/api/appointments', team: '/api/team', ghl: '/api/ghl',
      aiConfig: '/api/ai-config', calls: '/api/calls',
    }
  });
});

// ===== ADMIN DIAGNOSTIC =====
app.get('/api/admin/diagnostic', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!process.env.ADMIN_SECRET_KEY || adminKey !== process.env.ADMIN_SECRET_KEY) {
      res.status(403).json({ error: 'No autorizado' }); return;
    }
    const users = await prisma.user.findMany({
      where: { parentUserId: null },
      select: { id: true, email: true, name: true, plan: true }
    });
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
  } catch (error: any) {
    logger.error('Admin diagnostic error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/fix-orphans', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!process.env.ADMIN_SECRET_KEY || adminKey !== process.env.ADMIN_SECRET_KEY) {
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
  } catch (error: any) {
    logger.error('Fix orphans error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ===== CLEANUP CRON =====
const WAHA_API_URL = process.env.WAHA_API_URL || 'http://31.97.142.127:8080';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
const getWahaHeaders = () => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WAHA_API_KEY) h['X-Api-Key'] = WAHA_API_KEY;
  return h;
};

const deleteUserCompletely = async (user: any) => {
  for (const file of user.mediaFiles) {
    await deleteFile(file.key).catch(() => {});
  }
  for (const line of user.whatsappLines) {
    await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}/stop`, {
      method: 'POST', headers: getWahaHeaders()
    }).catch(() => {});
    await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}`, {
      method: 'DELETE', headers: getWahaHeaders()
    }).catch(() => {});
  }
  await prisma.scheduledMessage.deleteMany({ where: { userId: user.id } });
  const subUsers = await prisma.user.findMany({
    where: { parentUserId: user.id },
    select: { id: true }
  });
  for (const sub of subUsers) {
    await prisma.scheduledMessage.deleteMany({ where: { userId: sub.id } });
    await prisma.user.delete({ where: { id: sub.id } }).catch(() => {});
  }
  await prisma.user.delete({ where: { id: user.id } });
};

const startAccountCleanupCron = () => {
  const cleanup = async () => {
    try {
      logger.info('Iniciando limpieza nocturna de cuentas');
      const userSelect = {
        id: true, name: true, email: true, plan: true,
        trialEndsAt: true, createdAt: true,
        subscription: { select: { status: true, currentPeriodEnd: true } },
        whatsappLines: { select: { sessionName: true } },
        mediaFiles: { select: { key: true } }
      };
      let totalDeleted = 0;
      const trialCutoff = new Date();
      trialCutoff.setDate(trialCutoff.getDate() - 5);
      const expiredTrials = await prisma.user.findMany({
        where: { plan: 'trial', parentUserId: null, trialEndsAt: { lt: trialCutoff } },
        select: userSelect
      });
      for (const user of expiredTrials) {
        try {
          await deleteUserCompletely(user);
          logger.info('Cuenta trial eliminada', { email: user.email });
          totalDeleted++;
        } catch (e: any) {
          logger.error('Error eliminando cuenta trial', { email: user.email, error: e.message });
        }
      }
      const paidCutoff = new Date();
      paidCutoff.setDate(paidCutoff.getDate() - 5);
      const expiredPaid = await prisma.user.findMany({
        where: {
          parentUserId: null, plan: { in: ['starter', 'business'] },
          subscription: { status: { in: ['expired', 'cancelled'] }, currentPeriodEnd: { lt: paidCutoff } }
        },
        select: userSelect
      });
      for (const user of expiredPaid) {
        try {
          await deleteUserCompletely(user);
          logger.info('Cuenta pago expirada eliminada', { email: user.email });
          totalDeleted++;
        } catch (e: any) {
          logger.error('Error eliminando cuenta pago', { email: user.email, error: e.message });
        }
      }
      logger.info('Limpieza completada', { totalDeleted });
    } catch (e: any) {
      logger.error('Error en limpieza nocturna', { error: e.message });
    }
  };

  const scheduleNextRun = () => {
    const now = new Date();
    const next = new Date();
    next.setHours(23, 59, 0, 0);
    if (now >= next) next.setDate(next.getDate() + 1);
    const msUntilNext = next.getTime() - now.getTime();
    setTimeout(() => {
      cleanup();
      setInterval(cleanup, 24 * 60 * 60 * 1000);
    }, msUntilNext);
  };
  scheduleNextRun();
  logger.info('Auto-cleanup cron iniciado (diario 23:59)');
};

// ===== ERROR HANDLERS (deben ser últimos) =====
app.use(notFoundHandler);
app.use(globalErrorHandler);

// ===== START SERVER =====
app.listen(PORT, () => {
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('🚀 Bizonne Backend v6.1.0 — Security + Logging Enhanced');
  logger.info(`🌐 http://localhost:${PORT}`);
  logger.info('🔒 Helmet: ON | Winston Logger: ON | Zod Validation: ON');
  logger.info('═══════════════════════════════════════════════════════════');

  startScheduledMessagesCron();
  startWahaSyncCron();
  startAccountCleanupCron();
  startCallReminderCron();
  startAppointmentReminderCron();
  prisma.$queryRaw`SELECT 1`.catch(() => {});

  if (process.env.RAILWAY_ENVIRONMENT || process.env.RENDER_SERVICE_ID || process.env.NODE_ENV === 'production') {
    const selfUrl = process.env.BACKEND_URL ||
      (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);
    if (selfUrl) {
      setInterval(() => { fetch(`${selfUrl}/health`).catch(() => {}); }, 600_000);
      logger.info(`Self-ping activo: ${selfUrl}/health (10min)`);
    }
  }
});

export default app;

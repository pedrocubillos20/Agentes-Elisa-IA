import express from 'express';
import cors from 'cors';
import path from 'path';
import prisma from './lib/prisma';
import { getCacheStats } from './lib/cache';
import { deleteFile } from './lib/storage';

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
import scheduledRoutes, { startScheduledMessagesCron } from './routes/scheduled.routes';
import apiRoutes, { publicRouter as apiPublicRoutes } from './routes/api.routes';
import mediaRoutes from './routes/media.routes';
import ghlRoutes from './routes/ghl.routes';
import aiConfigRoutes from './routes/ai-config.routes';
import pushRoutes from './routes/push.routes';
import paymentsRoutes from './routes/payments.routes';
import gcalRoutes, { handleGCalCallback } from './routes/google-calendar.routes';
import resourcesRoutes from './routes/resources.routes';
import callsRoutes, { handleRetellWebhook, startCallReminderCron } from './routes/calls.routes'; // 📞 RETELL AI
import { authMiddleware } from './middleware/auth.middleware';
import { subscriptionMiddleware } from './middleware/subscription.middleware';

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CORS =====
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://crm.bizonne.com',
    'https://crmauto.bizonne.com',
    'https://agentes-elisa-ia.vercel.app',
    process.env.FRONTEND_URL || ''
  ].filter(Boolean),
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/media', express.static(process.env.LOCAL_MEDIA_DIR || '/home/claude/media'));

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
app.use('/api/payments', paymentsRoutes); // Público — Wompi checkout + webhooks
app.get('/api/gcal/callback', handleGCalCallback); // Google Calendar OAuth callback (public)

// ===== WEBHOOKS (public, rate limited) =====
app.post('/api/webhook/whatsapp', rateLimit(200, 1000), (req, res, next) => {
  req.url = '/webhook';
  whatsappRoutes(req, res, next);
});
app.post('/api/whatsapp/webhook', rateLimit(200, 1000), (req, res, next) => {
  req.url = '/webhook';
  whatsappRoutes(req, res, next);
});

// ☁️ WhatsApp Cloud API webhooks (Meta)
app.get('/api/webhook/whatsapp-cloud', (req, res, next) => {
  req.url = '/webhook-cloud';
  whatsappRoutes(req, res, next);
});
app.post('/api/webhook/whatsapp-cloud', rateLimit(200, 1000), (req, res, next) => {
  req.url = '/webhook-cloud';
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

// ===== GHL PUBLIC ROUTES (OAuth callback + Webhook) =====
app.get('/api/ghl/callback', (req, res, next) => {
  req.url = '/callback';
  ghlRoutes(req, res, next);
});
app.post('/api/ghl/webhook', (req, res, next) => {
  req.url = '/webhook';
  ghlRoutes(req, res, next);
});

// 📞 RETELL AI WEBHOOK (público - recibe eventos de llamadas)
app.post('/api/webhook/retell', (req, res, next) => {
  handleRetellWebhook(req, res).catch(next);
});

// ===== DELETE CONVERSATION =====
app.delete('/api/conversations/:id', authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { id } = req.params;
    
    // Verify conversation belongs to user
    const conv = await prisma.conversation.findFirst({
      where: { id, userId },
      select: { id: true, recipientName: true, recipientId: true }
    });
    
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    
    // Delete conversation (messages cascade automatically)
    await prisma.conversation.delete({ where: { id } });
    
    console.log(`🗑️ Conversación eliminada: ${conv.recipientName || conv.recipientId} (user: ${userId})`);
    res.json({ success: true, message: 'Conversación eliminada' });
  } catch (e: any) {
    console.error('Error eliminando conversación:', e.message);
    res.status(500).json({ error: 'Error al eliminar la conversación' });
  }
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
app.use('/api/media', authMiddleware, subscriptionMiddleware, rateLimit(30, 60_000), mediaRoutes);
app.use('/api/subscription', authMiddleware, subscriptionRoutes);
app.use('/api/integrations', authMiddleware, subscriptionMiddleware, apiRoutes);
app.use('/api/ghl', authMiddleware, subscriptionMiddleware, apiRL, ghlRoutes);
app.use('/api/ai-config', authMiddleware, subscriptionMiddleware, apiRL, aiConfigRoutes);
app.use('/api/push', authMiddleware, pushRoutes);
app.use('/api/gcal', authMiddleware, gcalRoutes);
app.use('/api/resources', authMiddleware, subscriptionMiddleware, apiRL, resourcesRoutes);
app.use('/api/calls', authMiddleware, subscriptionMiddleware, apiRL, callsRoutes); // 📞 RETELL AI
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
  if (!process.env.ADMIN_SECRET_KEY || adminKey !== process.env.ADMIN_SECRET_KEY) {
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
  res.json({ status: 'ok', message: 'Bizonne Backend v7.1 — Retell AI Calls', version: '7.1.0' });
});
app.get('/api', (req, res) => {
  res.json({
    message: 'BizonneCRM API v7.1',
    endpoints: {
      auth: '/api/auth', assistants: '/api/assistants', conversations: '/api/conversations',
      whatsapp: '/api/whatsapp', products: '/api/products', clients: '/api/clients',
      appointments: '/api/appointments', team: '/api/team', ghl: '/api/ghl', aiConfig: '/api/ai-config',
      calls: '/api/calls',
      webhooks: { whatsapp: '/api/webhook/whatsapp', ghl: '/api/ghl/webhook', retell: '/api/webhook/retell' }
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
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.use((req, res) => { res.status(404).json({ error: 'No encontrado', path: req.path }); });
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Error interno' });
});

// ====================================================
// 🧹 AUTO-CLEANUP: Delete inactive accounts
// - Trial expirado + 5 días sin pagar → eliminar
// - Plan pago expirado + 5 días sin renovar → eliminar
// Runs daily at 11:59 PM (server timezone)
// ====================================================
const WAHA_API_URL = process.env.WAHA_API_URL || 'http://31.97.142.127:8080';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
const getWahaHeaders = () => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WAHA_API_KEY) h['X-Api-Key'] = WAHA_API_KEY;
  return h;
};

const deleteUserCompletely = async (user: any) => {
  // 1. Delete R2 files
  for (const file of user.mediaFiles) {
    await deleteFile(file.key).catch(() => {});
  }
  if (user.mediaFiles.length > 0) {
    console.log(`   🗑️ ${user.mediaFiles.length} archivos R2 eliminados`);
  }

  // 2. Stop WAHA sessions
  for (const line of user.whatsappLines) {
    await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}/stop`, {
      method: 'POST', headers: getWahaHeaders()
    }).catch(() => {});
    await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}`, {
      method: 'DELETE', headers: getWahaHeaders()
    }).catch(() => {});
  }

  // 3. Delete ScheduledMessages (no cascade relation)
  await prisma.scheduledMessage.deleteMany({ where: { userId: user.id } });

  // 4. Delete sub-users first
  const subUsers = await prisma.user.findMany({
    where: { parentUserId: user.id },
    select: { id: true }
  });
  for (const sub of subUsers) {
    await prisma.scheduledMessage.deleteMany({ where: { userId: sub.id } });
    await prisma.user.delete({ where: { id: sub.id } }).catch(() => {});
  }

  // 5. Delete main user (cascade: assistants, conversations, messages, 
  //    products, clients, appointments, subscription, payments, lines, media)
  await prisma.user.delete({ where: { id: user.id } });
};

const startAccountCleanupCron = () => {
  const cleanup = async () => {
    try {
      const now = new Date();
      console.log(`🧹 [${now.toISOString()}] Iniciando limpieza nocturna...`);

      const userSelect = {
        id: true, name: true, email: true, plan: true,
        trialEndsAt: true, createdAt: true,
        subscription: { select: { status: true, currentPeriodEnd: true } },
        whatsappLines: { select: { sessionName: true } },
        mediaFiles: { select: { key: true } }
      };

      let totalDeleted = 0;

      // ═══════════════════════════════════════════
      // 1️⃣ TRIAL EXPIRADO + 5 DÍAS SIN PAGAR
      // ═══════════════════════════════════════════
      const trialCutoff = new Date();
      trialCutoff.setDate(trialCutoff.getDate() - 5);

      const expiredTrials = await prisma.user.findMany({
        where: {
          plan: 'trial',
          parentUserId: null,
          trialEndsAt: { lt: trialCutoff }
        },
        select: userSelect
      });

      if (expiredTrials.length > 0) {
        console.log(`🧹 Trial expirados (>5d): ${expiredTrials.length} cuentas`);
      }

      for (const user of expiredTrials) {
        try {
          const expDate = user.trialEndsAt?.toISOString().split('T')[0] || 'N/A';
          console.log(`🧹 [TRIAL] Eliminando: ${user.name || user.email} (venció: ${expDate})`);
          await deleteUserCompletely(user);
          console.log(`   ✅ ${user.email} eliminado`);
          totalDeleted++;
        } catch (e: any) {
          console.error(`   ❌ Error: ${user.email}: ${e.message}`);
        }
      }

      // ═══════════════════════════════════════════
      // 2️⃣ PLAN PAGO EXPIRADO + 5 DÍAS SIN RENOVAR
      // ═══════════════════════════════════════════
      const paidCutoff = new Date();
      paidCutoff.setDate(paidCutoff.getDate() - 5);

      const expiredPaid = await prisma.user.findMany({
        where: {
          parentUserId: null,
          plan: { in: ['starter', 'business'] },
          subscription: {
            status: { in: ['expired', 'cancelled'] },
            currentPeriodEnd: { lt: paidCutoff }
          }
        },
        select: userSelect
      });

      if (expiredPaid.length > 0) {
        console.log(`🧹 Planes pagos expirados (>5d): ${expiredPaid.length} cuentas`);
      }

      for (const user of expiredPaid) {
        try {
          const expDate = user.subscription?.currentPeriodEnd?.toISOString().split('T')[0] || 'N/A';
          console.log(`🧹 [${user.plan?.toUpperCase()}] Eliminando: ${user.name || user.email} (venció: ${expDate})`);
          await deleteUserCompletely(user);
          console.log(`   ✅ ${user.email} eliminado`);
          totalDeleted++;
        } catch (e: any) {
          console.error(`   ❌ Error: ${user.email}: ${e.message}`);
        }
      }

      if (totalDeleted > 0) {
        console.log(`🧹 Limpieza completada: ${totalDeleted} cuentas eliminadas`);
      } else {
        console.log(`🧹 Limpieza completada: sin cuentas para eliminar`);
      }
    } catch (e: any) {
      console.error('🧹 Error en limpieza:', e.message);
    }
  };

  // Schedule daily at 11:59 PM
  const scheduleNextRun = () => {
    const now = new Date();
    const next = new Date();
    next.setHours(23, 59, 0, 0); // 11:59 PM today
    
    // If already past 11:59 PM, schedule for tomorrow
    if (now >= next) {
      next.setDate(next.getDate() + 1);
    }
    
    const msUntilNext = next.getTime() - now.getTime();
    const hoursUntil = (msUntilNext / (1000 * 60 * 60)).toFixed(1);
    
    console.log(`   🧹 Próxima limpieza: ${next.toISOString().split('T')[0]} 23:59 (en ${hoursUntil}h)`);
    
    setTimeout(() => {
      cleanup();
      // After running, schedule every 24 hours
      setInterval(cleanup, 24 * 60 * 60 * 1000);
    }, msUntilNext);
  };

  scheduleNextRun();
  console.log('   🧹 Auto-cleanup: diario 11:59 PM (trial >5d, pagos >5d)');
};

app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   🚀 Bizonne Backend v7.1 — Retell AI Calls');
  console.log('   ⚡ LRU Cache + Pool(5) + Rate Limit');
  console.log('   📞 Retell AI Voice Calls Enabled');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   🌐 http://localhost:${PORT}`);
  console.log('═══════════════════════════════════════════════════════════');

  startScheduledMessagesCron();
  startWahaSyncCron();
  startAccountCleanupCron();
  startCallReminderCron(); // 📞 RETELL AI - Auto-recordatorios
  prisma.$queryRaw`SELECT 1`.catch(() => {});

  if (process.env.RAILWAY_ENVIRONMENT || process.env.RENDER_SERVICE_ID || process.env.NODE_ENV === 'production') {
    const selfUrl = process.env.BACKEND_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);
    if (selfUrl) {
      setInterval(() => { fetch(`${selfUrl}/health`).catch(() => {}); }, 600_000); // 10min
      console.log(`   🏓 Self-ping: ${selfUrl}/health (10min)`);
    }
    // 🧹 Weekly VACUUM: Sundays at 4 AM — prevents dead tuple bloat
    const scheduleWeeklyVacuum = () => {
      const now = new Date();
      const nextSunday = new Date();
      nextSunday.setDate(now.getDate() + (7 - now.getDay()) % 7);
      nextSunday.setHours(4, 0, 0, 0);
      if (nextSunday <= now) nextSunday.setDate(nextSunday.getDate() + 7);
      const msUntil = nextSunday.getTime() - now.getTime();
      setTimeout(async () => {
        try {
          await prisma.$executeRawUnsafe('VACUUM "Assistant"');
          await prisma.$executeRawUnsafe('VACUUM "Message"');
          await prisma.$executeRawUnsafe('VACUUM "Conversation"');
          console.log('🧹 Weekly VACUUM completed');
        } catch (e: any) { console.error('⚠️ VACUUM error:', e.message); }
        setInterval(async () => {
          try {
            await prisma.$executeRawUnsafe('VACUUM "Assistant"');
            await prisma.$executeRawUnsafe('VACUUM "Message"');
            await prisma.$executeRawUnsafe('VACUUM "Conversation"');
            console.log('🧹 Weekly VACUUM completed');
          } catch (e: any) { console.error('⚠️ VACUUM error:', e.message); }
        }, 7 * 24 * 60 * 60 * 1000);
      }, msUntil);
      console.log(`   🧹 Weekly VACUUM: Sundays 4 AM (next in ${(msUntil / 3600000).toFixed(1)}h)`);
    };
    scheduleWeeklyVacuum();
  }
});

export default app;

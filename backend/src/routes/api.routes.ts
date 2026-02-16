import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

// ====================================================
// Dos routers:
// - managementRouter → JWT auth (keys, webhooks CRUD)
// - publicRouter → API Key auth (v1 endpoints)
// ====================================================
const managementRouter = Router();
const publicRouter = Router();

// ====================================================
// 🔑 HELPERS
// ====================================================
const generateApiKey = (): { key: string; prefix: string } => {
  const raw = crypto.randomBytes(32).toString('hex');
  return { key: `bz_${raw}`, prefix: `bz_${raw.substring(0, 8)}` };
};

const hashApiKey = (key: string): string => crypto.createHash('sha256').update(key).digest('hex');
const generateWebhookSecret = (): string => `whsec_${crypto.randomBytes(24).toString('hex')}`;
const signPayload = (payload: string, secret: string): string => crypto.createHmac('sha256', secret).update(payload).digest('hex');

const ownerIdCache = new Map<string, { value: string; ts: number }>();
const getOwnerId = async (userId: string): Promise<string> => {
  const cached = ownerIdCache.get(userId);
  if (cached && Date.now() - cached.ts < 300000) return cached.value;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  const ownerId = u?.parentUserId || userId;
  ownerIdCache.set(userId, { value: ownerId, ts: Date.now() });
  return ownerId;
};

// ====================================================
// 🔑 API KEY MANAGEMENT (JWT auth)
// ====================================================
managementRouter.get('/keys', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const keys = await prisma.userApiKey.findMany({
      where: { userId: ownerId },
      select: { id: true, name: true, prefix: true, isActive: true, lastUsedAt: true, totalCalls: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ keys });
  } catch (error) { res.status(500).json({ error: 'Error al listar API keys' }); }
});

managementRouter.post('/keys', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { name = 'Mi API Key' } = req.body;

    const count = await prisma.userApiKey.count({ where: { userId: ownerId } });
    if (count >= 5) { res.status(400).json({ error: 'Máximo 5 API keys por cuenta' }); return; }

    const { key, prefix } = generateApiKey();
    const hashedKey = hashApiKey(key);
    const apiKey = await prisma.userApiKey.create({ data: { userId: ownerId, name, key: hashedKey, prefix } });
    res.json({ id: apiKey.id, name: apiKey.name, key, prefix: apiKey.prefix, message: 'Guarda esta key, no se mostrará de nuevo' });
  } catch (error) { res.status(500).json({ error: 'Error al crear API key' }); }
});

managementRouter.delete('/keys/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    await prisma.userApiKey.deleteMany({ where: { id: req.params.id, userId: await getOwnerId(userId) } });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

managementRouter.patch('/keys/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const { isActive, name } = req.body;
    const data: any = {};
    if (typeof isActive === 'boolean') data.isActive = isActive;
    if (name) data.name = name;
    await prisma.userApiKey.updateMany({ where: { id: req.params.id, userId: await getOwnerId(userId) }, data });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// ====================================================
// 🔗 WEBHOOK MANAGEMENT (JWT auth)
// ====================================================
managementRouter.get('/webhooks', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const webhooks = await prisma.userWebhook.findMany({ where: { userId: await getOwnerId(userId) }, orderBy: { createdAt: 'desc' } });
    res.json({ webhooks });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

managementRouter.post('/webhooks', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { name, url, events = [] } = req.body;
    if (!name || !url) { res.status(400).json({ error: 'Nombre y URL requeridos' }); return; }
    const count = await prisma.userWebhook.count({ where: { userId: ownerId } });
    if (count >= 10) { res.status(400).json({ error: 'Máximo 10 webhooks' }); return; }
    const secret = generateWebhookSecret();
    const webhook = await prisma.userWebhook.create({ data: { userId: ownerId, name, url, secret, events } });
    res.json({ webhook: { ...webhook, secret } });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

managementRouter.put('/webhooks/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { name, url, events, isActive } = req.body;
    const data: any = {};
    if (name) data.name = name; if (url) data.url = url; if (events) data.events = events;
    if (typeof isActive === 'boolean') data.isActive = isActive;
    await prisma.userWebhook.updateMany({ where: { id: req.params.id, userId: ownerId }, data });
    const updated = await prisma.userWebhook.findFirst({ where: { id: req.params.id, userId: ownerId } });
    res.json({ webhook: updated });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

managementRouter.delete('/webhooks/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    await prisma.userWebhook.deleteMany({ where: { id: req.params.id, userId: await getOwnerId(userId) } });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

managementRouter.post('/webhooks/:id/test', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const webhook = await prisma.userWebhook.findFirst({ where: { id: req.params.id, userId: ownerId } });
    if (!webhook) { res.status(404).json({ error: 'No encontrado' }); return; }

    const testPayload = { event: 'test.ping', timestamp: new Date().toISOString(), data: { message: 'Webhook test from Bizonne' } };
    const payloadStr = JSON.stringify(testPayload);
    const signature = webhook.secret ? signPayload(payloadStr, webhook.secret) : '';
    const start = Date.now();

    try {
      const response = await fetch(webhook.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bizonne-Signature': signature, 'X-Bizonne-Event': 'test.ping' },
        body: payloadStr, signal: AbortSignal.timeout(10000)
      });
      const duration = Date.now() - start;
      const responseText = await response.text().catch(() => '');
      await prisma.userWebhook.update({ where: { id: webhook.id }, data: { lastStatus: response.status, lastError: response.ok ? null : responseText.substring(0, 500), totalSent: { increment: 1 } } });
      await prisma.webhookLog.create({ data: { webhookId: webhook.id, userId: ownerId, event: 'test.ping', payload: testPayload as any, statusCode: response.status, response: responseText.substring(0, 1000), duration, success: response.ok } });
      res.json({ success: response.ok, statusCode: response.status, duration, response: responseText.substring(0, 200) });
    } catch (fetchErr: any) {
      const duration = Date.now() - start;
      await prisma.userWebhook.update({ where: { id: webhook.id }, data: { lastStatus: 0, lastError: fetchErr.message, totalFailed: { increment: 1 } } });
      await prisma.webhookLog.create({ data: { webhookId: webhook.id, userId: ownerId, event: 'test.ping', payload: testPayload as any, statusCode: 0, response: fetchErr.message, duration, success: false } });
      res.json({ success: false, error: fetchErr.message, duration });
    }
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

managementRouter.get('/webhooks/:id/logs', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const webhook = await prisma.userWebhook.findFirst({ where: { id: req.params.id, userId: await getOwnerId(userId) } });
    if (!webhook) { res.status(404).json({ error: 'No encontrado' }); return; }
    const logs = await prisma.webhookLog.findMany({ where: { webhookId: webhook.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    res.json({ logs });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// ====================================================
// 🌐 API KEY AUTH MIDDLEWARE
// ====================================================
const apiKeyAuth = async (req: Request, res: Response, next: Function) => {
  try {
    const authHeader = (req.headers['x-api-key'] as string) || (req.headers.authorization || '').replace('Bearer ', '');
    if (!authHeader) { res.status(401).json({ error: 'API key requerida. Header: X-Api-Key' }); return; }
    const hashedKey = hashApiKey(authHeader);
    const record = await prisma.userApiKey.findFirst({ where: { key: hashedKey, isActive: true } });
    if (!record) { res.status(401).json({ error: 'API key inválida o desactivada' }); return; }
    await prisma.userApiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date(), totalCalls: { increment: 1 } } });
    (req as any).apiUserId = record.userId;
    next();
  } catch (error) { res.status(500).json({ error: 'Error de autenticación' }); }
};

// ====================================================
// 🌐 PUBLIC v1 ENDPOINTS (API Key auth)
// ====================================================
publicRouter.get('/conversations', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).apiUserId;
    const { stage, limit = '50', offset = '0', lineId } = req.query;
    const where: any = { userId }; if (stage && stage !== 'all') where.stage = stage; if (lineId) where.whatsappLineId = lineId;
    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({ where, orderBy: { updatedAt: 'desc' }, take: Math.min(Number(limit) || 50, 100), skip: Number(offset) || 0, include: { messages: { orderBy: { timestamp: 'desc' }, take: 1 } } }),
      prisma.conversation.count({ where })
    ]);
    res.json({ data: conversations.map(c => ({ id: c.id, phone: c.recipientId, name: c.recipientName, stage: c.stage, aiPaused: c.aiPaused, lastMessage: c.messages[0]?.content || c.lastMessage, contextData: c.contextData, lineId: c.whatsappLineId, createdAt: c.createdAt, updatedAt: c.updatedAt })), total, limit: Math.min(Number(limit) || 50, 100), offset: Number(offset) || 0 });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

publicRouter.get('/conversations/:id/messages', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).apiUserId;
    const conv = await prisma.conversation.findFirst({ where: { id: req.params.id, userId } });
    if (!conv) { res.status(404).json({ error: 'No encontrada' }); return; }
    const { limit = '50', offset = '0' } = req.query;
    const [messages, total] = await Promise.all([
      prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: { timestamp: 'desc' }, take: Math.min(Number(limit) || 50, 200), skip: Number(offset) || 0 }),
      prisma.message.count({ where: { conversationId: conv.id } })
    ]);
    res.json({ conversationId: conv.id, phone: conv.recipientId, name: conv.recipientName, data: messages.map(m => ({ id: m.id, content: m.content, fromMe: m.fromMe, role: m.role, timestamp: m.timestamp, mediaType: m.mediaType, mediaUrl: m.mediaUrl })), total });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

publicRouter.get('/crm/pipeline', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).apiUserId;
    const { stage, lineId } = req.query; const where: any = { userId }; if (stage) where.stage = stage; if (lineId) where.whatsappLineId = lineId;
    const [stats, conversations] = await Promise.all([
      prisma.conversation.groupBy({ by: ['stage'], where: { userId }, _count: { id: true } }),
      prisma.conversation.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, recipientId: true, recipientName: true, stage: true, contextData: true, updatedAt: true, whatsappLineId: true } })
    ]);
    res.json({ stages: stats.map(s => ({ stage: s.stage || 'new', count: s._count.id })), data: conversations });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

publicRouter.get('/clients', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).apiUserId;
    const { limit = '50', offset = '0', status } = req.query; const where: any = { userId }; if (status) where.status = status;
    const [clients, total] = await Promise.all([prisma.client.findMany({ where, orderBy: { updatedAt: 'desc' }, take: Math.min(Number(limit) || 50, 100), skip: Number(offset) || 0 }), prisma.client.count({ where })]);
    res.json({ data: clients, total });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

publicRouter.get('/appointments', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).apiUserId;
    const { status, from, to } = req.query; const where: any = { userId }; if (status) where.status = status;
    if (from || to) { where.date = {}; if (from) where.date.gte = new Date(from as string); if (to) where.date.lte = new Date(to as string); }
    const appointments = await prisma.appointment.findMany({ where, orderBy: { date: 'asc' }, take: 100 });
    res.json({ data: appointments });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

publicRouter.get('/products', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({ where: { userId: (req as any).apiUserId, isActive: true }, orderBy: { createdAt: 'desc' } });
    res.json({ data: products });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

publicRouter.get('/stats', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).apiUserId;
    const [totalConversations, totalMessages, totalClients, totalAppointments, stageStats] = await Promise.all([
      prisma.conversation.count({ where: { userId } }), prisma.message.count({ where: { conversation: { userId } } }),
      prisma.client.count({ where: { userId } }), prisma.appointment.count({ where: { userId } }),
      prisma.conversation.groupBy({ by: ['stage'], where: { userId }, _count: { id: true } })
    ]);
    res.json({ totalConversations, totalMessages, totalClients, totalAppointments, pipeline: stageStats.map(s => ({ stage: s.stage, count: s._count.id })) });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

publicRouter.post('/send-message', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).apiUserId;
    const { phone, message, lineId } = req.body;
    if (!phone || !message) { res.status(400).json({ error: 'phone y message requeridos' }); return; }
    const whereL: any = { userId }; if (lineId) { whereL.id = lineId; } else { whereL.isPrimary = true; }
    const line = await prisma.whatsappLine.findFirst({ where: whereL });
    if (!line || line.status !== 'connected') { res.status(400).json({ error: 'No hay línea conectada' }); return; }
    const WAHA_URL = process.env.WAHA_API_URL || 'http://31.97.142.127:8080';
    const WAHA_KEY = process.env.WAHA_API_KEY || '';
    const h: any = { 'Content-Type': 'application/json' }; if (WAHA_KEY) h['X-Api-Key'] = WAHA_KEY;
    const chatId = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@c.us`;
    const r = await fetch(`${WAHA_URL}/api/sendText`, { method: 'POST', headers: h, body: JSON.stringify({ session: line.sessionName, chatId, text: message }) });
    if (!r.ok) { res.status(502).json({ error: 'Error al enviar' }); return; }
    const conv = await prisma.conversation.findFirst({ where: { userId, recipientId: chatId.replace('@c.us', '') } });
    if (conv) { await prisma.message.create({ data: { conversationId: conv.id, content: message, fromMe: true, role: 'assistant', userId } }); await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: message } }); }
    res.json({ success: true, phone: chatId.replace('@c.us', '') });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

publicRouter.post('/conversations/:id/stage', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).apiUserId; const { stage } = req.body;
    if (!stage) { res.status(400).json({ error: 'stage requerido' }); return; }
    const conv = await prisma.conversation.findFirst({ where: { id: req.params.id, userId } });
    if (!conv) { res.status(404).json({ error: 'No encontrada' }); return; }
    await prisma.conversation.update({ where: { id: conv.id }, data: { stage } });
    res.json({ success: true, conversationId: conv.id, stage });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

publicRouter.post('/conversations/:id/pause-ai', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).apiUserId; const { paused } = req.body;
    const conv = await prisma.conversation.findFirst({ where: { id: req.params.id, userId } });
    if (!conv) { res.status(404).json({ error: 'No encontrada' }); return; }
    await prisma.conversation.update({ where: { id: conv.id }, data: { aiPaused: !!paused } });
    res.json({ success: true, aiPaused: !!paused });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// ====================================================
// 🔔 WEBHOOK DISPATCHER (uso interno)
// ====================================================
export const dispatchWebhook = async (userId: string, event: string, data: any) => {
  try {
    const webhooks = await prisma.userWebhook.findMany({ where: { userId, isActive: true, events: { has: event } } });
    for (const webhook of webhooks) {
      const payload = { event, timestamp: new Date().toISOString(), data };
      const payloadStr = JSON.stringify(payload);
      const signature = webhook.secret ? signPayload(payloadStr, webhook.secret) : '';
      const start = Date.now();
      try {
        const response = await fetch(webhook.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bizonne-Signature': signature, 'X-Bizonne-Event': event, 'X-Bizonne-Webhook-Id': webhook.id }, body: payloadStr, signal: AbortSignal.timeout(15000) });
        const duration = Date.now() - start; const responseText = await response.text().catch(() => '');
        await prisma.userWebhook.update({ where: { id: webhook.id }, data: { lastStatus: response.status, lastError: response.ok ? null : responseText.substring(0, 500), totalSent: { increment: 1 }, ...(response.ok ? {} : { totalFailed: { increment: 1 } }) } });
        await prisma.webhookLog.create({ data: { webhookId: webhook.id, userId, event, payload: payload as any, statusCode: response.status, response: responseText.substring(0, 1000), duration, success: response.ok } });
      } catch (err: any) {
        const duration = Date.now() - start;
        await prisma.userWebhook.update({ where: { id: webhook.id }, data: { lastStatus: 0, lastError: err.message, totalFailed: { increment: 1 } } });
        await prisma.webhookLog.create({ data: { webhookId: webhook.id, userId, event, payload: payload as any, statusCode: 0, response: err.message, duration, success: false } });
      }
    }
  } catch (err) { console.error('Webhook dispatch error:', err); }
};

export { managementRouter, publicRouter };
export default managementRouter;

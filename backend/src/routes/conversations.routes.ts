import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// Helper para obtener el owner real (con cache para evitar queries repetidas)
const ownerIdCache = new Map<string, { value: string; ts: number }>();
const getOwnerId = async (userId: string): Promise<string> => {
  const cached = ownerIdCache.get(userId);
  if (cached && Date.now() - cached.ts < 300000) return cached.value;
  const user = await prisma.user.findUnique({ 
    where: { id: userId }, 
    select: { parentUserId: true } 
  });
  const ownerId = user?.parentUserId || userId;
  ownerIdCache.set(userId, { value: ownerId, ts: Date.now() });
  return ownerId;
};

// GET /api/conversations
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    
    const { stage, lineId } = req.query;
    const where: any = { userId: ownerId };
    if (stage && stage !== 'all') where.stage = stage as string;
    if (lineId) where.whatsappLineId = lineId as string;

    const conversations = await prisma.conversation.findMany({
      where, orderBy: { updatedAt: 'desc' },
      select: {
        id: true, recipientId: true, recipientName: true, stage: true,
        aiPaused: true, updatedAt: true, lastMessage: true, contextData: true,
        whatsappLineId: true, isGroup: true, assignedTo: true,
        messages: { orderBy: { timestamp: 'desc' }, take: 1, select: { content: true, timestamp: true, fromMe: true } }
      }
    });

    res.json({
      conversations: conversations.map(c => ({
        ...c, lastMessage: c.messages[0]?.content || c.lastMessage || null, messages: undefined
      }))
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener conversaciones' });
  }
});

// GET /api/conversations/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { lineId } = req.query;
    const where: any = { userId };
    if (lineId) where.whatsappLineId = lineId as string;

    const [stats, total] = await Promise.all([
      prisma.conversation.groupBy({ by: ['stage'], where, _count: { id: true } }),
      prisma.conversation.count({ where })
    ]);
    res.json({ stats: stats.map(s => ({ stage: s.stage || 'new', count: s._count.id })), total });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// GET /api/conversations/dashboard - ENTERPRISE DASHBOARD
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { lineId, period } = req.query;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // Period start for charts
    let periodStart = weekStart;
    if (period === 'month') periodStart = monthStart;
    else if (period === 'quarter') { periodStart = new Date(now.getFullYear(), now.getMonth() - 2, 1); }
    else if (period === 'year') { periodStart = new Date(now.getFullYear(), 0, 1); }

    const convWhere: any = { userId: ownerId };
    const apptWhere: any = { userId: ownerId };
    const clientWhere: any = { userId: ownerId };
    if (lineId) {
      convWhere.whatsappLineId = lineId as string;
      apptWhere.whatsappLineId = lineId as string;
      clientWhere.whatsappLineId = lineId as string;
    }

    const [
      totalConversations, totalMessages, todayMessages, yesterdayMessages,
      weekMessages, monthMessages, lastMonthMessages,
      totalAppointments, pendingAppointments,
      totalClients, activeClients,
      stageStats,
      recentMessages, recentAppointments,
      weeklyRaw, monthlyRaw,
      todayConversations, weekConversations, monthConversations,
      aiPausedCount, convertedThisMonth, convertedLastMonth,
      lines
    ] = await Promise.all([
      prisma.conversation.count({ where: convWhere }),
      prisma.message.count({ where: { conversation: convWhere } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: todayStart } } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: weekStart } } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: monthStart } } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: lastMonthStart, lt: monthStart } } }),
      prisma.appointment.count({ where: apptWhere }),
      prisma.appointment.count({ where: { ...apptWhere, status: 'pending' } }),
      prisma.client.count({ where: clientWhere }),
      prisma.client.count({ where: { ...clientWhere, status: 'active' } }),
      prisma.conversation.groupBy({ by: ['stage'], where: convWhere, _count: { id: true } }),
      prisma.message.findMany({
        where: { conversation: convWhere, fromMe: false },
        orderBy: { timestamp: 'desc' }, take: 8,
        include: { conversation: { select: { recipientName: true, recipientId: true, stage: true, whatsappLineId: true } } }
      }),
      prisma.appointment.findMany({ where: apptWhere, orderBy: { createdAt: 'desc' }, take: 5 }),
      // Weekly activity
      lineId
        ? prisma.$queryRaw`
            SELECT EXTRACT(DOW FROM m."timestamp") as dow, COUNT(*)::int as count
            FROM "Message" m JOIN "Conversation" c ON m."conversationId" = c.id
            WHERE c."userId" = ${ownerId} AND c."whatsappLineId" = ${lineId as string} AND m."timestamp" >= ${weekStart}
            GROUP BY EXTRACT(DOW FROM m."timestamp") ORDER BY dow
          ` as Promise<Array<{ dow: number; count: number }>>
        : prisma.$queryRaw`
            SELECT EXTRACT(DOW FROM m."timestamp") as dow, COUNT(*)::int as count
            FROM "Message" m JOIN "Conversation" c ON m."conversationId" = c.id
            WHERE c."userId" = ${ownerId} AND m."timestamp" >= ${weekStart}
            GROUP BY EXTRACT(DOW FROM m."timestamp") ORDER BY dow
          ` as Promise<Array<{ dow: number; count: number }>>,
      // Monthly activity (last 30 days by day)
      lineId
        ? prisma.$queryRaw`
            SELECT m."timestamp"::date as day, COUNT(*)::int as count
            FROM "Message" m JOIN "Conversation" c ON m."conversationId" = c.id
            WHERE c."userId" = ${ownerId} AND c."whatsappLineId" = ${lineId as string} AND m."timestamp" >= ${monthStart}
            GROUP BY m."timestamp"::date ORDER BY day
          ` as Promise<Array<{ day: Date; count: number }>>
        : prisma.$queryRaw`
            SELECT m."timestamp"::date as day, COUNT(*)::int as count
            FROM "Message" m JOIN "Conversation" c ON m."conversationId" = c.id
            WHERE c."userId" = ${ownerId} AND m."timestamp" >= ${monthStart}
            GROUP BY m."timestamp"::date ORDER BY day
          ` as Promise<Array<{ day: Date; count: number }>>,
      // Today's new conversations
      prisma.conversation.count({ where: { ...convWhere, createdAt: { gte: todayStart } } }),
      prisma.conversation.count({ where: { ...convWhere, createdAt: { gte: weekStart } } }),
      prisma.conversation.count({ where: { ...convWhere, createdAt: { gte: monthStart } } }),
      // AI paused (human takeover)
      prisma.conversation.count({ where: { ...convWhere, aiPaused: true } }),
      // Converted this month vs last
      prisma.conversation.count({ where: { ...convWhere, stage: 'converted', updatedAt: { gte: monthStart } } }),
      prisma.conversation.count({ where: { ...convWhere, stage: 'converted', updatedAt: { gte: lastMonthStart, lt: monthStart } } }),
      // Lines info
      prisma.whatsappLine.findMany({
        where: { userId: ownerId },
        select: { id: true, label: true, phone: true, status: true, sessionName: true }
      })
    ]);

    // Process weekly activity
    const weeklyActivity = [0, 0, 0, 0, 0, 0, 0];
    if (Array.isArray(weeklyRaw)) {
      weeklyRaw.forEach((r: any) => { const i = Number(r.dow); if (i >= 0 && i <= 6) weeklyActivity[i] = Number(r.count) || 0; });
    }

    // Process monthly activity (fill all days)
    const monthlyActivity: Array<{ day: string; count: number }> = [];
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthMap: Record<string, number> = {};
    if (Array.isArray(monthlyRaw)) {
      monthlyRaw.forEach((r: any) => {
        const d = new Date(r.day);
        const key = `${d.getDate()}`;
        monthMap[key] = Number(r.count) || 0;
      });
    }
    for (let i = 1; i <= Math.min(now.getDate(), daysInMonth); i++) {
      monthlyActivity.push({ day: `${i}`, count: monthMap[`${i}`] || 0 });
    }

    const convertedCount = stageStats.find(s => s.stage === 'converted')?._count?.id || 0;
    const conversionRate = totalConversations > 0 ? ((convertedCount / totalConversations) * 100).toFixed(1) : '0';

    // Message growth comparison
    const msgGrowth = yesterdayMessages > 0 ? (((todayMessages - yesterdayMessages) / yesterdayMessages) * 100).toFixed(0) : todayMessages > 0 ? '+100' : '0';
    const monthGrowth = lastMonthMessages > 0 ? (((monthMessages - lastMonthMessages) / lastMonthMessages) * 100).toFixed(0) : '0';

    // Top leads (most messages, with stage info)
    const topLeads = await prisma.conversation.findMany({
      where: { ...convWhere, stage: { not: 'converted' } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true, recipientName: true, recipientId: true, stage: true, 
        updatedAt: true, contextData: true, whatsappLineId: true,
        _count: { select: { messages: true } }
      }
    });

    // Recent activity
    const recentActivity = [
      ...recentMessages.map(m => ({
        type: 'message' as const,
        user: m.conversation.recipientName || m.conversation.recipientId || 'Desconocido',
        action: m.content.substring(0, 80) + (m.content.length > 80 ? '...' : ''),
        time: m.timestamp.toISOString(),
        stage: m.conversation.stage,
        lineId: m.conversation.whatsappLineId,
        timestamp: m.timestamp.getTime()
      })),
      ...recentAppointments.map(a => ({
        type: (a.type === 'order' ? 'sale' : 'appointment') as 'sale' | 'appointment',
        user: a.clientName, stage: null, lineId: null,
        action: a.type === 'order' ? `Pedido${a.total ? ` - $${Number(a.total).toLocaleString()}` : ''}` : `Cita ${a.status}`,
        time: a.createdAt.toISOString(),
        timestamp: a.createdAt.getTime()
      }))
    ].sort((a, b) => b.timestamp - a.timestamp).slice(0, 8);

    const funnelData = stageStats.map(s => ({ stage: s.stage || 'new', count: s._count.id }));

    // Average messages per conversation
    const avgMsgsPerConv = totalConversations > 0 ? (totalMessages / totalConversations).toFixed(1) : '0';

    res.json({
      // Core metrics
      totalConversations, totalMessages, todayMessages, yesterdayMessages,
      weekMessages, monthMessages, lastMonthMessages,
      totalAppointments, pendingAppointments,
      totalClients, activeClients,
      convertedCount, conversionRate,
      // Growth
      msgGrowth, monthGrowth,
      // Time-based
      todayConversations, weekConversations, monthConversations,
      convertedThisMonth, convertedLastMonth,
      // Engagement
      aiPausedCount, avgMsgsPerConv,
      // Charts
      weeklyActivity, monthlyActivity,
      // Lists
      recentActivity, funnelData, stageStats: funnelData,
      topLeads: topLeads.map(l => ({
        id: l.id, name: l.recipientName || l.recipientId, stage: l.stage,
        messages: l._count.messages, lastActive: l.updatedAt,
        lineId: l.whatsappLineId,
        context: l.contextData
      })),
      // Lines
      lines
    });
  } catch (error) {
    console.error('Error dashboard:', error);
    res.status(500).json({ error: 'Error al obtener datos del dashboard' });
  }
});

// ====================================================
// 👥 GET /api/conversations/groups — Listar grupos
// ====================================================
router.get('/groups', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const lineId = req.query.lineId as string;

    const where: any = { userId: ownerId, isGroup: true };
    if (lineId) where.whatsappLineId = lineId;

    const groups = await prisma.conversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        recipientId: true,
        recipientName: true,
        groupName: true,
        groupSettings: true,
        isGroup: true,
        aiPaused: true,
        lastMessage: true,
        whatsappLineId: true,
        updatedAt: true,
        _count: { select: { messages: true } }
      }
    });

    res.json({ groups });
  } catch (e: any) {
    console.error('Error listando grupos:', e.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/conversations/:id/messages
router.get('/:id/messages', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    
    // Usar ownerId para soportar team members
    const ownerId = await getOwnerId(userId!);

    const conversation = await prisma.conversation.findFirst({ where: { id, userId: ownerId } });
    if (!conversation) { res.status(404).json({ error: 'No encontrada' }); return; }

    // Obtener los ÚLTIMOS N mensajes (no los primeros)
    // Primero obtenemos en orden descendente, luego revertimos para mostrar asc
    const messages = await prisma.message.findMany({
      where: { conversationId: id }, 
      orderBy: { timestamp: 'desc' }, 
      take: limit
    });
    // Revertir para que estén en orden cronológico (asc)
    messages.reverse();
    
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// PUT /api/conversations/:id/stage
router.put('/:id/stage', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { id } = req.params;
    const { stage } = req.body;
    const ownerId = await getOwnerId(userId!);
    const existing = await prisma.conversation.findFirst({ where: { id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'No encontrada' }); return; }
    const conversation = await prisma.conversation.update({ where: { id }, data: { stage } });
    res.json({ conversation, message: 'Etapa actualizada' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// PUT /api/conversations/:id/ai-pause
router.put('/:id/ai-pause', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { id } = req.params;
    const { paused } = req.body;
    const ownerId = await getOwnerId(userId!);
    const existing = await prisma.conversation.findFirst({ where: { id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'No encontrada' }); return; }
    const conversation = await prisma.conversation.update({ where: { id }, data: { aiPaused: paused } });
    res.json({ conversation, message: paused ? 'IA pausada' : 'IA reactivada' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// ====================================================
// ⚙️ PUT /api/conversations/:id/group-settings — Configurar IA del grupo
// ====================================================
router.put('/:id/group-settings', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;

    const conv = await prisma.conversation.findFirst({ where: { id, userId: ownerId, isGroup: true } });
    if (!conv) { res.status(404).json({ error: 'Grupo no encontrado' }); return; }

    const { aiEnabled, respondTo, triggerWords } = req.body;
    const currentSettings = (conv.groupSettings as any) || { aiEnabled: true, respondTo: 'all', triggerWords: [] };

    const newSettings = {
      aiEnabled: aiEnabled !== undefined ? aiEnabled : currentSettings.aiEnabled,
      respondTo: respondTo || currentSettings.respondTo,
      triggerWords: triggerWords !== undefined ? triggerWords : currentSettings.triggerWords
    };

    const updated = await prisma.conversation.update({
      where: { id },
      data: { groupSettings: newSettings }
    });

    console.log(`👥 Grupo "${conv.groupName}" config actualizada:`, newSettings);
    res.json({ success: true, conversation: updated, groupSettings: newSettings });
  } catch (e: any) {
    console.error('Error actualizando grupo:', e.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;

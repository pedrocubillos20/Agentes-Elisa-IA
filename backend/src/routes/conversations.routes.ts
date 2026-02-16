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

// GET /api/conversations/dashboard - ENTERPRISE DASHBOARD v2
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { lineId, period, dateFrom, dateTo } = req.query;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // === CUSTOM DATE RANGE ===
    let rangeStart = weekStart;
    let rangeEnd = now;
    let rangeLabel = '7d';
    
    if (dateFrom && dateTo) {
      rangeStart = new Date(dateFrom as string);
      rangeEnd = new Date(dateTo as string);
      rangeEnd.setHours(23, 59, 59, 999);
      rangeLabel = 'custom';
    } else if (period === '24h') {
      rangeStart = new Date(now.getTime() - 86400000);
      rangeLabel = '24h';
    } else if (period === '7d' || period === 'week') {
      rangeStart = weekStart; rangeLabel = '7d';
    } else if (period === '30d' || period === 'month') {
      rangeStart = monthStart; rangeLabel = '30d';
    } else if (period === '90d') {
      rangeStart = new Date(now.getTime() - 90 * 86400000); rangeLabel = '90d';
    } else if (period === 'quarter') {
      const q = Math.floor(now.getMonth() / 3);
      rangeStart = new Date(now.getFullYear(), q * 3, 1); rangeLabel = 'quarter';
    } else if (period === 'year') {
      rangeStart = new Date(now.getFullYear(), 0, 1); rangeLabel = 'year';
    }

    // Prev range for comparison
    const rangeDuration = rangeEnd.getTime() - rangeStart.getTime();
    const prevRangeStart = new Date(rangeStart.getTime() - rangeDuration);
    const prevRangeEnd = new Date(rangeStart);

    const convWhere: any = { userId: ownerId };
    const apptWhere: any = { userId: ownerId };
    if (lineId) {
      convWhere.whatsappLineId = lineId as string;
      apptWhere.whatsappLineId = lineId as string;
    }

    const [
      totalConversations, totalMessages,
      rangeMessages, prevRangeMessages,
      todayMessages, yesterdayMessages,
      weekMessages, monthMessages,
      rangeNewConvs, prevRangeNewConvs,
      rangeConvertedConvs,
      stageStats,
      totalAppointments, pendingAppointments,
      totalClients, activeClients,
      aiPausedCount,
      convertedTotal,
      // Conversations at risk (no messages in 48h, not converted)
      atRiskConvs,
      // Lines
      lines,
      // Recent activity
      recentMessages,
      // Top leads
      topLeadsRaw,
      // Chart: daily msgs in range
      dailyMsgsRaw,
      // Chart: daily new convs in range
      dailyConvsRaw,
      // Messages fromMe vs incoming in range
      rangeMsgsFromMe,
      rangeMsgsIncoming,
      // Longest wait (oldest unresponded)
      oldestUnresponded
    ] = await Promise.all([
      prisma.conversation.count({ where: convWhere }),
      prisma.message.count({ where: { conversation: convWhere } }),
      // Range messages
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: prevRangeStart, lt: prevRangeEnd } } }),
      // Today/yesterday
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: todayStart } } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: yesterdayStart, lt: todayStart } } }),
      // Week/month
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: weekStart } } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: monthStart } } }),
      // New conversations in range
      prisma.conversation.count({ where: { ...convWhere, createdAt: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.conversation.count({ where: { ...convWhere, createdAt: { gte: prevRangeStart, lt: prevRangeEnd } } }),
      // Converted in range
      prisma.conversation.count({ where: { ...convWhere, stage: 'converted', updatedAt: { gte: rangeStart, lte: rangeEnd } } }),
      // Stage distribution
      prisma.conversation.groupBy({ by: ['stage'], where: convWhere, _count: { id: true } }),
      // Appointments
      prisma.appointment.count({ where: apptWhere }),
      prisma.appointment.count({ where: { ...apptWhere, status: 'pending' } }),
      // Clients
      prisma.client.count({ where: { userId: ownerId } }),
      prisma.client.count({ where: { userId: ownerId, status: 'active' } }),
      // AI paused
      prisma.conversation.count({ where: { ...convWhere, aiPaused: true } }),
      // Total converted
      prisma.conversation.count({ where: { ...convWhere, stage: 'converted' } }),
      // At risk: updated >48h ago, not converted/lost
      prisma.conversation.count({ 
        where: { 
          ...convWhere, 
          updatedAt: { lt: new Date(now.getTime() - 48 * 3600000) },
          stage: { notIn: ['converted', 'lost', 'perdido', 'convertido'] }
        } 
      }),
      // Lines
      prisma.whatsappLine.findMany({
        where: { userId: ownerId },
        select: { id: true, label: true, phone: true, status: true, sessionName: true }
      }),
      // Recent messages
      prisma.message.findMany({
        where: { conversation: convWhere, fromMe: false },
        orderBy: { timestamp: 'desc' }, take: 8,
        include: { conversation: { select: { recipientName: true, recipientId: true, stage: true, whatsappLineId: true } } }
      }),
      // Top leads
      prisma.conversation.findMany({
        where: { ...convWhere, stage: { notIn: ['converted', 'lost', 'perdido', 'convertido'] } },
        orderBy: { updatedAt: 'desc' }, take: 5,
        select: { id: true, recipientName: true, recipientId: true, stage: true, updatedAt: true, whatsappLineId: true, _count: { select: { messages: true } } }
      }),
      // Daily messages in range (for chart)
      lineId
        ? prisma.$queryRaw`
            SELECT m."timestamp"::date as day, COUNT(*)::int as count
            FROM "Message" m JOIN "Conversation" c ON m."conversationId" = c.id
            WHERE c."userId" = ${ownerId} AND c."whatsappLineId" = ${lineId as string}
              AND m."timestamp" >= ${rangeStart} AND m."timestamp" <= ${rangeEnd}
            GROUP BY m."timestamp"::date ORDER BY day
          ` as Promise<Array<{ day: Date; count: number }>>
        : prisma.$queryRaw`
            SELECT m."timestamp"::date as day, COUNT(*)::int as count
            FROM "Message" m JOIN "Conversation" c ON m."conversationId" = c.id
            WHERE c."userId" = ${ownerId}
              AND m."timestamp" >= ${rangeStart} AND m."timestamp" <= ${rangeEnd}
            GROUP BY m."timestamp"::date ORDER BY day
          ` as Promise<Array<{ day: Date; count: number }>>,
      // Daily new conversations in range (for chart)
      lineId
        ? prisma.$queryRaw`
            SELECT "createdAt"::date as day, COUNT(*)::int as count
            FROM "Conversation"
            WHERE "userId" = ${ownerId} AND "whatsappLineId" = ${lineId as string}
              AND "createdAt" >= ${rangeStart} AND "createdAt" <= ${rangeEnd}
            GROUP BY "createdAt"::date ORDER BY day
          ` as Promise<Array<{ day: Date; count: number }>>
        : prisma.$queryRaw`
            SELECT "createdAt"::date as day, COUNT(*)::int as count
            FROM "Conversation"
            WHERE "userId" = ${ownerId}
              AND "createdAt" >= ${rangeStart} AND "createdAt" <= ${rangeEnd}
            GROUP BY "createdAt"::date ORDER BY day
          ` as Promise<Array<{ day: Date; count: number }>>,
      // Messages sent vs received in range
      prisma.message.count({ where: { conversation: convWhere, fromMe: true, timestamp: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.message.count({ where: { conversation: convWhere, fromMe: false, timestamp: { gte: rangeStart, lte: rangeEnd } } }),
      // Oldest unresponded conversation
      prisma.conversation.findFirst({
        where: { ...convWhere, aiPaused: true, stage: { notIn: ['converted', 'lost', 'perdido'] } },
        orderBy: { updatedAt: 'asc' },
        select: { updatedAt: true, recipientName: true }
      })
    ]);

    // === Process daily chart data ===
    const dailyMap: Record<string, { msgs: number; convs: number }> = {};
    const dayDiff = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / 86400000);
    for (let i = 0; i <= dayDiff; i++) {
      const d = new Date(rangeStart); d.setDate(d.getDate() + i);
      const key = d.toISOString().split('T')[0];
      dailyMap[key] = { msgs: 0, convs: 0 };
    }
    if (Array.isArray(dailyMsgsRaw)) {
      dailyMsgsRaw.forEach((r: any) => { const k = new Date(r.day).toISOString().split('T')[0]; if (dailyMap[k]) dailyMap[k].msgs = Number(r.count) || 0; });
    }
    if (Array.isArray(dailyConvsRaw)) {
      dailyConvsRaw.forEach((r: any) => { const k = new Date(r.day).toISOString().split('T')[0]; if (dailyMap[k]) dailyMap[k].convs = Number(r.count) || 0; });
    }
    const chartData = Object.entries(dailyMap).sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({
      day, date: day, msgs: v.msgs, convs: v.convs
    }));

    // === Growth calculations ===
    const msgGrowth = prevRangeMessages > 0 ? (((rangeMessages - prevRangeMessages) / prevRangeMessages) * 100).toFixed(1) : rangeMessages > 0 ? '100' : '0';
    const convGrowth = prevRangeNewConvs > 0 ? (((rangeNewConvs - prevRangeNewConvs) / prevRangeNewConvs) * 100).toFixed(1) : rangeNewConvs > 0 ? '100' : '0';
    const todayGrowth = yesterdayMessages > 0 ? (((todayMessages - yesterdayMessages) / yesterdayMessages) * 100).toFixed(0) : '0';

    // === Resolution rate ===
    const resolvedStages = ['converted', 'convertido', 'lost', 'perdido'];
    const resolvedCount = stageStats.filter(s => resolvedStages.includes(s.stage)).reduce((a, s) => a + s._count.id, 0);
    const resolutionRate = totalConversations > 0 ? ((resolvedCount / totalConversations) * 100).toFixed(1) : '0';

    // === Stage distribution for donut ===
    const activeStages = ['interesado', 'interested', 'cotización', 'cotizacion', 'quoting', 'demo', 'descubrimiento', 'trial_activo', 'pendiente_decision', 'negotiating'];
    const pendingStages = ['new', 'saludo', 'pendiente_talla', 'pendiente_color', 'pendiente_ciudad', 'pendiente_cambio', 'pendiente_pago', 'realizó_pedido'];
    const activeCount = stageStats.filter(s => activeStages.includes(s.stage)).reduce((a, s) => a + s._count.id, 0);
    const pendingCount = stageStats.filter(s => pendingStages.includes(s.stage)).reduce((a, s) => a + s._count.id, 0);
    
    const stageDistribution = {
      resolved: convertedTotal,
      active: activeCount,
      pending: pendingCount,
      atRisk: atRiskConvs,
      total: totalConversations
    };

    // === Avg msgs per conversation ===
    const avgMsgsPerConv = totalConversations > 0 ? (totalMessages / totalConversations).toFixed(1) : '0';

    // === Oldest wait time ===
    const oldestWaitMs = oldestUnresponded ? (now.getTime() - new Date(oldestUnresponded.updatedAt).getTime()) : 0;
    const oldestWaitFormatted = oldestWaitMs > 0 
      ? `${Math.floor(oldestWaitMs / 3600000)}h ${Math.floor((oldestWaitMs % 3600000) / 60000)}m`
      : '0h';

    // === Funnel data ===
    const funnelData = stageStats.map(s => ({ stage: s.stage || 'new', count: s._count.id }));

    // === WhatsApp delivery stats ===
    const whatsappStats = {
      sent: rangeMsgsFromMe,
      received: rangeMsgsIncoming,
      total: rangeMessages,
      deliveryRate: rangeMsgsFromMe > 0 ? '100' : '0', // We assume delivered since WAHA confirms
    };

    // Recent activity
    const recentActivity = recentMessages.map(m => ({
      type: 'message' as const,
      user: m.conversation.recipientName || m.conversation.recipientId || 'Desconocido',
      action: m.content.substring(0, 80) + (m.content.length > 80 ? '...' : ''),
      time: m.timestamp.toISOString(),
      stage: m.conversation.stage,
      lineId: m.conversation.whatsappLineId,
    }));

    // Top leads
    const topLeads = topLeadsRaw.map(l => ({
      id: l.id, name: l.recipientName || l.recipientId, stage: l.stage,
      messages: l._count.messages, lastActive: l.updatedAt, lineId: l.whatsappLineId
    }));

    res.json({
      // Range info
      rangeLabel, rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString(),
      // Core metrics
      totalConversations, totalMessages,
      rangeMessages, prevRangeMessages,
      todayMessages, yesterdayMessages,
      weekMessages, monthMessages,
      // Growth
      msgGrowth, convGrowth, todayGrowth,
      // Conversations
      rangeNewConvs, prevRangeNewConvs,
      rangeConvertedConvs,
      convertedTotal,
      // Engagement
      aiPausedCount, avgMsgsPerConv,
      atRiskConvs,
      // Resolution
      resolutionRate, resolvedCount,
      stageDistribution,
      // WhatsApp
      whatsappStats,
      // Time
      oldestWait: oldestWaitFormatted,
      oldestWaitName: oldestUnresponded?.recipientName || '',
      // Appointments & Clients
      totalAppointments, pendingAppointments,
      totalClients, activeClients,
      // Charts
      chartData,
      // Lists
      funnelData, stageStats: funnelData,
      recentActivity, topLeads,
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

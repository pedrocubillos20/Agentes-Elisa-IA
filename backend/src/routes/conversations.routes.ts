import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getOwnerId } from '../lib/helpers';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// Helper para obtener el owner real (con cache para evitar queries repetidas)

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

// GET /api/conversations/dashboard - ENTERPRISE DASHBOARD v3
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

    // === DATE RANGE ===
    let rangeStart = weekStart;
    let rangeEnd = now;
    let rangeLabel = '7d';
    
    if (dateFrom && dateTo) {
      rangeStart = new Date(dateFrom as string);
      rangeEnd = new Date(dateTo as string);
      rangeEnd.setHours(23, 59, 59, 999);
      rangeLabel = 'custom';
    } else if (period === '24h') {
      rangeStart = new Date(now.getTime() - 86400000); rangeLabel = '24h';
    } else if (period === '7d' || period === 'week') {
      rangeStart = weekStart; rangeLabel = '7d';
    } else if (period === '30d' || period === 'month') {
      rangeStart = monthStart; rangeLabel = '30d';
    } else if (period === '90d') {
      rangeStart = new Date(now.getTime() - 90 * 86400000); rangeLabel = '90d';
    } else if (period === 'year') {
      rangeStart = new Date(now.getFullYear(), 0, 1); rangeLabel = 'year';
    }

    const rangeDuration = rangeEnd.getTime() - rangeStart.getTime();
    const prevRangeStart = new Date(rangeStart.getTime() - rangeDuration);
    const prevRangeEnd = new Date(rangeStart);

    const convWhere: any = { userId: ownerId };
    if (lineId) convWhere.whatsappLineId = lineId as string;

    // ===== MAIN QUERIES =====
    const [
      totalConversations, totalMessages,
      rangeMessages, prevRangeMessages,
      todayMessages, yesterdayMessages,
      rangeNewConvs, prevRangeNewConvs,
      rangeConvertedConvs, prevRangeConverted,
      stageStats,
      aiPausedCount, convertedTotal,
      atRiskConvs,
      totalAppointments, pendingAppointments,
      rangeMsgsFromMe, rangeMsgsIncoming,
      oldestUnresponded,
      lines
    ] = await Promise.all([
      prisma.conversation.count({ where: convWhere }),
      prisma.message.count({ where: { conversation: convWhere } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: prevRangeStart, lt: prevRangeEnd } } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: todayStart } } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.conversation.count({ where: { ...convWhere, createdAt: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.conversation.count({ where: { ...convWhere, createdAt: { gte: prevRangeStart, lt: prevRangeEnd } } }),
      prisma.conversation.count({ where: { ...convWhere, stage: { in: ['converted', 'convertido', 'confirmado'] }, updatedAt: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.conversation.count({ where: { ...convWhere, stage: { in: ['converted', 'convertido', 'confirmado'] }, updatedAt: { gte: prevRangeStart, lt: prevRangeEnd } } }),
      prisma.conversation.groupBy({ by: ['stage'], where: convWhere, _count: { id: true } }),
      prisma.conversation.count({ where: { ...convWhere, aiPaused: true } }),
      prisma.conversation.count({ where: { ...convWhere, stage: { in: ['converted', 'convertido', 'confirmado'] } } }),
      prisma.conversation.count({ 
        where: { ...convWhere, updatedAt: { lt: new Date(now.getTime() - 48 * 3600000) }, stage: { notIn: ['converted', 'lost', 'perdido', 'convertido', 'confirmado'] } } 
      }),
      prisma.appointment.count({ where: { userId: ownerId, ...(lineId ? { whatsappLineId: lineId as string } : {}) } }),
      prisma.appointment.count({ where: { userId: ownerId, status: 'pending', ...(lineId ? { whatsappLineId: lineId as string } : {}) } }),
      prisma.message.count({ where: { conversation: convWhere, fromMe: true, timestamp: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.message.count({ where: { conversation: convWhere, fromMe: false, timestamp: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.conversation.findFirst({
        where: { ...convWhere, aiPaused: true, stage: { notIn: ['converted', 'lost', 'perdido', 'convertido', 'confirmado'] } },
        orderBy: { updatedAt: 'asc' }, select: { updatedAt: true, recipientName: true }
      }),
      prisma.whatsappLine.findMany({ where: { userId: ownerId }, select: { id: true, label: true, phone: true, status: true } })
    ]);

    // ===== ADVANCED METRICS (raw SQL for performance) =====
    const lineFilter = lineId ? `AND c."whatsappLineId" = '${lineId}'` : '';

    // 1. FRT - First Response Time (avg minutes from first incoming to first outgoing msg)
    let avgFRT = 0;
    let slaCompliance = 0;
    try {
      const frtResult = await prisma.$queryRawUnsafe(`
        WITH first_incoming AS (
          SELECT c.id as conv_id, MIN(m."timestamp") as first_in
          FROM "Conversation" c JOIN "Message" m ON m."conversationId" = c.id
          WHERE c."userId" = '${ownerId}' ${lineFilter} AND m."fromMe" = false
            AND c."createdAt" >= '${rangeStart.toISOString()}' AND c."createdAt" <= '${rangeEnd.toISOString()}'
          GROUP BY c.id
        ),
        first_response AS (
          SELECT c.id as conv_id, MIN(m."timestamp") as first_out
          FROM "Conversation" c JOIN "Message" m ON m."conversationId" = c.id
          WHERE c."userId" = '${ownerId}' ${lineFilter} AND m."fromMe" = true
          GROUP BY c.id
        ),
        frt_data AS (
          SELECT fi.conv_id, 
            EXTRACT(EPOCH FROM (fr.first_out - fi.first_in)) / 60.0 as frt_minutes
          FROM first_incoming fi JOIN first_response fr ON fi.conv_id = fr.conv_id
          WHERE fr.first_out > fi.first_in
        )
        SELECT 
          COALESCE(AVG(frt_minutes), 0)::float as avg_frt,
          COALESCE(COUNT(CASE WHEN frt_minutes <= 5 THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 0)::float as sla_pct,
          COUNT(*)::int as total_measured
        FROM frt_data
      `) as any[];
      if (frtResult?.[0]) {
        avgFRT = Math.round((frtResult[0].avg_frt || 0) * 10) / 10;
        slaCompliance = Math.round(frtResult[0].sla_pct || 0);
      }
    } catch (e) { console.error('FRT query error:', e); }

    // 2. Contact Rate - % conversations with at least one outgoing message
    let contactRate = 0;
    try {
      const contactResult = await prisma.$queryRawUnsafe(`
        SELECT 
          COUNT(DISTINCT CASE WHEN m."fromMe" = true THEN c.id END)::int as contacted,
          COUNT(DISTINCT c.id)::int as total
        FROM "Conversation" c LEFT JOIN "Message" m ON m."conversationId" = c.id
        WHERE c."userId" = '${ownerId}' ${lineFilter}
          AND c."createdAt" >= '${rangeStart.toISOString()}' AND c."createdAt" <= '${rangeEnd.toISOString()}'
      `) as any[];
      if (contactResult?.[0] && contactResult[0].total > 0) {
        contactRate = Math.round((contactResult[0].contacted / contactResult[0].total) * 100);
      }
    } catch (e) { console.error('Contact rate error:', e); }

    // 3. Cycle Time - avg days from creation to conversion
    let avgCycleTime = 0;
    try {
      const cycleResult = await prisma.$queryRawUnsafe(`
        SELECT COALESCE(AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) / 86400.0), 0)::float as avg_days
        FROM "Conversation"
        WHERE "userId" = '${ownerId}' ${lineFilter}
          AND "stage" IN ('converted', 'convertido', 'confirmado')
          AND "updatedAt" >= '${rangeStart.toISOString()}'
      `) as any[];
      if (cycleResult?.[0]) avgCycleTime = Math.round((cycleResult[0].avg_days || 0) * 10) / 10;
    } catch (e) { console.error('Cycle time error:', e); }

    // 4. AI Automation Rate - % conversations resolved without human intervention
    const aiAutoRate = totalConversations > 0 
      ? Math.round(((totalConversations - aiPausedCount) / totalConversations) * 100) : 0;

    // 5. Conversion funnel (stage-to-stage)
    const stageOrder = ['new', 'saludo', 'interesado', 'interested'];
    const midStages = stageStats
      .filter(s => !['converted','convertido','confirmado','lost','perdido','new','saludo'].includes(s.stage))
      .map(s => s.stage);
    const orderedStages = [...stageOrder.filter(s => stageStats.some(ss => ss.stage === s)), ...midStages, 'converted'];
    
    const funnelRates: Array<{from: string; to: string; rate: number}> = [];
    for (let i = 0; i < orderedStages.length - 1; i++) {
      const fromCount = stageStats.find(s => s.stage === orderedStages[i])?._count.id || 0;
      const toCount = stageStats.find(s => s.stage === orderedStages[i + 1])?._count.id || 0;
      if (fromCount > 0) {
        funnelRates.push({ from: orderedStages[i], to: orderedStages[i + 1], rate: Math.round((toCount / (fromCount + toCount)) * 100) });
      }
    }

    // ===== CHART DATA =====
    const dailyMsgsRaw = await (lineId
      ? prisma.$queryRaw`
          SELECT m."timestamp"::date as day, COUNT(*)::int as count
          FROM "Message" m JOIN "Conversation" c ON m."conversationId" = c.id
          WHERE c."userId" = ${ownerId} AND c."whatsappLineId" = ${lineId as string}
            AND m."timestamp" >= ${rangeStart} AND m."timestamp" <= ${rangeEnd}
          GROUP BY m."timestamp"::date ORDER BY day`
      : prisma.$queryRaw`
          SELECT m."timestamp"::date as day, COUNT(*)::int as count
          FROM "Message" m JOIN "Conversation" c ON m."conversationId" = c.id
          WHERE c."userId" = ${ownerId}
            AND m."timestamp" >= ${rangeStart} AND m."timestamp" <= ${rangeEnd}
          GROUP BY m."timestamp"::date ORDER BY day`
    ) as Array<{ day: Date; count: number }>;

    const dailyConvsRaw = await (lineId
      ? prisma.$queryRaw`
          SELECT "createdAt"::date as day, COUNT(*)::int as count
          FROM "Conversation" WHERE "userId" = ${ownerId} AND "whatsappLineId" = ${lineId as string}
            AND "createdAt" >= ${rangeStart} AND "createdAt" <= ${rangeEnd}
          GROUP BY "createdAt"::date ORDER BY day`
      : prisma.$queryRaw`
          SELECT "createdAt"::date as day, COUNT(*)::int as count
          FROM "Conversation" WHERE "userId" = ${ownerId}
            AND "createdAt" >= ${rangeStart} AND "createdAt" <= ${rangeEnd}
          GROUP BY "createdAt"::date ORDER BY day`
    ) as Array<{ day: Date; count: number }>;

    const dailyMap: Record<string, { msgs: number; convs: number }> = {};
    const dayDiff = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / 86400000);
    for (let i = 0; i <= dayDiff; i++) {
      const dd = new Date(rangeStart); dd.setDate(dd.getDate() + i);
      dailyMap[dd.toISOString().split('T')[0]] = { msgs: 0, convs: 0 };
    }
    if (Array.isArray(dailyMsgsRaw)) dailyMsgsRaw.forEach((r: any) => { const k = new Date(r.day).toISOString().split('T')[0]; if (dailyMap[k]) dailyMap[k].msgs = Number(r.count) || 0; });
    if (Array.isArray(dailyConvsRaw)) dailyConvsRaw.forEach((r: any) => { const k = new Date(r.day).toISOString().split('T')[0]; if (dailyMap[k]) dailyMap[k].convs = Number(r.count) || 0; });
    const chartData = Object.entries(dailyMap).sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day, msgs: v.msgs, convs: v.convs }));

    // ===== LISTS =====
    const [recentMessages, topLeadsRaw] = await Promise.all([
      prisma.message.findMany({
        where: { conversation: convWhere, fromMe: false }, orderBy: { timestamp: 'desc' }, take: 8,
        include: { conversation: { select: { recipientName: true, recipientId: true, stage: true } } }
      }),
      prisma.conversation.findMany({
        where: { ...convWhere, stage: { notIn: ['converted', 'lost', 'perdido', 'convertido', 'confirmado'] } },
        orderBy: { updatedAt: 'desc' }, take: 5,
        select: { id: true, recipientName: true, recipientId: true, stage: true, updatedAt: true, _count: { select: { messages: true } } }
      })
    ]);

    // ===== GROWTH CALCULATIONS =====
    const msgGrowth = prevRangeMessages > 0 ? (((rangeMessages - prevRangeMessages) / prevRangeMessages) * 100).toFixed(1) : rangeMessages > 0 ? '100' : '0';
    const convGrowth = prevRangeNewConvs > 0 ? (((rangeNewConvs - prevRangeNewConvs) / prevRangeNewConvs) * 100).toFixed(1) : rangeNewConvs > 0 ? '100' : '0';
    const convertedGrowth = prevRangeConverted > 0 ? (((rangeConvertedConvs - prevRangeConverted) / prevRangeConverted) * 100).toFixed(1) : rangeConvertedConvs > 0 ? '100' : '0';

    // Stage distribution
    const resolvedStagesList = ['converted', 'convertido', 'confirmado'];
    const lostStagesList = ['lost', 'perdido'];
    const activeStagesList = ['interesado', 'interested', 'cotización', 'cotizacion', 'quoting', 'en_cotización', 'demo', 'descubrimiento', 'trial_activo', 'pendiente_decision', 'negotiating'];
    
    const resolvedCount = stageStats.filter(s => resolvedStagesList.includes(s.stage)).reduce((a, s) => a + s._count.id, 0);
    const lostCount = stageStats.filter(s => lostStagesList.includes(s.stage)).reduce((a, s) => a + s._count.id, 0);
    const activeCount = stageStats.filter(s => activeStagesList.includes(s.stage)).reduce((a, s) => a + s._count.id, 0);
    const pendingCount = Math.max(totalConversations - resolvedCount - lostCount - activeCount - atRiskConvs, 0);
    const conversionRate = totalConversations > 0 ? ((convertedTotal / totalConversations) * 100).toFixed(1) : '0';
    const avgMsgsPerConv = totalConversations > 0 ? (totalMessages / totalConversations).toFixed(1) : '0';

    // Oldest wait
    const oldestWaitMs = oldestUnresponded ? (now.getTime() - new Date(oldestUnresponded.updatedAt).getTime()) : 0;
    const oldestWait = oldestWaitMs > 0 ? `${Math.floor(oldestWaitMs / 3600000)}h ${Math.floor((oldestWaitMs % 3600000) / 60000)}m` : '0h';

    const funnelData = stageStats.map(s => ({ stage: s.stage || 'new', count: s._count.id }));

    res.json({
      rangeLabel, rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString(),
      // Core KPIs
      totalConversations, totalMessages,
      rangeMessages, todayMessages, yesterdayMessages,
      rangeNewConvs, rangeConvertedConvs, convertedTotal,
      // Growth
      msgGrowth, convGrowth, convertedGrowth,
      // Advanced metrics
      avgFRT, slaCompliance, contactRate, avgCycleTime, aiAutoRate, conversionRate,
      avgMsgsPerConv, aiPausedCount, atRiskConvs,
      // Distribution
      stageDistribution: { resolved: convertedTotal, active: activeCount, pending: pendingCount, atRisk: atRiskConvs, lost: lostCount, total: totalConversations },
      whatsappStats: { sent: rangeMsgsFromMe, received: rangeMsgsIncoming, total: rangeMessages },
      // Time
      oldestWait, oldestWaitName: oldestUnresponded?.recipientName || '',
      // Pipeline
      funnelData, funnelRates,
      // Appointments
      totalAppointments, pendingAppointments,
      // Charts
      chartData,
      // Lists
      recentActivity: recentMessages.map(m => ({
        user: m.conversation.recipientName || m.conversation.recipientId || 'Desconocido',
        action: m.content.substring(0, 80) + (m.content.length > 80 ? '...' : ''),
        time: m.timestamp.toISOString(), stage: m.conversation.stage,
      })),
      topLeads: topLeadsRaw.map(l => ({
        id: l.id, name: l.recipientName || l.recipientId, stage: l.stage,
        messages: l._count.messages, lastActive: l.updatedAt
      })),
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

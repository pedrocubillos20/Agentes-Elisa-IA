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

    // 👤 FILTRO POR ASIGNACIÓN: vendedores y soporte solo ven sus chats asignados + sin asignar
    if (userId !== ownerId) {
      const currentUser = await prisma.user.findUnique({ 
        where: { id: userId }, select: { role: true } 
      });
      if (currentUser && (currentUser.role === 'agent' || currentUser.role === 'support')) {
        where.OR = [
          { assignedTo: userId },    // Asignados a ellos
          { assignedTo: null }        // Sin asignar
        ];
      }
      // admin y manager ven todo (no se filtra)
    }

    const conversations = await prisma.conversation.findMany({
      where, orderBy: { updatedAt: 'desc' },
      select: {
        id: true, recipientId: true, recipientName: true, stage: true,
        aiPaused: true, updatedAt: true, lastMessage: true, contextData: true,
        whatsappLineId: true, isGroup: true, assignedTo: true, assignedName: true,
        groupName: true,
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
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/conversations/dashboard - ENTERPRISE DASHBOARD v3.1
// 
// FIX v3.1: Queries en BATCHES secuenciales de 5 para evitar
// P2024 "Timed out fetching connection from pool"
// Antes: 18 queries simultáneas con connection_limit=5 = cascading timeout
// Ahora: 4 batches de ~5 queries = estable
// ═══════════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════
    // BATCH 1: Core counts (5 queries)
    // ═══════════════════════════════════════════════════
    const [
      totalConversations,
      totalMessages,
      rangeMessages,
      prevRangeMessages,
      todayMessages
    ] = await Promise.all([
      prisma.conversation.count({ where: convWhere }),
      prisma.message.count({ where: { conversation: convWhere } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: prevRangeStart, lt: prevRangeEnd } } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: todayStart } } }),
    ]);

    // ═══════════════════════════════════════════════════
    // BATCH 2: Conversation counts + stages (5 queries)
    // ═══════════════════════════════════════════════════
    const [
      yesterdayMessages,
      rangeNewConvs,
      prevRangeNewConvs,
      rangeConvertedConvs,
      stageStats
    ] = await Promise.all([
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.conversation.count({ where: { ...convWhere, createdAt: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.conversation.count({ where: { ...convWhere, createdAt: { gte: prevRangeStart, lt: prevRangeEnd } } }),
      prisma.conversation.count({ where: { ...convWhere, stage: { in: ['converted', 'convertido', 'confirmado'] }, updatedAt: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.conversation.groupBy({ by: ['stage'], where: convWhere, _count: { id: true } }),
    ]);

    // ═══════════════════════════════════════════════════
    // BATCH 3: Advanced counts (5 queries)
    // ═══════════════════════════════════════════════════
    const [
      prevRangeConverted,
      aiPausedCount,
      convertedTotal,
      atRiskConvs,
      totalAppointments
    ] = await Promise.all([
      prisma.conversation.count({ where: { ...convWhere, stage: { in: ['converted', 'convertido', 'confirmado'] }, updatedAt: { gte: prevRangeStart, lt: prevRangeEnd } } }),
      prisma.conversation.count({ where: { ...convWhere, aiPaused: true } }),
      prisma.conversation.count({ where: { ...convWhere, stage: { in: ['converted', 'convertido', 'confirmado'] } } }),
      prisma.conversation.count({ 
        where: { ...convWhere, updatedAt: { lt: new Date(now.getTime() - 48 * 3600000) }, stage: { notIn: ['converted', 'lost', 'perdido', 'convertido', 'confirmado'] } } 
      }),
      prisma.appointment.count({ where: { userId: ownerId, ...(lineId ? { whatsappLineId: lineId as string } : {}) } }),
    ]);

    // ═══════════════════════════════════════════════════
    // BATCH 4: WhatsApp stats + oldest + lines (5 queries)
    // ═══════════════════════════════════════════════════
    const [
      pendingAppointments,
      rangeMsgsFromMe,
      rangeMsgsIncoming,
      oldestUnresponded,
      lines
    ] = await Promise.all([
      prisma.appointment.count({ where: { userId: ownerId, status: 'pending', ...(lineId ? { whatsappLineId: lineId as string } : {}) } }),
      prisma.message.count({ where: { conversation: convWhere, fromMe: true, timestamp: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.message.count({ where: { conversation: convWhere, fromMe: false, timestamp: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.conversation.findFirst({
        where: { ...convWhere, aiPaused: true, stage: { notIn: ['converted', 'lost', 'perdido', 'convertido', 'confirmado'] } },
        orderBy: { updatedAt: 'asc' }, select: { updatedAt: true, recipientName: true }
      }),
      prisma.whatsappLine.findMany({ where: { userId: ownerId }, select: { id: true, label: true, phone: true, status: true } })
    ]);

    // ═══════════════════════════════════════════════════
    // ADVANCED METRICS (raw SQL — sequential, no pool pressure)
    // ═══════════════════════════════════════════════════
    // 🔒 SECURITY: Validate lineId format to prevent SQL injection
    const safeLineId = lineId && /^[a-zA-Z0-9_-]{1,50}$/.test(lineId as string) ? lineId as string : null;
    const lineFilter = safeLineId ? `AND c."whatsappLineId" = '${safeLineId}'` : '';

    // 1. FRT - First Response Time
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

    // 2. Contact Rate
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

    // 3. Cycle Time
    let avgCycleTime = 0;
    try {
      const cycleResult = await prisma.$queryRawUnsafe(`
        SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (c."updatedAt" - c."createdAt")) / 86400.0), 0)::float as avg_days
        FROM "Conversation" c
        WHERE c."userId" = '${ownerId}' ${lineFilter}
          AND c."stage" IN ('converted', 'convertido', 'confirmado')
          AND c."updatedAt" >= '${rangeStart.toISOString()}'
      `) as any[];
      if (cycleResult?.[0]) avgCycleTime = Math.round((cycleResult[0].avg_days || 0) * 10) / 10;
    } catch (e) { console.error('Cycle time error:', e); }

    // 4. AI Automation Rate
    const aiAutoRate = totalConversations > 0 
      ? Math.round(((totalConversations - aiPausedCount) / totalConversations) * 100) : 0;

    // 5. Conversion funnel
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

    // ═══════════════════════════════════════════════════
    // CHART DATA (sequential — 2 queries)
    // ═══════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════
    // LISTS (1 batch of 2 queries)
    // ═══════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════
    // GROWTH CALCULATIONS
    // ═══════════════════════════════════════════════════
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

    // === EXTRA METRICS (sequential to avoid pool pressure) ===
    let abandonmentRate = 0;
    try {
      const abandonResult = await prisma.$queryRawUnsafe(`
        SELECT 
          COUNT(DISTINCT CASE WHEN NOT EXISTS (
            SELECT 1 FROM "Message" m2 WHERE m2."conversationId" = c.id AND m2."fromMe" = true
          ) THEN c.id END)::int as abandoned,
          COUNT(DISTINCT c.id)::int as total
        FROM "Conversation" c JOIN "Message" m ON m."conversationId" = c.id
        WHERE c."userId" = '${ownerId}' ${lineFilter}
          AND c."createdAt" >= '${rangeStart.toISOString()}' AND c."createdAt" <= '${rangeEnd.toISOString()}'
          AND m."fromMe" = false
      `) as any[];
      if (abandonResult?.[0] && abandonResult[0].total > 0) {
        abandonmentRate = Math.round((abandonResult[0].abandoned / abandonResult[0].total) * 100);
      }
    } catch (e) { console.error('Abandon rate error:', e); }

    // Hourly distribution
    let hourlyData: Array<{hour: number; count: number}> = [];
    try {
      const hourlyResult = await prisma.$queryRawUnsafe(`
        SELECT EXTRACT(HOUR FROM m."timestamp")::int as hour, COUNT(*)::int as count
        FROM "Message" m JOIN "Conversation" c ON m."conversationId" = c.id
        WHERE c."userId" = '${ownerId}' ${lineFilter}
          AND m."timestamp" >= '${rangeStart.toISOString()}' AND m."timestamp" <= '${rangeEnd.toISOString()}'
        GROUP BY hour ORDER BY hour
      `) as any[];
      const hourMap: Record<number, number> = {};
      for (let h = 0; h < 24; h++) hourMap[h] = 0;
      if (Array.isArray(hourlyResult)) hourlyResult.forEach((r: any) => { hourMap[r.hour] = r.count; });
      hourlyData = Object.entries(hourMap).map(([h, c]) => ({ hour: Number(h), count: c }));
    } catch (e) { console.error('Hourly error:', e); }

    // AI metrics
    const aiTransferRate = totalConversations > 0 ? Math.round((aiPausedCount / totalConversations) * 100) : 0;
    const aiResolvedCount = convertedTotal > 0 ? Math.max(convertedTotal - aiPausedCount, 0) : 0;
    const aiResolvedRate = convertedTotal > 0 ? Math.round((aiResolvedCount / Math.max(convertedTotal, 1)) * 100) : 0;

    res.json({
      rangeLabel, rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString(),
      totalConversations, totalMessages,
      rangeMessages, todayMessages, yesterdayMessages,
      rangeNewConvs, rangeConvertedConvs, convertedTotal,
      msgGrowth, convGrowth, convertedGrowth,
      avgFRT, slaCompliance, contactRate, avgCycleTime, aiAutoRate, conversionRate,
      avgMsgsPerConv, aiPausedCount, atRiskConvs,
      abandonmentRate, aiTransferRate, aiResolvedRate, aiResolvedCount,
      stageDistribution: { resolved: convertedTotal, active: activeCount, pending: pendingCount, atRisk: atRiskConvs, lost: lostCount, total: totalConversations },
      whatsappStats: { sent: rangeMsgsFromMe, received: rangeMsgsIncoming, total: rangeMessages },
      oldestWait, oldestWaitName: oldestUnresponded?.recipientName || '',
      funnelData, funnelRates, hourlyData,
      totalAppointments, pendingAppointments,
      chartData,
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
    
    const ownerId = await getOwnerId(userId!);

    const conversation = await prisma.conversation.findFirst({ where: { id, userId: ownerId } });
    if (!conversation) { res.status(404).json({ error: 'No encontrada' }); return; }

    const messages = await prisma.message.findMany({
      where: { conversationId: id }, 
      orderBy: { timestamp: 'desc' }, 
      take: limit
    });
    messages.reverse();
    
    // Transform: replace heavy base64/WAHA URLs with lightweight proxy URL for images
    const transformed = messages.map((msg: any) => {
      if (msg.mediaType === 'image' && msg.mediaUrl) {
        return { ...msg, mediaUrl: `/api/media-proxy/${msg.id}` };
      }
      return msg;
    });
    
    res.json({ messages: transformed });
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
// ⚙️ PUT /api/conversations/:id/group-settings
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

// ====================================================
// 📝 PUT /api/conversations/:id/notes — Guardar/actualizar notas manuales
// ====================================================
router.put('/:id/notes', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;
    const { notes } = req.body;

    const existing = await prisma.conversation.findFirst({ where: { id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'No encontrada' }); return; }

    // Guardar notas en contextData._userNotes (no interfiere con IA)
    const currentContext = (existing.contextData as any) || {};
    const updatedContext = { ...currentContext, _userNotes: notes || '' };

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { contextData: updatedContext }
    });

    res.json({ success: true, notes: notes || '' });
  } catch (error) {
    console.error('Error guardando notas:', error);
    res.status(500).json({ error: 'Error al guardar notas' });
  }
});

// ====================================================
// 👤 PUT /api/conversations/:id/assign — Asignar chat a miembro del equipo
// ====================================================
router.put('/:id/assign', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    // Verificar permisos: solo admin, manager o gerente pueden asignar
    const user = await prisma.user.findUnique({ 
      where: { id: userId }, 
      select: { id: true, role: true, parentUserId: true } 
    });
    if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }

    const isOwner = !user.parentUserId;
    const canAssign = isOwner || user.role === 'manager';
    if (!canAssign) {
      res.status(403).json({ error: 'Solo administradores y gerentes pueden asignar chats.' });
      return;
    }

    const ownerId = user.parentUserId || user.id;
    const { id } = req.params;
    const { assignedTo } = req.body; // userId del miembro o null para desasignar

    const existing = await prisma.conversation.findFirst({ where: { id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'No encontrada' }); return; }

    let assignedName: string | null = null;
    if (assignedTo) {
      // Verificar que el miembro existe y pertenece al equipo
      const member = await prisma.user.findUnique({ 
        where: { id: assignedTo }, 
        select: { name: true, email: true, parentUserId: true, id: true } 
      });
      if (!member) { res.status(404).json({ error: 'Miembro no encontrado' }); return; }
      // El miembro debe ser sub-usuario del mismo owner O el owner mismo
      if (member.parentUserId !== ownerId && member.id !== ownerId) {
        res.status(403).json({ error: 'El miembro no pertenece a tu equipo' }); return;
      }
      assignedName = member.name || member.email;
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { assignedTo: assignedTo || null, assignedName: assignedName }
    });

    console.log(`👤 Chat "${existing.recipientName}" asignado a ${assignedName || 'nadie'} por ${userId}`);
    res.json({ success: true, conversation, assignedTo, assignedName });
  } catch (error) {
    console.error('Error asignando chat:', error);
    res.status(500).json({ error: 'Error al asignar chat' });
  }
});

// ====================================================
// 📅 POST /api/conversations/:id/quick-appointment — Agendar cita rápida
// ====================================================
router.post('/:id/quick-appointment', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;
    const { date, time, type, notes } = req.body;

    if (!date || !time) {
      res.status(400).json({ error: 'Fecha y hora son requeridos' }); return;
    }

    const conv = await prisma.conversation.findFirst({ 
      where: { id, userId: ownerId },
      select: { recipientName: true, recipientId: true, whatsappLineId: true, contextData: true }
    });
    if (!conv) { res.status(404).json({ error: 'Conversación no encontrada' }); return; }

    // Extraer datos del cliente desde contextData
    const ctx = (conv.contextData as any) || {};
    const clientName = ctx.nombre || conv.recipientName || 'Sin nombre';
    const clientPhone = ctx.telefono || conv.recipientId?.replace(/@c\.us|@g\.us/g, '') || '';

    // Buscar o crear cliente
    let clientId: string | null = null;
    if (clientPhone) {
      const existingClient = await prisma.client.findFirst({ 
        where: { userId: ownerId, phone: { contains: clientPhone.replace(/\D/g, '').slice(-10) } }
      });
      if (existingClient) {
        clientId = existingClient.id;
      } else {
        const newClient = await prisma.client.create({
          data: { userId: ownerId, name: clientName, phone: clientPhone, status: 'active' }
        });
        clientId = newClient.id;
      }
    }

    const appointment = await prisma.appointment.create({
      data: {
        userId: ownerId,
        clientId,
        type: type || 'appointment',
        clientName,
        clientPhone,
        date: new Date(date + 'T00:00:00'),
        time,
        status: 'pending',
        notes: notes || null,
        whatsappLineId: conv.whatsappLineId || null
      }
    });

    console.log(`📅 Cita rápida creada: ${clientName} @ ${date} ${time}`);
    res.status(201).json({ success: true, appointment });
  } catch (error: any) {
    console.error('Error creando cita:', error.message);
    res.status(500).json({ error: 'Error al crear cita' });
  }
});

// DELETE /api/conversations/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const user = await prisma.user.findUnique({ 
      where: { id: userId }, 
      select: { id: true, parentUserId: true, role: true } 
    });
    if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }

    const isOwner = !user.parentUserId;
    const isManager = user.role === 'manager';

    if (!isOwner && !isManager) {
      res.status(403).json({ error: 'Solo administradores y gerentes pueden eliminar conversaciones.' });
      return;
    }

    const ownerId = user.parentUserId || user.id;
    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: ownerId }
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversación no encontrada' });
      return;
    }

    await prisma.conversation.delete({ where: { id } });

    console.log(`🗑️ Conversación "${conversation.recipientName || conversation.recipientId}" eliminada por ${isOwner ? 'admin' : 'gerente'} (${userId})`);
    res.json({ success: true, message: 'Conversación eliminada correctamente' });
  } catch (e: any) {
    console.error('Error eliminando conversación:', e.message);
    res.status(500).json({ error: 'Error al eliminar conversación' });
  }
});

// GET /api/conversations/export-contacts
router.get('/export-contacts', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { lineId } = req.query;
    const where: any = { userId: ownerId };
    if (lineId) where.whatsappLineId = lineId as string;

    const convs = await prisma.conversation.findMany({ where, orderBy: { updatedAt: 'desc' } });
    const exportData = convs.map(c => {
      const ctx = (c as any).contextData || {};
      return {
        nombre: c.recipientName || ctx.nombre || '',
        telefono: c.recipientId?.replace('@c.us', '').replace('@s.whatsapp.net', '') || '',
        etapa: c.stage || '',
        ciudad: ctx.ciudad || '',
        barrio: ctx.barrio || '',
        direccion: ctx.direccion || '',
        producto: ctx.producto_servicio || ctx.producto || '',
        talla: ctx.talla || '',
        color: ctx.color || '',
        calidad: ctx.calidad || '',
        bordado: ctx.bordado || '',
        total: ctx.total || ctx.precio || '',
        metodo_pago: ctx.metodo_pago || '',
        fecha_entrega: ctx.fecha_entrega || '',
        envio: ctx.envio || '',
        email: ctx.email || '',
        notas: ctx.notas || '',
        fecha: c.updatedAt?.toISOString().split('T')[0] || ''
      };
    });
    res.json({ data: exportData, count: exportData.length });
  } catch (error) {
    console.error('Error export contacts:', error);
    res.status(500).json({ error: 'Error al exportar' });
  }
});

export default router;

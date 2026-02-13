import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// Helper para obtener el owner real (considera parentUserId para equipos)
const getOwnerId = async (userId: string): Promise<string> => {
  const user = await prisma.user.findUnique({ 
    where: { id: userId }, 
    select: { parentUserId: true } 
  });
  return user?.parentUserId || userId;
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
      include: { messages: { orderBy: { timestamp: 'desc' }, take: 1 } }
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

// GET /api/conversations/dashboard - OPTIMIZADO con queries paralelas
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { lineId } = req.query;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    // Filtros base con soporte lineId
    const convWhere: any = { userId: ownerId };
    const apptWhere: any = { userId: ownerId };
    const clientWhere: any = { userId: ownerId };
    if (lineId) {
      convWhere.whatsappLineId = lineId as string;
      apptWhere.whatsappLineId = lineId as string;
      clientWhere.whatsappLineId = lineId as string;
    }

    // ===== TODAS LAS QUERIES EN PARALELO =====
    const [
      totalConversations,
      totalMessages,
      todayMessages,
      weekMessages,
      totalAppointments,
      pendingAppointments,
      totalClients,
      stageStats,
      recentMessages,
      recentAppointments,
      weeklyRaw
    ] = await Promise.all([
      prisma.conversation.count({ where: convWhere }),
      prisma.message.count({ where: { conversation: convWhere } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: todayStart } } }),
      prisma.message.count({ where: { conversation: convWhere, timestamp: { gte: weekStart } } }),
      prisma.appointment.count({ where: apptWhere }),
      prisma.appointment.count({ where: { ...apptWhere, status: 'pending' } }),
      prisma.client.count({ where: clientWhere }),
      prisma.conversation.groupBy({ by: ['stage'], where: convWhere, _count: { id: true } }),
      prisma.message.findMany({
        where: { conversation: convWhere, fromMe: false },
        orderBy: { timestamp: 'desc' }, take: 5,
        include: { conversation: { select: { recipientName: true, recipientId: true } } }
      }),
      prisma.appointment.findMany({
        where: apptWhere, orderBy: { createdAt: 'desc' }, take: 3
      }),
      // Actividad semanal - con filtro lineId
      lineId
        ? prisma.$queryRaw`
            SELECT EXTRACT(DOW FROM m."timestamp") as dow, COUNT(*)::int as count
            FROM "Message" m
            JOIN "Conversation" c ON m."conversationId" = c.id
            WHERE c."userId" = ${ownerId} AND c."whatsappLineId" = ${lineId as string} AND m."timestamp" >= ${weekStart}
            GROUP BY EXTRACT(DOW FROM m."timestamp")
            ORDER BY dow
          ` as Promise<Array<{ dow: number; count: number }>>
        : prisma.$queryRaw`
            SELECT EXTRACT(DOW FROM m."timestamp") as dow, COUNT(*)::int as count
            FROM "Message" m
            JOIN "Conversation" c ON m."conversationId" = c.id
            WHERE c."userId" = ${ownerId} AND m."timestamp" >= ${weekStart}
            GROUP BY EXTRACT(DOW FROM m."timestamp")
            ORDER BY dow
          ` as Promise<Array<{ dow: number; count: number }>>
    ]);

    // Procesar actividad semanal (0=Dom, 1=Lun... 6=Sáb)
    const weeklyActivity = [0, 0, 0, 0, 0, 0, 0];
    if (Array.isArray(weeklyRaw)) {
      weeklyRaw.forEach((r: any) => {
        const idx = Number(r.dow);
        if (idx >= 0 && idx <= 6) weeklyActivity[idx] = Number(r.count) || 0;
      });
    }

    const convertedCount = stageStats.find(s => s.stage === 'converted')?._count?.id || 0;
    const conversionRate = totalConversations > 0 ? ((convertedCount / totalConversations) * 100).toFixed(1) : '0';

    // Combinar actividad reciente
    const recentActivity = [
      ...recentMessages.map(m => ({
        type: 'message' as const,
        user: m.conversation.recipientName || m.conversation.recipientId || 'Desconocido',
        action: m.content.substring(0, 60) + (m.content.length > 60 ? '...' : ''),
        time: m.timestamp.toISOString(),
        timestamp: m.timestamp.getTime()
      })),
      ...recentAppointments.map(a => ({
        type: (a.type === 'order' ? 'sale' : 'appointment') as 'sale' | 'appointment',
        user: a.clientName,
        action: a.type === 'order'
          ? `Pedido${a.total ? ` - $${Number(a.total).toLocaleString()}` : ''}`
          : `Cita ${a.status === 'pending' ? 'pendiente' : a.status}`,
        time: a.createdAt.toISOString(),
        timestamp: a.createdAt.getTime()
      }))
    ].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);

    // Clientes potenciales por etapa
    const funnelData = stageStats.map(s => ({ stage: s.stage || 'new', count: s._count.id }));

    res.json({
      totalConversations, totalMessages, todayMessages, weekMessages,
      totalAppointments, pendingAppointments, totalClients,
      convertedCount, conversionRate,
      weeklyActivity, recentActivity, funnelData,
      stageStats: funnelData
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

    const conversation = await prisma.conversation.findFirst({ where: { id, userId } });
    if (!conversation) { res.status(404).json({ error: 'No encontrada' }); return; }

    const messages = await prisma.message.findMany({
      where: { conversationId: id }, orderBy: { timestamp: 'asc' }, take: limit
    });
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
    const existing = await prisma.conversation.findFirst({ where: { id, userId } });
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
    const existing = await prisma.conversation.findFirst({ where: { id, userId } });
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

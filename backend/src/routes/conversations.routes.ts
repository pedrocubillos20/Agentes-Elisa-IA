import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

const getOwnerId = async (userId: string): Promise<string> => {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  return u?.parentUserId || userId;
};

// GET /api/conversations?lineId=xxx
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

// GET /api/conversations/stats?lineId=xxx
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { lineId } = req.query;
    
    const where: any = { userId: ownerId };
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

// GET /api/conversations/dashboard?lineId=xxx
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

    // Build where clauses with optional lineId filter
    const convWhere: any = { userId: ownerId };
    const clientWhere: any = { userId: ownerId };
    const apptWhere: any = { userId: ownerId };
    if (lineId) {
      convWhere.whatsappLineId = lineId as string;
      clientWhere.whatsappLineId = lineId as string;
      apptWhere.whatsappLineId = lineId as string;
    }

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
      recentAppointments
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
      })
    ]);

    // Weekly activity — use raw query with lineId filter
    let weeklyActivity = [0, 0, 0, 0, 0, 0, 0];
    try {
      let weeklyRaw: any[];
      if (lineId) {
        weeklyRaw = await prisma.$queryRaw`
          SELECT EXTRACT(DOW FROM m."timestamp") as dow, COUNT(*)::int as count
          FROM "Message" m
          JOIN "Conversation" c ON m."conversationId" = c.id
          WHERE c."userId" = ${ownerId} AND c."whatsappLineId" = ${lineId as string} AND m."timestamp" >= ${weekStart}
          GROUP BY EXTRACT(DOW FROM m."timestamp")
          ORDER BY dow
        `;
      } else {
        weeklyRaw = await prisma.$queryRaw`
          SELECT EXTRACT(DOW FROM m."timestamp") as dow, COUNT(*)::int as count
          FROM "Message" m
          JOIN "Conversation" c ON m."conversationId" = c.id
          WHERE c."userId" = ${ownerId} AND m."timestamp" >= ${weekStart}
          GROUP BY EXTRACT(DOW FROM m."timestamp")
          ORDER BY dow
        `;
      }
      if (Array.isArray(weeklyRaw)) {
        weeklyRaw.forEach((r: any) => {
          const idx = Number(r.dow);
          if (idx >= 0 && idx <= 6) weeklyActivity[idx] = Number(r.count) || 0;
        });
      }
    } catch {}

    const convertedCount = stageStats.find(s => s.stage === 'converted')?._count?.id || 0;
    const conversionRate = totalConversations > 0 ? ((convertedCount / totalConversations) * 100).toFixed(1) : '0';

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

    const funnelData = stageStats.map(s => ({ stage: s.stage || 'new', count: s._count.id }));

    // Get line info if filtering
    let lineInfo = null;
    if (lineId) {
      lineInfo = await prisma.whatsappLine.findUnique({ where: { id: lineId as string }, select: { id: true, label: true, phone: true, status: true } });
    }

    res.json({
      totalConversations, totalMessages, todayMessages, weekMessages,
      totalAppointments, pendingAppointments, totalClients,
      convertedCount, conversionRate,
      weeklyActivity, recentActivity, funnelData,
      stageStats: funnelData,
      lineInfo
    });
  } catch (error) {
    console.error('Error dashboard:', error);
    res.status(500).json({ error: 'Error al obtener datos del dashboard' });
  }
});

// GET /api/conversations/:id/messages
router.get('/:id/messages', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const conversation = await prisma.conversation.findFirst({ where: { id, userId: ownerId } });
    if (!conversation) { res.status(404).json({ error: 'No encontrada' }); return; }

    const messages = await prisma.message.findMany({
      where: { conversationId: id }, orderBy: { timestamp: 'asc' }, take: limit
    });
    res.json({ messages, conversation });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// PUT /api/conversations/:id/stage
router.put('/:id/stage', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;
    const { stage } = req.body;
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
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;
    const { paused } = req.body;
    
    const existing = await prisma.conversation.findFirst({ where: { id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'No encontrada' }); return; }
    
    const conversation = await prisma.conversation.update({ where: { id }, data: { aiPaused: paused } });
    
    // Also pause ALL duplicate conversations for same recipient
    if (existing.recipientId) {
      const last10 = existing.recipientId.slice(-10);
      await prisma.conversation.updateMany({
        where: { userId: ownerId, id: { not: id }, recipientId: { endsWith: last10 } },
        data: { aiPaused: paused }
      }).catch(() => {});
    }
    
    console.log(`${paused ? '⏸️' : '▶️'} IA ${paused ? 'pausada' : 'reactivada'} → conv ${id}`);
    res.json({ conversation, message: paused ? 'IA pausada' : 'IA reactivada' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// DELETE /api/conversations/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;
    const existing = await prisma.conversation.findFirst({ where: { id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'No encontrada' }); return; }
    await prisma.message.deleteMany({ where: { conversationId: id } });
    await prisma.conversation.delete({ where: { id } });
    res.json({ success: true, message: 'Conversación eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/conversations/cleanup
router.post('/cleanup', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const allConvs = await prisma.conversation.findMany({
      where: { userId: ownerId }, orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { messages: true } } }
    });
    const groups: Map<string, typeof allConvs> = new Map();
    for (const conv of allConvs) {
      const key = conv.recipientId.slice(-10);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(conv);
    }
    let merged = 0, deleted = 0;
    for (const [key, convs] of groups) {
      if (convs.length <= 1) continue;
      const primary = convs.sort((a, b) => {
        const diff = b._count.messages - a._count.messages;
        return diff !== 0 ? diff : b.updatedAt.getTime() - a.updatedAt.getTime();
      })[0];
      for (let i = 1; i < convs.length; i++) {
        await prisma.message.updateMany({ where: { conversationId: convs[i].id }, data: { conversationId: primary.id } });
        await prisma.conversation.delete({ where: { id: convs[i].id } });
        deleted++;
      }
      merged++;
    }
    res.json({ success: true, merged, deleted, remaining: allConvs.length - deleted });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

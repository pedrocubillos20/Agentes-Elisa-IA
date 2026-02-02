import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// GET /api/conversations
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { stage } = req.query;
    const where: any = { userId };
    if (stage && stage !== 'all') where.stage = stage as string;

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
    const [stats, total] = await Promise.all([
      prisma.conversation.groupBy({ by: ['stage'], where: { userId }, _count: { id: true } }),
      prisma.conversation.count({ where: { userId } })
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

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

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
      // Actividad semanal con raw query (1 sola query en vez de 7)
      weeklyRaw
    ] = await Promise.all([
      prisma.conversation.count({ where: { userId } }),
      prisma.message.count({ where: { conversation: { userId } } }),
      prisma.message.count({ where: { conversation: { userId }, timestamp: { gte: todayStart } } }),
      prisma.message.count({ where: { conversation: { userId }, timestamp: { gte: weekStart } } }),
      prisma.appointment.count({ where: { userId } }),
      prisma.appointment.count({ where: { userId, status: 'pending' } }),
      prisma.client.count({ where: { userId } }),
      prisma.conversation.groupBy({ by: ['stage'], where: { userId }, _count: { id: true } }),
      prisma.message.findMany({
        where: { conversation: { userId }, fromMe: false },
        orderBy: { timestamp: 'desc' }, take: 5,
        include: { conversation: { select: { recipientName: true, recipientId: true } } }
      }),
      prisma.appointment.findMany({
        where: { userId }, orderBy: { createdAt: 'desc' }, take: 3
      }),
      // Actividad semanal: 1 query agrupa por día
      prisma.$queryRaw`
        SELECT EXTRACT(DOW FROM m."timestamp") as dow, COUNT(*)::int as count
        FROM "Message" m
        JOIN "Conversation" c ON m."conversationId" = c.id
        WHERE c."userId" = ${userId} AND m."timestamp" >= ${weekStart}
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

export default router;

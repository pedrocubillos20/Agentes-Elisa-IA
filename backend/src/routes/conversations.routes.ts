import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// Helper: get owner ID (for sub-users, return parent)
const getOwnerId = async (userId: string): Promise<string> => {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  return u?.parentUserId || userId;
};

// GET /api/conversations
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { stage } = req.query;
    const where: any = { userId: ownerId };
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
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const [stats, total] = await Promise.all([
      prisma.conversation.groupBy({ by: ['stage'], where: { userId: ownerId }, _count: { id: true } }),
      prisma.conversation.count({ where: { userId: ownerId } })
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
      weeklyRaw
    ] = await Promise.all([
      prisma.conversation.count({ where: { userId: ownerId } }),
      prisma.message.count({ where: { conversation: { userId: ownerId } } }),
      prisma.message.count({ where: { conversation: { userId: ownerId }, timestamp: { gte: todayStart } } }),
      prisma.message.count({ where: { conversation: { userId: ownerId }, timestamp: { gte: weekStart } } }),
      prisma.appointment.count({ where: { userId: ownerId } }),
      prisma.appointment.count({ where: { userId: ownerId, status: 'pending' } }),
      prisma.client.count({ where: { userId: ownerId } }),
      prisma.conversation.groupBy({ by: ['stage'], where: { userId: ownerId }, _count: { id: true } }),
      prisma.message.findMany({
        where: { conversation: { userId: ownerId }, fromMe: false },
        orderBy: { timestamp: 'desc' }, take: 5,
        include: { conversation: { select: { recipientName: true, recipientId: true } } }
      }),
      prisma.appointment.findMany({
        where: { userId: ownerId }, orderBy: { createdAt: 'desc' }, take: 3
      }),
      prisma.$queryRaw`
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
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const conversation = await prisma.conversation.findFirst({ where: { id, userId: ownerId } });
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
    
    // Also pause/unpause ALL duplicate conversations for the same recipient
    // This ensures the webhook respects the pause regardless of which conv it finds
    if (existing.recipientId) {
      const last10 = existing.recipientId.slice(-10);
      await prisma.conversation.updateMany({
        where: { 
          userId: ownerId, 
          id: { not: id },
          recipientId: { endsWith: last10 }
        },
        data: { aiPaused: paused }
      }).catch(() => {});
    }
    
    console.log(`${paused ? '⏸️' : '▶️'} IA ${paused ? 'pausada' : 'reactivada'} → conv ${id} (${existing.recipientName || existing.recipientId})`);
    res.json({ conversation, message: paused ? 'IA pausada' : 'IA reactivada' });
  } catch (error) {
    console.error('Error ai-pause:', error);
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
    
    // Delete messages first, then conversation
    await prisma.message.deleteMany({ where: { conversationId: id } });
    await prisma.conversation.delete({ where: { id } });
    
    res.json({ success: true, message: 'Conversación eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/conversations/cleanup — Merge duplicate conversations
router.post('/cleanup', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    // Find all conversations for this user
    const allConvs = await prisma.conversation.findMany({
      where: { userId: ownerId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { messages: true } } }
    });

    // Group by last 10 digits of recipientId
    const groups: Map<string, typeof allConvs> = new Map();
    for (const conv of allConvs) {
      const key = conv.recipientId.slice(-10);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(conv);
    }

    let merged = 0;
    let deleted = 0;

    for (const [key, convs] of groups) {
      if (convs.length <= 1) continue;

      // Keep the one with most messages (or most recent if tied)
      const primary = convs.sort((a, b) => {
        const diff = b._count.messages - a._count.messages;
        return diff !== 0 ? diff : b.updatedAt.getTime() - a.updatedAt.getTime();
      })[0];

      // Move messages from duplicates to primary
      for (let i = 1; i < convs.length; i++) {
        const dup = convs[i];
        // Move messages to primary conversation
        await prisma.message.updateMany({
          where: { conversationId: dup.id },
          data: { conversationId: primary.id }
        });
        // Delete the duplicate
        await prisma.conversation.delete({ where: { id: dup.id } });
        deleted++;
      }
      
      // Update primary's name if it's missing
      if (!primary.recipientName || primary.recipientName === primary.recipientId) {
        const better = convs.find(c => c.recipientName && c.recipientName !== c.recipientId);
        if (better) {
          await prisma.conversation.update({ 
            where: { id: primary.id }, 
            data: { recipientName: better.recipientName } 
          });
        }
      }
      merged++;
    }

    console.log(`🧹 Cleanup: ${merged} grupos fusionados, ${deleted} duplicados eliminados`);
    res.json({ success: true, merged, deleted, remaining: allConvs.length - deleted });
  } catch (error) {
    console.error('Error cleanup:', error);
    res.status(500).json({ error: 'Error al limpiar' });
  }
});

export default router;

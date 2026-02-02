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
    if (stage && stage !== 'all') {
      where.stage = stage as string;
    }

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { timestamp: 'desc' },
          take: 1
        }
      }
    });

    const formattedConversations = conversations.map(conv => ({
      ...conv,
      lastMessage: conv.messages[0]?.content || conv.lastMessage || null,
      messages: undefined
    }));

    res.json({ conversations: formattedConversations });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener conversaciones' });
  }
});

// GET /api/conversations/stats - Stats básicas
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;

    const stats = await prisma.conversation.groupBy({
      by: ['stage'],
      where: { userId },
      _count: { id: true }
    });

    const total = await prisma.conversation.count({ where: { userId } });

    res.json({ 
      stats: stats.map(s => ({ stage: s.stage || 'new', count: s._count.id })),
      total 
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// GET /api/conversations/dashboard - Dashboard completo con datos reales
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Inicio de semana (domingo)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Total conversaciones del usuario
    const totalConversations = await prisma.conversation.count({ where: { userId } });

    // Total mensajes del usuario
    const totalMessages = await prisma.message.count({
      where: { conversation: { userId } }
    });

    // Mensajes de hoy
    const todayMessages = await prisma.message.count({
      where: {
        conversation: { userId },
        timestamp: { gte: todayStart }
      }
    });

    // Mensajes esta semana
    const weekMessages = await prisma.message.count({
      where: {
        conversation: { userId },
        timestamp: { gte: weekStart }
      }
    });

    // Citas agendadas del usuario
    const totalAppointments = await prisma.appointment.count({ where: { userId } });
    const pendingAppointments = await prisma.appointment.count({
      where: { userId, status: 'pending' }
    });

    // Clientes en CRM
    const totalClients = await prisma.client.count({ where: { userId } });

    // Conversaciones por etapa
    const stageStats = await prisma.conversation.groupBy({
      by: ['stage'],
      where: { userId },
      _count: { id: true }
    });

    const convertedCount = stageStats.find(s => s.stage === 'converted')?._count?.id || 0;

    // Actividad semanal (mensajes por día de la semana)
    const weeklyActivity: number[] = [];
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(weekStart);
      dayStart.setDate(dayStart.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const count = await prisma.message.count({
        where: {
          conversation: { userId },
          timestamp: { gte: dayStart, lt: dayEnd }
        }
      });
      weeklyActivity.push(count);
    }

    // Actividad reciente: últimos 5 eventos (mensajes recibidos + citas)
    const recentMessages = await prisma.message.findMany({
      where: {
        conversation: { userId },
        fromMe: false
      },
      orderBy: { timestamp: 'desc' },
      take: 5,
      include: {
        conversation: {
          select: { recipientName: true, recipientId: true }
        }
      }
    });

    const recentAppointments = await prisma.appointment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 3
    });

    // Combinar y ordenar actividad reciente
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
          ? `Pedido${a.total ? ` - $${a.total.toLocaleString()}` : ''}` 
          : `Cita ${a.status === 'pending' ? 'pendiente' : a.status}`,
        time: a.createdAt.toISOString(),
        timestamp: a.createdAt.getTime()
      }))
    ]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 5);

    // Tasa de conversión
    const conversionRate = totalConversations > 0 
      ? ((convertedCount / totalConversations) * 100).toFixed(1) 
      : '0';

    // Respuesta promedio (calcular basado en mensajes)
    // Simplificado: usar el conteo de mensajes de IA vs usuario
    const aiMessages = await prisma.message.count({
      where: { conversation: { userId }, fromMe: true }
    });
    const userMessages = await prisma.message.count({
      where: { conversation: { userId }, fromMe: false }
    });

    res.json({
      totalConversations,
      totalMessages,
      todayMessages,
      weekMessages,
      totalAppointments,
      pendingAppointments,
      totalClients,
      convertedCount,
      conversionRate,
      aiMessages,
      userMessages,
      weeklyActivity,
      recentActivity,
      stageStats: stageStats.map(s => ({ stage: s.stage || 'new', count: s._count.id }))
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

    const conversation = await prisma.conversation.findFirst({
      where: { id, userId }
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversación no encontrada' });
      return;
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { timestamp: 'asc' },
      take: limit
    });

    res.json({ messages });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener mensajes' });
  }
});

// PUT /api/conversations/:id/stage
router.put('/:id/stage', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { id } = req.params;
    const { stage } = req.body;

    const existing = await prisma.conversation.findFirst({
      where: { id, userId }
    });

    if (!existing) {
      res.status(404).json({ error: 'Conversación no encontrada' });
      return;
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { stage }
    });

    res.json({ conversation, message: 'Etapa actualizada' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al actualizar etapa' });
  }
});

// PUT /api/conversations/:id/ai-pause
router.put('/:id/ai-pause', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { id } = req.params;
    const { paused } = req.body;

    const existing = await prisma.conversation.findFirst({
      where: { id, userId }
    });

    if (!existing) {
      res.status(404).json({ error: 'Conversación no encontrada' });
      return;
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { aiPaused: paused }
    });

    res.json({ conversation, message: paused ? 'IA pausada' : 'IA reactivada' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

export default router;

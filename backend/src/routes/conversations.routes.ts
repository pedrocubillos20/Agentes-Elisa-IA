import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from './auth.routes';

const router = Router();

// Obtener todas las conversaciones
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { page = '1', limit = '20' } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where: { userId: user.id },
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: limitNum,
        include: {
          assistant: {
            select: { name: true }
          },
          _count: {
            select: { messages: true }
          }
        }
      }),
      prisma.conversation.count({ where: { userId: user.id } })
    ]);

    res.json({
      conversations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error obteniendo conversaciones:', error);
    res.status(500).json({ error: 'Error al obtener conversaciones' });
  }
});

// Obtener mensajes de una conversación
router.get('/:id/messages', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { page = '1', limit = '50' } = req.query;

    // Verificar que la conversación pertenece al usuario
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: user.id }
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id },
        orderBy: { timestamp: 'asc' },
        skip,
        take: limitNum
      }),
      prisma.message.count({ where: { conversationId: id } })
    ]);

    res.json({
      conversation,
      messages,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error obteniendo mensajes:', error);
    res.status(500).json({ error: 'Error al obtener mensajes' });
  }
});

// Obtener estadísticas de conversaciones
router.get('/stats', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    const [totalConversations, totalMessages, activeConversations] = await Promise.all([
      prisma.conversation.count({ where: { userId: user.id } }),
      prisma.message.count({ where: { userId: user.id } }),
      prisma.conversation.count({
        where: {
          userId: user.id,
          lastMessageAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Últimas 24 horas
          }
        }
      })
    ]);

    // Mensajes por día (últimos 7 días)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentMessages = await prisma.message.findMany({
      where: {
        userId: user.id,
        timestamp: { gte: sevenDaysAgo }
      },
      select: { timestamp: true }
    });

    // Agrupar por día
    const messagesByDay: Record<string, number> = {};
    recentMessages.forEach(msg => {
      const day = msg.timestamp.toISOString().split('T')[0];
      messagesByDay[day] = (messagesByDay[day] || 0) + 1;
    });

    res.json({
      totalConversations,
      totalMessages,
      activeConversations,
      messagesByDay
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// Eliminar conversación
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: user.id }
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    await prisma.conversation.delete({ where: { id } });

    res.json({ success: true, message: 'Conversación eliminada' });
  } catch (error) {
    console.error('Error eliminando conversación:', error);
    res.status(500).json({ error: 'Error al eliminar conversación' });
  }
});

export default router;

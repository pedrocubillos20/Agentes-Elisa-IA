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

// GET /api/conversations/stats
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

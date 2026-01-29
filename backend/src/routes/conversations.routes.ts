import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// ==========================================
// GET /api/conversations - Listar conversaciones
// ==========================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { stage } = req.query;

    const where: any = { userId };
    if (stage && stage !== 'all') {
      where.stage = stage;
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

    // Agregar último mensaje a cada conversación
    const formattedConversations = conversations.map(conv => ({
      ...conv,
      lastMessage: conv.messages[0]?.content || null,
      messages: undefined
    }));

    res.json({ conversations: formattedConversations });
  } catch (error) {
    console.error('Error listando conversaciones:', error);
    res.status(500).json({ error: 'Error al obtener conversaciones' });
  }
});

// ==========================================
// GET /api/conversations/stats - Estadísticas del embudo
// ==========================================
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

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
    console.error('Error obteniendo stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// ==========================================
// GET /api/conversations/:id - Obtener conversación
// ==========================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: { id, userId }
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    res.json({ conversation });
  } catch (error) {
    console.error('Error obteniendo conversación:', error);
    res.status(500).json({ error: 'Error al obtener conversación' });
  }
});

// ==========================================
// GET /api/conversations/:id/messages - Obtener mensajes
// ==========================================
router.get('/:id/messages', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;
    const { limit = 50 } = req.query;

    // Verificar que la conversación pertenece al usuario
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId }
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { timestamp: 'asc' },
      take: Number(limit)
    });

    res.json({ messages });
  } catch (error) {
    console.error('Error obteniendo mensajes:', error);
    res.status(500).json({ error: 'Error al obtener mensajes' });
  }
});

// ==========================================
// PUT /api/conversations/:id/stage - Actualizar etapa del embudo
// ==========================================
router.put('/:id/stage', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;
    const { stage } = req.body;

    // Verificar que la conversación pertenece al usuario
    const existing = await prisma.conversation.findFirst({
      where: { id, userId }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { stage }
    });

    res.json({ conversation, message: 'Etapa actualizada' });
  } catch (error) {
    console.error('Error actualizando etapa:', error);
    res.status(500).json({ error: 'Error al actualizar etapa' });
  }
});

// ==========================================
// PUT /api/conversations/:id/ai-pause - Pausar/Reanudar IA
// ==========================================
router.put('/:id/ai-pause', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;
    const { paused } = req.body;

    // Verificar que la conversación pertenece al usuario
    const existing = await prisma.conversation.findFirst({
      where: { id, userId }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { aiPaused: paused }
    });

    res.json({ 
      conversation, 
      message: paused ? 'IA pausada para esta conversación' : 'IA reactivada' 
    });
  } catch (error) {
    console.error('Error actualizando estado IA:', error);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

// ==========================================
// GET /api/conversations/by-stage/:stage - Obtener por etapa
// ==========================================
router.get('/by-stage/:stage', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { stage } = req.params;

    const conversations = await prisma.conversation.findMany({
      where: { userId, stage },
      orderBy: { updatedAt: 'desc' }
    });

    res.json({ conversations });
  } catch (error) {
    console.error('Error obteniendo por etapa:', error);
    res.status(500).json({ error: 'Error al obtener conversaciones' });
  }
});

// ==========================================
// POST /api/conversations/bulk-message - Mensaje masivo por etapa
// ==========================================
router.post('/bulk-message', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { stage, message } = req.body;

    if (!stage || !message) {
      return res.status(400).json({ error: 'Stage y message son requeridos' });
    }

    // Obtener conversaciones de la etapa
    const conversations = await prisma.conversation.findMany({
      where: { userId, stage }
    });

    if (conversations.length === 0) {
      return res.status(400).json({ error: 'No hay conversaciones en esta etapa' });
    }

    // Retornar los recipientes para que el frontend envíe los mensajes
    res.json({ 
      recipients: conversations.map(c => ({
        id: c.id,
        recipientId: c.recipientId,
        recipientName: c.recipientName
      })),
      count: conversations.length,
      message: `${conversations.length} destinatarios encontrados`
    });
  } catch (error) {
    console.error('Error en mensaje masivo:', error);
    res.status(500).json({ error: 'Error al procesar mensaje masivo' });
  }
});

export default router;

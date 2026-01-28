import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from './auth.routes';

const router = Router();

// GET / - Obtener todas las conversaciones
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const limit = parseInt(req.query.limit as string) || 50;
    
    const conversations = await prisma.conversation.findMany({
      where: { userId: user.id },
      orderBy: { lastMessageAt: 'desc' },
      take: limit,
      include: {
        _count: { select: { messages: true } }
      }
    });
    
    res.json({ conversations });
  } catch (error: any) {
    console.error('❌ Error obteniendo conversaciones:', error);
    res.status(500).json({ error: 'Error al obtener conversaciones' });
  }
});

// GET /:id - Obtener una conversación
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: user.id },
      include: {
        _count: { select: { messages: true } }
      }
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    
    res.json({ conversation });
  } catch (error: any) {
    console.error('❌ Error obteniendo conversación:', error);
    res.status(500).json({ error: 'Error al obtener conversación' });
  }
});

// GET /:id/messages - Obtener mensajes de una conversación
router.get('/:id/messages', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;
    
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    
    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { timestamp: 'asc' },
      take: limit
    });
    
    res.json({ messages });
  } catch (error: any) {
    console.error('❌ Error obteniendo mensajes:', error);
    res.status(500).json({ error: 'Error al obtener mensajes' });
  }
});

// DELETE /:id - Eliminar una conversación
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
    
    // Eliminar mensajes primero
    await prisma.message.deleteMany({
      where: { conversationId: id }
    });
    
    // Eliminar conversación
    await prisma.conversation.delete({
      where: { id }
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error eliminando conversación:', error);
    res.status(500).json({ error: 'Error al eliminar conversación' });
  }
});

export default router;

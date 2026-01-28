import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { wahaService } from '../services/wahaService';
import { authMiddleware } from './auth.routes';
import { pausedChats } from './whatsapp.routes';

const router = Router();

/**
 * ============================================
 * CONVERSATIONS ROUTES
 * ============================================
 */

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
    
    // Agregar estado de pausa usando el número del cliente
    const conversationsWithPause = conversations.map(conv => ({
      ...conv,
      aiPaused: pausedChats.get(conv.recipientId) || false
    }));
    
    res.json({ conversations: conversationsWithPause });
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
    
    const conversationWithPause = {
      ...conversation,
      aiPaused: pausedChats.get(conversation.recipientId) || false
    };
    
    res.json({ conversation: conversationWithPause });
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
    
    await prisma.message.deleteMany({
      where: { conversationId: id }
    });
    
    await prisma.conversation.delete({
      where: { id }
    });
    
    // Limpiar estado de pausa
    pausedChats.delete(conversation.recipientId);
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error eliminando conversación:', error);
    res.status(500).json({ error: 'Error al eliminar conversación' });
  }
});

/**
 * ============================================
 * PAUSAR / REANUDAR IA (desde dashboard)
 * ============================================
 */

// POST /:id/ai-pause - Pausar o reanudar IA (silencioso)
router.post('/:id/ai-pause', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { paused } = req.body;
    
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    
    // Usar el número del cliente para la pausa
    pausedChats.set(conversation.recipientId, paused);
    
    console.log(`${paused ? '⏸️' : '▶️'} IA ${paused ? 'pausada' : 'reanudada'} para ${conversation.recipientId}`);
    
    res.json({ success: true, aiPaused: paused });
  } catch (error: any) {
    console.error('❌ Error al cambiar estado de IA:', error);
    res.status(500).json({ error: 'Error al cambiar estado de IA' });
  }
});

/**
 * ============================================
 * ENVIAR MENSAJE MANUAL
 * ============================================
 */

// POST /:id/send - Enviar mensaje manual a una conversación
router.post('/:id/send', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { message } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'El mensaje es requerido' });
    }
    
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    
    const trimmedMessage = message.trim();
    
    // Comando "." para reanudar IA (silencioso)
    if (trimmedMessage === '.') {
      pausedChats.set(conversation.recipientId, false);
      console.log(`▶️ IA reanudada para ${conversation.recipientId}`);
      return res.json({ success: true, command: 'resume_ai' });
    }
    
    // Comando ".." para pausar IA (silencioso)
    if (trimmedMessage === '..') {
      pausedChats.set(conversation.recipientId, true);
      console.log(`⏸️ IA pausada para ${conversation.recipientId}`);
      return res.json({ success: true, command: 'pause_ai' });
    }
    
    // Enviar mensaje normal al cliente
    const chatId = `${conversation.recipientId}@c.us`;
    const result = await wahaService.sendTextMessage(chatId, message);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }
    
    // Guardar mensaje en BD
    await prisma.message.create({
      data: {
        conversationId: id,
        userId: user.id,
        role: 'human',
        content: message,
        fromMe: true
      }
    });
    
    await prisma.conversation.update({
      where: { id },
      data: {
        lastMessage: message,
        lastMessageAt: new Date()
      }
    });
    
    res.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    console.error('❌ Error enviando mensaje manual:', error);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { wahaService } from '../services/wahaService';
import { authMiddleware } from './auth.routes';
import { pausedConversations } from './whatsapp.routes';

const router = Router();

/**
 * ============================================
 * CONVERSATIONS ROUTES
 * ============================================
 * 
 * Endpoints para gestionar conversaciones
 * Incluye pausar/reanudar IA y enviar mensajes manuales
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
    
    // Agregar estado de pausa desde memoria
    const conversationsWithPause = conversations.map(conv => ({
      ...conv,
      aiPaused: pausedConversations.get(conv.id) || false
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
    
    // Agregar estado de pausa
    const conversationWithPause = {
      ...conversation,
      aiPaused: pausedConversations.get(id) || false
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
    
    // Verificar que la conversación pertenece al usuario
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
    
    // Verificar que la conversación pertenece al usuario
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
    
    // Limpiar estado de pausa
    pausedConversations.delete(id);
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error eliminando conversación:', error);
    res.status(500).json({ error: 'Error al eliminar conversación' });
  }
});

/**
 * ============================================
 * PAUSAR / REANUDAR IA
 * ============================================
 */

// POST /:id/ai-pause - Pausar o reanudar IA para una conversación
router.post('/:id/ai-pause', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { paused } = req.body;
    
    // Verificar que la conversación pertenece al usuario
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    
    // Actualizar estado de pausa en memoria
    pausedConversations.set(id, paused);
    
    console.log(`${paused ? '⏸️' : '▶️'} IA ${paused ? 'pausada' : 'reanudada'} para conversación ${id}`);
    
    // Enviar notificación al cliente por WhatsApp
    const chatId = `${conversation.recipientId}@c.us`;
    
    if (paused) {
      await wahaService.sendTextMessage(
        chatId,
        '⏸️ *Modo Humano Activado*\n\nUn agente tomará el control de esta conversación.'
      );
    } else {
      await wahaService.sendTextMessage(
        chatId,
        '▶️ *Asistente Automático Activado*\n\n¡Estoy de vuelta! ¿En qué puedo ayudarte? 😊'
      );
    }
    
    // Guardar mensaje del sistema
    await prisma.message.create({
      data: {
        conversationId: id,
        userId: user.id,
        role: 'system',
        content: paused 
          ? '⏸️ IA pausada desde el dashboard' 
          : '▶️ IA reanudada desde el dashboard',
        fromMe: true
      }
    });
    
    res.json({ success: true, aiPaused: paused });
  } catch (error: any) {
    console.error('❌ Error al cambiar estado de IA:', error);
    res.status(500).json({ error: 'Error al cambiar estado de IA' });
  }
});

/**
 * ============================================
 * ENVIAR MENSAJE MANUAL (COMO HUMANO)
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
    
    // Verificar que la conversación pertenece al usuario
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    
    // Verificar comandos especiales
    const trimmedMessage = message.trim();
    
    // Comando "." para reanudar IA
    if (trimmedMessage === '.') {
      pausedConversations.set(id, false);
      
      const chatId = `${conversation.recipientId}@c.us`;
      await wahaService.sendTextMessage(
        chatId,
        '▶️ *Asistente Automático Activado*\n\n¡Estoy de vuelta! ¿En qué puedo ayudarte? 😊'
      );
      
      await prisma.message.create({
        data: {
          conversationId: id,
          userId: user.id,
          role: 'system',
          content: '▶️ IA reanudada',
          fromMe: true
        }
      });
      
      return res.json({ success: true, command: 'resume_ai' });
    }
    
    // Enviar mensaje normal
    const chatId = `${conversation.recipientId}@c.us`;
    const result = await wahaService.sendTextMessage(chatId, message);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }
    
    // Guardar mensaje en BD (como "human" para diferenciarlo de "assistant")
    await prisma.message.create({
      data: {
        conversationId: id,
        userId: user.id,
        role: 'human',
        content: message,
        fromMe: true
      }
    });
    
    // Actualizar último mensaje de la conversación
    await prisma.conversation.update({
      where: { id },
      data: {
        lastMessage: message,
        lastMessageAt: new Date()
      }
    });
    
    console.log(`📤 Mensaje manual enviado a ${conversation.recipientId}`);
    
    res.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    console.error('❌ Error enviando mensaje manual:', error);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

export default router;

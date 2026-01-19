import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Obtener todas las conversaciones del usuario
router.get('/conversations', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    
    const conversations = await prisma.conversation.findMany({
      where: { 
        assistant: { userId } 
      },
      orderBy: { updatedAt: 'desc' },
      include: { 
        messages: { 
          orderBy: { createdAt: 'desc' }, 
          take: 1 
        }, 
        assistant: { 
          select: { name: true } 
        },
        _count: {
          select: { messages: true }
        }
      }
    });
    
    res.json(conversations);
  } catch (error: any) {
    console.error('Error obteniendo conversaciones:', error);
    res.status(500).json({ error: 'Error al obtener conversaciones' });
  }
});

// Obtener una conversación específica con todos sus mensajes
router.get('/conversations/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    
    const conversation = await prisma.conversation.findFirst({
      where: { 
        id,
        assistant: { userId }
      },
      include: { 
        messages: { 
          orderBy: { createdAt: 'asc' } 
        }, 
        assistant: { 
          select: { id: true, name: true } 
        } 
      }
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    
    res.json(conversation);
  } catch (error: any) {
    console.error('Error obteniendo conversación:', error);
    res.status(500).json({ error: 'Error al obtener conversación' });
  }
});

// Cerrar/archivar conversación
router.put('/conversations/:id/close', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    
    const conversation = await prisma.conversation.findFirst({
      where: { 
        id,
        assistant: { userId }
      }
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    
    const updated = await prisma.conversation.update({
      where: { id },
      data: { status: 'CLOSED' }
    });
    
    res.json(updated);
  } catch (error: any) {
    console.error('Error cerrando conversación:', error);
    res.status(500).json({ error: 'Error al cerrar conversación' });
  }
});

// Eliminar conversación
router.delete('/conversations/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    
    const conversation = await prisma.conversation.findFirst({
      where: { 
        id,
        assistant: { userId }
      }
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    
    await prisma.conversation.delete({ where: { id } });
    
    res.json({ message: 'Conversación eliminada' });
  } catch (error: any) {
    console.error('Error eliminando conversación:', error);
    res.status(500).json({ error: 'Error al eliminar conversación' });
  }
});

// Obtener estadísticas de chat
router.get('/stats', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    
    const [totalConversations, totalMessages, activeConversations] = await Promise.all([
      prisma.conversation.count({
        where: { assistant: { userId } }
      }),
      prisma.message.count({
        where: { conversation: { assistant: { userId } } }
      }),
      prisma.conversation.count({
        where: { assistant: { userId }, status: 'ACTIVE' }
      })
    ]);
    
    // Conversaciones de hoy
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const conversationsToday = await prisma.conversation.count({
      where: {
        assistant: { userId },
        createdAt: { gte: today }
      }
    });
    
    res.json({
      totalConversations,
      totalMessages,
      activeConversations,
      conversationsToday,
      averageMessagesPerConversation: totalConversations > 0 
        ? Math.round(totalMessages / totalConversations) 
        : 0
    });
  } catch (error: any) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Obtener todos los asistentes del usuario
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const assistants = await prisma.assistant.findMany({
      where: { userId: req.userId },
      include: {
        business: {
          select: {
            id: true,
            name: true,
          }
        },
        _count: {
          select: { conversations: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ assistants });
  } catch (error) {
    console.error('Error obteniendo asistentes:', error);
    res.status(500).json({ error: 'Error al obtener asistentes' });
  }
});

// Obtener un asistente específico
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const assistant = await prisma.assistant.findFirst({
      where: { 
        id,
        userId: req.userId 
      },
      include: {
        business: true,
        conversations: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            messages: {
              take: 5,
              orderBy: { createdAt: 'desc' }
            }
          }
        }
      },
    });

    if (!assistant) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }

    res.json({ assistant });
  } catch (error) {
    console.error('Error obteniendo asistente:', error);
    res.status(500).json({ error: 'Error al obtener asistente' });
  }
});

// Crear asistente
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { name, welcomeMessage, tone, businessId } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'El nombre del asistente es requerido' });
    }

    // Verificar límites del plan
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: {
        assistants: true,
        businesses: true,
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Límites por plan
    const planLimits: Record<string, number> = {
      FREE: 1,
      STARTER: 1,
      PRO: 3,
      BUSINESS: 10,
      AGENCY: 999,
    };

    const maxAssistants = planLimits[user.plan] || 1;

    if (user.assistants.length >= maxAssistants) {
      return res.status(403).json({ 
        error: `Has alcanzado el límite de asistentes para tu plan (${maxAssistants}). Actualiza tu plan para crear más.`,
        code: 'ASSISTANT_LIMIT_REACHED'
      });
    }

    // Si no se especifica businessId, usar el primero o crear uno
    let targetBusinessId = businessId;
    
    if (!targetBusinessId) {
      if (user.businesses.length > 0) {
        targetBusinessId = user.businesses[0].id;
      } else {
        // Crear negocio por defecto
        const newBusiness = await prisma.business.create({
          data: {
            userId: req.userId!,
            name: 'Mi Negocio',
          }
        });
        targetBusinessId = newBusiness.id;
      }
    }

    // Generar API key única
    const publicApiKey = `elisa_${uuidv4().replace(/-/g, '')}`;

    const assistant = await prisma.assistant.create({
      data: {
        userId: req.userId!,
        businessId: targetBusinessId,
        name,
        welcomeMessage: welcomeMessage || '¡Hola! ¿En qué puedo ayudarte hoy?',
        tone: tone || 'PROFESSIONAL',
        publicApiKey,
        isActive: true,
        status: 'ACTIVE',
      },
    });

    console.log(`✅ Asistente creado: ${assistant.name} (${assistant.publicApiKey})`);

    res.status(201).json({ 
      message: 'Asistente creado exitosamente',
      assistant 
    });
  } catch (error) {
    console.error('Error creando asistente:', error);
    res.status(500).json({ error: 'Error al crear asistente' });
  }
});

// Actualizar asistente
router.put('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, welcomeMessage, tone, primaryColor, systemPrompt } = req.body;

    const existingAssistant = await prisma.assistant.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existingAssistant) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }

    const assistant = await prisma.assistant.update({
      where: { id },
      data: {
        name,
        welcomeMessage,
        tone,
        primaryColor,
        systemPrompt,
      },
    });

    res.json({ 
      message: 'Asistente actualizado',
      assistant 
    });
  } catch (error) {
    console.error('Error actualizando asistente:', error);
    res.status(500).json({ error: 'Error al actualizar asistente' });
  }
});

// Toggle activar/desactivar asistente
router.patch('/:id/toggle', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingAssistant = await prisma.assistant.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existingAssistant) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }

    const assistant = await prisma.assistant.update({
      where: { id },
      data: {
        isActive: !existingAssistant.isActive,
        status: !existingAssistant.isActive ? 'ACTIVE' : 'INACTIVE',
      },
    });

    res.json({ 
      message: `Asistente ${assistant.isActive ? 'activado' : 'desactivado'}`,
      assistant 
    });
  } catch (error) {
    console.error('Error toggling asistente:', error);
    res.status(500).json({ error: 'Error al cambiar estado del asistente' });
  }
});

// Eliminar asistente
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingAssistant = await prisma.assistant.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existingAssistant) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }

    await prisma.assistant.delete({
      where: { id },
    });

    console.log(`🗑️ Asistente eliminado: ${existingAssistant.name}`);

    res.json({ message: 'Asistente eliminado' });
  } catch (error) {
    console.error('Error eliminando asistente:', error);
    res.status(500).json({ error: 'Error al eliminar asistente' });
  }
});

// Regenerar API key
router.post('/:id/regenerate-key', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingAssistant = await prisma.assistant.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existingAssistant) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }

    const newApiKey = `elisa_${uuidv4().replace(/-/g, '')}`;

    const assistant = await prisma.assistant.update({
      where: { id },
      data: { publicApiKey: newApiKey },
    });

    res.json({ 
      message: 'API Key regenerada',
      publicApiKey: assistant.publicApiKey 
    });
  } catch (error) {
    console.error('Error regenerando API key:', error);
    res.status(500).json({ error: 'Error al regenerar API key' });
  }
});

// Obtener estadísticas del asistente
router.get('/:id/stats', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingAssistant = await prisma.assistant.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existingAssistant) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }

    // Estadísticas básicas
    const totalConversations = await prisma.conversation.count({
      where: { assistantId: id }
    });

    const totalMessages = await prisma.message.count({
      where: { conversation: { assistantId: id } }
    });

    const activeConversations = await prisma.conversation.count({
      where: { 
        assistantId: id,
        status: 'ACTIVE'
      }
    });

    const leads = await prisma.conversation.count({
      where: { 
        assistantId: id,
        isLead: true
      }
    });

    res.json({
      stats: {
        totalConversations,
        totalMessages,
        activeConversations,
        leads,
      }
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

export default router;

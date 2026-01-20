import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from './auth.routes';

const router = Router();

// Obtener todos los asistentes del usuario
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    const assistants = await prisma.assistant.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ assistants });
  } catch (error) {
    console.error('Error obteniendo asistentes:', error);
    res.status(500).json({ error: 'Error al obtener asistentes' });
  }
});

// Obtener asistente activo
router.get('/active', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    const assistant = await prisma.assistant.findFirst({
      where: { userId: user.id, isActive: true }
    });

    res.json({ assistant });
  } catch (error) {
    console.error('Error obteniendo asistente activo:', error);
    res.status(500).json({ error: 'Error al obtener asistente' });
  }
});

// Obtener un asistente por ID
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;

    const assistant = await prisma.assistant.findFirst({
      where: { id, userId: user.id }
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
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { 
      name, 
      personality, 
      context, 
      businessInfo, 
      instructions, 
      welcomeMessage,
      model,
      temperature,
      maxTokens
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }

    // Si es el primer asistente, activarlo automáticamente
    const existingCount = await prisma.assistant.count({
      where: { userId: user.id }
    });

    // Desactivar otros si este será activo
    if (existingCount === 0) {
      await prisma.assistant.updateMany({
        where: { userId: user.id },
        data: { isActive: false }
      });
    }

    const assistant = await prisma.assistant.create({
      data: {
        userId: user.id,
        name,
        personality,
        context,
        businessInfo,
        instructions,
        welcomeMessage,
        model: model || 'gpt-3.5-turbo',
        temperature: temperature || 0.7,
        maxTokens: maxTokens || 500,
        isActive: existingCount === 0
      }
    });

    console.log(`✅ Asistente creado: ${name} para ${user.email}`);

    res.json({ success: true, assistant });
  } catch (error) {
    console.error('Error creando asistente:', error);
    res.status(500).json({ error: 'Error al crear asistente' });
  }
});

// Actualizar asistente
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { 
      name, 
      personality, 
      context, 
      businessInfo, 
      instructions, 
      welcomeMessage,
      model,
      temperature,
      maxTokens,
      isActive
    } = req.body;

    // Verificar que el asistente pertenece al usuario
    const existing = await prisma.assistant.findFirst({
      where: { id, userId: user.id }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }

    // Si se activa este, desactivar los demás
    if (isActive === true) {
      await prisma.assistant.updateMany({
        where: { userId: user.id, id: { not: id } },
        data: { isActive: false }
      });
    }

    const assistant = await prisma.assistant.update({
      where: { id },
      data: {
        name,
        personality,
        context,
        businessInfo,
        instructions,
        welcomeMessage,
        model,
        temperature,
        maxTokens,
        isActive
      }
    });

    console.log(`✅ Asistente actualizado: ${assistant.name}`);

    res.json({ success: true, assistant });
  } catch (error) {
    console.error('Error actualizando asistente:', error);
    res.status(500).json({ error: 'Error al actualizar asistente' });
  }
});

// Activar asistente
router.post('/:id/activate', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;

    // Verificar que existe
    const existing = await prisma.assistant.findFirst({
      where: { id, userId: user.id }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }

    // Desactivar todos
    await prisma.assistant.updateMany({
      where: { userId: user.id },
      data: { isActive: false }
    });

    // Activar este
    const assistant = await prisma.assistant.update({
      where: { id },
      data: { isActive: true }
    });

    console.log(`✅ Asistente activado: ${assistant.name}`);

    res.json({ success: true, assistant });
  } catch (error) {
    console.error('Error activando asistente:', error);
    res.status(500).json({ error: 'Error al activar asistente' });
  }
});

// Eliminar asistente
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;

    // Verificar que existe
    const existing = await prisma.assistant.findFirst({
      where: { id, userId: user.id }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }

    await prisma.assistant.delete({ where: { id } });

    console.log(`🗑️ Asistente eliminado: ${existing.name}`);

    res.json({ success: true, message: 'Asistente eliminado' });
  } catch (error) {
    console.error('Error eliminando asistente:', error);
    res.status(500).json({ error: 'Error al eliminar asistente' });
  }
});

// Obtener información del plan
router.get('/plan-info', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    const assistantCount = await prisma.assistant.count({
      where: { userId: user.id }
    });

    const conversationCount = await prisma.conversation.count({
      where: { userId: user.id }
    });

    const messageCount = await prisma.message.count({
      where: { userId: user.id }
    });

    // Límites según plan
    const limits: Record<string, any> = {
      FREE: { assistants: 1, conversations: 50, messages: 500 },
      BASIC: { assistants: 3, conversations: 500, messages: 5000 },
      PRO: { assistants: 10, conversations: -1, messages: -1 },
      ENTERPRISE: { assistants: -1, conversations: -1, messages: -1 }
    };

    const userLimits = limits[user.plan] || limits.FREE;

    res.json({
      plan: user.plan,
      trialEndsAt: user.trialEndsAt,
      usage: {
        assistants: assistantCount,
        conversations: conversationCount,
        messages: messageCount
      },
      limits: userLimits
    });
  } catch (error) {
    console.error('Error obteniendo info del plan:', error);
    res.status(500).json({ error: 'Error al obtener información' });
  }
});

export default router;

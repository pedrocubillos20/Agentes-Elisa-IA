import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key';

const authenticate = async (req: Request, res: Response, next: Function) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    (req as any).userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// Límites por plan - usando los valores del enum
const PLAN_LIMITS: Record<string, number> = {
  FREE: 1,
  EMPRENDEDORES: 1,
  NEGOCIOS: 3,
  BUSINESS: 5,
  MARCA_BLANCA: 999,
};

// Obtener todos los asistentes del usuario
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const assistants = await prisma.assistant.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { conversations: true }
        }
      }
    });
    res.json(assistants);
  } catch (error: any) {
    console.error('Error obteniendo asistentes:', error?.message || error);
    res.status(500).json({ error: 'Error al obtener asistentes' });
  }
});

// Obtener información del plan
router.get('/plan-info', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { 
        assistants: true,
        business: true,
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // El plan viene como string del enum
    const plan = user.plan || 'FREE';
    const maxAssistants = PLAN_LIMITS[plan] || 1;
    
    // Verificar si el trial expiró
    const trialExpired = user.trialEndsAt ? new Date() > new Date(user.trialEndsAt) : false;
    
    res.json({
      plan,
      currentAssistants: user.assistants.length,
      maxAssistants,
      canCreate: user.assistants.length < maxAssistants,
      hasApiKey: !!user.openaiApiKey,
      whatsappConnected: user.whatsappConnected,
      whatsappPhone: user.whatsappPhone,
      trialEndsAt: user.trialEndsAt,
      trialExpired,
      hasBusiness: !!user.business,
    });
  } catch (error: any) {
    console.error('Error obteniendo plan-info:', error?.message || error);
    res.status(500).json({ error: 'Error al obtener información del plan' });
  }
});

// Crear nuevo asistente
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { name, description, tone } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { assistants: true }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const plan = user.plan || 'FREE';
    const maxAssistants = PLAN_LIMITS[plan] || 1;
    
    if (user.assistants.length >= maxAssistants) {
      return res.status(400).json({ 
        error: `Tu plan ${plan} permite máximo ${maxAssistants} chatbot(s). Actualiza tu plan para crear más.` 
      });
    }
    
    // Desactivar otros asistentes (solo uno activo a la vez)
    await prisma.assistant.updateMany({
      where: { userId },
      data: { isActive: false }
    });
    
    const assistant = await prisma.assistant.create({
      data: {
        userId,
        name: name || 'Mi Asistente',
        description: description || '',
        tone: tone || 'FRIENDLY',
        isActive: true,
      }
    });
    
    console.log(`✅ Asistente creado: ${assistant.name} para usuario ${userId}`);
    
    res.json(assistant);
  } catch (error: any) {
    console.error('Error creando asistente:', error?.message || error);
    res.status(500).json({ error: 'Error al crear asistente' });
  }
});

// Obtener un asistente específico
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    
    const assistant = await prisma.assistant.findFirst({
      where: { id, userId },
      include: {
        conversations: {
          orderBy: { updatedAt: 'desc' },
          take: 10,
          include: {
            _count: {
              select: { messages: true }
            }
          }
        }
      }
    });
    
    if (!assistant) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }
    
    res.json(assistant);
  } catch (error: any) {
    console.error('Error obteniendo asistente:', error?.message || error);
    res.status(500).json({ error: 'Error al obtener asistente' });
  }
});

// Actualizar asistente
router.put('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    const { name, description, tone, contextJson, isActive } = req.body;
    
    const assistant = await prisma.assistant.findFirst({
      where: { id, userId }
    });
    
    if (!assistant) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }
    
    // Si se activa este asistente, desactivar los demás
    if (isActive === true) {
      await prisma.assistant.updateMany({
        where: { userId, id: { not: id } },
        data: { isActive: false }
      });
    }
    
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (tone !== undefined) updateData.tone = tone;
    if (contextJson !== undefined) updateData.contextJson = contextJson;
    if (isActive !== undefined) updateData.isActive = isActive;
    
    const updated = await prisma.assistant.update({
      where: { id },
      data: updateData
    });
    
    console.log(`✅ Asistente actualizado: ${updated.name}`);
    
    res.json(updated);
  } catch (error: any) {
    console.error('Error actualizando asistente:', error?.message || error);
    res.status(500).json({ error: 'Error al actualizar asistente' });
  }
});

// Eliminar asistente
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    
    const assistant = await prisma.assistant.findFirst({
      where: { id, userId }
    });
    
    if (!assistant) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }
    
    await prisma.assistant.delete({ where: { id } });
    
    console.log(`✅ Asistente eliminado: ${assistant.name}`);
    
    res.json({ message: 'Asistente eliminado correctamente' });
  } catch (error: any) {
    console.error('Error eliminando asistente:', error?.message || error);
    res.status(500).json({ error: 'Error al eliminar asistente' });
  }
});

// Actualizar contexto del asistente
router.post('/:id/context', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    const { contextJson } = req.body;
    
    const assistant = await prisma.assistant.findFirst({
      where: { id, userId }
    });
    
    if (!assistant) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }
    
    // Validar que sea JSON válido
    if (contextJson) {
      try {
        JSON.parse(contextJson);
      } catch (e) {
        return res.status(400).json({ error: 'El contexto debe ser un JSON válido' });
      }
    }
    
    const updated = await prisma.assistant.update({
      where: { id },
      data: { contextJson }
    });
    
    console.log(`✅ Contexto actualizado para asistente: ${updated.name}`);
    
    res.json(updated);
  } catch (error: any) {
    console.error('Error actualizando contexto:', error?.message || error);
    res.status(500).json({ error: 'Error al actualizar contexto' });
  }
});

// Activar asistente
router.post('/:id/activate', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    
    // Verificar que el asistente existe
    const assistant = await prisma.assistant.findFirst({
      where: { id, userId }
    });
    
    if (!assistant) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }
    
    // Desactivar todos los demás
    await prisma.assistant.updateMany({
      where: { userId },
      data: { isActive: false }
    });
    
    // Activar este
    const updated = await prisma.assistant.update({
      where: { id },
      data: { isActive: true }
    });
    
    console.log(`✅ Asistente activado: ${updated.name}`);
    
    res.json(updated);
  } catch (error: any) {
    console.error('Error activando asistente:', error?.message || error);
    res.status(500).json({ error: 'Error al activar asistente' });
  }
});

// Obtener conversaciones del asistente
router.get('/:id/conversations', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    
    const assistant = await prisma.assistant.findFirst({
      where: { id, userId }
    });
    
    if (!assistant) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }
    
    const conversations = await prisma.conversation.findMany({
      where: { assistantId: id },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: { messages: true }
        }
      }
    });
    
    res.json(conversations);
  } catch (error: any) {
    console.error('Error obteniendo conversaciones:', error?.message || error);
    res.status(500).json({ error: 'Error al obtener conversaciones' });
  }
});

export default router;

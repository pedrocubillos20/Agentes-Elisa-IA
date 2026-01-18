import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key';

// Límites por plan
const PLAN_LIMITS: Record<string, number> = {
  FREE: 0,
  EMPRENDEDORES: 1,
  NEGOCIOS: 3,
  BUSINESS: 5,
  MARCA_BLANCA: 999,
};

const authenticate = async (req: Request, res: Response, next: Function) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    (req as any).userId = decoded.userId;
    (req as any).user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// Listar asistentes
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const assistants = await prisma.assistant.findMany({
      where: { userId: (req as any).userId },
      include: {
        business: true,
        _count: { select: { conversations: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ assistants });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener asistentes' });
  }
});

// Obtener un asistente
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const assistant = await prisma.assistant.findFirst({
      where: { id: req.params.id, userId: (req as any).userId },
      include: {
        business: { include: { products: true, faqs: true } },
        conversations: { take: 10, orderBy: { createdAt: 'desc' } }
      }
    });
    if (!assistant) return res.status(404).json({ error: 'Asistente no encontrado' });
    res.json({ assistant });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener asistente' });
  }
});

// Crear asistente
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { name, welcomeMessage, tone, businessId } = req.body;

    if (!name) return res.status(400).json({ error: 'Nombre requerido' });

    // Verificar límite del plan
    const currentCount = await prisma.assistant.count({ where: { userId: user.id } });
    const limit = PLAN_LIMITS[user.plan] || 0;

    if (currentCount >= limit) {
      return res.status(403).json({ 
        error: `Has alcanzado el límite de ${limit} chatbot(s) para tu plan ${user.plan}. Actualiza tu plan para crear más.` 
      });
    }

    // Obtener o crear negocio
    let business;
    if (businessId) {
      business = await prisma.business.findFirst({ where: { id: businessId, userId: user.id } });
    }
    if (!business) {
      business = await prisma.business.create({
        data: { userId: user.id, name: 'Mi Negocio' }
      });
    }

    // Generar API Key única
    const publicApiKey = `elisa_${uuidv4().replace(/-/g, '')}`;

    const assistant = await prisma.assistant.create({
      data: {
        userId: user.id,
        businessId: business.id,
        name,
        welcomeMessage: welcomeMessage || '¡Hola! ¿En qué puedo ayudarte?',
        tone: tone || 'PROFESSIONAL',
        publicApiKey,
        isActive: true,
        status: 'ACTIVE',
      },
      include: { business: true }
    });

    res.status(201).json({ message: 'Chatbot creado', assistant });
  } catch (error) {
    console.error('Error creando asistente:', error);
    res.status(500).json({ error: 'Error al crear chatbot' });
  }
});

// Actualizar asistente
router.put('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { name, welcomeMessage, tone, systemPrompt, primaryColor } = req.body;
    const assistant = await prisma.assistant.updateMany({
      where: { id: req.params.id, userId: (req as any).userId },
      data: { name, welcomeMessage, tone, systemPrompt, primaryColor }
    });
    if (assistant.count === 0) return res.status(404).json({ error: 'Asistente no encontrado' });
    res.json({ message: 'Asistente actualizado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

// Activar/Desactivar
router.patch('/:id/toggle', authenticate, async (req: Request, res: Response) => {
  try {
    const assistant = await prisma.assistant.findFirst({
      where: { id: req.params.id, userId: (req as any).userId }
    });
    if (!assistant) return res.status(404).json({ error: 'Asistente no encontrado' });

    await prisma.assistant.update({
      where: { id: assistant.id },
      data: { 
        isActive: !assistant.isActive,
        status: !assistant.isActive ? 'ACTIVE' : 'INACTIVE'
      }
    });

    res.json({ message: assistant.isActive ? 'Desactivado' : 'Activado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al cambiar estado' });
  }
});

// Eliminar
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    await prisma.assistant.deleteMany({ where: { id: req.params.id, userId: (req as any).userId } });
    res.json({ message: 'Asistente eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// Regenerar API Key
router.post('/:id/regenerate-key', authenticate, async (req: Request, res: Response) => {
  try {
    const newKey = `elisa_${uuidv4().replace(/-/g, '')}`;
    await prisma.assistant.updateMany({
      where: { id: req.params.id, userId: (req as any).userId },
      data: { publicApiKey: newKey }
    });
    res.json({ publicApiKey: newKey });
  } catch (error) {
    res.status(500).json({ error: 'Error al regenerar' });
  }
});

// Estadísticas
router.get('/:id/stats', authenticate, async (req: Request, res: Response) => {
  try {
    const assistant = await prisma.assistant.findFirst({
      where: { id: req.params.id, userId: (req as any).userId }
    });
    if (!assistant) return res.status(404).json({ error: 'No encontrado' });

    const [totalConversations, totalMessages, activeConversations, leads] = await Promise.all([
      prisma.conversation.count({ where: { assistantId: assistant.id } }),
      prisma.message.count({ where: { conversation: { assistantId: assistant.id } } }),
      prisma.conversation.count({ where: { assistantId: assistant.id, status: 'ACTIVE' } }),
      prisma.conversation.count({ where: { assistantId: assistant.id, isLead: true } }),
    ]);

    res.json({ stats: { totalConversations, totalMessages, activeConversations, leads } });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// Guardar contexto JSON
router.put('/:id/context', authenticate, async (req: Request, res: Response) => {
  try {
    const { contextJson } = req.body;
    
    // Validar que es JSON válido si no está vacío
    if (contextJson && contextJson.trim()) {
      try {
        JSON.parse(contextJson);
      } catch {
        return res.status(400).json({ error: 'JSON inválido' });
      }
    }
    
    const assistant = await prisma.assistant.updateMany({
      where: { id: req.params.id, userId: (req as any).userId },
      data: { contextJson: contextJson || null }
    });
    
    if (assistant.count === 0) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }
    
    console.log(`🧠 Contexto actualizado para asistente ${req.params.id}`);
    res.json({ message: 'Contexto guardado exitosamente' });
  } catch (error) {
    console.error('Error guardando contexto:', error);
    res.status(500).json({ error: 'Error al guardar contexto' });
  }
});

export default router;

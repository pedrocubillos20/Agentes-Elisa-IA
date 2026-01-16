import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

// ==========================================
// OBTENER CONVERSACIONES
// ==========================================
router.get('/', async (req, res, next) => {
  try {
    const { assistantId, status, channel, limit = 50, offset = 0 } = req.query;

    // Obtener asistentes del usuario para filtrar
    const userAssistants = await prisma.assistant.findMany({
      where: { userId: req.userId },
      select: { id: true },
    });

    const assistantIds = userAssistants.map(a => a.id);

    const conversations = await prisma.conversation.findMany({
      where: {
        assistantId: assistantId 
          ? String(assistantId) 
          : { in: assistantIds },
        ...(status && { status: status as any }),
        ...(channel && { channel: channel as any }),
      },
      include: {
        assistant: {
          select: { id: true, name: true },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    });

    const total = await prisma.conversation.count({
      where: {
        assistantId: assistantId 
          ? String(assistantId) 
          : { in: assistantIds },
      },
    });

    res.json({
      conversations,
      total,
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// OBTENER UNA CONVERSACIÓN CON MENSAJES
// ==========================================
router.get('/:id', async (req, res, next) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        assistant: {
          include: {
            business: { select: { name: true } },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    // Verificar que pertenece al usuario
    if (conversation.assistant.userId !== req.userId) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    res.json(conversation);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// ACTUALIZAR ESTADO DE CONVERSACIÓN
// ==========================================
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!['ACTIVE', 'RESOLVED', 'ESCALATED', 'ABANDONED'].includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { assistant: true },
    });

    if (!conversation || conversation.assistant.userId !== req.userId) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    const updated = await prisma.conversation.update({
      where: { id: req.params.id },
      data: {
        status,
        ...(status !== 'ACTIVE' && { endedAt: new Date() }),
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// AGREGAR NOTA INTERNA
// ==========================================
router.post('/:id/notes', async (req, res, next) => {
  try {
    const { note } = req.body;

    const updated = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { internalNotes: note },
    });

    res.json({ message: 'Nota guardada', internalNotes: updated.internalNotes });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// MARCAR COMO LEAD
// ==========================================
router.post('/:id/mark-lead', async (req, res, next) => {
  try {
    const { leadScore } = req.body;

    const updated = await prisma.conversation.update({
      where: { id: req.params.id },
      data: {
        isLead: true,
        leadScore: leadScore || 5,
      },
    });

    res.json({ message: 'Marcado como lead', isLead: true });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// OBTENER ESTADÍSTICAS
// ==========================================
router.get('/stats/summary', async (req, res, next) => {
  try {
    const { assistantId, days = 7 } = req.query;

    const userAssistants = await prisma.assistant.findMany({
      where: { userId: req.userId },
      select: { id: true },
    });

    const assistantIds = assistantId 
      ? [String(assistantId)] 
      : userAssistants.map(a => a.id);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    const [total, resolved, escalated, active, leads] = await Promise.all([
      prisma.conversation.count({
        where: {
          assistantId: { in: assistantIds },
          startedAt: { gte: startDate },
        },
      }),
      prisma.conversation.count({
        where: {
          assistantId: { in: assistantIds },
          status: 'RESOLVED',
          startedAt: { gte: startDate },
        },
      }),
      prisma.conversation.count({
        where: {
          assistantId: { in: assistantIds },
          status: 'ESCALATED',
          startedAt: { gte: startDate },
        },
      }),
      prisma.conversation.count({
        where: {
          assistantId: { in: assistantIds },
          status: 'ACTIVE',
        },
      }),
      prisma.conversation.count({
        where: {
          assistantId: { in: assistantIds },
          isLead: true,
          startedAt: { gte: startDate },
        },
      }),
    ]);

    res.json({
      total,
      resolved,
      escalated,
      active,
      leads,
      resolutionRate: total > 0 ? Math.round((resolved / total) * 100) : 0,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { PrismaClient } from '@prisma/client';
import { generateSystemPrompt } from '../services/openai.service';

const router = Router();
const prisma = new PrismaClient();

// Todas las rutas requieren autenticación y rol admin
router.use(authenticate);
router.use(requireAdmin);

// ==========================================
// DASHBOARD ADMIN - ESTADÍSTICAS
// ==========================================
router.get('/stats', async (req, res, next) => {
  try {
    const [
      totalUsers,
      activeUsers,
      totalBusinesses,
      pendingOnboarding,
      totalAssistants,
      activeAssistants,
      totalConversations,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true, apiKeyConnected: true } }),
      prisma.business.count(),
      prisma.business.count({ where: { onboardingStatus: { in: ['PENDING', 'IN_PROGRESS'] } } }),
      prisma.assistant.count(),
      prisma.assistant.count({ where: { isActive: true } }),
      prisma.conversation.count(),
    ]);

    res.json({
      users: { total: totalUsers, active: activeUsers },
      businesses: { total: totalBusinesses, pendingOnboarding },
      assistants: { total: totalAssistants, active: activeAssistants },
      conversations: { total: totalConversations },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// LISTAR SOLICITUDES DE ONBOARDING
// ==========================================
router.get('/onboarding-requests', async (req, res, next) => {
  try {
    const { status, limit = 20, offset = 0 } = req.query;

    const businesses = await prisma.business.findMany({
      where: {
        ...(status && { onboardingStatus: status as any }),
      },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, plan: true, apiKeyConnected: true },
        },
        products: { take: 5 },
        faqs: { take: 5 },
        assistants: { take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    });

    const total = await prisma.business.count({
      where: status ? { onboardingStatus: status as any } : {},
    });

    res.json({ businesses, total });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// VER DETALLE DE SOLICITUD
// ==========================================
router.get('/onboarding-requests/:id', async (req, res, next) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, plan: true, planType: true },
        },
        products: true,
        faqs: true,
        assistants: true,
      },
    });

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    res.json(business);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// CONFIGURAR ASISTENTE (ADMIN)
// ==========================================
router.post('/configure-assistant', async (req, res, next) => {
  try {
    const {
      businessId,
      assistantName,
      welcomeMessage,
      tone,
      customInstructions,
      customSystemPrompt,
    } = req.body;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: {
        products: true,
        faqs: true,
        user: true,
      },
    });

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Generar system prompt si no se proporciona uno personalizado
    const systemPrompt = customSystemPrompt || generateSystemPrompt({
      assistantName: assistantName || 'Elisa',
      businessName: business.name,
      industry: business.industry,
      description: business.description,
      products: business.products.map(p => ({
        name: p.name,
        price: p.price ? Number(p.price) : undefined,
        description: p.description || undefined,
      })),
      faqs: business.faqs.map(f => ({
        question: f.question,
        answer: f.answer,
      })),
      tone: tone || 'FRIENDLY',
      customInstructions,
    });

    // Crear o actualizar asistente
    const existingAssistant = await prisma.assistant.findFirst({
      where: { businessId },
    });

    let assistant;
    if (existingAssistant) {
      assistant = await prisma.assistant.update({
        where: { id: existingAssistant.id },
        data: {
          name: assistantName || existingAssistant.name,
          welcomeMessage: welcomeMessage || existingAssistant.welcomeMessage,
          tone: tone || existingAssistant.tone,
          customInstructions,
          systemPrompt,
          status: 'REVIEW',
        },
      });
    } else {
      assistant = await prisma.assistant.create({
        data: {
          userId: business.userId,
          businessId,
          name: assistantName || 'Elisa',
          welcomeMessage: welcomeMessage || `¡Hola! 👋 Soy ${assistantName || 'Elisa'}, tu asistente de ${business.name}. ¿En qué puedo ayudarte?`,
          tone: tone || 'FRIENDLY',
          customInstructions,
          systemPrompt,
          status: 'REVIEW',
        },
      });
    }

    // Actualizar estado del negocio
    await prisma.business.update({
      where: { id: businessId },
      data: { onboardingStatus: 'COMPLETED' },
    });

    res.json({
      message: 'Asistente configurado exitosamente',
      assistant,
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// ACTIVAR ASISTENTE (ADMIN)
// ==========================================
router.post('/activate-assistant/:id', async (req, res, next) => {
  try {
    const assistant = await prisma.assistant.update({
      where: { id: req.params.id },
      data: {
        status: 'ACTIVE',
        isActive: true,
        activatedAt: new Date(),
      },
      include: {
        business: true,
        user: { select: { email: true } },
      },
    });

    // Actualizar estado del negocio
    await prisma.business.update({
      where: { id: assistant.businessId },
      data: { onboardingStatus: 'ACTIVE' },
    });

    // TODO: Enviar email al usuario notificando que su asistente está activo

    res.json({
      message: 'Asistente activado exitosamente',
      assistant,
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// LISTAR USUARIOS
// ==========================================
router.get('/users', async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        plan: true,
        planType: true,
        subscriptionStatus: true,
        apiKeyConnected: true,
        isActive: true,
        createdAt: true,
        lastLogin: true,
        _count: {
          select: { businesses: true, assistants: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    });

    const total = await prisma.user.count();

    res.json({ users, total });
  } catch (error) {
    next(error);
  }
});

export default router;

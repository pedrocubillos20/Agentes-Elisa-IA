import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate, requireApiKey } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { PrismaClient } from '@prisma/client';
import { generateSystemPrompt } from '../services/openai.service';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

// ==========================================
// OBTENER ASISTENTES DEL USUARIO
// ==========================================
router.get('/', async (req, res, next) => {
  try {
    const assistants = await prisma.assistant.findMany({
      where: { userId: req.userId },
      include: {
        business: {
          select: { id: true, name: true },
        },
        _count: {
          select: { conversations: true },
        },
      },
    });
    res.json(assistants);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// CREAR ASISTENTE
// ==========================================
router.post('/',
  requireApiKey,
  [
    body('businessId').isUUID(),
    body('name').optional().trim().default('Elisa'),
    body('welcomeMessage').notEmpty().trim(),
    body('tone').optional().isIn(['FRIENDLY', 'PROFESSIONAL', 'TECHNICAL', 'SALES']),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { businessId, name, welcomeMessage, tone } = req.body;

      // Verificar que el negocio pertenece al usuario
      const business = await prisma.business.findFirst({
        where: { id: businessId, userId: req.userId },
        include: {
          products: true,
          faqs: true,
        },
      });

      if (!business) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
      }

      // Generar system prompt
      const systemPrompt = generateSystemPrompt({
        assistantName: name || 'Elisa',
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
      });

      const assistant = await prisma.assistant.create({
        data: {
          userId: req.userId!,
          businessId,
          name: name || 'Elisa',
          welcomeMessage,
          tone: tone || 'FRIENDLY',
          systemPrompt,
        },
      });

      res.status(201).json(assistant);
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// OBTENER ASISTENTE POR ID
// ==========================================
router.get('/:id', async (req, res, next) => {
  try {
    const assistant = await prisma.assistant.findFirst({
      where: {
        id: req.params.id,
        userId: req.userId,
      },
      include: {
        business: true,
        _count: {
          select: { conversations: true },
        },
      },
    });

    if (!assistant) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }

    res.json(assistant);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// ACTUALIZAR ASISTENTE
// ==========================================
router.put('/:id',
  [
    param('id').isUUID(),
    body('name').optional().trim(),
    body('welcomeMessage').optional().trim(),
    body('offlineMessage').optional().trim(),
    body('tone').optional().isIn(['FRIENDLY', 'PROFESSIONAL', 'TECHNICAL', 'SALES']),
    body('useEmojis').optional().isBoolean(),
    body('customInstructions').optional().trim(),
    body('primaryColor').optional().matches(/^#[0-9A-Fa-f]{6}$/),
    body('position').optional().isIn(['bottom-right', 'bottom-left']),
  ],
  validate,
  async (req, res, next) => {
    try {
      const assistant = await prisma.assistant.updateMany({
        where: {
          id: req.params.id,
          userId: req.userId,
        },
        data: {
          ...req.body,
          updatedAt: new Date(),
        },
      });

      if (assistant.count === 0) {
        return res.status(404).json({ error: 'Asistente no encontrado' });
      }

      const updated = await prisma.assistant.findUnique({
        where: { id: req.params.id },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// ACTIVAR/DESACTIVAR ASISTENTE
// ==========================================
router.patch('/:id/toggle',
  requireApiKey,
  async (req, res, next) => {
    try {
      const assistant = await prisma.assistant.findFirst({
        where: { id: req.params.id, userId: req.userId },
      });

      if (!assistant) {
        return res.status(404).json({ error: 'Asistente no encontrado' });
      }

      const updated = await prisma.assistant.update({
        where: { id: req.params.id },
        data: {
          isActive: !assistant.isActive,
          ...(assistant.isActive ? {} : { activatedAt: new Date() }),
        },
      });

      res.json({
        message: updated.isActive ? 'Asistente activado' : 'Asistente desactivado',
        isActive: updated.isActive,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// OBTENER CÓDIGO DEL WIDGET
// ==========================================
router.get('/:id/widget-code', async (req, res, next) => {
  try {
    const assistant = await prisma.assistant.findFirst({
      where: { id: req.params.id, userId: req.userId },
      select: { publicApiKey: true, name: true, primaryColor: true, welcomeMessage: true },
    });

    if (!assistant) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }

    const code = `<!-- Elisa IA Chat Widget -->
<script src="${process.env.FRONTEND_URL}/widget.js"></script>
<script>
  ElisaWidget.init({
    apiKey: '${assistant.publicApiKey}',
    primaryColor: '${assistant.primaryColor}',
    welcomeMessage: '${assistant.welcomeMessage}'
  });
</script>`;

    res.json({ code });
  } catch (error) {
    next(error);
  }
});

export default router;

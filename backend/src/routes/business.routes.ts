import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Todas las rutas requieren autenticación
router.use(authenticate);

// ==========================================
// OBTENER NEGOCIOS DEL USUARIO
// ==========================================
router.get('/', async (req, res, next) => {
  try {
    const businesses = await prisma.business.findMany({
      where: { userId: req.userId },
      include: {
        products: { take: 5 },
        faqs: { take: 5 },
        assistants: {
          select: { id: true, name: true, status: true, isActive: true },
        },
      },
    });
    res.json(businesses);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// OBTENER UN NEGOCIO POR ID
// ==========================================
router.get('/:id', async (req, res, next) => {
  try {
    const business = await prisma.business.findFirst({
      where: {
        id: req.params.id,
        userId: req.userId,
      },
      include: {
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
// ACTUALIZAR INFORMACIÓN DEL NEGOCIO
// ==========================================
router.put('/:id',
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty(),
    body('industry').optional().trim(),
    body('description').optional().trim(),
    body('website').optional().trim(),
    body('whatsapp').optional().trim(),
    body('instagram').optional().trim(),
    body('email').optional().isEmail(),
    body('phone').optional().trim(),
    body('address').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const business = await prisma.business.updateMany({
        where: {
          id: req.params.id,
          userId: req.userId,
        },
        data: req.body,
      });

      if (business.count === 0) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
      }

      const updated = await prisma.business.findUnique({
        where: { id: req.params.id },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// AGREGAR PRODUCTO
// ==========================================
router.post('/:id/products',
  [
    param('id').isUUID(),
    body('name').notEmpty().trim(),
    body('price').optional().isDecimal(),
    body('description').optional().trim(),
    body('category').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      // Verificar que el negocio pertenece al usuario
      const business = await prisma.business.findFirst({
        where: { id: req.params.id, userId: req.userId },
      });

      if (!business) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
      }

      const product = await prisma.product.create({
        data: {
          businessId: req.params.id,
          ...req.body,
        },
      });

      res.status(201).json(product);
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// AGREGAR FAQ
// ==========================================
router.post('/:id/faqs',
  [
    param('id').isUUID(),
    body('question').notEmpty().trim(),
    body('answer').notEmpty().trim(),
    body('category').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const business = await prisma.business.findFirst({
        where: { id: req.params.id, userId: req.userId },
      });

      if (!business) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
      }

      const faq = await prisma.faq.create({
        data: {
          businessId: req.params.id,
          ...req.body,
        },
      });

      res.status(201).json(faq);
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// ACTUALIZAR ESTADO DE ONBOARDING
// ==========================================
router.patch('/:id/onboarding',
  [
    param('id').isUUID(),
    body('step').optional().isInt({ min: 1, max: 5 }),
    body('status').optional().isIn(['PENDING', 'IN_PROGRESS', 'COMPLETED']),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { step, status } = req.body;

      const business = await prisma.business.updateMany({
        where: {
          id: req.params.id,
          userId: req.userId,
        },
        data: {
          ...(step && { onboardingStep: step }),
          ...(status && { onboardingStatus: status }),
        },
      });

      if (business.count === 0) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
      }

      res.json({ message: 'Onboarding actualizado' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

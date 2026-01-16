import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import {
  createPaymentLink,
  generatePaymentReference,
  getCheckoutWidgetConfig,
  PLAN_PRICES,
} from '../services/wompi.service';

const router = Router();
const prisma = new PrismaClient();

// ==========================================
// OBTENER PRECIOS DE PLANES
// ==========================================
router.get('/plans', (req, res) => {
  // Convertir precios a formato amigable
  const plans = Object.entries(PLAN_PRICES).map(([key, value]) => ({
    id: key,
    name: value.name,
    description: value.description,
    priceInCents: value.amountCOP,
    priceFormatted: new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(value.amountCOP / 100),
    type: key.includes('LIFETIME') ? 'LIFETIME' : 'MONTHLY',
  }));

  res.json({ plans });
});

// ==========================================
// CREAR LINK DE PAGO
// ==========================================
router.post('/create-payment',
  authenticate,
  [
    body('plan').isIn(Object.keys(PLAN_PRICES)).withMessage('Plan no válido'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { plan } = req.body;
      const userId = req.userId!;

      // Obtener usuario
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      // Obtener info del plan
      const planInfo = PLAN_PRICES[plan as keyof typeof PLAN_PRICES];
      if (!planInfo) {
        return res.status(400).json({ error: 'Plan no válido' });
      }

      // Generar referencia única
      const reference = generatePaymentReference(userId, plan);

      // Crear link de pago
      const paymentLink = await createPaymentLink({
        amountInCents: planInfo.amountCOP,
        currency: 'COP',
        reference,
        customerEmail: user.email,
        customerName: `${user.firstName} ${user.lastName}`,
        description: planInfo.name,
        redirectUrl: `${process.env.FRONTEND_URL}/dashboard?payment=success&ref=${reference}`,
      });

      // Registrar intento de pago
      await prisma.webhookLog.create({
        data: {
          source: 'wompi',
          event: 'payment_link_created',
          payload: {
            userId,
            plan,
            reference,
            amount: planInfo.amountCOP,
          },
        },
      });

      logger.info(`Link de pago creado para usuario ${userId}: ${reference}`);

      res.json({
        paymentUrl: paymentLink.paymentUrl,
        reference: paymentLink.reference,
        plan: planInfo.name,
        amount: planInfo.amountCOP,
        amountFormatted: new Intl.NumberFormat('es-CO', {
          style: 'currency',
          currency: 'COP',
          minimumFractionDigits: 0,
        }).format(planInfo.amountCOP / 100),
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// OBTENER CONFIG PARA WIDGET DE CHECKOUT
// ==========================================
router.post('/checkout-config',
  authenticate,
  [
    body('plan').isIn(Object.keys(PLAN_PRICES)).withMessage('Plan no válido'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { plan } = req.body;
      const userId = req.userId!;

      const planInfo = PLAN_PRICES[plan as keyof typeof PLAN_PRICES];
      if (!planInfo) {
        return res.status(400).json({ error: 'Plan no válido' });
      }

      const reference = generatePaymentReference(userId, plan);

      const config = getCheckoutWidgetConfig({
        amountInCents: planInfo.amountCOP,
        reference,
        redirectUrl: `${process.env.FRONTEND_URL}/dashboard?payment=success&ref=${reference}`,
      });

      res.json({
        config,
        plan: planInfo.name,
        amount: planInfo.amountCOP,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// VERIFICAR ESTADO DE PAGO
// ==========================================
router.get('/verify/:reference',
  authenticate,
  async (req, res, next) => {
    try {
      const { reference } = req.params;

      // Buscar en logs si hay un pago exitoso con esta referencia
      const paymentLog = await prisma.webhookLog.findFirst({
        where: {
          source: 'wompi',
          event: 'transaction.updated',
          payload: {
            path: ['data', 'transaction', 'reference'],
            equals: reference,
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!paymentLog) {
        return res.json({
          status: 'pending',
          message: 'Pago pendiente o no encontrado',
        });
      }

      const payload = paymentLog.payload as any;
      const transactionStatus = payload?.data?.transaction?.status;

      res.json({
        status: transactionStatus === 'APPROVED' ? 'approved' : transactionStatus?.toLowerCase(),
        message: transactionStatus === 'APPROVED' 
          ? 'Pago aprobado exitosamente' 
          : `Estado del pago: ${transactionStatus}`,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// OBTENER HISTORIAL DE PAGOS
// ==========================================
router.get('/history',
  authenticate,
  async (req, res, next) => {
    try {
      const userId = req.userId!;

      // Buscar pagos del usuario en los logs
      const payments = await prisma.webhookLog.findMany({
        where: {
          source: 'wompi',
          event: 'transaction.updated',
          payload: {
            path: ['data', 'transaction', 'reference'],
            string_starts_with: `ELISA-${userId}`,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const formattedPayments = payments.map(p => {
        const payload = p.payload as any;
        const transaction = payload?.data?.transaction;
        return {
          id: transaction?.id,
          reference: transaction?.reference,
          amount: transaction?.amount_in_cents,
          amountFormatted: new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: 'COP',
            minimumFractionDigits: 0,
          }).format((transaction?.amount_in_cents || 0) / 100),
          status: transaction?.status,
          date: p.createdAt,
        };
      });

      res.json({ payments: formattedPayments });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// OBTENER SUSCRIPCIÓN ACTUAL
// ==========================================
router.get('/subscription',
  authenticate,
  async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: {
          plan: true,
          planType: true,
          subscriptionStatus: true,
          createdAt: true,
        },
      });

      if (!user) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      res.json({
        plan: user.plan,
        planType: user.planType,
        status: user.subscriptionStatus,
        isActive: user.subscriptionStatus === 'ACTIVE',
        memberSince: user.createdAt,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

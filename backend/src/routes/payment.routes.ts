import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key';

// PLANES CON PRECIOS CORRECTOS
const PLAN_PRICES: Record<string, { amountCOP: number; name: string; planType: 'MONTHLY' | 'LIFETIME'; plan: string }> = {
  // Mensuales (Admin configura)
  'EMPRENDEDORES_MONTHLY': {
    amountCOP: 180000,
    name: 'Emprendedores',
    planType: 'MONTHLY',
    plan: 'EMPRENDEDORES'
  },
  'NEGOCIOS_MONTHLY': {
    amountCOP: 360000,
    name: 'Negocios en Crecimiento',
    planType: 'MONTHLY',
    plan: 'NEGOCIOS'
  },
  // Vitalicios (Usuario configura)
  'BUSINESS_LIFETIME': {
    amountCOP: 1440000,
    name: 'Business',
    planType: 'LIFETIME',
    plan: 'BUSINESS'
  },
  'MARCA_BLANCA_LIFETIME': {
    amountCOP: 2520000,
    name: 'Marca Blanca',
    planType: 'LIFETIME',
    plan: 'MARCA_BLANCA'
  },
};

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

// Generar firma de Wompi
const generateWompiSignature = (reference: string, amountInCents: number, currency: string): string => {
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET || '';
  const dataToSign = `${reference}${amountInCents}${currency}${integritySecret}`;
  return crypto.createHash('sha256').update(dataToSign).digest('hex');
};

// Crear pago
router.post('/create-payment', authenticate, async (req: Request, res: Response) => {
  try {
    const { plan } = req.body;
    const userId = (req as any).userId;

    const planData = PLAN_PRICES[plan];
    if (!planData) {
      return res.status(400).json({ error: 'Plan no válido' });
    }

    const reference = `ELISA-${Date.now()}-${userId.slice(0, 8)}`;
    const amountInCents = planData.amountCOP * 100;

    // Crear registro de pago
    await prisma.payment.create({
      data: {
        userId,
        reference,
        plan: planData.plan,
        amount: planData.amountCOP,
        currency: 'COP',
        status: 'PENDING',
      }
    });

    // Generar firma
    const signature = generateWompiSignature(reference, amountInCents, 'COP');

    // URL de Wompi
    const wompiPublicKey = process.env.WOMPI_PUBLIC_KEY;
    const redirectUrl = `${process.env.FRONTEND_URL}/payment/callback`;

    const wompiUrl = `https://checkout.wompi.co/p/?public-key=${wompiPublicKey}&currency=COP&amount-in-cents=${amountInCents}&reference=${reference}&signature:integrity=${signature}&redirect-url=${encodeURIComponent(redirectUrl)}`;

    res.json({
      paymentUrl: wompiUrl,
      reference,
      amount: planData.amountCOP,
      plan: planData.name,
    });
  } catch (error) {
    console.error('Error creando pago:', error);
    res.status(500).json({ error: 'Error al crear pago' });
  }
});

// Verificar pago
router.get('/verify/:reference', authenticate, async (req: Request, res: Response) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { reference: req.params.reference }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    res.json({ payment });
  } catch (error) {
    res.status(500).json({ error: 'Error al verificar pago' });
  }
});

// Historial de pagos
router.get('/history', authenticate, async (req: Request, res: Response) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { userId: (req as any).userId },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ payments });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// Obtener planes disponibles
router.get('/plans', (req: Request, res: Response) => {
  const plans = Object.entries(PLAN_PRICES).map(([id, data]) => ({
    id,
    ...data,
  }));
  res.json({ plans });
});

export default router;

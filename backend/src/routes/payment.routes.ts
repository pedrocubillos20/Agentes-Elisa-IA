import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Configuración de planes
const PLAN_PRICES: Record<string, { amountCOP: number; name: string; planType: string; plan: string }> = {
  // Planes Mensuales
  'STARTER_MONTHLY': { amountCOP: 180000, name: 'Starter Mensual', planType: 'MONTHLY', plan: 'STARTER' },
  'PRO_MONTHLY': { amountCOP: 360000, name: 'Pro Mensual', planType: 'MONTHLY', plan: 'PRO' },
  'BUSINESS_MONTHLY': { amountCOP: 720000, name: 'Business Mensual', planType: 'MONTHLY', plan: 'BUSINESS' },
  // Planes Vitalicios
  'STARTER_LIFETIME': { amountCOP: 720000, name: 'Starter Vitalicio', planType: 'LIFETIME', plan: 'STARTER' },
  'PRO_LIFETIME': { amountCOP: 1440000, name: 'Pro Vitalicio', planType: 'LIFETIME', plan: 'PRO' },
  'AGENCY_LIFETIME': { amountCOP: 2520000, name: 'Agencia Vitalicio', planType: 'LIFETIME', plan: 'AGENCY' },
};

// Generar firma de integridad para Wompi
const generateWompiSignature = (reference: string, amountInCents: number, currency: string): string => {
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET || process.env.WOMPI_EVENT_SECRET || '';
  const stringToSign = `${reference}${amountInCents}${currency}${integritySecret}`;
  return crypto.createHash('sha256').update(stringToSign).digest('hex');
};

// Crear pago
router.post('/create-payment', authenticate, async (req: Request, res: Response) => {
  try {
    const { plan } = req.body;

    if (!plan || !PLAN_PRICES[plan]) {
      return res.status(400).json({ 
        error: 'Plan inválido',
        availablePlans: Object.keys(PLAN_PRICES)
      });
    }

    const planInfo = PLAN_PRICES[plan];
    const amountInCents = planInfo.amountCOP * 100;
    
    // Generar referencia única
    const reference = `ELISA-${Date.now()}-${req.userId?.slice(0, 8)}`;
    
    // Obtener información del usuario
    const user = await prisma.user.findUnique({
      where: { id: req.userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Guardar el pago pendiente en la base de datos
    await prisma.payment.create({
      data: {
        userId: req.userId!,
        reference,
        plan: planInfo.plan,
        amount: planInfo.amountCOP,
        currency: 'COP',
        status: 'PENDING',
      }
    });

    // Generar firma de integridad
    const signature = generateWompiSignature(reference, amountInCents, 'COP');

    const publicKey = process.env.WOMPI_PUBLIC_KEY;
    const redirectUrl = `${process.env.FRONTEND_URL}/payment/callback`;

    // Construir URL de checkout de Wompi
    const wompiCheckoutUrl = `https://checkout.wompi.co/p/?public-key=${publicKey}&currency=COP&amount-in-cents=${amountInCents}&reference=${reference}&redirect-url=${encodeURIComponent(redirectUrl)}&signature:integrity=${signature}`;

    console.log(`💳 Pago creado: ${reference} - ${planInfo.name} - $${planInfo.amountCOP} COP`);

    res.json({
      success: true,
      reference,
      amount: planInfo.amountCOP,
      amountInCents,
      currency: 'COP',
      plan: planInfo.name,
      publicKey,
      signature,
      redirectUrl,
      paymentUrl: wompiCheckoutUrl,
    });
  } catch (error) {
    console.error('Error creando pago:', error);
    res.status(500).json({ error: 'Error al crear el pago' });
  }
});

// Verificar estado del pago
router.get('/verify/:reference', authenticate, async (req: Request, res: Response) => {
  try {
    const { reference } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { reference }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    // Verificar que el pago pertenece al usuario
    if (payment.userId !== req.userId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    res.json({ payment });
  } catch (error) {
    console.error('Error verificando pago:', error);
    res.status(500).json({ error: 'Error al verificar el pago' });
  }
});

// Obtener historial de pagos del usuario
router.get('/history', authenticate, async (req: Request, res: Response) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ payments });
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ error: 'Error al obtener historial de pagos' });
  }
});

// Obtener planes disponibles
router.get('/plans', async (req: Request, res: Response) => {
  try {
    const plans = Object.entries(PLAN_PRICES).map(([id, info]) => ({
      id,
      ...info,
    }));

    res.json({ plans });
  } catch (error) {
    console.error('Error obteniendo planes:', error);
    res.status(500).json({ error: 'Error al obtener planes' });
  }
});

export default router;

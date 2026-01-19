import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key';

// PLANES ACTUALIZADOS
const PLANS: Record<string, {
  id: string;
  name: string;
  description: string;
  amountCOP: number;
  chatbots: number;
  planType: 'MONTHLY' | 'LIFETIME';
  plan: string;
  features: string[];
  canEditContext: boolean;
  supportIncluded: boolean;
}> = {
  // Plan mensual - Emprendedores
  'EMPRENDEDORES_MONTHLY': {
    id: 'EMPRENDEDORES_MONTHLY',
    name: 'Emprendedores',
    description: '1 chatbot, soporte incluido, nosotros configuramos',
    amountCOP: 100000,
    chatbots: 1,
    planType: 'MONTHLY',
    plan: 'EMPRENDEDORES',
    features: [
      '1 Chatbot de WhatsApp',
      'Mensajes ilimitados (según tu API Key)',
      'Nosotros configuramos tu negocio',
      'Soporte incluido',
      'Subir PDF con información'
    ],
    canEditContext: false,
    supportIncluded: true,
  },
  // Plan mensual - Negocios en Crecimiento
  'NEGOCIOS_MONTHLY': {
    id: 'NEGOCIOS_MONTHLY',
    name: 'Negocios en Crecimiento',
    description: '3 chatbots, soporte incluido, nosotros configuramos',
    amountCOP: 150000,
    chatbots: 3,
    planType: 'MONTHLY',
    plan: 'NEGOCIOS',
    features: [
      '3 Chatbots de WhatsApp',
      'Mensajes ilimitados (según tu API Key)',
      'Nosotros configuramos tus negocios',
      'Soporte prioritario',
      'Subir PDF con información'
    ],
    canEditContext: false,
    supportIncluded: true,
  },
  // Plan vitalicio - Business
  'BUSINESS_LIFETIME': {
    id: 'BUSINESS_LIFETIME',
    name: 'Business',
    description: '5 chatbots, configura tú mismo, pago único',
    amountCOP: 100000,
    chatbots: 5,
    planType: 'LIFETIME',
    plan: 'BUSINESS',
    features: [
      '5 Chatbots de WhatsApp',
      'Mensajes ilimitados (según tu API Key)',
      'Configura el contexto tú mismo (JSON)',
      'Soporte incluido',
      'Pago único - Sin mensualidades',
      'Actualizaciones de por vida'
    ],
    canEditContext: true,
    supportIncluded: true,
  },
  // Plan vitalicio - Marca Blanca
  'MARCA_BLANCA_LIFETIME': {
    id: 'MARCA_BLANCA_LIFETIME',
    name: 'Marca Blanca',
    description: 'Chatbots ilimitados, personaliza tu marca, revende',
    amountCOP: 300000,
    chatbots: 999,
    planType: 'LIFETIME',
    plan: 'MARCA_BLANCA',
    features: [
      'Chatbots ILIMITADOS',
      'Mensajes ilimitados (según tu API Key)',
      'Configura el contexto tú mismo (JSON)',
      'Personaliza logo y marca',
      'Link de reventa exclusivo',
      'Soporte VIP',
      'Pago único - Sin mensualidades',
      'Actualizaciones de por vida'
    ],
    canEditContext: true,
    supportIncluded: true,
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

// Obtener planes disponibles
router.get('/plans', (req: Request, res: Response) => {
  const plans = Object.values(PLANS).map(plan => ({
    ...plan,
    formattedPrice: new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(plan.amountCOP),
  }));
  
  res.json({ plans });
});

// Crear pago
router.post('/create-payment', authenticate, async (req: Request, res: Response) => {
  try {
    const { planId } = req.body;
    const userId = (req as any).userId;

    const planData = PLANS[planId];
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

// ========== MARCA BLANCA ==========

// Generar código de referido
router.post('/generate-referral', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    if (!user || user.plan !== 'MARCA_BLANCA') {
      return res.status(403).json({ error: 'Solo disponible para plan Marca Blanca' });
    }
    
    // Generar código único si no tiene
    if (!user.referralCode) {
      const code = `REF-${uuidv4().slice(0, 8).toUpperCase()}`;
      await prisma.user.update({
        where: { id: userId },
        data: { referralCode: code }
      });
      return res.json({ referralCode: code });
    }
    
    res.json({ referralCode: user.referralCode });
  } catch (error) {
    res.status(500).json({ error: 'Error al generar código' });
  }
});

// Actualizar marca (logo, nombre)
router.put('/brand', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { customLogo, customBrandName } = req.body;
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    if (!user || user.plan !== 'MARCA_BLANCA') {
      return res.status(403).json({ error: 'Solo disponible para plan Marca Blanca' });
    }
    
    await prisma.user.update({
      where: { id: userId },
      data: { customLogo, customBrandName }
    });
    
    res.json({ message: 'Marca actualizada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar marca' });
  }
});

// Estadísticas de referidos
router.get('/referral-stats', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    if (!user || user.plan !== 'MARCA_BLANCA' || !user.referralCode) {
      return res.status(403).json({ error: 'No disponible' });
    }
    
    const referrals = await prisma.user.count({
      where: { referredBy: user.referralCode }
    });
    
    res.json({ 
      referralCode: user.referralCode,
      totalReferrals: referrals,
      referralLink: `${process.env.FRONTEND_URL}?ref=${user.referralCode}`
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

export default router;

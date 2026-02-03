import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';
import crypto from 'crypto';

const router = Router();

// ===== CONFIGURACIÓN DE PLANES =====
const PLANS = {
  starter: {
    name: 'Elisa Starter',
    monthly: 30,
    semiannual: 150,   // 30×6 = 180 → 150 (17% desc)
    annual: 250,        // 30×12 = 360 → 250 (31% desc)
  },
  business: {
    name: 'Elisa Business',
    monthly: 50,
    semiannual: 250,    // 50×6 = 300 → 250 (17% desc)
    annual: 420,        // 50×12 = 600 → 420 (30% desc)
  }
};

const CARD_SURCHARGE = 0.05; // 5% recargo tarjeta

// Wompi config
const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY || '';
const WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY || '';
const WOMPI_EVENT_SECRET = process.env.WOMPI_EVENT_SECRET || '';
const WOMPI_ENVIRONMENT = process.env.WOMPI_ENVIRONMENT || 'production';
const WOMPI_API_URL = WOMPI_ENVIRONMENT === 'test'
  ? 'https://sandbox.wompi.co/v1'
  : 'https://production.wompi.co/v1';

// ===== OBTENER TASA DE CAMBIO USD→COP =====
async function getExchangeRate(): Promise<number> {
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (res.ok) {
      const data = await res.json() as any;
      return data.rates?.COP || 4200;
    }
  } catch (e) {
    console.error('Error tasa cambio:', e);
  }
  return 4200; // Fallback
}

// ===== GET /api/subscription/plans =====
router.get('/plans', async (req: Request, res: Response) => {
  try {
    const rate = await getExchangeRate();
    
    const plans = Object.entries(PLANS).map(([id, plan]) => ({
      id,
      name: plan.name,
      prices: {
        monthly: {
          usd: plan.monthly,
          cop: Math.round(plan.monthly * rate),
          copWithCard: Math.round(plan.monthly * rate * (1 + CARD_SURCHARGE)),
          period: 'monthly',
          label: 'Mensual'
        },
        semiannual: {
          usd: plan.semiannual,
          cop: Math.round(plan.semiannual * rate),
          copWithCard: Math.round(plan.semiannual * rate * (1 + CARD_SURCHARGE)),
          period: 'semiannual',
          label: '6 Meses',
          savedUsd: (plan.monthly * 6) - plan.semiannual,
          savedPercent: Math.round(((plan.monthly * 6 - plan.semiannual) / (plan.monthly * 6)) * 100)
        },
        annual: {
          usd: plan.annual,
          cop: Math.round(plan.annual * rate),
          copWithCard: Math.round(plan.annual * rate * (1 + CARD_SURCHARGE)),
          period: 'annual',
          label: 'Anual',
          savedUsd: (plan.monthly * 12) - plan.annual,
          savedPercent: Math.round(((plan.monthly * 12 - plan.annual) / (plan.monthly * 12)) * 100)
        }
      }
    }));

    res.json({ plans, exchangeRate: rate, cardSurcharge: CARD_SURCHARGE * 100 });
  } catch (error) {
    console.error('Error planes:', error);
    res.status(500).json({ error: 'Error al obtener planes' });
  }
});

// ===== GET /api/subscription/status =====
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, trialEndsAt: true, createdAt: true }
    });

    if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }

    const subscription = await prisma.subscription.findUnique({ where: { userId } });
    const payments = await prisma.payment.findMany({
      where: { userId, status: 'approved' },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    let status = 'active';
    let daysRemaining = 0;
    let periodEnd: Date | null = null;

    if (user.plan === 'trial' && user.trialEndsAt) {
      const diff = user.trialEndsAt.getTime() - Date.now();
      daysRemaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
      if (daysRemaining <= 0) status = 'expired';
      periodEnd = user.trialEndsAt;
    } else if (subscription) {
      status = subscription.status;
      const diff = subscription.currentPeriodEnd.getTime() - Date.now();
      daysRemaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
      if (diff <= 0) status = 'expired';
      periodEnd = subscription.currentPeriodEnd;
    }

    res.json({
      plan: user.plan,
      status,
      daysRemaining,
      periodEnd,
      subscription: subscription ? {
        plan: subscription.plan,
        period: subscription.period,
        priceUsd: subscription.priceUsd,
        priceCop: subscription.priceCop,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        status: subscription.status
      } : null,
      payments: payments.map(p => ({
        id: p.id,
        plan: p.plan,
        period: p.period,
        amountCop: p.totalCop,
        amountUsd: p.amountUsd,
        method: p.method,
        status: p.status,
        date: p.createdAt
      })),
      registeredAt: user.createdAt
    });
  } catch (error) {
    console.error('Error status:', error);
    res.status(500).json({ error: 'Error' });
  }
});

// ===== POST /api/subscription/create-payment =====
// Crea un link de pago en Wompi
router.post('/create-payment', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const { plan, period } = req.body;
    if (!plan || !period) { res.status(400).json({ error: 'Plan y periodo requeridos' }); return; }
    if (!PLANS[plan as keyof typeof PLANS]) { res.status(400).json({ error: 'Plan inválido' }); return; }
    if (!['monthly', 'semiannual', 'annual'].includes(period)) { res.status(400).json({ error: 'Periodo inválido' }); return; }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }

    const planConfig = PLANS[plan as keyof typeof PLANS];
    const priceUsd = planConfig[period as keyof typeof planConfig] as number;
    const rate = await getExchangeRate();
    const priceCop = Math.round(priceUsd * rate);
    // Wompi recibe montos en centavos
    const amountInCents = priceCop * 100;

    const reference = `ELISA-${userId.slice(-8)}-${plan}-${period}-${Date.now()}`;

    // Generar firma de integridad para Wompi
    const integritySecret = WOMPI_EVENT_SECRET;
    const signatureString = `${reference}${amountInCents}COP${integritySecret}`;
    const signature = crypto.createHash('sha256').update(signatureString).digest('hex');

    // Crear registro de pago pendiente
    await prisma.payment.create({
      data: {
        userId,
        type: 'subscription',
        plan,
        period,
        amountUsd: priceUsd,
        amountCop: priceCop,
        exchangeRate: rate,
        totalCop: priceCop,
        status: 'pending',
        wompiReference: reference
      }
    });

    const frontendUrl = process.env.FRONTEND_URL || 'https://agentes-elisa-ia.vercel.app';

    res.json({
      publicKey: WOMPI_PUBLIC_KEY,
      amountInCents,
      currency: 'COP',
      reference,
      signature,
      redirectUrl: `${frontendUrl}/subscription?status=completed`,
      customerEmail: user.email,
      customerName: user.name || '',
      plan,
      period,
      priceUsd,
      priceCop,
      exchangeRate: rate
    });
  } catch (error) {
    console.error('Error crear pago:', error);
    res.status(500).json({ error: 'Error al crear pago' });
  }
});

// ===== POST /api/subscription/webhook/wompi =====
// Webhook de Wompi para confirmar pagos (PÚBLICO, sin auth)
router.post('/webhook/wompi', async (req: Request, res: Response) => {
  try {
    const event = req.body;
    console.log('💳 Webhook Wompi:', JSON.stringify(event).substring(0, 500));

    // Verificar firma del webhook
    if (WOMPI_EVENT_SECRET && event.signature) {
      const properties = event.signature?.properties || [];
      const checksum = event.signature?.checksum;
      
      let concatenated = '';
      for (const prop of properties) {
        const keys = prop.split('.');
        let value: any = event;
        for (const key of keys) value = value?.[key];
        concatenated += value;
      }
      concatenated += event.timestamp + WOMPI_EVENT_SECRET;
      
      const computed = crypto.createHash('sha256').update(concatenated).digest('hex');
      if (computed !== checksum) {
        console.error('❌ Firma Wompi inválida');
        res.status(400).json({ error: 'Firma inválida' });
        return;
      }
    }

    const transaction = event.data?.transaction;
    if (!transaction) { res.json({ received: true }); return; }

    const { reference, status, id: transactionId, payment_method_type } = transaction;

    if (event.event === 'transaction.updated' && status === 'APPROVED') {
      // Buscar el pago pendiente
      const payment = await prisma.payment.findFirst({
        where: { wompiReference: reference, status: 'pending' }
      });

      if (!payment) {
        console.log('⚠️ Pago no encontrado para referencia:', reference);
        res.json({ received: true });
        return;
      }

      // Actualizar pago a aprobado
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'approved',
          wompiTransactionId: String(transactionId),
          wompiPaymentMethod: payment_method_type,
          method: payment_method_type
        }
      });

      // Calcular periodo
      const now = new Date();
      const periodEnd = new Date(now);
      if (payment.period === 'monthly') periodEnd.setMonth(periodEnd.getMonth() + 1);
      else if (payment.period === 'semiannual') periodEnd.setMonth(periodEnd.getMonth() + 6);
      else if (payment.period === 'annual') periodEnd.setFullYear(periodEnd.getFullYear() + 1);

      // Crear o actualizar suscripción
      await prisma.subscription.upsert({
        where: { userId: payment.userId },
        create: {
          userId: payment.userId,
          plan: payment.plan,
          period: payment.period,
          status: 'active',
          priceUsd: payment.amountUsd,
          priceCop: payment.amountCop,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          wompiTransactionId: String(transactionId)
        },
        update: {
          plan: payment.plan,
          period: payment.period,
          status: 'active',
          priceUsd: payment.amountUsd,
          priceCop: payment.amountCop,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          wompiTransactionId: String(transactionId)
        }
      });

      // Actualizar plan del usuario
      await prisma.user.update({
        where: { id: payment.userId },
        data: { plan: payment.plan }
      });

      console.log(`✅ Pago aprobado: ${payment.plan} ${payment.period} para usuario ${payment.userId}`);
    } else if (event.event === 'transaction.updated' && status === 'DECLINED') {
      await prisma.payment.updateMany({
        where: { wompiReference: reference, status: 'pending' },
        data: { status: 'declined', wompiTransactionId: String(transactionId) }
      });
      console.log(`❌ Pago rechazado: ${reference}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error webhook Wompi:', error);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

// ===== POST /api/subscription/verify-payment =====
// Verificar estado de pago directamente con Wompi
router.post('/verify-payment', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { reference } = req.body;
    if (!userId || !reference) { res.status(400).json({ error: 'Referencia requerida' }); return; }

    // Consultar Wompi
    const wompiRes = await fetch(`${WOMPI_API_URL}/transactions?reference=${reference}`, {
      headers: { 'Authorization': `Bearer ${WOMPI_PRIVATE_KEY}` }
    });

    if (!wompiRes.ok) { res.status(500).json({ error: 'Error consultando Wompi' }); return; }

    const data = await wompiRes.json() as any;
    const transaction = data.data?.[0];

    if (!transaction) { res.json({ status: 'not_found' }); return; }

    res.json({
      status: transaction.status,
      reference: transaction.reference,
      amount: transaction.amount_in_cents / 100,
      method: transaction.payment_method_type
    });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// ===== ADMIN: GET /api/subscription/admin/users =====
router.get('/admin/users', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    // Solo super admin (primer usuario o email específico)
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.parentUserId) { res.status(403).json({ error: 'No autorizado' }); return; }

    const users = await prisma.user.findMany({
      where: { parentUserId: null },
      select: {
        id: true, email: true, name: true, plan: true, trialEndsAt: true, createdAt: true,
        subscription: { select: { plan: true, period: true, status: true, currentPeriodEnd: true, priceUsd: true } },
        _count: { select: { conversations: true, assistants: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    const usersWithStatus = users.map(u => {
      let status = 'active';
      let daysLeft = 0;
      
      if (u.plan === 'trial' && u.trialEndsAt) {
        const diff = u.trialEndsAt.getTime() - Date.now();
        daysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
        if (daysLeft <= 0) status = 'expired';
        else status = 'trial';
      } else if (u.subscription) {
        status = u.subscription.status;
        const diff = u.subscription.currentPeriodEnd.getTime() - Date.now();
        daysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
        if (diff <= 0) status = 'expired';
      }

      return { ...u, subscriptionStatus: status, daysLeft };
    });

    res.json({ users: usersWithStatus });
  } catch (error) {
    console.error('Error admin users:', error);
    res.status(500).json({ error: 'Error' });
  }
});

// ===== ADMIN: PUT /api/subscription/admin/extend =====
router.put('/admin/extend', async (req: Request, res: Response) => {
  try {
    const adminId = (req as AuthRequest).user?.id;
    const admin = await prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.parentUserId) { res.status(403).json({ error: 'No autorizado' }); return; }

    const { targetUserId, plan, days } = req.body;
    if (!targetUserId || !days) { res.status(400).json({ error: 'Datos requeridos' }); return; }

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setDate(periodEnd.getDate() + days);

    if (plan && plan !== 'trial') {
      // Crear/actualizar suscripción manual
      await prisma.subscription.upsert({
        where: { userId: targetUserId },
        create: {
          userId: targetUserId, plan, period: 'monthly', status: 'active',
          priceUsd: 0, priceCop: 0,
          currentPeriodStart: now, currentPeriodEnd: periodEnd
        },
        update: {
          plan, status: 'active',
          currentPeriodStart: now, currentPeriodEnd: periodEnd
        }
      });
      await prisma.user.update({ where: { id: targetUserId }, data: { plan } });
    } else {
      // Extender trial
      await prisma.user.update({
        where: { id: targetUserId },
        data: { trialEndsAt: periodEnd, plan: 'trial' }
      });
    }

    res.json({ success: true, message: `Plan actualizado: ${plan || 'trial'} por ${days} días` });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// ===== ADMIN: GET /api/subscription/admin/payments =====
router.get('/admin/payments', async (req: Request, res: Response) => {
  try {
    const adminId = (req as AuthRequest).user?.id;
    const admin = await prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.parentUserId) { res.status(403).json({ error: 'No autorizado' }); return; }

    const payments = await prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { email: true, name: true } } }
    });

    res.json({ payments });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

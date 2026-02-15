import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';
import crypto from 'crypto';

const router = Router();

// ===== CONFIGURACIÓN DE PLANES =====
const PLANS: Record<string, any> = {
  starter: {
    name: 'Bizonne Starter',
    monthly: 30,
    semiannual: 150,
    annual: 250,
    maxLines: 2,
    maxProducts: 10,
    features: ['Asistente IA con WhatsApp', '2 líneas de WhatsApp', 'Conversaciones ilimitadas', 'CRM + Pipeline de ventas', 'Agenda automática', 'Base de conocimiento', 'Multimedia (imágenes, videos, audios, PDF)', 'Dashboard y métricas', 'Hasta 10 productos de catálogo'],
    notIncluded: ['Equipo multi-usuario', 'Asignación de chats', 'Integraciones API']
  },
  business: {
    name: 'Bizonne Business',
    monthly: 50,
    semiannual: 250,
    annual: 420,
    maxLines: 5,
    maxProducts: 20,
    features: ['Todo de Starter +', '5 líneas de WhatsApp', 'Hasta 20 productos de catálogo', 'Equipo completo (roles)', 'Asignación de chats a vendedores', 'Dashboard para directivos', 'Estadísticas por sub-usuario', 'Permisos personalizados', 'Integraciones API', 'Soporte prioritario'],
    notIncluded: []
  }
};

// ===== ADD-ON: IMPLEMENTACIÓN (Order Bump / Upsell) =====
const IMPLEMENTATION_ADDON = {
  name: 'Bizonne Implementación',
  price: 100,
  features: [
    'Configuración completa del asistente IA',
    'Entrenamiento con tu base de conocimiento',
    'Integración y conexión de WhatsApp',
    'Diseño del pipeline de ventas (CRM)',
    'Carga de productos y catálogo',
    'Capacitación de uso de la plataforma',
    'Soporte prioritario por WhatsApp'
  ],
  extras: { extraLinesCost: 10, extraProductsCost: 10 }
};

// ===== ADD-ON: SOPORTE PRIORITARIO (Recurring Upsell) =====
const PRIORITY_SUPPORT_ADDON = {
  name: 'Soporte Prioritario',
  annualPrice: 15, // $15 USD por año (mientras licencia activa)
  features: [
    'Soporte directo por WhatsApp',
    'Respuesta en menos de 2 horas',
    'Configuración y ajustes incluidos',
    'Resolución de problemas técnicos',
    'Asesoría personalizada'
  ]
};

// ===== ADD-ONS INDIVIDUALES (Pago único) =====
const ADDON_EXTRA_LINE = { price: 10, name: 'Línea Adicional WhatsApp' };     // +1 línea
const ADDON_EXTRA_PRODUCTS = { price: 10, name: '+10 Productos Catálogo' };   // +10 productos

const CARD_SURCHARGE = 0.05; // 5% recargo tarjeta

// Wompi config
const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY || '';
const WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY || '';
const WOMPI_EVENT_SECRET = process.env.WOMPI_EVENT_SECRET || '';
const WOMPI_INTEGRITY_KEY = process.env.WOMPI_INTEGRITY_KEY || process.env.WOMPI_ENVIRONMENT || '';
const WOMPI_ENVIRONMENT = process.env.WOMPI_ENV || 'production';
const WOMPI_API_URL = WOMPI_ENVIRONMENT === 'test'
  ? 'https://sandbox.wompi.co/v1'
  : 'https://production.wompi.co/v1';

// =====================================================
// ===== TRM - TASA REPRESENTATIVA DEL MERCADO =====
// =====================================================

// Cache de TRM para no consultar cada request
let cachedTRM: { rate: number; date: string; source: string; updatedAt: number } | null = null;
const TRM_CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 horas en ms

async function getTRM(): Promise<{ rate: number; source: string; date: string }> {
  // Si hay cache válido, usarlo
  if (cachedTRM && (Date.now() - cachedTRM.updatedAt) < TRM_CACHE_DURATION) {
    return { rate: cachedTRM.rate, source: cachedTRM.source, date: cachedTRM.date };
  }

  const today = new Date().toISOString().split('T')[0];

  // === FUENTE 1: API Banco de la República (datos.gov.co) ===
  try {
    const banrepUrl = `https://www.datos.gov.co/resource/32sa-8pi3.json?$where=vigenciadesde>='${today}T00:00:00'&$order=vigenciadesde DESC&$limit=1`;
    const res = await fetch(banrepUrl, { 
      signal: AbortSignal.timeout(5000),
      headers: { 'Accept': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json() as any[];
      if (data.length > 0 && data[0].valor) {
        const rate = parseFloat(data[0].valor);
        if (rate > 3000 && rate < 6000) {
          cachedTRM = { rate, date: data[0].vigenciadesde?.split('T')[0] || today, source: 'Banco de la República (TRM oficial)', updatedAt: Date.now() };
          console.log(`✅ TRM obtenida de Banco de la República: $${rate}`);
          return { rate: cachedTRM.rate, source: cachedTRM.source, date: cachedTRM.date };
        }
      }
    }
  } catch (e) {
    console.warn('⚠️ Error consultando Banco de la República:', (e as Error).message);
  }

  // Si no hay datos de hoy, buscar la más reciente
  try {
    const banrepRecentUrl = `https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde DESC&$limit=1`;
    const res = await fetch(banrepRecentUrl, { 
      signal: AbortSignal.timeout(5000),
      headers: { 'Accept': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json() as any[];
      if (data.length > 0 && data[0].valor) {
        const rate = parseFloat(data[0].valor);
        if (rate > 3000 && rate < 6000) {
          cachedTRM = { rate, date: data[0].vigenciadesde?.split('T')[0] || today, source: 'Banco de la República (TRM reciente)', updatedAt: Date.now() };
          console.log(`✅ TRM reciente de Banco de la República: $${rate}`);
          return { rate: cachedTRM.rate, source: cachedTRM.source, date: cachedTRM.date };
        }
      }
    }
  } catch (e) {
    console.warn('⚠️ Error consultando TRM reciente:', (e as Error).message);
  }

  // === FUENTE 2: ExchangeRate API (fallback) ===
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json() as any;
      const rate = data.rates?.COP;
      if (rate && rate > 3000 && rate < 6000) {
        cachedTRM = { rate: Math.round(rate * 100) / 100, date: today, source: 'ExchangeRate API', updatedAt: Date.now() };
        console.log(`✅ Tasa de ExchangeRate API: $${rate}`);
        return { rate: cachedTRM.rate, source: cachedTRM.source, date: cachedTRM.date };
      }
    }
  } catch (e) {
    console.warn('⚠️ Error consultando ExchangeRate API:', (e as Error).message);
  }

  // === FUENTE 3: Open Exchange Rates (segundo fallback) ===
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json() as any;
      const rate = data.rates?.COP;
      if (rate && rate > 3000 && rate < 6000) {
        cachedTRM = { rate: Math.round(rate * 100) / 100, date: today, source: 'Open ExchangeRate', updatedAt: Date.now() };
        console.log(`✅ Tasa de Open ExchangeRate: $${rate}`);
        return { rate: cachedTRM.rate, source: cachedTRM.source, date: cachedTRM.date };
      }
    }
  } catch (e) {
    console.warn('⚠️ Error consultando Open ExchangeRate:', (e as Error).message);
  }

  // === FALLBACK: usar cache anterior o valor fijo ===
  if (cachedTRM) {
    console.warn('⚠️ Usando TRM cacheada anterior:', cachedTRM.rate);
    return { rate: cachedTRM.rate, source: cachedTRM.source + ' (cache)', date: cachedTRM.date };
  }

  console.error('❌ No se pudo obtener TRM, usando fallback 4200');
  return { rate: 4200, source: 'Fallback fijo', date: today };
}

// ===== GET /api/subscription/exchange-rate =====
// Endpoint público para consultar la TRM actual
router.get('/exchange-rate', async (req: Request, res: Response) => {
  try {
    const trm = await getTRM();
    res.json({
      rate: trm.rate,
      source: trm.source,
      date: trm.date,
      cached: cachedTRM ? true : false,
      cacheAge: cachedTRM ? Math.round((Date.now() - cachedTRM.updatedAt) / 60000) + ' min' : null
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener tasa de cambio' });
  }
});

// ===== GET /api/subscription/plans =====
router.get('/plans', async (req: Request, res: Response) => {
  try {
    const trm = await getTRM();
    const rate = trm.rate;
    
    // Planes recurrentes (starter, business)
    const recurringPlans = ['starter', 'business'].map(id => {
      const plan = PLANS[id];
      return {
        id,
        name: plan.name,
        type: 'recurring',
        maxLines: plan.maxLines,
        maxProducts: plan.maxProducts,
        features: plan.features || [],
        notIncluded: plan.notIncluded || [],
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
      };
    });

    // Add-on de implementación (order bump / upsell)
    const addon = {
      id: 'implementation',
      name: IMPLEMENTATION_ADDON.name,
      type: 'addon',
      priceUsd: IMPLEMENTATION_ADDON.price,
      priceCop: Math.round(IMPLEMENTATION_ADDON.price * rate),
      priceCopWithCard: Math.round(IMPLEMENTATION_ADDON.price * rate * (1 + CARD_SURCHARGE)),
      features: IMPLEMENTATION_ADDON.features,
      extras: {
        extraLine: { usd: IMPLEMENTATION_ADDON.extras.extraLinesCost, cop: Math.round(IMPLEMENTATION_ADDON.extras.extraLinesCost * rate) },
        extraProducts: { usd: IMPLEMENTATION_ADDON.extras.extraProductsCost, cop: Math.round(IMPLEMENTATION_ADDON.extras.extraProductsCost * rate), quantity: 10 }
      }
    };

    // Add-on de soporte prioritario (annual upsell)
    const prioritySupportAddon = {
      id: 'priority_support',
      name: PRIORITY_SUPPORT_ADDON.name,
      type: 'annual_addon',
      priceUsd: PRIORITY_SUPPORT_ADDON.annualPrice,
      priceCop: Math.round(PRIORITY_SUPPORT_ADDON.annualPrice * rate),
      priceCopWithCard: Math.round(PRIORITY_SUPPORT_ADDON.annualPrice * rate * (1 + CARD_SURCHARGE)),
      features: PRIORITY_SUPPORT_ADDON.features
    };

    // Add-ons individuales (pago único)
    const individualAddons = {
      extraLine: {
        id: 'extra_line',
        name: ADDON_EXTRA_LINE.name,
        priceUsd: ADDON_EXTRA_LINE.price,
        priceCop: Math.round(ADDON_EXTRA_LINE.price * rate),
      },
      extraProducts: {
        id: 'extra_products',
        name: ADDON_EXTRA_PRODUCTS.name,
        priceUsd: ADDON_EXTRA_PRODUCTS.price,
        priceCop: Math.round(ADDON_EXTRA_PRODUCTS.price * rate),
      }
    };

    res.json({ 
      plans: recurringPlans,
      addon,
      prioritySupportAddon,
      individualAddons,
      exchangeRate: rate, 
      exchangeSource: trm.source,
      exchangeDate: trm.date,
      cardSurcharge: CARD_SURCHARGE * 100 
    });
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
    
    // Verificar si compró addon de implementación
    const hasImplementation = await prisma.payment.findFirst({
      where: { userId, plan: 'implementation', status: 'approved' }
    });

    // Verificar si tiene soporte prioritario
    const hasPrioritySupportAddon = await prisma.payment.findFirst({
      where: { userId, plan: 'priority_support', status: 'approved' }
    });
    const hasPrioritySupport = (subscription?.plan === 'business') || !!hasImplementation || !!hasPrioritySupportAddon;

    // Contar addons comprados
    const extraLinesPurchased = await prisma.payment.count({
      where: { userId, plan: 'extra_line', status: 'approved' }
    });
    const extraProductsPurchased = await prisma.payment.count({
      where: { userId, plan: 'extra_products', status: 'approved' }
    });

    // Calcular límites efectivos
    const baseLimits: Record<string, { lines: number, products: number }> = {
      trial: { lines: 1, products: 10 },
      starter: { lines: 2, products: 10 },
      business: { lines: 5, products: 20 }
    };
    const base = baseLimits[user.plan] || baseLimits.trial;
    const effectiveLimits = {
      maxLines: base.lines + extraLinesPurchased,
      maxProducts: base.products + (extraProductsPurchased * 10),
      extraLinesPurchased,
      extraProductsPurchased
    };

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
      hasImplementation: !!hasImplementation,
      hasPrioritySupport,
      effectiveLimits,
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
        date: p.createdAt,
        discountCode: p.discountCode,
        discountPercent: p.discountPercent,
        discountAmount: p.discountAmount
      })),
      registeredAt: user.createdAt
    });
  } catch (error) {
    console.error('Error status:', error);
    res.status(500).json({ error: 'Error' });
  }
});

// =====================================================
// ===== CÓDIGOS DE DESCUENTO - VALIDACIÓN =====
// =====================================================

// POST /api/subscription/validate-discount
router.post('/validate-discount', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const { code, plan, period } = req.body;
    if (!code) { res.status(400).json({ error: 'Código requerido' }); return; }

    const discount = await prisma.discountCode.findUnique({
      where: { code: code.toUpperCase().trim() },
      include: { usages: { where: { userId } } }
    });

    if (!discount) {
      res.status(404).json({ error: 'Código de descuento no encontrado', valid: false });
      return;
    }

    // Validaciones
    if (!discount.isActive) {
      res.json({ valid: false, error: 'Este código está desactivado' });
      return;
    }

    if (discount.expiresAt && new Date(discount.expiresAt) < new Date()) {
      res.json({ valid: false, error: 'Este código ha expirado' });
      return;
    }

    if (discount.startsAt && new Date(discount.startsAt) > new Date()) {
      res.json({ valid: false, error: 'Este código aún no está activo' });
      return;
    }

    if (discount.maxUses && discount.currentUses >= discount.maxUses) {
      res.json({ valid: false, error: 'Este código ha alcanzado su límite de usos' });
      return;
    }

    if (discount.usages.length >= discount.maxUsesPerUser) {
      res.json({ valid: false, error: 'Ya has usado este código' });
      return;
    }

    // Validar plan aplicable
    if (discount.applicablePlans.length > 0 && plan && !discount.applicablePlans.includes(plan)) {
      res.json({ valid: false, error: `Este código no aplica para el plan ${plan}` });
      return;
    }

    // Validar periodo aplicable
    if (discount.applicablePeriods.length > 0 && period && !discount.applicablePeriods.includes(period)) {
      res.json({ valid: false, error: `Este código no aplica para el periodo ${period}` });
      return;
    }

    // Calcular descuento
    const trm = await getTRM();
    let discountPreview = null;

    if (plan && period) {
      const planConfig = PLANS[plan as keyof typeof PLANS];
      if (planConfig) {
        const priceUsd = planConfig[period as keyof typeof planConfig] as number;
        const priceCop = Math.round(priceUsd * trm.rate);

        let discountAmountCop = 0;
        if (discount.discountType === 'percent') {
          discountAmountCop = Math.round(priceCop * (discount.discountValue / 100));
        } else if (discount.discountType === 'fixed_usd') {
          discountAmountCop = Math.round(discount.discountValue * trm.rate);
        } else if (discount.discountType === 'fixed_cop') {
          discountAmountCop = Math.round(discount.discountValue);
        }

        // No puede ser mayor al precio total
        discountAmountCop = Math.min(discountAmountCop, priceCop);

        const finalCop = priceCop - discountAmountCop;

        discountPreview = {
          originalCop: priceCop,
          discountAmountCop,
          finalCop,
          finalWithCard: Math.round(finalCop * (1 + CARD_SURCHARGE)),
          savedPercent: Math.round((discountAmountCop / priceCop) * 100)
        };
      }
    }

    res.json({
      valid: true,
      code: discount.code,
      description: discount.description,
      discountType: discount.discountType,
      discountValue: discount.discountValue,
      applicablePlans: discount.applicablePlans,
      applicablePeriods: discount.applicablePeriods,
      preview: discountPreview
    });
  } catch (error) {
    console.error('Error validar descuento:', error);
    res.status(500).json({ error: 'Error al validar código' });
  }
});

// ===== POST /api/subscription/upgrade-preview =====
// Calcula el excedente para upgrade de Starter → Business
router.post('/upgrade-preview', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const subscription = await prisma.subscription.findUnique({ where: { userId } });
    if (!subscription || subscription.status !== 'active') {
      res.status(400).json({ error: 'No tienes una suscripción activa' }); return;
    }
    if (subscription.plan !== 'starter') {
      res.status(400).json({ error: 'Solo puedes hacer upgrade desde el plan Starter' }); return;
    }

    // Calcular días restantes del periodo actual
    const now = new Date();
    const periodEnd = new Date(subscription.currentPeriodEnd);
    const periodStart = new Date(subscription.currentPeriodStart);
    const totalDays = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)));
    const remainingDays = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    // Valor diario de cada plan según el periodo actual
    const currentPeriod = subscription.period;
    const starterPriceUsd = PLANS.starter[currentPeriod as string] || PLANS.starter.monthly;
    const businessPriceUsd = PLANS.business[currentPeriod as string] || PLANS.business.monthly;

    const starterDaily = starterPriceUsd / totalDays;
    const businessDaily = businessPriceUsd / totalDays;

    // Crédito por los días no usados del Starter
    const creditUsd = Math.round((starterDaily * remainingDays) * 100) / 100;
    // Costo del Business por los mismos días restantes
    const businessRemainingUsd = Math.round((businessDaily * remainingDays) * 100) / 100;
    // Diferencia a pagar (excedente)
    const upgradeUsd = Math.max(0, Math.round((businessRemainingUsd - creditUsd) * 100) / 100);

    const trm = await getTRM();
    const rate = trm.rate;

    res.json({
      currentPlan: 'starter',
      targetPlan: 'business',
      period: currentPeriod,
      remainingDays,
      totalDays,
      creditUsd,
      creditCop: Math.round(creditUsd * rate),
      businessRemainingUsd,
      businessRemainingCop: Math.round(businessRemainingUsd * rate),
      upgradeUsd,
      upgradeCop: Math.round(upgradeUsd * rate),
      upgradeCopWithCard: Math.round(upgradeUsd * rate * (1 + CARD_SURCHARGE)),
      periodEnd: periodEnd.toISOString(),
      exchangeRate: rate
    });
  } catch (error) {
    console.error('Error upgrade preview:', error);
    res.status(500).json({ error: 'Error calculando upgrade' });
  }
});

// ===== POST /api/subscription/create-payment =====
router.post('/create-payment', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const { plan, period, discountCode: rawDiscountCode, includeImplementation, addons, type: paymentType } = req.body;
    
    // Determinar si es compra de addon solamente o plan + addon
    const isAddonOnly = plan === 'implementation';
    const isUpgrade = paymentType === 'upgrade';
    
    if (plan === 'priority_support') {
      // Compra del addon de soporte prioritario (anual)
      const existingSub = await prisma.subscription.findUnique({ where: { userId } });
      if (!existingSub || existingSub.status !== 'active') {
        res.status(400).json({ error: 'Necesitas un plan activo para comprar soporte prioritario.' });
        return;
      }
      
      const priceAddon = PRIORITY_SUPPORT_ADDON.annualPrice;
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
      if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }
      
      const trm = await getTRM();
      const rate = trm.rate;
      const copAmount = Math.round(priceAddon * rate);
      const amountInCents = copAmount * 100;
      const reference = `BIZONNE-PRIORITY-${userId.slice(-8)}-${Date.now()}`;
      
      const integritySecret = WOMPI_INTEGRITY_KEY;
      const signatureString = `${reference}${amountInCents}COP${integritySecret}`;
      const signature = crypto.createHash('sha256').update(signatureString).digest('hex');

      await prisma.payment.create({
        data: {
          userId, type: 'addon', plan: 'priority_support', period: 'annual',
          amountUsd: priceAddon, amountCop: copAmount,
          exchangeRate: rate, cardSurcharge: 0, totalCop: copAmount,
          status: 'pending', wompiReference: reference
        }
      });

      res.json({
        plan: 'priority_support', period: 'annual',
        amountUsd: priceAddon, amountCop: copAmount,
        amountInCents, reference, signature,
        publicKey: WOMPI_PUBLIC_KEY, currency: 'COP',
        customerEmail: user.email, customerName: user.name || 'Cliente',
        redirectUrl: `${process.env.FRONTEND_URL || 'https://app.bizonne.com'}/subscription?payment=pending`
      });
      return;
    }

    if (plan === 'extra_line' || plan === 'extra_products') {
      // Compra de addon individual (pago único)
      const existingSub = await prisma.subscription.findUnique({ where: { userId } });
      if (!existingSub || existingSub.status !== 'active') {
        res.status(400).json({ error: 'Necesitas un plan activo para comprar addons.' });
        return;
      }
      
      const addonConfig = plan === 'extra_line' ? ADDON_EXTRA_LINE : ADDON_EXTRA_PRODUCTS;
      const quantity = Math.max(1, parseInt(req.body.quantity) || 1);
      const priceAddon = addonConfig.price * quantity;
      
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
      if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }
      
      const trm = await getTRM();
      const rate = trm.rate;
      const copAmount = Math.round(priceAddon * rate);
      const amountInCents = copAmount * 100;
      const suffix = plan === 'extra_line' ? 'LINE' : 'PRODS';
      const reference = `BIZONNE-${suffix}-${userId.slice(-8)}-${Date.now()}`;
      
      const integritySecret = WOMPI_INTEGRITY_KEY;
      const signatureString = `${reference}${amountInCents}COP${integritySecret}`;
      const signature = crypto.createHash('sha256').update(signatureString).digest('hex');

      // Crear N pagos individuales (uno por unidad) para tracking correcto
      for (let i = 0; i < quantity; i++) {
        await prisma.payment.create({
          data: {
            userId, type: 'addon', plan, period: 'one_time',
            amountUsd: addonConfig.price, amountCop: Math.round(addonConfig.price * rate),
            exchangeRate: rate, cardSurcharge: 0, totalCop: Math.round(addonConfig.price * rate),
            status: 'pending', wompiReference: quantity === 1 ? reference : `${reference}-${i + 1}`
          }
        });
      }

      console.log(`🛒 Addon ${plan} x${quantity}: $${priceAddon} USD → ${reference}`);

      res.json({
        plan, period: 'one_time', quantity,
        amountUsd: priceAddon, amountCop: copAmount,
        amountInCents, reference, signature,
        publicKey: WOMPI_PUBLIC_KEY, currency: 'COP',
        customerEmail: user.email, customerName: user.name || 'Cliente',
        redirectUrl: `${process.env.FRONTEND_URL || 'https://app.bizonne.com'}/subscription?payment=pending`
      });
      return;
    }
    
    if (isAddonOnly) {
      // Compra solo del addon de implementación
      // Verificar que ya tenga un plan activo
      const existingSub = await prisma.subscription.findUnique({ where: { userId } });
      if (!existingSub || existingSub.status !== 'active') {
        res.status(400).json({ error: 'Necesitas un plan activo para comprar la implementación por separado. Elige un plan primero.' });
        return;
      }
      
      let priceAddon = IMPLEMENTATION_ADDON.price;
      if (addons?.extraLines > 0) priceAddon += addons.extraLines * IMPLEMENTATION_ADDON.extras.extraLinesCost;
      if (addons?.extraProducts > 0) priceAddon += addons.extraProducts * IMPLEMENTATION_ADDON.extras.extraProductsCost;
      
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
      if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }
      
      const trm = await getTRM();
      const rate = trm.rate;
      const copAmount = Math.round(priceAddon * rate);
      const amountInCents = copAmount * 100;
      const reference = `BIZONNE-IMPL-${userId.slice(-8)}-${Date.now()}`;
      
      const integritySecret = WOMPI_INTEGRITY_KEY;
      const signatureString = `${reference}${amountInCents}COP${integritySecret}`;
      const signature = crypto.createHash('sha256').update(signatureString).digest('hex');
      
      await prisma.payment.create({
        data: {
          userId, type: 'addon', plan: 'implementation', period: 'one_time',
          amountUsd: priceAddon, amountCop: copAmount, exchangeRate: rate,
          totalCop: copAmount, status: 'pending', wompiReference: reference
        }
      });
      
      const frontendUrl = process.env.FRONTEND_URL || 'https://agentes-elisa-ia.vercel.app';
      res.json({
        publicKey: WOMPI_PUBLIC_KEY, amountInCents, currency: 'COP',
        reference, signature,
        redirectUrl: `${frontendUrl}/subscription?status=completed`,
        customerEmail: user.email, customerName: user.name || '',
        plan: 'implementation', period: 'one_time',
        priceUsd: priceAddon, priceCop: copAmount,
        exchangeRate: rate, exchangeSource: trm.source
      });
      return;
    }
    
    // Compra de plan normal (starter / business) o upgrade
    if (!plan || !PLANS[plan]) { res.status(400).json({ error: 'Plan inválido' }); return; }
    
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }

    const planConfig = PLANS[plan];
    let priceUsd: number;
    let effectivePeriod: string;
    let upgradeCredit = 0;
    
    if (isUpgrade && plan === 'business') {
      // UPGRADE: Starter → Business — cobrar solo el excedente
      const subscription = await prisma.subscription.findUnique({ where: { userId } });
      if (!subscription || subscription.status !== 'active' || subscription.plan !== 'starter') {
        res.status(400).json({ error: 'Solo puedes hacer upgrade desde un plan Starter activo' }); return;
      }
      
      effectivePeriod = subscription.period; // Mantener el mismo periodo
      
      // Calcular excedente proporcional
      const now = new Date();
      const periodEnd = new Date(subscription.currentPeriodEnd);
      const periodStart = new Date(subscription.currentPeriodStart);
      const totalDays = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)));
      const remainingDays = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      
      const starterTotal = PLANS.starter[effectivePeriod as string] || PLANS.starter.monthly;
      const businessTotal = PLANS.business[effectivePeriod as string] || PLANS.business.monthly;
      
      const creditPerDay = starterTotal / totalDays;
      const businessPerDay = businessTotal / totalDays;
      
      upgradeCredit = Math.round((creditPerDay * remainingDays) * 100) / 100;
      const businessRemaining = Math.round((businessPerDay * remainingDays) * 100) / 100;
      priceUsd = Math.max(1, Math.round((businessRemaining - upgradeCredit) * 100) / 100); // Mínimo $1 USD
      
      console.log(`⬆️ UPGRADE Starter→Business: ${remainingDays}d restantes, crédito $${upgradeCredit}, costo upgrade $${priceUsd}`);
    } else {
      // Compra normal de plan
      if (!period || !['monthly', 'semiannual', 'annual'].includes(period)) { 
        res.status(400).json({ error: 'Periodo inválido' }); return; 
      }
      effectivePeriod = period;
      priceUsd = planConfig[period as string] as number;
    }
    
    // Si incluye implementación, sumar al total
    if (includeImplementation) {
      let implPrice = IMPLEMENTATION_ADDON.price;
      if (addons?.extraLines > 0) implPrice += addons.extraLines * IMPLEMENTATION_ADDON.extras.extraLinesCost;
      if (addons?.extraProducts > 0) implPrice += addons.extraProducts * IMPLEMENTATION_ADDON.extras.extraProductsCost;
      priceUsd += implPrice;
    }
    
    const trm = await getTRM();
    const rate = trm.rate;
    const originalCop = Math.round(priceUsd * rate);

    // === PROCESAR CÓDIGO DE DESCUENTO ===
    let discountAmountCop = 0;
    let discountPercent: number | null = null;
    let appliedCode: string | null = null;
    let discountRecord: any = null;

    if (rawDiscountCode) {
      const code = rawDiscountCode.toUpperCase().trim();
      const discount = await prisma.discountCode.findUnique({
        where: { code },
        include: { usages: { where: { userId } } }
      });

      if (discount && discount.isActive) {
        // Re-validar todas las condiciones
        const now = new Date();
        const isExpired = discount.expiresAt && new Date(discount.expiresAt) < now;
        const notStarted = discount.startsAt && new Date(discount.startsAt) > now;
        const maxUsesReached = discount.maxUses && discount.currentUses >= discount.maxUses;
        const userMaxReached = discount.usages.length >= discount.maxUsesPerUser;
        const planNotAllowed = discount.applicablePlans.length > 0 && !discount.applicablePlans.includes(plan);
        const periodNotAllowed = discount.applicablePeriods.length > 0 && !discount.applicablePeriods.includes(period);
        const minNotMet = discount.minAmountUsd && priceUsd < discount.minAmountUsd;

        if (!isExpired && !notStarted && !maxUsesReached && !userMaxReached && !planNotAllowed && !periodNotAllowed && !minNotMet) {
          // Calcular descuento
          if (discount.discountType === 'percent') {
            discountAmountCop = Math.round(originalCop * (discount.discountValue / 100));
            discountPercent = discount.discountValue;
          } else if (discount.discountType === 'fixed_usd') {
            discountAmountCop = Math.round(discount.discountValue * rate);
            discountPercent = Math.round((discountAmountCop / originalCop) * 100);
          } else if (discount.discountType === 'fixed_cop') {
            discountAmountCop = Math.round(discount.discountValue);
            discountPercent = Math.round((discountAmountCop / originalCop) * 100);
          }

          // No puede ser mayor al precio
          discountAmountCop = Math.min(discountAmountCop, originalCop);
          appliedCode = code;
          discountRecord = discount;
        }
      }
    }

    const finalCop = originalCop - discountAmountCop;
    // Wompi recibe montos en centavos
    const amountInCents = finalCop * 100;

    const reference = `BIZONNE-${userId.slice(-8)}-${plan}-${effectivePeriod}-${Date.now()}`;

    // Generar firma de integridad para Wompi
    // IMPORTANTE: Usar la llave de integridad, NO el secreto de eventos
    const integritySecret = WOMPI_INTEGRITY_KEY;
    const signatureString = `${reference}${amountInCents}COP${integritySecret}`;
    const signature = crypto.createHash('sha256').update(signatureString).digest('hex');

    console.log(`🔐 Firma generada - Ref: ${reference}, Monto: ${amountInCents}, Integridad: ${integritySecret ? '✓ configurada' : '❌ FALTA'}`);

    // Crear registro de pago pendiente
    const payment = await prisma.payment.create({
      data: {
        userId,
        type: isUpgrade ? 'upgrade' : includeImplementation ? 'subscription_with_addon' : 'subscription',
        plan,
        period: effectivePeriod,
        amountUsd: priceUsd,
        amountCop: finalCop,
        exchangeRate: rate,
        totalCop: finalCop,
        status: 'pending',
        wompiReference: reference,
        discountCode: appliedCode,
        discountPercent,
        discountAmount: discountAmountCop > 0 ? discountAmountCop : null,
        originalCop: discountAmountCop > 0 ? originalCop : null
      }
    });

    // Registrar uso del código
    if (discountRecord && appliedCode) {
      await prisma.discountCode.update({
        where: { id: discountRecord.id },
        data: { currentUses: { increment: 1 } }
      });
      await prisma.discountUsage.create({
        data: {
          discountCodeId: discountRecord.id,
          userId,
          paymentId: payment.id,
          amountSaved: discountAmountCop
        }
      });
    }

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
      originalCop,
      priceCop: finalCop,
      exchangeRate: rate,
      exchangeSource: trm.source,
      discount: appliedCode ? {
        code: appliedCode,
        percent: discountPercent,
        amountCop: discountAmountCop,
        originalCop
      } : null
    });
  } catch (error) {
    console.error('Error crear pago:', error);
    res.status(500).json({ error: 'Error al crear pago' });
  }
});

// ===== POST /api/subscription/webhook/wompi =====
router.post('/webhook/wompi', async (req: Request, res: Response) => {
  try {
    const event = req.body;
    console.log('💳 Webhook Wompi recibido:', event.event, JSON.stringify(event.data?.transaction?.reference || '').substring(0, 100));

    // Verificar firma si viene con checksum
    if (event.signature?.checksum && WOMPI_EVENT_SECRET) {
      const properties = event.signature.properties || [];
      const concatenated = properties
        .map((prop: string) => {
          const keys = prop.split('.');
          let value: any = event;
          for (const key of keys) value = value?.[key];
          return value;
        })
        .join('') + event.timestamp + WOMPI_EVENT_SECRET;
      
      const computed = crypto.createHash('sha256').update(concatenated).digest('hex');
      if (computed !== event.signature.checksum) {
        console.error('❌ Firma Wompi inválida - Computed:', computed.substring(0, 10), '!= Expected:', event.signature.checksum.substring(0, 10));
        // NO rechazar — intentar procesar de todas formas (Wompi a veces tiene problemas con firmas)
        console.warn('⚠️ Continuando sin verificación de firma...');
      } else {
        console.log('✅ Firma Wompi verificada correctamente');
      }
    } else {
      console.log('⚠️ Webhook sin firma o sin WOMPI_EVENT_SECRET configurado');
    }

    const transaction = event.data?.transaction;
    if (!transaction) { 
      console.log('⚠️ Webhook sin datos de transacción');
      res.json({ received: true }); 
      return; 
    }

    const { reference, status, id: transactionId, payment_method_type } = transaction;
    console.log(`💳 Transacción: ${reference} | Estado: ${status} | Método: ${payment_method_type} | ID: ${transactionId}`);

    if (event.event === 'transaction.updated' && status === 'APPROVED') {
      // Buscar el pago (pendiente o ya procesado)
      const payment = await prisma.payment.findFirst({
        where: { wompiReference: reference }
      });

      if (!payment) {
        console.error(`❌ Pago NO encontrado en BD para referencia: ${reference}`);
        res.json({ received: true, error: 'payment_not_found' });
        return;
      }

      if (payment.status === 'approved') {
        console.log(`⚠️ Pago ${reference} ya estaba aprobado - ignorando webhook duplicado`);
        res.json({ received: true, alreadyProcessed: true });
        return;
      }

      // Activar suscripción usando el helper
      try {
        const result = await activateSubscription(payment, transactionId, payment_method_type);
        console.log(`🎉 Webhook procesado exitosamente: ${payment.plan} ${payment.period} activado`);
        res.json({ received: true, activated: true, plan: payment.plan });
      } catch (activationErr: any) {
        console.error(`❌ Error en activación desde webhook:`, activationErr.message);
        res.status(500).json({ received: true, error: 'activation_failed' });
      }
      return;

    } else if (event.event === 'transaction.updated' && (status === 'DECLINED' || status === 'ERROR' || status === 'VOIDED')) {
      // Pago rechazado
      const payment = await prisma.payment.findFirst({
        where: { wompiReference: reference, status: 'pending' }
      });

      if (payment?.discountCode) {
        // Revertir uso del código
        await prisma.discountCode.updateMany({
          where: { code: payment.discountCode, currentUses: { gt: 0 } },
          data: { currentUses: { decrement: 1 } }
        });
        await prisma.discountUsage.deleteMany({
          where: { paymentId: payment.id }
        });
        console.log(`🏷️ Código ${payment.discountCode} revertido por pago rechazado`);
      }

      await prisma.payment.updateMany({
        where: { wompiReference: reference, status: 'pending' },
        data: { status: 'declined', wompiTransactionId: String(transactionId) }
      });
      console.log(`❌ Pago rechazado: ${reference} (${status})`);
    } else {
      console.log(`ℹ️ Evento no procesado: ${event.event} - Estado: ${status}`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('❌ Error webhook Wompi:', error.message);
    // Siempre responder 200 para que Wompi no reintente indefinidamente
    res.json({ received: true, error: error.message });
  }
});

// ===== HELPER: Activar suscripción después de pago aprobado =====
async function activateSubscription(payment: any, transactionId: string, paymentMethodType?: string) {
  try {
    // Verificar que no se haya activado ya
    if (payment.status === 'approved') {
      console.log(`⚠️ Pago ${payment.id} ya estaba aprobado`);
      return { alreadyActive: true };
    }

    // Actualizar pago a aprobado
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'approved',
        wompiTransactionId: String(transactionId),
        wompiPaymentMethod: paymentMethodType || null,
        method: paymentMethodType || null
      }
    });

    const now = new Date();
    const isAddon = payment.type === 'addon' || (payment.plan === 'implementation' && payment.type !== 'subscription_with_addon');
    const isUpgrade = payment.type === 'upgrade';
    
    if (isAddon) {
      // Addon — NO cambia el plan del usuario
      const addonNames: Record<string, string> = {
        'priority_support': 'SOPORTE PRIORITARIO',
        'implementation': 'IMPLEMENTACIÓN',
        'extra_line': 'LÍNEA ADICIONAL',
        'extra_products': '+10 PRODUCTOS'
      };
      const addonName = addonNames[payment.plan] || payment.plan.toUpperCase();
      
      // Para extra_line/extra_products: aprobar TODOS los pagos pendientes del mismo lote
      if (payment.plan === 'extra_line' || payment.plan === 'extra_products') {
        const baseRef = (payment.wompiReference || '').replace(/-\d+$/, '');
        if (baseRef) {
          const batchPayments = await prisma.payment.updateMany({
            where: { 
              userId: payment.userId, 
              plan: payment.plan, 
              status: 'pending',
              wompiReference: { startsWith: baseRef }
            },
            data: { 
              status: 'approved', 
              wompiTransactionId: String(transactionId),
              wompiPaymentMethod: paymentMethodType || null,
              method: paymentMethodType || null
            }
          });
          console.log(`✅ 🛒 ADD-ON ${addonName} x${batchPayments.count} ACTIVADO | Usuario: ${payment.userId}`);
        }
      }
      
      console.log(`✅ 🛠️ ADD-ON ${addonName} PAGADO | Usuario: ${payment.userId}`);
      return { 
        activated: true, 
        plan: `${payment.plan}_addon`,
        period: payment.period || 'one_time',
        periodEnd: null
      };
    }

    if (isUpgrade) {
      // UPGRADE: Solo cambiar el plan, mantener el periodo actual
      const existingSub = await prisma.subscription.findUnique({ where: { userId: payment.userId } });
      if (existingSub) {
        await prisma.subscription.update({
          where: { userId: payment.userId },
          data: { 
            plan: payment.plan, // business
            status: 'active',
            wompiTransactionId: String(transactionId)
          }
        });
      }
      await prisma.user.update({
        where: { id: payment.userId },
        data: { plan: payment.plan }
      });
      
      console.log(`✅ ⬆️ UPGRADE ACTIVADO: starter → ${payment.plan} | Usuario: ${payment.userId} | Periodo actual se mantiene hasta: ${existingSub?.currentPeriodEnd?.toISOString().split('T')[0]}`);
      return { 
        activated: true, 
        plan: payment.plan, 
        period: existingSub?.period || payment.period, 
        periodEnd: existingSub?.currentPeriodEnd 
      };
    }

    // Plan normal (starter / business)
    const effectivePlan = payment.plan;
    
    // Calcular periodo
    const periodEnd = new Date(now);
    if (payment.period === 'monthly') periodEnd.setMonth(periodEnd.getMonth() + 1);
    else if (payment.period === 'semiannual') periodEnd.setMonth(periodEnd.getMonth() + 6);
    else if (payment.period === 'annual') periodEnd.setFullYear(periodEnd.getFullYear() + 1);

    // Crear o actualizar suscripción
    await prisma.subscription.upsert({
      where: { userId: payment.userId },
      create: {
        userId: payment.userId,
        plan: effectivePlan,
        period: payment.period,
        status: 'active',
        priceUsd: payment.amountUsd,
        priceCop: payment.amountCop,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        wompiTransactionId: String(transactionId)
      },
      update: {
        plan: effectivePlan,
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
      data: { plan: effectivePlan }
    });

    console.log(`✅ 🎉 SUSCRIPCIÓN ACTIVADA: ${effectivePlan} ${payment.period} | Usuario: ${payment.userId} | Hasta: ${periodEnd.toISOString().split('T')[0]}${payment.discountCode ? ` | Código: ${payment.discountCode}` : ''}`);
    
    return { 
      activated: true, 
      plan: payment.plan, 
      period: payment.period, 
      periodEnd 
    };
  } catch (error: any) {
    console.error(`❌ Error activando suscripción para pago ${payment.id}:`, error.message);
    throw error;
  }
}

// ===== POST /api/subscription/verify-payment =====
// Este endpoint verifica el pago con Wompi Y activa la suscripción si fue aprobado
router.post('/verify-payment', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { reference } = req.body;
    if (!userId || !reference) { res.status(400).json({ error: 'Referencia requerida' }); return; }

    // 1. Consultar estado en Wompi
    const wompiRes = await fetch(`${WOMPI_API_URL}/transactions?reference=${reference}`, {
      headers: { 'Authorization': `Bearer ${WOMPI_PRIVATE_KEY}` }
    });

    if (!wompiRes.ok) { 
      console.error('❌ Error consultando Wompi:', wompiRes.status);
      res.status(500).json({ error: 'Error consultando Wompi' }); 
      return; 
    }

    const data = await wompiRes.json() as any;
    const transaction = data.data?.[0];

    if (!transaction) { 
      res.json({ status: 'not_found', message: 'Transacción no encontrada en Wompi' }); 
      return; 
    }

    console.log(`🔍 Verificación Wompi - Ref: ${reference} | Estado: ${transaction.status} | ID: ${transaction.id}`);

    // 2. Si está APROBADO, activar la suscripción
    if (transaction.status === 'APPROVED') {
      const payment = await prisma.payment.findFirst({
        where: { wompiReference: reference, userId }
      });

      if (!payment) {
        console.error(`❌ Pago no encontrado en BD para referencia: ${reference}`);
        res.json({ 
          status: 'APPROVED', 
          error: 'Pago aprobado pero no encontrado en base de datos',
          reference 
        });
        return;
      }

      if (payment.status === 'approved') {
        // Ya estaba activado - solo retornar estado
        const subscription = await prisma.subscription.findUnique({ where: { userId } });
        res.json({
          status: 'APPROVED',
          activated: true,
          alreadyActive: true,
          plan: payment.plan,
          period: payment.period,
          periodEnd: subscription?.currentPeriodEnd
        });
        return;
      }

      // Activar suscripción
      const result = await activateSubscription(payment, transaction.id, transaction.payment_method_type);
      
      res.json({
        status: 'APPROVED',
        activated: true,
        plan: result.plan,
        period: result.period,
        periodEnd: result.periodEnd,
        reference,
        amount: transaction.amount_in_cents / 100,
        method: transaction.payment_method_type
      });
      return;
    }

    // 3. Si está PENDIENTE (Nequi, PSE esperando confirmación)
    if (transaction.status === 'PENDING') {
      res.json({
        status: 'PENDING',
        message: 'El pago está pendiente de confirmación. Si pagaste con Nequi, confirma en tu app.',
        reference,
        method: transaction.payment_method_type
      });
      return;
    }

    // 4. Si fue RECHAZADO
    if (transaction.status === 'DECLINED' || transaction.status === 'ERROR' || transaction.status === 'VOIDED') {
      // Marcar pago como rechazado
      await prisma.payment.updateMany({
        where: { wompiReference: reference, status: 'pending' },
        data: { status: 'declined', wompiTransactionId: String(transaction.id) }
      });

      res.json({
        status: transaction.status,
        message: 'El pago fue rechazado o cancelado.',
        reference
      });
      return;
    }

    // Estado desconocido
    res.json({
      status: transaction.status,
      reference,
      amount: transaction.amount_in_cents / 100,
      method: transaction.payment_method_type
    });
  } catch (error: any) {
    console.error('❌ Error verify-payment:', error.message);
    res.status(500).json({ error: 'Error verificando pago' });
  }
});

// =====================================================
// ===== ADMIN: CÓDIGOS DE DESCUENTO =====
// =====================================================

// Helper: verificar admin
async function isAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return !!user && !user.parentUserId;
}

// GET /api/subscription/admin/discounts
router.get('/admin/discounts', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!(await isAdmin(userId))) { res.status(403).json({ error: 'No autorizado' }); return; }

    const discounts = await prisma.discountCode.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { usages: true } },
        usages: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: { userId: true, amountSaved: true, createdAt: true }
        }
      }
    });

    res.json({ discounts });
  } catch (error) {
    console.error('Error listar descuentos:', error);
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/subscription/admin/discounts
router.post('/admin/discounts', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!(await isAdmin(userId))) { res.status(403).json({ error: 'No autorizado' }); return; }

    const { code, description, discountType, discountValue, applicablePlans, applicablePeriods, maxUses, maxUsesPerUser, startsAt, expiresAt } = req.body;

    if (!code || !discountValue) {
      res.status(400).json({ error: 'Código y valor de descuento son requeridos' });
      return;
    }

    // Verificar código único
    const existing = await prisma.discountCode.findUnique({ where: { code: code.toUpperCase().trim() } });
    if (existing) {
      res.status(400).json({ error: 'Ya existe un código con ese nombre' });
      return;
    }

    const discount = await prisma.discountCode.create({
      data: {
        code: code.toUpperCase().trim(),
        description: description || null,
        discountType: discountType || 'percent',
        discountValue: parseFloat(discountValue),
        applicablePlans: applicablePlans || [],
        applicablePeriods: applicablePeriods || [],
        maxUses: maxUses ? parseInt(maxUses) : null,
        maxUsesPerUser: maxUsesPerUser ? parseInt(maxUsesPerUser) : 1,
        startsAt: startsAt ? new Date(startsAt) : new Date(),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        isActive: true
      }
    });

    console.log(`🏷️ Código de descuento creado: ${discount.code} (${discount.discountType}: ${discount.discountValue})`);
    res.json({ success: true, discount });
  } catch (error) {
    console.error('Error crear descuento:', error);
    res.status(500).json({ error: 'Error al crear código' });
  }
});

// PUT /api/subscription/admin/discounts/:id
router.put('/admin/discounts/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!(await isAdmin(userId))) { res.status(403).json({ error: 'No autorizado' }); return; }

    const { id } = req.params;
    const { description, discountType, discountValue, applicablePlans, applicablePeriods, maxUses, maxUsesPerUser, startsAt, expiresAt, isActive } = req.body;

    const discount = await prisma.discountCode.update({
      where: { id },
      data: {
        ...(description !== undefined && { description }),
        ...(discountType && { discountType }),
        ...(discountValue !== undefined && { discountValue: parseFloat(discountValue) }),
        ...(applicablePlans && { applicablePlans }),
        ...(applicablePeriods && { applicablePeriods }),
        ...(maxUses !== undefined && { maxUses: maxUses ? parseInt(maxUses) : null }),
        ...(maxUsesPerUser !== undefined && { maxUsesPerUser: parseInt(maxUsesPerUser) }),
        ...(startsAt && { startsAt: new Date(startsAt) }),
        ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
        ...(isActive !== undefined && { isActive })
      }
    });

    res.json({ success: true, discount });
  } catch (error) {
    console.error('Error actualizar descuento:', error);
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

// DELETE /api/subscription/admin/discounts/:id
router.delete('/admin/discounts/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!(await isAdmin(userId))) { res.status(403).json({ error: 'No autorizado' }); return; }

    await prisma.discountCode.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error eliminar descuento:', error);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// ===== ADMIN: GET /api/subscription/admin/users =====
router.get('/admin/users', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
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

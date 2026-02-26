import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// ===== CONFIG =====
const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY || '';
const WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY || '';
const WOMPI_INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET || '';
const WOMPI_EVENT_SECRET = process.env.WOMPI_EVENT_SECRET || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const APP_URL = process.env.FRONTEND_URL || 'https://crm.bizonne.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Bizonne <noreply@bizonne.com>';

// ===== PRECIOS EN USD =====
const PLAN_PRICES_USD: Record<string, Record<string, { usd: number; label: string }>> = {
  starter: {
    monthly:    { usd: 30, label: 'Bizonne Starter - Mensual' },
    semiannual: { usd: 150, label: 'Bizonne Starter - 6 Meses' },
    annual:     { usd: 250, label: 'Bizonne Starter - Anual' }
  },
  business: {
    monthly:    { usd: 50, label: 'Bizonne Business - Mensual' },
    semiannual: { usd: 250, label: 'Bizonne Business - 6 Meses' },
    annual:     { usd: 420, label: 'Bizonne Business - Anual' }
  }
};

// ===== TRM =====
let cachedTRM: { rate: number; date: string; source: string; updatedAt: number } | null = null;
const TRM_CACHE_DURATION = 4 * 60 * 60 * 1000;

async function getTRM(): Promise<{ rate: number; source: string; date: string }> {
  if (cachedTRM && (Date.now() - cachedTRM.updatedAt) < TRM_CACHE_DURATION) {
    return { rate: cachedTRM.rate, source: cachedTRM.source, date: cachedTRM.date };
  }
  const today = new Date().toISOString().split('T')[0];

  try {
    const banrepUrl = `https://www.datos.gov.co/resource/32sa-8pi3.json?$where=vigenciadesde>='${today}T00:00:00'&$order=vigenciadesde DESC&$limit=1`;
    const res = await fetch(banrepUrl, { signal: AbortSignal.timeout(5000), headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json() as any[];
      if (data.length > 0 && data[0].valor) {
        const rate = parseFloat(data[0].valor);
        if (rate > 3000 && rate < 6000) {
          cachedTRM = { rate, date: data[0].vigenciadesde?.split('T')[0] || today, source: 'Banco de la Republica (TRM oficial)', updatedAt: Date.now() };
          return { rate: cachedTRM.rate, source: cachedTRM.source, date: cachedTRM.date };
        }
      }
    }
  } catch (e) { console.warn('TRM Banrep error:', (e as Error).message); }

  try {
    const res = await fetch('https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde DESC&$limit=1', { signal: AbortSignal.timeout(5000), headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json() as any[];
      if (data.length > 0 && data[0].valor) {
        const rate = parseFloat(data[0].valor);
        if (rate > 3000 && rate < 6000) {
          cachedTRM = { rate, date: data[0].vigenciadesde?.split('T')[0] || today, source: 'Banco de la Republica (TRM reciente)', updatedAt: Date.now() };
          return { rate: cachedTRM.rate, source: cachedTRM.source, date: cachedTRM.date };
        }
      }
    }
  } catch (e) { console.warn('TRM reciente error:', (e as Error).message); }

  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json() as any;
      const rate = data.rates?.COP;
      if (rate && rate > 3000 && rate < 6000) {
        cachedTRM = { rate: Math.round(rate * 100) / 100, date: today, source: 'ExchangeRate API', updatedAt: Date.now() };
        return { rate: cachedTRM.rate, source: cachedTRM.source, date: cachedTRM.date };
      }
    }
  } catch (e) { console.warn('ExchangeRate error:', (e as Error).message); }

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json() as any;
      const rate = data.rates?.COP;
      if (rate && rate > 3000 && rate < 6000) {
        cachedTRM = { rate: Math.round(rate * 100) / 100, date: today, source: 'Open ExchangeRate', updatedAt: Date.now() };
        return { rate: cachedTRM.rate, source: cachedTRM.source, date: cachedTRM.date };
      }
    }
  } catch (e) { console.warn('Open ER error:', (e as Error).message); }

  if (cachedTRM) return { rate: cachedTRM.rate, source: cachedTRM.source + ' (cache)', date: cachedTRM.date };
  return { rate: 4200, source: 'Fallback fijo', date: today };
}

const usdToCopCents = (usd: number, rate: number): number => {
  return Math.round((usd * rate) / 100) * 10000;
};

// ===== HELPERS =====
const generateReference = () => `BIZ-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const generateTempPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pass = '';
  for (let i = 0; i < 10; i++) pass += chars[Math.floor(Math.random() * chars.length)];
  return pass;
};

const generateIntegritySignature = (reference: string, amountInCents: number, currency: string) => {
  const data = `${reference}${amountInCents}${currency}${WOMPI_INTEGRITY_SECRET}`;
  return crypto.createHash('sha256').update(data).digest('hex');
};

const verifyWebhookSignature = (body: any): boolean => {
  try {
    const sig = body?.signature;
    if (!sig?.properties || !sig?.checksum) return false;
    const values = sig.properties.map((prop: string) => {
      const keys = prop.split('.');
      let val: any = body.data?.transaction || body.data;
      for (const k of keys) val = val?.[k];
      return val;
    });
    values.push(body.timestamp);
    values.push(WOMPI_EVENT_SECRET);
    const computed = crypto.createHash('sha256').update(values.join('')).digest('hex');
    return computed === sig.checksum;
  } catch { return false; }
};

const sendEmail = async (to: string, subject: string, html: string) => {
  if (!RESEND_API_KEY) { console.error('RESEND_API_KEY no configurada'); return false; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html })
    });
    const data = await res.json() as any;
    if (!res.ok) { console.error('Resend error:', data); return false; }
    console.log(`Email enviado a ${to}`);
    return true;
  } catch (e: any) { console.error('Email error:', e.message); return false; }
};

const getPlanDuration = (period: string): number => {
  if (period === 'semiannual') return 180;
  if (period === 'annual') return 365;
  return 30;
};

// Email con credenciales de acceso
const buildCredentialsEmail = (email: string, tempPassword: string, planName: string, amount: string, loginUrl: string) => `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0a1a;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
<div style="text-align:center;padding:30px;background:linear-gradient(135deg,#0f3460,#16213e);border-radius:16px 16px 0 0;">
<h1 style="color:#00d4aa;margin:0;font-size:28px;">Pago Confirmado!</h1>
<p style="color:#8892b0;margin:10px 0 0;">Tu cuenta Bizonne CRM esta lista</p></div>
<div style="background:#1a1a2e;padding:30px;border-radius:0 0 16px 16px;">
<p style="color:#e0e0e0;font-size:16px;line-height:1.6;">Tu pago por <strong style="color:#00d4aa;">${planName}</strong> fue procesado exitosamente.</p>
<p style="color:#e0e0e0;font-size:16px;">Monto: <strong style="color:#00d4aa;">${amount}</strong></p>

<div style="margin:25px 0;padding:20px;border-radius:12px;background:#0f2847;border:1px solid #1e4976;">
<p style="color:#8892b0;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Tus credenciales de acceso</p>
<table style="width:100%;border-collapse:collapse;">
<tr><td style="padding:8px 0;color:#8892b0;font-size:14px;">Email:</td><td style="padding:8px 0;color:#00d4aa;font-size:14px;font-weight:bold;">${email}</td></tr>
<tr><td style="padding:8px 0;color:#8892b0;font-size:14px;">Contrasena temporal:</td><td style="padding:8px 0;color:#f59e0b;font-size:16px;font-weight:bold;font-family:monospace;letter-spacing:1px;">${tempPassword}</td></tr>
</table>
</div>

<div style="text-align:center;margin:25px 0;">
<a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#00d4aa,#10b981);color:#000;text-decoration:none;padding:16px 40px;border-radius:12px;font-size:18px;font-weight:bold;">Iniciar Sesion</a></div>

<div style="margin:20px 0;padding:15px;border-radius:10px;background:#f59e0b15;border:1px solid #f59e0b30;">
<p style="color:#f59e0b;font-size:13px;margin:0;">Importante: Cambia tu contrasena despues de iniciar sesion en Configuracion > Cambiar Contrasena.</p></div>

<hr style="border:none;border-top:1px solid #2a2a3e;margin:20px 0;" />
<p style="color:#8892b0;font-size:11px;text-align:center;word-break:break-all;"><a href="${loginUrl}" style="color:#00d4aa;">${loginUrl}</a></p></div>
<p style="color:#4a4a6a;font-size:11px;text-align:center;padding:20px;">Bizonne CRM - Automatiza tu WhatsApp</p></div></body></html>`;

// Crear usuario automáticamente al confirmar pago
const createUserFromPurchase = async (purchase: any): Promise<boolean> => {
  try {
    if (!purchase.buyerEmail) { console.error('No buyer email'); return false; }
    const email = purchase.buyerEmail.trim().toLowerCase();
    
    // Verificar que no exista
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`Usuario ya existe: ${email}, actualizando plan...`);
      const planDays = getPlanDuration(purchase.period);
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + planDays);
      await prisma.user.update({ where: { email }, data: { plan: purchase.plan, trialEndsAt, subscriptionId: purchase.reference } });
      await prisma.purchase.update({ where: { id: purchase.id }, data: { tokenUsed: true, userId: existing.id } });
      return true;
    }
    
    // Generar contraseña temporal
    const tempPassword = generateTempPassword();
    const planDays = getPlanDuration(purchase.period);
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + planDays);
    
    // Crear usuario con plan activo
    const user = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(tempPassword, 10),
        name: purchase.buyerName || null,
        role: 'admin',
        plan: purchase.plan,
        trialEndsAt,
        subscriptionId: purchase.reference
      }
    });
    
    await prisma.purchase.update({ where: { id: purchase.id }, data: { tokenUsed: true, userId: user.id } });
    
    // Enviar email con credenciales
    const priceInfo = PLAN_PRICES_USD[purchase.plan]?.[purchase.period];
    const planLabel = priceInfo?.label || `${purchase.plan} - ${purchase.period}`;
    const amount = `$${(purchase.amountCents / 100).toLocaleString('es-CO')} COP`;
    const loginUrl = `${APP_URL}/login`;
    
    await sendEmail(email, `Tu cuenta Bizonne CRM esta lista - Credenciales de acceso`,
      buildCredentialsEmail(email, tempPassword, planLabel, amount, loginUrl));
    
    console.log(`NUEVO USUARIO PAGADO: ${email} | Plan: ${purchase.plan} (${purchase.period}) | ${planDays} dias | Pass: ${tempPassword}`);
    return true;
  } catch (e: any) {
    console.error('Error creando usuario:', e.message);
    return false;
  }
};


// ===== RUTAS =====

// GET /api/payments/plans
router.get('/plans', async (_req: Request, res: Response) => {
  try {
    const trm = await getTRM();
    const CARD_SURCHARGE = 0.05;
    const plans = Object.entries(PLAN_PRICES_USD).map(([id, periods]) => ({
      id,
      periods: Object.entries(periods).map(([period, info]) => {
        const copCents = usdToCopCents(info.usd, trm.rate);
        const cop = copCents / 100;
        return { period, usd: info.usd, cop: Math.round(cop), copCents, copWithCard: Math.round(cop * (1 + CARD_SURCHARGE)), label: info.label };
      })
    }));
    res.json({ plans, publicKey: WOMPI_PUBLIC_KEY, trm: { rate: trm.rate, source: trm.source, date: trm.date } });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// POST /api/payments/create-checkout
router.post('/create-checkout', async (req: Request, res: Response) => {
  try {
    const { plan, period, email, name } = req.body;
    if (!plan || !period || !email) { res.status(400).json({ error: 'Plan, periodo y email requeridos' }); return; }

    const planPrices = PLAN_PRICES_USD[plan];
    if (!planPrices) { res.status(400).json({ error: 'Plan invalido' }); return; }
    const priceInfo = planPrices[period];
    if (!priceInfo) { res.status(400).json({ error: 'Periodo invalido' }); return; }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existing) { res.status(400).json({ error: 'Este email ya tiene cuenta. Inicia sesion en crm.bizonne.com/login' }); return; }

    const trm = await getTRM();
    const amountInCents = usdToCopCents(priceInfo.usd, trm.rate);
    const reference = generateReference();
    const registrationToken = crypto.randomBytes(32).toString('hex');
    const signature = generateIntegritySignature(reference, amountInCents, 'COP');

    await prisma.purchase.create({
      data: {
        reference, plan, period,
        amountCents: amountInCents, currency: 'COP',
        buyerEmail: cleanEmail, buyerName: name || null,
        registrationToken, status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    console.log(`Checkout: ${reference} | ${priceInfo.label} | USD $${priceInfo.usd} = $${(amountInCents / 100).toLocaleString()} COP (TRM: ${trm.rate})`);

    const checkoutUrl = `https://checkout.wompi.co/p/?public-key=${WOMPI_PUBLIC_KEY}&currency=COP&amount-in-cents=${amountInCents}&reference=${reference}&signature%3Aintegrity=${signature}&redirect-url=${encodeURIComponent(APP_URL + '/payment-result?ref=' + reference)}&customer-data%3Aemail=${encodeURIComponent(cleanEmail)}&customer-data%3Afull-name=${encodeURIComponent(name || '')}`;

    res.json({ reference, checkoutUrl, signature, publicKey: WOMPI_PUBLIC_KEY, amountInCents, cop: amountInCents / 100, usd: priceInfo.usd, trm: { rate: trm.rate, source: trm.source, date: trm.date } });
  } catch (error: any) {
    console.error('Error create-checkout:', error.message);
    res.status(500).json({ error: 'Error al crear pago' });
  }
});

// POST /api/payments/wompi-webhook
router.post('/wompi-webhook', async (req: Request, res: Response) => {
  try {
    const event = req.body;
    console.log('Wompi webhook:', event?.event, '| Ref:', event?.data?.transaction?.reference);

    const transaction = event?.data?.transaction;
    if (!transaction?.reference) { res.json({ ok: true }); return; }

    const { reference, status, id: wompiTxId, payment_method_type, amount_in_cents } = transaction;
    const purchase = await prisma.purchase.findUnique({ where: { reference } });
    if (!purchase) { res.json({ ok: true }); return; }
    if (purchase.status === 'approved') { res.json({ ok: true }); return; }

    const newStatus = status === 'APPROVED' ? 'approved' : status === 'DECLINED' ? 'declined' : status === 'VOIDED' ? 'voided' : status === 'ERROR' ? 'error' : 'pending';

    await prisma.purchase.update({
      where: { reference },
      data: { status: newStatus, wompiTransactionId: wompiTxId || null, wompiStatus: status, paymentMethod: payment_method_type || null, paidAt: newStatus === 'approved' ? new Date() : null }
    });

    console.log(`Pago ${reference}: ${status} (${payment_method_type || 'N/A'}) $${((amount_in_cents || 0) / 100).toLocaleString()} COP`);

    // APROBADO → crear cuenta automáticamente + enviar credenciales
    if (newStatus === 'approved' && purchase.buyerEmail && !purchase.tokenUsed) {
      await createUserFromPurchase(purchase);
    }

    res.json({ ok: true });
  } catch (error: any) {
    console.error('Error wompi-webhook:', error.message);
    res.json({ ok: true });
  }
});

// GET /api/payments/check/:reference
router.get('/check/:reference', async (req: Request, res: Response) => {
  try {
    const { reference } = req.params;
    const purchase = await prisma.purchase.findUnique({ where: { reference } });
    if (!purchase) { res.status(404).json({ error: 'No encontrado' }); return; }

    // Si pending, consultar Wompi directamente
    if (purchase.status === 'pending' && WOMPI_PRIVATE_KEY) {
      try {
        const wr = await fetch(`https://production.wompi.co/v1/transactions?reference=${reference}`, {
          headers: { 'Authorization': `Bearer ${WOMPI_PRIVATE_KEY}` }
        });
        if (wr.ok) {
          const d = await wr.json() as any;
          const tx = d?.data?.[0];
          if (tx && tx.status !== 'PENDING') {
            const ns = tx.status === 'APPROVED' ? 'approved' : tx.status === 'DECLINED' ? 'declined' : tx.status.toLowerCase();
            await prisma.purchase.update({
              where: { reference },
              data: { status: ns, wompiTransactionId: tx.id, wompiStatus: tx.status, paymentMethod: tx.payment_method_type, paidAt: ns === 'approved' ? new Date() : null }
            });
            // Auto-crear usuario si aprobado
            if (ns === 'approved' && purchase.buyerEmail && !purchase.tokenUsed) {
              await createUserFromPurchase(purchase);
            }
            res.json({ status: ns, plan: purchase.plan, period: purchase.period, email: purchase.buyerEmail });
            return;
          }
        }
      } catch (e) { console.error('Error Wompi check:', e); }
    }

    res.json({ status: purchase.status, plan: purchase.plan, period: purchase.period, email: purchase.buyerEmail, tokenUsed: purchase.tokenUsed });
  } catch { res.status(500).json({ error: 'Error' }); }
});

// GET /api/payments/verify-token/:token (mantener por compatibilidad)
router.get('/verify-token/:token', async (req: Request, res: Response) => {
  try {
    const purchase = await prisma.purchase.findUnique({ where: { registrationToken: req.params.token } });
    if (!purchase) { res.status(404).json({ valid: false, error: 'Token no encontrado' }); return; }
    if (purchase.tokenUsed) { res.status(400).json({ valid: false, error: 'Token ya utilizado' }); return; }
    if (purchase.status !== 'approved') { res.status(400).json({ valid: false, error: 'Pago no aprobado' }); return; }
    res.json({ valid: true, plan: purchase.plan, period: purchase.period, email: purchase.buyerEmail, name: purchase.buyerName });
  } catch { res.status(500).json({ valid: false }); }
});

export default router;

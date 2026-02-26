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
const APP_URL = process.env.FRONTEND_URL || 'https://crmauto.bizonne.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Bizonne <noreply@bizonne.com>';

// ===== PRECIOS (centavos COP) — Cambiar aquí =====
const PLAN_PRICES: Record<string, Record<string, { cop_cents: number; usd: number; label: string }>> = {
  starter: {
    monthly:    { cop_cents: 11111100, usd: 30, label: 'Bizonne Starter - Mensual' },
    semiannual: { cop_cents: 55555500, usd: 150, label: 'Bizonne Starter - 6 Meses' },
    annual:     { cop_cents: 92592500, usd: 250, label: 'Bizonne Starter - Anual' }
  },
  business: {
    monthly:    { cop_cents: 18518500, usd: 50, label: 'Bizonne Business - Mensual' },
    semiannual: { cop_cents: 92592500, usd: 250, label: 'Bizonne Business - 6 Meses' },
    annual:     { cop_cents: 155555500, usd: 420, label: 'Bizonne Business - Anual' }
  }
};

// ===== HELPERS =====
const generateReference = () => `BIZ-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const generateRegToken = () => crypto.randomBytes(32).toString('hex');

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

const buildEmail = (url: string, planName: string, amount: string) => `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0a1a;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
<div style="text-align:center;padding:30px;background:linear-gradient(135deg,#0f3460,#16213e);border-radius:16px 16px 0 0;">
<h1 style="color:#00d4aa;margin:0;font-size:28px;">Pago Confirmado!</h1>
<p style="color:#8892b0;margin:10px 0 0;">Gracias por elegir Bizonne CRM</p></div>
<div style="background:#1a1a2e;padding:30px;border-radius:0 0 16px 16px;">
<p style="color:#e0e0e0;font-size:16px;line-height:1.6;">Tu pago por <strong style="color:#00d4aa;">${planName}</strong> fue procesado exitosamente.</p>
<p style="color:#e0e0e0;font-size:16px;">Monto: <strong style="color:#00d4aa;">${amount}</strong></p>
<p style="color:#e0e0e0;font-size:16px;margin-top:20px;">Para activar tu cuenta, haz clic en el boton y crea tu usuario:</p>
<div style="text-align:center;margin:30px 0;">
<a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#00d4aa,#10b981);color:#000;text-decoration:none;padding:16px 40px;border-radius:12px;font-size:18px;font-weight:bold;">Activar Mi Cuenta</a></div>
<p style="color:#8892b0;font-size:12px;text-align:center;">Este enlace es valido por 7 dias.</p>
<hr style="border:none;border-top:1px solid #2a2a3e;margin:20px 0;" />
<p style="color:#8892b0;font-size:11px;text-align:center;word-break:break-all;"><a href="${url}" style="color:#00d4aa;">${url}</a></p></div>
<p style="color:#4a4a6a;font-size:11px;text-align:center;padding:20px;">Bizonne CRM</p></div></body></html>`;


// ===== RUTAS =====

// GET /api/payments/plans
router.get('/plans', async (_req: Request, res: Response) => {
  const plans = Object.entries(PLAN_PRICES).map(([id, periods]) => ({
    id,
    periods: Object.entries(periods).map(([period, info]) => ({
      period, cop: info.cop_cents / 100, copCents: info.cop_cents, usd: info.usd, label: info.label
    }))
  }));
  res.json({ plans, publicKey: WOMPI_PUBLIC_KEY });
});

// POST /api/payments/create-checkout
router.post('/create-checkout', async (req: Request, res: Response) => {
  try {
    const { plan, period, email, name } = req.body;
    if (!plan || !period) { res.status(400).json({ error: 'Plan y periodo requeridos' }); return; }

    const planPrices = PLAN_PRICES[plan];
    if (!planPrices) { res.status(400).json({ error: 'Plan invalido' }); return; }
    const priceInfo = planPrices[period];
    if (!priceInfo) { res.status(400).json({ error: 'Periodo invalido' }); return; }

    if (email) {
      const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      if (existing) { res.status(400).json({ error: 'Este email ya tiene cuenta.' }); return; }
    }

    const reference = generateReference();
    const registrationToken = generateRegToken();
    const amountInCents = priceInfo.cop_cents;
    const signature = generateIntegritySignature(reference, amountInCents, 'COP');

    await prisma.purchase.create({
      data: {
        reference, plan, period,
        amountCents: amountInCents, currency: 'COP',
        buyerEmail: email?.trim().toLowerCase() || null,
        buyerName: name || null,
        registrationToken, status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    console.log(`Checkout: ${reference} | ${priceInfo.label} | $${(amountInCents / 100).toLocaleString()} COP`);

    const checkoutUrl = `https://checkout.wompi.co/p/?public-key=${WOMPI_PUBLIC_KEY}&currency=COP&amount-in-cents=${amountInCents}&reference=${reference}&signature%3Aintegrity=${signature}&redirect-url=${encodeURIComponent(APP_URL + '/payment-result?ref=' + reference)}&customer-data%3Aemail=${encodeURIComponent(email || '')}&customer-data%3Afull-name=${encodeURIComponent(name || '')}`;

    res.json({ reference, checkoutUrl, signature, publicKey: WOMPI_PUBLIC_KEY, amountInCents });
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
      data: {
        status: newStatus, wompiTransactionId: wompiTxId || null,
        wompiStatus: status, paymentMethod: payment_method_type || null,
        paidAt: newStatus === 'approved' ? new Date() : null
      }
    });

    console.log(`Pago ${reference}: ${status} (${payment_method_type || 'N/A'}) $${((amount_in_cents || 0) / 100).toLocaleString()} COP`);

    if (newStatus === 'approved' && purchase.buyerEmail && purchase.registrationToken) {
      const priceInfo = PLAN_PRICES[purchase.plan]?.[purchase.period];
      const registerUrl = `${APP_URL}/register?token=${purchase.registrationToken}&plan=${purchase.plan}`;
      await sendEmail(purchase.buyerEmail, 'Pago confirmado - Activa tu cuenta Bizonne',
        buildEmail(registerUrl, priceInfo?.label || purchase.plan, `$${(purchase.amountCents / 100).toLocaleString('es-CO')} COP`));
      console.log(`Email registro enviado a ${purchase.buyerEmail}`);
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
            if (ns === 'approved' && purchase.buyerEmail && !purchase.tokenUsed) {
              const registerUrl = `${APP_URL}/register?token=${purchase.registrationToken}&plan=${purchase.plan}`;
              const pi = PLAN_PRICES[purchase.plan]?.[purchase.period];
              await sendEmail(purchase.buyerEmail, 'Pago confirmado - Activa tu cuenta Bizonne',
                buildEmail(registerUrl, pi?.label || purchase.plan, `$${(purchase.amountCents / 100).toLocaleString('es-CO')} COP`));
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

// POST /api/payments/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { token, email: rawEmail, password, name } = req.body;
    const email = rawEmail?.trim().toLowerCase();
    if (!token || !email || !password) { res.status(400).json({ error: 'Token, email y contrasena requeridos' }); return; }

    const purchase = await prisma.purchase.findUnique({ where: { registrationToken: token } });
    if (!purchase) { res.status(404).json({ error: 'Token invalido' }); return; }
    if (purchase.tokenUsed) { res.status(400).json({ error: 'Token ya utilizado' }); return; }
    if (purchase.status !== 'approved') { res.status(400).json({ error: 'Pago no aprobado' }); return; }
    if (purchase.expiresAt && purchase.expiresAt < new Date()) { res.status(400).json({ error: 'Token expirado' }); return; }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) { res.status(400).json({ error: 'Email ya registrado' }); return; }

    const planDays = getPlanDuration(purchase.period);
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + planDays);

    const user = await prisma.user.create({
      data: {
        email, password: await bcrypt.hash(password, 10),
        name: name || purchase.buyerName || null,
        role: 'admin', plan: purchase.plan,
        trialEndsAt, subscriptionId: purchase.reference
      }
    });

    await prisma.purchase.update({ where: { registrationToken: token }, data: { tokenUsed: true, userId: user.id } });

    const jwtToken = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '30d' });
    console.log(`Nuevo usuario pagado: ${email} | Plan: ${purchase.plan} (${purchase.period}) | ${planDays} dias`);

    res.status(201).json({
      user: { id: user.id, email, name: user.name, role: 'admin', plan: purchase.plan },
      token: jwtToken,
      message: `Cuenta activada! Plan ${purchase.plan} activo por ${planDays} dias.`
    });
  } catch (error: any) {
    console.error('Error register-paid:', error.message);
    res.status(500).json({ error: 'Error al crear cuenta' });
  }
});

// GET /api/payments/verify-token/:token
router.get('/verify-token/:token', async (req: Request, res: Response) => {
  try {
    const purchase = await prisma.purchase.findUnique({ where: { registrationToken: req.params.token } });
    if (!purchase) { res.status(404).json({ valid: false, error: 'Token no encontrado' }); return; }
    if (purchase.tokenUsed) { res.status(400).json({ valid: false, error: 'Token ya utilizado' }); return; }
    if (purchase.status !== 'approved') { res.status(400).json({ valid: false, error: 'Pago no aprobado' }); return; }
    if (purchase.expiresAt && purchase.expiresAt < new Date()) { res.status(400).json({ valid: false, error: 'Token expirado' }); return; }
    res.json({ valid: true, plan: purchase.plan, period: purchase.period, email: purchase.buyerEmail, name: purchase.buyerName });
  } catch { res.status(500).json({ valid: false }); }
});

export default router;

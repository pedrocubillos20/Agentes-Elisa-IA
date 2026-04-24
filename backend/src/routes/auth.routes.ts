import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { authMiddleware, AuthRequest, generateTokens, verifyRefreshToken } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { LoginSchema, RegisterSchema, ForgotPasswordSchema, ResetPasswordSchema } from '../lib/schemas';
import logger from '../lib/logger';

const router = Router();
// 🔒 SEGURIDAD: JWT_SECRET obligatorio — NO fallback hardcodeado
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET no está configurado en las variables de entorno');
  process.exit(1);
}
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

// ====================================================
// 📧 ENVIAR EMAIL CON RESEND
// ====================================================
const sendEmail = async (to: string, subject: string, html: string): Promise<boolean> => {
  if (!RESEND_API_KEY) {
    console.error('❌ RESEND_API_KEY no configurada');
    return false;
  }
  
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Bizonne <no-reply@bizonne.com>',
        to: [to],
        subject,
        html
      })
    });
    
    if (res.ok) {
      console.log(`📧 Email enviado a ${to}`);
      return true;
    } else {
      const err = await res.text();
      console.error(`❌ Error enviando email: ${err}`);
      return false;
    }
  } catch (e: any) {
    console.error(`❌ Error enviando email: ${e.message}`);
    return false;
  }
};

// Generar código de 6 dígitos
const generateResetCode = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ====================================================
// 🔐 POST /api/auth/forgot-password
// Envía código de recuperación al email
// ====================================================
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email: rawEmail } = req.body;
    const email = rawEmail?.trim().toLowerCase();
    if (!email) { 
      res.status(400).json({ error: 'Email es requerido' }); 
      return; 
    }

    const user = await prisma.user.findUnique({ where: { email } });
    
    // Por seguridad, siempre responder igual aunque no exista
    if (!user) {
      res.json({ success: true, message: 'Si el email existe, recibirás un código de verificación' });
      return;
    }

    // Generar código y guardar
    const resetCode = generateResetCode();
    const resetCodeExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    await prisma.user.update({
      where: { id: user.id },
      data: { resetCode, resetCodeExpires }
    });

    // Enviar email
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; background: #0a0a0a; color: #ffffff; padding: 40px; }
          .container { max-width: 500px; margin: 0 auto; background: #1a1a1a; border-radius: 16px; padding: 40px; }
          .logo { text-align: center; margin-bottom: 30px; }
          .logo h1 { color: #10b981; margin: 0; font-size: 28px; }
          .code { background: linear-gradient(135deg, #10b981, #059669); color: white; font-size: 36px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 20px; border-radius: 12px; margin: 30px 0; }
          .message { color: #9ca3af; line-height: 1.6; }
          .warning { color: #f59e0b; font-size: 14px; margin-top: 20px; }
          .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 30px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">
            <h1>🤖 Bizonne CRM</h1>
          </div>
          <p class="message">Hola${user.name ? ` ${user.name}` : ''},</p>
          <p class="message">Recibimos una solicitud para restablecer tu contraseña. Usa el siguiente código:</p>
          <div class="code">${resetCode}</div>
          <p class="warning">⏰ Este código expira en 15 minutos.</p>
          <p class="message">Si no solicitaste este cambio, puedes ignorar este correo.</p>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Bizonne - Automatiza tu WhatsApp con IA</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const sent = await sendEmail(email, '🔐 Código de recuperación - Bizonne', emailHtml);
    
    if (sent) {
      logger.info('Código de reset enviado', { email: ${email}: ${resetCode}`);
      res.json({ success: true, message: 'Código enviado a tu correo' });
    } else {
      // Fallback: mostrar código en logs si no hay RESEND configurado
      logger.warn('RESEND no configurado. Código para ${email}: ${resetCode}`);
      res.json({ success: true, message: 'Código enviado a tu correo' });
    }
  } catch (error) {
    console.error('Error forgot-password:', error);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

// ====================================================
// 🔐 POST /api/auth/verify-reset-code
// Verifica que el código sea válido
// ====================================================
router.post('/verify-reset-code', async (req: Request, res: Response) => {
  try {
    const { email: rawEmail, code } = req.body;
    const email = rawEmail?.trim().toLowerCase();
    if (!email || !code) { 
      res.status(400).json({ error: 'Email y código son requeridos' }); 
      return; 
    }

    const user = await prisma.user.findUnique({ where: { email } });
    
    if (!user || !user.resetCode || !user.resetCodeExpires) {
      res.status(400).json({ error: 'Código inválido o expirado' });
      return;
    }

    // Verificar expiración
    if (new Date() > user.resetCodeExpires) {
      await prisma.user.update({ 
        where: { id: user.id }, 
        data: { resetCode: null, resetCodeExpires: null } 
      });
      res.status(400).json({ error: 'El código ha expirado. Solicita uno nuevo.' });
      return;
    }

    // Verificar código
    if (user.resetCode !== code) {
      res.status(400).json({ error: 'Código incorrecto' });
      return;
    }

    // Generar token temporal para reset (válido 10 min)
    const resetToken = jwt.sign(
      { id: user.id, email: user.email, purpose: 'password-reset' }, 
      JWT_SECRET, 
      { expiresIn: '10m' }
    );

    res.json({ success: true, resetToken, message: 'Código verificado' });
  } catch (error) {
    console.error('Error verify-reset-code:', error);
    res.status(500).json({ error: 'Error al verificar código' });
  }
});

// ====================================================
// 🔐 POST /api/auth/reset-password
// Cambia la contraseña con el token verificado
// ====================================================
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) { 
      res.status(400).json({ error: 'Token y nueva contraseña son requeridos' }); 
      return; 
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      return;
    }

    // Verificar token
    let decoded: any;
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET);
    } catch {
      res.status(400).json({ error: 'Token inválido o expirado' });
      return;
    }

    if (decoded.purpose !== 'password-reset') {
      res.status(400).json({ error: 'Token inválido' });
      return;
    }

    // Actualizar contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: decoded.id },
      data: { 
        password: hashedPassword, 
        resetCode: null, 
        resetCodeExpires: null 
      }
    });

    logger.info('Contraseña restablecida', { email: ${decoded.email}`);
    res.json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('Error reset-password:', error);
    res.status(500).json({ error: 'Error al restablecer contraseña' });
  }
});

// POST /api/auth/register — CORREGIDO: Zod validation
router.post('/register', validateBody(RegisterSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) { res.status(400).json({ error: 'El email ya está registrado' }); return; }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 3);

    const user = await prisma.user.create({
      data: { email, password: await bcrypt.hash(password, 10), name: name || null, role: 'admin', plan: 'trial', trialEndsAt }
    });

    const { accessToken, refreshToken, expiresIn } = generateTokens(user.id, user.email);
    logger.info('Usuario registrado', { userId: user.id, email });
    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: 'admin' },
      token: accessToken,
      accessToken,
      refreshToken,
      expiresIn
    });
  } catch (error: any) {
    logger.error('Error registro', { error: error.message });
    res.status(500).json({ error: 'Error al registrar' });
  }
});

// POST /api/auth/login — CORREGIDO: Zod validation + refresh tokens
router.post('/login', validateBody(LoginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) { res.status(401).json({ error: 'Credenciales inválidas' }); return; }

    // Sub-usuario desactivado
    if (user.parentUserId && !user.isActive) {
      res.status(403).json({ error: 'Tu cuenta ha sido desactivada. Contacta al administrador.' }); return;
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      logger.warn('Login fallido', { email });
      res.status(401).json({ error: 'Credenciales inválidas' }); return;
    }

    // CORREGIDO: accessToken 8h + refreshToken 30d
    const { accessToken, refreshToken, expiresIn } = generateTokens(user.id, user.email);

    logger.info('Login exitoso', { userId: user.id, email });
    res.json({
      user: {
        id: user.id, email: user.email, name: user.name,
        role: user.role || 'admin',
        parentUserId: user.parentUserId || null,
        permissions: user.permissions || {},
        apiKeyConnected: user.apiKeyConnected || false,
        isSubUser: !!user.parentUserId
      },
      token: accessToken,        // compatibilidad con frontend existente
      accessToken,
      refreshToken,
      expiresIn
    });
  } catch (error: any) {
    logger.error('Error login', { error: error.message });
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// POST /api/auth/refresh — NUEVO: Renovar access token
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) { res.status(400).json({ error: 'refreshToken requerido' }); return; }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) { res.status(401).json({ error: 'Token inválido o expirado' }); return; }

    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, email: true, isActive: true }
    });
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Usuario no encontrado o inactivo' }); return;
    }

    const { accessToken, expiresIn } = generateTokens(user.id, user.email);
    res.json({ accessToken, token: accessToken, expiresIn });
  } catch (error: any) {
    logger.error('Error refresh token', { error: error.message });
    res.status(500).json({ error: 'Error al renovar token' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const user: any = await (prisma as any).user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, phone: true, profilePic: true, timezone: true, apiKeyConnected: true, createdAt: true, role: true, parentUserId: true, permissions: true, isActive: true, plan: true, trialEndsAt: true }
    });

    if (!user) { res.status(404).json({ error: 'No encontrado' }); return; }

    // Calcular estado de suscripción
    let subscriptionStatus = 'active';
    let daysRemaining = 0;
    
    if (user.plan === 'trial' && user.trialEndsAt) {
      const now = new Date();
      const diff = user.trialEndsAt.getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
      if (daysRemaining <= 0) subscriptionStatus = 'expired';
    } else if (user.plan !== 'trial') {
      // Verificar suscripción activa
      const sub = await prisma.subscription.findUnique({ where: { userId: user.parentUserId || userId } });
      if (sub) {
        subscriptionStatus = sub.status;
        if (sub.currentPeriodEnd < new Date()) subscriptionStatus = 'expired';
        daysRemaining = Math.max(0, Math.ceil((sub.currentPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
      }
    }

    // Para sub-usuarios, obtener info del padre (API key status, etc.)
    let parentInfo = null;
    if (user.parentUserId) {
      parentInfo = await prisma.user.findUnique({
        where: { id: user.parentUserId },
        select: { id: true, name: true, email: true, apiKeyConnected: true, phone: true }
      });
    }

    // Plan features
    const PLAN_FEATURES: Record<string, any> = {
      trial: { 
        maxWhatsappLines: 1, maxProducts: 10,
        crm: true, agenda: true, team: false, chatAssignment: false, products: true,
        assistants: true, config: true, integrations: true
      },
      starter: { 
        maxWhatsappLines: 2, maxProducts: 10,
        crm: true, agenda: true, team: false, chatAssignment: false, products: true,
        assistants: true, config: true, integrations: true
      },
      business: { 
        maxWhatsappLines: 5, maxProducts: 999,
        crm: true, agenda: true, team: true, chatAssignment: true, products: true,
        assistants: true, config: true, integrations: true
      }
    };
    
    // Verificar si el usuario compró el addon de implementación
    const hasImplementation = await prisma.payment.findFirst({
      where: { userId: user.parentUserId || userId, plan: 'implementation', status: 'approved' }
    });

    // Verificar si tiene soporte prioritario (business, implementación, o addon)
    const hasPrioritySupportAddon = await prisma.payment.findFirst({
      where: { userId: user.parentUserId || userId, plan: 'priority_support', status: 'approved' }
    });

    // Contar addons de líneas y productos comprados
    const extraLinesPurchased = await prisma.payment.count({
      where: { userId: user.parentUserId || userId, plan: 'extra_line', status: 'approved' }
    });
    const extraProductsPurchased = await prisma.payment.count({
      where: { userId: user.parentUserId || userId, plan: 'extra_products', status: 'approved' }
    });

    // Verificar addons de IA
    const hasAiConfig = !!(await prisma.payment.findFirst({
      where: { userId: user.parentUserId || userId, plan: 'ai_config', status: 'approved' }
    }));
    const hasAiCalls = !!(await prisma.payment.findFirst({
      where: { userId: user.parentUserId || userId, plan: 'ai_calls', status: 'approved' }
    }));

    // For sub-users, get plan from parent
    let effectivePlan = user.plan;
    if (user.parentUserId) {
      const parent = await prisma.user.findUnique({ where: { id: user.parentUserId }, select: { plan: true } });
      if (parent) effectivePlan = parent.plan;
    }
    const planFeatures = PLAN_FEATURES[effectivePlan] || PLAN_FEATURES.starter;
    // Trial active = full access
    const trialActive = effectivePlan === 'trial' && subscriptionStatus !== 'expired';
    const features = trialActive ? PLAN_FEATURES.trial : planFeatures;

    // Priority support: Business plan, Implementation addon, or Priority Support addon
    const hasPrioritySupport = effectivePlan === 'business' || !!hasImplementation || !!hasPrioritySupportAddon;

    // Calculate effective limits (base + purchased addons)
    const baseLimits: Record<string, { lines: number, products: number }> = {
      trial: { lines: 1, products: 10 },
      starter: { lines: 2, products: 10 },
      business: { lines: 5, products: 999 }
    };
    const bl = baseLimits[effectivePlan] || baseLimits.trial;
    const effectiveLimits = {
      maxLines: bl.lines + extraLinesPurchased,
      maxProducts: bl.products + (extraProductsPurchased * 10),
      extraLinesPurchased,
      extraProductsPurchased
    };

    res.json({
      user: {
        ...user,
        plan: effectivePlan,  // ⚡ Sub-users inherit parent's plan
        isSubUser: !!user.parentUserId,
        parent: parentInfo,
        apiKeyConnected: user.parentUserId ? (parentInfo?.apiKeyConnected || false) : user.apiKeyConnected,
        subscriptionStatus,
        daysRemaining,
        isBlocked: subscriptionStatus === 'expired',
        hasImplementation: !!hasImplementation,
        hasPrioritySupport,
        hasAiConfig,
        hasAiCalls,
        effectiveLimits,
        planFeatures: features
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// GET /api/auth/api-key/status
router.get('/api-key/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const current = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
    const ownerId = current?.parentUserId || userId;
    const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { apiKey: true, apiKeyConnected: true } });
    res.json({ hasApiKey: !!user?.apiKey, apiKeyConnected: user?.apiKeyConnected || false });
  } catch { res.status(500).json({ error: 'Error' }); }
});

// POST /api/auth/api-key
router.post('/api-key', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { apiKey } = req.body;
    if (!apiKey || !userId) { res.status(400).json({ error: 'API Key requerida' }); return; }

    // Solo admins pueden configurar API key
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
    if (user?.parentUserId) { res.status(403).json({ error: 'Solo el administrador puede configurar la API Key' }); return; }

    await prisma.user.update({ where: { id: userId }, data: { apiKey, apiKeyConnected: true } });
    res.json({ success: true, message: 'API Key guardada' });
  } catch { res.status(500).json({ error: 'Error' }); }
});

// DELETE /api/auth/api-key
router.delete('/api-key', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const user = await prisma.user.findUnique({ where: { id: userId! }, select: { parentUserId: true } });
    if (user?.parentUserId) { res.status(403).json({ error: 'Solo el administrador' }); return; }
    await prisma.user.update({ where: { id: userId }, data: { apiKey: null, apiKeyConnected: false } });
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Error' }); }
});

// POST /api/auth/api-key/test
router.post('/api-key/test', async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) { res.json({ valid: false, message: 'API Key requerida' }); return; }
    if (!apiKey.startsWith('sk-')) { res.json({ valid: false, message: 'Formato inválido' }); return; }

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${apiKey}` }, signal: ctrl.signal });
      clearTimeout(to);
      if (r.status === 200) { res.json({ valid: true, message: 'API Key válida ✓' }); return; }
      if (r.status === 401) { res.json({ valid: false, message: 'API Key inválida' }); return; }
      if (r.status === 429) { res.json({ valid: true, message: 'Válida (rate limit)' }); return; }
      res.json({ valid: false, message: 'Inválida o sin créditos' });
    } catch (e: any) {
      clearTimeout(to);
      res.json({ valid: false, message: e.name === 'AbortError' ? 'Timeout' : 'Error conexión' });
    }
  } catch { res.json({ valid: false, message: 'Error' }); }
});

// ====================================================
// 🔒 ADMIN: Verificar si el usuario es super admin
// ====================================================
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

router.post('/admin/verify', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, parentUserId: true } });
    if (!user || user.parentUserId) {
      res.status(403).json({ isAdmin: false });
      return;
    }

    if (ADMIN_EMAILS.length === 0) {
      console.warn('⚠️ ADMIN_EMAILS no configurado — nadie puede acceder al panel admin');
      res.status(403).json({ isAdmin: false });
      return;
    }

    const isAdmin = ADMIN_EMAILS.includes(user.email.toLowerCase());
    if (!isAdmin) {
      res.status(403).json({ isAdmin: false });
      return;
    }

    res.json({ isAdmin: true });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// ====================================================
// 🛠️ ADMIN: Impersonar usuario (para implementación)
// Permite al admin actuar como un usuario para configurar su cuenta
// ====================================================
router.post('/admin/impersonate', authMiddleware, async (req: Request, res: Response) => {
  try {
    const adminId = (req as AuthRequest).user?.id;
    const { targetUserId } = req.body;

    if (!adminId || !targetUserId) {
      res.status(400).json({ error: 'targetUserId requerido' });
      return;
    }

    // 1. Verificar que quien pide es ADMIN
    const adminUser = await prisma.user.findUnique({
      where: { id: adminId },
      select: { email: true, name: true, parentUserId: true }
    });

    if (!adminUser || adminUser.parentUserId) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    if (!ADMIN_EMAILS.includes(adminUser.email.toLowerCase())) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    // 2. Obtener el usuario target
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        role: true,
        parentUserId: true,
        subscription: {
          select: { plan: true, status: true, period: true }
        }
      }
    });

    if (!targetUser) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    // 3. Generar JWT del usuario target (expira en 2 horas)
    const impersonationToken = jwt.sign(
      {
        id: targetUser.id,
        email: targetUser.email,
        impersonatedBy: adminId
      },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    // 4. Log de auditoría
    console.log(`🛡️ IMPERSONACIÓN: Admin ${adminUser.email} → Usuario ${targetUser.email} (${targetUser.id})`);

    res.json({
      success: true,
      token: impersonationToken,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        plan: targetUser.plan,
        role: targetUser.role
      },
      expiresIn: '2h'
    });

  } catch (error) {
    console.error('Error impersonating:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});


// =====================================================
// ===== PERFIL DE USUARIO =====
// =====================================================

// PUT /api/auth/profile
router.put('/profile', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const { name, phone, timezone } = req.body;
    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (phone !== undefined) updateData.phone = phone.trim();
    if (timezone !== undefined) updateData.timezone = timezone;
    if (Object.keys(updateData).length === 0) { res.status(400).json({ error: 'Nada que actualizar' }); return; }
    const user: any = await (prisma as any).user.update({
      where: { id: userId }, data: updateData,
      select: { id: true, name: true, phone: true, email: true, timezone: true, profilePic: true }
    });
    console.log(`Profile updated: ${user.email}`);
    res.json({ success: true, user });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// PUT /api/auth/profile/photo
router.put('/profile/photo', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const { photo } = req.body;
    if (!photo) {
      await (prisma as any).user.update({ where: { id: userId }, data: { profilePic: null } });
      res.json({ success: true, profilePic: null }); return;
    }
    if (photo.length > 2 * 1024 * 1024) { res.status(400).json({ error: 'Max 2MB' }); return; }
    await (prisma as any).user.update({ where: { id: userId }, data: { profilePic: photo } });
    res.json({ success: true, profilePic: photo });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// PUT /api/auth/change-password
router.put('/change-password', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) { res.status(400).json({ error: 'Ambas contrasenas requeridas' }); return; }
    if (newPassword.length < 6) { res.status(400).json({ error: 'Minimo 6 caracteres' }); return; }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { password: true, email: true } });
    if (!user) { res.status(404).json({ error: 'No encontrado' }); return; }
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) { res.status(400).json({ error: 'Contrasena actual incorrecta' }); return; }
    await prisma.user.update({ where: { id: userId }, data: { password: await bcrypt.hash(newPassword, 10) } });
    res.json({ success: true, message: 'Contrasena actualizada' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

export default router;


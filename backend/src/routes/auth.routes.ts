import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key-2024';

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) { res.status(400).json({ error: 'Email y contraseña son requeridos' }); return; }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) { res.status(400).json({ error: 'El email ya está registrado' }); return; }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    const user = await prisma.user.create({
      data: { email, password: await bcrypt.hash(password, 10), name: name || null, role: 'admin', plan: 'trial', trialEndsAt }
    });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, role: 'admin' }, token });
  } catch (error) {
    console.error('Error registro:', error);
    res.status(500).json({ error: 'Error al registrar' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) { res.status(400).json({ error: 'Email y contraseña son requeridos' }); return; }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) { res.status(401).json({ error: 'Credenciales inválidas' }); return; }

    // Sub-usuario desactivado
    if (user.parentUserId && !user.isActive) {
      res.status(403).json({ error: 'Tu cuenta ha sido desactivada. Contacta al administrador.' }); return;
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) { res.status(401).json({ error: 'Credenciales inválidas' }); return; }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      user: {
        id: user.id, email: user.email, name: user.name,
        role: user.role || 'admin',
        parentUserId: user.parentUserId || null,
        permissions: user.permissions || {},
        apiKeyConnected: user.apiKeyConnected || false,
        isSubUser: !!user.parentUserId
      },
      token
    });
  } catch (error) {
    console.error('Error login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, phone: true, apiKeyConnected: true, createdAt: true, role: true, parentUserId: true, permissions: true, isActive: true, plan: true, trialEndsAt: true }
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
      trial: { maxWhatsappLines: 3, crm: true, agenda: true, team: true, chatAssignment: true, products: true },
      starter: { maxWhatsappLines: 3, crm: false, agenda: false, team: false, chatAssignment: false, products: false },
      business: { maxWhatsappLines: 999, crm: true, agenda: true, team: true, chatAssignment: true, products: true }
    };

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

    res.json({
      user: {
        ...user,
        isSubUser: !!user.parentUserId,
        parent: parentInfo,
        apiKeyConnected: user.parentUserId ? (parentInfo?.apiKeyConnected || false) : user.apiKeyConnected,
        subscriptionStatus,
        daysRemaining,
        isBlocked: subscriptionStatus === 'expired',
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

export default router;

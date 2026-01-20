import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { openaiService } from '../services/openaiService';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-2024';

// Middleware de autenticación
export const authMiddleware = async (req: Request, res: Response, next: Function) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    
    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    (req as any).user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

// Registro
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name, referralCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    // Verificar si ya existe
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Calcular trial (14 días)
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    // Generar código de referido
    const userReferralCode = `ELISA${Date.now().toString(36).toUpperCase()}`;

    // Crear usuario
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        trialEndsAt,
        referralCode: userReferralCode,
        referredBy: referralCode || null
      }
    });

    // Generar token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    console.log(`✅ Usuario registrado: ${email}`);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        trialEndsAt: user.trialEndsAt,
        apiKeyConnected: user.apiKeyConnected,
        whatsappConnected: user.whatsappConnected,
        referralCode: user.referralCode
      }
    });
  } catch (error: any) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    console.log(`✅ Usuario logueado: ${email}`);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        trialEndsAt: user.trialEndsAt,
        apiKeyConnected: user.apiKeyConnected,
        whatsappConnected: user.whatsappConnected,
        whatsappPhone: user.whatsappPhone,
        referralCode: user.referralCode
      }
    });
  } catch (error: any) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// Obtener perfil
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        trialEndsAt: user.trialEndsAt,
        apiKeyConnected: user.apiKeyConnected,
        whatsappConnected: user.whatsappConnected,
        whatsappPhone: user.whatsappPhone,
        whatsappStatus: user.whatsappStatus,
        referralCode: user.referralCode,
        customBrandName: user.customBrandName
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
});

// Guardar API Key de OpenAI
router.post('/api-key', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { apiKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: 'API Key es requerida' });
    }

    // Verificar API Key
    const verification = await openaiService.verifyApiKey(apiKey);
    if (!verification.valid) {
      return res.status(400).json({ error: verification.error || 'API Key inválida' });
    }

    // Encriptar y guardar
    const encryptedKey = openaiService.encryptApiKey(apiKey);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        apiKeyEncrypted: encryptedKey,
        apiKeyConnected: true
      }
    });

    console.log(`✅ API Key guardada para usuario: ${user.email}`);

    res.json({ success: true, message: 'API Key guardada correctamente' });
  } catch (error) {
    console.error('Error guardando API Key:', error);
    res.status(500).json({ error: 'Error al guardar API Key' });
  }
});

// Eliminar API Key
router.delete('/api-key', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        apiKeyEncrypted: null,
        apiKeyConnected: false
      }
    });

    console.log(`🗑️ API Key eliminada para usuario: ${user.email}`);

    res.json({ success: true, message: 'API Key eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar API Key' });
  }
});

// Verificar API Key
router.get('/api-key/verify', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    res.json({
      connected: user.apiKeyConnected,
      hasKey: !!user.apiKeyEncrypted
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al verificar API Key' });
  }
});

export default router;

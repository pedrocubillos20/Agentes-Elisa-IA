import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import CryptoJS from 'crypto-js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'elisa-ia-clave-encriptacion-2024';

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

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name, firstName, lastName } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }
    
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Construir nombre completo
    const fullName = name || (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || null);
    
    // Usar el enum Plan.FREE
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: fullName,
        plan: 'FREE', // Prisma maneja esto como enum
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    
    console.log(`✅ Usuario registrado: ${user.email}`);
    
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan }
    });
  } catch (error: any) {
    console.error('Error registro:', error?.message || error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }
    
    console.log(`🔐 Intento de login: ${email}`);
    
    const user = await prisma.user.findUnique({ 
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        name: true,
        plan: true,
      }
    });
    
    if (!user) {
      console.log(`❌ Usuario no encontrado: ${email}`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      console.log(`❌ Contraseña incorrecta para: ${email}`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    
    console.log(`✅ Login exitoso: ${email}`);
    
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan }
    });
  } catch (error: any) {
    console.error('Error login:', error?.message || error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        whatsappConnected: true,
        whatsappPhone: true,
        openaiApiKey: true,
        trialEndsAt: true,
        referralCode: true,
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json({
      ...user,
      hasApiKey: !!user.openaiApiKey,
      openaiApiKey: undefined,
    });
  } catch (error: any) {
    console.error('Error /me:', error?.message || error);
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

router.post('/api-key', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API Key requerida' });
    }
    
    // Validar formato básico de API Key de OpenAI
    if (!apiKey.startsWith('sk-')) {
      return res.status(400).json({ error: 'API Key inválida. Debe comenzar con sk-' });
    }
    
    const encryptedKey = CryptoJS.AES.encrypt(apiKey, ENCRYPTION_KEY).toString();
    
    await prisma.user.update({
      where: { id: userId },
      data: { openaiApiKey: encryptedKey }
    });
    
    console.log(`✅ API Key guardada para usuario: ${userId}`);
    
    res.json({ message: 'API Key guardada correctamente' });
  } catch (error: any) {
    console.error('Error guardando API Key:', error?.message || error);
    res.status(500).json({ error: 'Error al guardar API Key' });
  }
});

router.delete('/api-key', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    await prisma.user.update({
      where: { id: userId },
      data: { openaiApiKey: null }
    });
    
    console.log(`✅ API Key eliminada para usuario: ${userId}`);
    
    res.json({ message: 'API Key eliminada' });
  } catch (error: any) {
    console.error('Error eliminando API Key:', error?.message || error);
    res.status(500).json({ error: 'Error al eliminar API Key' });
  }
});

// Ruta para actualizar plan (admin)
router.put('/plan', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { plan } = req.body;
    
    const validPlans = ['FREE', 'EMPRENDEDORES', 'NEGOCIOS', 'BUSINESS', 'MARCA_BLANCA'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido' });
    }
    
    await prisma.user.update({
      where: { id: userId },
      data: { plan }
    });
    
    res.json({ message: 'Plan actualizado', plan });
  } catch (error: any) {
    console.error('Error actualizando plan:', error?.message || error);
    res.status(500).json({ error: 'Error al actualizar plan' });
  }
});

export default router;

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
    const { email, password, name } = req.body;
    
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        plan: 'FREE',
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan }
    });
  } catch (error) {
    console.error('Error registro:', error);
    res.status(500).json({ error: 'Error al registrar' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan }
    });
  } catch (error) {
    console.error('Error login:', error);
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
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/api-key', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API Key requerida' });
    }
    
    const encryptedKey = CryptoJS.AES.encrypt(apiKey, ENCRYPTION_KEY).toString();
    
    await prisma.user.update({
      where: { id: userId },
      data: { openaiApiKey: encryptedKey }
    });
    
    res.json({ message: 'API Key guardada' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.delete('/api-key', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    await prisma.user.update({
      where: { id: userId },
      data: { openaiApiKey: null }
    });
    
    res.json({ message: 'API Key eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

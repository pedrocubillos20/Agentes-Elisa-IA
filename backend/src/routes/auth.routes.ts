import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import CryptoJS from 'crypto-js';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'clave-encriptacion-32-caracteres!';

// Encriptar API Key
const encryptApiKey = (apiKey: string): string => {
  return CryptoJS.AES.encrypt(apiKey, ENCRYPTION_KEY).toString();
};

// Desencriptar API Key
const decryptApiKey = (encrypted: string): string => {
  const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
};

// REGISTRO
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (exists) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    // Calcular fecha de fin de trial (5 días)
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 5);

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        firstName,
        lastName,
        phone,
        trialEndsAt,
      },
    });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'Usuario creado',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        plan: user.plan,
        planType: user.planType,
        apiKeyConnected: user.apiKeyConnected,
        whatsappConnected: user.whatsappConnected,
        trialEndsAt: user.trialEndsAt,
      },
    });
  } catch (error) {
    console.error('Error registro:', error);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// LOGIN
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Login exitoso',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        plan: user.plan,
        planType: user.planType,
        apiKeyConnected: user.apiKeyConnected,
        whatsappConnected: user.whatsappConnected,
        trialEndsAt: user.trialEndsAt,
        apiKeyLast4: user.openaiApiKey ? decryptApiKey(user.openaiApiKey).slice(-4) : null,
      },
    });
  } catch (error) {
    console.error('Error login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// OBTENER PERFIL
router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        plan: user.plan,
        planType: user.planType,
        subscriptionStatus: user.subscriptionStatus,
        apiKeyConnected: user.apiKeyConnected,
        whatsappConnected: user.whatsappConnected,
        whatsappPhone: user.whatsappPhone,
        trialEndsAt: user.trialEndsAt,
        apiKeyLast4: user.openaiApiKey ? decryptApiKey(user.openaiApiKey).slice(-4) : null,
        isAdmin: user.isAdmin,
      },
    });
  } catch (error) {
    res.status(401).json({ error: 'Token inválido' });
  }
});

// ACTUALIZAR PERFIL
router.put('/profile', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    const { firstName, lastName, phone } = req.body;

    const user = await prisma.user.update({
      where: { id: decoded.userId },
      data: { firstName, lastName, phone },
    });

    res.json({ message: 'Perfil actualizado', user });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

// ========== API KEY DE OPENAI ==========

// GUARDAR API KEY
router.post('/api-key', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    const { apiKey } = req.body;

    if (!apiKey || !apiKey.startsWith('sk-')) {
      return res.status(400).json({ error: 'API Key inválida. Debe comenzar con sk-' });
    }

    const encryptedKey = encryptApiKey(apiKey);

    await prisma.user.update({
      where: { id: decoded.userId },
      data: {
        openaiApiKey: encryptedKey,
        apiKeyConnected: true,
      },
    });

    console.log(`✅ API Key guardada para usuario ${decoded.userId}`);
    res.json({ message: 'API Key guardada exitosamente' });
  } catch (error) {
    console.error('Error guardando API Key:', error);
    res.status(500).json({ error: 'Error al guardar API Key' });
  }
});

// ELIMINAR API KEY
router.delete('/api-key', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    await prisma.user.update({
      where: { id: decoded.userId },
      data: {
        openaiApiKey: null,
        apiKeyConnected: false,
      },
    });

    console.log(`🗑️ API Key eliminada para usuario ${decoded.userId}`);
    res.json({ message: 'API Key eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar API Key' });
  }
});

export default router;

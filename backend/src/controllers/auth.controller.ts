import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { encryptApiKey, decryptApiKey } from '../utils/encryption';
import { validateOpenAIKey, getOpenAICredits } from '../services/openai.service';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

// ==========================================
// REGISTRO
// ==========================================
export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, firstName, lastName, businessName, industry, plan, planType } = req.body;

    // Verificar si el usuario ya existe
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(password, 12);

    // Crear usuario y negocio en una transacción
    const result = await prisma.$transaction(async (tx) => {
      // Crear usuario
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          plan: plan || 'STARTER',
          planType: planType || 'MONTHLY',
        },
      });

      // Crear negocio asociado
      const business = await tx.business.create({
        data: {
          userId: user.id,
          name: businessName,
          industry,
          description: '',
        },
      });

      return { user, business };
    });

    // Generar JWT
    const token = jwt.sign(
      { userId: result.user.id },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    logger.info(`Nuevo usuario registrado: ${email}`);

    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        plan: result.user.plan,
        planType: result.user.planType,
      },
      business: {
        id: result.business.id,
        name: result.business.name,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// LOGIN
// ==========================================
export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    // Buscar usuario
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        businesses: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Verificar contraseña
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Verificar si está activo
    if (!user.isActive) {
      return res.status(403).json({ error: 'Tu cuenta ha sido desactivada' });
    }

    // Actualizar último login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Generar JWT
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    logger.info(`Usuario logueado: ${email}`);

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
        isAdmin: user.isAdmin,
      },
      businesses: user.businesses.map(b => ({
        id: b.id,
        name: b.name,
        onboardingStatus: b.onboardingStatus,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// OBTENER USUARIO ACTUAL
// ==========================================
export const getCurrentUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        businesses: {
          include: {
            assistants: {
              select: {
                id: true,
                name: true,
                status: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

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
        isAdmin: user.isAdmin,
        createdAt: user.createdAt,
      },
      businesses: user.businesses,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ACTUALIZAR PERFIL
// ==========================================
export const updateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { firstName, lastName, phone } = req.body;

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName,
        lastName,
        phone,
      },
    });

    res.json({
      message: 'Perfil actualizado',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// CAMBIAR CONTRASEÑA
// ==========================================
export const changePassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Verificar contraseña actual
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    }

    // Hash nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    res.json({ message: 'Contraseña actualizada exitosamente' });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// CONECTAR API KEY DE OPENAI
// ==========================================
export const connectApiKey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { apiKey } = req.body;

    // Validar que la API key sea válida
    const isValid = await validateOpenAIKey(apiKey);
    if (!isValid) {
      return res.status(400).json({ error: 'API Key de OpenAI inválida' });
    }

    // Encriptar y guardar
    const encryptedKey = encryptApiKey(apiKey);

    await prisma.user.update({
      where: { id: userId },
      data: {
        openaiApiKey: encryptedKey,
        apiKeyConnected: true,
      },
    });

    logger.info(`API Key conectada para usuario: ${userId}`);

    res.json({
      message: 'API Key conectada exitosamente',
      connected: true,
      lastFour: apiKey.slice(-4),
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// DESCONECTAR API KEY
// ==========================================
export const disconnectApiKey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;

    await prisma.user.update({
      where: { id: userId },
      data: {
        openaiApiKey: null,
        apiKeyConnected: false,
      },
    });

    res.json({ message: 'API Key desconectada', connected: false });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// VERIFICAR CRÉDITOS DE OPENAI
// ==========================================
export const checkOpenAICredits = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.openaiApiKey) {
      return res.status(400).json({ error: 'No hay API Key conectada' });
    }

    const apiKey = decryptApiKey(user.openaiApiKey);
    const credits = await getOpenAICredits(apiKey);

    res.json({
      credits,
      lastFour: apiKey.slice(-4),
    });
  } catch (error) {
    next(error);
  }
};

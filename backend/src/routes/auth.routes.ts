import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import CryptoJS from 'crypto-js';
import { authenticate, generateToken, AuthRequest } from '../middleware/auth';

const router = Router();
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'elisa-ia-encryption-key-2024';

// Registro de usuario
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name, firstName, lastName } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Formato de email inválido' });
    }

    // Validar longitud de contraseña
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    // Verificar si el usuario ya existe
    const existingUser = await prisma.user.findUnique({ 
      where: { email: email.toLowerCase().trim() } 
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'Este email ya está registrado' });
    }
    
    // Hash de contraseña
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Construir nombre completo
    const fullName = name || 
      (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || null);
    
    // Crear usuario
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        name: fullName,
        plan: 'FREE',
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días de prueba
      },
    });
    
    const token = generateToken(user.id);
    
    console.log(`✅ Usuario registrado: ${user.email}`);
    
    res.status(201).json({
      message: 'Registro exitoso',
      token,
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name, 
        plan: user.plan,
        trialEndsAt: user.trialEndsAt
      }
    });
  } catch (error: any) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

// Inicio de sesión
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }
    
    const user = await prisma.user.findUnique({ 
      where: { email: email.toLowerCase().trim() },
      include: {
        assistants: {
          where: { isActive: true },
          take: 1
        }
      }
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const token = generateToken(user.id);
    
    console.log(`✅ Login exitoso: ${user.email}`);
    
    res.json({
      message: 'Inicio de sesión exitoso',
      token,
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name, 
        plan: user.plan,
        whatsappConnected: user.whatsappConnected,
        whatsappPhone: user.whatsappPhone,
        hasApiKey: !!user.openaiApiKey,
        hasActiveAssistant: user.assistants.length > 0,
        trialEndsAt: user.trialEndsAt
      }
    });
  } catch (error: any) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// Obtener usuario actual
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        assistants: true,
        business: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      whatsappConnected: user.whatsappConnected,
      whatsappPhone: user.whatsappPhone,
      hasApiKey: !!user.openaiApiKey,
      trialEndsAt: user.trialEndsAt,
      referralCode: user.referralCode,
      assistantsCount: user.assistants.length,
      hasBusiness: !!user.business,
      createdAt: user.createdAt
    });
  } catch (error: any) {
    console.error('Error obteniendo usuario:', error);
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

// Guardar API Key de OpenAI
router.post('/api-key', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API Key es requerida' });
    }
    
    // Validar formato de API Key
    if (!apiKey.startsWith('sk-')) {
      return res.status(400).json({ error: 'API Key inválida. Debe comenzar con sk-' });
    }

    if (apiKey.length < 20) {
      return res.status(400).json({ error: 'API Key inválida. Formato incorrecto' });
    }
    
    // Encriptar API Key
    const encryptedKey = CryptoJS.AES.encrypt(apiKey, ENCRYPTION_KEY).toString();
    
    await prisma.user.update({
      where: { id: userId },
      data: { openaiApiKey: encryptedKey }
    });
    
    console.log(`✅ API Key guardada para usuario: ${userId}`);
    
    res.json({ message: 'API Key guardada correctamente', hasApiKey: true });
  } catch (error: any) {
    console.error('Error guardando API Key:', error);
    res.status(500).json({ error: 'Error al guardar API Key' });
  }
});

// Eliminar API Key
router.delete('/api-key', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    
    await prisma.user.update({
      where: { id: userId },
      data: { openaiApiKey: null }
    });
    
    console.log(`✅ API Key eliminada para usuario: ${userId}`);
    
    res.json({ message: 'API Key eliminada correctamente', hasApiKey: false });
  } catch (error: any) {
    console.error('Error eliminando API Key:', error);
    res.status(500).json({ error: 'Error al eliminar API Key' });
  }
});

// Verificar API Key (test)
router.get('/api-key/verify', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { openaiApiKey: true }
    });
    
    if (!user?.openaiApiKey) {
      return res.json({ valid: false, message: 'No hay API Key configurada' });
    }
    
    // Desencriptar para verificar
    try {
      const bytes = CryptoJS.AES.decrypt(user.openaiApiKey, ENCRYPTION_KEY);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      
      if (decrypted && decrypted.startsWith('sk-')) {
        return res.json({ valid: true, message: 'API Key válida' });
      }
    } catch (e) {
      return res.json({ valid: false, message: 'Error al verificar API Key' });
    }
    
    res.json({ valid: false, message: 'API Key inválida' });
  } catch (error: any) {
    console.error('Error verificando API Key:', error);
    res.status(500).json({ error: 'Error al verificar API Key' });
  }
});

// Actualizar perfil
router.put('/profile', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { name, email } = req.body;
    
    const updateData: any = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email.toLowerCase().trim();
    
    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData
    });
    
    res.json({
      message: 'Perfil actualizado',
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (error: any) {
    console.error('Error actualizando perfil:', error);
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

// Cambiar contraseña
router.put('/password', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });
    
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (error: any) {
    console.error('Error cambiando contraseña:', error);
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
});

export default router;

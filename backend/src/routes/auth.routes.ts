import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key-2024';

// Middleware de autenticación
export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }
    
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    
    (req as any).user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

// POST /register - Registro de usuario
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }
    
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword
      }
    });
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      },
      token
    });
  } catch (error: any) {
    console.error('❌ Error registro:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

// POST /login - Inicio de sesión
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }
    
    const user = await prisma.user.findUnique({
      where: { email }
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        openaiApiKey: user.openaiApiKey ? '***' : null,
        apiKeyConnected: user.apiKeyConnected
      },
      token
    });
  } catch (error: any) {
    console.error('❌ Error login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// GET /me - Obtener usuario actual
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        openaiApiKey: user.openaiApiKey ? '***' : null,
        apiKeyConnected: user.apiKeyConnected
      }
    });
  } catch (error: any) {
    console.error('❌ Error /me:', error);
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

// PUT /api-key - Actualizar API Key de OpenAI
router.put('/api-key', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { apiKey } = req.body;
    
    await prisma.user.update({
      where: { id: user.id },
      data: { 
        openaiApiKey: apiKey,
        apiKeyConnected: !!apiKey
      }
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error actualizando API Key:', error);
    res.status(500).json({ error: 'Error al actualizar API Key' });
  }
});

export default router;

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

// POST /register
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

// POST /login
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
        apiKeyConnected: user.apiKeyConnected || false
      },
      token
    });
  } catch (error: any) {
    console.error('❌ Error login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// GET /me
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        apiKeyConnected: user.apiKeyConnected || false
      }
    });
  } catch (error: any) {
    console.error('❌ Error /me:', error);
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

// POST /api-key - Guardar API Key de OpenAI del usuario
router.post('/api-key', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API Key es requerida' });
    }
    
    // Guardar la API Key en el campo apiKeyEncrypted
    await prisma.user.update({
      where: { id: user.id },
      data: { 
        apiKeyEncrypted: apiKey,
        apiKeyConnected: true
      }
    });
    
    res.json({ success: true, message: 'API Key guardada correctamente' });
  } catch (error: any) {
    console.error('❌ Error guardando API Key:', error);
    res.status(500).json({ error: 'Error al guardar API Key' });
  }
});

// DELETE /api-key - Eliminar API Key
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
    
    res.json({ success: true, message: 'API Key eliminada' });
  } catch (error: any) {
    console.error('❌ Error eliminando API Key:', error);
    res.status(500).json({ error: 'Error al eliminar API Key' });
  }
});

// POST /test-api-key - Probar API Key
router.post('/test-api-key', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API Key es requerida' });
    }
    
    // Probar la API Key con OpenAI
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey });
    
    await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 5
    });
    
    res.json({ success: true, message: 'API Key válida' });
  } catch (error: any) {
    console.error('❌ Error probando API Key:', error.message);
    res.status(400).json({ error: 'API Key inválida o sin créditos' });
  }
});

export default router;

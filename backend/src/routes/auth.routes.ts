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

    if (!email || !password) {
      res.status(400).json({ error: 'Email y contraseña son requeridos' });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ error: 'El email ya está registrado' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name: name || null }
    });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name },
      token
    });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email y contraseña son requeridos' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name,
        apiKeyConnected: user.apiKeyConnected || false
      },
      token
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;

    if (!userId) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        apiKeyConnected: true,
        createdAt: true
      }
    });

    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.json({ user });
  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

// GET /api/auth/api-key/status - Verificar si tiene API Key configurada
router.get('/api-key/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { apiKey: true, apiKeyConnected: true }
    });

    res.json({ 
      hasApiKey: !!user?.apiKey,
      apiKeyConnected: user?.apiKeyConnected || false
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/auth/api-key - Guardar API Key
router.post('/api-key', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { apiKey } = req.body;

    if (!apiKey) {
      res.status(400).json({ error: 'API Key es requerida' });
      return;
    }

    if (!userId) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { apiKey, apiKeyConnected: true }
    });

    res.json({ success: true, message: 'API Key guardada correctamente' });
  } catch (error) {
    console.error('Error guardando API Key:', error);
    res.status(500).json({ error: 'Error al guardar API Key' });
  }
});

// DELETE /api/auth/api-key - Eliminar API Key
router.delete('/api-key', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;

    await prisma.user.update({
      where: { id: userId },
      data: { apiKey: null, apiKeyConnected: false }
    });

    res.json({ success: true, message: 'API Key eliminada' });
  } catch (error) {
    console.error('Error eliminando API Key:', error);
    res.status(500).json({ error: 'Error al eliminar API Key' });
  }
});

// POST /api/auth/api-key/test - Probar API Key
router.post('/api-key/test', async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey) {
      res.json({ valid: false, message: 'API Key es requerida' });
      return;
    }

    // Validar formato básico
    if (!apiKey.startsWith('sk-')) {
      res.json({ valid: false, message: 'Formato de API Key inválido. Debe comenzar con sk-' });
      return;
    }

    console.log('Probando API Key:', apiKey.substring(0, 15) + '...');

    // Usar fetch con timeout manual
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${apiKey}`
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log('OpenAI response status:', response.status);

      if (response.status === 200) {
        res.json({ valid: true, message: 'API Key válida ✓' });
        return;
      } 
      
      if (response.status === 401) {
        res.json({ valid: false, message: 'API Key inválida' });
        return;
      } 
      
      if (response.status === 429) {
        // 429 significa rate limit pero la key es válida
        res.json({ valid: true, message: 'API Key válida (límite de rate alcanzado)' });
        return;
      } 
      
      if (response.status === 403) {
        res.json({ valid: false, message: 'API Key sin permisos o sin créditos' });
        return;
      }

      // Intentar leer el error
      const errorText = await response.text();
      console.log('OpenAI error response:', errorText);
      
      res.json({ valid: false, message: 'API Key inválida o sin créditos' });

    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        console.log('Request timeout');
        res.json({ valid: false, message: 'Tiempo de espera agotado. Intenta de nuevo.' });
        return;
      }
      
      console.error('Fetch error:', fetchError.message);
      res.json({ valid: false, message: 'Error de conexión. Intenta de nuevo.' });
    }

  } catch (error: any) {
    console.error('Error general probando API Key:', error);
    res.json({ valid: false, message: 'Error al verificar. Intenta de nuevo.' });
  }
});

export default router;

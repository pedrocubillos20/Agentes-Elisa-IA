import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key';

// Límites por plan ACTUALIZADOS
const PLAN_LIMITS: Record<string, number> = {
  FREE: 1,           // 1 chatbot por 5 días de prueba
  EMPRENDEDORES: 1,  // 1 chatbot
  NEGOCIOS: 3,       // 3 chatbots
  BUSINESS: 5,       // 5 chatbots
  MARCA_BLANCA: 999, // Ilimitados
};

// Planes que pueden editar contexto directamente (JSON)
const PLANS_WITH_CONTEXT_EDIT = ['FREE', 'BUSINESS', 'MARCA_BLANCA'];

// Planes que pueden subir PDF (nosotros configuramos)
const PLANS_WITH_PDF_UPLOAD = ['FREE', 'EMPRENDEDORES', 'NEGOCIOS'];

const authenticate = async (req: Request, res: Response, next: Function) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    (req as any).userId = decoded.userId;
    (req as any).user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// Verificar si el trial ha expirado
const checkTrialExpired = (user: any): boolean => {
  if (user.plan === 'FREE' && user.trialEndsAt) {
    return new Date(user.trialEndsAt) < new Date();
  }
  return false;
};

// Obtener información del plan
router.get('/plan-info', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const currentCount = await prisma.assistant.count({ where: { userId: user.id } });
    const limit = PLAN_LIMITS[user.plan] || 0;
    
    res.json({
      plan: user.plan,
      planType: user.planType,
      chatbotsUsed: currentCount,
      chatbotsLimit: limit,
      canEditContext: PLANS_WITH_CONTEXT_EDIT.includes(user.plan),
      mustUploadPdf: PLANS_WITH_PDF_UPLOAD.includes(user.plan),
      trialEndsAt: user.trialEndsAt,
      trialExpired: checkTrialExpired(user),
      // Marca Blanca
      isMarcaBlanca: user.plan === 'MARCA_BLANCA',
      customLogo: user.customLogo,
      customBrandName: user.customBrandName,
      referralCode: user.referralCode,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener información del plan' });
  }
});

// Listar asistentes
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    const assistants = await prisma.assistant.findMany({
      where: { userId: user.id },
      include: {
        business: true,
        _count: { select: { conversations: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    // Agregar información de permisos
    const canEditContext = PLANS_WITH_CONTEXT_EDIT.includes(user.plan);
    const mustUploadPdf = PLANS_WITH_PDF_UPLOAD.includes(user.plan);
    
    res.json({ 
      assistants,
      planInfo: {
        canEditContext,
        mustUploadPdf,
        plan: user.plan,
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener asistentes' });
  }
});

// Obtener un asistente
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    const assistant = await prisma.assistant.findFirst({
      where: { id: req.params.id, userId: user.id },
      include: {
        business: { include: { products: true, faqs: true } },
        conversations: { take: 10, orderBy: { createdAt: 'desc' } }
      }
    });
    
    if (!assistant) return res.status(404).json({ error: 'Asistente no encontrado' });
    
    // Obtener solicitud de configuración si existe
    const configRequest = await prisma.configRequest.findFirst({
      where: { assistantId: assistant.id },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json({ 
      assistant,
      configRequest,
      canEditContext: PLANS_WITH_CONTEXT_EDIT.includes(user.plan),
      mustUploadPdf: PLANS_WITH_PDF_UPLOAD.includes(user.plan),
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener asistente' });
  }
});

// Crear asistente
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { name, tone, contextJson, businessName } = req.body;

    if (!name) return res.status(400).json({ error: 'Nombre requerido' });

    // Verificar trial expirado
    if (checkTrialExpired(user)) {
      return res.status(403).json({ 
        error: 'Tu periodo de prueba ha expirado. Actualiza tu plan para continuar.' 
      });
    }

    // Verificar límite del plan
    const currentCount = await prisma.assistant.count({ where: { userId: user.id } });
    const limit = PLAN_LIMITS[user.plan] || 0;

    if (currentCount >= limit) {
      return res.status(403).json({ 
        error: `Has alcanzado el límite de ${limit} chatbot(s) para tu plan ${user.plan}. Actualiza tu plan para crear más.` 
      });
    }

    // Crear negocio
    const business = await prisma.business.create({
      data: { 
        userId: user.id, 
        name: businessName || name 
      }
    });

    // Generar API Key única
    const publicApiKey = `elisa_${uuidv4().replace(/-/g, '')}`;

    // Crear asistente
    const assistant = await prisma.assistant.create({
      data: {
        userId: user.id,
        businessId: business.id,
        name,
        welcomeMessage: '¡Hola! ¿En qué puedo ayudarte?',
        tone: tone || 'PROFESSIONAL',
        publicApiKey,
        isActive: false, // Inactivo hasta que tenga contexto
        status: 'PENDING',
        // Solo guardar contexto si el plan lo permite
        contextJson: PLANS_WITH_CONTEXT_EDIT.includes(user.plan) ? contextJson : null,
      },
      include: { business: true }
    });

    res.status(201).json({ 
      message: 'Chatbot creado', 
      assistant,
      canEditContext: PLANS_WITH_CONTEXT_EDIT.includes(user.plan),
      mustUploadPdf: PLANS_WITH_PDF_UPLOAD.includes(user.plan),
    });
  } catch (error) {
    console.error('Error creando asistente:', error);
    res.status(500).json({ error: 'Error al crear chatbot' });
  }
});

// Actualizar asistente
router.put('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { name, tone, systemPrompt, primaryColor } = req.body;
    
    const assistant = await prisma.assistant.updateMany({
      where: { id: req.params.id, userId: user.id },
      data: { name, tone, systemPrompt, primaryColor }
    });
    
    if (assistant.count === 0) return res.status(404).json({ error: 'Asistente no encontrado' });
    res.json({ message: 'Asistente actualizado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

// Guardar contexto JSON (para planes FREE, Business y Marca Blanca)
router.put('/:id/context', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { contextJson } = req.body;
    
    // Verificar que el plan permita editar contexto
    if (!PLANS_WITH_CONTEXT_EDIT.includes(user.plan)) {
      return res.status(403).json({ 
        error: 'Tu plan no permite editar el contexto directamente. Sube un PDF con la información de tu negocio.' 
      });
    }
    
    // Validar que es JSON válido si no está vacío
    if (contextJson && contextJson.trim()) {
      try {
        JSON.parse(contextJson);
      } catch {
        return res.status(400).json({ error: 'JSON inválido' });
      }
    }
    
    const assistant = await prisma.assistant.updateMany({
      where: { id: req.params.id, userId: user.id },
      data: { 
        contextJson: contextJson || null,
        isActive: contextJson ? true : false,
        status: contextJson ? 'ACTIVE' : 'PENDING',
      }
    });
    
    if (assistant.count === 0) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }
    
    console.log(`🧠 Contexto actualizado para asistente ${req.params.id}`);
    res.json({ message: 'Contexto guardado exitosamente' });
  } catch (error) {
    console.error('Error guardando contexto:', error);
    res.status(500).json({ error: 'Error al guardar contexto' });
  }
});

// Activar/Desactivar
router.patch('/:id/toggle', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    const assistant = await prisma.assistant.findFirst({
      where: { id: req.params.id, userId: user.id }
    });
    
    if (!assistant) return res.status(404).json({ error: 'Asistente no encontrado' });
    
    // Verificar que tenga contexto antes de activar
    if (!assistant.isActive && !assistant.contextJson) {
      return res.status(400).json({ 
        error: 'No puedes activar el chatbot sin configurar el contexto primero.' 
      });
    }

    await prisma.assistant.update({
      where: { id: assistant.id },
      data: { 
        isActive: !assistant.isActive,
        status: !assistant.isActive ? 'ACTIVE' : 'INACTIVE'
      }
    });

    res.json({ message: assistant.isActive ? 'Desactivado' : 'Activado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al cambiar estado' });
  }
});

// Eliminar
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    await prisma.assistant.deleteMany({ 
      where: { id: req.params.id, userId: (req as any).userId } 
    });
    res.json({ message: 'Asistente eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// Regenerar API Key
router.post('/:id/regenerate-key', authenticate, async (req: Request, res: Response) => {
  try {
    const newKey = `elisa_${uuidv4().replace(/-/g, '')}`;
    await prisma.assistant.updateMany({
      where: { id: req.params.id, userId: (req as any).userId },
      data: { publicApiKey: newKey }
    });
    res.json({ publicApiKey: newKey });
  } catch (error) {
    res.status(500).json({ error: 'Error al regenerar' });
  }
});

// Estadísticas
router.get('/:id/stats', authenticate, async (req: Request, res: Response) => {
  try {
    const assistant = await prisma.assistant.findFirst({
      where: { id: req.params.id, userId: (req as any).userId }
    });
    if (!assistant) return res.status(404).json({ error: 'No encontrado' });

    const [totalConversations, totalMessages, activeConversations, leads] = await Promise.all([
      prisma.conversation.count({ where: { assistantId: assistant.id } }),
      prisma.message.count({ where: { conversation: { assistantId: assistant.id } } }),
      prisma.conversation.count({ where: { assistantId: assistant.id, status: 'ACTIVE' } }),
      prisma.conversation.count({ where: { assistantId: assistant.id, isLead: true } }),
    ]);

    res.json({ stats: { totalConversations, totalMessages, activeConversations, leads } });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

export default router;

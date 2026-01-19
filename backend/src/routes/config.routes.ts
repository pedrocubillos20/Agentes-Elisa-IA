import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key';

// Configurar almacenamiento de archivos
const uploadDir = '/app/uploads/pdfs';

// Crear directorio si no existe
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB máximo
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'));
    }
  }
});

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

// Middleware para verificar admin
const requireAdmin = async (req: Request, res: Response, next: Function) => {
  const user = (req as any).user;
  if (!user.isAdmin) {
    return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
  }
  next();
};

// ========== RUTAS DE USUARIO ==========

// Crear solicitud de configuración con PDF
router.post('/request', authenticate, upload.single('pdf'), async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { assistantId, businessName, notes } = req.body;
    const file = req.file;

    // Verificar que el plan permita subir PDF
    if (!['FREE', 'EMPRENDEDORES', 'NEGOCIOS'].includes(user.plan)) {
      return res.status(400).json({ 
        error: 'Tu plan permite configurar el contexto directamente sin necesidad de enviar PDF.' 
      });
    }

    if (!businessName) {
      return res.status(400).json({ error: 'El nombre del negocio es requerido' });
    }

    // Crear solicitud
    const configRequest = await prisma.configRequest.create({
      data: {
        userId: user.id,
        assistantId: assistantId || null,
        businessName,
        pdfUrl: file ? `/uploads/pdfs/${file.filename}` : null,
        pdfFileName: file?.originalname || null,
        notes,
        status: 'PENDING',
      }
    });

    console.log(`📄 Nueva solicitud de configuración de ${user.email} - ${businessName}`);

    res.status(201).json({ 
      message: 'Solicitud enviada exitosamente. Nuestro equipo configurará tu chatbot pronto.',
      configRequest 
    });
  } catch (error) {
    console.error('Error creando solicitud:', error);
    res.status(500).json({ error: 'Error al enviar solicitud' });
  }
});

// Obtener mis solicitudes de configuración
router.get('/my-requests', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    const requests = await prisma.configRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json({ requests });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener solicitudes' });
  }
});

// ========== RUTAS DE ADMINISTRADOR ==========

// Listar todas las solicitudes pendientes
router.get('/admin/pending', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const requests = await prisma.configRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            plan: true,
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });
    
    res.json({ requests });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener solicitudes' });
  }
});

// Listar todas las solicitudes
router.get('/admin/all', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    
    const where = status ? { status: status as string } : {};
    
    const requests = await prisma.configRequest.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            plan: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json({ requests });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener solicitudes' });
  }
});

// Obtener una solicitud específica
router.get('/admin/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const request = await prisma.configRequest.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            plan: true,
          }
        }
      }
    });
    
    if (!request) {
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }
    
    res.json({ request });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener solicitud' });
  }
});

// Actualizar estado de solicitud
router.put('/admin/:id/status', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { status, adminNotes } = req.body;
    
    if (!['PENDING', 'IN_PROGRESS', 'COMPLETED'].includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    
    const request = await prisma.configRequest.update({
      where: { id: req.params.id },
      data: { status, adminNotes }
    });
    
    res.json({ message: 'Estado actualizado', request });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

// Guardar configuración JSON para un cliente
router.put('/admin/:id/config', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { configJson, assistantId } = req.body;
    
    // Validar JSON
    if (configJson) {
      try {
        JSON.parse(configJson);
      } catch {
        return res.status(400).json({ error: 'JSON inválido' });
      }
    }
    
    // Obtener la solicitud
    const request = await prisma.configRequest.findUnique({
      where: { id: req.params.id }
    });
    
    if (!request) {
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }
    
    // Actualizar la solicitud
    await prisma.configRequest.update({
      where: { id: req.params.id },
      data: { 
        configJson,
        assistantId: assistantId || request.assistantId,
        status: 'COMPLETED'
      }
    });
    
    // Si hay un asistente asociado, actualizar su contexto
    if (assistantId || request.assistantId) {
      await prisma.assistant.update({
        where: { id: assistantId || request.assistantId! },
        data: { 
          contextJson: configJson,
          isActive: true,
          status: 'ACTIVE'
        }
      });
    }
    
    console.log(`✅ Configuración aplicada para solicitud ${req.params.id}`);
    res.json({ message: 'Configuración guardada y aplicada exitosamente' });
  } catch (error) {
    console.error('Error guardando configuración:', error);
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

// Descargar PDF
router.get('/admin/:id/download-pdf', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const request = await prisma.configRequest.findUnique({
      where: { id: req.params.id }
    });
    
    if (!request || !request.pdfUrl) {
      return res.status(404).json({ error: 'PDF no encontrado' });
    }
    
    const filePath = path.join('/app', request.pdfUrl);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    
    res.download(filePath, request.pdfFileName || 'documento.pdf');
  } catch (error) {
    res.status(500).json({ error: 'Error al descargar PDF' });
  }
});

// Estadísticas de solicitudes
router.get('/admin/stats', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const [pending, inProgress, completed, total] = await Promise.all([
      prisma.configRequest.count({ where: { status: 'PENDING' } }),
      prisma.configRequest.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.configRequest.count({ where: { status: 'COMPLETED' } }),
      prisma.configRequest.count(),
    ]);
    
    res.json({ stats: { pending, inProgress, completed, total } });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

export default router;

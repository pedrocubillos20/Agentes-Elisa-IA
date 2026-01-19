import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Obtener solicitudes de configuración del usuario
router.get('/requests', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    
    const requests = await prisma.configRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { 
        assistant: { 
          select: { name: true } 
        } 
      }
    });
    
    res.json(requests);
  } catch (error: any) {
    console.error('Error obteniendo solicitudes:', error);
    res.status(500).json({ error: 'Error al obtener solicitudes' });
  }
});

// Crear nueva solicitud de configuración
router.post('/requests', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { assistantId, notes, pdfPath } = req.body;
    
    const request = await prisma.configRequest.create({
      data: { 
        userId: userId!, 
        assistantId, 
        notes, 
        pdfPath,
        status: 'PENDING' 
      },
      include: {
        assistant: { select: { name: true } }
      }
    });
    
    console.log(`✅ Solicitud de configuración creada`);
    
    res.status(201).json(request);
  } catch (error: any) {
    console.error('Error creando solicitud:', error);
    res.status(500).json({ error: 'Error al crear solicitud' });
  }
});

// Obtener una solicitud específica
router.get('/requests/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    
    const request = await prisma.configRequest.findFirst({
      where: { id, userId },
      include: { 
        assistant: { select: { name: true } } 
      }
    });
    
    if (!request) {
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }
    
    res.json(request);
  } catch (error: any) {
    console.error('Error obteniendo solicitud:', error);
    res.status(500).json({ error: 'Error al obtener solicitud' });
  }
});

// Cancelar solicitud
router.delete('/requests/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    
    const request = await prisma.configRequest.findFirst({
      where: { id, userId }
    });
    
    if (!request) {
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }
    
    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: 'Solo se pueden cancelar solicitudes pendientes' });
    }
    
    await prisma.configRequest.delete({ where: { id } });
    
    res.json({ message: 'Solicitud cancelada' });
  } catch (error: any) {
    console.error('Error cancelando solicitud:', error);
    res.status(500).json({ error: 'Error al cancelar solicitud' });
  }
});

export default router;

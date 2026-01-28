import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from './auth.routes';

const router = Router();

// GET / - Obtener todos los asistentes
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    const assistants = await prisma.assistant.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json({ assistants });
  } catch (error: any) {
    console.error('❌ Error obteniendo asistentes:', error);
    res.status(500).json({ error: 'Error al obtener asistentes' });
  }
});

// POST / - Crear asistente
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { name, context, model, temperature, maxTokens } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }
    
    // Desactivar otros asistentes
    await prisma.assistant.updateMany({
      where: { userId: user.id },
      data: { isActive: false }
    });
    
    const assistant = await prisma.assistant.create({
      data: {
        userId: user.id,
        name,
        context: context || '',
        model: model || 'gpt-4-turbo-preview',
        temperature: temperature || 0.7,
        maxTokens: maxTokens || 500,
        isActive: true
      }
    });
    
    res.json({ assistant });
  } catch (error: any) {
    console.error('❌ Error creando asistente:', error);
    res.status(500).json({ error: 'Error al crear asistente' });
  }
});

// PUT /:id - Actualizar asistente
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { name, context, model, temperature, maxTokens } = req.body;
    
    const existing = await prisma.assistant.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }
    
    const assistant = await prisma.assistant.update({
      where: { id },
      data: {
        name: name || existing.name,
        context: context !== undefined ? context : existing.context,
        model: model || existing.model,
        temperature: temperature !== undefined ? temperature : existing.temperature,
        maxTokens: maxTokens !== undefined ? maxTokens : existing.maxTokens
      }
    });
    
    res.json({ assistant });
  } catch (error: any) {
    console.error('❌ Error actualizando asistente:', error);
    res.status(500).json({ error: 'Error al actualizar asistente' });
  }
});

// POST /:id/activate - Activar asistente
router.post('/:id/activate', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    
    const existing = await prisma.assistant.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }
    
    // Desactivar todos
    await prisma.assistant.updateMany({
      where: { userId: user.id },
      data: { isActive: false }
    });
    
    // Activar el seleccionado
    const assistant = await prisma.assistant.update({
      where: { id },
      data: { isActive: true }
    });
    
    res.json({ assistant });
  } catch (error: any) {
    console.error('❌ Error activando asistente:', error);
    res.status(500).json({ error: 'Error al activar asistente' });
  }
});

// DELETE /:id - Eliminar asistente
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    
    const existing = await prisma.assistant.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }
    
    await prisma.assistant.delete({
      where: { id }
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error eliminando asistente:', error);
    res.status(500).json({ error: 'Error al eliminar asistente' });
  }
});

export default router;

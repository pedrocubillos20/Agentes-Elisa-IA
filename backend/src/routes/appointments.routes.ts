import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// GET /api/appointments
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { date, status, type } = req.query;

    const where: any = { userId };
    
    if (status) where.status = status;
    if (type) where.type = type;
    if (date) {
      const startDate = new Date(date as string);
      const endDate = new Date(date as string);
      endDate.setDate(endDate.getDate() + 1);
      where.date = { gte: startDate, lt: endDate };
    }

    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: { date: 'asc' },
      include: { client: true }
    });

    res.json({ appointments });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener citas' });
  }
});

// GET /api/appointments/today
router.get('/today', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const appointments = await prisma.appointment.findMany({
      where: {
        userId,
        date: { gte: today, lt: tomorrow }
      },
      orderBy: { time: 'asc' },
      include: { client: true }
    });

    res.json({ appointments });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener citas' });
  }
});

// GET /api/appointments/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;

    const total = await prisma.appointment.count({ where: { userId } });
    const pending = await prisma.appointment.count({ where: { userId, status: 'pending' } });
    const confirmed = await prisma.appointment.count({ where: { userId, status: 'confirmed' } });
    const completed = await prisma.appointment.count({ where: { userId, status: 'completed' } });

    res.json({ total, pending, confirmed, completed });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// POST /api/appointments
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { 
      type, clientId, clientName, clientPhone, 
      date, time, duration, notes, address, 
      products, total, status 
    } = req.body;

    const appointment = await prisma.appointment.create({
      data: {
        userId: userId!,
        type: type || 'appointment',
        clientId,
        clientName,
        clientPhone,
        date: new Date(date),
        time,
        duration,
        notes,
        address,
        products,
        total,
        status: status || 'pending'
      }
    });

    if (type === 'order' && clientId && total) {
      await prisma.client.update({
        where: { id: clientId },
        data: {
          totalPurchases: { increment: total },
          status: 'active'
        }
      });
    }

    res.status(201).json({ appointment });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al crear cita' });
  }
});

// PUT /api/appointments/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { id } = req.params;

    const existing = await prisma.appointment.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ error: 'Cita no encontrada' });
      return;
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: req.body
    });

    res.json({ appointment });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al actualizar cita' });
  }
});

// PUT /api/appointments/:id/status
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { id } = req.params;
    const { status } = req.body;

    const existing = await prisma.appointment.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ error: 'Cita no encontrada' });
      return;
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: { status }
    });

    res.json({ appointment });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

// DELETE /api/appointments/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { id } = req.params;

    await prisma.appointment.deleteMany({ where: { id, userId } });
    res.json({ message: 'Cita eliminada' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al eliminar cita' });
  }
});

export default router;

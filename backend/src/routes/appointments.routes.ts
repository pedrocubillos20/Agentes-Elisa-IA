import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string; parentUserId?: string };
}

const router = Router();
const prisma = new PrismaClient();

// Helper: convierte string de fecha a DateTime ISO válido para Prisma
function toDateTime(dateStr: string): Date {
  if (!dateStr) return new Date();
  if (dateStr.includes('T')) return new Date(dateStr);
  return new Date(dateStr + 'T12:00:00.000Z');
}

// GET /api/appointments
router.get('/', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    const userId = user?.parentUserId || user?.id;
    const { type, status, date, startDate, endDate, limit = '100', lineId } = req.query;

    const where: any = { userId };
    if (lineId) where.whatsappLineId = lineId as string;
    if (type && type !== 'all') where.type = type;
    if (status && status !== 'all') where.status = status;

    if (date) {
      const targetDate = new Date(date as string);
      targetDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);
      where.date = { gte: targetDate, lt: nextDay };
    }

    if (startDate && endDate) {
      where.date = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string)
      };
    }

    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      take: parseInt(limit as string),
      include: {
        client: { select: { id: true, name: true, phone: true, email: true } }
      }
    });

    res.json({ appointments });
  } catch (error: any) {
    console.error('Error listando citas:', error);
    res.status(500).json({ error: 'Error al obtener citas' });
  }
});

// GET /api/appointments/today
router.get('/today', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    const userId = user?.parentUserId || user?.id;
    const { lineId } = req.query;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const where: any = { userId, date: { gte: today, lt: tomorrow } };
    if (lineId) where.whatsappLineId = lineId as string;

    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: { time: 'asc' },
      include: { client: true }
    });

    res.json({ appointments });
  } catch (error) {
    console.error('Error obteniendo citas de hoy:', error);
    res.status(500).json({ error: 'Error al obtener citas' });
  }
});

// GET /api/appointments/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    const userId = user?.parentUserId || user?.id;
    const { lineId } = req.query;
    const where: any = { userId };
    if (lineId) where.whatsappLineId = lineId as string;

    const total = await prisma.appointment.count({ where });
    const pending = await prisma.appointment.count({ where: { ...where, status: 'pending' } });
    const confirmed = await prisma.appointment.count({ where: { ...where, status: 'confirmed' } });
    const completed = await prisma.appointment.count({ where: { ...where, status: 'completed' } });

    res.json({ total, pending, confirmed, completed });
  } catch (error) {
    console.error('Error stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// POST /api/appointments
router.post('/', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    const userId = user?.parentUserId || user?.id;
    const {
      type, clientId, clientName, clientPhone,
      date, time, duration, notes, address,
      products, total, status, lineId
    } = req.body;

    if (!clientName || !clientPhone || !date || !time) {
      return res.status(400).json({ error: 'Nombre, teléfono, fecha y hora son requeridos' });
    }

    if (clientId) {
      const client = await prisma.client.findFirst({ where: { id: clientId, userId } });
      if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const appointment = await prisma.appointment.create({
      data: {
        userId: userId!,
        clientId: clientId || null,
        type: type || 'appointment',
        clientName,
        clientPhone,
        date: toDateTime(date),
        time,
        duration: duration || null,
        status: status || 'pending',
        notes: notes || null,
        address: address || null,
        products: products || null,
        total: total || null,
        whatsappLineId: lineId || null
      },
      include: {
        client: { select: { id: true, name: true, phone: true } }
      }
    });

    if (type === 'order' && total && clientId) {
      await prisma.client.update({
        where: { id: clientId },
        data: {
          totalPurchases: { increment: total },
          status: 'active',
          lastContact: new Date()
        }
      });
    }

    res.status(201).json({ appointment });
  } catch (error: any) {
    console.error('Error creando cita:', error);
    res.status(500).json({ error: 'Error al crear cita' });
  }
});

// PUT /api/appointments/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    const userId = user?.parentUserId || user?.id;
    const { id } = req.params;
    const {
      type, clientName, clientPhone, date, time,
      duration, notes, address, products, total, status
    } = req.body;

    const existing = await prisma.appointment.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ error: 'Cita no encontrada' });

    const appointment = await prisma.appointment.update({
      where: { id },
      data: {
        type: type !== undefined ? type : existing.type,
        clientName: clientName !== undefined ? clientName : existing.clientName,
        clientPhone: clientPhone !== undefined ? clientPhone : existing.clientPhone,
        date: date !== undefined ? toDateTime(date) : existing.date,
        time: time !== undefined ? time : existing.time,
        duration: duration !== undefined ? duration : existing.duration,
        notes: notes !== undefined ? notes : existing.notes,
        address: address !== undefined ? address : existing.address,
        products: products !== undefined ? products : existing.products,
        total: total !== undefined ? total : existing.total,
        status: status !== undefined ? status : existing.status
      },
      include: {
        client: { select: { id: true, name: true, phone: true } }
      }
    });

    res.json({ appointment });
  } catch (error: any) {
    console.error('Error actualizando cita:', error);
    res.status(500).json({ error: 'Error al actualizar cita' });
  }
});

// PUT /api/appointments/:id/status
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    const userId = user?.parentUserId || user?.id;
    const { id } = req.params;
    const { status } = req.body;

    const existing = await prisma.appointment.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ error: 'Cita no encontrada' });

    const appointment = await prisma.appointment.update({
      where: { id },
      data: { status }
    });

    if (status === 'completed' && existing.type === 'order' && existing.total && existing.clientId) {
      await prisma.client.update({
        where: { id: existing.clientId },
        data: {
          totalPurchases: { increment: existing.total },
          lastContact: new Date()
        }
      });
    }

    res.json({ appointment });
  } catch (error) {
    console.error('Error actualizando estado:', error);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

// DELETE /api/appointments/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    const userId = user?.parentUserId || user?.id;
    const { id } = req.params;

    const existing = await prisma.appointment.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ error: 'Cita no encontrada' });

    await prisma.appointment.delete({ where: { id } });
    res.json({ message: 'Cita eliminada' });
  } catch (error) {
    console.error('Error eliminando cita:', error);
    res.status(500).json({ error: 'Error al eliminar cita' });
  }
});

export default router;

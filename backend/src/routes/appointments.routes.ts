import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from './auth.routes';

const router = Router();

// ==========================================
// GET / - Obtener todas las citas/pedidos
// ==========================================
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { type, status, date, startDate, endDate, limit = '50' } = req.query;
    
    const where: any = { userId: user.id };
    
    if (type && type !== 'all') {
      where.type = type;
    }
    
    if (status && status !== 'all') {
      where.status = status;
    }
    
    // Filtro por fecha específica
    if (date) {
      const targetDate = new Date(date as string);
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);
      
      where.date = {
        gte: targetDate,
        lt: nextDay
      };
    }
    
    // Filtro por rango de fechas
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
        client: {
          select: { id: true, name: true, phone: true, email: true }
        }
      }
    });
    
    res.json({ appointments });
  } catch (error: any) {
    console.error('❌ Error obteniendo citas:', error);
    res.status(500).json({ error: 'Error al obtener citas' });
  }
});

// ==========================================
// GET /stats - Estadísticas de agenda
// ==========================================
router.get('/stats', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const [total, todayCount, pending, confirmed, completed, totalOrders] = await Promise.all([
      prisma.appointment.count({ where: { userId: user.id } }),
      prisma.appointment.count({ 
        where: { 
          userId: user.id,
          date: { gte: today, lt: tomorrow }
        } 
      }),
      prisma.appointment.count({ where: { userId: user.id, status: 'pending' } }),
      prisma.appointment.count({ where: { userId: user.id, status: 'confirmed' } }),
      prisma.appointment.count({ where: { userId: user.id, status: 'completed' } }),
      prisma.appointment.aggregate({
        where: { userId: user.id, type: 'order' },
        _sum: { total: true }
      })
    ]);
    
    res.json({
      total,
      today: todayCount,
      pending,
      confirmed,
      completed,
      totalOrdersAmount: totalOrders._sum.total || 0
    });
  } catch (error: any) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// ==========================================
// GET /today - Citas de hoy
// ==========================================
router.get('/today', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const appointments = await prisma.appointment.findMany({
      where: {
        userId: user.id,
        date: { gte: today, lt: tomorrow }
      },
      orderBy: { time: 'asc' },
      include: {
        client: {
          select: { id: true, name: true, phone: true }
        }
      }
    });
    
    res.json({ appointments });
  } catch (error: any) {
    console.error('❌ Error obteniendo citas de hoy:', error);
    res.status(500).json({ error: 'Error al obtener citas de hoy' });
  }
});

// ==========================================
// GET /upcoming - Próximas citas
// ==========================================
router.get('/upcoming', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { limit = '10' } = req.query;
    const now = new Date();
    
    const appointments = await prisma.appointment.findMany({
      where: {
        userId: user.id,
        date: { gte: now },
        status: { in: ['pending', 'confirmed'] }
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      take: parseInt(limit as string),
      include: {
        client: {
          select: { id: true, name: true, phone: true }
        }
      }
    });
    
    res.json({ appointments });
  } catch (error: any) {
    console.error('❌ Error obteniendo próximas citas:', error);
    res.status(500).json({ error: 'Error al obtener próximas citas' });
  }
});

// ==========================================
// GET /:id - Obtener una cita/pedido
// ==========================================
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    
    const appointment = await prisma.appointment.findFirst({
      where: { id, userId: user.id },
      include: {
        client: true
      }
    });
    
    if (!appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }
    
    res.json({ appointment });
  } catch (error: any) {
    console.error('❌ Error obteniendo cita:', error);
    res.status(500).json({ error: 'Error al obtener cita' });
  }
});

// ==========================================
// POST / - Crear cita/pedido
// ==========================================
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { 
      type, clientId, clientName, clientPhone, 
      date, time, duration, notes, address, 
      products, total 
    } = req.body;
    
    if (!type || !clientName || !clientPhone || !date || !time) {
      return res.status(400).json({ 
        error: 'Tipo, nombre, teléfono, fecha y hora son requeridos' 
      });
    }
    
    // Si hay clientId, verificar que existe
    if (clientId) {
      const client = await prisma.client.findFirst({
        where: { id: clientId, userId: user.id }
      });
      if (!client) {
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }
    }
    
    const appointment = await prisma.appointment.create({
      data: {
        userId: user.id,
        clientId: clientId || null,
        type,
        clientName,
        clientPhone,
        date: new Date(date),
        time,
        duration: duration || null,
        status: 'pending',
        notes: notes || null,
        address: address || null,
        products: products || null,
        total: total || null
      },
      include: {
        client: {
          select: { id: true, name: true, phone: true }
        }
      }
    });
    
    // Si es un pedido completado, actualizar el cliente
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
    
    res.json({ appointment });
  } catch (error: any) {
    console.error('❌ Error creando cita:', error);
    res.status(500).json({ error: 'Error al crear cita' });
  }
});

// ==========================================
// PUT /:id - Actualizar cita/pedido
// ==========================================
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { 
      clientName, clientPhone, date, time, 
      duration, notes, address, products, total, status 
    } = req.body;
    
    const existing = await prisma.appointment.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }
    
    const appointment = await prisma.appointment.update({
      where: { id },
      data: {
        clientName: clientName !== undefined ? clientName : existing.clientName,
        clientPhone: clientPhone !== undefined ? clientPhone : existing.clientPhone,
        date: date !== undefined ? new Date(date) : existing.date,
        time: time !== undefined ? time : existing.time,
        duration: duration !== undefined ? duration : existing.duration,
        notes: notes !== undefined ? notes : existing.notes,
        address: address !== undefined ? address : existing.address,
        products: products !== undefined ? products : existing.products,
        total: total !== undefined ? total : existing.total,
        status: status !== undefined ? status : existing.status
      },
      include: {
        client: {
          select: { id: true, name: true, phone: true }
        }
      }
    });
    
    res.json({ appointment });
  } catch (error: any) {
    console.error('❌ Error actualizando cita:', error);
    res.status(500).json({ error: 'Error al actualizar cita' });
  }
});

// ==========================================
// PUT /:id/status - Cambiar estado
// ==========================================
router.put('/:id/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { status } = req.body;
    
    if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    
    const existing = await prisma.appointment.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }
    
    const appointment = await prisma.appointment.update({
      where: { id },
      data: { status }
    });
    
    // Si se completa un pedido, actualizar las ventas del cliente
    if (status === 'completed' && existing.type === 'order' && existing.total && existing.clientId) {
      await prisma.client.update({
        where: { id: existing.clientId },
        data: {
          totalPurchases: { increment: existing.total },
          status: 'active',
          lastContact: new Date()
        }
      });
    }
    
    res.json({ appointment });
  } catch (error: any) {
    console.error('❌ Error cambiando estado:', error);
    res.status(500).json({ error: 'Error al cambiar estado' });
  }
});

// ==========================================
// DELETE /:id - Eliminar cita/pedido
// ==========================================
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    
    const existing = await prisma.appointment.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }
    
    await prisma.appointment.delete({
      where: { id }
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error eliminando cita:', error);
    res.status(500).json({ error: 'Error al eliminar cita' });
  }
});

export default router;

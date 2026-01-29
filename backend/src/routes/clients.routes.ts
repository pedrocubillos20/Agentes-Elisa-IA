import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from './auth.routes';

const router = Router();

// ==========================================
// GET / - Obtener todos los clientes
// ==========================================
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { status, search, limit = '50' } = req.query;
    
    const where: any = { userId: user.id };
    
    if (status && status !== 'all') {
      where.status = status;
    }
    
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string } },
        { email: { contains: search as string, mode: 'insensitive' } }
      ];
    }
    
    const clients = await prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string),
      include: {
        _count: { select: { appointments: true } }
      }
    });
    
    res.json({ clients });
  } catch (error: any) {
    console.error('❌ Error obteniendo clientes:', error);
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});

// ==========================================
// GET /stats - Estadísticas de clientes
// ==========================================
router.get('/stats', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    const [total, active, leads, inactive, totalRevenue] = await Promise.all([
      prisma.client.count({ where: { userId: user.id } }),
      prisma.client.count({ where: { userId: user.id, status: 'active' } }),
      prisma.client.count({ where: { userId: user.id, status: 'lead' } }),
      prisma.client.count({ where: { userId: user.id, status: 'inactive' } }),
      prisma.client.aggregate({
        where: { userId: user.id },
        _sum: { totalPurchases: true }
      })
    ]);
    
    res.json({
      total,
      active,
      leads,
      inactive,
      totalRevenue: totalRevenue._sum.totalPurchases || 0
    });
  } catch (error: any) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// ==========================================
// GET /:id - Obtener un cliente
// ==========================================
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    
    const client = await prisma.client.findFirst({
      where: { id, userId: user.id },
      include: {
        appointments: {
          orderBy: { date: 'desc' },
          take: 10
        }
      }
    });
    
    if (!client) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    
    res.json({ client });
  } catch (error: any) {
    console.error('❌ Error obteniendo cliente:', error);
    res.status(500).json({ error: 'Error al obtener cliente' });
  }
});

// ==========================================
// POST / - Crear cliente
// ==========================================
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { name, phone, email, address, notes, tags, status } = req.body;
    
    if (!name || !phone) {
      return res.status(400).json({ error: 'Nombre y teléfono son requeridos' });
    }
    
    // Verificar si ya existe un cliente con ese teléfono
    const existing = await prisma.client.findFirst({
      where: { userId: user.id, phone }
    });
    
    if (existing) {
      return res.status(400).json({ error: 'Ya existe un cliente con ese teléfono' });
    }
    
    const client = await prisma.client.create({
      data: {
        userId: user.id,
        name,
        phone,
        email: email || null,
        address: address || null,
        notes: notes || null,
        tags: tags || [],
        status: status || 'lead'
      }
    });
    
    res.json({ client });
  } catch (error: any) {
    console.error('❌ Error creando cliente:', error);
    res.status(500).json({ error: 'Error al crear cliente' });
  }
});

// ==========================================
// PUT /:id - Actualizar cliente
// ==========================================
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { name, phone, email, address, notes, tags, status, totalPurchases } = req.body;
    
    const existing = await prisma.client.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    
    const client = await prisma.client.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existing.name,
        phone: phone !== undefined ? phone : existing.phone,
        email: email !== undefined ? email : existing.email,
        address: address !== undefined ? address : existing.address,
        notes: notes !== undefined ? notes : existing.notes,
        tags: tags !== undefined ? tags : existing.tags,
        status: status !== undefined ? status : existing.status,
        totalPurchases: totalPurchases !== undefined ? totalPurchases : existing.totalPurchases,
        lastContact: new Date()
      }
    });
    
    res.json({ client });
  } catch (error: any) {
    console.error('❌ Error actualizando cliente:', error);
    res.status(500).json({ error: 'Error al actualizar cliente' });
  }
});

// ==========================================
// DELETE /:id - Eliminar cliente
// ==========================================
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    
    const existing = await prisma.client.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    
    await prisma.client.delete({
      where: { id }
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error eliminando cliente:', error);
    res.status(500).json({ error: 'Error al eliminar cliente' });
  }
});

// ==========================================
// POST /:id/add-purchase - Agregar compra
// ==========================================
router.post('/:id/add-purchase', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { amount } = req.body;
    
    const existing = await prisma.client.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    
    const client = await prisma.client.update({
      where: { id },
      data: {
        totalPurchases: existing.totalPurchases + (amount || 0),
        status: 'active',
        lastContact: new Date()
      }
    });
    
    res.json({ client });
  } catch (error: any) {
    console.error('❌ Error agregando compra:', error);
    res.status(500).json({ error: 'Error al agregar compra' });
  }
});

export default router;

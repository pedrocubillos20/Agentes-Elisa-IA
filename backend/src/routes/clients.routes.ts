import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// GET /api/clients
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { search, status } = req.query;

    let where: any = { userId };
    
    if (status) where.status = status;
    
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string } },
        { email: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    const clients = await prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ clients });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});

// GET /api/clients/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;

    const total = await prisma.client.count({ where: { userId } });
    const active = await prisma.client.count({ where: { userId, status: 'active' } });
    const leads = await prisma.client.count({ where: { userId, status: 'lead' } });

    res.json({ total, active, leads });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// POST /api/clients
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { name, phone, email, address, notes, tags, status } = req.body;

    const client = await prisma.client.create({
      data: {
        userId: userId!,
        name,
        phone,
        email,
        address,
        notes,
        tags: tags || [],
        status: status || 'lead'
      }
    });

    res.status(201).json({ client });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al crear cliente' });
  }
});

// PUT /api/clients/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { id } = req.params;
    const { name, phone, email, address, notes, tags, status, totalPurchases } = req.body;

    const existing = await prisma.client.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ error: 'Cliente no encontrado' });
      return;
    }

    const client = await prisma.client.update({
      where: { id },
      data: { name, phone, email, address, notes, tags, status, totalPurchases }
    });

    res.json({ client });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al actualizar cliente' });
  }
});

// DELETE /api/clients/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { id } = req.params;

    await prisma.client.deleteMany({ where: { id, userId } });
    res.json({ message: 'Cliente eliminado' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al eliminar cliente' });
  }
});

export default router;

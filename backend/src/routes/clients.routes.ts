import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

const getOwnerId = async (userId: string): Promise<string> => {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  return u?.parentUserId || userId;
};

// GET /api/clients?lineId=xxx
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { search, status, lineId } = req.query;

    const where: any = { userId: ownerId };
    if (status) where.status = status;
    if (lineId) where.whatsappLineId = lineId as string;
    
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string } },
        { email: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    const clients = await prisma.client.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ clients });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});

// GET /api/clients/stats?lineId=xxx
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { lineId } = req.query;

    const where: any = { userId: ownerId };
    if (lineId) where.whatsappLineId = lineId as string;

    const [total, active, leads] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.count({ where: { ...where, status: 'active' } }),
      prisma.client.count({ where: { ...where, status: 'lead' } })
    ]);

    res.json({ total, active, leads });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/clients
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { name, phone, email, address, notes, tags, status, lineId } = req.body;

    const client = await prisma.client.create({
      data: {
        userId: ownerId,
        name, phone, email, address, notes,
        tags: tags || [],
        status: status || 'lead',
        whatsappLineId: lineId || null
      }
    });
    res.status(201).json({ client });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear cliente' });
  }
});

// PUT /api/clients/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;
    const { name, phone, email, address, notes, tags, status, totalPurchases } = req.body;

    const existing = await prisma.client.findFirst({ where: { id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'No encontrado' }); return; }

    const client = await prisma.client.update({
      where: { id },
      data: { name, phone, email, address, notes, tags, status, totalPurchases }
    });
    res.json({ client });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// DELETE /api/clients/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    await prisma.client.deleteMany({ where: { id: req.params.id, userId: ownerId } });
    res.json({ message: 'Eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

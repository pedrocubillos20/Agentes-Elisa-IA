import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// ⚡ getOwnerId con cache — sub-usuarios heredan clientes del admin
const ownerIdCache = new Map<string, { value: string; ts: number }>();
const getOwnerId = async (userId: string): Promise<string> => {
  const cached = ownerIdCache.get(userId);
  if (cached && Date.now() - cached.ts < 300000) return cached.value;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  const ownerId = user?.parentUserId || userId;
  ownerIdCache.set(userId, { value: ownerId, ts: Date.now() });
  return ownerId;
};

// GET /api/clients
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { search, status, lineId } = req.query;

    const where: any = { userId: ownerId };
    if (lineId) where.whatsappLineId = lineId as string;
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
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { lineId } = req.query;
    const where: any = { userId: ownerId };
    if (lineId) where.whatsappLineId = lineId as string;

    const total = await prisma.client.count({ where });
    const active = await prisma.client.count({ where: { ...where, status: 'active' } });
    const leads = await prisma.client.count({ where: { ...where, status: 'lead' } });

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
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { name, phone, email, address, notes, tags, status, lineId } = req.body;

    const client = await prisma.client.create({
      data: {
        userId: ownerId,
        name,
        phone,
        email,
        address,
        notes,
        tags: tags || [],
        status: status || 'lead',
        whatsappLineId: lineId || null
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
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;
    const { name, phone, email, address, notes, tags, status } = req.body;

    const existing = await prisma.client.findFirst({ where: { id, userId: ownerId } });
    if (!existing) {
      res.status(404).json({ error: 'Cliente no encontrado' });
      return;
    }

    const client = await prisma.client.update({
      where: { id },
      data: { name, phone, email, address, notes, tags, status }
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
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;

    await prisma.client.deleteMany({ where: { id, userId: ownerId } });
    res.json({ message: 'Cliente eliminado' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al eliminar cliente' });
  }
});

export default router;

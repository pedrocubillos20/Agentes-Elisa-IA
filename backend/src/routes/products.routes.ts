import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// ⚡ getOwnerId con cache — sub-usuarios heredan productos del admin
const ownerIdCache = new Map<string, { value: string; ts: number }>();
const getOwnerId = async (userId: string): Promise<string> => {
  const cached = ownerIdCache.get(userId);
  if (cached && Date.now() - cached.ts < 300000) return cached.value;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  const ownerId = user?.parentUserId || userId;
  ownerIdCache.set(userId, { value: ownerId, ts: Date.now() });
  return ownerId;
};

// GET /api/products
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { category, lineId } = req.query;

    const where: any = { userId: ownerId };
    if (lineId) where.whatsappLineId = lineId as string;
    if (category) where.category = category as string;

    const products = await prisma.product.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ products });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// GET /api/products/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { lineId } = req.query;
    const where: any = { userId: ownerId };
    if (lineId) where.whatsappLineId = lineId as string;

    const total = await prisma.product.count({ where });
    const active = await prisma.product.count({ where: { ...where, isActive: true } });
    const lowStock = await prisma.product.count({ where: { ...where, stock: { lt: 10 } } });
    res.json({ total, active, lowStock });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/products
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    
    // === VERIFICAR LÍMITE DE PRODUCTOS ===
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { plan: true } });
    const baseLimits: Record<string, number> = { trial: 10, starter: 10, business: 20 };
    const baseMax = baseLimits[owner?.plan || 'trial'] || 10;
    
    // Contar productos extra comprados
    const extraProductsPurchased = await prisma.payment.count({
      where: { userId: ownerId, plan: 'extra_products', status: 'approved' }
    });
    const maxProducts = baseMax + (extraProductsPurchased * 10);
    
    const currentCount = await prisma.product.count({ where: { userId: ownerId } });
    if (currentCount >= maxProducts) {
      res.status(403).json({ 
        error: `Has alcanzado el límite de ${maxProducts} productos de tu plan. Compra más productos para expandir tu catálogo.`,
        limit: maxProducts,
        current: currentCount,
        needsUpgrade: true
      });
      return;
    }
    // === FIN VERIFICACIÓN ===

    const { name, description, price, category, image, stock, lineId } = req.body;

    const product = await prisma.product.create({
      data: {
        userId: ownerId, name, description,
        price: parseFloat(price) || 0, category, image,
        stock: parseInt(stock) || 0, whatsappLineId: lineId || null
      }
    });
    res.status(201).json({ product });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// PUT /api/products/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;
    const { name, description, price, category, image, stock, isActive } = req.body;

    const existing = await prisma.product.findFirst({ where: { id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'Producto no encontrado' }); return; }

    const product = await prisma.product.update({
      where: { id },
      data: {
        name, description,
        price: price !== undefined ? parseFloat(price) : undefined,
        category, image,
        stock: stock !== undefined ? parseInt(stock) : undefined,
        isActive
      }
    });
    res.json({ product });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// DELETE /api/products/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;

    await prisma.product.deleteMany({ where: { id, userId: ownerId } });
    res.json({ message: 'Producto eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

export default router;

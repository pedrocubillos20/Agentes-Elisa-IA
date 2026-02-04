import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// GET /api/products
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { category, lineId } = req.query;

    const where: any = { userId };
    if (lineId) where.whatsappLineId = lineId as string;
    if (category) where.category = category as string;

    const products = await prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

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
    const { lineId } = req.query;
    const where: any = { userId };
    if (lineId) where.whatsappLineId = lineId as string;

    const total = await prisma.product.count({ where });
    const active = await prisma.product.count({ where: { ...where, isActive: true } });
    const lowStock = await prisma.product.count({ where: { ...where, stock: { lt: 10 } } });

    res.json({ total, active, lowStock });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// POST /api/products
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { name, description, price, category, image, stock, lineId } = req.body;

    const product = await prisma.product.create({
      data: {
        userId: userId!,
        name,
        description,
        price: parseFloat(price) || 0,
        category,
        image,
        stock: parseInt(stock) || 0,
        whatsappLineId: lineId || null
      }
    });

    res.status(201).json({ product });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// PUT /api/products/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { id } = req.params;
    const { name, description, price, category, image, stock, isActive } = req.body;

    const existing = await prisma.product.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ error: 'Producto no encontrado' });
      return;
    }

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
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// DELETE /api/products/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { id } = req.params;

    await prisma.product.deleteMany({ where: { id, userId } });
    res.json({ message: 'Producto eliminado' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

export default router;

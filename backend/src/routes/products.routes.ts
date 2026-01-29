import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from './auth.routes';

const router = Router();

// ==========================================
// GET / - Obtener todos los productos
// ==========================================
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { category, search, lowStock, limit = '50' } = req.query;
    
    const where: any = { userId: user.id, isActive: true };
    
    if (category) {
      where.category = category;
    }
    
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } }
      ];
    }
    
    if (lowStock === 'true') {
      where.stock = { lt: 10 };
    }
    
    const products = await prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string)
    });
    
    res.json({ products });
  } catch (error: any) {
    console.error('❌ Error obteniendo productos:', error);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// ==========================================
// GET /stats - Estadísticas de productos
// ==========================================
router.get('/stats', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    const [total, lowStock, categories] = await Promise.all([
      prisma.product.count({ where: { userId: user.id, isActive: true } }),
      prisma.product.count({ where: { userId: user.id, isActive: true, stock: { lt: 10 } } }),
      prisma.product.groupBy({
        by: ['category'],
        where: { userId: user.id, isActive: true },
        _count: { category: true }
      })
    ]);
    
    res.json({
      total,
      lowStock,
      categories: categories.filter(c => c.category).map(c => ({
        name: c.category,
        count: c._count.category
      }))
    });
  } catch (error: any) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// ==========================================
// GET /categories - Obtener categorías
// ==========================================
router.get('/categories', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    const categories = await prisma.product.groupBy({
      by: ['category'],
      where: { userId: user.id, isActive: true }
    });
    
    res.json({ 
      categories: categories
        .filter(c => c.category)
        .map(c => c.category)
    });
  } catch (error: any) {
    console.error('❌ Error obteniendo categorías:', error);
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
});

// ==========================================
// GET /:id - Obtener un producto
// ==========================================
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    
    const product = await prisma.product.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    res.json({ product });
  } catch (error: any) {
    console.error('❌ Error obteniendo producto:', error);
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

// ==========================================
// POST / - Crear producto
// ==========================================
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { name, description, price, stock, category, image } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }
    
    const product = await prisma.product.create({
      data: {
        userId: user.id,
        name,
        description: description || null,
        price: price || 0,
        stock: stock || 0,
        category: category || null,
        image: image || null,
        isActive: true
      }
    });
    
    res.json({ product });
  } catch (error: any) {
    console.error('❌ Error creando producto:', error);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// ==========================================
// PUT /:id - Actualizar producto
// ==========================================
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { name, description, price, stock, category, image, isActive } = req.body;
    
    const existing = await prisma.product.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    const product = await prisma.product.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existing.name,
        description: description !== undefined ? description : existing.description,
        price: price !== undefined ? price : existing.price,
        stock: stock !== undefined ? stock : existing.stock,
        category: category !== undefined ? category : existing.category,
        image: image !== undefined ? image : existing.image,
        isActive: isActive !== undefined ? isActive : existing.isActive
      }
    });
    
    res.json({ product });
  } catch (error: any) {
    console.error('❌ Error actualizando producto:', error);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// ==========================================
// PUT /:id/stock - Actualizar stock
// ==========================================
router.put('/:id/stock', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { quantity, operation } = req.body; // operation: 'add' | 'subtract' | 'set'
    
    const existing = await prisma.product.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    let newStock = existing.stock || 0;
    
    if (operation === 'add') {
      newStock += quantity;
    } else if (operation === 'subtract') {
      newStock = Math.max(0, newStock - quantity);
    } else {
      newStock = quantity;
    }
    
    const product = await prisma.product.update({
      where: { id },
      data: { stock: newStock }
    });
    
    res.json({ product });
  } catch (error: any) {
    console.error('❌ Error actualizando stock:', error);
    res.status(500).json({ error: 'Error al actualizar stock' });
  }
});

// ==========================================
// DELETE /:id - Eliminar producto
// ==========================================
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    
    const existing = await prisma.product.findFirst({
      where: { id, userId: user.id }
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    // Soft delete
    await prisma.product.update({
      where: { id },
      data: { isActive: false }
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error eliminando producto:', error);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

export default router;

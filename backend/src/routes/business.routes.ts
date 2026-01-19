import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key';

// Middleware de autenticación
const authenticate = async (req: Request, res: Response, next: Function) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    (req as any).userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// Listar negocios
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const businesses = await prisma.business.findMany({
      where: { userId: (req as any).userId },
      include: {
        products: true,
        faqs: { orderBy: { order: 'asc' } },
        _count: { select: { assistants: true } }
      }
    });
    res.json({ businesses });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener negocios' });
  }
});

// Obtener un negocio
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const business = await prisma.business.findFirst({
      where: { id: req.params.id, userId: (req as any).userId },
      include: { products: true, faqs: { orderBy: { order: 'asc' } } }
    });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json({ business });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener negocio' });
  }
});

// Crear negocio
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { name, industry, description, contactEmail, contactPhone, address, businessHours } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });

    const business = await prisma.business.create({
      data: {
        userId: (req as any).userId,
        name,
        industry,
        description,
        contactEmail,
        contactPhone,
        address,
        businessHours,
      }
    });
    res.status(201).json({ message: 'Negocio creado', business });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear negocio' });
  }
});

// Actualizar negocio
router.put('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { name, industry, description, contactEmail, contactPhone, address, businessHours } = req.body;
    const business = await prisma.business.updateMany({
      where: { id: req.params.id, userId: (req as any).userId },
      data: { name, industry, description, contactEmail, contactPhone, address, businessHours }
    });
    if (business.count === 0) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json({ message: 'Negocio actualizado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

// Eliminar negocio
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    await prisma.business.deleteMany({ where: { id: req.params.id, userId: (req as any).userId } });
    res.json({ message: 'Negocio eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// ========== PRODUCTOS ==========

router.get('/:id/products', authenticate, async (req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({ where: { businessId: req.params.id } });
    res.json({ products });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

router.post('/:id/products', authenticate, async (req: Request, res: Response) => {
  try {
    const { name, price, description, features } = req.body;
    const product = await prisma.product.create({
      data: { businessId: req.params.id, name, price, description, features }
    });
    res.status(201).json({ product });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

router.put('/:businessId/products/:productId', authenticate, async (req: Request, res: Response) => {
  try {
    const { name, price, description, features, isActive } = req.body;
    const product = await prisma.product.update({
      where: { id: req.params.productId },
      data: { name, price, description, features, isActive }
    });
    res.json({ product });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

router.delete('/:businessId/products/:productId', authenticate, async (req: Request, res: Response) => {
  try {
    await prisma.product.delete({ where: { id: req.params.productId } });
    res.json({ message: 'Producto eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// ========== FAQS ==========

router.get('/:id/faqs', authenticate, async (req: Request, res: Response) => {
  try {
    const faqs = await prisma.fAQ.findMany({
      where: { businessId: req.params.id },
      orderBy: { order: 'asc' }
    });
    res.json({ faqs });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener FAQs' });
  }
});

router.post('/:id/faqs', authenticate, async (req: Request, res: Response) => {
  try {
    const { question, answer, category } = req.body;
    const lastFaq = await prisma.fAQ.findFirst({
      where: { businessId: req.params.id },
      orderBy: { order: 'desc' }
    });
    const faq = await prisma.fAQ.create({
      data: {
        businessId: req.params.id,
        question,
        answer,
        category,
        order: (lastFaq?.order || 0) + 1
      }
    });
    res.status(201).json({ faq });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear FAQ' });
  }
});

router.put('/:businessId/faqs/:faqId', authenticate, async (req: Request, res: Response) => {
  try {
    const { question, answer, category } = req.body;
    const faq = await prisma.fAQ.update({
      where: { id: req.params.faqId },
      data: { question, answer, category }
    });
    res.json({ faq });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar FAQ' });
  }
});

router.delete('/:businessId/faqs/:faqId', authenticate, async (req: Request, res: Response) => {
  try {
    await prisma.fAQ.delete({ where: { id: req.params.faqId } });
    res.json({ message: 'FAQ eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar FAQ' });
  }
});

export default router;

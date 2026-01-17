import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Obtener negocios del usuario
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const businesses = await prisma.business.findMany({
      where: { userId: req.userId },
      include: {
        products: true,
        faqs: true,
        _count: {
          select: { assistants: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ businesses });
  } catch (error) {
    console.error('Error obteniendo negocios:', error);
    res.status(500).json({ error: 'Error al obtener negocios' });
  }
});

// Obtener un negocio específico
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const business = await prisma.business.findFirst({
      where: { 
        id,
        userId: req.userId 
      },
      include: {
        products: true,
        faqs: {
          orderBy: { order: 'asc' }
        },
        assistants: true,
      },
    });

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    res.json({ business });
  } catch (error) {
    console.error('Error obteniendo negocio:', error);
    res.status(500).json({ error: 'Error al obtener negocio' });
  }
});

// Crear negocio
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { name, industry, description, contactEmail, contactPhone, address } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'El nombre del negocio es requerido' });
    }

    const business = await prisma.business.create({
      data: {
        userId: req.userId!,
        name,
        industry,
        description,
        contactEmail,
        contactPhone,
        address,
      },
    });

    console.log(`✅ Negocio creado: ${business.name}`);

    res.status(201).json({ 
      message: 'Negocio creado exitosamente',
      business 
    });
  } catch (error) {
    console.error('Error creando negocio:', error);
    res.status(500).json({ error: 'Error al crear negocio' });
  }
});

// Actualizar negocio
router.put('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, industry, description, contactEmail, contactPhone, address, businessHours } = req.body;

    // Verificar que el negocio pertenece al usuario
    const existingBusiness = await prisma.business.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existingBusiness) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const business = await prisma.business.update({
      where: { id },
      data: {
        name,
        industry,
        description,
        contactEmail,
        contactPhone,
        address,
        businessHours,
      },
    });

    res.json({ 
      message: 'Negocio actualizado',
      business 
    });
  } catch (error) {
    console.error('Error actualizando negocio:', error);
    res.status(500).json({ error: 'Error al actualizar negocio' });
  }
});

// Eliminar negocio
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingBusiness = await prisma.business.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existingBusiness) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    await prisma.business.delete({
      where: { id },
    });

    res.json({ message: 'Negocio eliminado' });
  } catch (error) {
    console.error('Error eliminando negocio:', error);
    res.status(500).json({ error: 'Error al eliminar negocio' });
  }
});

// ============ PRODUCTOS ============

// Agregar producto a un negocio
router.post('/:id/products', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, price, description, features } = req.body;

    // Verificar que el negocio pertenece al usuario
    const business = await prisma.business.findFirst({
      where: { id, userId: req.userId },
    });

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const product = await prisma.product.create({
      data: {
        businessId: id,
        name,
        price: price ? parseFloat(price) : null,
        description,
        features,
      },
    });

    res.status(201).json({ 
      message: 'Producto agregado',
      product 
    });
  } catch (error) {
    console.error('Error agregando producto:', error);
    res.status(500).json({ error: 'Error al agregar producto' });
  }
});

// Obtener productos de un negocio
router.get('/:id/products', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const business = await prisma.business.findFirst({
      where: { id, userId: req.userId },
    });

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const products = await prisma.product.findMany({
      where: { businessId: id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ products });
  } catch (error) {
    console.error('Error obteniendo productos:', error);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// Actualizar producto
router.put('/:businessId/products/:productId', authenticate, async (req: Request, res: Response) => {
  try {
    const { businessId, productId } = req.params;
    const { name, price, description, features, isActive } = req.body;

    const business = await prisma.business.findFirst({
      where: { id: businessId, userId: req.userId },
    });

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data: {
        name,
        price: price ? parseFloat(price) : null,
        description,
        features,
        isActive,
      },
    });

    res.json({ message: 'Producto actualizado', product });
  } catch (error) {
    console.error('Error actualizando producto:', error);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// Eliminar producto
router.delete('/:businessId/products/:productId', authenticate, async (req: Request, res: Response) => {
  try {
    const { businessId, productId } = req.params;

    const business = await prisma.business.findFirst({
      where: { id: businessId, userId: req.userId },
    });

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    await prisma.product.delete({
      where: { id: productId },
    });

    res.json({ message: 'Producto eliminado' });
  } catch (error) {
    console.error('Error eliminando producto:', error);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// ============ FAQs ============

// Agregar FAQ a un negocio
router.post('/:id/faqs', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { question, answer, category } = req.body;

    const business = await prisma.business.findFirst({
      where: { id, userId: req.userId },
    });

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Obtener el orden máximo actual
    const maxOrder = await prisma.fAQ.findFirst({
      where: { businessId: id },
      orderBy: { order: 'desc' },
    });

    const faq = await prisma.fAQ.create({
      data: {
        businessId: id,
        question,
        answer,
        category,
        order: (maxOrder?.order || 0) + 1,
      },
    });

    res.status(201).json({ 
      message: 'FAQ agregada',
      faq 
    });
  } catch (error) {
    console.error('Error agregando FAQ:', error);
    res.status(500).json({ error: 'Error al agregar FAQ' });
  }
});

// Obtener FAQs de un negocio
router.get('/:id/faqs', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const business = await prisma.business.findFirst({
      where: { id, userId: req.userId },
    });

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const faqs = await prisma.fAQ.findMany({
      where: { businessId: id },
      orderBy: { order: 'asc' },
    });

    res.json({ faqs });
  } catch (error) {
    console.error('Error obteniendo FAQs:', error);
    res.status(500).json({ error: 'Error al obtener FAQs' });
  }
});

// Actualizar FAQ
router.put('/:businessId/faqs/:faqId', authenticate, async (req: Request, res: Response) => {
  try {
    const { businessId, faqId } = req.params;
    const { question, answer, category, order } = req.body;

    const business = await prisma.business.findFirst({
      where: { id: businessId, userId: req.userId },
    });

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const faq = await prisma.fAQ.update({
      where: { id: faqId },
      data: {
        question,
        answer,
        category,
        order,
      },
    });

    res.json({ message: 'FAQ actualizada', faq });
  } catch (error) {
    console.error('Error actualizando FAQ:', error);
    res.status(500).json({ error: 'Error al actualizar FAQ' });
  }
});

// Eliminar FAQ
router.delete('/:businessId/faqs/:faqId', authenticate, async (req: Request, res: Response) => {
  try {
    const { businessId, faqId } = req.params;

    const business = await prisma.business.findFirst({
      where: { id: businessId, userId: req.userId },
    });

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    await prisma.fAQ.delete({
      where: { id: faqId },
    });

    res.json({ message: 'FAQ eliminada' });
  } catch (error) {
    console.error('Error eliminando FAQ:', error);
    res.status(500).json({ error: 'Error al eliminar FAQ' });
  }
});

export default router;

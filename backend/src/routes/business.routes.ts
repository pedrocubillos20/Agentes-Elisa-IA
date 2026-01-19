import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Obtener información del negocio
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    
    const business = await prisma.business.findUnique({
      where: { userId },
      include: { 
        products: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' }
        }, 
        faqs: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });
    
    res.json(business);
  } catch (error: any) {
    console.error('Error obteniendo negocio:', error);
    res.status(500).json({ error: 'Error al obtener información del negocio' });
  }
});

// Crear o actualizar negocio
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { name, description, address, phone, email, website, hours } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'El nombre del negocio es requerido' });
    }
    
    const existing = await prisma.business.findUnique({ where: { userId } });
    
    let business;
    if (existing) {
      business = await prisma.business.update({
        where: { id: existing.id },
        data: { name, description, address, phone, email, website, hours }
      });
      console.log(`✅ Negocio actualizado: ${business.name}`);
    } else {
      business = await prisma.business.create({
        data: { userId, name, description, address, phone, email, website, hours }
      });
      console.log(`✅ Negocio creado: ${business.name}`);
    }
    
    res.json(business);
  } catch (error: any) {
    console.error('Error guardando negocio:', error);
    res.status(500).json({ error: 'Error al guardar información del negocio' });
  }
});

// Actualizar negocio
router.put('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { name, description, address, phone, email, website, hours } = req.body;
    
    const existing = await prisma.business.findUnique({ where: { userId } });
    
    if (!existing) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    
    const business = await prisma.business.update({
      where: { id: existing.id },
      data: { name, description, address, phone, email, website, hours }
    });
    
    res.json(business);
  } catch (error: any) {
    console.error('Error actualizando negocio:', error);
    res.status(500).json({ error: 'Error al actualizar información del negocio' });
  }
});

// ==================== PRODUCTOS ====================

// Obtener todos los productos
router.get('/products', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    
    const business = await prisma.business.findUnique({ where: { userId } });
    
    if (!business) {
      return res.json([]);
    }
    
    const products = await prisma.product.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(products);
  } catch (error: any) {
    console.error('Error obteniendo productos:', error);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// Crear producto
router.post('/products', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { name, description, price, category, imageUrl } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'El nombre del producto es requerido' });
    }
    
    // Obtener o crear negocio
    let business = await prisma.business.findUnique({ where: { userId } });
    
    if (!business) {
      business = await prisma.business.create({
        data: { userId, name: 'Mi Negocio' }
      });
    }
    
    const product = await prisma.product.create({
      data: { 
        businessId: business.id, 
        name: name.trim(), 
        description, 
        price: price ? parseFloat(price) : null, 
        category,
        imageUrl,
        isActive: true
      }
    });
    
    console.log(`✅ Producto creado: ${product.name}`);
    
    res.status(201).json(product);
  } catch (error: any) {
    console.error('Error creando producto:', error);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// Actualizar producto
router.put('/products/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { name, description, price, category, imageUrl, isActive } = req.body;
    
    const business = await prisma.business.findUnique({ where: { userId } });
    
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    
    const product = await prisma.product.findFirst({
      where: { id, businessId: business.id }
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    const updated = await prisma.product.update({
      where: { id },
      data: { 
        name, 
        description, 
        price: price ? parseFloat(price) : null, 
        category,
        imageUrl,
        isActive
      }
    });
    
    res.json(updated);
  } catch (error: any) {
    console.error('Error actualizando producto:', error);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// Eliminar producto
router.delete('/products/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    
    const business = await prisma.business.findUnique({ where: { userId } });
    
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    
    const product = await prisma.product.findFirst({
      where: { id, businessId: business.id }
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    await prisma.product.delete({ where: { id } });
    
    console.log(`✅ Producto eliminado: ${product.name}`);
    
    res.json({ message: 'Producto eliminado correctamente' });
  } catch (error: any) {
    console.error('Error eliminando producto:', error);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// ==================== FAQs ====================

// Obtener todas las FAQs
router.get('/faqs', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    
    const business = await prisma.business.findUnique({ where: { userId } });
    
    if (!business) {
      return res.json([]);
    }
    
    const faqs = await prisma.fAQ.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(faqs);
  } catch (error: any) {
    console.error('Error obteniendo FAQs:', error);
    res.status(500).json({ error: 'Error al obtener FAQs' });
  }
});

// Crear FAQ
router.post('/faqs', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { question, answer } = req.body;
    
    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: 'La pregunta es requerida' });
    }
    
    if (!answer || answer.trim().length === 0) {
      return res.status(400).json({ error: 'La respuesta es requerida' });
    }
    
    // Obtener o crear negocio
    let business = await prisma.business.findUnique({ where: { userId } });
    
    if (!business) {
      business = await prisma.business.create({
        data: { userId, name: 'Mi Negocio' }
      });
    }
    
    const faq = await prisma.fAQ.create({
      data: { 
        businessId: business.id, 
        question: question.trim(), 
        answer: answer.trim() 
      }
    });
    
    console.log(`✅ FAQ creada`);
    
    res.status(201).json(faq);
  } catch (error: any) {
    console.error('Error creando FAQ:', error);
    res.status(500).json({ error: 'Error al crear FAQ' });
  }
});

// Actualizar FAQ
router.put('/faqs/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { question, answer } = req.body;
    
    const business = await prisma.business.findUnique({ where: { userId } });
    
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    
    const faq = await prisma.fAQ.findFirst({
      where: { id, businessId: business.id }
    });
    
    if (!faq) {
      return res.status(404).json({ error: 'FAQ no encontrada' });
    }
    
    const updated = await prisma.fAQ.update({
      where: { id },
      data: { question, answer }
    });
    
    res.json(updated);
  } catch (error: any) {
    console.error('Error actualizando FAQ:', error);
    res.status(500).json({ error: 'Error al actualizar FAQ' });
  }
});

// Eliminar FAQ
router.delete('/faqs/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    
    const business = await prisma.business.findUnique({ where: { userId } });
    
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    
    const faq = await prisma.fAQ.findFirst({
      where: { id, businessId: business.id }
    });
    
    if (!faq) {
      return res.status(404).json({ error: 'FAQ no encontrada' });
    }
    
    await prisma.fAQ.delete({ where: { id } });
    
    console.log(`✅ FAQ eliminada`);
    
    res.json({ message: 'FAQ eliminada correctamente' });
  } catch (error: any) {
    console.error('Error eliminando FAQ:', error);
    res.status(500).json({ error: 'Error al eliminar FAQ' });
  }
});

export default router;

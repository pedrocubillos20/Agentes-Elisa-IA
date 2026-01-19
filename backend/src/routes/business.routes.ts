import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key';

const authenticate = async (req: Request, res: Response, next: Function) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token no proporcionado' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    (req as any).userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token inválido' });
  }
};

router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const business = await prisma.business.findFirst({ where: { userId }, include: { products: true, faqs: true } });
    res.json(business);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const data = req.body;
    const existing = await prisma.business.findFirst({ where: { userId } });
    let business;
    if (existing) business = await prisma.business.update({ where: { id: existing.id }, data });
    else business = await prisma.business.create({ data: { ...data, userId } });
    res.json(business);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/products', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { name, description, price, category } = req.body;
    let business = await prisma.business.findFirst({ where: { userId } });
    if (!business) business = await prisma.business.create({ data: { userId, name: 'Mi Negocio' } });
    const product = await prisma.product.create({ data: { businessId: business.id, name, description, price, category } });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.delete('/products/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.product.delete({ where: { id } });
    res.json({ message: 'Eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/faqs', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { question, answer } = req.body;
    let business = await prisma.business.findFirst({ where: { userId } });
    if (!business) business = await prisma.business.create({ data: { userId, name: 'Mi Negocio' } });
    const faq = await prisma.fAQ.create({ data: { businessId: business.id, question, answer } });
    res.json(faq);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.delete('/faqs/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.fAQ.delete({ where: { id } });
    res.json({ message: 'Eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

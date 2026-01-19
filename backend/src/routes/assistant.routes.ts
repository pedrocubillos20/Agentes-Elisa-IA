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

const PLAN_LIMITS: Record<string, number> = { FREE: 1, EMPRENDEDORES: 1, NEGOCIOS: 3, BUSINESS: 5, MARCA_BLANCA: 999 };

router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const assistants = await prisma.assistant.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    res.json(assistants);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.get('/plan-info', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { assistants: true } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    const plan = user.plan || 'FREE';
    const maxAssistants = PLAN_LIMITS[plan] || 1;
    
    res.json({
      plan, currentAssistants: user.assistants.length, maxAssistants,
      canCreate: user.assistants.length < maxAssistants, hasApiKey: !!user.openaiApiKey,
      whatsappConnected: user.whatsappConnected, whatsappPhone: user.whatsappPhone, trialEndsAt: user.trialEndsAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { name, description, tone } = req.body;
    
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { assistants: true } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    const plan = user.plan || 'FREE';
    const maxAssistants = PLAN_LIMITS[plan] || 1;
    if (user.assistants.length >= maxAssistants) return res.status(400).json({ error: `Plan ${plan} permite máximo ${maxAssistants} chatbot(s)` });
    
    await prisma.assistant.updateMany({ where: { userId }, data: { isActive: false } });
    
    const assistant = await prisma.assistant.create({
      data: { userId, name: name || 'Mi Asistente', description, tone: tone || 'FRIENDLY', isActive: true }
    });
    res.json(assistant);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.put('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    const { name, description, tone, contextJson, isActive } = req.body;
    
    const assistant = await prisma.assistant.findFirst({ where: { id, userId } });
    if (!assistant) return res.status(404).json({ error: 'No encontrado' });
    
    if (isActive) await prisma.assistant.updateMany({ where: { userId, id: { not: id } }, data: { isActive: false } });
    
    const updated = await prisma.assistant.update({ where: { id }, data: { name, description, tone, contextJson, isActive } });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    const assistant = await prisma.assistant.findFirst({ where: { id, userId } });
    if (!assistant) return res.status(404).json({ error: 'No encontrado' });
    await prisma.assistant.delete({ where: { id } });
    res.json({ message: 'Eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/:id/context', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    const { contextJson } = req.body;
    
    const assistant = await prisma.assistant.findFirst({ where: { id, userId } });
    if (!assistant) return res.status(404).json({ error: 'No encontrado' });
    
    if (contextJson) { try { JSON.parse(contextJson); } catch (e) { return res.status(400).json({ error: 'JSON inválido' }); } }
    
    const updated = await prisma.assistant.update({ where: { id }, data: { contextJson } });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/:id/activate', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    await prisma.assistant.updateMany({ where: { userId }, data: { isActive: false } });
    const updated = await prisma.assistant.update({ where: { id }, data: { isActive: true } });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

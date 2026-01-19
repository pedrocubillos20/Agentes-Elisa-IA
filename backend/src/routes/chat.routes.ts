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

router.get('/conversations', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const conversations = await prisma.conversation.findMany({
      where: { assistant: { userId } },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 }, assistant: { select: { name: true } } }
    });
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.get('/conversations/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } }, assistant: { select: { name: true } } }
    });
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

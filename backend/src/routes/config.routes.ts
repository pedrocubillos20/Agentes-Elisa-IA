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

router.get('/requests', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const requests = await prisma.configRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { assistant: { select: { name: true } } }
    });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/requests', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { assistantId, notes } = req.body;
    const request = await prisma.configRequest.create({
      data: { userId, assistantId, notes, status: 'PENDING' }
    });
    res.json(request);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

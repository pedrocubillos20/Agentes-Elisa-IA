import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key';

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

router.get('/plans', (req: Request, res: Response) => {
  res.json([
    { id: 'FREE', name: 'Gratis', price: 0, chatbots: 1, features: ['1 chatbot', '7 días prueba'] },
    { id: 'EMPRENDEDORES', name: 'Emprendedores', price: 99000, chatbots: 1, features: ['1 chatbot', 'Soporte', 'Configuración incluida'] },
    { id: 'NEGOCIOS', name: 'Negocios', price: 199000, chatbots: 3, features: ['3 chatbots', 'Soporte prioritario'] },
    { id: 'BUSINESS', name: 'Business', price: 499000, chatbots: 5, features: ['5 chatbots', 'Pago único', 'Editor JSON'] },
    { id: 'MARCA_BLANCA', name: 'Marca Blanca', price: 999000, chatbots: 999, features: ['Ilimitados', 'Reventa', 'Personalización'] },
  ]);
});

router.post('/upgrade', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { plan } = req.body;
    
    await prisma.user.update({
      where: { id: userId },
      data: { plan }
    });
    
    res.json({ message: 'Plan actualizado' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.get('/referral-stats', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true }
    });
    
    res.json({
      referralCode: user?.referralCode || null,
      totalReferrals: 0,
      activeReferrals: 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

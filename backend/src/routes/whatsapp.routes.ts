import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import jwt from 'jsonwebtoken';
import whatsappService from '../services/whatsappService';

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

router.post('/generate-qr', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const status = whatsappService.getSessionStatus(userId);
    if (status.connected) return res.json({ connected: true, phoneNumber: status.phoneNumber });

    const qrString = await whatsappService.initializeClient(userId);
    if (!qrString) {
      const newStatus = whatsappService.getSessionStatus(userId);
      if (newStatus.connected) return res.json({ connected: true, phoneNumber: newStatus.phoneNumber });
      return res.status(500).json({ error: 'No se pudo generar QR' });
    }
    res.json({ qrCode: qrString, connected: false });
  } catch (error) {
    res.status(500).json({ error: 'Error al generar QR' });
  }
});

router.get('/status', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const status = whatsappService.getSessionStatus(userId);
    if (status.connected) return res.json({ connected: true, phoneNumber: status.phoneNumber });
    
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { whatsappConnected: true, whatsappPhone: true } });
    if (user?.whatsappConnected && !status.connected) {
      await prisma.user.update({ where: { id: userId }, data: { whatsappConnected: false, whatsappPhone: null } });
    }
    res.json({ connected: false, qrCode: status.qrCode });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/disconnect', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    await whatsappService.disconnectSession(userId);
    res.json({ message: 'Desconectado' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/send', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'Faltan datos' });
    const success = await whatsappService.sendMessagePublic(userId, to, message);
    if (success) res.json({ message: 'Enviado' });
    else res.status(400).json({ error: 'No se pudo enviar' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/webhook', async (req: Request, res: Response) => { res.json({ received: true }); });
router.get('/webhook', (req: Request, res: Response) => {
  const challenge = req.query['hub.challenge'];
  if (challenge) res.send(challenge); else res.sendStatus(403);
});

export default router;

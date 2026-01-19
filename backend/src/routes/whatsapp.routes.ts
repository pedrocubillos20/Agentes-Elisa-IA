import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key';

// Almacén temporal de sesiones WhatsApp (en producción usar Redis)
const whatsappSessions: Map<string, { qrCode: string; connected: boolean; phoneNumber?: string; createdAt: Date }> = new Map();

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

// Generar código QR para WhatsApp
router.post('/generate-qr', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    // Generar un token único para la sesión
    const sessionToken = `wa_${userId}_${Date.now()}`;
    
    // En producción, aquí se integraría con la API de WhatsApp Business
    // Por ahora, generamos un QR de ejemplo que representa el token de sesión
    const qrData = JSON.stringify({
      type: 'elisa-ia-whatsapp',
      userId,
      sessionToken,
      timestamp: Date.now()
    });
    
    // Generar imagen QR en base64
    const qrCodeImage = await QRCode.toDataURL(qrData, {
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    
    // Guardar sesión temporal
    whatsappSessions.set(userId, {
      qrCode: qrCodeImage,
      connected: false,
      createdAt: new Date()
    });
    
    // Simular conexión después de 10 segundos (para demo)
    // En producción, esto se manejaría con webhooks de WhatsApp
    setTimeout(async () => {
      const session = whatsappSessions.get(userId);
      if (session && !session.connected) {
        session.connected = true;
        session.phoneNumber = '+57 300 *** **' + Math.floor(Math.random() * 100).toString().padStart(2, '0');
        
        // Actualizar en base de datos
        await prisma.user.update({
          where: { id: userId },
          data: {
            whatsappConnected: true,
            whatsappPhone: session.phoneNumber
          }
        });
      }
    }, 15000); // 15 segundos para demo
    
    console.log(`📱 QR generado para usuario ${userId}`);
    res.json({ qrCode: qrCodeImage, sessionToken });
  } catch (error) {
    console.error('Error generando QR:', error);
    res.status(500).json({ error: 'Error al generar código QR' });
  }
});

// Verificar estado de conexión WhatsApp
router.get('/status', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    // Primero verificar en base de datos
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { whatsappConnected: true, whatsappPhone: true }
    });
    
    if (user?.whatsappConnected) {
      return res.json({
        connected: true,
        phoneNumber: user.whatsappPhone
      });
    }
    
    // Verificar sesión temporal
    const session = whatsappSessions.get(userId);
    if (session?.connected) {
      return res.json({
        connected: true,
        phoneNumber: session.phoneNumber
      });
    }
    
    res.json({ connected: false });
  } catch (error) {
    console.error('Error verificando estado:', error);
    res.status(500).json({ error: 'Error al verificar estado' });
  }
});

// Desconectar WhatsApp
router.post('/disconnect', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    // Eliminar sesión temporal
    whatsappSessions.delete(userId);
    
    // Actualizar en base de datos
    await prisma.user.update({
      where: { id: userId },
      data: {
        whatsappConnected: false,
        whatsappPhone: null
      }
    });
    
    console.log(`📴 WhatsApp desconectado para usuario ${userId}`);
    res.json({ message: 'WhatsApp desconectado' });
  } catch (error) {
    console.error('Error desconectando:', error);
    res.status(500).json({ error: 'Error al desconectar' });
  }
});

// Webhook para recibir mensajes de WhatsApp (para integración futura)
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    console.log('📨 Webhook WhatsApp:', req.body);
    // Aquí se procesarían los mensajes entrantes
    res.json({ received: true });
  } catch (error) {
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

export default router;

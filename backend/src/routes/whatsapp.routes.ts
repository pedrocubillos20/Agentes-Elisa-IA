import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import whatsappService from '../services/whatsappService';

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

// Generar código QR para WhatsApp
router.post('/generate-qr', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    console.log(`📱 Iniciando conexión WhatsApp para usuario ${userId}`);
    
    // Verificar si ya está conectado
    const status = whatsappService.getSessionStatus(userId);
    if (status.connected) {
      return res.json({ 
        connected: true, 
        phoneNumber: status.phoneNumber,
        message: 'Ya estás conectado a WhatsApp' 
      });
    }

    // Inicializar cliente y obtener QR
    const qrString = await whatsappService.initializeClient(userId);
    
    if (!qrString) {
      // Si no hay QR, verificar estado nuevamente
      const newStatus = whatsappService.getSessionStatus(userId);
      if (newStatus.connected) {
        return res.json({ 
          connected: true, 
          phoneNumber: newStatus.phoneNumber 
        });
      }
      return res.status(500).json({ error: 'No se pudo generar el código QR. Intenta de nuevo.' });
    }

    // Convertir QR string a imagen base64
    const qrCodeImage = await QRCode.toDataURL(qrString, {
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    console.log(`✅ QR generado para usuario ${userId}`);
    res.json({ qrCode: qrCodeImage, connected: false });
    
  } catch (error) {
    console.error('Error generando QR:', error);
    res.status(500).json({ error: 'Error al generar código QR. Intenta de nuevo.' });
  }
});

// Verificar estado de conexión WhatsApp
router.get('/status', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    // Verificar en el servicio de WhatsApp
    const status = whatsappService.getSessionStatus(userId);
    
    if (status.connected) {
      return res.json({
        connected: true,
        phoneNumber: status.phoneNumber
      });
    }
    
    // Si no está en el servicio, verificar en base de datos
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { whatsappConnected: true, whatsappPhone: true }
    });
    
    // Si la BD dice conectado pero el servicio no, sincronizar
    if (user?.whatsappConnected && !status.connected) {
      await prisma.user.update({
        where: { id: userId },
        data: { whatsappConnected: false, whatsappPhone: null }
      });
    }
    
    res.json({ 
      connected: false,
      qrCode: status.qrCode ? await QRCode.toDataURL(status.qrCode) : null
    });
    
  } catch (error) {
    console.error('Error verificando estado:', error);
    res.status(500).json({ error: 'Error al verificar estado' });
  }
});

// Desconectar WhatsApp
router.post('/disconnect', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    await whatsappService.disconnectSession(userId);
    
    console.log(`📴 WhatsApp desconectado para usuario ${userId}`);
    res.json({ message: 'WhatsApp desconectado exitosamente' });
    
  } catch (error) {
    console.error('Error desconectando:', error);
    res.status(500).json({ error: 'Error al desconectar' });
  }
});

// Enviar mensaje (para pruebas)
router.post('/send', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: 'Número de destino y mensaje requeridos' });
    }

    const success = await whatsappService.sendMessage(userId, to, message);
    
    if (success) {
      res.json({ message: 'Mensaje enviado' });
    } else {
      res.status(400).json({ error: 'No se pudo enviar el mensaje. Verifica que WhatsApp esté conectado.' });
    }
    
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

// Webhook para recibir mensajes de WhatsApp (para integración con API oficial)
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    console.log('📨 Webhook WhatsApp:', req.body);
    res.json({ received: true });
  } catch (error) {
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

// Verificación de webhook (requerido por WhatsApp Business API)
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'elisa-ia-verify';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ Webhook verificado');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

export default router;

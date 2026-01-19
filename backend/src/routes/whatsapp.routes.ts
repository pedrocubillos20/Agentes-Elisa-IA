import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import whatsappService from '../services/whatsappService';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Generar código QR
router.post('/generate-qr', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    
    console.log(`📱 Solicitando QR para ${userId}`);
    
    // Verificar estado actual
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
      const newStatus = whatsappService.getSessionStatus(userId);
      if (newStatus.connected) {
        return res.json({ 
          connected: true, 
          phoneNumber: newStatus.phoneNumber,
          message: 'Conectado exitosamente' 
        });
      }
      return res.status(500).json({ error: 'No se pudo generar el código QR. Intenta de nuevo.' });
    }

    res.json({ 
      qrCode: qrString, 
      connected: false,
      message: 'Escanea el código QR con WhatsApp' 
    });
  } catch (error: any) {
    console.error('Error generando QR:', error);
    res.status(500).json({ error: 'Error al generar código QR' });
  }
});

// Obtener estado de conexión
router.get('/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    
    const status = whatsappService.getSessionStatus(userId);
    
    if (status.connected) {
      return res.json({ 
        connected: true, 
        phoneNumber: status.phoneNumber,
        ready: status.ready
      });
    }
    
    // Verificar en BD y sincronizar
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { whatsappConnected: true, whatsappPhone: true }
    });
    
    // Si la BD dice conectado pero el servicio no, actualizar BD
    if (user?.whatsappConnected && !status.connected) {
      await prisma.user.update({
        where: { id: userId },
        data: { whatsappConnected: false, whatsappPhone: null }
      });
    }
    
    res.json({ 
      connected: false, 
      qrCode: status.qrCode,
      phoneNumber: null 
    });
  } catch (error: any) {
    console.error('Error obteniendo estado:', error);
    res.status(500).json({ error: 'Error al obtener estado' });
  }
});

// Desconectar WhatsApp
router.post('/disconnect', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    
    console.log(`🔌 Desconectando WhatsApp para ${userId}`);
    
    await whatsappService.disconnectSession(userId);
    
    res.json({ 
      message: 'WhatsApp desconectado correctamente',
      connected: false 
    });
  } catch (error: any) {
    console.error('Error desconectando:', error);
    res.status(500).json({ error: 'Error al desconectar' });
  }
});

// Enviar mensaje manual
router.post('/send', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { to, message } = req.body;
    
    if (!to || !message) {
      return res.status(400).json({ error: 'Número de destino y mensaje son requeridos' });
    }
    
    const success = await whatsappService.sendMessagePublic(userId, to, message);
    
    if (success) {
      res.json({ message: 'Mensaje enviado correctamente' });
    } else {
      res.status(400).json({ error: 'No se pudo enviar el mensaje. Verifica que estés conectado.' });
    }
  } catch (error: any) {
    console.error('Error enviando mensaje:', error);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

// Webhook (para futuras integraciones)
router.post('/webhook', async (req, res) => {
  console.log('📥 Webhook recibido:', req.body);
  res.json({ received: true });
});

router.get('/webhook', (req, res) => {
  const challenge = req.query['hub.challenge'];
  if (challenge) {
    res.send(challenge);
  } else {
    res.sendStatus(200);
  }
});

export default router;

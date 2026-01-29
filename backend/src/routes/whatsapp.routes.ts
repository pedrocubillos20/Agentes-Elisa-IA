import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// URL del servicio de WhatsApp en tu VPS
const WHATSAPP_SERVICE_URL = process.env.WHATSAPP_SERVICE_URL || 'http://31.97.142.127:8080';

// ==========================================
// GET /api/whatsapp/status - Estado de conexión
// ==========================================
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;

    if (!userId) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }

    const response = await fetch(`${WHATSAPP_SERVICE_URL}/status/${userId}`);
    const data = await response.json() as any;

    res.json(data);
  } catch (error) {
    console.error('Error obteniendo estado:', error);
    res.json({ connected: false, status: 'error', phone: null, hasQR: false });
  }
});

// ==========================================
// POST /api/whatsapp/connect - Iniciar conexión
// ==========================================
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;

    if (!userId) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }

    console.log(`🔌 Usuario ${userId} solicitando conexión WhatsApp`);

    const response = await fetch(`${WHATSAPP_SERVICE_URL}/connect/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json() as any;

    res.json(data);
  } catch (error: any) {
    console.error('Error conectando:', error);
    res.status(500).json({ success: false, message: error.message || 'Error al conectar' });
  }
});

// ==========================================
// GET /api/whatsapp/qr - Obtener código QR
// ==========================================
router.get('/qr', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;

    if (!userId) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }

    const response = await fetch(`${WHATSAPP_SERVICE_URL}/qr/${userId}`);
    const data = await response.json() as any;

    res.json(data);
  } catch (error) {
    console.error('Error obteniendo QR:', error);
    res.status(500).json({ error: 'Error al obtener QR', qr: null, available: false });
  }
});

// ==========================================
// POST /api/whatsapp/disconnect - Desconectar
// ==========================================
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;

    if (!userId) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }

    const response = await fetch(`${WHATSAPP_SERVICE_URL}/disconnect/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json() as any;

    res.json(data);
  } catch (error: any) {
    console.error('Error desconectando:', error);
    res.status(500).json({ success: false, message: error.message || 'Error al desconectar' });
  }
});

// ==========================================
// POST /api/whatsapp/send - Enviar mensaje
// ==========================================
router.post('/send', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { to, message } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }

    if (!to || !message) {
      res.status(400).json({ error: 'Destinatario y mensaje son requeridos' });
      return;
    }

    const response = await fetch(`${WHATSAPP_SERVICE_URL}/send/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, message })
    });
    const result = await response.json() as any;

    if (result.success) {
      // Guardar en base de datos
      const recipientId = to.replace(/\D/g, '');
      
      let conversation = await prisma.conversation.findFirst({
        where: { userId, recipientId }
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            userId,
            recipientId,
            lastMessage: message,
            stage: 'new'
          }
        });
      }

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          content: message,
          fromMe: true
        }
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessage: message }
      });
    }

    res.json(result);
  } catch (error: any) {
    console.error('Error enviando mensaje:', error);
    res.status(500).json({ success: false, message: error.message || 'Error al enviar' });
  }
});

// ==========================================
// POST /api/whatsapp/webhook - Recibir mensajes del VPS
// ==========================================
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const { userId, from, body, notifyName } = req.body;

    if (!userId || !from || !body) {
      res.status(400).json({ error: 'Datos incompletos' });
      return;
    }

    const recipientId = from.replace('@c.us', '');
    const senderName = notifyName || recipientId;

    // Buscar o crear conversación
    let conversation = await prisma.conversation.findFirst({
      where: { userId, recipientId }
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          userId,
          recipientId,
          recipientName: senderName,
          lastMessage: body,
          stage: 'new'
        }
      });
    }

    // Guardar mensaje
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        content: body,
        fromMe: false
      }
    });

    // Actualizar conversación
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { 
        lastMessage: body,
        recipientName: senderName
      }
    });

    console.log(`💾 Mensaje recibido de ${senderName} para usuario ${userId}`);

    res.json({ success: true });
  } catch (error) {
    console.error('Error procesando webhook:', error);
    res.status(500).json({ error: 'Error procesando mensaje' });
  }
});

export default router;

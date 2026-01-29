import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();
const WAHA_API = process.env.WAHA_API_URL || 'http://31.97.142.127:8080';

// GET /api/whatsapp/status
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const sessionName = `session_${userId}`;

    const response = await fetch(`${WAHA_API}/api/sessions/${sessionName}`);

    if (response.ok) {
      const data = await response.json();
      res.json({
        connected: data.status === 'WORKING',
        status: data.status,
        session: sessionName
      });
    } else {
      res.json({ connected: false, status: 'DISCONNECTED' });
    }
  } catch (error) {
    console.error('Error:', error);
    res.json({ connected: false, status: 'ERROR' });
  }
});

// POST /api/whatsapp/connect
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const sessionName = `session_${userId}`;

    const response = await fetch(`${WAHA_API}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: sessionName,
        config: {
          webhooks: [{
            url: `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/whatsapp/webhook`,
            events: ['message']
          }]
        }
      })
    });

    if (response.ok || response.status === 409) {
      const qrResponse = await fetch(`${WAHA_API}/api/sessions/${sessionName}/auth/qr`);
      if (qrResponse.ok) {
        const qrData = await qrResponse.json();
        res.json({ qr: qrData.value, session: sessionName });
      } else {
        res.json({ message: 'Sesión creada, esperando QR', session: sessionName });
      }
    } else {
      res.status(400).json({ error: 'Error al crear sesión' });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al conectar' });
  }
});

// GET /api/whatsapp/qr
router.get('/qr', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const sessionName = `session_${userId}`;

    const response = await fetch(`${WAHA_API}/api/sessions/${sessionName}/auth/qr`);

    if (response.ok) {
      const data = await response.json();
      res.json({ qr: data.value });
    } else {
      res.status(400).json({ error: 'QR no disponible' });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener QR' });
  }
});

// POST /api/whatsapp/disconnect
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const sessionName = `session_${userId}`;

    await fetch(`${WAHA_API}/api/sessions/${sessionName}`, { method: 'DELETE' });
    res.json({ message: 'Sesión desconectada' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al desconectar' });
  }
});

// POST /api/whatsapp/send
router.post('/send', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { to, message } = req.body;
    const sessionName = `session_${userId}`;

    if (!to || !message) {
      res.status(400).json({ error: 'Destinatario y mensaje son requeridos' });
      return;
    }

    const chatId = to.includes('@') ? to : `${to}@c.us`;

    const response = await fetch(`${WAHA_API}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionName, chatId, text: message })
    });

    if (response.ok) {
      let conversation = await prisma.conversation.findFirst({
        where: { userId, recipientId: chatId.replace('@c.us', '') }
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            userId: userId!,
            recipientId: chatId.replace('@c.us', ''),
            lastMessage: message
          }
        });
      }

      await prisma.message.create({
        data: { conversationId: conversation.id, content: message, fromMe: true }
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessage: message }
      });

      res.json({ success: true, message: 'Mensaje enviado' });
    } else {
      res.status(400).json({ error: 'Error al enviar mensaje' });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

// POST /api/whatsapp/webhook (público)
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const { event, payload, session } = req.body;

    if (event === 'message' && payload && !payload.fromMe) {
      const userId = session?.replace('session_', '');
      
      if (userId) {
        const chatId = payload.from?.replace('@c.us', '') || payload.chatId?.replace('@c.us', '');
        const messageContent = payload.body || payload.text || '';
        const senderName = payload.notifyName || payload.pushName || chatId;

        let conversation = await prisma.conversation.findFirst({
          where: { userId, recipientId: chatId }
        });

        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: {
              userId,
              recipientId: chatId,
              recipientName: senderName,
              lastMessage: messageContent,
              stage: 'new'
            }
          });
        }

        await prisma.message.create({
          data: { conversationId: conversation.id, content: messageContent, fromMe: false }
        });

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessage: messageContent, recipientName: senderName }
        });
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error webhook:', error);
    res.json({ received: true });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// ==========================================
// CONFIGURACIÓN WAHA
// ==========================================
const WAHA_API_URL = process.env.WAHA_API_URL || 'http://31.97.142.127:8080';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';

const getWahaHeaders = () => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;
  return headers;
};

const getSessionName = (userId: string) => `user_${userId}`;

// ==========================================
// GET /api/whatsapp/status
// ==========================================
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const sessionName = getSessionName(userId);

    try {
      const response = await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}`, {
        headers: getWahaHeaders()
      });

      if (response.status === 404) {
        res.json({ connected: false, status: 'disconnected', phone: null, hasQR: false });
        return;
      }

      const data = await response.json() as any;
      const isConnected = data.status === 'WORKING' || data.status === 'CONNECTED';
      const hasQR = data.status === 'SCAN_QR_CODE' || data.status === 'STARTING';

      res.json({
        connected: isConnected,
        status: data.status?.toLowerCase() || 'disconnected',
        phone: data.me?.id?.replace('@c.us', '') || null,
        name: data.me?.pushName || null,
        hasQR: hasQR
      });
    } catch (fetchError) {
      res.json({ connected: false, status: 'error', phone: null, hasQR: false });
    }
  } catch (error) {
    res.json({ connected: false, status: 'error', phone: null, hasQR: false });
  }
});

// ==========================================
// POST /api/whatsapp/connect
// ==========================================
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const sessionName = getSessionName(userId);
    console.log(`🔌 Usuario ${userId} conectando (sesión: ${sessionName})`);

    const checkResponse = await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}`, {
      headers: getWahaHeaders()
    });

    if (checkResponse.status === 404) {
      const webhookUrl = `https://elisa-iaagentes-production.up.railway.app/api/webhook/whatsapp`;
      
      await fetch(`${WAHA_API_URL}/api/sessions`, {
        method: 'POST',
        headers: getWahaHeaders(),
        body: JSON.stringify({
          name: sessionName,
          config: {
            webhooks: [{ url: webhookUrl, events: ['message', 'session.status'] }]
          }
        })
      });

      console.log('✅ Sesión WAHA creada');
      res.json({ success: true, message: 'Sesión iniciada', session: sessionName });
    } else {
      const sessionData = await checkResponse.json() as any;
      
      if (sessionData.status === 'STOPPED' || sessionData.status === 'FAILED') {
        await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}/start`, {
          method: 'POST',
          headers: getWahaHeaders()
        });
      }
      
      res.json({ success: true, message: 'Sesión activada', session: sessionName });
    }
  } catch (error: any) {
    console.error('Error conectando:', error);
    res.status(500).json({ success: false, message: error.message || 'Error al conectar' });
  }
});

// ==========================================
// GET /api/whatsapp/qr
// ==========================================
router.get('/qr', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const sessionName = getSessionName(userId);

    try {
      const response = await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}/auth/qr`, {
        headers: { ...getWahaHeaders(), 'Accept': 'application/json' }
      });

      if (!response.ok) {
        res.json({ qr: null, available: false });
        return;
      }

      const data = await response.json() as any;
      
      if (data.value) {
        res.json({ 
          qr: data.value.startsWith('data:') ? data.value : `data:image/png;base64,${data.value}`, 
          available: true 
        });
      } else if (data.mimetype && data.data) {
        res.json({ qr: `data:${data.mimetype};base64,${data.data}`, available: true });
      } else {
        res.json({ qr: null, available: false });
      }
    } catch (fetchError) {
      res.json({ qr: null, available: false });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener QR', qr: null, available: false });
  }
});

// ==========================================
// POST /api/whatsapp/disconnect
// ==========================================
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const sessionName = getSessionName(userId);

    await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}/stop`, {
      method: 'POST',
      headers: getWahaHeaders()
    });

    console.log(`🔴 Usuario ${userId} desconectado`);
    res.json({ success: true, message: 'Desconectado' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Error' });
  }
});

// ==========================================
// POST /api/whatsapp/send
// ==========================================
router.post('/send', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { to, message } = req.body;

    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    if (!to || !message) { res.status(400).json({ error: 'Faltan datos' }); return; }

    const sessionName = getSessionName(userId);
    const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@c.us`;

    const response = await fetch(`${WAHA_API_URL}/api/sendText`, {
      method: 'POST',
      headers: getWahaHeaders(),
      body: JSON.stringify({ session: sessionName, chatId, text: message })
    });

    const result = await response.json() as any;

    if (response.ok) {
      const recipientId = to.replace(/\D/g, '');
      
      let conversation = await prisma.conversation.findFirst({
        where: { userId, recipientId }
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: { userId, recipientId, lastMessage: message, stage: 'new' }
        });
      }

      await prisma.message.create({
        data: { conversationId: conversation.id, content: message, fromMe: true }
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessage: message }
      });

      res.json({ success: true, messageId: result.id });
    } else {
      res.json({ success: false, message: result.message || 'Error' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Error' });
  }
});

// ==========================================
// POST /api/whatsapp/webhook - WAHA envia aquí
// ==========================================
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    console.log('📩 Webhook WAHA:', JSON.stringify(req.body, null, 2));

    const { event, session, payload } = req.body;

    if (!event || (event !== 'message' && event !== 'message.any')) {
      res.json({ success: true, ignored: true });
      return;
    }

    if (payload?.fromMe) {
      res.json({ success: true, ignored: true });
      return;
    }

    const userId = session?.replace('user_', '');
    if (!userId) {
      res.status(400).json({ error: 'Session inválida' });
      return;
    }

    const from = payload?.from || '';
    const body = payload?.body || payload?.text || '';
    const notifyName = payload?.notifyName || payload?.pushName || '';

    if (!from || !body) {
      res.json({ success: true, ignored: true });
      return;
    }

    const recipientId = from.replace('@c.us', '').replace('@s.whatsapp.net', '');
    const senderName = notifyName || recipientId;

    let conversation = await prisma.conversation.findFirst({
      where: { userId, recipientId }
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { userId, recipientId, recipientName: senderName, lastMessage: body, stage: 'new' }
      });
    }

    await prisma.message.create({
      data: { conversationId: conversation.id, content: body, fromMe: false }
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessage: body, recipientName: senderName }
    });

    console.log(`💾 Mensaje de ${senderName} para usuario ${userId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error webhook:', error);
    res.status(500).json({ error: 'Error' });
  }
});

export default router;
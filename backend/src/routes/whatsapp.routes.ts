import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { wahaService } from '../services/wahaService';
import { openaiService } from '../services/openaiService';
import { authMiddleware } from './auth.routes';

const router = Router();
const WEBHOOK_URL = process.env.WEBHOOK_URL || 
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/whatsapp/webhook` : 'http://localhost:3000/api/whatsapp/webhook');

/**
 * ============================================
 * WHATSAPP ROUTES - WAHA API
 * ============================================
 * 
 * COMANDOS PARA EL DUEÑO (desde el WhatsApp conectado):
 * - ".."  → Pausar IA para ese chat (tú tomas el control)
 * - "."   → Reanudar IA para ese chat
 * 
 * El cliente NUNCA ve estos comandos.
 */

// Cache en memoria para estado de pausa por recipientId
const pausedChats = new Map<string, boolean>();

// GET /status
router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    if (!currentUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const status = await wahaService.checkConnectionStatus();
    
    res.json({
      connected: status.connected,
      status: status.state || 'disconnected',
      phone: status.phone,
      instanceName: 'default'
    });
  } catch (error: any) {
    console.error('❌ Error /status:', error);
    res.status(500).json({ error: 'Error al obtener estado' });
  }
});

// POST /connect
router.post('/connect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const status = await wahaService.checkConnectionStatus();
    
    if (status.connected) {
      return res.json({ 
        success: true, 
        connected: true, 
        status: 'connected', 
        phone: status.phone 
      });
    }

    await wahaService.startSession();
    await wahaService.setWebhook(WEBHOOK_URL);
    
    const qrResult = await wahaService.getQRCode();
    
    res.json({ 
      success: true, 
      connected: false, 
      status: 'waiting_qr', 
      qrCode: qrResult.qrcode
    });
  } catch (error: any) {
    console.error('❌ Error /connect:', error);
    res.status(500).json({ error: 'Error al conectar WhatsApp' });
  }
});

// GET /qr
router.get('/qr', authMiddleware, async (req: Request, res: Response) => {
  try {
    const status = await wahaService.checkConnectionStatus();
    
    if (status.connected) {
      return res.json({ 
        connected: true, 
        status: 'connected', 
        phone: status.phone, 
        qrCode: null 
      });
    }

    const result = await wahaService.getQRCode();
    
    res.json({ 
      connected: false, 
      status: 'waiting_qr', 
      qrCode: result.qrcode
    });
  } catch (error: any) {
    console.error('❌ Error /qr:', error);
    res.status(500).json({ error: 'Error al obtener QR' });
  }
});

// POST /disconnect
router.post('/disconnect', authMiddleware, async (req: Request, res: Response) => {
  try {
    await wahaService.stopSession();
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error /disconnect:', error);
    res.status(500).json({ error: 'Error al desconectar' });
  }
});

// POST /send
router.post('/send', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { to, message } = req.body;
    
    if (!to || !message) {
      return res.status(400).json({ error: 'Faltan datos (to, message)' });
    }
    
    const result = await wahaService.sendTextMessage(to, message);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }
    
    res.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    console.error('❌ Error /send:', error);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

/**
 * ============================================
 * WEBHOOK - WAHA
 * ============================================
 */

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const event = data.event;
    
    console.log(`\n🔔 Webhook: ${event}`);
    
    // Evento de mensaje
    if (event === 'message' || event === 'message.any') {
      const payload = data.payload || data;
      
      // Extraer datos del mensaje
      const messageContent = payload.body || payload.text || '';
      const trimmedContent = messageContent.trim();
      
      // Detectar si es mensaje enviado por el dueño (fromMe)
      const isFromMe = payload.fromMe === true || 
                       payload.from_me === true || 
                       (payload._data && payload._data.id && payload._data.id.fromMe === true);
      
      // Obtener el chatId (número del cliente)
      // Cuando fromMe=true, el "to" es el cliente
      // Cuando fromMe=false, el "from" es el cliente
      let clientChatId: string;
      
      if (isFromMe) {
        // Mensaje del dueño → el cliente está en "to"
        clientChatId = payload.to || payload.chatId || '';
      } else {
        // Mensaje del cliente → el cliente está en "from"
        clientChatId = payload.from || payload.chatId || '';
      }
      
      // Extraer número limpio del cliente
      const clientNumber = clientChatId
        .replace('@c.us', '')
        .replace('@s.whatsapp.net', '')
        .replace('@lid', '')
        .replace(/\D/g, '');
      
      console.log(`📱 Cliente: ${clientNumber}`);
      console.log(`📝 Mensaje: "${trimmedContent}"`);
      console.log(`👤 fromMe: ${isFromMe}`);
      
      if (!clientNumber || !trimmedContent) {
        return res.json({ received: true });
      }
      
      // Ignorar grupos
      if (clientChatId.includes('@g.us')) {
        return res.json({ received: true });
      }

      // ============================================
      // MENSAJE DEL DUEÑO (fromMe = true)
      // ============================================
      if (isFromMe) {
        console.log(`\n🏠 Mensaje del DUEÑO`);
        
        // Comando ".." → PAUSAR IA
        if (trimmedContent === '..') {
          pausedChats.set(clientNumber, true);
          console.log(`⏸️ IA PAUSADA para cliente ${clientNumber}`);
          return res.json({ received: true });
        }
        
        // Comando "." → REANUDAR IA
        if (trimmedContent === '.') {
          pausedChats.set(clientNumber, false);
          console.log(`▶️ IA REANUDADA para cliente ${clientNumber}`);
          return res.json({ received: true });
        }
        
        // Otro mensaje del dueño → ignorar (está respondiendo manualmente)
        console.log(`📤 Dueño respondiendo manualmente, ignorando`);
        return res.json({ received: true });
      }

      // ============================================
      // MENSAJE DEL CLIENTE (fromMe = false)
      // ============================================
      console.log(`\n📨 Mensaje del CLIENTE`);
      
      const pushName = payload.notifyName || payload._data?.notifyName || '';
      
      // Buscar usuario con WhatsApp conectado
      const user = await prisma.user.findFirst({ 
        where: { apiKeyConnected: true }
      });
      
      if (!user) {
        console.log('⚠️ No hay usuario con API Key configurada');
        return res.json({ received: true });
      }

      // Gestión de conversación
      let conversation = await prisma.conversation.findFirst({
        where: { userId: user.id, recipientId: clientNumber }
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: { 
            userId: user.id, 
            recipientId: clientNumber,
            recipientName: pushName || clientNumber, 
            lastMessage: messageContent, 
            lastMessageAt: new Date()
          }
        });
      } else {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { 
            lastMessage: messageContent, 
            lastMessageAt: new Date(), 
            recipientName: pushName || conversation.recipientName
          }
        });
      }

      // Verificar si la IA está pausada para este cliente
      const isPaused = pausedChats.get(clientNumber) || false;
      console.log(`⏸️ IA pausada: ${isPaused}`);
      
      if (isPaused) {
        console.log('⏸️ IA pausada - Solo guardando mensaje, NO respondiendo');
        
        await prisma.message.create({
          data: { 
            conversationId: conversation.id, 
            userId: user.id, 
            role: 'user', 
            content: messageContent, 
            fromMe: false 
          }
        });
        
        return res.json({ received: true });
      }

      // ============================================
      // PROCESAR CON IA (modo automático)
      // ============================================
      console.log('🤖 Procesando con IA...');

      await prisma.message.create({
        data: { 
          conversationId: conversation.id, 
          userId: user.id, 
          role: 'user', 
          content: messageContent, 
          fromMe: false 
        }
      });

      const recentMessages = await prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { timestamp: 'asc' },
        take: 20
      });
      const history = recentMessages.map(m => ({ role: m.role, content: m.content }));

      const aiResponse = await openaiService.generateResponse(user.id, messageContent, history.slice(0, -1));

      if (aiResponse.success && aiResponse.response) {
        console.log(`✅ Respuesta: ${aiResponse.response.substring(0, 60)}...`);
        
        const sendResult = await wahaService.sendTextMessage(clientChatId, aiResponse.response);

        if (sendResult.success) {
          await prisma.message.create({
            data: { 
              conversationId: conversation.id, 
              userId: user.id, 
              role: 'assistant', 
              content: aiResponse.response, 
              fromMe: true 
            }
          });
          console.log('✅ Enviado!');
        } else {
          console.error('❌ Error:', sendResult.error);
        }
      }
    }

    if (event === 'session.status') {
      console.log(`📡 Sesión: ${data.payload?.status}`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('❌ Error webhook:', error);
    res.status(500).json({ error: 'Error' });
  }
});

// GET /webhook
router.get('/webhook', (req: Request, res: Response) => {
  res.send('✅ Webhook activo');
});

// GET /pause-status - Debug
router.get('/pause-status', (req: Request, res: Response) => {
  res.json({ 
    pausedChats: Object.fromEntries(pausedChats),
    total: pausedChats.size
  });
});

export { pausedChats };
export default router;

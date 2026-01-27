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
 * ✅ Soporta LID nativamente
 * ============================================
 */

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
    const user = (req as any).user;
    
    // Verificar estado actual
    const status = await wahaService.checkConnectionStatus();
    
    if (status.connected) {
      return res.json({ 
        success: true, 
        connected: true, 
        status: 'connected', 
        phone: status.phone 
      });
    }

    // Iniciar sesión si no está activa
    await wahaService.startSession();
    
    // Configurar webhook
    await wahaService.setWebhook(WEBHOOK_URL);
    
    // Obtener QR
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
 * 
 * WAHA envía eventos en formato diferente a Evolution
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const event = data.event;
    
    console.log(`\n🔔 Webhook WAHA: ${event}`);
    console.log('📦 Data:', JSON.stringify(data).substring(0, 500));
    
    // Evento de mensaje
    if (event === 'message' || event === 'message.any') {
      const payload = data.payload || data;
      
      // Ignorar mensajes propios
      if (payload.fromMe) {
        return res.json({ received: true });
      }
      
      // Obtener datos del mensaje
      const chatId = payload.from || payload.chatId;
      const messageId = payload.id;
      const messageContent = payload.body || payload.text || '';
      const pushName = payload.notifyName || payload._data?.notifyName || '';
      
      if (!chatId || !messageContent) {
        return res.json({ received: true });
      }
      
      // Ignorar grupos
      if (chatId.includes('@g.us')) {
        return res.json({ received: true });
      }

      console.log(`\n📨 Mensaje recibido`);
      console.log(`📍 ChatId: ${chatId}`);
      console.log(`📝 Contenido: ${messageContent}`);
      console.log(`👤 De: ${pushName}`);

      // Extraer número para BD
      const recipientId = chatId
        .replace('@c.us', '')
        .replace('@s.whatsapp.net', '')
        .replace('@lid', '')
        .replace(/\D/g, '');

      // Buscar usuario con WhatsApp conectado
      // Como WAHA gratis solo tiene 1 sesión, buscamos cualquier usuario con apiKeyConnected
      const user = await prisma.user.findFirst({ 
        where: { apiKeyConnected: true }
      });
      
      if (!user) {
        console.log('⚠️ No hay usuario con API Key configurada');
        return res.json({ received: true });
      }

      // Gestión de conversación
      let conversation = await prisma.conversation.findFirst({
        where: { userId: user.id, recipientId: recipientId }
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: { 
            userId: user.id, 
            recipientId: recipientId,
            recipientName: pushName || recipientId, 
            lastMessage: messageContent, 
            lastMessageAt: new Date() 
          }
        });
        console.log(`📝 Nueva conversación creada: ${conversation.id}`);
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

      // Guardar mensaje del usuario
      await prisma.message.create({
        data: { 
          conversationId: conversation.id, 
          userId: user.id, 
          role: 'user', 
          content: messageContent, 
          fromMe: false 
        }
      });

      // Obtener historial
      const recentMessages = await prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { timestamp: 'asc' },
        take: 20
      });
      const history = recentMessages.map(m => ({ role: m.role, content: m.content }));

      // Generar respuesta con IA
      console.log('🤖 Generando respuesta con OpenAI...');
      const aiResponse = await openaiService.generateResponse(user.id, messageContent, history.slice(0, -1));

      if (aiResponse.success && aiResponse.response) {
        console.log(`✅ Respuesta: ${aiResponse.response.substring(0, 80)}...`);
        
        // ✅ ENVIAR RESPUESTA (WAHA soporta LID)
        console.log(`📤 Enviando a: ${chatId}`);
        
        const sendResult = await wahaService.sendTextMessage(chatId, aiResponse.response);

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
          console.log('✅ ¡Mensaje enviado exitosamente!');
        } else {
          console.error('❌ Error enviando mensaje:', sendResult.error);
        }
      } else {
        console.error('❌ Error generando respuesta:', aiResponse.error);
      }
    }

    // Evento de estado de sesión
    if (event === 'session.status') {
      console.log(`📡 Estado sesión: ${data.payload?.status}`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('❌ Error en webhook:', error);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

// GET /webhook - Health check
router.get('/webhook', (req: Request, res: Response) => {
  res.send('✅ Webhook WAHA activo - Soporta LID');
});

export default router;

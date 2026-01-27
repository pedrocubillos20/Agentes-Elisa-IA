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
 * Comandos de control (SOLO para el dueño del negocio):
 * - ".."  → Pausar IA (el dueño toma el control) - SILENCIOSO
 * - "."   → Reanudar IA - SILENCIOSO
 * 
 * El cliente NUNCA sabe que hay un bot.
 * Los comandos son invisibles para el cliente.
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
 * 
 * COMANDOS SILENCIOSOS (solo para el dueño):
 * - ".."  → Pausar IA (NO envía mensaje al cliente)
 * - "."   → Reanudar IA (NO envía mensaje al cliente)
 * 
 * El cliente NUNCA ve estos comandos ni sabe que existe un bot.
 */

// Cache en memoria para estado de pausa
const pausedConversations = new Map<string, boolean>();

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const event = data.event;
    
    console.log(`\n🔔 Webhook WAHA: ${event}`);
    
    // Evento de mensaje
    if (event === 'message' || event === 'message.any') {
      const payload = data.payload || data;
      
      const chatId = payload.from || payload.chatId;
      const messageContent = payload.body || payload.text || '';
      const pushName = payload.notifyName || payload._data?.notifyName || '';
      const isFromMe = payload.fromMe || false;
      
      if (!chatId || !messageContent) {
        return res.json({ received: true });
      }
      
      // Ignorar grupos
      if (chatId.includes('@g.us')) {
        return res.json({ received: true });
      }

      // Extraer número para BD
      const recipientId = chatId
        .replace('@c.us', '')
        .replace('@s.whatsapp.net', '')
        .replace('@lid', '')
        .replace(/\D/g, '');

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

      const conversationId = conversation.id;
      const trimmedContent = messageContent.trim();
      
      // ============================================
      // COMANDOS DE CONTROL (SILENCIOSOS)
      // Solo funcionan cuando el DUEÑO escribe (fromMe = true)
      // ============================================
      
      if (isFromMe) {
        // Comando ".." → PAUSAR IA (silencioso)
        if (trimmedContent === '..') {
          console.log('⏸️ [SILENCIOSO] Dueño pausó la IA');
          pausedConversations.set(conversationId, true);
          
          // NO enviamos mensaje al cliente - es silencioso
          // Solo registramos internamente
          console.log(`⏸️ IA pausada para conversación ${conversationId}`);
          
          return res.json({ received: true });
        }
        
        // Comando "." → REANUDAR IA (silencioso)
        if (trimmedContent === '.') {
          console.log('▶️ [SILENCIOSO] Dueño reactivó la IA');
          pausedConversations.set(conversationId, false);
          
          // NO enviamos mensaje al cliente - es silencioso
          console.log(`▶️ IA reactivada para conversación ${conversationId}`);
          
          return res.json({ received: true });
        }
        
        // Si es otro mensaje del dueño, ignoramos (el dueño está respondiendo manualmente)
        console.log('📤 Mensaje del dueño - ignorando');
        return res.json({ received: true });
      }

      // ============================================
      // MENSAJE DEL CLIENTE
      // ============================================
      
      console.log(`\n📨 Mensaje del cliente`);
      console.log(`📍 ChatId: ${chatId}`);
      console.log(`📝 Contenido: ${messageContent}`);
      console.log(`👤 De: ${pushName}`);

      // Verificar si la IA está pausada
      const isPaused = pausedConversations.get(conversationId) || false;
      
      if (isPaused) {
        console.log('⏸️ IA pausada - El dueño está atendiendo manualmente');
        
        // Guardar mensaje del cliente pero NO responder
        await prisma.message.create({
          data: { 
            conversationId: conversationId, 
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

      // Guardar mensaje del cliente
      await prisma.message.create({
        data: { 
          conversationId: conversationId, 
          userId: user.id, 
          role: 'user', 
          content: messageContent, 
          fromMe: false 
        }
      });

      // Obtener historial
      const recentMessages = await prisma.message.findMany({
        where: { conversationId: conversationId },
        orderBy: { timestamp: 'asc' },
        take: 20
      });
      const history = recentMessages.map(m => ({ role: m.role, content: m.content }));

      // Generar respuesta con IA
      console.log('🤖 Generando respuesta con IA...');
      const aiResponse = await openaiService.generateResponse(user.id, messageContent, history.slice(0, -1));

      if (aiResponse.success && aiResponse.response) {
        console.log(`✅ Respuesta: ${aiResponse.response.substring(0, 80)}...`);
        
        const sendResult = await wahaService.sendTextMessage(chatId, aiResponse.response);

        if (sendResult.success) {
          await prisma.message.create({
            data: { 
              conversationId: conversationId, 
              userId: user.id, 
              role: 'assistant', 
              content: aiResponse.response, 
              fromMe: true 
            }
          });
          console.log('✅ ¡Mensaje enviado!');
        } else {
          console.error('❌ Error enviando:', sendResult.error);
        }
      } else {
        console.error('❌ Error IA:', aiResponse.error);
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
  res.send('✅ Webhook WAHA activo');
});

// Exportar el mapa de pausas
export { pausedConversations };
export default router;

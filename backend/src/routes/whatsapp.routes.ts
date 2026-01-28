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
 */

// Cache en memoria para estado de pausa
const pausedConversations = new Map<string, boolean>();

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const event = data.event;
    
    console.log(`\n🔔 ========== WEBHOOK WAHA ==========`);
    console.log(`📡 Evento: ${event}`);
    
    // Evento de mensaje
    if (event === 'message' || event === 'message.any') {
      const payload = data.payload || data;
      
      // ============================================
      // DEBUG: Ver estructura completa del payload
      // ============================================
      console.log(`\n🔍 DEBUG - Payload completo:`);
      console.log(JSON.stringify(payload, null, 2));
      
      const chatId = payload.from || payload.chatId;
      const messageContent = payload.body || payload.text || '';
      const pushName = payload.notifyName || payload._data?.notifyName || '';
      
      // Verificar múltiples ubicaciones posibles de fromMe
      const isFromMe = payload.fromMe || 
                       payload.from_me || 
                       payload._data?.fromMe ||
                       (payload.id && payload.id.fromMe) ||
                       false;
      
      console.log(`\n📊 DEBUG - Campos extraídos:`);
      console.log(`   chatId: ${chatId}`);
      console.log(`   messageContent: "${messageContent}"`);
      console.log(`   pushName: ${pushName}`);
      console.log(`   isFromMe: ${isFromMe}`);
      console.log(`   payload.fromMe: ${payload.fromMe}`);
      console.log(`   payload.from_me: ${payload.from_me}`);
      console.log(`   payload._data?.fromMe: ${payload._data?.fromMe}`);
      
      if (!chatId || !messageContent) {
        console.log('⚠️ ChatId o contenido vacío, ignorando');
        return res.json({ received: true });
      }
      
      // Ignorar grupos
      if (chatId.includes('@g.us')) {
        console.log('⚠️ Mensaje de grupo, ignorando');
        return res.json({ received: true });
      }

      // Extraer número para BD
      const recipientId = chatId
        .replace('@c.us', '')
        .replace('@s.whatsapp.net', '')
        .replace('@lid', '')
        .replace(/\D/g, '');

      console.log(`📱 RecipientId extraído: ${recipientId}`);

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
      
      console.log(`\n🎯 Analizando mensaje:`);
      console.log(`   Contenido trimmed: "${trimmedContent}"`);
      console.log(`   Es ".."?: ${trimmedContent === '..'}`);
      console.log(`   Es "."?: ${trimmedContent === '.'}`);
      console.log(`   isFromMe: ${isFromMe}`);
      
      // ============================================
      // COMANDOS DE CONTROL (SILENCIOSOS)
      // Funcionan tanto si isFromMe es true O si el mensaje es solo ".." o "."
      // ============================================
      
      // Comando ".." → PAUSAR IA (silencioso)
      if (trimmedContent === '..') {
        console.log('⏸️ ========== COMANDO PAUSAR DETECTADO ==========');
        pausedConversations.set(conversationId, true);
        console.log(`⏸️ IA PAUSADA para conversación ${conversationId}`);
        console.log(`📋 Estado actual de pausas:`, Object.fromEntries(pausedConversations));
        
        // NO enviamos mensaje al cliente - es silencioso
        return res.json({ received: true });
      }
      
      // Comando "." → REANUDAR IA (silencioso)
      if (trimmedContent === '.') {
        console.log('▶️ ========== COMANDO REANUDAR DETECTADO ==========');
        pausedConversations.set(conversationId, false);
        console.log(`▶️ IA REANUDADA para conversación ${conversationId}`);
        console.log(`📋 Estado actual de pausas:`, Object.fromEntries(pausedConversations));
        
        // NO enviamos mensaje al cliente - es silencioso
        return res.json({ received: true });
      }
      
      // Si el mensaje es del dueño (no es comando), ignoramos
      if (isFromMe) {
        console.log('📤 Mensaje del dueño (no es comando) - ignorando');
        return res.json({ received: true });
      }

      // ============================================
      // MENSAJE DEL CLIENTE
      // ============================================
      
      console.log(`\n📨 ========== MENSAJE DEL CLIENTE ==========`);
      console.log(`📍 ChatId: ${chatId}`);
      console.log(`📝 Contenido: ${messageContent}`);
      console.log(`👤 De: ${pushName}`);

      // Verificar si la IA está pausada
      const isPaused = pausedConversations.get(conversationId) || false;
      console.log(`⏸️ ¿IA pausada?: ${isPaused}`);
      
      if (isPaused) {
        console.log('⏸️ IA PAUSADA - El dueño está atendiendo manualmente');
        console.log('📝 Guardando mensaje pero NO respondiendo');
        
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
      console.log('🤖 ========== PROCESANDO CON IA ==========');

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
        console.log(`✅ Respuesta generada: ${aiResponse.response.substring(0, 80)}...`);
        
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
          console.log('✅ ¡Mensaje enviado exitosamente!');
        } else {
          console.error('❌ Error enviando mensaje:', sendResult.error);
        }
      } else {
        console.error('❌ Error generando respuesta IA:', aiResponse.error);
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

// GET /pause-status - Ver estado de pausas (debug)
router.get('/pause-status', (req: Request, res: Response) => {
  res.json({ 
    pausedConversations: Object.fromEntries(pausedConversations),
    total: pausedConversations.size
  });
});

// Exportar el mapa de pausas
export { pausedConversations };
export default router;

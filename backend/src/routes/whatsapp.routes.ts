import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { evolutionService } from '../services/evolutionService';
import { openaiService } from '../services/openaiService';
import { authMiddleware } from './auth.routes';

const router = Router();
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/whatsapp/webhook`
  : 'http://localhost:3000/api/whatsapp/webhook';

/**
 * ============================================
 * WHATSAPP ROUTES - ARQUITECTURA TYPEBOT
 * ============================================
 * 
 * CONCEPTO CLAVE (como Typebot):
 * - chatId = remoteJid (sea @lid, @c.us o @s.whatsapp.net)
 * - NO filtramos LID
 * - NO intentamos convertir LID a número
 * - Usamos chatId como ID único de conversación
 * - WhatsApp PERMITE responder a LID
 * 
 * El teléfono real es solo metadata, no clave primaria.
 * 
 * ============================================
 */

// ============================================
// HELPER: Extraer displayPhone (solo para mostrar)
// ============================================
function extractDisplayPhone(chatId: string): string {
  // Si es número real, lo mostramos
  if (chatId.includes('@c.us') || chatId.includes('@s.whatsapp.net')) {
    return chatId.split('@')[0];
  }
  // Si es LID, mostramos "LID:xxxxx"
  if (chatId.includes('@lid')) {
    return `LID:${chatId.split('@')[0].slice(-6)}`;
  }
  return chatId;
}

// ============================================
// GET /status
// ============================================
router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    if (!currentUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (currentUser.evolutionInstanceName) {
      const status = await evolutionService.checkConnectionStatus(currentUser.evolutionInstanceName);
      console.log(`📊 Estado conexión: ${currentUser.evolutionInstanceName} -> ${status.connected ? 'open' : 'disconnected'}`);
      
      if (status.instanceNotFound) {
        return res.json({ connected: false, status: 'disconnected', phone: null, instanceName: null, qrCode: null });
      }
      
      const updatedUser = await prisma.user.findUnique({ where: { id: currentUser.id } });
      
      return res.json({
        connected: updatedUser?.whatsappConnected || false,
        status: updatedUser?.whatsappStatus || 'disconnected',
        phone: updatedUser?.whatsappPhone,
        instanceName: updatedUser?.evolutionInstanceName,
        qrCode: updatedUser?.whatsappQrCode
      });
    }
    
    res.json({ connected: false, status: 'disconnected', phone: null, instanceName: null, qrCode: null });
  } catch (error: any) {
    console.error('❌ Error obteniendo estado:', error);
    res.status(500).json({ error: 'Error al obtener estado' });
  }
});

// ============================================
// POST /connect
// ============================================
router.post('/connect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    if (!currentUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (currentUser.evolutionInstanceName) {
      const status = await evolutionService.checkConnectionStatus(currentUser.evolutionInstanceName);
      
      if (!status.instanceNotFound && status.connected) {
        return res.json({ success: true, connected: true, status: 'connected', phone: status.phone });
      }
      
      if (!status.instanceNotFound) {
        const qrResult = await evolutionService.getQRCode(currentUser.evolutionInstanceName);
        if (qrResult.success && qrResult.qrcode) {
          return res.json({ success: true, connected: false, status: 'waiting_qr', qrCode: qrResult.qrcode, instanceName: currentUser.evolutionInstanceName });
        }
      }
    }

    const result = await evolutionService.createInstance(currentUser.id);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }
    
    if (result.instanceName) {
      await evolutionService.setWebhook(result.instanceName, WEBHOOK_URL);
    }
    
    res.json({ success: true, connected: false, status: 'waiting_qr', qrCode: result.qrcode, instanceName: result.instanceName });
  } catch (error: any) {
    console.error('❌ Error conectando:', error);
    res.status(500).json({ error: 'Error al conectar WhatsApp' });
  }
});

// ============================================
// GET /qr
// ============================================
router.get('/qr', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    if (!currentUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (!currentUser.evolutionInstanceName) {
      const result = await evolutionService.createInstance(currentUser.id);
      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }
      if (result.instanceName) {
        await evolutionService.setWebhook(result.instanceName, WEBHOOK_URL);
      }
      return res.json({ connected: false, status: 'waiting_qr', qrCode: result.qrcode, instanceName: result.instanceName });
    }

    const status = await evolutionService.checkConnectionStatus(currentUser.evolutionInstanceName);
    
    if (status.connected) {
      return res.json({ connected: true, status: 'connected', phone: status.phone, qrCode: null });
    }

    const result = await evolutionService.getQRCode(currentUser.evolutionInstanceName);
    
    if (result.instanceNotFound) {
      const newInstance = await evolutionService.createInstance(currentUser.id);
      if (!newInstance.success) {
        return res.status(500).json({ error: newInstance.error });
      }
      if (newInstance.instanceName) {
        await evolutionService.setWebhook(newInstance.instanceName, WEBHOOK_URL);
      }
      return res.json({ connected: false, status: 'waiting_qr', qrCode: newInstance.qrcode, instanceName: newInstance.instanceName });
    }
    
    res.json({ connected: false, status: 'waiting_qr', qrCode: result.qrcode || currentUser.whatsappQrCode });
  } catch (error: any) {
    console.error('❌ Error obteniendo QR:', error);
    res.status(500).json({ error: 'Error al obtener QR' });
  }
});

// ============================================
// POST /disconnect
// ============================================
router.post('/disconnect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user.evolutionInstanceName) {
      return res.json({ success: true });
    }
    await evolutionService.disconnectInstance(user.evolutionInstanceName);
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error desconectando:', error);
    res.status(500).json({ error: 'Error al desconectar' });
  }
});

// ============================================
// DELETE /instance
// ============================================
router.delete('/instance', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user.evolutionInstanceName) {
      return res.json({ success: true });
    }
    await evolutionService.deleteInstance(user.evolutionInstanceName);
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error eliminando:', error);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// ============================================
// POST /send
// ============================================
router.post('/send', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { to, message } = req.body;
    
    if (!user.evolutionInstanceName || !user.whatsappConnected) {
      return res.status(400).json({ error: 'WhatsApp no conectado' });
    }
    
    if (!to || !message) {
      return res.status(400).json({ error: 'Faltan datos' });
    }
    
    const result = await evolutionService.sendTextMessage(user.evolutionInstanceName, to, message);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }
    
    res.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    console.error('❌ Error enviando:', error);
    res.status(500).json({ error: 'Error al enviar' });
  }
});

// ============================================
// POST /webhook - ARQUITECTURA TYPEBOT
// ============================================
/**
 * CLAVE: NO filtramos LID
 * - chatId = remoteJid (exacto como viene)
 * - Guardamos conversación con chatId como ID
 * - Respondemos al chatId original
 * - WhatsApp PERMITE responder a LID
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const event = data.event || data.type;
    const instanceName = data.instance || data.instanceName || data.data?.instance;
    
    console.log(`\n🔔 Webhook: ${event} | Instancia: ${instanceName}`);
    
    // ============================================
    // CONNECTION_UPDATE
    // ============================================
    if (event === 'CONNECTION_UPDATE' || event === 'connection.update') {
      const state = data.data?.state || data.state;
      const connected = state === 'open' || state === 'connected';
      
      console.log(`📡 Conexión: ${state} | Conectado: ${connected}`);
      
      if (instanceName) {
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { 
              whatsappConnected: connected, 
              whatsappStatus: connected ? 'connected' : state, 
              whatsappQrCode: connected ? null : user.whatsappQrCode 
            }
          });
        }
      }
      return res.json({ received: true });
    }

    // ============================================
    // QRCODE_UPDATED
    // ============================================
    if (event === 'QRCODE_UPDATED' || event === 'qrcode.updated') {
      const qrcode = data.data?.qrcode?.base64 || data.qrcode?.base64 || data.data?.base64;
      
      if (instanceName && qrcode) {
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        if (user) {
          await prisma.user.update({ where: { id: user.id }, data: { whatsappQrCode: qrcode } });
        }
      }
      return res.json({ received: true });
    }

    // ============================================
    // MESSAGES_UPSERT - ESTILO TYPEBOT
    // ============================================
    if (event === 'MESSAGES_UPSERT' || event === 'messages.upsert') {
      const messageData = data.data || data;
      const messages = messageData.messages || [messageData];
      
      for (const msg of messages) {
        // Ignorar mensajes propios
        if (msg.key?.fromMe) continue;
        
        // ============================================
        // CLAVE TYPEBOT: chatId = remoteJid EXACTO
        // NO filtramos LID, lo aceptamos como válido
        // ============================================
        const chatId = msg.key?.remoteJid;
        
        if (!chatId) {
          console.log('⚠️ Sin remoteJid');
          continue;
        }
        
        // Solo ignorar grupos
        if (chatId.includes('@g.us')) {
          console.log('⚠️ Mensaje de grupo ignorado');
          continue;
        }

        // Determinar tipo de chat
        const isLid = chatId.includes('@lid');
        const chatType = isLid ? 'LID' : 'REAL';
        
        // Display phone (solo para mostrar en UI)
        const displayPhone = extractDisplayPhone(chatId);
        const pushName = msg.pushName || displayPhone;

        console.log('\n╔══════════════════════════════════════════════════════════════╗');
        console.log('║         MENSAJE RECIBIDO (Typebot Style)                     ║');
        console.log('╚══════════════════════════════════════════════════════════════╝');
        console.log(`📋 chatId: ${chatId}`);
        console.log(`📱 Tipo: ${chatType}`);
        console.log(`👤 Nombre: ${pushName}`);

        // Extraer contenido del mensaje
        const messageContent = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.text || 
                              msg.text || '';
        
        if (!messageContent) {
          console.log('⚠️ Mensaje sin contenido de texto');
          continue;
        }

        console.log(`📨 Mensaje: ${messageContent}`);

        // Buscar usuario
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        
        if (!user) {
          console.log('❌ Usuario no encontrado para esta instancia');
          continue;
        }

        if (!user.apiKeyConnected) {
          console.log('⚠️ Usuario sin API Key configurada');
          continue;
        }

        // ============================================
        // GESTIÓN DE CONVERSACIÓN (ESTILO TYPEBOT)
        // recipientId = chatId completo (puede ser LID)
        // ============================================
        let conversation = await prisma.conversation.findFirst({
          where: { userId: user.id, recipientId: chatId }
        });

        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: { 
              userId: user.id, 
              recipientId: chatId,  // chatId completo como ID
              recipientName: pushName, 
              lastMessage: messageContent, 
              lastMessageAt: new Date() 
            }
          });
          console.log(`📝 Nueva conversación: ${conversation.id} (${chatType})`);
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

        // Guardar mensaje
        await prisma.message.create({
          data: { 
            conversationId: conversation.id, 
            userId: user.id, 
            role: 'user', 
            content: messageContent, 
            fromMe: false 
          }
        });

        // Historial
        const recentMessages = await prisma.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { timestamp: 'asc' },
          take: 20
        });

        const history = recentMessages.map(m => ({ role: m.role, content: m.content }));

        // ============================================
        // GENERAR RESPUESTA CON IA
        // ============================================
        console.log('🤖 Generando respuesta con IA...');
        
        const aiResponse = await openaiService.generateResponse(user.id, messageContent, history.slice(0, -1));

        if (aiResponse.success && aiResponse.response) {
          console.log(`✅ Respuesta: ${aiResponse.response.substring(0, 80)}...`);
          
          // ============================================
          // ENVIAR RESPUESTA AL chatId ORIGINAL
          // WhatsApp PERMITE responder a LID
          // ============================================
          console.log(`📤 Enviando a chatId: ${chatId}`);
          
          const sendResult = await evolutionService.sendTextMessage(
            instanceName, 
            chatId,  // Enviamos al chatId exacto (LID o número real)
            aiResponse.response
          );

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
            console.log(`✅ ¡MENSAJE ENVIADO! (${chatType})`);
          } else {
            console.error('❌ Error enviando:', sendResult.error);
          }
        } else {
          console.error('❌ Error generando respuesta IA:', aiResponse.error);
        }
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('❌ Error en webhook:', error);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

// ============================================
// GET /webhook - Health check
// ============================================
router.get('/webhook', (req: Request, res: Response) => {
  res.send('✅ Webhook Evolution API (Typebot Style) activo');
});

export default router;

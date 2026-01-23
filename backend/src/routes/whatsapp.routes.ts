import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { evolutionService } from '../services/evolutionService';
import { openaiService } from '../services/openaiService';
import { authMiddleware } from './auth.routes';

const router = Router();
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/whatsapp/webhook`
  : 'http://localhost:3000/api/whatsapp/webhook';

// ============================================
// FUNCIONES AUXILIARES
// ============================================

/**
 * Extrae un identificador para guardar conversaciones
 * Usa el remoteJid limpio (sin @lid o @s.whatsapp.net)
 */
function extractConversationId(remoteJid: string): string {
  return remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '');
}

// ============================================
// RUTAS DE ESTADO Y CONEXIÓN
// ============================================

router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    if (!currentUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (currentUser.evolutionInstanceName) {
      const status = await evolutionService.checkConnectionStatus(currentUser.evolutionInstanceName);
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
    res.status(500).json({ error: 'Error al obtener estado' });
  }
});

router.post('/connect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!currentUser) return res.status(404).json({ error: 'Usuario no encontrado' });

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
    if (!result.success) return res.status(500).json({ error: result.error });
    if (result.instanceName) await evolutionService.setWebhook(result.instanceName, WEBHOOK_URL);
    res.json({ success: true, connected: false, status: 'waiting_qr', qrCode: result.qrcode, instanceName: result.instanceName });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al conectar WhatsApp' });
  }
});

router.get('/qr', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!currentUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (!currentUser.evolutionInstanceName) {
      const result = await evolutionService.createInstance(currentUser.id);
      if (!result.success) return res.status(500).json({ error: result.error });
      if (result.instanceName) await evolutionService.setWebhook(result.instanceName, WEBHOOK_URL);
      return res.json({ connected: false, status: 'waiting_qr', qrCode: result.qrcode, instanceName: result.instanceName });
    }

    const status = await evolutionService.checkConnectionStatus(currentUser.evolutionInstanceName);
    if (status.connected) return res.json({ connected: true, status: 'connected', phone: status.phone, qrCode: null });

    const result = await evolutionService.getQRCode(currentUser.evolutionInstanceName);
    if (result.instanceNotFound) {
      const newInstance = await evolutionService.createInstance(currentUser.id);
      if (!newInstance.success) return res.status(500).json({ error: newInstance.error });
      if (newInstance.instanceName) await evolutionService.setWebhook(newInstance.instanceName, WEBHOOK_URL);
      return res.json({ connected: false, status: 'waiting_qr', qrCode: newInstance.qrcode, instanceName: newInstance.instanceName });
    }
    res.json({ connected: false, status: 'waiting_qr', qrCode: result.qrcode || currentUser.whatsappQrCode });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener QR' });
  }
});

router.post('/disconnect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user.evolutionInstanceName) return res.json({ success: true });
    await evolutionService.disconnectInstance(user.evolutionInstanceName);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al desconectar' });
  }
});

router.delete('/instance', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user.evolutionInstanceName) return res.json({ success: true });
    await evolutionService.deleteInstance(user.evolutionInstanceName);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

router.post('/send', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { to, message } = req.body;
    if (!user.evolutionInstanceName || !user.whatsappConnected) return res.status(400).json({ error: 'WhatsApp no conectado' });
    if (!to || !message) return res.status(400).json({ error: 'Faltan datos' });
    const result = await evolutionService.sendTextMessage(user.evolutionInstanceName, to, message);
    if (!result.success) return res.status(500).json({ error: result.error });
    res.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al enviar' });
  }
});

// ============================================
// WEBHOOK PRINCIPAL
// ============================================
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const event = data.event || data.type;
    const instanceName = data.instance || data.instanceName;
    
    console.log(`\n📨 Webhook: ${event}`);

    // ============================================
    // CONNECTION_UPDATE
    // ============================================
    if (event === 'CONNECTION_UPDATE' || event === 'connection.update') {
      const state = data.data?.state || data.state;
      console.log(`📡 Estado conexión: ${state}`);
      
      if (instanceName) {
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        if (user) {
          const connected = state === 'open';
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
        if (user) await prisma.user.update({ where: { id: user.id }, data: { whatsappQrCode: qrcode } });
      }
      return res.json({ received: true });
    }

    // ============================================
    // MESSAGES_UPSERT - Procesar mensajes entrantes
    // ============================================
    if (event === 'MESSAGES_UPSERT' || event === 'messages.upsert') {
      const messageData = data.data || data;
      const messages = messageData.messages || [messageData];
      
      for (const msg of messages) {
        // Ignorar mensajes propios
        if (msg.key?.fromMe) {
          console.log('⏭️ Mensaje propio, ignorando');
          continue;
        }
        
        // Obtener el remoteJid ORIGINAL - esto es CRUCIAL
        const remoteJid = msg.key?.remoteJid || msg.from;
        if (!remoteJid) {
          console.log('⏭️ Sin remoteJid, ignorando');
          continue;
        }
        
        // Ignorar grupos
        if (remoteJid.includes('@g.us')) {
          console.log('⏭️ Es grupo, ignorando');
          continue;
        }

        console.log('\n╔══════════════════════════════════════════════════════════════╗');
        console.log('║                    MENSAJE RECIBIDO                          ║');
        console.log('╚══════════════════════════════════════════════════════════════╝');
        console.log(`📋 remoteJid ORIGINAL: ${remoteJid}`);
        
        // Para responder, USAR EL REMOTEJID ORIGINAL (incluyendo @lid si es LID)
        const replyTo = remoteJid;
        
        // Para guardar en DB, usar un identificador limpio
        const conversationId = extractConversationId(remoteJid);
        const pushName = msg.pushName || '';
        
        console.log(`📱 Responder a: ${replyTo}`);
        console.log(`🆔 ID conversación: ${conversationId}`);
        console.log(`👤 Nombre: ${pushName}`);

        // Extraer contenido del mensaje
        const messageContent = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.text || 
                              msg.text ||
                              msg.body || '';
        
        if (!messageContent) {
          console.log('⏭️ Sin contenido de texto, ignorando');
          continue;
        }

        console.log(`💬 Mensaje: ${messageContent}`);

        // Buscar usuario dueño de la instancia
        const user = await prisma.user.findFirst({ 
          where: { evolutionInstanceName: instanceName } 
        });
        
        if (!user) {
          console.log('❌ Usuario no encontrado para esta instancia');
          continue;
        }

        // Verificar que tiene API Key de OpenAI
        if (!user.apiKeyConnected) {
          console.log('⚠️ Usuario sin API Key configurada');
          await evolutionService.sendTextMessage(
            instanceName, 
            replyTo, 
            '⚠️ El asistente no está configurado correctamente. Contacta al administrador.'
          );
          continue;
        }

        // Buscar o crear conversación (usando el ID limpio)
        let conversation = await prisma.conversation.findFirst({
          where: { 
            userId: user.id, 
            recipientId: conversationId 
          }
        });

        if (!conversation) {
          console.log('📝 Creando nueva conversación');
          conversation = await prisma.conversation.create({
            data: { 
              userId: user.id, 
              recipientId: conversationId, 
              recipientName: pushName || conversationId, 
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

        // Guardar mensaje entrante
        await prisma.message.create({
          data: { 
            conversationId: conversation.id, 
            userId: user.id, 
            role: 'user', 
            content: messageContent, 
            fromMe: false 
          }
        });

        // Obtener historial para contexto
        const recentMessages = await prisma.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { timestamp: 'asc' },
          take: 20
        });

        const history = recentMessages.map(m => ({ 
          role: m.role as 'user' | 'assistant', 
          content: m.content 
        }));

        console.log('🤖 Generando respuesta con OpenAI...');
        
        // Generar respuesta con IA
        const aiResponse = await openaiService.generateResponse(
          user.id, 
          messageContent, 
          history.slice(0, -1)
        );

        if (aiResponse.success && aiResponse.response) {
          console.log(`📤 Respuesta generada: ${aiResponse.response.substring(0, 100)}...`);
          console.log(`📤 Enviando a: ${replyTo}`);
          
          // ENVIAR USANDO EL REMOTEJID ORIGINAL
          const sendResult = await evolutionService.sendTextMessage(
            instanceName, 
            replyTo,  // <-- Esto ahora incluye @lid si es necesario
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
            console.log('✅ ¡Mensaje enviado exitosamente!');
          } else {
            console.error('❌ Error enviando mensaje:', sendResult.error);
          }
        } else {
          console.error('❌ Error generando respuesta:', aiResponse.error);
          await evolutionService.sendTextMessage(
            instanceName, 
            replyTo, 
            'Lo siento, hubo un problema procesando tu mensaje. Por favor intenta de nuevo.'
          );
        }
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('❌ Error en webhook:', error);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

router.get('/webhook', (req: Request, res: Response) => {
  res.send('Webhook activo - Elisa IA');
});

export default router;

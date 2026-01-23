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
// WEBHOOK PRINCIPAL - v2.3.7 FORMAT
// ============================================
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    
    // v2.3.7 puede enviar el evento de diferentes formas
    const event = data.event || data.type || 'unknown';
    const instanceName = data.instance || data.instanceName || data.data?.instance;
    
    console.log(`\n📨 Webhook recibido: ${event}`);
    console.log(`📋 Instance: ${instanceName}`);
    console.log(`📋 Data completa:`, JSON.stringify(data).substring(0, 1000));

    // CONNECTION_UPDATE
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

    // QRCODE_UPDATED
    if (event === 'QRCODE_UPDATED' || event === 'qrcode.updated') {
      const qrcode = data.data?.qrcode?.base64 || data.qrcode?.base64 || data.data?.base64;
      if (instanceName && qrcode) {
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        if (user) await prisma.user.update({ where: { id: user.id }, data: { whatsappQrCode: qrcode } });
      }
      return res.json({ received: true });
    }

    // MESSAGES_UPSERT - v2.3.7 format
    if (event === 'MESSAGES_UPSERT' || event === 'messages.upsert') {
      console.log('\n╔══════════════════════════════════════════════════════════════╗');
      console.log('║                    MENSAJE RECIBIDO v2.3.7                    ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      
      // v2.3.7 estructura: data.data[] contiene los mensajes
      const messageData = data.data || data;
      let messages = [];
      
      // Puede venir como array o como objeto
      if (Array.isArray(messageData)) {
        messages = messageData;
      } else if (messageData.messages) {
        messages = messageData.messages;
      } else if (messageData.key) {
        messages = [messageData];
      } else {
        messages = [messageData];
      }

      console.log(`📋 Mensajes a procesar: ${messages.length}`);

      for (const msg of messages) {
        console.log(`📋 Mensaje raw:`, JSON.stringify(msg).substring(0, 800));
        
        // v2.3.7: verificar si es mensaje propio
        const fromMe = msg.key?.fromMe || msg.fromMe;
        if (fromMe) {
          console.log('⏭️ Mensaje propio, ignorando');
          continue;
        }
        
        // Obtener remoteJid
        const remoteJid = msg.key?.remoteJid || msg.remoteJid || msg.from;
        if (!remoteJid) {
          console.log('⏭️ Sin remoteJid, ignorando');
          continue;
        }
        
        // Ignorar grupos
        if (remoteJid.includes('@g.us')) {
          console.log('⏭️ Es grupo, ignorando');
          continue;
        }

        console.log(`📱 remoteJid: ${remoteJid}`);
        
        // Extraer el número para responder
        // v2.3.7 puede usar LIDs pero también envía el número real en algunos campos
        let replyTo = remoteJid;
        
        // Buscar número real en diferentes campos
        const pushName = msg.pushName || msg.key?.pushName || '';
        
        // Para conversaciones, usar un ID limpio
        const conversationId = extractConversationId(remoteJid);
        
        console.log(`📱 Reply to: ${replyTo}`);
        console.log(`🆔 Conversation ID: ${conversationId}`);
        console.log(`👤 Nombre: ${pushName}`);

        // Extraer contenido del mensaje - v2.3.7 puede tener diferentes estructuras
        let messageContent = '';
        
        if (msg.message) {
          messageContent = msg.message.conversation || 
                          msg.message.extendedTextMessage?.text ||
                          msg.message.text ||
                          '';
        } else {
          messageContent = msg.text || msg.body || msg.conversation || '';
        }
        
        if (!messageContent) {
          console.log('⏭️ Sin contenido de texto, ignorando');
          console.log('📋 Estructura del mensaje:', JSON.stringify(msg.message || msg).substring(0, 500));
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
            '⚠️ El asistente no está configurado correctamente.'
          );
          continue;
        }

        // Buscar o crear conversación
        let conversation = await prisma.conversation.findFirst({
          where: { userId: user.id, recipientId: conversationId }
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
          console.log(`📤 Respuesta: ${aiResponse.response.substring(0, 100)}...`);
          console.log(`📤 Enviando a: ${replyTo}`);
          
          // Enviar respuesta
          const sendResult = await evolutionService.sendTextMessage(
            instanceName, 
            replyTo,
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
            'Lo siento, hubo un problema. Intenta de nuevo.'
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
  res.send('Webhook activo - Elisa IA v2.3.7');
});

export default router;

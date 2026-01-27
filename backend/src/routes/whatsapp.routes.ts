import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { evolutionService } from '../services/evolutionService';
import { openaiService } from '../services/openaiService';
import { authMiddleware } from './auth.routes';

const router = Router();
const WEBHOOK_URL = process.env.WEBHOOK_URL || 
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/whatsapp/webhook` : 'http://localhost:3000/api/whatsapp/webhook');

/**
 * ============================================
 * WHATSAPP ROUTES - EVOLUTION API v1.8.0
 * FIX LID: Usar /message/reply para @lid
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

    if (currentUser.evolutionInstanceName) {
      const status = await evolutionService.checkConnectionStatus(currentUser.evolutionInstanceName);
      
      if (status.instanceNotFound) {
        return res.json({ 
          connected: false, 
          status: 'disconnected', 
          phone: null, 
          instanceName: null, 
          qrCode: null 
        });
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
    
    res.json({ 
      connected: false, 
      status: 'disconnected', 
      phone: null, 
      instanceName: null, 
      qrCode: null 
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
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    if (!currentUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (currentUser.evolutionInstanceName) {
      const status = await evolutionService.checkConnectionStatus(currentUser.evolutionInstanceName);
      
      if (!status.instanceNotFound && status.connected) {
        return res.json({ 
          success: true, 
          connected: true, 
          status: 'connected', 
          phone: status.phone 
        });
      }
      
      if (!status.instanceNotFound) {
        const qrResult = await evolutionService.getQRCode(currentUser.evolutionInstanceName);
        if (qrResult.success && qrResult.qrcode) {
          return res.json({ 
            success: true, 
            connected: false, 
            status: 'waiting_qr', 
            qrCode: qrResult.qrcode, 
            instanceName: currentUser.evolutionInstanceName 
          });
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
    
    res.json({ 
      success: true, 
      connected: false, 
      status: 'waiting_qr', 
      qrCode: result.qrcode, 
      instanceName: result.instanceName 
    });
  } catch (error: any) {
    console.error('❌ Error /connect:', error);
    res.status(500).json({ error: 'Error al conectar WhatsApp' });
  }
});

// GET /qr
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
      return res.json({ 
        connected: false, 
        status: 'waiting_qr', 
        qrCode: result.qrcode, 
        instanceName: result.instanceName 
      });
    }

    const status = await evolutionService.checkConnectionStatus(currentUser.evolutionInstanceName);
    
    if (status.connected) {
      return res.json({ 
        connected: true, 
        status: 'connected', 
        phone: status.phone, 
        qrCode: null 
      });
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
      return res.json({ 
        connected: false, 
        status: 'waiting_qr', 
        qrCode: newInstance.qrcode, 
        instanceName: newInstance.instanceName 
      });
    }
    
    res.json({ 
      connected: false, 
      status: 'waiting_qr', 
      qrCode: result.qrcode || currentUser.whatsappQrCode 
    });
  } catch (error: any) {
    console.error('❌ Error /qr:', error);
    res.status(500).json({ error: 'Error al obtener QR' });
  }
});

// POST /disconnect
router.post('/disconnect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    if (currentUser?.evolutionInstanceName) {
      await evolutionService.disconnectInstance(currentUser.evolutionInstanceName);
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error /disconnect:', error);
    res.status(500).json({ error: 'Error al desconectar' });
  }
});

// DELETE /instance
router.delete('/instance', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    if (currentUser?.evolutionInstanceName) {
      await evolutionService.deleteInstance(currentUser.evolutionInstanceName);
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error /instance:', error);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// POST /send
router.post('/send', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { to, message } = req.body;
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    if (!currentUser?.evolutionInstanceName || !currentUser?.whatsappConnected) {
      return res.status(400).json({ error: 'WhatsApp no conectado' });
    }
    
    if (!to || !message) {
      return res.status(400).json({ error: 'Faltan datos (to, message)' });
    }
    
    const result = await evolutionService.sendTextMessage(currentUser.evolutionInstanceName, to, message);
    
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
 * WEBHOOK - EVOLUTION v1.8.0
 * ============================================
 * 
 * Captura messageId para usar con /message/reply
 * cuando el remoteJid es @lid
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const event = data.event || data.type;
    const instanceName = data.instance || data.instanceName || data.data?.instance;
    
    console.log(`\n🔔 Webhook: ${event} | Instancia: ${instanceName}`);
    
    // CONNECTION_UPDATE
    if (event === 'CONNECTION_UPDATE' || event === 'connection.update') {
      const state = data.data?.state || data.state;
      const connected = state === 'open' || state === 'connected';
      
      console.log(`📡 Estado conexión: ${state} (${connected ? 'conectado' : 'desconectado'})`);
      
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

    // QRCODE_UPDATED
    if (event === 'QRCODE_UPDATED' || event === 'qrcode.updated') {
      const qrcode = data.data?.qrcode?.base64 || data.qrcode?.base64 || data.data?.base64;
      
      console.log(`📱 QR actualizado: ${qrcode ? 'Sí' : 'No'}`);
      
      if (instanceName && qrcode) {
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        if (user) {
          await prisma.user.update({ 
            where: { id: user.id }, 
            data: { whatsappQrCode: qrcode } 
          });
        }
      }
      return res.json({ received: true });
    }

    // MESSAGES_UPSERT
    if (event === 'MESSAGES_UPSERT' || event === 'messages.upsert') {
      const messageData = data.data || data;
      const messages = messageData.messages || [messageData];
      
      for (const msg of messages) {
        // Ignorar mensajes propios
        if (msg.key?.fromMe) continue;
        
        // ✅ OBTENER JID Y MESSAGE ID (CLAVE PARA REPLY)
        const remoteJid = msg.key?.remoteJid;
        const messageId = msg.key?.id;  // ⬅️ NECESARIO PARA /message/reply
        
        if (!remoteJid) continue;
        
        // Ignorar grupos
        if (remoteJid.includes('@g.us')) continue;

        console.log(`\n📨 Mensaje recibido`);
        console.log(`📍 RemoteJid: ${remoteJid}`);
        console.log(`🔑 MessageId: ${messageId}`);
        console.log(`🔍 Es LID: ${remoteJid.includes('@lid')}`);

        // Para BD: extraer solo dígitos
        const recipientId = remoteJid
          .replace('@s.whatsapp.net', '')
          .replace('@c.us', '')
          .replace('@lid', '')
          .replace(/\D/g, '');
        
        const pushName = msg.pushName || recipientId;

        // Extraer contenido del mensaje
        const messageContent = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || '';
        
        if (!messageContent) continue;
        
        console.log(`📝 Contenido: ${messageContent}`);
        console.log(`👤 De: ${pushName}`);

        // Buscar usuario
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        
        if (!user) {
          console.log('⚠️ Usuario no encontrado');
          continue;
        }
        
        if (!user.apiKeyConnected) {
          console.log('⚠️ Usuario sin API Key configurada');
          continue;
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
              recipientName: pushName, 
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
          
          // ✅ ENVIAR - El service usa /reply para LID, /sendText para normal
          console.log(`📤 Enviando respuesta a: ${remoteJid}`);
          console.log(`📤 Con messageId: ${messageId}`);
          
          const sendResult = await evolutionService.sendTextMessage(
            instanceName, 
            remoteJid,     // JID tal cual (@lid o @s.whatsapp.net)
            aiResponse.response,
            messageId      // ⬅️ PASAR MESSAGE ID PARA REPLY
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
        }
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('❌ Error en webhook:', error);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

// GET /webhook - Health check
router.get('/webhook', (req: Request, res: Response) => {
  res.send('✅ Webhook Evolution API v1.8.0 (reply para LID) activo');
});

export default router;

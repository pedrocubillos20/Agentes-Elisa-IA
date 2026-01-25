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
 * WHATSAPP ROUTES - ARQUITECTURA TYPEBOT
 * Acepta LID como chatId válido
 * ============================================
 */

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
    if (user.evolutionInstanceName) await evolutionService.disconnectInstance(user.evolutionInstanceName);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al desconectar' });
  }
});

router.delete('/instance', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.evolutionInstanceName) await evolutionService.deleteInstance(user.evolutionInstanceName);
    res.json({ success: true });
  } catch (error) {
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
  } catch (error) {
    res.status(500).json({ error: 'Error al enviar' });
  }
});

/**
 * ============================================
 * WEBHOOK - ACEPTA LID
 * ============================================
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
      if (instanceName) {
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { whatsappConnected: connected, whatsappStatus: connected ? 'connected' : state, whatsappQrCode: connected ? null : user.whatsappQrCode }
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

    // MESSAGES_UPSERT
    if (event === 'MESSAGES_UPSERT' || event === 'messages.upsert') {
      const messageData = data.data || data;
      const messages = messageData.messages || [messageData];
      
      for (const msg of messages) {
        if (msg.key?.fromMe) continue;
        
        const chatId = msg.key?.remoteJid;
        if (!chatId || chatId.includes('@g.us')) continue;

        // ACEPTA LID - usa chatId como identificador
        const isLid = chatId.includes('@lid');
        const recipientId = chatId; // Guardar chatId completo
        const pushName = msg.pushName || chatId.split('@')[0];

        console.log(`\n📨 Mensaje de: ${chatId} (${isLid ? 'LID' : 'REAL'})`);

        const messageContent = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || '';
        
        if (!messageContent) continue;
        console.log(`📝 Contenido: ${messageContent}`);

        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        if (!user || !user.apiKeyConnected) continue;

        // Gestión de conversación con chatId como ID
        let conversation = await prisma.conversation.findFirst({
          where: { userId: user.id, recipientId }
        });

        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: { userId: user.id, recipientId, recipientName: pushName, lastMessage: messageContent, lastMessageAt: new Date() }
          });
        } else {
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessage: messageContent, lastMessageAt: new Date(), recipientName: pushName || conversation.recipientName }
          });
        }

        await prisma.message.create({
          data: { conversationId: conversation.id, userId: user.id, role: 'user', content: messageContent, fromMe: false }
        });

        const recentMessages = await prisma.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { timestamp: 'asc' },
          take: 20
        });
        const history = recentMessages.map(m => ({ role: m.role, content: m.content }));

        console.log('🤖 Generando respuesta...');
        const aiResponse = await openaiService.generateResponse(user.id, messageContent, history.slice(0, -1));

        if (aiResponse.success && aiResponse.response) {
          console.log(`✅ Respuesta: ${aiResponse.response.substring(0, 50)}...`);
          
          // Enviar al chatId (funciona con LID en Evolution API v1.8.0)
          const sendResult = await evolutionService.sendTextMessage(instanceName, chatId, aiResponse.response);

          if (sendResult.success) {
            await prisma.message.create({
              data: { conversationId: conversation.id, userId: user.id, role: 'assistant', content: aiResponse.response, fromMe: true }
            });
            console.log('✅ ¡Mensaje enviado!');
          } else {
            console.error('❌ Error enviando:', sendResult.error);
          }
        }
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('❌ Error webhook:', error);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

router.get('/webhook', (req: Request, res: Response) => {
  res.send('✅ Webhook activo');
});

export default router;

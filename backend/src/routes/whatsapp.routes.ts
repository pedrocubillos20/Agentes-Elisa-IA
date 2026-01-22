import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { evolutionService } from '../services/evolutionService';
import { openaiService } from '../services/openaiService';
import { authMiddleware } from './auth.routes';

const router = Router();
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/whatsapp/webhook`
  : 'http://localhost:3000/api/whatsapp/webhook';

// Obtener estado de WhatsApp
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
          connected: false, status: 'disconnected', phone: null, instanceName: null, qrCode: null,
          message: 'La instancia anterior fue eliminada. Por favor conecta de nuevo.'
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

    res.json({ connected: false, status: 'disconnected', phone: null, instanceName: null, qrCode: null });
  } catch (error: any) {
    console.error('Error obteniendo estado:', error);
    res.status(500).json({ error: 'Error al obtener estado' });
  }
});

// Iniciar conexión
router.post('/connect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    if (!currentUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (currentUser.evolutionInstanceName) {
      const status = await evolutionService.checkConnectionStatus(currentUser.evolutionInstanceName);
      
      if (status.instanceNotFound) {
        // Continuar a crear nueva
      } else if (status.connected) {
        return res.json({ success: true, connected: true, status: 'connected', phone: status.phone, message: 'Ya estás conectado' });
      } else {
        const qrResult = await evolutionService.getQRCode(currentUser.evolutionInstanceName);
        if (qrResult.success && qrResult.qrcode) {
          return res.json({ success: true, connected: false, status: 'waiting_qr', qrCode: qrResult.qrcode, instanceName: currentUser.evolutionInstanceName });
        }
        if (!qrResult.instanceNotFound) {
          await evolutionService.deleteInstance(currentUser.evolutionInstanceName);
        }
      }
    }

    const result = await evolutionService.createInstance(currentUser.id);
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Error al crear conexión' });
    }

    if (result.instanceName) {
      await evolutionService.setWebhook(result.instanceName, WEBHOOK_URL);
    }

    res.json({ success: true, connected: false, status: 'waiting_qr', qrCode: result.qrcode, instanceName: result.instanceName });
  } catch (error: any) {
    console.error('Error conectando:', error);
    res.status(500).json({ error: 'Error al conectar WhatsApp' });
  }
});

// Obtener QR Code
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
        return res.status(500).json({ error: result.error || 'Error al crear instancia' });
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
        return res.status(500).json({ error: newInstance.error || 'Error al crear instancia' });
      }
      if (newInstance.instanceName) {
        await evolutionService.setWebhook(newInstance.instanceName, WEBHOOK_URL);
      }
      return res.json({ connected: false, status: 'waiting_qr', qrCode: newInstance.qrcode, instanceName: newInstance.instanceName });
    }

    res.json({ connected: false, status: 'waiting_qr', qrCode: result.qrcode || currentUser.whatsappQrCode });
  } catch (error: any) {
    console.error('Error obteniendo QR:', error);
    res.status(500).json({ error: 'Error al obtener QR' });
  }
});

// Desconectar
router.post('/disconnect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user.evolutionInstanceName) {
      return res.json({ success: true, message: 'No hay conexión activa' });
    }
    await evolutionService.disconnectInstance(user.evolutionInstanceName);
    res.json({ success: true, message: 'WhatsApp desconectado' });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al desconectar' });
  }
});

// Eliminar instancia
router.delete('/instance', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user.evolutionInstanceName) {
      return res.json({ success: true, message: 'No hay instancia' });
    }
    await evolutionService.deleteInstance(user.evolutionInstanceName);
    res.json({ success: true, message: 'Instancia eliminada' });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al eliminar instancia' });
  }
});

// Enviar mensaje
router.post('/send', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { to, message } = req.body;
    if (!user.evolutionInstanceName || !user.whatsappConnected) {
      return res.status(400).json({ error: 'WhatsApp no conectado' });
    }
    if (!to || !message) {
      return res.status(400).json({ error: 'Número y mensaje son requeridos' });
    }
    const result = await evolutionService.sendTextMessage(user.evolutionInstanceName, to, message);
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }
    res.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

// ============================================
// WEBHOOK - CAPTURAR NÚMERO REAL
// ============================================
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    
    // LOG COMPLETO DEL WEBHOOK PARA DEBUG
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    WEBHOOK RECIBIDO                          ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('📦 DATA COMPLETA:');
    console.log(JSON.stringify(data, null, 2).substring(0, 3000));
    console.log('═══════════════════════════════════════════════════════════════\n');

    const event = data.event || data.type;
    const instanceName = data.instance || data.instanceName;

    // CONNECTION_UPDATE
    if (event === 'CONNECTION_UPDATE' || event === 'connection.update') {
      const state = data.data?.state || data.state;
      if (instanceName) {
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        if (user) {
          const connected = state === 'open';
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
        if (user) {
          await prisma.user.update({ where: { id: user.id }, data: { whatsappQrCode: qrcode } });
        }
      }
      return res.json({ received: true });
    }

    // ============================================
    // MESSAGES_UPSERT - BUSCAR NÚMERO REAL
    // ============================================
    if (event === 'MESSAGES_UPSERT' || event === 'messages.upsert') {
      const messageData = data.data || data;
      const messages = messageData.messages || [messageData];
      
      for (const msg of messages) {
        if (msg.key?.fromMe) continue;
        
        const remoteJid = msg.key?.remoteJid || msg.from;
        if (!remoteJid) continue;
        if (remoteJid.includes('@g.us')) continue; // Ignorar grupos

        console.log('\n');
        console.log('╔══════════════════════════════════════════════════════════════╗');
        console.log('║              ANALIZANDO MENSAJE PARA NÚMERO REAL             ║');
        console.log('╚══════════════════════════════════════════════════════════════╝');
        
        // EXTRAER TODOS LOS CAMPOS POSIBLES
        const allFields = {
          remoteJid: remoteJid,
          'msg.from': msg.from,
          'msg.sender': msg.sender,
          'msg.participant': msg.participant,
          'msg.key.participant': msg.key?.participant,
          'msg.pushName': msg.pushName,
          'msg.verifiedBizName': msg.verifiedBizName,
          'msg.notify': msg.notify,
          'msg.phone': msg.phone,
          'msg.number': msg.number,
          'msg.contact': msg.contact,
          'msg.key.remoteJid': msg.key?.remoteJid,
          'data.sender': messageData.sender,
          'data.participant': messageData.participant,
          'data.from': messageData.from,
          'data.phone': messageData.phone,
          'data.number': messageData.number,
          'data.contact': messageData.contact,
          'data.owner': messageData.owner,
          'msg.message.contactMessage': msg.message?.contactMessage,
          'msg.message.contactsArrayMessage': msg.message?.contactsArrayMessage,
        };
        
        console.log('📋 TODOS LOS CAMPOS:');
        for (const [key, value] of Object.entries(allFields)) {
          if (value !== undefined && value !== null) {
            console.log(`   ${key}: ${JSON.stringify(value)}`);
          }
        }
        
        // ============================================
        // BUSCAR EL NÚMERO REAL (debe ser 573203921881)
        // ============================================
        let realPhoneNumber: string | null = null;
        let replyTo: string;
        let displayNumber: string;
        
        const isLid = remoteJid.includes('@lid');
        
        // Lista de campos donde buscar el número real
        const possibleNumberSources = [
          msg.key?.participant,
          msg.participant,
          msg.sender,
          msg.from,
          msg.phone,
          msg.number,
          messageData.sender,
          messageData.participant,
          messageData.phone,
          messageData.number,
          msg.contact?.number,
          msg.contact?.phone,
        ];
        
        console.log('\n🔍 Buscando número real en campos...');
        
        for (const source of possibleNumberSources) {
          if (!source) continue;
          
          const sourceStr = String(source);
          
          // Buscar formato @s.whatsapp.net (número real)
          if (sourceStr.includes('@s.whatsapp.net')) {
            realPhoneNumber = sourceStr.replace('@s.whatsapp.net', '').replace(/\D/g, '');
            console.log(`✅ NÚMERO REAL ENCONTRADO en @s.whatsapp.net: ${realPhoneNumber}`);
            break;
          }
          
          // Buscar número que NO sea LID (más de 10 dígitos, empiece con código de país)
          const cleanNumber = sourceStr.replace(/\D/g, '');
          if (cleanNumber.length >= 10 && cleanNumber.length <= 15) {
            // Verificar que no sea el número LID (que empieza con 5585...)
            if (!cleanNumber.startsWith('5585') && !sourceStr.includes('@lid')) {
              realPhoneNumber = cleanNumber;
              console.log(`✅ NÚMERO REAL ENCONTRADO: ${realPhoneNumber}`);
              break;
            }
          }
        }
        
        // Si encontramos número real, usarlo
        if (realPhoneNumber) {
          replyTo = realPhoneNumber;
          displayNumber = realPhoneNumber;
          console.log(`📱 Usando número REAL: ${replyTo}`);
        } else if (isLid) {
          // No encontramos número real, usar LID
          replyTo = remoteJid; // Mantener el JID completo
          displayNumber = remoteJid.split('@')[0];
          console.log(`⚠️ No se encontró número real, usando LID: ${replyTo}`);
        } else {
          // Formato normal
          replyTo = remoteJid.split('@')[0].replace(/\D/g, '');
          displayNumber = replyTo;
          console.log(`📱 Formato normal: ${replyTo}`);
        }
        
        // Extraer mensaje
        const messageContent = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.text || msg.text || '';
        
        if (!messageContent) continue;
        
        const pushName = msg.pushName || displayNumber;
        
        console.log('\n📨 ═══════════════════════════════════════');
        console.log(`📨 De: ${pushName}`);
        console.log(`📨 Display: ${displayNumber}`);
        console.log(`📨 ReplyTo: ${replyTo}`);
        console.log(`📨 Mensaje: ${messageContent}`);
        console.log('📨 ═══════════════════════════════════════\n');

        // Buscar usuario
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        if (!user) {
          console.log(`❌ Usuario no encontrado para: ${instanceName}`);
          continue;
        }

        if (!user.apiKeyConnected) {
          console.log(`❌ Sin API Key: ${user.email}`);
          await evolutionService.sendTextMessage(instanceName, replyTo, '⚠️ El asistente no está configurado.');
          continue;
        }

        // Buscar o crear conversación
        let conversation = await prisma.conversation.findFirst({
          where: { userId: user.id, recipientId: displayNumber }
        });

        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: { userId: user.id, recipientId: displayNumber, recipientName: pushName, lastMessage: messageContent, lastMessageAt: new Date() }
          });
        } else {
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessage: messageContent, lastMessageAt: new Date(), recipientName: pushName || conversation.recipientName }
          });
        }

        // Guardar mensaje
        await prisma.message.create({
          data: { conversationId: conversation.id, userId: user.id, role: 'user', content: messageContent, fromMe: false }
        });

        // Historial
        const recentMessages = await prisma.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { timestamp: 'asc' },
          take: 20
        });

        const history = recentMessages.map(m => ({ role: m.role, content: m.content }));

        // Generar respuesta
        console.log('🤖 Generando respuesta con IA...');
        const aiResponse = await openaiService.generateResponse(user.id, messageContent, history.slice(0, -1));

        if (aiResponse.success && aiResponse.response) {
          console.log(`✅ Respuesta: ${aiResponse.response.substring(0, 100)}...`);
          console.log(`📤 Enviando a: ${replyTo}`);
          
          const sendResult = await evolutionService.sendTextMessage(instanceName, replyTo, aiResponse.response);

          if (sendResult.success) {
            await prisma.message.create({
              data: { conversationId: conversation.id, userId: user.id, role: 'assistant', content: aiResponse.response, fromMe: true }
            });
            console.log('✅ ¡MENSAJE ENVIADO EXITOSAMENTE!');
          } else {
            console.error(`❌ Error enviando: ${sendResult.error}`);
          }
        } else {
          console.error('❌ Error IA:', aiResponse.error);
          await evolutionService.sendTextMessage(instanceName, replyTo, 'Lo siento, hubo un problema. Intenta de nuevo.');
        }
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('❌ Error webhook:', error);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

// Webhook GET
router.get('/webhook', (req: Request, res: Response) => {
  res.send('Webhook activo');
});

export default router;

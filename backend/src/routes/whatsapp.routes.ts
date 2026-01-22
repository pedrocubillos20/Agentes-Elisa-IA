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
// CACHÉ DE MAPEO LID → NÚMERO REAL
// ============================================
// Estructura: { "55852006375537@lid": "573203921881" }
const lidToPhoneCache: Map<string, string> = new Map();

// Función para extraer número real de un contacto
function extractRealNumber(contact: any): string | null {
  // Buscar en todos los campos posibles donde puede estar el número real
  const possibleFields = [
    contact.id,
    contact.jid,
    contact.number,
    contact.phone,
    contact.wid,
    contact.remoteJid,
    contact.pushName,
    contact.verifiedName,
    contact.notify,
  ];
  
  for (const field of possibleFields) {
    if (!field) continue;
    
    const fieldStr = String(field);
    
    // Si contiene @s.whatsapp.net, es un número real
    if (fieldStr.includes('@s.whatsapp.net')) {
      const number = fieldStr.replace('@s.whatsapp.net', '').replace(/\D/g, '');
      if (number.length >= 10 && number.length <= 15) {
        return number;
      }
    }
    
    // Si es solo números y tiene longitud válida
    const cleanNumber = fieldStr.replace(/\D/g, '');
    if (cleanNumber.length >= 10 && cleanNumber.length <= 15) {
      // Verificar que NO sea un LID (los LID de Brasil empiezan con 5585)
      if (!cleanNumber.startsWith('5585') && !fieldStr.includes('@lid')) {
        return cleanNumber;
      }
    }
  }
  
  return null;
}

// Función para extraer LID de un contacto
function extractLid(contact: any): string | null {
  const possibleFields = [contact.id, contact.jid, contact.lid, contact.remoteJid];
  
  for (const field of possibleFields) {
    if (!field) continue;
    const fieldStr = String(field);
    if (fieldStr.includes('@lid')) {
      return fieldStr;
    }
  }
  
  return null;
}

// ============================================
// RUTAS EXISTENTES
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
    // EVENTOS DE CONTACTOS - GUARDAR MAPEO LID
    // ============================================
    if (event === 'CONTACTS_UPSERT' || event === 'contacts.upsert' || 
        event === 'CONTACTS_UPDATE' || event === 'contacts.update' ||
        event === 'CONTACTS_SET' || event === 'contacts.set') {
      
      console.log('\n╔══════════════════════════════════════════════════════════════╗');
      console.log('║                   EVENTO DE CONTACTOS                         ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log('📋 Data completa:', JSON.stringify(data).substring(0, 2000));
      
      const contacts = data.data || data.contacts || [data];
      const contactsArray = Array.isArray(contacts) ? contacts : [contacts];
      
      for (const contact of contactsArray) {
        console.log('\n📇 Procesando contacto:', JSON.stringify(contact).substring(0, 500));
        
        const lid = extractLid(contact);
        const realNumber = extractRealNumber(contact);
        
        console.log(`   LID encontrado: ${lid}`);
        console.log(`   Número real encontrado: ${realNumber}`);
        
        if (lid && realNumber) {
          lidToPhoneCache.set(lid, realNumber);
          // También guardar sin @lid
          const lidWithoutSuffix = lid.replace('@lid', '');
          lidToPhoneCache.set(lidWithoutSuffix, realNumber);
          
          console.log(`✅ MAPEO GUARDADO: ${lid} → ${realNumber}`);
          console.log(`✅ MAPEO GUARDADO: ${lidWithoutSuffix} → ${realNumber}`);
        }
      }
      
      console.log(`\n📊 Cache actual (${lidToPhoneCache.size} entradas):`);
      lidToPhoneCache.forEach((phone, lid) => {
        console.log(`   ${lid} → ${phone}`);
      });
      
      return res.json({ received: true });
    }

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
        if (user) await prisma.user.update({ where: { id: user.id }, data: { whatsappQrCode: qrcode } });
      }
      return res.json({ received: true });
    }

    // ============================================
    // MESSAGES_UPSERT - PROCESAR CON MAPEO LID
    // ============================================
    if (event === 'MESSAGES_UPSERT' || event === 'messages.upsert') {
      const messageData = data.data || data;
      const messages = messageData.messages || [messageData];
      
      for (const msg of messages) {
        if (msg.key?.fromMe) continue;
        
        const remoteJid = msg.key?.remoteJid || msg.from;
        if (!remoteJid) continue;
        if (remoteJid.includes('@g.us')) continue;

        console.log('\n╔══════════════════════════════════════════════════════════════╗');
        console.log('║                    MENSAJE RECIBIDO                          ║');
        console.log('╚══════════════════════════════════════════════════════════════╝');
        console.log(`📋 remoteJid: ${remoteJid}`);
        
        const isLid = remoteJid.includes('@lid');
        let replyTo: string;
        let displayNumber: string;
        const pushName = msg.pushName || '';

        if (isLid) {
          console.log('🔍 Es un LID, buscando en caché...');
          
          // Buscar en el caché
          let cachedNumber = lidToPhoneCache.get(remoteJid);
          if (!cachedNumber) {
            const lidWithoutSuffix = remoteJid.replace('@lid', '');
            cachedNumber = lidToPhoneCache.get(lidWithoutSuffix);
          }
          
          if (cachedNumber) {
            console.log(`✅ NÚMERO ENCONTRADO EN CACHÉ: ${cachedNumber}`);
            replyTo = cachedNumber;
            displayNumber = cachedNumber;
          } else {
            console.log('⚠️ No encontrado en caché, buscando en campos del mensaje...');
            
            // Buscar en campos del mensaje
            const possibleSources = [
              msg.key?.participant,
              msg.participant,
              msg.sender,
              msg.from,
              msg.phone,
              msg.number,
              messageData.sender,
              messageData.participant,
            ];
            
            let foundNumber: string | null = null;
            for (const source of possibleSources) {
              if (!source) continue;
              const sourceStr = String(source);
              
              if (sourceStr.includes('@s.whatsapp.net')) {
                foundNumber = sourceStr.replace('@s.whatsapp.net', '').replace(/\D/g, '');
                console.log(`✅ Número encontrado en campo: ${foundNumber}`);
                break;
              }
              
              const cleanNum = sourceStr.replace(/\D/g, '');
              if (cleanNum.length >= 10 && cleanNum.length <= 15 && !cleanNum.startsWith('5585')) {
                foundNumber = cleanNum;
                console.log(`✅ Número encontrado: ${foundNumber}`);
                break;
              }
            }
            
            if (foundNumber) {
              // Guardar en caché para futuro
              lidToPhoneCache.set(remoteJid, foundNumber);
              console.log(`💾 Guardado en caché: ${remoteJid} → ${foundNumber}`);
              
              replyTo = foundNumber;
              displayNumber = foundNumber;
            } else {
              // Último recurso: usar el número del LID
              displayNumber = remoteJid.split('@')[0];
              replyTo = displayNumber;
              console.log(`⚠️ Usando LID como número: ${replyTo}`);
            }
          }
        } else {
          // Número normal
          displayNumber = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
          replyTo = displayNumber;
          console.log(`📱 Número normal: ${replyTo}`);
        }

        // Extraer mensaje
        const messageContent = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.text || msg.text || '';
        
        if (!messageContent) continue;

        console.log(`\n📨 De: ${pushName} (${displayNumber})`);
        console.log(`📨 ReplyTo: ${replyTo}`);
        console.log(`📨 Mensaje: ${messageContent}`);

        // Buscar usuario
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        if (!user) {
          console.log('❌ Usuario no encontrado');
          continue;
        }

        if (!user.apiKeyConnected) {
          await evolutionService.sendTextMessage(instanceName, replyTo, '⚠️ El asistente no está configurado.');
          continue;
        }

        // Conversación
        let conversation = await prisma.conversation.findFirst({
          where: { userId: user.id, recipientId: displayNumber }
        });

        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: { userId: user.id, recipientId: displayNumber, recipientName: pushName || displayNumber, lastMessage: messageContent, lastMessageAt: new Date() }
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
          console.log(`📤 Enviando a: ${replyTo}`);
          const sendResult = await evolutionService.sendTextMessage(instanceName, replyTo, aiResponse.response);

          if (sendResult.success) {
            await prisma.message.create({
              data: { conversationId: conversation.id, userId: user.id, role: 'assistant', content: aiResponse.response, fromMe: true }
            });
            console.log('✅ ¡MENSAJE ENVIADO!');
          } else {
            console.error('❌ Error:', sendResult.error);
          }
        } else {
          await evolutionService.sendTextMessage(instanceName, replyTo, 'Lo siento, hubo un problema. Intenta de nuevo.');
        }
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('❌ Error webhook:', error);
    res.status(500).json({ error: 'Error' });
  }
});

router.get('/webhook', (req: Request, res: Response) => {
  res.send('Webhook activo');
});

export default router;

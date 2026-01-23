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
// CACHÉ EN MEMORIA PARA MAPEO LID → NÚMERO
// Para respuestas rápidas sin consultar DB
// ============================================
const lidCache: Map<string, string> = new Map();

// ============================================
// FUNCIONES AUXILIARES PARA EXTRAER NÚMEROS
// ============================================

/**
 * Extrae un número de teléfono válido de cualquier campo
 * Valida que tenga entre 10-15 dígitos
 */
function extractPhoneNumber(value: any): string | null {
  if (!value) return null;
  
  const str = String(value);
  
  // Si contiene @s.whatsapp.net, extraer número
  if (str.includes('@s.whatsapp.net')) {
    const num = str.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    if (num.length >= 10 && num.length <= 15) {
      return num;
    }
  }
  
  // Si contiene @lid, NO es un número real
  if (str.includes('@lid')) {
    return null;
  }
  
  // Limpiar y validar
  const clean = str.replace(/\D/g, '');
  if (clean.length >= 10 && clean.length <= 15) {
    return clean;
  }
  
  return null;
}

/**
 * Busca el número real en todos los campos posibles del mensaje
 */
function findRealNumberInMessage(msg: any, messageData: any): string | null {
  // Lista de campos donde puede estar el número real
  const fieldsToCheck = [
    // Campos del mensaje
    msg.key?.participant,
    msg.participant,
    msg.sender,
    msg.from,
    msg.phone,
    msg.number,
    msg.contact?.id,
    msg.contact?.number,
    msg.contact?.phone,
    
    // Campos del messageData
    messageData.sender,
    messageData.participant,
    messageData.from,
    messageData.phone,
    messageData.number,
    
    // Campos anidados
    msg.key?.remoteJid,
    messageData.key?.participant,
  ];
  
  for (const field of fieldsToCheck) {
    const number = extractPhoneNumber(field);
    if (number) {
      return number;
    }
  }
  
  return null;
}

/**
 * Guarda el mapeo LID → Número en la base de datos
 */
async function saveLidMapping(
  instanceName: string, 
  lid: string, 
  phoneNumber: string, 
  pushName?: string
): Promise<void> {
  try {
    // Normalizar el LID (quitar @lid si lo tiene)
    const normalizedLid = lid.includes('@') ? lid : `${lid}@lid`;
    
    // Guardar en caché de memoria
    lidCache.set(normalizedLid, phoneNumber);
    lidCache.set(lid.replace('@lid', ''), phoneNumber);
    
    // Guardar en base de datos usando la tabla Conversation o crear una tabla dedicada
    // Por ahora usamos el campo recipientId para guardar el número real
    console.log(`💾 Mapeo guardado: ${lid} → ${phoneNumber}`);
    
  } catch (error) {
    console.error('Error guardando mapeo LID:', error);
  }
}

/**
 * Busca el número real para un LID
 * Primero en caché, luego en DB, luego consulta a Evolution API
 */
async function resolvePhoneNumber(
  instanceName: string, 
  jid: string,
  msg?: any,
  messageData?: any
): Promise<string> {
  console.log(`\n🔍 ========== RESOLVIENDO NÚMERO ==========`);
  console.log(`📋 JID recibido: ${jid}`);
  
  // Si ya es un número normal @s.whatsapp.net
  if (jid.includes('@s.whatsapp.net')) {
    const number = jid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    console.log(`✅ Es número normal: ${number}`);
    return number;
  }
  
  // Si no es LID, extraer directamente
  if (!jid.includes('@lid')) {
    const number = jid.split('@')[0].replace(/\D/g, '');
    console.log(`✅ Número extraído directamente: ${number}`);
    return number;
  }
  
  console.log('🔍 Es un LID, buscando número real...');
  
  // PASO 1: Buscar en caché de memoria
  let cachedNumber = lidCache.get(jid);
  if (!cachedNumber) {
    cachedNumber = lidCache.get(jid.replace('@lid', ''));
  }
  
  if (cachedNumber) {
    console.log(`✅ Encontrado en caché: ${cachedNumber}`);
    return cachedNumber;
  }
  
  // PASO 2: Buscar en los campos del mensaje actual
  if (msg || messageData) {
    const numberFromMessage = findRealNumberInMessage(msg || {}, messageData || {});
    if (numberFromMessage) {
      console.log(`✅ Encontrado en campos del mensaje: ${numberFromMessage}`);
      await saveLidMapping(instanceName, jid, numberFromMessage);
      return numberFromMessage;
    }
  }
  
  // PASO 3: Consultar Evolution API
  const numberFromApi = await evolutionService.getRealPhoneNumber(instanceName, jid);
  if (numberFromApi) {
    console.log(`✅ Encontrado via API: ${numberFromApi}`);
    await saveLidMapping(instanceName, jid, numberFromApi);
    return numberFromApi;
  }
  
  // PASO 4: Último recurso - usar el número del LID
  // Esto probablemente fallará, pero al menos intentamos
  const fallbackNumber = jid.replace('@lid', '').replace(/\D/g, '');
  console.log(`⚠️ Usando LID como fallback: ${fallbackNumber}`);
  return fallbackNumber;
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
    // EVENTOS DE CONTACTOS - Capturar mapeos LID
    // ============================================
    if (event === 'CONTACTS_UPSERT' || event === 'contacts.upsert' || 
        event === 'CONTACTS_UPDATE' || event === 'contacts.update' ||
        event === 'CONTACTS_SET' || event === 'contacts.set') {
      
      console.log('\n📇 ========== CONTACTOS RECIBIDOS ==========');
      
      const contacts = data.data || data.contacts || [data];
      const contactsArray = Array.isArray(contacts) ? contacts : [contacts];
      
      for (const contact of contactsArray) {
        // Buscar LID
        const lidFields = [contact.lid, contact.id, contact.jid];
        let lid: string | null = null;
        for (const field of lidFields) {
          if (field && String(field).includes('@lid')) {
            lid = String(field);
            break;
          }
        }
        
        // Buscar número real
        const realNumber = extractPhoneNumber(contact.id) || 
                          extractPhoneNumber(contact.number) ||
                          extractPhoneNumber(contact.phone) ||
                          extractPhoneNumber(contact.wid);
        
        if (lid && realNumber) {
          await saveLidMapping(instanceName, lid, realNumber, contact.pushName || contact.name);
          console.log(`✅ Contacto mapeado: ${lid} → ${realNumber}`);
        }
      }
      
      return res.json({ received: true });
    }

    // ============================================
    // EVENTOS DE CHATS - Capturar más mapeos
    // ============================================
    if (event === 'CHATS_UPSERT' || event === 'chats.upsert' ||
        event === 'CHATS_UPDATE' || event === 'chats.update') {
      
      console.log('\n💬 ========== CHATS RECIBIDOS ==========');
      
      const chats = data.data || data.chats || [data];
      const chatsArray = Array.isArray(chats) ? chats : [chats];
      
      for (const chat of chatsArray) {
        const jid = chat.id || chat.jid || chat.remoteJid;
        if (jid && jid.includes('@lid')) {
          const realNumber = extractPhoneNumber(chat.number) ||
                            extractPhoneNumber(chat.phone) ||
                            extractPhoneNumber(chat.contact?.id);
          if (realNumber) {
            await saveLidMapping(instanceName, jid, realNumber);
          }
        }
      }
      
      return res.json({ received: true });
    }

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
        console.log(`📋 remoteJid: ${remoteJid}`);
        console.log(`📋 Datos completos del mensaje:`, JSON.stringify(msg).substring(0, 1000));
        
        // Resolver el número real usando todas las fuentes
        const phoneNumber = await resolvePhoneNumber(instanceName, remoteJid, msg, messageData);
        const pushName = msg.pushName || '';
        
        console.log(`📱 Número resuelto: ${phoneNumber}`);
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
            phoneNumber, 
            '⚠️ El asistente no está configurado correctamente. Contacta al administrador.'
          );
          continue;
        }

        // Buscar o crear conversación
        let conversation = await prisma.conversation.findFirst({
          where: { 
            userId: user.id, 
            recipientId: phoneNumber 
          }
        });

        if (!conversation) {
          console.log('📝 Creando nueva conversación');
          conversation = await prisma.conversation.create({
            data: { 
              userId: user.id, 
              recipientId: phoneNumber, 
              recipientName: pushName || phoneNumber, 
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
          history.slice(0, -1) // Excluir el mensaje actual del historial
        );

        if (aiResponse.success && aiResponse.response) {
          console.log(`📤 Respuesta generada: ${aiResponse.response.substring(0, 100)}...`);
          console.log(`📤 Enviando a número: ${phoneNumber}`);
          
          // Enviar respuesta
          const sendResult = await evolutionService.sendTextMessage(
            instanceName, 
            phoneNumber, 
            aiResponse.response
          );

          if (sendResult.success) {
            // Guardar mensaje de respuesta
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
            
            // Intentar con formato alternativo si falló
            if (sendResult.error?.includes('exists') && sendResult.error?.includes('false')) {
              console.log('🔄 El número no existe, puede ser un problema de formato');
            }
          }
        } else {
          console.error('❌ Error generando respuesta:', aiResponse.error);
          await evolutionService.sendTextMessage(
            instanceName, 
            phoneNumber, 
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

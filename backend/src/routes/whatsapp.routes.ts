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

    // Recargar usuario para obtener datos actualizados
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    if (!currentUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Si tiene instancia, verificar estado actual
    if (currentUser.evolutionInstanceName) {
      const status = await evolutionService.checkConnectionStatus(currentUser.evolutionInstanceName);
      
      // Si la instancia no existe, devolver estado desconectado
      if (status.instanceNotFound) {
        return res.json({
          connected: false,
          status: 'disconnected',
          phone: null,
          instanceName: null,
          qrCode: null,
          message: 'La instancia anterior fue eliminada. Por favor conecta de nuevo.'
        });
      }
      
      // Obtener usuario actualizado después de checkConnectionStatus
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
    console.error('Error obteniendo estado:', error);
    res.status(500).json({ error: 'Error al obtener estado' });
  }
});

// Iniciar conexión (crear instancia y obtener QR)
router.post('/connect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    console.log(`📱 Iniciando conexión WhatsApp para: ${user.email}`);

    // Recargar usuario para obtener datos actualizados
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    if (!currentUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Si ya tiene instancia, intentar reconectar
    if (currentUser.evolutionInstanceName) {
      // Verificar si ya está conectado
      const status = await evolutionService.checkConnectionStatus(currentUser.evolutionInstanceName);
      
      // Si la instancia no existe, crear una nueva
      if (status.instanceNotFound) {
        console.log(`📱 Instancia anterior no existe, creando nueva para: ${currentUser.email}`);
      } else if (status.connected) {
        return res.json({
          success: true,
          connected: true,
          status: 'connected',
          phone: status.phone,
          message: 'Ya estás conectado'
        });
      } else {
        // Obtener nuevo QR
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

        // Si no pudo obtener QR y la instancia no fue encontrada, continuar a crear nueva
        if (!qrResult.instanceNotFound) {
          // Si la instancia existe pero no pudo obtener QR, eliminarla
          await evolutionService.deleteInstance(currentUser.evolutionInstanceName);
        }
      }
    }

    // Crear nueva instancia
    const result = await evolutionService.createInstance(currentUser.id);
    
    if (!result.success) {
      return res.status(500).json({ 
        error: result.error || 'Error al crear conexión' 
      });
    }

    // Configurar webhook
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
    console.error('Error conectando:', error);
    res.status(500).json({ error: 'Error al conectar WhatsApp' });
  }
});

// Obtener QR Code actualizado
router.get('/qr', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    // Recargar usuario para obtener datos actualizados
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    if (!currentUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (!currentUser.evolutionInstanceName) {
      // No hay instancia, crear una nueva automáticamente
      console.log(`📱 No hay instancia, creando una nueva para: ${currentUser.email}`);
      
      const result = await evolutionService.createInstance(currentUser.id);
      
      if (!result.success) {
        return res.status(500).json({ error: result.error || 'Error al crear instancia' });
      }

      // Configurar webhook
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

    // Primero verificar si ya está conectado
    const status = await evolutionService.checkConnectionStatus(currentUser.evolutionInstanceName);
    
    if (status.connected) {
      return res.json({
        connected: true,
        status: 'connected',
        phone: status.phone,
        qrCode: null
      });
    }

    // Obtener nuevo QR
    const result = await evolutionService.getQRCode(currentUser.evolutionInstanceName);

    // Si la instancia no existe, crear una nueva
    if (result.instanceNotFound) {
      console.log(`📱 Instancia no encontrada, creando nueva para: ${currentUser.email}`);
      
      const newInstance = await evolutionService.createInstance(currentUser.id);
      
      if (!newInstance.success) {
        return res.status(500).json({ error: newInstance.error || 'Error al crear instancia' });
      }

      // Configurar webhook
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
    console.error('Error obteniendo QR:', error);
    res.status(500).json({ error: 'Error al obtener QR' });
  }
});

// Desconectar WhatsApp
router.post('/disconnect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    if (!user.evolutionInstanceName) {
      return res.json({ success: true, message: 'No hay conexión activa' });
    }

    console.log(`🔌 Desconectando WhatsApp para: ${user.email}`);

    await evolutionService.disconnectInstance(user.evolutionInstanceName);

    res.json({ success: true, message: 'WhatsApp desconectado' });
  } catch (error: any) {
    console.error('Error desconectando:', error);
    res.status(500).json({ error: 'Error al desconectar' });
  }
});

// Eliminar instancia completamente
router.delete('/instance', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    if (!user.evolutionInstanceName) {
      return res.json({ success: true, message: 'No hay instancia' });
    }

    console.log(`🗑️ Eliminando instancia para: ${user.email}`);

    await evolutionService.deleteInstance(user.evolutionInstanceName);

    res.json({ success: true, message: 'Instancia eliminada' });
  } catch (error: any) {
    console.error('Error eliminando instancia:', error);
    res.status(500).json({ error: 'Error al eliminar instancia' });
  }
});

// Enviar mensaje de prueba
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

    const result = await evolutionService.sendTextMessage(
      user.evolutionInstanceName,
      to,
      message
    );

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    console.error('Error enviando mensaje:', error);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

// Webhook para recibir mensajes de Evolution API
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    
    console.log('📨 Webhook recibido:', JSON.stringify(data).substring(0, 500));

    // Evolution API envía diferentes tipos de eventos
    const event = data.event || data.type;
    const instanceName = data.instance || data.instanceName;

    // Evento de actualización de conexión
    if (event === 'CONNECTION_UPDATE' || event === 'connection.update') {
      const state = data.data?.state || data.state;
      console.log(`📱 Estado de conexión ${instanceName}: ${state}`);
      
      if (instanceName) {
        const user = await prisma.user.findFirst({
          where: { evolutionInstanceName: instanceName }
        });
        
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

    // Evento de QR actualizado
    if (event === 'QRCODE_UPDATED' || event === 'qrcode.updated') {
      const qrcode = data.data?.qrcode?.base64 || data.qrcode?.base64 || data.data?.base64;
      console.log(`📷 QR actualizado para ${instanceName}`);
      
      if (instanceName && qrcode) {
        const user = await prisma.user.findFirst({
          where: { evolutionInstanceName: instanceName }
        });
        
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { whatsappQrCode: qrcode }
          });
        }
      }
      
      return res.json({ received: true });
    }

    // Evento de mensaje recibido
    if (event === 'MESSAGES_UPSERT' || event === 'messages.upsert') {
      const messageData = data.data || data;
      const messages = messageData.messages || [messageData];
      
      for (const msg of messages) {
        // Ignorar mensajes propios
        if (msg.key?.fromMe) continue;
        
        const remoteJid = msg.key?.remoteJid || msg.from;
        if (!remoteJid) continue;

        // Determinar si es un número LID (WhatsApp Business interno)
        const isLid = remoteJid.includes('@lid');
        const isGroup = remoteJid.includes('@g.us');
        
        // Para responder, necesitamos mantener el formato correcto
        let replyTo: string;      // ID para enviar respuesta
        let displayNumber: string; // Número para mostrar en UI
        
        if (isLid) {
          // Para LID, mantener el remoteJid completo para responder
          replyTo = remoteJid;
          displayNumber = remoteJid.replace('@lid', '');
          console.log(`📱 Mensaje de número LID: ${remoteJid}`);
        } else if (isGroup) {
          // Para grupos, no responder automáticamente (por ahora)
          console.log(`📱 Mensaje de grupo ignorado: ${remoteJid}`);
          continue;
        } else {
          // Formato normal @s.whatsapp.net - extraer número limpio
          replyTo = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
          displayNumber = replyTo;
        }
        
        // Extraer contenido del mensaje
        const messageContent = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.text ||
                              msg.text ||
                              '';
        
        if (!messageContent) continue;

        console.log(`📨 Mensaje de ${displayNumber}: ${messageContent}`);
        console.log(`📨 ReplyTo: ${replyTo}`);

        // Buscar usuario por instancia
        const user = await prisma.user.findFirst({
          where: { evolutionInstanceName: instanceName }
        });

        if (!user) {
          console.log(`❌ Usuario no encontrado para instancia: ${instanceName}`);
          continue;
        }

        if (!user.apiKeyConnected) {
          console.log(`❌ Usuario ${user.email} no tiene API Key configurada`);
          // Enviar mensaje de error
          await evolutionService.sendTextMessage(
            instanceName,
            replyTo,
            '⚠️ El asistente no está configurado correctamente. Por favor contacta al administrador.'
          );
          continue;
        }

        // Buscar o crear conversación (usar displayNumber para UI, replyTo para envío)
        let conversation = await prisma.conversation.findFirst({
          where: {
            userId: user.id,
            recipientId: displayNumber // Usar número limpio para buscar
          }
        });

        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: {
              userId: user.id,
              recipientId: displayNumber, // Número limpio para mostrar
              recipientName: msg.pushName || displayNumber,
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
              recipientName: msg.pushName || conversation.recipientName
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

        // Obtener historial reciente
        const recentMessages = await prisma.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { timestamp: 'asc' },
          take: 20
        });

        const history = recentMessages.map(m => ({
          role: m.role,
          content: m.content
        }));

        // Generar respuesta con OpenAI
        const aiResponse = await openaiService.generateResponse(
          user.id,
          messageContent,
          history.slice(0, -1) // Excluir el mensaje actual
        );

        if (aiResponse.success && aiResponse.response) {
          // Enviar respuesta usando replyTo (que tiene el formato correcto para LID o número normal)
          const sendResult = await evolutionService.sendTextMessage(
            instanceName,
            replyTo,
            aiResponse.response
          );

          if (sendResult.success) {
            // Guardar respuesta del bot
            await prisma.message.create({
              data: {
                conversationId: conversation.id,
                userId: user.id,
                role: 'assistant',
                content: aiResponse.response,
                fromMe: true
              }
            });

            console.log(`✅ Respuesta enviada a ${displayNumber}`);
          } else {
            console.error(`❌ Error enviando respuesta: ${sendResult.error}`);
          }
        } else {
          console.error('❌ Error generando respuesta:', aiResponse.error);
          
          // Enviar mensaje de error amigable
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

// Webhook GET para verificación
router.get('/webhook', (req: Request, res: Response) => {
  console.log('🔍 Verificación de webhook');
  res.send('Webhook activo');
});

export default router;

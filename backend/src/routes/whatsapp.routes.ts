import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// ==========================================
// CONFIGURACIÓN WAHA
// ==========================================
const WAHA_API_URL = process.env.WAHA_API_URL || 'http://31.97.142.127:8080';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';

const getWahaHeaders = () => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;
  return headers;
};

const getSessionName = (userId: string) => 'default';

// ==========================================
// Obtener userId del dueño de la sesión default
// ==========================================
const getDefaultUserId = async (): Promise<string | null> => {
  // Buscar el usuario que tiene API Key configurada (dueño principal)
  const user = await prisma.user.findFirst({
    where: { apiKeyConnected: true },
    select: { id: true }
  });
  if (user) return user.id;

  // Si no hay usuario con API Key, buscar el primer usuario
  const firstUser = await prisma.user.findFirst({
    select: { id: true },
    orderBy: { createdAt: 'asc' }
  });
  return firstUser?.id || null;
};

// ==========================================
// Generar respuesta con OpenAI
// ==========================================
const generateAIResponse = async (userId: string, message: string, conversationId: string): Promise<string | null> => {
  try {
    // Obtener API Key del usuario
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { apiKey: true, apiKeyConnected: true }
    });

    if (!user?.apiKey || !user.apiKeyConnected) {
      console.log('⚠️ Usuario sin API Key de OpenAI');
      return null;
    }

    // Obtener el asistente activo
    const assistant = await prisma.assistant.findFirst({
      where: { userId, isActive: true }
    });

    if (!assistant) {
      console.log('⚠️ No hay asistente activo');
      return null;
    }

    // Obtener historial de la conversación (últimos 10 mensajes)
    const history = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'desc' },
      take: 10
    });

    // Construir el prompt del sistema
    const systemParts: string[] = [];
    
    if (assistant.name) systemParts.push(`Eres ${assistant.name}.`);
    if (assistant.personality) systemParts.push(assistant.personality);
    if (assistant.context) systemParts.push(assistant.context);
    if (assistant.businessInfo) systemParts.push(`Información del negocio: ${assistant.businessInfo}`);
    if (assistant.instructions) systemParts.push(`Instrucciones: ${assistant.instructions}`);

    // Agregar conocimiento
    const knowledge = assistant.knowledgeItems as any[];
    if (knowledge && knowledge.length > 0) {
      const knowledgeText = knowledge.map((item: any) => {
        if (typeof item === 'string') return item;
        return `${item.title || ''}: ${item.content || item.text || ''}`;
      }).join('\n');
      systemParts.push(`Base de conocimiento:\n${knowledgeText}`);
    }

    const systemPrompt = systemParts.join('\n\n') || 'Eres un asistente virtual amable y útil. Responde de forma concisa y profesional.';

    // Construir mensajes para OpenAI
    const messages: any[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Agregar historial (en orden cronológico)
    const reversedHistory = history.reverse();
    for (const msg of reversedHistory) {
      messages.push({
        role: msg.fromMe ? 'assistant' : 'user',
        content: msg.content
      });
    }

    // Agregar el mensaje actual
    messages.push({ role: 'user', content: message });

    console.log(`🤖 Llamando a OpenAI (modelo: ${assistant.model || 'gpt-4-turbo-preview'})...`);

    // Llamar a OpenAI
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user.apiKey}`
      },
      body: JSON.stringify({
        model: assistant.model || 'gpt-4-turbo-preview',
        messages,
        temperature: assistant.temperature || 0.7,
        max_tokens: assistant.maxTokens || 500
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Error OpenAI:', response.status, errorText);
      return null;
    }

    const data = await response.json() as any;
    const aiResponse = data.choices?.[0]?.message?.content;

    if (aiResponse) {
      console.log(`✅ Respuesta IA generada (${aiResponse.length} chars)`);
    }

    return aiResponse || null;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error('❌ Timeout llamando a OpenAI');
    } else {
      console.error('❌ Error generando respuesta IA:', error.message);
    }
    return null;
  }
};

// ==========================================
// Enviar mensaje por WAHA
// ==========================================
const sendWahaMessage = async (chatId: string, text: string): Promise<boolean> => {
  try {
    const response = await fetch(`${WAHA_API_URL}/api/sendText`, {
      method: 'POST',
      headers: getWahaHeaders(),
      body: JSON.stringify({
        session: 'default',
        chatId,
        text
      })
    });
    return response.ok;
  } catch (error) {
    console.error('❌ Error enviando por WAHA:', error);
    return false;
  }
};

// ==========================================
// GET /api/whatsapp/status
// ==========================================
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    try {
      const response = await fetch(`${WAHA_API_URL}/api/sessions/default`, {
        headers: getWahaHeaders()
      });

      if (response.status === 404) {
        res.json({ connected: false, status: 'disconnected', phone: null, hasQR: false });
        return;
      }

      const data = await response.json() as any;
      const isConnected = data.status === 'WORKING' || data.status === 'CONNECTED';
      const hasQR = data.status === 'SCAN_QR_CODE' || data.status === 'STARTING';

      res.json({
        connected: isConnected,
        status: data.status?.toLowerCase() || 'disconnected',
        phone: data.me?.id?.replace('@c.us', '') || null,
        name: data.me?.pushName || null,
        hasQR: hasQR
      });
    } catch (fetchError) {
      res.json({ connected: false, status: 'error', phone: null, hasQR: false });
    }
  } catch (error) {
    res.json({ connected: false, status: 'error', phone: null, hasQR: false });
  }
});

// ==========================================
// POST /api/whatsapp/connect
// ==========================================
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    console.log(`🔌 Usuario ${userId} conectando sesión default`);

    const checkResponse = await fetch(`${WAHA_API_URL}/api/sessions/default`, {
      headers: getWahaHeaders()
    });

    if (checkResponse.status === 404) {
      const webhookUrl = `https://elisa-iaagentes-production.up.railway.app/api/webhook/whatsapp`;
      
      await fetch(`${WAHA_API_URL}/api/sessions`, {
        method: 'POST',
        headers: getWahaHeaders(),
        body: JSON.stringify({
          name: 'default',
          config: {
            webhooks: [{ url: webhookUrl, events: ['message', 'session.status'] }]
          }
        })
      });

      console.log('✅ Sesión default creada');
      res.json({ success: true, message: 'Sesión iniciada' });
    } else {
      const sessionData = await checkResponse.json() as any;
      
      if (sessionData.status === 'STOPPED' || sessionData.status === 'FAILED') {
        await fetch(`${WAHA_API_URL}/api/sessions/default/start`, {
          method: 'POST',
          headers: getWahaHeaders()
        });
      }
      
      res.json({ success: true, message: 'Sesión activada' });
    }
  } catch (error: any) {
    console.error('Error conectando:', error);
    res.status(500).json({ success: false, message: error.message || 'Error al conectar' });
  }
});

// ==========================================
// GET /api/whatsapp/qr
// ==========================================
router.get('/qr', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    try {
      const response = await fetch(`${WAHA_API_URL}/api/sessions/default/auth/qr`, {
        headers: { ...getWahaHeaders(), 'Accept': 'application/json' }
      });

      if (!response.ok) {
        res.json({ qr: null, available: false });
        return;
      }

      const data = await response.json() as any;
      
      if (data.value) {
        res.json({ 
          qr: data.value.startsWith('data:') ? data.value : `data:image/png;base64,${data.value}`, 
          available: true 
        });
      } else if (data.mimetype && data.data) {
        res.json({ qr: `data:${data.mimetype};base64,${data.data}`, available: true });
      } else {
        res.json({ qr: null, available: false });
      }
    } catch (fetchError) {
      res.json({ qr: null, available: false });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener QR', qr: null, available: false });
  }
});

// ==========================================
// POST /api/whatsapp/disconnect
// ==========================================
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    await fetch(`${WAHA_API_URL}/api/sessions/default/stop`, {
      method: 'POST',
      headers: getWahaHeaders()
    });

    console.log(`🔴 Usuario ${userId} desconectado`);
    res.json({ success: true, message: 'Desconectado' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Error' });
  }
});

// ==========================================
// POST /api/whatsapp/send
// ==========================================
router.post('/send', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { to, message } = req.body;

    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    if (!to || !message) { res.status(400).json({ error: 'Faltan datos' }); return; }

    const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@c.us`;

    const response = await fetch(`${WAHA_API_URL}/api/sendText`, {
      method: 'POST',
      headers: getWahaHeaders(),
      body: JSON.stringify({ session: 'default', chatId, text: message })
    });

    const result = await response.json() as any;

    if (response.ok) {
      const recipientId = to.replace(/\D/g, '');
      
      let conversation = await prisma.conversation.findFirst({
        where: { userId, recipientId }
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: { userId, recipientId, lastMessage: message, stage: 'new' }
        });
      }

      await prisma.message.create({
        data: { conversationId: conversation.id, content: message, fromMe: true }
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessage: message }
      });

      res.json({ success: true, messageId: result.id });
    } else {
      res.json({ success: false, message: result.message || 'Error' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Error' });
  }
});

// ==========================================
// POST /api/whatsapp/webhook - WAHA envía aquí
// ==========================================
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const { event, session, payload } = req.body;

    // Log resumido
    console.log(`📩 Webhook: event=${event}, session=${session}, from=${payload?.from}, hasBody=${!!payload?.body}`);

    // Solo procesar mensajes
    if (!event || (event !== 'message' && event !== 'message.any')) {
      res.json({ success: true, ignored: true });
      return;
    }

    // Ignorar mensajes propios
    if (payload?.fromMe) {
      res.json({ success: true, ignored: true });
      return;
    }

    // Obtener userId del dueño de la sesión
    const userId = await getDefaultUserId();
    
    if (!userId) {
      console.log('⚠️ No hay usuario registrado');
      res.status(400).json({ error: 'No hay usuario configurado' });
      return;
    }

    // Datos del mensaje
    const from = payload?.from || payload?.chatId || '';
    const body = payload?.body || payload?.text || payload?.content || '';
    const notifyName = payload?.notifyName || payload?.pushName || payload?._data?.notifyName || '';
    const messageType = payload?.type || 'chat';

    if (!from || !body) {
      res.json({ success: true, ignored: true });
      return;
    }

    // Ignorar mensajes de grupos (solo procesar chats individuales)
    if (from.includes('@g.us')) {
      res.json({ success: true, ignored: true, reason: 'group message' });
      return;
    }

    const recipientId = from.replace('@c.us', '').replace('@s.whatsapp.net', '');
    const senderName = notifyName || recipientId;

    console.log(`💬 Mensaje de ${senderName} (${recipientId}): ${body.substring(0, 50)}...`);

    // Buscar o crear conversación
    let conversation = await prisma.conversation.findFirst({
      where: { userId, recipientId }
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { userId, recipientId, recipientName: senderName, lastMessage: body, stage: 'new' }
      });
    }

    // Guardar mensaje recibido
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        content: body,
        fromMe: false,
        mediaType: messageType !== 'chat' ? messageType : null
      }
    });

    // Actualizar conversación
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessage: body, recipientName: senderName }
    });

    console.log(`💾 Mensaje guardado en conversación ${conversation.id}`);

    // ==========================================
    // RESPUESTA AUTOMÁTICA CON IA
    // ==========================================
    if (!conversation.aiPaused) {
      const aiResponse = await generateAIResponse(userId, body, conversation.id);

      if (aiResponse) {
        // Enviar respuesta por WhatsApp
        const sent = await sendWahaMessage(from, aiResponse);

        if (sent) {
          // Guardar respuesta de IA en la BD
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              content: aiResponse,
              fromMe: true
            }
          });

          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessage: aiResponse }
          });

          console.log(`🤖 Respuesta IA enviada a ${senderName}`);
        } else {
          console.log('❌ No se pudo enviar la respuesta IA por WAHA');
        }
      }
    } else {
      console.log(`⏸️ IA pausada para conversación ${conversation.id}`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error webhook:', error);
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

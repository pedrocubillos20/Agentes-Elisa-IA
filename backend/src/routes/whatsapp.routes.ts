import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

const WAHA_API_URL = process.env.WAHA_API_URL || 'http://31.97.142.127:8080';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
const BACKEND_URL = process.env.BACKEND_URL || 'https://elisa-iaagentes-production.up.railway.app';

const getWahaHeaders = () => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;
  return headers;
};

// =====================================================
// MULTI-TENANT: Cada usuario tiene su propia sesión WAHA
// Nombre de sesión = "user_{userId}"
// El webhook identifica al usuario por el campo "session"
// =====================================================

const getUserSessionName = (userId: string): string => `user_${userId}`;

const getUserIdFromSession = (sessionName: string): string | null => {
  if (sessionName.startsWith('user_')) {
    return sessionName.replace('user_', '');
  }
  // Compatibilidad con sesión "default" legacy
  return null;
};

// ===== RESOLVER USUARIO DESDE WEBHOOK =====
const resolveUserFromWebhook = async (sessionName: string, recipientId: string): Promise<string | null> => {
  // 1. Extraer userId del nombre de sesión (user_{userId})
  const userIdFromSession = getUserIdFromSession(sessionName);
  if (userIdFromSession) {
    const user = await prisma.user.findUnique({ where: { id: userIdFromSession }, select: { id: true } });
    if (user) {
      console.log(`👤 Usuario identificado por sesión: ${userIdFromSession}`);
      return user.id;
    }
  }

  // 2. Buscar por número de teléfono conectado
  const userByPhone = await prisma.user.findFirst({
    where: {
      phone: { contains: recipientId.slice(-10) }
    },
    select: { id: true, email: true }
  });
  if (userByPhone) {
    console.log(`👤 Usuario identificado por teléfono: ${userByPhone.email}`);
    return userByPhone.id;
  }

  // 3. Buscar por conversación existente
  const existingConv = await prisma.conversation.findFirst({
    where: { recipientId },
    select: { userId: true }
  });
  if (existingConv) {
    console.log(`👤 Usuario identificado por conversación existente`);
    return existingConv.userId;
  }

  // 4. Fallback legacy: si la sesión es "default", buscar usuario con API key
  if (sessionName === 'default') {
    const defaultUser = await prisma.user.findFirst({
      where: { apiKeyConnected: true },
      select: { id: true, email: true }
    });
    if (defaultUser) {
      console.log(`👤 Usuario fallback (sesión default): ${defaultUser.email}`);
      return defaultUser.id;
    }
  }

  return null;
};

// ===== GENERAR RESPUESTA IA =====
const generateAIResponse = async (userId: string, message: string, conversationId: string): Promise<string | null> => {
  try {
    // 1. API Key del usuario
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { apiKey: true, apiKeyConnected: true, email: true }
    });

    if (!user?.apiKey || !user.apiKeyConnected) {
      console.log(`⚠️ Usuario ${user?.email} sin API Key de OpenAI`);
      return null;
    }

    // 2. Asistente activo DEL usuario
    let assistant = await prisma.assistant.findFirst({
      where: { userId, isActive: true },
      orderBy: { updatedAt: 'desc' }
    });

    if (!assistant) {
      assistant = await prisma.assistant.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' }
      });
      if (assistant) {
        await prisma.assistant.update({ where: { id: assistant.id }, data: { isActive: true } });
        console.log(`✅ Asistente "${assistant.name}" auto-activado`);
      } else {
        console.log(`❌ Usuario ${user.email} sin asistente configurado`);
        return null;
      }
    }

    console.log(`📋 Asistente: "${assistant.name}" (context: ${assistant.context?.length || 0} chars)`);

    // 3. Historial de conversación
    const history = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'desc' },
      take: 15
    });

    // 4. System prompt completo
    const systemParts: string[] = [];
    if (assistant.name) systemParts.push(`Eres ${assistant.name}.`);
    if (assistant.personality?.trim()) systemParts.push(assistant.personality);
    if (assistant.context?.trim()) systemParts.push(assistant.context);
    if (assistant.businessInfo?.trim()) systemParts.push(`Información del negocio: ${assistant.businessInfo}`);
    if (assistant.instructions?.trim()) systemParts.push(`Instrucciones: ${assistant.instructions}`);

    // Knowledge Items
    const knowledge = assistant.knowledgeItems as any;
    if (knowledge) {
      let knowledgeText = '';
      if (typeof knowledge === 'string') {
        try {
          const parsed = JSON.parse(knowledge);
          if (Array.isArray(parsed) && parsed.length > 0) {
            knowledgeText = parsed.map((item: any) => typeof item === 'string' ? item : `${item.title || ''}: ${item.content || item.text || ''}`).filter(Boolean).join('\n');
          }
        } catch {
          if (knowledge.trim() && knowledge !== '[]') knowledgeText = knowledge;
        }
      } else if (Array.isArray(knowledge) && knowledge.length > 0) {
        knowledgeText = knowledge.map((item: any) => typeof item === 'string' ? item : `${item.title || ''}: ${item.content || item.text || ''}`).filter(Boolean).join('\n');
      }
      if (knowledgeText) systemParts.push(`Base de conocimiento adicional:\n${knowledgeText}`);
    }

    const systemPrompt = systemParts.length > 0
      ? systemParts.join('\n\n')
      : 'Eres un asistente virtual amable. Responde conciso y profesional.';

    console.log(`🧠 System prompt: ${systemPrompt.length} chars (${Math.ceil(systemPrompt.length / 4)} tokens aprox.)`);

    // 5. Mensajes para OpenAI
    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    const reversed = [...history].reverse();
    for (const msg of reversed) {
      messages.push({ role: msg.fromMe ? 'assistant' : 'user', content: msg.content });
    }
    messages.push({ role: 'user', content: message });

    console.log(`🤖 Llamando a OpenAI (modelo: ${assistant.model || 'gpt-4-turbo-preview'}, ${messages.length} mensajes)...`);

    // 6. Llamar a OpenAI con la API Key DEL USUARIO
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.apiKey}` },
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
      console.error(`❌ Error OpenAI (${response.status}):`, errorText);
      return null;
    }

    const data = await response.json() as any;
    const aiResponse = data.choices?.[0]?.message?.content;
    if (aiResponse) console.log(`✅ Respuesta IA generada (${aiResponse.length} chars): ${aiResponse.substring(0, 100)}...`);
    return aiResponse || null;
  } catch (error: any) {
    if (error.name === 'AbortError') console.error('❌ Timeout OpenAI (30s)');
    else console.error('❌ Error IA:', error.message);
    return null;
  }
};

// ===== ENVIAR MENSAJE POR WAHA =====
const sendWahaMessage = async (sessionName: string, chatId: string, text: string): Promise<boolean> => {
  try {
    const response = await fetch(`${WAHA_API_URL}/api/sendText`, {
      method: 'POST',
      headers: getWahaHeaders(),
      body: JSON.stringify({ session: sessionName, chatId, text })
    });
    return response.ok;
  } catch (error) {
    console.error('❌ Error enviando WAHA:', error);
    return false;
  }
};

// =====================================================
// RUTAS AUTENTICADAS (cada usuario accede a SU sesión)
// =====================================================

// STATUS - Estado de la sesión WAHA del usuario
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const sessionName = getUserSessionName(userId);

    try {
      const response = await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}`, { headers: getWahaHeaders() });

      if (response.status === 404) {
        // También verificar sesión "default" para migración
        const defaultRes = await fetch(`${WAHA_API_URL}/api/sessions/default`, { headers: getWahaHeaders() });
        if (defaultRes.ok) {
          const defaultData = await defaultRes.json() as any;
          if (defaultData.status === 'WORKING' || defaultData.status === 'CONNECTED') {
            // Hay una sesión default activa - informar al usuario
            res.json({
              connected: true,
              status: defaultData.status?.toLowerCase(),
              phone: defaultData.me?.id?.replace('@c.us', '') || null,
              name: defaultData.me?.pushName || null,
              hasQR: false,
              legacy: true // Indicar que es sesión legacy
            });
            return;
          }
        }
        res.json({ connected: false, status: 'disconnected', phone: null, hasQR: false });
        return;
      }

      const data = await response.json() as any;
      const isConnected = data.status === 'WORKING' || data.status === 'CONNECTED';

      // Guardar número de teléfono del usuario cuando se conecta
      if (isConnected && data.me?.id) {
        const phone = data.me.id.replace('@c.us', '');
        await prisma.user.update({
          where: { id: userId },
          data: { phone }
        }).catch(() => {}); // Silencioso si falla
      }

      res.json({
        connected: isConnected,
        status: data.status?.toLowerCase() || 'disconnected',
        phone: data.me?.id?.replace('@c.us', '') || null,
        name: data.me?.pushName || null,
        hasQR: data.status === 'SCAN_QR_CODE' || data.status === 'STARTING'
      });
    } catch {
      res.json({ connected: false, status: 'error', phone: null, hasQR: false });
    }
  } catch {
    res.json({ connected: false, status: 'error', phone: null, hasQR: false });
  }
});

// CONNECT - Crear sesión WAHA propia del usuario
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const sessionName = getUserSessionName(userId);
    const webhookUrl = `${BACKEND_URL}/api/webhook/whatsapp`;

    console.log(`📱 Conectando WhatsApp para usuario ${userId} (sesión: ${sessionName})`);

    // Verificar si ya existe la sesión
    const checkResponse = await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}`, { headers: getWahaHeaders() });

    if (checkResponse.status === 404) {
      // Crear nueva sesión para este usuario
      const createRes = await fetch(`${WAHA_API_URL}/api/sessions`, {
        method: 'POST',
        headers: getWahaHeaders(),
        body: JSON.stringify({
          name: sessionName,
          config: {
            webhooks: [{
              url: webhookUrl,
              events: ['message', 'message.any', 'session.status']
            }]
          }
        })
      });

      if (createRes.ok) {
        console.log(`✅ Sesión ${sessionName} creada`);
        res.json({ success: true, message: 'Sesión creada. Escanea el código QR.' });
      } else {
        const error = await createRes.text();
        console.error(`❌ Error creando sesión: ${error}`);
        res.status(500).json({ success: false, message: 'Error creando sesión' });
      }
    } else {
      // La sesión ya existe
      const sessionData = await checkResponse.json() as any;

      if (sessionData.status === 'STOPPED' || sessionData.status === 'FAILED') {
        // Reiniciar sesión
        await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}/start`, {
          method: 'POST',
          headers: getWahaHeaders()
        });
        console.log(`🔄 Sesión ${sessionName} reiniciada`);
      }

      res.json({ success: true, message: 'Sesión activada' });
    }
  } catch (error: any) {
    console.error('❌ Error connect:', error.message);
    res.status(500).json({ success: false, message: error.message || 'Error' });
  }
});

// QR - Obtener QR de la sesión del usuario
router.get('/qr', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const sessionName = getUserSessionName(userId);

    try {
      const response = await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}/auth/qr`, {
        headers: { ...getWahaHeaders(), 'Accept': 'application/json' }
      });

      if (!response.ok) { res.json({ qr: null, available: false }); return; }

      const data = await response.json() as any;
      if (data.value) {
        res.json({ qr: data.value.startsWith('data:') ? data.value : `data:image/png;base64,${data.value}`, available: true });
      } else if (data.mimetype && data.data) {
        res.json({ qr: `data:${data.mimetype};base64,${data.data}`, available: true });
      } else {
        res.json({ qr: null, available: false });
      }
    } catch {
      res.json({ qr: null, available: false });
    }
  } catch {
    res.status(500).json({ error: 'Error QR', qr: null, available: false });
  }
});

// DISCONNECT - Desconectar la sesión del usuario
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const sessionName = getUserSessionName(userId);

    await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}/stop`, {
      method: 'POST',
      headers: getWahaHeaders()
    });

    // Limpiar número de teléfono
    await prisma.user.update({
      where: { id: userId },
      data: { phone: null }
    }).catch(() => {});

    console.log(`📴 Sesión ${sessionName} desconectada`);
    res.json({ success: true, message: 'Desconectado' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Error' });
  }
});

// SEND - Enviar mensaje desde la sesión del usuario
router.post('/send', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { to, message } = req.body;

    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    if (!to || !message) { res.status(400).json({ error: 'Faltan datos' }); return; }

    const sessionName = getUserSessionName(userId);
    const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@c.us`;

    const response = await fetch(`${WAHA_API_URL}/api/sendText`, {
      method: 'POST',
      headers: getWahaHeaders(),
      body: JSON.stringify({ session: sessionName, chatId, text: message })
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
        data: { conversationId: conversation.id, content: message, fromMe: true, userId, role: 'assistant' }
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessage: message }
      });

      res.json({ success: true, messageId: result.id });
    } else {
      res.json({ success: false, message: result.message || 'Error enviando' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Error' });
  }
});

// DEBUG - Información del usuario y su asistente
router.get('/debug', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const sessionName = getUserSessionName(userId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true, apiKey: true, apiKeyConnected: true }
    });

    const assistants = await prisma.assistant.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' }
    });

    const active = assistants.find(a => a.isActive);

    // Estado de WAHA
    let wahaStatus = 'unknown';
    try {
      const wahaRes = await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}`, { headers: getWahaHeaders() });
      if (wahaRes.ok) {
        const wahaData = await wahaRes.json() as any;
        wahaStatus = wahaData.status;
      } else {
        wahaStatus = 'no_session';
      }
    } catch { wahaStatus = 'error'; }

    res.json({
      user: {
        id: user?.id,
        email: user?.email,
        phone: user?.phone,
        hasApiKey: !!user?.apiKey,
        apiKeyConnected: user?.apiKeyConnected
      },
      wahaSession: {
        name: sessionName,
        status: wahaStatus
      },
      assistant: active ? {
        id: active.id,
        name: active.name,
        isActive: active.isActive,
        contextLength: active.context?.length || 0,
        contextPreview: active.context?.substring(0, 300) || 'VACÍO',
        model: active.model
      } : 'NINGUNO ACTIVO',
      totalAssistants: assistants.length,
      conversations: await prisma.conversation.count({ where: { userId } })
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// WEBHOOK PÚBLICO - Recibe TODOS los mensajes de WAHA
// Identifica al usuario por el campo "session" del payload
// =====================================================
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const { event, session, payload } = req.body;

    console.log(`📩 Webhook recibido: event=${event}, session=${session || 'unknown'}`);

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

    const from = payload?.from || payload?.chatId || '';
    const body = payload?.body || payload?.text || payload?.content || '';
    const notifyName = payload?.notifyName || payload?.pushName || payload?._data?.notifyName || '';

    if (!from || !body) {
      res.json({ success: true, ignored: true });
      return;
    }

    // Ignorar grupos
    if (from.includes('@g.us')) {
      res.json({ success: true, ignored: true, reason: 'group' });
      return;
    }

    const recipientId = from.replace('@c.us', '').replace('@s.whatsapp.net', '');
    const senderName = notifyName || recipientId;
    const sessionName = session || 'default';

    // ===== MULTI-TENANT: Identificar usuario por sesión =====
    const userId = await resolveUserFromWebhook(sessionName, recipientId);

    if (!userId) {
      console.log(`❌ No se pudo identificar usuario para sesión "${sessionName}"`);
      res.status(400).json({ error: 'Usuario no identificado' });
      return;
    }

    console.log(`💬 Mensaje de ${senderName} (${recipientId}) → sesión: ${sessionName}`);
    console.log(`   Usuario: ${userId} | Mensaje: ${body.substring(0, 80)}...`);

    // Buscar o crear conversación para ESTE usuario
    let conversation = await prisma.conversation.findFirst({
      where: { userId, recipientId }
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          userId,
          recipientId,
          recipientName: senderName,
          lastMessage: body,
          stage: 'new'
        }
      });
      console.log(`📝 Nueva conversación creada`);
    }

    // Comandos especiales: ".." pausa IA, "." reactiva IA
    if (body.trim() === '..') {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { aiPaused: true }
      });
      console.log(`⏸️ IA pausada para ${senderName}`);
      res.json({ success: true, action: 'ai_paused' });
      return;
    }

    if (body.trim() === '.' && conversation.aiPaused) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { aiPaused: false }
      });
      console.log(`▶️ IA reactivada para ${senderName}`);
      res.json({ success: true, action: 'ai_resumed' });
      return;
    }

    // Guardar mensaje recibido
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        content: body,
        fromMe: false,
        userId,
        role: 'user'
      }
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessage: body, recipientName: senderName }
    });

    console.log(`💾 Mensaje guardado en conversación ${conversation.id}`);

    // Generar respuesta IA (si no está pausada)
    if (!conversation.aiPaused) {
      const aiResponse = await generateAIResponse(userId, body, conversation.id);

      if (aiResponse) {
        const sent = await sendWahaMessage(sessionName, from, aiResponse);

        if (sent) {
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              content: aiResponse,
              fromMe: true,
              userId,
              role: 'assistant'
            }
          });

          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessage: aiResponse }
          });

          console.log(`🤖 Respuesta IA enviada a ${senderName}`);
        } else {
          console.error(`❌ Error enviando respuesta a ${senderName}`);
        }
      }
    } else {
      console.log(`⏸️ IA pausada para ${senderName}, no se genera respuesta`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error webhook:', error);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

export default router;

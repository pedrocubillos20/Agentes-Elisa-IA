import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

const WAHA_API_URL = process.env.WAHA_API_URL || 'http://31.97.142.127:8080';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';

const getWahaHeaders = () => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;
  return headers;
};

const SESSION_NAME = process.env.WAHA_SESSION_NAME || 'default';

// ===== OBTENER USUARIO POR DEFECTO =====
const getDefaultUserId = async (): Promise<string | null> => {
  // Primero buscar usuario con API key conectada
  const user = await prisma.user.findFirst({
    where: { apiKeyConnected: true },
    select: { id: true }
  });
  if (user) return user.id;

  // Si no, primer usuario
  const firstUser = await prisma.user.findFirst({
    select: { id: true },
    orderBy: { createdAt: 'asc' }
  });
  return firstUser?.id || null;
};

// ===== GENERAR RESPUESTA IA (MEJORADO) =====
const generateAIResponse = async (userId: string, message: string, conversationId: string): Promise<string | null> => {
  try {
    // 1. Verificar API Key del usuario
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { apiKey: true, apiKeyConnected: true }
    });

    if (!user?.apiKey || !user.apiKeyConnected) {
      console.log('⚠️ Usuario sin API Key de OpenAI configurada');
      return null;
    }

    // 2. Buscar asistente activo
    let assistant = await prisma.assistant.findFirst({
      where: { userId, isActive: true }
    });

    // Si no hay asistente activo, buscar CUALQUIER asistente del usuario y activarlo
    if (!assistant) {
      console.log('⚠️ No hay asistente activo, buscando cualquier asistente...');
      assistant = await prisma.assistant.findFirst({
        where: { userId }
      });

      if (assistant) {
        // Activarlo automáticamente
        await prisma.assistant.update({
          where: { id: assistant.id },
          data: { isActive: true }
        });
        console.log(`✅ Asistente "${assistant.name}" activado automáticamente`);
      } else {
        console.log('❌ No hay NINGÚN asistente configurado para este usuario');
        return null;
      }
    }

    // 3. Log detallado del asistente encontrado
    console.log(`📋 Asistente encontrado: "${assistant.name}" (ID: ${assistant.id})`);
    console.log(`   - context: ${assistant.context ? `${assistant.context.length} chars` : 'VACÍO'}`);
    console.log(`   - personality: ${assistant.personality ? `${assistant.personality.length} chars` : 'VACÍO'}`);
    console.log(`   - businessInfo: ${assistant.businessInfo ? `${assistant.businessInfo.length} chars` : 'VACÍO'}`);
    console.log(`   - instructions: ${assistant.instructions ? `${assistant.instructions.length} chars` : 'VACÍO'}`);
    console.log(`   - knowledgeItems: ${JSON.stringify(assistant.knowledgeItems).length} chars`);
    console.log(`   - modelo: ${assistant.model}`);
    console.log(`   - isActive: ${assistant.isActive}`);

    // 4. Obtener historial de conversación
    const history = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'desc' },
      take: 15
    });

    // 5. CONSTRUIR SYSTEM PROMPT COMPLETO
    const systemParts: string[] = [];

    // Nombre del asistente
    if (assistant.name) {
      systemParts.push(`Eres ${assistant.name}.`);
    }

    // Personalidad
    if (assistant.personality && assistant.personality.trim()) {
      systemParts.push(assistant.personality);
    }

    // CONTEXT (Base de Conocimiento) - CAMPO PRINCIPAL
    if (assistant.context && assistant.context.trim()) {
      systemParts.push(assistant.context);
      console.log(`📝 Context incluido: ${assistant.context.substring(0, 100)}...`);
    }

    // Info del negocio
    if (assistant.businessInfo && assistant.businessInfo.trim()) {
      systemParts.push(`Información del negocio: ${assistant.businessInfo}`);
    }

    // Instrucciones
    if (assistant.instructions && assistant.instructions.trim()) {
      systemParts.push(`Instrucciones: ${assistant.instructions}`);
    }

    // Knowledge Items (items de conocimiento adicionales)
    const knowledge = assistant.knowledgeItems as any;
    if (knowledge) {
      let knowledgeText = '';

      if (typeof knowledge === 'string') {
        // Si es string, intentar parsear como JSON
        try {
          const parsed = JSON.parse(knowledge);
          if (Array.isArray(parsed) && parsed.length > 0) {
            knowledgeText = parsed.map((item: any) => {
              if (typeof item === 'string') return item;
              return `${item.title || ''}: ${item.content || item.text || ''}`;
            }).filter(Boolean).join('\n');
          }
        } catch {
          // Si no es JSON válido, usarlo como texto directo
          if (knowledge.trim() && knowledge !== '[]') {
            knowledgeText = knowledge;
          }
        }
      } else if (Array.isArray(knowledge) && knowledge.length > 0) {
        knowledgeText = knowledge.map((item: any) => {
          if (typeof item === 'string') return item;
          return `${item.title || ''}: ${item.content || item.text || ''}`;
        }).filter(Boolean).join('\n');
      }

      if (knowledgeText) {
        systemParts.push(`Base de conocimiento adicional:\n${knowledgeText}`);
        console.log(`📚 Knowledge items incluidos: ${knowledgeText.length} chars`);
      }
    }

    // Prompt por defecto si no hay nada
    const systemPrompt = systemParts.length > 0
      ? systemParts.join('\n\n')
      : 'Eres un asistente virtual amable y útil. Responde de forma concisa y profesional.';

    console.log(`🧠 System prompt total: ${systemPrompt.length} chars (${Math.ceil(systemPrompt.length / 4)} tokens aprox.)`);

    // 6. Construir mensajes para OpenAI
    const messages: any[] = [{ role: 'system', content: systemPrompt }];

    // Agregar historial (de más antiguo a más reciente)
    const reversedHistory = [...history].reverse();
    for (const msg of reversedHistory) {
      messages.push({
        role: msg.fromMe ? 'assistant' : 'user',
        content: msg.content
      });
    }

    // Agregar mensaje actual
    messages.push({ role: 'user', content: message });

    console.log(`🤖 Llamando a OpenAI (modelo: ${assistant.model || 'gpt-4-turbo-preview'}, ${messages.length} mensajes)...`);

    // 7. Llamar a OpenAI
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
      console.log(`✅ Respuesta IA generada (${aiResponse.length} chars): ${aiResponse.substring(0, 80)}...`);
    } else {
      console.log('⚠️ OpenAI no devolvió respuesta');
    }

    return aiResponse || null;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error('❌ Timeout: OpenAI tardó más de 30 segundos');
    } else {
      console.error('❌ Error IA:', error.message);
    }
    return null;
  }
};

// ===== ENVIAR MENSAJE POR WAHA =====
const sendWahaMessage = async (chatId: string, text: string): Promise<boolean> => {
  try {
    const response = await fetch(`${WAHA_API_URL}/api/sendText`, {
      method: 'POST',
      headers: getWahaHeaders(),
      body: JSON.stringify({ session: SESSION_NAME, chatId, text })
    });
    return response.ok;
  } catch (error) {
    console.error('❌ Error enviando WAHA:', error);
    return false;
  }
};

// ===== ENDPOINT DE DEBUG =====
router.get('/debug', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    // Info del usuario
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        apiKey: true,
        apiKeyConnected: true
      }
    });

    // Todos los asistentes del usuario
    const assistants = await prisma.assistant.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        isActive: true,
        context: true,
        personality: true,
        businessInfo: true,
        instructions: true,
        knowledgeItems: true,
        model: true,
        temperature: true,
        maxTokens: true,
        autoLearn: true,
        createdAt: true,
        updatedAt: true
      }
    });

    // Resumen
    const activeAssistant = assistants.find(a => a.isActive);

    const debug = {
      user: {
        id: user?.id,
        email: user?.email,
        hasApiKey: !!user?.apiKey,
        apiKeyConnected: user?.apiKeyConnected,
        apiKeyPreview: user?.apiKey ? `${user.apiKey.substring(0, 8)}...${user.apiKey.substring(user.apiKey.length - 4)}` : null
      },
      assistants: {
        total: assistants.length,
        active: activeAssistant ? {
          id: activeAssistant.id,
          name: activeAssistant.name,
          contextLength: activeAssistant.context?.length || 0,
          contextPreview: activeAssistant.context?.substring(0, 200) || 'VACÍO',
          personalityLength: activeAssistant.personality?.length || 0,
          businessInfoLength: activeAssistant.businessInfo?.length || 0,
          instructionsLength: activeAssistant.instructions?.length || 0,
          knowledgeItemsLength: JSON.stringify(activeAssistant.knowledgeItems).length,
          model: activeAssistant.model,
          temperature: activeAssistant.temperature,
          maxTokens: activeAssistant.maxTokens,
          autoLearn: activeAssistant.autoLearn
        } : 'NINGUNO ACTIVO',
        all: assistants.map(a => ({
          id: a.id,
          name: a.name,
          isActive: a.isActive,
          contextLength: a.context?.length || 0,
          updatedAt: a.updatedAt
        }))
      },
      waha: {
        url: WAHA_API_URL,
        session: SESSION_NAME,
        hasApiKey: !!WAHA_API_KEY
      },
      conversations: await prisma.conversation.count({ where: { userId } }),
      messages: await prisma.message.count()
    };

    res.json(debug);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ===== ACTIVAR ASISTENTE =====
router.post('/activate-assistant', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    // Desactivar todos
    await prisma.assistant.updateMany({
      where: { userId },
      data: { isActive: false }
    });

    const { assistantId } = req.body;

    if (assistantId) {
      // Activar el específico
      await prisma.assistant.update({
        where: { id: assistantId },
        data: { isActive: true }
      });
    } else {
      // Activar el primero
      const first = await prisma.assistant.findFirst({ where: { userId } });
      if (first) {
        await prisma.assistant.update({
          where: { id: first.id },
          data: { isActive: true }
        });
      }
    }

    res.json({ success: true, message: 'Asistente activado' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ===== STATUS =====
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    try {
      const response = await fetch(`${WAHA_API_URL}/api/sessions/${SESSION_NAME}`, { headers: getWahaHeaders() });

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
        hasQR
      });
    } catch {
      res.json({ connected: false, status: 'error', phone: null, hasQR: false });
    }
  } catch {
    res.json({ connected: false, status: 'error', phone: null, hasQR: false });
  }
});

// ===== CONNECT =====
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const checkResponse = await fetch(`${WAHA_API_URL}/api/sessions/${SESSION_NAME}`, { headers: getWahaHeaders() });

    if (checkResponse.status === 404) {
      const webhookUrl = `https://elisa-iaagentes-production.up.railway.app/api/webhook/whatsapp`;
      await fetch(`${WAHA_API_URL}/api/sessions`, {
        method: 'POST',
        headers: getWahaHeaders(),
        body: JSON.stringify({
          name: SESSION_NAME,
          config: { webhooks: [{ url: webhookUrl, events: ['message', 'session.status'] }] }
        })
      });
      res.json({ success: true, message: 'Sesión iniciada' });
    } else {
      const sessionData = await checkResponse.json() as any;
      if (sessionData.status === 'STOPPED' || sessionData.status === 'FAILED') {
        await fetch(`${WAHA_API_URL}/api/sessions/${SESSION_NAME}/start`, { method: 'POST', headers: getWahaHeaders() });
      }
      res.json({ success: true, message: 'Sesión activada' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Error' });
  }
});

// ===== QR =====
router.get('/qr', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    try {
      const response = await fetch(`${WAHA_API_URL}/api/sessions/${SESSION_NAME}/auth/qr`, {
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

// ===== DISCONNECT =====
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    await fetch(`${WAHA_API_URL}/api/sessions/${SESSION_NAME}/stop`, { method: 'POST', headers: getWahaHeaders() });
    res.json({ success: true, message: 'Desconectado' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Error' });
  }
});

// ===== SEND MESSAGE =====
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
      body: JSON.stringify({ session: SESSION_NAME, chatId, text: message })
    });

    const result = await response.json() as any;

    if (response.ok) {
      const recipientId = to.replace(/\D/g, '');

      let conversation = await prisma.conversation.findFirst({ where: { userId, recipientId } });

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
      res.json({ success: false, message: result.message || 'Error' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Error' });
  }
});

// ===== WEBHOOK (recibe mensajes de WhatsApp) =====
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const { event, session, payload } = req.body;

    console.log(`📩 Webhook: event=${event}, session=${session}, from=${payload?.from}, hasBody=${!!payload?.body}`);

    if (!event || (event !== 'message' && event !== 'message.any')) {
      res.json({ success: true, ignored: true });
      return;
    }

    if (payload?.fromMe) {
      res.json({ success: true, ignored: true });
      return;
    }

    const userId = await getDefaultUserId();

    if (!userId) {
      console.log('⚠️ No hay usuario registrado');
      res.status(400).json({ error: 'No hay usuario' });
      return;
    }

    const from = payload?.from || payload?.chatId || '';
    const body = payload?.body || payload?.text || payload?.content || '';
    const notifyName = payload?.notifyName || payload?.pushName || payload?._data?.notifyName || '';

    if (!from || !body) {
      res.json({ success: true, ignored: true });
      return;
    }

    if (from.includes('@g.us')) {
      res.json({ success: true, ignored: true, reason: 'group' });
      return;
    }

    const recipientId = from.replace('@c.us', '').replace('@s.whatsapp.net', '');
    const senderName = notifyName || recipientId;

    console.log(`💬 Mensaje de ${senderName} (${recipientId}): ${body.substring(0, 50)}...`);

    // Buscar o crear conversación
    let conversation = await prisma.conversation.findFirst({ where: { userId, recipientId } });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { userId, recipientId, recipientName: senderName, lastMessage: body, stage: 'new' }
      });
    }

    // Comandos especiales: ".." pausa IA, "." reactiva IA
    if (body.trim() === '..') {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { aiPaused: true }
      });
      console.log(`⏸️ IA pausada por comando ".." en conversación ${conversation.id}`);
      res.json({ success: true, action: 'ai_paused' });
      return;
    }

    if (body.trim() === '.' && conversation.aiPaused) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { aiPaused: false }
      });
      console.log(`▶️ IA reactivada por comando "." en conversación ${conversation.id}`);
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

    // Respuesta automática con IA
    if (!conversation.aiPaused) {
      const aiResponse = await generateAIResponse(userId, body, conversation.id);

      if (aiResponse) {
        const sent = await sendWahaMessage(from, aiResponse);

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
        }
      }
    } else {
      console.log(`⏸️ IA pausada para ${senderName}`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error webhook:', error);
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

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

// ===== SESSION MANAGEMENT =====
const getUserSessionName = (userId: string): string => `user_${userId}`;

const findActiveSession = async (userId: string): Promise<{ name: string; data: any } | null> => {
  const sessionName = getUserSessionName(userId);
  for (const sn of [sessionName, 'default']) {
    try {
      const res = await fetch(`${WAHA_API_URL}/api/sessions/${sn}`, { headers: getWahaHeaders() });
      if (res.ok) {
        const data = await res.json() as any;
        if (['WORKING', 'CONNECTED', 'SCAN_QR_CODE', 'STARTING'].includes(data.status)) {
          return { name: sn, data };
        }
      }
    } catch {}
  }
  return null;
};

const resolveUserFromWebhook = async (sessionName: string, recipientId: string): Promise<string | null> => {
  if (sessionName.startsWith('user_')) {
    const uid = sessionName.replace('user_', '');
    const user = await prisma.user.findUnique({ where: { id: uid }, select: { id: true } });
    if (user) return user.id;
  }
  const conv = await prisma.conversation.findFirst({ where: { recipientId }, select: { userId: true } });
  if (conv) return conv.userId;
  const u = await prisma.user.findFirst({ where: { apiKeyConnected: true, apiKey: { not: null } }, select: { id: true } });
  if (u) return u.id;
  const first = await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } });
  return first?.id || null;
};

// ===== MEDIA: Buscar triggers en mediaItems =====
const findMediaTrigger = (message: string, mediaItems: any[]): any | null => {
  if (!mediaItems || !Array.isArray(mediaItems) || mediaItems.length === 0) return null;
  const msgLower = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  for (const item of mediaItems) {
    if (!item.trigger) continue;
    const triggers = item.trigger.split(',').map((t: string) => 
      t.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    ).filter(Boolean);

    for (const trigger of triggers) {
      if (trigger && msgLower.includes(trigger)) {
        return item;
      }
    }
  }
  return null;
};

// ===== MEDIA: Enviar archivo multimedia via WAHA =====
const sendWahaMedia = async (session: string, chatId: string, media: any, caption?: string): Promise<boolean> => {
  try {
    const url = media.url || '';
    const isBase64 = url.startsWith('data:');

    if (media.type === 'image') {
      const body: any = { session, chatId };
      if (isBase64) {
        // Extraer mimetype y data del base64
        const match = url.match(/^data:(.+?);base64,(.+)$/);
        if (match) {
          body.file = { mimetype: match[1], filename: media.name || 'image.jpg', data: match[2] };
        }
      } else {
        body.file = { url: media.url };
      }
      if (caption) body.caption = caption;

      const r = await fetch(`${WAHA_API_URL}/api/sendImage`, {
        method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(body)
      });
      console.log(`📸 Imagen enviada: ${r.ok ? 'OK' : 'ERROR'}`);
      return r.ok;
    }

    if (media.type === 'video' || media.type === 'audio') {
      const body: any = { session, chatId };
      if (isBase64) {
        const match = url.match(/^data:(.+?);base64,(.+)$/);
        if (match) {
          body.file = { mimetype: match[1], filename: media.name || 'file', data: match[2] };
        }
      } else {
        body.file = { url: media.url };
      }
      if (caption) body.caption = caption;

      const endpoint = media.type === 'video' ? '/api/sendVideo' : '/api/sendFile';
      const r = await fetch(`${WAHA_API_URL}${endpoint}`, {
        method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(body)
      });
      console.log(`🎬 ${media.type} enviado: ${r.ok ? 'OK' : 'ERROR'}`);
      return r.ok;
    }

    return false;
  } catch (e: any) {
    console.error('❌ Error enviando media:', e.message);
    return false;
  }
};

// ===== AI RESPONSE =====
const generateAIResponse = async (userId: string, message: string, conversationId: string): Promise<string | null> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId }, select: { apiKey: true, apiKeyConnected: true, email: true }
    });
    if (!user?.apiKey || !user.apiKeyConnected) return null;

    let assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true }, orderBy: { updatedAt: 'desc' } });
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } });
      if (assistant) await prisma.assistant.update({ where: { id: assistant.id }, data: { isActive: true } });
      else return null;
    }

    console.log(`📋 Asistente: "${assistant.name}" (context: ${assistant.context?.length || 0} chars)`);

    const history = await prisma.message.findMany({
      where: { conversationId }, orderBy: { timestamp: 'desc' }, take: 15
    });

    // System prompt
    const parts: string[] = [];
    if (assistant.name) parts.push(`Eres ${assistant.name}.`);
    if (assistant.personality?.trim()) parts.push(assistant.personality);
    if (assistant.context?.trim()) parts.push(assistant.context);
    if (assistant.businessInfo?.trim()) parts.push(`Información del negocio: ${assistant.businessInfo}`);
    if (assistant.instructions?.trim()) parts.push(`Instrucciones: ${assistant.instructions}`);

    // Knowledge items
    const knowledge = assistant.knowledgeItems as any;
    if (knowledge) {
      let kt = '';
      if (typeof knowledge === 'string') {
        try { const p = JSON.parse(knowledge); if (Array.isArray(p) && p.length > 0) kt = p.map((i: any) => typeof i === 'string' ? i : `${i.title||''}: ${i.content||i.text||''}`).filter(Boolean).join('\n'); } 
        catch { if (knowledge.trim() && knowledge !== '[]') kt = knowledge; }
      } else if (Array.isArray(knowledge) && knowledge.length > 0) {
        kt = knowledge.map((i: any) => typeof i === 'string' ? i : `${i.title||''}: ${i.content||i.text||''}`).filter(Boolean).join('\n');
      }
      if (kt) parts.push(`Base de conocimiento adicional:\n${kt}`);
    }

    // Media instructions: tell AI about available media triggers
    const mediaItems = assistant.mediaItems as any[];
    if (mediaItems && Array.isArray(mediaItems) && mediaItems.length > 0) {
      const mediaList = mediaItems.filter(m => m.trigger).map(m => 
        `- ${m.type}: "${m.name}" (triggers: ${m.trigger})`
      ).join('\n');
      if (mediaList) {
        parts.push(`\nTienes archivos multimedia que puedes ofrecer. Si el cliente pide algo relacionado, menciónalo:\n${mediaList}\nCuando sea relevante, puedes decir algo como "Te envío [la imagen/el catálogo/el video]" y el sistema lo enviará automáticamente.`);
      }
    }

    const systemPrompt = parts.length > 0 ? parts.join('\n\n') : 'Eres un asistente virtual amable.';
    console.log(`🧠 System prompt: ${systemPrompt.length} chars`);

    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    [...history].reverse().forEach(m => messages.push({ role: m.fromMe ? 'assistant' : 'user', content: m.content }));
    messages.push({ role: 'user', content: message });

    console.log(`🤖 Llamando OpenAI (${assistant.model || 'gpt-4-turbo-preview'}, ${messages.length} msgs)...`);

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30000);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.apiKey}` },
      body: JSON.stringify({
        model: assistant.model || 'gpt-4-turbo-preview', messages,
        temperature: assistant.temperature || 0.7, max_tokens: assistant.maxTokens || 500
      }),
      signal: ctrl.signal
    });
    clearTimeout(timeout);

    if (!res.ok) { console.error('❌ OpenAI:', res.status); return null; }
    const data = await res.json() as any;
    const reply = data.choices?.[0]?.message?.content;
    if (reply) console.log(`✅ Respuesta IA (${reply.length} chars)`);
    return reply || null;
  } catch (e: any) {
    console.error('❌ Error IA:', e.message);
    return null;
  }
};

const sendWahaMessage = async (session: string, chatId: string, text: string): Promise<boolean> => {
  try {
    const r = await fetch(`${WAHA_API_URL}/api/sendText`, {
      method: 'POST', headers: getWahaHeaders(),
      body: JSON.stringify({ session, chatId, text })
    });
    return r.ok;
  } catch { return false; }
};

// ===== RUTAS AUTENTICADAS =====

router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const session = await findActiveSession(userId);
    if (!session) { res.json({ connected: false, status: 'disconnected', phone: null, hasQR: false }); return; }
    const isConnected = session.data.status === 'WORKING' || session.data.status === 'CONNECTED';
    if (isConnected && session.data.me?.id) {
      const phone = session.data.me.id.replace('@c.us', '');
      await prisma.user.update({ where: { id: userId }, data: { phone } }).catch(() => {});
    }
    res.json({ connected: isConnected, status: session.data.status?.toLowerCase() || 'disconnected',
      phone: session.data.me?.id?.replace('@c.us', '') || null, hasQR: session.data.status === 'SCAN_QR_CODE',
      session: session.name });
  } catch { res.json({ connected: false, status: 'error', phone: null, hasQR: false }); }
});

router.post('/connect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const existing = await findActiveSession(userId);
    if (existing) {
      if (existing.data.status === 'WORKING' || existing.data.status === 'CONNECTED') {
        res.json({ success: true, message: 'Ya conectado', session: existing.name }); return;
      }
    }
    const sessionName = getUserSessionName(userId);
    const webhookUrl = `${BACKEND_URL}/api/webhook/whatsapp`;
    const check = await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}`, { headers: getWahaHeaders() });
    if (check.status === 404) {
      await fetch(`${WAHA_API_URL}/api/sessions`, { method: 'POST', headers: getWahaHeaders(),
        body: JSON.stringify({ name: sessionName, config: { webhooks: [{ url: webhookUrl, events: ['message', 'message.any', 'session.status'] }] } }) });
      res.json({ success: true, message: 'Sesión creada' });
    } else {
      const data = await check.json() as any;
      if (data.status === 'STOPPED' || data.status === 'FAILED') {
        await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}/start`, { method: 'POST', headers: getWahaHeaders() });
      }
      res.json({ success: true, message: 'Sesión activada' });
    }
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/qr', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const session = await findActiveSession(userId);
    const sessionName = session?.name || getUserSessionName(userId);
    try {
      const r = await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}/auth/qr`, { headers: { ...getWahaHeaders(), 'Accept': 'application/json' } });
      if (!r.ok) { res.json({ qr: null, available: false }); return; }
      const data = await r.json() as any;
      if (data.value) { res.json({ qr: data.value.startsWith('data:') ? data.value : `data:image/png;base64,${data.value}`, available: true }); }
      else if (data.mimetype && data.data) { res.json({ qr: `data:${data.mimetype};base64,${data.data}`, available: true }); }
      else { res.json({ qr: null, available: false }); }
    } catch { res.json({ qr: null, available: false }); }
  } catch { res.json({ qr: null, available: false }); }
});

router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const session = await findActiveSession(userId);
    if (session) await fetch(`${WAHA_API_URL}/api/sessions/${session.name}/stop`, { method: 'POST', headers: getWahaHeaders() });
    await prisma.user.update({ where: { id: userId }, data: { phone: null } }).catch(() => {});
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/send', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { to, message } = req.body;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    if (!to || !message) { res.status(400).json({ error: 'Faltan datos' }); return; }
    const session = await findActiveSession(userId);
    const sessionName = session?.name || getUserSessionName(userId);
    const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@c.us`;
    const r = await fetch(`${WAHA_API_URL}/api/sendText`, { method: 'POST', headers: getWahaHeaders(),
      body: JSON.stringify({ session: sessionName, chatId, text: message }) });
    const result = await r.json() as any;
    if (r.ok) {
      const recipientId = to.replace(/\D/g, '');
      let conv = await prisma.conversation.findFirst({ where: { userId, recipientId } });
      if (!conv) conv = await prisma.conversation.create({ data: { userId, recipientId, lastMessage: message, stage: 'new' } });
      await prisma.message.create({ data: { conversationId: conv.id, content: message, fromMe: true, userId, role: 'assistant' } });
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: message } });
      res.json({ success: true });
    } else { res.json({ success: false, message: result.message || 'Error' }); }
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/debug', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, phone: true, apiKeyConnected: true } });
    const session = await findActiveSession(userId);
    const assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true } });
    const mediaItems = (assistant?.mediaItems as any[]) || [];
    res.json({ user, session: session ? { name: session.name, status: session.data.status } : null,
      assistant: assistant ? { id: assistant.id, name: assistant.name, contextLength: assistant.context?.length || 0, mediaCount: mediaItems.length, autoLearn: assistant.autoLearn } : null,
      conversations: await prisma.conversation.count({ where: { userId } }) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ===== WEBHOOK PÚBLICO =====
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const { event, session, payload } = req.body;
    const sessionName = session || 'default';

    if (!event || (event !== 'message' && event !== 'message.any')) { res.json({ success: true }); return; }
    if (payload?.fromMe) { res.json({ success: true }); return; }

    const from = payload?.from || payload?.chatId || '';
    const body = payload?.body || payload?.text || payload?.content || '';
    const notifyName = payload?.notifyName || payload?.pushName || payload?._data?.notifyName || '';

    if (!from || !body || from.includes('@g.us')) { res.json({ success: true }); return; }

    const recipientId = from.replace('@c.us', '').replace('@s.whatsapp.net', '');
    const senderName = notifyName || recipientId;

    const userId = await resolveUserFromWebhook(sessionName, recipientId);
    if (!userId) { res.status(400).json({ error: 'No user' }); return; }

    console.log(`💬 ${senderName} (${recipientId}) → session: ${sessionName}`);

    let conv = await prisma.conversation.findFirst({ where: { userId, recipientId } });
    if (!conv) {
      conv = await prisma.conversation.create({ data: { userId, recipientId, recipientName: senderName, lastMessage: body, stage: 'new' } });
    }

    // Comandos
    if (body.trim() === '..') {
      await prisma.conversation.update({ where: { id: conv.id }, data: { aiPaused: true } });
      res.json({ success: true }); return;
    }
    if (body.trim() === '.' && conv.aiPaused) {
      await prisma.conversation.update({ where: { id: conv.id }, data: { aiPaused: false } });
      res.json({ success: true }); return;
    }

    // Guardar mensaje entrante
    await prisma.message.create({ data: { conversationId: conv.id, content: body, fromMe: false, userId, role: 'user' } });
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: body, recipientName: senderName } });

    if (conv.aiPaused) { res.json({ success: true }); return; }

    // ===== MEDIA TRIGGERS: Verificar si hay multimedia que enviar =====
    const assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true } });
    const mediaItems = (assistant?.mediaItems as any[]) || [];
    const matchedMedia = findMediaTrigger(body, mediaItems);

    if (matchedMedia) {
      console.log(`📎 Media trigger detectado: "${matchedMedia.name}" (trigger: ${matchedMedia.trigger})`);
      // Primero enviar respuesta IA, luego media
      const aiResponse = await generateAIResponse(userId, body, conv.id);
      if (aiResponse) {
        await sendWahaMessage(sessionName, from, aiResponse);
        await prisma.message.create({ data: { conversationId: conv.id, content: aiResponse, fromMe: true, userId, role: 'assistant' } });
      }
      // Enviar multimedia
      const sent = await sendWahaMedia(sessionName, from, matchedMedia, matchedMedia.caption || '');
      if (sent) {
        await prisma.message.create({ data: { conversationId: conv.id, content: `📎 [${matchedMedia.type}: ${matchedMedia.name}]`, fromMe: true, userId, role: 'assistant', mediaType: matchedMedia.type, mediaUrl: matchedMedia.url?.substring(0, 200) } });
        console.log(`✅ Media enviada: ${matchedMedia.name}`);
      }
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: aiResponse || `📎 ${matchedMedia.name}` } });
    } else {
      // Respuesta IA normal (sin media)
      const aiResponse = await generateAIResponse(userId, body, conv.id);
      if (aiResponse) {
        const sent = await sendWahaMessage(sessionName, from, aiResponse);
        if (sent) {
          await prisma.message.create({ data: { conversationId: conv.id, content: aiResponse, fromMe: true, userId, role: 'assistant' } });
          await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: aiResponse } });
          console.log(`🤖 Respuesta enviada a ${senderName}`);
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

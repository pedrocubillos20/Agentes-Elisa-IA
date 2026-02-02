import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

const WAHA_API_URL = process.env.WAHA_API_URL || 'http://31.97.142.127:8080';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
const BACKEND_URL = process.env.BACKEND_URL || 'https://elisa-iaagentes-production.up.railway.app';

const getWahaHeaders = () => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WAHA_API_KEY) h['X-Api-Key'] = WAHA_API_KEY;
  return h;
};

// ===== SESSION MANAGEMENT (multi-tenant) =====
const getUserSessionName = (userId: string): string => `user_${userId}`;

const getOwnerId = async (userId: string): Promise<string> => {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  return u?.parentUserId || userId;
};

const findActiveSession = async (userId: string): Promise<{ name: string; data: any } | null> => {
  const ownerId = await getOwnerId(userId);
  for (const sn of [getUserSessionName(ownerId), 'default']) {
    try {
      const r = await fetch(`${WAHA_API_URL}/api/sessions/${sn}`, { headers: getWahaHeaders() });
      if (r.ok) {
        const d = await r.json() as any;
        if (['WORKING', 'CONNECTED', 'SCAN_QR_CODE', 'STARTING'].includes(d.status)) return { name: sn, data: d };
      }
    } catch {}
  }
  return null;
};

const resolveUserFromWebhook = async (sessionName: string, recipientId: string): Promise<string | null> => {
  if (sessionName.startsWith('user_')) {
    const uid = sessionName.replace('user_', '');
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, parentUserId: true } });
    if (u) return u.parentUserId || u.id;
  }
  const conv = await prisma.conversation.findFirst({ where: { recipientId }, select: { userId: true } });
  if (conv) return conv.userId;
  const u = await prisma.user.findFirst({ where: { apiKeyConnected: true, parentUserId: null }, select: { id: true } });
  return u?.id || null;
};

// ====================================================
// 🔥 PRESENCE: TYPING & RECORDING INDICATORS
// Muestra "escribiendo..." o "grabando audio..." en WhatsApp
// ====================================================
const setPresence = async (session: string, chatId: string, mode: 'typing' | 'recording'): Promise<void> => {
  const endpoints = [
    { url: `${WAHA_API_URL}/api/startTyping`, body: { session, chatId } },
    { url: `${WAHA_API_URL}/api/${session}/sendPresence`, body: { chatId, presence: mode === 'recording' ? 'recording' : 'typing' } },
    { url: `${WAHA_API_URL}/api/sendPresence`, body: { session, chatId, presence: mode === 'recording' ? 'recording' : 'typing' } },
  ];

  if (mode === 'recording') {
    endpoints.unshift({ url: `${WAHA_API_URL}/api/startRecording`, body: { session, chatId } });
  }

  for (const ep of endpoints) {
    try {
      const r = await fetch(ep.url, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(ep.body) });
      if (r.ok) {
        console.log(`${mode === 'recording' ? '🎙️' : '⌨️'} ${mode} ON → ${chatId.substring(0, 12)}...`);
        return;
      }
    } catch {}
  }
  console.log(`⌨️ Presence (${mode}) no disponible en esta versión de WAHA`);
};

const stopPresence = async (session: string, chatId: string): Promise<void> => {
  try {
    await fetch(`${WAHA_API_URL}/api/stopTyping`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify({ session, chatId }) });
  } catch {}
  try {
    await fetch(`${WAHA_API_URL}/api/${session}/sendPresence`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify({ chatId, presence: 'available' }) });
  } catch {}
};

// Delay natural que simula escritura humana
const humanDelay = (textLength: number): Promise<void> => {
  const ms = Math.min(Math.max(textLength * 20, 1500), 3500); // 1.5s mín, 3.5s máx
  return new Promise(r => setTimeout(r, ms));
};

// ===== MEDIA TRIGGER: Busca si el mensaje activa un multimedia =====
const findMediaTrigger = (message: string, mediaItems: any[]): any | null => {
  if (!mediaItems?.length) return null;
  const norm = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const item of mediaItems) {
    if (!item.trigger) continue;
    const triggers = item.trigger.split(',').map((t: string) => t.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')).filter(Boolean);
    for (const t of triggers) { if (t && norm.includes(t)) return item; }
  }
  return null;
};

// ===== SEND MEDIA via WAHA (con fallback endpoints) =====
const sendWahaMedia = async (session: string, chatId: string, media: any, caption?: string): Promise<boolean> => {
  try {
    const url = media.url || '';
    const isBase64 = url.startsWith('data:');

    console.log(`📎 Enviando ${media.type}: "${media.name}" (base64: ${isBase64}, size: ~${Math.round((url.length * 3/4) / 1024)}KB)`);

    let fileData: any = null;
    if (isBase64) {
      const match = url.match(/^data:(.+?);base64,(.+)$/s);
      if (match) {
        fileData = { mimetype: match[1], filename: media.name || 'file', data: match[2] };
        console.log(`   mimetype: ${match[1]}, data length: ${match[2].length}`);
      } else {
        console.error('❌ No se pudo extraer base64 del URL');
        return false;
      }
    }

    // Determinar endpoint
    let endpoint = '/api/sendFile';
    if (media.type === 'image') endpoint = '/api/sendImage';
    else if (media.type === 'video') endpoint = '/api/sendVideo';

    const body: any = { session, chatId };
    if (fileData) body.file = fileData;
    else if (media.url) body.file = { url: media.url };
    if (caption) body.caption = caption;

    // Intento 1: endpoint principal
    console.log(`📤 POST ${WAHA_API_URL}${endpoint} (session: ${session})`);
    const r = await fetch(`${WAHA_API_URL}${endpoint}`, {
      method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(body)
    });

    if (r.ok) {
      console.log(`✅ ${media.type} enviado OK via ${endpoint}`);
      return true;
    }

    const errText = await r.text().catch(() => 'no body');
    console.error(`❌ ${endpoint} falló (${r.status}): ${errText.substring(0, 300)}`);

    // Intento 2: fallback con /api/sendFile
    if (endpoint !== '/api/sendFile') {
      console.log(`⚠️ Intentando fallback con /api/sendFile...`);
      const r2 = await fetch(`${WAHA_API_URL}/api/sendFile`, {
        method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(body)
      });
      if (r2.ok) {
        console.log(`✅ ${media.type} enviado OK via /api/sendFile (fallback)`);
        return true;
      }
      const err2 = await r2.text().catch(() => '');
      console.error(`❌ Fallback /api/sendFile también falló (${r2.status}): ${err2.substring(0, 300)}`);
    }

    // Intento 3: endpoint alternativo WAHA v2
    if (isBase64 && fileData) {
      console.log(`⚠️ Intentando endpoint WAHA v2 /api/${session}/sendImage...`);
      try {
        const r3 = await fetch(`${WAHA_API_URL}/api/${session}/sendImage`, {
          method: 'POST', headers: getWahaHeaders(),
          body: JSON.stringify({ chatId, file: fileData, caption: caption || '' })
        });
        if (r3.ok) {
          console.log(`✅ ${media.type} enviado OK via /api/${session}/sendImage`);
          return true;
        }
        const err3 = await r3.text().catch(() => '');
        console.error(`❌ Endpoint v2 falló (${r3.status}): ${err3.substring(0, 300)}`);
      } catch {}
    }

    return false;
  } catch (e: any) {
    console.error('❌ Error enviando media:', e.message);
    return false;
  }
};

// ===== SEND TEXT via WAHA =====
const sendWahaMessage = async (session: string, chatId: string, text: string): Promise<boolean> => {
  try {
    const r = await fetch(`${WAHA_API_URL}/api/sendText`, {
      method: 'POST', headers: getWahaHeaders(),
      body: JSON.stringify({ session, chatId, text })
    });
    return r.ok;
  } catch { return false; }
};

// ===== AI RESPONSE (con fallback GPT-3.5) =====
const generateAIResponse = async (ownerId: string, message: string, conversationId: string): Promise<string | null> => {
  try {
    const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { apiKey: true, apiKeyConnected: true } });
    if (!user?.apiKey || !user.apiKeyConnected) return null;

    let assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true }, orderBy: { updatedAt: 'desc' } });
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId }, orderBy: { updatedAt: 'desc' } });
      if (assistant) await prisma.assistant.update({ where: { id: assistant.id }, data: { isActive: true } });
      else return null;
    }

    console.log(`📋 Asistente: "${assistant.name}" (contexto: ${assistant.context?.length || 0} chars)`);

    const history = await prisma.message.findMany({ where: { conversationId }, orderBy: { timestamp: 'desc' }, take: 8 });

    // Construir system prompt
    const parts: string[] = [];
    if (assistant.name) parts.push(`Eres ${assistant.name}, un asistente virtual por WhatsApp.`);
    if (assistant.personality?.trim()) parts.push(assistant.personality);
    if (assistant.context?.trim()) parts.push(assistant.context);
    if (assistant.businessInfo?.trim()) parts.push(`Info del negocio: ${assistant.businessInfo}`);
    if (assistant.instructions?.trim()) parts.push(`Instrucciones: ${assistant.instructions}`);

    // Knowledge base
    const knowledge = assistant.knowledgeItems as any;
    if (knowledge) {
      let kt = '';
      if (typeof knowledge === 'string') {
        try { const p = JSON.parse(knowledge); if (Array.isArray(p) && p.length) kt = p.map((i: any) => typeof i === 'string' ? i : `${i.title||''}: ${i.content||i.text||''}`).filter(Boolean).join('\n'); }
        catch { if (knowledge.trim() && knowledge !== '[]') kt = knowledge; }
      } else if (Array.isArray(knowledge) && knowledge.length) {
        kt = knowledge.map((i: any) => typeof i === 'string' ? i : `${i.title||''}: ${i.content||i.text||''}`).filter(Boolean).join('\n');
      }
      if (kt) parts.push(`Base de conocimiento:\n${kt}`);
    }

    // Media awareness
    const mediaItems = assistant.mediaItems as any[];
    if (mediaItems?.length) {
      const ml = mediaItems.filter(m => m.trigger).map(m => `- ${m.type}: "${m.name}" (activadores: ${m.trigger})`).join('\n');
      if (ml) parts.push(`\nArchivos multimedia disponibles:\n${ml}\nSi el cliente pregunta por algo relacionado, menciona que se lo envías.`);
    }

    parts.push(`\nIMPORTANTE: Responde de forma concisa y natural, como un humano por WhatsApp. Usa emojis moderadamente.`);

    const systemPrompt = parts.join('\n\n') || 'Eres un asistente virtual amable por WhatsApp.';
    console.log(`🧠 Prompt: ${systemPrompt.length} chars`);

    const recent = [...history].reverse().slice(-8);
    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    recent.forEach(m => messages.push({ role: m.fromMe ? 'assistant' : 'user', content: m.content.substring(0, 500) }));
    messages.push({ role: 'user', content: message });

    // Llamar a OpenAI con fallback
    const primaryModel = assistant.model || 'gpt-4-turbo-preview';
    for (const model of [primaryModel, 'gpt-3.5-turbo']) {
      try {
        console.log(`🤖 OpenAI (${model}, ${messages.length} msgs)...`);
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 30000);
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.apiKey}` },
          body: JSON.stringify({
            model, messages,
            temperature: assistant.temperature || 0.7,
            max_tokens: Math.min(assistant.maxTokens || 500, model === 'gpt-3.5-turbo' ? 400 : 500)
          }),
          signal: ctrl.signal
        });
        clearTimeout(to);

        if (res.ok) {
          const d = await res.json() as any;
          const reply = d.choices?.[0]?.message?.content;
          if (reply) { console.log(`✅ IA (${model}): ${reply.length} chars`); return reply; }
        } else {
          const st = res.status;
          const errBody = await res.text().catch(() => '');
          console.error(`❌ OpenAI ${model}: ${st} - ${errBody.substring(0, 200)}`);
          if ((st === 429 || st === 402) && model !== 'gpt-3.5-turbo') {
            console.log('⚠️ Rate limit/sin créditos, intentando fallback gpt-3.5...');
            continue;
          }
          if (st === 401) return null; // API key inválida
          if (model !== 'gpt-3.5-turbo') continue;
        }
      } catch (e: any) {
        console.error(`❌ ${model}:`, e.message);
        if (model !== 'gpt-3.5-turbo') continue;
      }
    }
    return null;
  } catch (e: any) { console.error('❌ AI Error:', e.message); return null; }
};

// =====================================================
// ===== RUTAS AUTENTICADAS (requieren JWT) =====
// =====================================================

router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const session = await findActiveSession(ownerId);
    if (!session) { res.json({ connected: false, status: 'disconnected', phone: null, hasQR: false }); return; }
    const isConnected = ['WORKING', 'CONNECTED'].includes(session.data.status);
    if (isConnected && session.data.me?.id) {
      const phone = session.data.me.id.replace('@c.us', '');
      await prisma.user.update({ where: { id: ownerId }, data: { phone } }).catch(() => {});
    }
    res.json({
      connected: isConnected,
      status: session.data.status?.toLowerCase() || 'disconnected',
      phone: session.data.me?.id?.replace('@c.us', '') || null,
      hasQR: session.data.status === 'SCAN_QR_CODE',
      session: session.name
    });
  } catch { res.json({ connected: false, status: 'error', phone: null, hasQR: false }); }
});

router.post('/connect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const existing = await findActiveSession(ownerId);
    if (existing?.data.status === 'WORKING' || existing?.data.status === 'CONNECTED') {
      res.json({ success: true, message: 'Ya conectado', session: existing.name }); return;
    }
    const sessionName = getUserSessionName(ownerId);
    const webhookUrl = `${BACKEND_URL}/api/webhook/whatsapp`;

    const check = await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}`, { headers: getWahaHeaders() });
    if (check.status === 404) {
      await fetch(`${WAHA_API_URL}/api/sessions`, {
        method: 'POST', headers: getWahaHeaders(),
        body: JSON.stringify({
          name: sessionName,
          config: { webhooks: [{ url: webhookUrl, events: ['message', 'message.any', 'session.status'] }] }
        })
      });
      res.json({ success: true, message: 'Sesión creada' });
    } else {
      const data = await check.json() as any;
      if (['STOPPED', 'FAILED'].includes(data.status))
        await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}/start`, { method: 'POST', headers: getWahaHeaders() });
      res.json({ success: true, message: 'Sesión activada' });
    }
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/qr', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const session = await findActiveSession(ownerId);
    const sn = session?.name || getUserSessionName(ownerId);
    try {
      const r = await fetch(`${WAHA_API_URL}/api/sessions/${sn}/auth/qr`, { headers: { ...getWahaHeaders(), 'Accept': 'application/json' } });
      if (!r.ok) { res.json({ qr: null, available: false }); return; }
      const d = await r.json() as any;
      if (d.value) res.json({ qr: d.value.startsWith('data:') ? d.value : `data:image/png;base64,${d.value}`, available: true });
      else if (d.mimetype && d.data) res.json({ qr: `data:${d.mimetype};base64,${d.data}`, available: true });
      else res.json({ qr: null, available: false });
    } catch { res.json({ qr: null, available: false }); }
  } catch { res.json({ qr: null, available: false }); }
});

router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const session = await findActiveSession(ownerId);
    if (session) await fetch(`${WAHA_API_URL}/api/sessions/${session.name}/stop`, { method: 'POST', headers: getWahaHeaders() });
    await prisma.user.update({ where: { id: ownerId }, data: { phone: null } }).catch(() => {});
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/send', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { to, message } = req.body;
    if (!userId || !to || !message) { res.status(400).json({ error: 'Faltan datos' }); return; }
    const ownerId = await getOwnerId(userId);
    const session = await findActiveSession(ownerId);
    const sn = session?.name || getUserSessionName(ownerId);
    const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@c.us`;
    const r = await fetch(`${WAHA_API_URL}/api/sendText`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify({ session: sn, chatId, text: message }) });
    if (r.ok) {
      const recipientId = to.replace(/\D/g, '');
      let conv = await prisma.conversation.findFirst({ where: { userId: ownerId, recipientId } });
      if (!conv) conv = await prisma.conversation.create({ data: { userId: ownerId, recipientId, lastMessage: message, stage: 'new' } });
      await prisma.message.create({ data: { conversationId: conv.id, content: message, fromMe: true, userId, role: 'assistant' } });
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: message } });
      res.json({ success: true });
    } else { res.json({ success: false }); }
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/debug', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, phone: true, apiKeyConnected: true, role: true, parentUserId: true } });
    const session = await findActiveSession(ownerId);
    const assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true } });
    const team = await prisma.user.count({ where: { parentUserId: ownerId } });
    res.json({
      user, ownerId,
      session: session ? { name: session.name, status: session.data.status } : null,
      assistant: assistant ? { id: assistant.id, name: assistant.name, contextLength: assistant.context?.length || 0 } : null,
      conversations: await prisma.conversation.count({ where: { userId: ownerId } }),
      teamMembers: team
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// =====================================================
// ===== WEBHOOK PÚBLICO (recibe mensajes de WhatsApp) =====
// =====================================================
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

    // ====================================================
    // ⏸️ COMANDO: ".." = PAUSAR IA (hablar con humano)
    // ====================================================
    if (body.trim() === '..') {
      await prisma.conversation.update({ where: { id: conv.id }, data: { aiPaused: true } });
      await prisma.message.create({ data: { conversationId: conv.id, content: body, fromMe: false, userId, role: 'user' } });

      // Simular "escribiendo..." antes de responder
      await setPresence(sessionName, from, 'typing');
      await new Promise(r => setTimeout(r, 1500));
      await stopPresence(sessionName, from);

      const pauseMsg = '🙋‍♂️ Te conecto con un asesor humano. En un momento te atienden.';
      await sendWahaMessage(sessionName, from, pauseMsg);
      await prisma.message.create({ data: { conversationId: conv.id, content: pauseMsg, fromMe: true, userId, role: 'assistant' } });
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: pauseMsg } });
      console.log(`⏸️ IA PAUSADA → ${senderName}`);
      res.json({ success: true }); return;
    }

    // ====================================================
    // ▶️ COMANDO: "." = REACTIVAR IA
    // ====================================================
    if (body.trim() === '.') {
      if (conv.aiPaused) {
        await prisma.conversation.update({ where: { id: conv.id }, data: { aiPaused: false } });
        await prisma.message.create({ data: { conversationId: conv.id, content: body, fromMe: false, userId, role: 'user' } });

        await setPresence(sessionName, from, 'typing');
        await new Promise(r => setTimeout(r, 1000));
        await stopPresence(sessionName, from);

        const resumeMsg = '🤖 ¡Hola de nuevo! Soy tu asistente virtual. ¿En qué puedo ayudarte?';
        await sendWahaMessage(sessionName, from, resumeMsg);
        await prisma.message.create({ data: { conversationId: conv.id, content: resumeMsg, fromMe: true, userId, role: 'assistant' } });
        await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: resumeMsg } });
        console.log(`▶️ IA REACTIVADA → ${senderName}`);
      }
      res.json({ success: true }); return;
    }

    // Guardar mensaje entrante
    await prisma.message.create({ data: { conversationId: conv.id, content: body, fromMe: false, userId, role: 'user' } });
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: body, recipientName: senderName } });

    // Si IA pausada, no responder automáticamente
    if (conv.aiPaused) {
      console.log(`⏸️ IA pausada → ${senderName} (no responde)`);
      res.json({ success: true }); return;
    }

    // ====================================================
    // 🔥 DETECTAR MODO VOZ + MEDIA TRIGGERS
    // ====================================================
    const assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true } });
    const isVoiceMode = !!(assistant?.voiceEnabled && assistant?.elevenLabsKey && assistant?.selectedVoice);
    const mediaItems = (assistant?.mediaItems as any[]) || [];
    const matchedMedia = findMediaTrigger(body, mediaItems);

    // ====================================================
    // ⌨️🎙️ TYPING / RECORDING INDICATOR
    // Se muestra ANTES de generar la respuesta IA
    // El cliente ve "escribiendo..." o "grabando audio..."
    // ====================================================
    if (isVoiceMode) {
      await setPresence(sessionName, from, 'recording');  // 🎙️ "Grabando audio..."
    } else {
      await setPresence(sessionName, from, 'typing');     // ⌨️ "Escribiendo..."
    }

    // ====================================================
    // 📎 RUTA CON MEDIA TRIGGER
    // ====================================================
    if (matchedMedia) {
      console.log(`📎 Trigger multimedia: "${matchedMedia.name}" (${matchedMedia.trigger})`);

      const aiResponse = await generateAIResponse(userId, body, conv.id);
      await stopPresence(sessionName, from);

      if (aiResponse) {
        await humanDelay(aiResponse.length);
        await sendWahaMessage(sessionName, from, aiResponse);
        await prisma.message.create({ data: { conversationId: conv.id, content: aiResponse, fromMe: true, userId, role: 'assistant' } });
      }

      // Intentar enviar multimedia
      const sent = await sendWahaMedia(sessionName, from, matchedMedia, matchedMedia.caption || '');
      if (sent) {
        await prisma.message.create({ data: { conversationId: conv.id, content: `📎 [${matchedMedia.type}: ${matchedMedia.name}]`, fromMe: true, userId, role: 'assistant', mediaType: matchedMedia.type } });
        console.log(`✅ Media enviada: ${matchedMedia.name}`);
      } else {
        // FALLBACK: WAHA gratis no soporta media → enviar texto descriptivo
        console.log(`⚠️ Media no enviada (WAHA free no soporta media). Enviando fallback texto...`);
        const fallbackText = matchedMedia.caption
          ? `📎 ${matchedMedia.caption}`
          : `📎 Tengo ${matchedMedia.type === 'image' ? 'una imagen' : matchedMedia.type === 'video' ? 'un video' : 'un audio'} de "${matchedMedia.name}" para mostrarte. Pídeme más detalles o visita nuestro catálogo para verlo. 😊`;
        await sendWahaMessage(sessionName, from, fallbackText);
        await prisma.message.create({ data: { conversationId: conv.id, content: fallbackText, fromMe: true, userId, role: 'assistant' } });
      }
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: aiResponse || `📎 ${matchedMedia.name}` } });

    } else {
      // ====================================================
      // 🤖 RESPUESTA IA NORMAL (sin media)
      // ====================================================
      const aiResponse = await generateAIResponse(userId, body, conv.id);
      await stopPresence(sessionName, from);

      if (aiResponse) {
        await humanDelay(aiResponse.length);
        const sent = await sendWahaMessage(sessionName, from, aiResponse);
        if (sent) {
          await prisma.message.create({ data: { conversationId: conv.id, content: aiResponse, fromMe: true, userId, role: 'assistant' } });
          await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: aiResponse } });
          console.log(`🤖 Respuesta → ${senderName}`);
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

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

// ====================================================
// 📦 MESSAGE BUFFER — Agrupa mensajes enviados en ráfaga
// Si el usuario manda 3 líneas rápido, espera y responde UNA vez
// ====================================================
const BUFFER_WAIT_MS = 3000; // Esperar 3 segundos por más mensajes
const messageBuffer: Map<string, {
  messages: string[];
  timer: ReturnType<typeof setTimeout>;
  sessionName: string;
  from: string;
  senderName: string;
  userId: string;
  convId: string;
}> = new Map();

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

// ===== PRESENCE: TYPING & RECORDING =====
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
      if (r.ok) { console.log(`${mode === 'recording' ? '🎙️' : '⌨️'} ${mode} ON`); return; }
    } catch {}
  }
};

const stopPresence = async (session: string, chatId: string): Promise<void> => {
  try { await fetch(`${WAHA_API_URL}/api/stopTyping`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify({ session, chatId }) }); } catch {}
  try { await fetch(`${WAHA_API_URL}/api/${session}/sendPresence`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify({ chatId, presence: 'available' }) }); } catch {}
};

// ⚡ Delay natural REDUCIDO (0.8s - 2s máx para respuesta rápida)
const humanDelay = (textLength: number): Promise<void> => {
  const ms = Math.min(Math.max(textLength * 10, 800), 2000);
  return new Promise(r => setTimeout(r, ms));
};

// ===== MEDIA TRIGGER =====
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

// ===== SEND MEDIA via WAHA =====
const sendWahaMedia = async (session: string, chatId: string, media: any, caption?: string): Promise<boolean> => {
  try {
    const url = media.url || '';
    const isBase64 = url.startsWith('data:');
    let fileData: any = null;
    if (isBase64) {
      const match = url.match(/^data:(.+?);base64,(.+)$/s);
      if (match) fileData = { mimetype: match[1], filename: media.name || 'file', data: match[2] };
      else return false;
    }
    let endpoint = media.type === 'image' ? '/api/sendImage' : media.type === 'video' ? '/api/sendVideo' : '/api/sendFile';
    const body: any = { session, chatId };
    if (fileData) body.file = fileData;
    else if (media.url) body.file = { url: media.url };
    if (caption) body.caption = caption;

    const r = await fetch(`${WAHA_API_URL}${endpoint}`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(body) });
    if (r.ok) { console.log(`✅ ${media.type} enviado OK`); return true; }
    const errText = await r.text().catch(() => '');
    console.error(`❌ ${endpoint} (${r.status}): ${errText.substring(0, 200)}`);
    if (endpoint !== '/api/sendFile') {
      const r2 = await fetch(`${WAHA_API_URL}/api/sendFile`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(body) });
      if (r2.ok) return true;
    }
    return false;
  } catch (e: any) { console.error('❌ Media error:', e.message); return false; }
};

// ===== SEND TEXT =====
const sendWahaMessage = async (session: string, chatId: string, text: string): Promise<boolean> => {
  try {
    const r = await fetch(`${WAHA_API_URL}/api/sendText`, {
      method: 'POST', headers: getWahaHeaders(),
      body: JSON.stringify({ session, chatId, text })
    });
    return r.ok;
  } catch { return false; }
};

// ====================================================
// 🎤 AUDIO TRANSCRIPTION (Whisper via OpenAI)
// ====================================================
const transcribeAudio = async (audioBuffer: Buffer, apiKey: string): Promise<string | null> => {
  try {
    const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
    const formData = new FormData();
    formData.append('file', blob, 'audio.ogg');
    formData.append('model', 'whisper-1');
    formData.append('language', 'es');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    });

    if (res.ok) {
      const data = await res.json() as any;
      console.log(`🎤 Whisper transcripción: "${data.text?.substring(0, 100)}"`);
      return data.text || null;
    } else {
      const err = await res.text().catch(() => '');
      console.error(`❌ Whisper error ${res.status}: ${err.substring(0, 200)}`);
      return null;
    }
  } catch (e: any) {
    console.error('❌ Whisper error:', e.message);
    return null;
  }
};

// ====================================================
// 📥 DOWNLOAD MEDIA FROM WAHA
// ====================================================
const downloadMediaFromWaha = async (session: string, messageId: string): Promise<{ buffer: Buffer; mimetype: string } | null> => {
  // Intentar múltiples endpoints de WAHA para descargar media
  const endpoints = [
    `${WAHA_API_URL}/api/${session}/messages/${messageId}/download`,
    `${WAHA_API_URL}/api/messages/${messageId}/download?session=${session}`,
  ];
  
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: getWahaHeaders() });
      if (r.ok) {
        const contentType = r.headers.get('content-type') || 'application/octet-stream';
        const arrayBuf = await r.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        if (buffer.length > 0) {
          console.log(`📥 Media descargada: ${buffer.length} bytes (${contentType})`);
          return { buffer, mimetype: contentType };
        }
      }
    } catch {}
  }
  
  return null;
};

// ====================================================
// 🖼️ GET MEDIA URL FROM WAHA (for displaying in chat)
// ====================================================
const getMediaUrl = (session: string, messageId: string): string => {
  return `${WAHA_API_URL}/api/${session}/messages/${messageId}/download`;
};

// ====================================================
// 🔍 EXTRACT MEDIA INFO FROM WAHA PAYLOAD
// ====================================================
const extractMediaInfo = (payload: any): { hasMedia: boolean; mediaType: string; mimetype: string; messageId: string; caption: string; mediaUrl: string } => {
  const hasMedia = !!(payload?.hasMedia || payload?.media || payload?.mediaUrl || payload?._data?.mediaData);
  const mimetype = payload?.mimetype || payload?.media?.mimetype || payload?._data?.mimetype || '';
  const messageId = payload?.id?._serialized || payload?.id?.id || payload?.key?.id || payload?.id || '';
  const caption = payload?.caption || payload?.body || '';
  
  let mediaType = 'unknown';
  if (mimetype.startsWith('audio/') || mimetype.includes('ogg') || mimetype.includes('opus') || payload?.type === 'ptt' || payload?.type === 'audio') {
    mediaType = 'audio';
  } else if (mimetype.startsWith('image/') || payload?.type === 'image') {
    mediaType = 'image';
  } else if (mimetype.startsWith('video/') || payload?.type === 'video') {
    mediaType = 'video';
  } else if (mimetype.startsWith('application/') || payload?.type === 'document') {
    mediaType = 'document';
  } else if (payload?.type === 'sticker') {
    mediaType = 'sticker';
  }
  
  // URL directa si WAHA la provee
  const mediaUrl = payload?.mediaUrl || payload?.media?.url || '';
  
  return { hasMedia, mediaType, mimetype, messageId, caption, mediaUrl };
};

// ===== AI RESPONSE (🧠 MEMORIA PERSISTENTE + AUTO-APRENDIZAJE) =====
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

    // 🧠 CARGAR CONVERSACIÓN + MEMORIA PERSISTENTE
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { recipientName: true, recipientId: true, stage: true, contextData: true }
    });

    const clientName = conversation?.recipientName || '';
    const clientPhone = conversation?.recipientId || '';
    const savedContext = (conversation?.contextData as Record<string, any>) || {};

    // 🧠 Buscar datos del CRM
    let crmInfo = '';
    if (clientPhone) {
      const client = await prisma.client.findFirst({
        where: { userId: ownerId, phone: { contains: clientPhone.slice(-10) } },
        select: { name: true, email: true, address: true, notes: true, tags: true, status: true, totalPurchases: true }
      }).catch(() => null);

      if (client) {
        const parts: string[] = [];
        if (client.name) parts.push(`Nombre CRM: ${client.name}`);
        if (client.email) parts.push(`Email: ${client.email}`);
        if (client.address) parts.push(`Dirección: ${client.address}`);
        if (client.notes) parts.push(`Notas: ${client.notes}`);
        if (client.tags?.length) parts.push(`Etiquetas: ${client.tags.join(', ')}`);
        if (client.totalPurchases > 0) parts.push(`Compras previas: $${client.totalPurchases}`);
        if (parts.length) crmInfo = parts.join('\n');
      }
    }

    // 🧠 CARGAR HISTORIAL COMPLETO (hasta 30 mensajes para cubrir flujo de venta completo)
    const history = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'desc' },
      take: 30
    });

    // ====== CONSTRUIR SYSTEM PROMPT ======
    const promptParts: string[] = [];
    if (assistant.name) promptParts.push(`Eres ${assistant.name}, un asistente virtual por WhatsApp.`);
    if (assistant.personality?.trim()) promptParts.push(assistant.personality);
    if (assistant.context?.trim()) promptParts.push(assistant.context);
    if (assistant.businessInfo?.trim()) promptParts.push(`Info del negocio: ${assistant.businessInfo}`);
    if (assistant.instructions?.trim()) promptParts.push(`Instrucciones: ${assistant.instructions}`);

    // 🧠 INYECTAR MEMORIA PERSISTENTE DEL CLIENTE
    const memoryBlock: string[] = [];
    
    // Datos guardados de conversaciones anteriores
    if (Object.keys(savedContext).length > 0) {
      memoryBlock.push('📋 MEMORIA GUARDADA DEL CLIENTE (datos de conversaciones anteriores):');
      for (const [key, value] of Object.entries(savedContext)) {
        if (value && value !== '' && value !== 'null' && value !== 'undefined') {
          memoryBlock.push(`  - ${key}: ${value}`);
        }
      }
      memoryBlock.push('⚠️ USA estos datos. NO vuelvas a preguntar nada que ya esté aquí.');
    }

    // Nombre del contacto de WhatsApp
    if (clientName) {
      memoryBlock.push(`\n🧠 CLIENTE ACTUAL: "${clientName}" (teléfono: ${clientPhone})`);
      memoryBlock.push(`REGLA: Ya conoces su nombre. NUNCA le preguntes cómo se llama.`);
    }

    // Datos del CRM
    if (crmInfo) {
      memoryBlock.push(`\n📊 DATOS DEL CRM:\n${crmInfo}`);
    }

    // Estado de la conversación
    if (conversation?.stage && conversation.stage !== 'new') {
      const stageNames: Record<string, string> = {
        interested: 'Interesado', quoting: 'En Cotización', negotiating: 'Negociando',
        pending_confirm: 'Por Confirmar', converted: 'Convertido', follow_up: 'Seguimiento', lost: 'Perdido'
      };
      memoryBlock.push(`Estado del cliente en CRM: ${stageNames[conversation.stage] || conversation.stage}`);
    }

    if (memoryBlock.length > 0) {
      promptParts.push(memoryBlock.join('\n'));
    }

    // Base de conocimiento
    const knowledge = assistant.knowledgeItems as any;
    if (knowledge) {
      let kt = '';
      if (typeof knowledge === 'string') {
        try { const p = JSON.parse(knowledge); if (Array.isArray(p) && p.length) kt = p.map((i: any) => typeof i === 'string' ? i : `${i.title||''}: ${i.content||i.text||''}`).filter(Boolean).join('\n'); }
        catch { if (knowledge.trim() && knowledge !== '[]') kt = knowledge; }
      } else if (Array.isArray(knowledge) && knowledge.length) {
        kt = knowledge.map((i: any) => typeof i === 'string' ? i : `${i.title||''}: ${i.content||i.text||''}`).filter(Boolean).join('\n');
      }
      if (kt) promptParts.push(`Base de conocimiento:\n${kt}`);
    }

    // Media triggers
    const mediaItems = assistant.mediaItems as any[];
    if (mediaItems?.length) {
      const ml = mediaItems.filter(m => m.trigger).map(m => `- ${m.type}: "${m.name}" (activadores: ${m.trigger})`).join('\n');
      if (ml) promptParts.push(`\nArchivos multimedia disponibles:\n${ml}\nSi el cliente pregunta por algo relacionado, menciona que se lo envías.`);
    }

    // 🧠 INSTRUCCIONES DE MEMORIA — Esto le dice a la IA que devuelva un bloque de datos
    promptParts.push(`
=== REGLAS DE MEMORIA (OBLIGATORIO) ===

1. NUNCA preguntes algo que el cliente ya dijo en la conversación o que esté en la MEMORIA GUARDADA.
2. Si ya sabes el nombre, talla, color, ciudad, cantidad, calidad u OTRO dato — ÚSALO, no lo vuelvas a preguntar.
3. Lee TODO el historial antes de responder. Si el cliente mencionó algo antes, recuérdalo.
4. Si el cliente vuelve después de días, salúdalo por su nombre y retoma donde quedaron.
5. Responde de forma natural, como un humano por WhatsApp.

=== BLOQUE DE MEMORIA (OBLIGATORIO AL FINAL) ===

AL FINAL de CADA respuesta, DEBES incluir un bloque de memoria con TODA la información que has recopilado del cliente.
El formato EXACTO es (incluye la línea tal cual):

<<MEMORY_JSON>>{"nombre":"","tipo":"","talla":"","color":"","calidad":"","cantidad":"","ciudad":"","chaqueta":"","bordado":"","precio_unitario":"","descuento":"","envio":"","total":"","metodo_pago":"","datos_envio":"","pedido":"","paso_actual":""}<<END_MEMORY>>

REGLAS del bloque de memoria:
- Llena SOLO los campos que ya conoces. Deja vacío "" lo que NO sabes aún.
- "paso_actual" = en qué paso del flujo de venta estás (ej: "saludo", "pidiendo_nombre", "pidiendo_talla", "pidiendo_color", "resumen", "confirmado", etc.)
- SIEMPRE incluye este bloque, incluso si no tienes datos nuevos.
- El bloque va DESPUÉS de tu respuesta al cliente, en la última línea.
- NO expliques el bloque al cliente, es interno.`);

    const systemPrompt = promptParts.join('\n\n') || 'Eres un asistente virtual amable por WhatsApp.';
    console.log(`🧠 Prompt: ${systemPrompt.length} chars | Cliente: ${clientName || 'desconocido'} | Memoria: ${Object.keys(savedContext).length} campos`);

    // Construir mensajes para OpenAI (30 mensajes = cubre flujo completo de venta)
    const recent = [...history].reverse().slice(-30);
    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    recent.forEach(m => messages.push({ role: m.fromMe ? 'assistant' : 'user', content: m.content.substring(0, 500) }));
    messages.push({ role: 'user', content: message });

    // Llamar a OpenAI
    // 💰 MODELO FIJO: gpt-4o-mini (económico y potente, ~60x más barato que gpt-4-turbo)
    // NO se cambia desde el panel — siempre usa este modelo
    const FIXED_MODEL = 'gpt-4o-mini';
    for (const model of [FIXED_MODEL]) {
      try {
        console.log(`🤖 OpenAI (${model}, ${messages.length} msgs)...`);
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 20000);
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.apiKey}` },
          body: JSON.stringify({
            model, messages,
            temperature: assistant.temperature || 0.7,
            max_tokens: 500
          }),
          signal: ctrl.signal
        });
        clearTimeout(to);

        if (res.ok) {
          const d = await res.json() as any;
          let reply = d.choices?.[0]?.message?.content;
          if (!reply) continue;

          // 🧠 EXTRAER Y GUARDAR BLOQUE DE MEMORIA
          const memoryMatch = reply.match(/<<MEMORY_JSON>>([\s\S]*?)<<END_MEMORY>>/);
          if (memoryMatch) {
            try {
              const memoryData = JSON.parse(memoryMatch[1].trim());
              // Merge con datos existentes (no borrar datos previos si vienen vacíos)
              const merged = { ...savedContext };
              for (const [key, value] of Object.entries(memoryData)) {
                if (value && value !== '' && value !== 'null' && value !== 'undefined') {
                  merged[key] = value;
                }
              }
              // Guardar en DB
              await prisma.conversation.update({
                where: { id: conversationId },
                data: { contextData: merged }
              });
              console.log(`🧠 Memoria guardada: ${JSON.stringify(merged)}`);
            } catch (e) {
              console.error('⚠️ Error parseando memoria:', e);
            }
            // Limpiar el bloque de memoria de la respuesta al cliente
            reply = reply.replace(/<<MEMORY_JSON>>[\s\S]*?<<END_MEMORY>>/, '').trim();
          }

          // Limpiar también si la IA dejó otros formatos de memoria
          reply = reply.replace(/\[MEMORY_UPDATE\][\s\S]*?\[\/MEMORY_UPDATE\]/g, '').trim();
          reply = reply.replace(/<<CONTEXT:[\s\S]*?>>/g, '').trim();

          if (reply) {
            console.log(`✅ IA (${model}): ${reply.length} chars`);
            return reply;
          }
        } else {
          const st = res.status;
          const errBody = await res.text().catch(() => '');
          console.error(`❌ OpenAI ${model}: ${st} - ${errBody.substring(0, 200)}`);
          if (st === 429 || st === 402) { console.log('⚠️ Rate limit, reintentando en 2s...'); await new Promise(r => setTimeout(r, 2000)); continue; }
          if (st === 401) return null;
        }
      } catch (e: any) {
        console.error(`❌ ${model}:`, e.message);
      }
    }
    return null;
  } catch (e: any) { console.error('❌ AI Error:', e.message); return null; }
};

// ====================================================
// 🔥 PROCESAR MENSAJES AGRUPADOS
// Se ejecuta después de 3 seg sin nuevos mensajes
// Combina todas las líneas y genera UNA respuesta
// ====================================================
const processBufferedMessages = async (bufferKey: string) => {
  const buf = messageBuffer.get(bufferKey);
  if (!buf) return;
  messageBuffer.delete(bufferKey);

  const { messages: msgs, sessionName, from, senderName, userId, convId } = buf;
  const combinedMessage = msgs.join('\n');

  console.log(`📦 Buffer procesado: ${msgs.length} mensaje(s) de ${senderName} → "${combinedMessage.substring(0, 100)}..."`);

  try {
    const assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true } });
    const isVoiceMode = !!(assistant?.voiceEnabled && assistant?.elevenLabsKey && assistant?.selectedVoice);
    const mediaItems = (assistant?.mediaItems as any[]) || [];
    const matchedMedia = findMediaTrigger(combinedMessage, mediaItems);

    // ⌨️🎙️ Typing/Recording (refrescar porque ya pasaron 3 seg)
    if (isVoiceMode) {
      await setPresence(sessionName, from, 'recording');
    } else {
      await setPresence(sessionName, from, 'typing');
    }

    if (matchedMedia) {
      console.log(`📎 Trigger multimedia: "${matchedMedia.name}"`);
      const aiResponse = await generateAIResponse(userId, combinedMessage, convId);
      await stopPresence(sessionName, from);

      if (aiResponse) {
        await humanDelay(aiResponse.length);
        await sendWahaMessage(sessionName, from, aiResponse);
        await prisma.message.create({ data: { conversationId: convId, content: aiResponse, fromMe: true, userId, role: 'assistant' } });
      }

      const sent = await sendWahaMedia(sessionName, from, matchedMedia, matchedMedia.caption || '');
      if (sent) {
        await prisma.message.create({ data: { conversationId: convId, content: `📎 [${matchedMedia.type}: ${matchedMedia.name}]`, fromMe: true, userId, role: 'assistant', mediaType: matchedMedia.type } });
      } else {
        const fallbackText = matchedMedia.caption
          ? `📎 ${matchedMedia.caption}`
          : `📎 Tengo ${matchedMedia.type === 'image' ? 'una imagen' : matchedMedia.type === 'video' ? 'un video' : 'un audio'} de "${matchedMedia.name}" para mostrarte. Pídeme más detalles 😊`;
        await sendWahaMessage(sessionName, from, fallbackText);
        await prisma.message.create({ data: { conversationId: convId, content: fallbackText, fromMe: true, userId, role: 'assistant' } });
      }
      await prisma.conversation.update({ where: { id: convId }, data: { lastMessage: aiResponse || `📎 ${matchedMedia.name}` } });

    } else {
      // 🤖 Respuesta IA con mensaje combinado
      const aiResponse = await generateAIResponse(userId, combinedMessage, convId);
      await stopPresence(sessionName, from);

      if (aiResponse) {
        await humanDelay(aiResponse.length);
        const sent = await sendWahaMessage(sessionName, from, aiResponse);
        if (sent) {
          await prisma.message.create({ data: { conversationId: convId, content: aiResponse, fromMe: true, userId, role: 'assistant' } });
          await prisma.conversation.update({ where: { id: convId }, data: { lastMessage: aiResponse } });
          console.log(`🤖 Respuesta → ${senderName} (${msgs.length} msgs agrupados)`);
        }
      }
    }
  } catch (e: any) {
    console.error(`❌ Error procesando buffer de ${senderName}:`, e.message);
  }
};

// ===== RUTAS AUTENTICADAS =====

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

// =====================================================
// 🔧 FIX WAHA PLUS: Agregar start: true al crear sesión
// =====================================================
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
      // ✅ FIX: Agregar start: true para que WAHA Plus inicie la sesión automáticamente
      const createRes = await fetch(`${WAHA_API_URL}/api/sessions`, {
        method: 'POST', headers: getWahaHeaders(),
        body: JSON.stringify({
          name: sessionName,
          start: true,
          config: {
            webhooks: [{ url: webhookUrl, events: ['message', 'message.any', 'session.status'] }]
          }
        })
      });
      const createData = await createRes.json().catch(() => ({}));
      console.log(`📱 Sesión creada: ${sessionName} (status: ${(createData as any).status || 'unknown'})`);
      res.json({ success: true, message: 'Sesión creada', session: sessionName });
    } else {
      const data = await check.json() as any;

      if (['STOPPED', 'FAILED'].includes(data.status)) {
        // ✅ FIX: Si la sesión existe pero está detenida, iniciarla
        await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}/start`, { method: 'POST', headers: getWahaHeaders() });
        console.log(`🔄 Sesión reiniciada: ${sessionName}`);
      } else if (data.status === 'SCAN_QR_CODE') {
        // Ya está esperando QR, no hacer nada
        console.log(`📱 Sesión ya esperando QR: ${sessionName}`);
      }

      res.json({ success: true, message: 'Sesión activada', session: sessionName });
    }
  } catch (e: any) {
    console.error(`❌ Error en /connect:`, e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/qr', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const session = await findActiveSession(ownerId);
    const sn = session?.name || getUserSessionName(ownerId);

    // ✅ FIX: Si no hay sesión activa, intentar obtener el QR de la sesión del usuario directamente
    const sessionToCheck = session ? sn : getUserSessionName(ownerId);

    try {
      // ✅ FIX: La ruta correcta en WAHA es /api/{session}/auth/qr (SIN "sessions/")
      let qrData: string | null = null;

      // 1. Imagen base64 (formato preferido - devuelve PNG real)
      try {
        const r = await fetch(`${WAHA_API_URL}/api/${sessionToCheck}/auth/qr`, { headers: { ...getWahaHeaders(), 'Accept': 'application/json' } });
        if (r.ok) {
          const d = await r.json() as any;
          if (d.mimetype && d.data) { qrData = `data:${d.mimetype};base64,${d.data}`; }
        }
      } catch {}

      // 2. Imagen binaria directa (Accept: image/png)
      if (!qrData) {
        try {
          const r = await fetch(`${WAHA_API_URL}/api/${sessionToCheck}/auth/qr`, { headers: { ...getWahaHeaders(), 'Accept': 'image/png' } });
          if (r.ok && r.headers.get('content-type')?.includes('image')) {
            const buf = Buffer.from(await r.arrayBuffer());
            qrData = `data:image/png;base64,${buf.toString('base64')}`;
          }
        } catch {}
      }

      // 3. Fallback: ruta legacy /api/sessions/{session}/auth/qr
      if (!qrData) {
        try {
          const r = await fetch(`${WAHA_API_URL}/api/sessions/${sessionToCheck}/auth/qr`, { headers: { ...getWahaHeaders(), 'Accept': 'application/json' } });
          if (r.ok) {
            const d = await r.json() as any;
            if (d.mimetype && d.data) { qrData = `data:${d.mimetype};base64,${d.data}`; }
          }
        } catch {}
      }

      if (qrData) {
        res.json({ qr: qrData, available: true });
      } else {
        res.json({ qr: null, available: false });
      }
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
      const cleanNumber = to.replace(/\D/g, '');
      // 🔍 Búsqueda flexible: exacto, sin "+", últimos 10 dígitos
      let conv = await prisma.conversation.findFirst({ where: { userId: ownerId, recipientId: cleanNumber } });
      if (!conv) conv = await prisma.conversation.findFirst({ where: { userId: ownerId, recipientId: `+${cleanNumber}` } });
      if (!conv) conv = await prisma.conversation.findFirst({ where: { userId: ownerId, recipientId: to } });
      if (!conv && cleanNumber.length >= 10) {
        const last10 = cleanNumber.slice(-10);
        conv = await prisma.conversation.findFirst({ where: { userId: ownerId, recipientId: { endsWith: last10 } } });
      }
      if (!conv) conv = await prisma.conversation.create({ data: { userId: ownerId, recipientId: cleanNumber, lastMessage: message, stage: 'new' } });
      
      await prisma.message.create({ data: { conversationId: conv.id, content: message, fromMe: true, userId, role: 'assistant' } });
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: message } });
      res.json({ success: true });
    } else { res.json({ success: false }); }
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
});

// ====================================================
// 🖼️ MEDIA PROXY — Sirve imágenes/audios de WAHA al frontend
// ====================================================
router.get('/media/:session/:messageId', async (req: Request, res: Response) => {
  try {
    const { session: sess, messageId } = req.params;
    const downloaded = await downloadMediaFromWaha(sess, messageId);
    if (downloaded) {
      res.setHeader('Content-Type', downloaded.mimetype);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(downloaded.buffer);
    } else {
      res.status(404).json({ error: 'Media not found' });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
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
      teamMembers: team,
      activeBuffers: messageBuffer.size
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// =====================================================
// ===== WEBHOOK PÚBLICO (recibe mensajes WhatsApp) =====
// =====================================================
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const { event, session, payload } = req.body;
    const sessionName = session || 'default';

    if (!event || (event !== 'message' && event !== 'message.any')) { res.json({ success: true }); return; }
    if (payload?.fromMe) { res.json({ success: true }); return; }

    const from = payload?.from || payload?.chatId || '';
    let body = payload?.body || payload?.text || payload?.content || '';
    const notifyName = payload?.notifyName || payload?.pushName || payload?._data?.notifyName || '';

    // 🚫 Filtrar: grupos, historias/estados de WhatsApp, broadcast
    if (!from || from.includes('@g.us') || from.includes('@broadcast') || from.includes('status@') || from === 'status@broadcast') {
      if (from.includes('@broadcast') || from.includes('status@')) {
        console.log(`🚫 Ignorado: historia/estado de WhatsApp de ${from}`);
      }
      res.json({ success: true }); return;
    }

    // 🔍 Detectar media (audio, imagen, video, sticker)
    const media = extractMediaInfo(payload);
    let savedMediaUrl: string | null = null;
    let savedMediaType: string | null = null;

    if (media.hasMedia) {
      console.log(`📎 Media recibida: tipo=${media.mediaType}, mime=${media.mimetype}, msgId=${media.messageId}`);
      
      // 🎤 AUDIO → Transcribir con Whisper
      if (media.mediaType === 'audio') {
        const recipientIdTemp = from.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '');
        const userIdTemp = await resolveUserFromWebhook(sessionName, recipientIdTemp);
        if (userIdTemp) {
          const user = await prisma.user.findUnique({ where: { id: userIdTemp }, select: { apiKey: true } });
          if (user?.apiKey && media.messageId) {
            const downloaded = await downloadMediaFromWaha(sessionName, media.messageId);
            if (downloaded) {
              const transcript = await transcribeAudio(downloaded.buffer, user.apiKey);
              if (transcript) {
                body = `🎤 [Audio transcrito]: ${transcript}`;
                console.log(`🎤 Audio transcrito: "${transcript.substring(0, 100)}"`);
              } else {
                body = '🎤 [Audio recibido - no se pudo transcribir]';
              }
            } else {
              body = '🎤 [Audio recibido]';
            }
          } else {
            body = '🎤 [Audio recibido]';
          }
        }
        savedMediaType = 'audio';
      }
      
      // 🖼️ IMAGEN → Guardar URL para mostrar en chat
      else if (media.mediaType === 'image') {
        if (media.messageId) {
          savedMediaUrl = getMediaUrl(sessionName, media.messageId);
        }
        savedMediaType = 'image';
        if (!body && media.caption) body = media.caption;
        if (!body) body = '📷 [Imagen recibida]';
      }
      
      // 🎥 VIDEO
      else if (media.mediaType === 'video') {
        savedMediaType = 'video';
        if (!body) body = '🎬 [Video recibido]';
      }
      
      // 📎 STICKER
      else if (media.mediaType === 'sticker') {
        if (media.messageId) {
          savedMediaUrl = getMediaUrl(sessionName, media.messageId);
        }
        savedMediaType = 'sticker';
        if (!body) body = '🏷️ [Sticker]';
      }
      
      // 📄 DOCUMENTO
      else if (media.mediaType === 'document') {
        savedMediaType = 'document';
        if (!body) body = `📄 [Documento: ${payload?.filename || 'archivo'}]`;
      }
      
      // Desconocido
      else if (!body) {
        body = '📎 [Archivo multimedia recibido]';
        savedMediaType = media.mediaType;
      }
    }

    // Si después de todo aún no hay body, ignorar
    if (!body) {
      res.json({ success: true }); return;
    }

    const recipientId = from.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '');
    const senderName = notifyName || recipientId;

    const userId = await resolveUserFromWebhook(sessionName, recipientId);
    if (!userId) { res.status(400).json({ error: 'No user' }); return; }

    console.log(`💬 ${senderName} (${recipientId}) → session: ${sessionName} ${savedMediaType ? `[${savedMediaType}]` : ''}`);

    // 🔍 Búsqueda flexible de conversación existente
    let conv = await prisma.conversation.findFirst({ where: { userId, recipientId } });
    if (!conv && recipientId.length >= 10) {
      const last10 = recipientId.slice(-10);
      conv = await prisma.conversation.findFirst({ where: { userId, recipientId: { endsWith: last10 } } });
    }
    if (!conv) {
      conv = await prisma.conversation.create({ data: { userId, recipientId, recipientName: senderName, lastMessage: body, stage: 'new' } });
    }

    // ⏸️ COMANDO ".." = PAUSAR IA — inmediato
    if (body.trim() === '..') {
      await prisma.conversation.update({ where: { id: conv.id }, data: { aiPaused: true } });
      await prisma.message.create({ data: { conversationId: conv.id, content: body, fromMe: false, userId, role: 'user' } });
      await setPresence(sessionName, from, 'typing');
      await new Promise(r => setTimeout(r, 1000));
      await stopPresence(sessionName, from);
      const pauseMsg = '🙋‍♂️ Te conecto con un asesor humano. En un momento te atienden.';
      await sendWahaMessage(sessionName, from, pauseMsg);
      await prisma.message.create({ data: { conversationId: conv.id, content: pauseMsg, fromMe: true, userId, role: 'assistant' } });
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: pauseMsg } });
      console.log(`⏸️ IA PAUSADA → ${senderName}`);
      res.json({ success: true }); return;
    }

    // ▶️ COMANDO "." = REACTIVAR IA — inmediato
    if (body.trim() === '.') {
      if (conv.aiPaused) {
        await prisma.conversation.update({ where: { id: conv.id }, data: { aiPaused: false } });
        await prisma.message.create({ data: { conversationId: conv.id, content: body, fromMe: false, userId, role: 'user' } });
        await setPresence(sessionName, from, 'typing');
        await new Promise(r => setTimeout(r, 800));
        await stopPresence(sessionName, from);
        const resumeMsg = '🤖 ¡Hola de nuevo! Soy tu asistente virtual. ¿En qué puedo ayudarte?';
        await sendWahaMessage(sessionName, from, resumeMsg);
        await prisma.message.create({ data: { conversationId: conv.id, content: resumeMsg, fromMe: true, userId, role: 'assistant' } });
        await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: resumeMsg } });
        console.log(`▶️ IA REACTIVADA → ${senderName}`);
      }
      res.json({ success: true }); return;
    }

    // Guardar mensaje en DB (con media si aplica)
    await prisma.message.create({ 
      data: { 
        conversationId: conv.id, 
        content: body, 
        fromMe: false, 
        userId, 
        role: 'user',
        ...(savedMediaType && { mediaType: savedMediaType }),
        ...(savedMediaUrl && { mediaUrl: savedMediaUrl })
      } 
    });
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: body, recipientName: senderName } });

    // Si IA pausada, solo guardar
    if (conv.aiPaused) {
      console.log(`⏸️ IA pausada → ${senderName} (guardado, no responde)`);
      res.json({ success: true }); return;
    }

    // Para audios transcritos, usar solo la transcripción para la IA
    const messageForAI = savedMediaType === 'audio' ? body.replace('🎤 [Audio transcrito]: ', '') : body;

    // ====================================================
    // 📦 MESSAGE BUFFER — Agrupar mensajes en ráfaga
    // Usuario manda varias líneas rápido → espera 3s → responde UNA vez
    // ====================================================
    const bufferKey = `${userId}_${recipientId}`;
    const existingBuffer = messageBuffer.get(bufferKey);

    if (existingBuffer) {
      // Ya hay mensajes en buffer → agregar y resetear timer
      existingBuffer.messages.push(messageForAI);
      clearTimeout(existingBuffer.timer);
      existingBuffer.timer = setTimeout(() => processBufferedMessages(bufferKey), BUFFER_WAIT_MS);
      console.log(`📦 Buffer: +1 de ${senderName} (total: ${existingBuffer.messages.length}, esperando ${BUFFER_WAIT_MS/1000}s más...)`);
    } else {
      // Primer mensaje → crear buffer, mostrar typing inmediato
      const assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true }, select: { voiceEnabled: true, elevenLabsKey: true, selectedVoice: true } });
      const isVoiceMode = !!(assistant?.voiceEnabled && assistant?.elevenLabsKey && assistant?.selectedVoice);

      // Fire-and-forget: el usuario ve "escribiendo..." mientras espera
      if (isVoiceMode) {
        setPresence(sessionName, from, 'recording');
      } else {
        setPresence(sessionName, from, 'typing');
      }

      const timer = setTimeout(() => processBufferedMessages(bufferKey), BUFFER_WAIT_MS);
      messageBuffer.set(bufferKey, {
        messages: [messageForAI],
        timer,
        sessionName,
        from,
        senderName,
        userId,
        convId: conv.id
      });
      console.log(`📦 Buffer: nuevo de ${senderName} → esperando ${BUFFER_WAIT_MS/1000}s por más mensajes...`);
    }

    // Responder inmediatamente al webhook (WAHA no espera)
    res.json({ success: true });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

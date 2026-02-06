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
const recentlyProcessed = new Set<string>(); // Deduplicación de mensajes
const messageBuffer: Map<string, {
  messages: string[];
  timer: ReturnType<typeof setTimeout>;
  sessionName: string;
  from: string;
  senderName: string;
  userId: string;
  convId: string;
  whatsappLineId: string | null;
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
  // 1. ÚNICO MÉTODO: Buscar por sessionName de línea de WhatsApp
  // Cada línea tiene su sessionName único y pertenece a UN solo usuario
  const waLine = await prisma.whatsappLine.findUnique({ 
    where: { sessionName },
    select: { userId: true }
  }).catch(() => null);
  
  if (waLine?.userId) {
    console.log(`📱 Usuario resuelto por línea ${sessionName}: ${waLine.userId}`);
    return waLine.userId;
  }
  
  // 2. Si es una sesión legacy tipo user_xxx (formato antiguo)
  if (sessionName.startsWith('user_')) {
    const uid = sessionName.replace('user_', '');
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, parentUserId: true } });
    if (u) {
      console.log(`📱 Usuario resuelto por sesión legacy: ${u.parentUserId || u.id}`);
      return u.parentUserId || u.id;
    }
  }
  
  // 3. NO buscar por conversación existente - esto causaba mezcla de datos entre usuarios
  // Cada sesión DEBE estar asociada a una línea de WhatsApp con su userId
  console.warn(`⚠️ SESIÓN NO RECONOCIDA: ${sessionName} - No tiene línea de WhatsApp asociada`);
  console.warn(`   → Para mensajes de ${recipientId}, se rechazará hasta que se configure la línea correctamente`);
  return null;
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
// 📥 DOWNLOAD MEDIA FROM WAHA — Multiple strategies
// ====================================================
// Helper: rewrite WAHA internal URLs (localhost:3000) to public VPS URL
const rewriteWahaUrl = (url: string): string => {
  if (!url) return url;
  // WAHA runs internally on port 3000, mapped to 8080 externally
  const replacements = [
    ['http://localhost:3000', WAHA_API_URL],
    ['http://127.0.0.1:3000', WAHA_API_URL],
    ['http://localhost:8080', WAHA_API_URL],
    ['http://127.0.0.1:8080', WAHA_API_URL],
    ['http://0.0.0.0:3000', WAHA_API_URL],
    ['http://0.0.0.0:8080', WAHA_API_URL],
  ];
  for (const [from, to] of replacements) {
    if (url.startsWith(from)) {
      const rewritten = url.replace(from, to);
      console.log(`🔄 URL reescrita: ${url.substring(0, 80)} → ${rewritten.substring(0, 80)}`);
      return rewritten;
    }
  }
  return url;
};

// Helper: fetch with WAHA headers and URL rewriting
const fetchFromWaha = async (url: string): Promise<globalThis.Response> => {
  const rewritten = rewriteWahaUrl(url);
  return fetch(rewritten, { headers: getWahaHeaders() });
};

const downloadMediaFromWaha = async (session: string, messageId: string, payload?: any): Promise<{ buffer: Buffer; mimetype: string } | null> => {
  
  // STRATEGY 1: Base64 data directly in payload (most reliable, no network call)
  if (payload?.media?.data) {
    try {
      const buf = Buffer.from(payload.media.data, 'base64');
      if (buf.length > 100) {
        console.log(`✅ S1: Media de payload.media.data: ${buf.length} bytes`);
        return { buffer: buf, mimetype: payload.media.mimetype || payload?.mimetype || 'audio/ogg' };
      }
    } catch (e: any) { console.log(`⚠️ S1a media.data falló: ${e.message}`); }
  }
  
  if (payload?._data?.body) {
    try {
      const buf = Buffer.from(payload._data.body, 'base64');
      if (buf.length > 100) {
        console.log(`✅ S1b: Media de payload._data.body: ${buf.length} bytes`);
        return { buffer: buf, mimetype: payload?.mimetype || payload?._data?.mimetype || 'audio/ogg' };
      }
    } catch (e: any) { console.log(`⚠️ S1b _data.body falló: ${e.message}`); }
  }

  // STRATEGY 2: mediaUrl from payload (rewrite localhost → public IP)
  if (payload?.mediaUrl) {
    try {
      const url = rewriteWahaUrl(payload.mediaUrl);
      console.log(`📥 S2: mediaUrl: ${url.substring(0, 120)}`);
      const r = await fetch(url, { headers: getWahaHeaders() });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 100) {
          console.log(`✅ S2: Media via mediaUrl: ${buf.length} bytes`);
          return { buffer: buf, mimetype: r.headers.get('content-type') || payload?.mimetype || 'audio/ogg' };
        }
      } else { console.log(`⚠️ S2: mediaUrl ${r.status}`); }
    } catch (e: any) { console.log(`⚠️ S2 mediaUrl falló: ${e.message}`); }
  }

  // STRATEGY 3: media.url field (rewrite localhost → public IP)
  if (payload?.media?.url) {
    try {
      const url = rewriteWahaUrl(payload.media.url);
      console.log(`📥 S3: media.url: ${url.substring(0, 120)}`);
      const r = await fetch(url, { headers: getWahaHeaders() });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 100) {
          console.log(`✅ S3: Media via media.url: ${buf.length} bytes`);
          return { buffer: buf, mimetype: payload.media.mimetype || r.headers.get('content-type') || 'audio/ogg' };
        }
      } else { console.log(`⚠️ S3: media.url ${r.status}`); }
    } catch (e: any) { console.log(`⚠️ S3 media.url falló: ${e.message}`); }
  }

  // STRATEGY 4: WAHA files API — GET /api/files/{filename} (for WHATSAPP_FILES_MIMETYPES)
  if (messageId) {
    try {
      // Try listing files for this session to find matching file
      const filesUrl = `${WAHA_API_URL}/api/files`;
      console.log(`📥 S4: Buscando en files API...`);
      const r = await fetch(filesUrl, { headers: getWahaHeaders() });
      if (r.ok) {
        const text = await r.text();
        try {
          const files = JSON.parse(text);
          if (Array.isArray(files)) {
            // Find file matching messageId
            const shortId = messageId.split('_').pop() || messageId;
            const match = files.find((f: any) => {
              const fname = typeof f === 'string' ? f : f?.name || f?.filename || f?.path || '';
              return fname.includes(shortId) || fname.includes(messageId);
            });
            if (match) {
              const fname = typeof match === 'string' ? match : match?.name || match?.filename || match?.path || '';
              const fileUrl = `${WAHA_API_URL}/api/files/${fname}`;
              console.log(`📥 S4: Descargando archivo: ${fileUrl.substring(0, 120)}`);
              const fr = await fetch(fileUrl, { headers: getWahaHeaders() });
              if (fr.ok) {
                const buf = Buffer.from(await fr.arrayBuffer());
                if (buf.length > 100) {
                  console.log(`✅ S4: Media via files API: ${buf.length} bytes`);
                  return { buffer: buf, mimetype: fr.headers.get('content-type') || payload?.mimetype || 'audio/ogg' };
                }
              }
            } else {
              console.log(`⚠️ S4: No se encontró archivo para ${shortId} entre ${files.length} archivos`);
            }
          }
        } catch { console.log(`⚠️ S4: Respuesta no es JSON, probablemente HTML/404`); }
      } else { console.log(`⚠️ S4: files API ${r.status}`); }
    } catch (e: any) { console.log(`⚠️ S4 files API falló: ${e.message}`); }
  }

  // STRATEGY 5: WAHA API — POST /api/{session}/messages/download
  if (messageId) {
    try {
      const postUrl = `${WAHA_API_URL}/api/${session}/messages/download`;
      console.log(`📥 S5: POST ${postUrl.substring(0, 80)} id: ${messageId.substring(0, 60)}`);
      const r = await fetch(postUrl, { 
        method: 'POST', 
        headers: getWahaHeaders(), 
        body: JSON.stringify({ id: messageId }) 
      });
      if (r.ok) {
        const contentType = r.headers.get('content-type') || 'application/octet-stream';
        if (!contentType.includes('json')) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 100) {
            console.log(`✅ S5: Media via POST: ${buf.length} bytes (${contentType})`);
            return { buffer: buf, mimetype: contentType };
          }
        }
      } else { console.log(`⚠️ S5: POST ${r.status}`); }
    } catch (e: any) { console.log(`⚠️ S5 POST falló: ${e.message}`); }
  }

  // STRATEGY 6: WAHA API — GET with URL-encoded messageId (multiple endpoint formats)
  if (messageId) {
    const encodedId = encodeURIComponent(messageId);
    const endpoints = [
      `${WAHA_API_URL}/api/${session}/messages/${encodedId}/download`,
      `${WAHA_API_URL}/api/messages/${encodedId}/download?session=${session}`,
      `${WAHA_API_URL}/api/${session}/messages/${encodedId}/download-media`,
    ];
    
    for (const url of endpoints) {
      try {
        console.log(`📥 S6: GET ${url.substring(0, 120)}`);
        const r = await fetch(url, { headers: getWahaHeaders() });
        if (r.ok) {
          const contentType = r.headers.get('content-type') || 'application/octet-stream';
          if (!contentType.includes('json')) {
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length > 100) {
              console.log(`✅ S6: Media via GET: ${buf.length} bytes (${contentType})`);
              return { buffer: buf, mimetype: contentType };
            }
          }
        } else { console.log(`⚠️ S6: GET ${r.status}: ${url.substring(0, 80)}`); }
      } catch (e: any) { console.log(`⚠️ S6 GET falló: ${e.message}`); }
    }
  }
  
  console.error(`❌ No se pudo descargar media: session=${session}, messageId=${messageId?.substring(0, 60)}`);
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
  const hasMedia = !!(
    payload?.hasMedia || 
    payload?.media || 
    payload?.mediaUrl || 
    payload?._data?.mediaData ||
    payload?.type === 'ptt' ||
    payload?.type === 'audio' ||
    payload?.type === 'image' ||
    payload?.type === 'video' ||
    payload?.type === 'sticker' ||
    payload?.type === 'document'
  );
  
  const mimetype = payload?.mimetype || payload?.media?.mimetype || payload?._data?.mimetype || payload?.mediaData?.mimetype || '';
  const messageId = payload?.id?._serialized || payload?.id?.id || payload?.key?.id || (typeof payload?.id === 'string' ? payload.id : '') || '';
  const caption = payload?.caption || '';
  const mediaUrl = payload?.mediaUrl || payload?.media?.url || '';
  
  let mediaType = 'unknown';
  const typeField = payload?.type || payload?.messageType || '';
  
  // Check by WAHA type field first (most reliable)
  if (typeField === 'ptt' || typeField === 'audio') {
    mediaType = 'audio';
  } else if (typeField === 'image') {
    mediaType = 'image';
  } else if (typeField === 'video') {
    mediaType = 'video';
  } else if (typeField === 'document') {
    mediaType = 'document';
  } else if (typeField === 'sticker') {
    mediaType = 'sticker';
  }
  // Fallback to mimetype
  else if (mimetype.startsWith('audio/') || mimetype.includes('ogg') || mimetype.includes('opus')) {
    mediaType = 'audio';
  } else if (mimetype.startsWith('image/')) {
    mediaType = 'image';
  } else if (mimetype.startsWith('video/')) {
    mediaType = 'video';
  } else if (mimetype.startsWith('application/')) {
    mediaType = 'document';
  }
  
  if (hasMedia) {
    console.log(`🔍 Media detectada: type=${typeField}, mediaType=${mediaType}, mime=${mimetype}, id=${messageId}, hasMediaUrl=${!!mediaUrl}, hasMediaData=${!!(payload?.media?.data || payload?._data?.body)}`);
  }
  
  return { hasMedia, mediaType, mimetype, messageId, caption, mediaUrl };
};

// ===== AI RESPONSE (🧠 MEMORIA PERSISTENTE + AUTO-APRENDIZAJE) =====
const generateAIResponse = async (ownerId: string, message: string, conversationId: string, whatsappLineId?: string | null): Promise<string | null> => {
  try {
    const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { apiKey: true, apiKeyConnected: true } });
    if (!user?.apiKey || !user.apiKeyConnected) return null;

    let assistant = null;

    // 🔗 PRIMERO: Buscar asistente específico de esta línea
    if (whatsappLineId) {
      assistant = await prisma.assistant.findFirst({ 
        where: { userId: ownerId, whatsappLineId: whatsappLineId } 
      });
      if (assistant) {
        console.log(`📋 Asistente de LÍNEA "${assistant.name}" (lineId: ${whatsappLineId})`);
      }
    }

    // 🔄 FALLBACK: Si no hay asistente de línea, usar el activo global
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true }, orderBy: { updatedAt: 'desc' } });
      if (!assistant) {
        assistant = await prisma.assistant.findFirst({ where: { userId: ownerId }, orderBy: { updatedAt: 'desc' } });
        if (assistant) await prisma.assistant.update({ where: { id: assistant.id }, data: { isActive: true } });
        else return null;
      }
      console.log(`📋 Asistente GLOBAL "${assistant.name}" (sin asistente específico de línea)`);
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

    // 🎯 CARGAR ETAPAS DEL PIPELINE DE LA LÍNEA
    let pipelineStages: any[] = [];
    if (whatsappLineId) {
      const line = await prisma.whatsappLine.findUnique({ 
        where: { id: whatsappLineId }, 
        select: { customStages: true } 
      });
      if (line?.customStages && Array.isArray(line.customStages)) {
        pipelineStages = line.customStages as any[];
      }
    }
    
    // Si no hay etapas configuradas, usar default
    if (pipelineStages.length === 0) {
      pipelineStages = [
        { id: 'Saludo', label: 'Saludo' },
        { id: 'Interesado', label: 'Interesado' },
        { id: 'En Cotización', label: 'En Cotización' },
        { id: 'Pendiente Info', label: 'Pendiente Info' },
        { id: 'Realizó Pedido', label: 'Realizó Pedido' },
        { id: 'Confirmado', label: 'Confirmado' },
        { id: 'Perdido', label: 'Perdido' }
      ];
    }
    
    const stagesList = pipelineStages.map((s: any) => s.id || s.label).join(', ');

    // 🧠 INSTRUCCIONES DE MEMORIA — Esto le dice a la IA que devuelva un bloque de datos
    promptParts.push(`
=== REGLAS DE MEMORIA (OBLIGATORIO) ===

1. NUNCA preguntes algo que el cliente ya dijo en la conversación o que esté en la MEMORIA GUARDADA.
2. Si ya sabes el nombre, talla, color, ciudad, cantidad, calidad u OTRO dato — ÚSALO, no lo vuelvas a preguntar.
3. Lee TODO el historial antes de responder. Si el cliente mencionó algo antes, recuérdalo.
4. Si el cliente vuelve después de días, salúdalo por su nombre y retoma donde quedaron.
5. Responde de forma natural, como un humano por WhatsApp.

=== ETAPAS DEL PIPELINE (DETECCIÓN AUTOMÁTICA) ===
Las etapas disponibles son: ${stagesList}

⚠️ IMPORTANTE: Detecta la etapa basándote en QUÉ INFORMACIÓN YA TIENES del cliente:

REGLA DE DETECCIÓN (seguir en orden):
1. Si el cliente dijo "no me interesa", "no gracias", "ya no quiero" → etapa_actual = "Perdido"
2. Si YA tienes fecha_entrega Y datos de envío completos → etapa_actual = "Confirmado"
3. Si YA tienes todos los datos del pedido PERO falta fecha_entrega → etapa_actual = "Pendiente Entrega"
4. Si YA confirmó que quiere comprar PERO falta método de pago → etapa_actual = "Pendiente Pago"
5. Si YA tienes nombre, talla, color, calidad, cantidad, ciudad → etapa_actual = "Realizó Pedido"
6. Si FALTA la calidad (Premium/Mónaco) → etapa_actual = "Pendiente Calidad"
7. Si FALTA la talla → etapa_actual = "Pendiente Talla"
8. Si FALTA el color → etapa_actual = "Pendiente Color"
9. Si mostró interés, preguntó por precios o productos → etapa_actual = "En Cotización"
10. Si preguntó algo pero no ha dado datos → etapa_actual = "Interesado"
11. Si solo saludó → etapa_actual = "Saludo"

=== BLOQUE DE MEMORIA (OBLIGATORIO AL FINAL) ===

AL FINAL de CADA respuesta, DEBES incluir un bloque de memoria con TODA la información que has recopilado del cliente.
El formato EXACTO es (incluye la línea tal cual):

<<MEMORY_JSON>>{"nombre":"","tipo":"","talla":"","color":"","calidad":"","cantidad":"","ciudad":"","direccion":"","barrio":"","celular":"","precio_unitario":"","descuento":"","envio":"","total":"","metodo_pago":"","fecha_entrega":"","pedido":"","etapa_actual":"","accion":""}<<END_MEMORY>>

REGLAS del bloque de memoria:
- Llena SOLO los campos que ya conoces. Deja vacío "" lo que NO sabes aún.
- "etapa_actual" = OBLIGATORIO. Usa la REGLA DE DETECCIÓN de arriba para determinar la etapa correcta.
- "accion" = Cuando el cliente confirme la FECHA DE ENTREGA, pon "crear_pedido". Esto agenda automáticamente.
- SIEMPRE incluye este bloque, incluso si no tienes datos nuevos.
- El bloque va DESPUÉS de tu respuesta al cliente, en la última línea.
- NO expliques el bloque al cliente, es interno.
- ACTUALIZA la etapa en CADA mensaje según los datos que ya tienes.`);

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

          // 🧠 EXTRAER Y GUARDAR BLOQUE DE MEMORIA + DETECTAR ETAPA AUTOMÁTICA
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
              
              // 🎯 DETECTAR ETAPA AUTOMÁTICA
              const detectedStage = memoryData.etapa_actual || memoryData.paso_actual || '';
              const actionToTake = memoryData.accion || '';
              
              // Actualizar conversación con memoria Y etapa
              const updateData: any = { contextData: merged };
              if (detectedStage) {
                // Verificar que la etapa existe en el pipeline
                const validStage = pipelineStages.find((s: any) => 
                  s.id === detectedStage || s.label === detectedStage ||
                  s.id?.toLowerCase() === detectedStage.toLowerCase() ||
                  s.label?.toLowerCase() === detectedStage.toLowerCase()
                );
                if (validStage) {
                  updateData.stage = validStage.id || validStage.label;
                  console.log(`🎯 Etapa automática: ${updateData.stage}`);
                }
              }
              
              await prisma.conversation.update({
                where: { id: conversationId },
                data: updateData
              });
              
              console.log(`🧠 Memoria guardada: ${JSON.stringify(merged)}`);
              
              // 🛒 CREAR PEDIDO AUTOMÁTICO CON FECHA DE ENTREGA
              if (actionToTake === 'crear_pedido' && merged.pedido !== 'creado') {
                try {
                  // Parsear fecha de entrega si existe
                  let deliveryDate = new Date();
                  if (merged.fecha_entrega) {
                    // Intentar parsear diferentes formatos de fecha
                    const fechaStr = merged.fecha_entrega.toLowerCase();
                    const hoy = new Date();
                    
                    if (fechaStr.includes('mañana') || fechaStr.includes('manana')) {
                      deliveryDate = new Date(hoy);
                      deliveryDate.setDate(deliveryDate.getDate() + 1);
                    } else if (fechaStr.includes('pasado')) {
                      deliveryDate = new Date(hoy);
                      deliveryDate.setDate(deliveryDate.getDate() + 2);
                    } else {
                      // Intentar parsear fecha específica (ej: "10 de febrero", "2025-02-10")
                      const parsed = new Date(merged.fecha_entrega);
                      if (!isNaN(parsed.getTime())) {
                        deliveryDate = parsed;
                      }
                    }
                  }
                  
                  const orderData = {
                    userId: ownerId,
                    type: 'order',
                    clientName: merged.nombre || clientName || 'Cliente WhatsApp',
                    clientPhone: clientPhone.replace('@c.us', ''),
                    date: deliveryDate,
                    time: '14:00', // Entregas de 2 PM a 7 PM
                    duration: 300, // 5 horas (2 PM - 7 PM)
                    status: 'pending',
                    notes: `📦 PEDIDO WHATSAPP\n` +
                           `━━━━━━━━━━━━━━━\n` +
                           `👕 Producto: Buzo ${merged.color || ''} - Talla ${merged.talla || ''}\n` +
                           `✨ Calidad: ${merged.calidad || 'N/A'}\n` +
                           `📦 Cantidad: ${merged.cantidad || '1'}\n` +
                           `💵 Total: $${merged.total || '0'}\n` +
                           `💳 Pago: ${merged.metodo_pago || 'Contra entrega'}\n` +
                           `━━━━━━━━━━━━━━━\n` +
                           `📍 Dirección: ${merged.direccion || ''}\n` +
                           `🏘️ Barrio: ${merged.barrio || ''}\n` +
                           `🏙️ Ciudad: ${merged.ciudad || ''}\n` +
                           `━━━━━━━━━━━━━━━\n` +
                           `🕑 Horario: 2:00 PM - 7:00 PM`,
                    total: parseFloat(merged.total?.replace(/[^0-9]/g, '')) || 0,
                    address: `${merged.direccion || ''}, ${merged.barrio || ''}, ${merged.ciudad || ''}`.trim(),
                    whatsappLineId: whatsappLineId || null
                  };
                  await prisma.appointment.create({ data: orderData });
                  // Marcar pedido como creado
                  merged.pedido = 'creado';
                  await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { contextData: merged }
                  });
                  console.log(`🛒 Pedido agendado para ${deliveryDate.toLocaleDateString('es-CO')} - ${merged.nombre || clientName}`);
                } catch (orderErr: any) {
                  console.error('❌ Error creando pedido:', orderErr.message);
                }
              }
              
              // 📅 CREAR CITA AUTOMÁTICA
              if (actionToTake === 'crear_cita' && merged.cita !== 'creada') {
                try {
                  const appointmentData = {
                    userId: ownerId,
                    type: 'appointment',
                    clientName: merged.nombre || clientName || 'Cliente WhatsApp',
                    clientPhone: clientPhone.replace('@c.us', ''),
                    date: merged.fecha_cita ? new Date(merged.fecha_cita) : new Date(),
                    time: merged.hora_cita || '10:00',
                    status: 'pending',
                    notes: `Cita agendada automáticamente desde WhatsApp.\n${merged.notas_cita || ''}`,
                    address: merged.direccion || merged.ciudad || '',
                    whatsappLineId: whatsappLineId || null
                  };
                  await prisma.appointment.create({ data: appointmentData });
                  // Marcar cita como creada
                  merged.cita = 'creada';
                  await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { contextData: merged }
                  });
                  console.log(`📅 Cita creada automáticamente para ${merged.nombre || clientName}`);
                } catch (citaErr: any) {
                  console.error('❌ Error creando cita:', citaErr.message);
                }
              }
              
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

  const { messages: msgs, sessionName, from, senderName, userId, convId, whatsappLineId } = buf;
  const combinedMessage = msgs.join('\n');

  console.log(`📦 Buffer procesado: ${msgs.length} mensaje(s) de ${senderName} → "${combinedMessage.substring(0, 100)}..." (lineId: ${whatsappLineId || 'global'})`);

  try {
    // 🔗 Buscar asistente específico de la línea primero
    let assistant = null;
    if (whatsappLineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId, whatsappLineId } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true } });
    }
    
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
      const aiResponse = await generateAIResponse(userId, combinedMessage, convId, whatsappLineId);
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
      const aiResponse = await generateAIResponse(userId, combinedMessage, convId, whatsappLineId);
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

// ====================================================
// 📱 WHATSAPP LINES CRUD (Multi-línea)
// ====================================================

// GET /lines — Listar líneas del usuario
router.get('/lines', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    
    const lines = await prisma.whatsappLine.findMany({
      where: { userId: ownerId },
      orderBy: { createdAt: 'asc' }
    });
    
    // Actualizar status de cada línea consultando WAHA
    const updatedLines = await Promise.all(lines.map(async (line) => {
      try {
        const r = await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}`, { headers: getWahaHeaders() });
        if (r.ok) {
          const data = await r.json() as any;
          const wahaStatus = data.status || 'STOPPED';
          const isConnected = ['WORKING', 'CONNECTED'].includes(wahaStatus);
          const phone = data.me?.id?.replace('@c.us', '') || line.phone;
          const newStatus = isConnected ? 'connected' : wahaStatus === 'SCAN_QR_CODE' ? 'qr' : 'disconnected';
          
          // Actualizar en DB si cambió
          if (newStatus !== line.status || (phone && phone !== line.phone)) {
            await prisma.whatsappLine.update({
              where: { id: line.id },
              data: { status: newStatus, ...(phone ? { phone } : {}) }
            }).catch(() => {});
          }
          
          return { ...line, status: newStatus, phone: phone || line.phone, pushName: data.me?.pushName };
        }
      } catch {}
      return { ...line, status: line.status || 'disconnected' };
    }));
    
    res.json({ lines: updatedLines });
  } catch (e: any) {
    console.error('Error listando líneas:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /lines — Crear nueva línea
router.post('/lines', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    
    const { label, assignedTo, assistantId } = req.body;
    
    // Generar nombre de sesión único
    const sessionName = `line_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`;
    
    // Buscar nombre del asignado si hay
    let assignedName: string | null = null;
    if (assignedTo) {
      const member = await prisma.user.findUnique({ where: { id: assignedTo }, select: { name: true } });
      assignedName = member?.name || null;
    }
    
    const line = await prisma.whatsappLine.create({
      data: {
        userId: ownerId,
        label: label || 'Nueva Línea',
        sessionName,
        assignedTo: assignedTo || null,
        assignedName,
        assistantId: assistantId || null,
        status: 'disconnected'
      }
    });
    
    console.log(`📱 Línea creada: ${line.id} (${sessionName})`);
    res.json({ line, success: true });
  } catch (e: any) {
    console.error('Error creando línea:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /lines/:id — Actualizar línea
router.put('/lines/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    
    const { id } = req.params;
    const { label, assignedTo, assistantId } = req.body;
    
    // Verificar que la línea pertenece al usuario
    const existing = await prisma.whatsappLine.findFirst({ where: { id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'Línea no encontrada' }); return; }
    
    let assignedName: string | null = null;
    if (assignedTo) {
      const member = await prisma.user.findUnique({ where: { id: assignedTo }, select: { name: true } });
      assignedName = member?.name || null;
    }
    
    const line = await prisma.whatsappLine.update({
      where: { id },
      data: {
        ...(label !== undefined ? { label } : {}),
        ...(assignedTo !== undefined ? { assignedTo: assignedTo || null, assignedName } : {}),
        ...(assistantId !== undefined ? { assistantId: assistantId || null } : {})
      }
    });
    
    res.json({ line, success: true });
  } catch (e: any) {
    console.error('Error actualizando línea:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /lines/:id — Eliminar línea
router.delete('/lines/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    
    const { id } = req.params;
    const line = await prisma.whatsappLine.findFirst({ where: { id, userId: ownerId } });
    if (!line) { res.status(404).json({ error: 'Línea no encontrada' }); return; }
    
    // Detener sesión en WAHA si existe
    try {
      await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}/stop`, { method: 'POST', headers: getWahaHeaders() });
    } catch {}
    
    await prisma.whatsappLine.delete({ where: { id } });
    console.log(`🗑️ Línea eliminada: ${line.id} (${line.sessionName})`);
    res.json({ success: true });
  } catch (e: any) {
    console.error('Error eliminando línea:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /lines/:id/connect — Conectar línea (crear sesión WAHA + QR)
router.post('/lines/:id/connect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    
    const { id } = req.params;
    const line = await prisma.whatsappLine.findFirst({ where: { id, userId: ownerId } });
    if (!line) { res.status(404).json({ error: 'Línea no encontrada' }); return; }
    
    const webhookUrl = `${BACKEND_URL}/api/webhook/whatsapp`;
    
    // Verificar si ya existe en WAHA
    const check = await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}`, { headers: getWahaHeaders() });
    
    if (check.status === 404) {
      // Crear sesión nueva
      await fetch(`${WAHA_API_URL}/api/sessions`, {
        method: 'POST', headers: getWahaHeaders(),
        body: JSON.stringify({
          name: line.sessionName,
          start: true,
          config: { webhooks: [{ url: webhookUrl, events: ['message', 'session.status'] }] }
        })
      });
      console.log(`📱 Sesión WAHA creada: ${line.sessionName}`);
    } else {
      const data = await check.json() as any;
      if (['STOPPED', 'FAILED'].includes(data.status)) {
        await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}/start`, { method: 'POST', headers: getWahaHeaders() });
      }
      // Actualizar webhooks
      await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}`, {
        method: 'PUT', headers: getWahaHeaders(),
        body: JSON.stringify({ config: { webhooks: [{ url: webhookUrl, events: ['message', 'session.status'] }] } })
      });
    }
    
    await prisma.whatsappLine.update({ where: { id }, data: { status: 'connecting' } });
    res.json({ success: true, session: line.sessionName });
  } catch (e: any) {
    console.error('Error conectando línea:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /lines/:id/disconnect — Desconectar línea
router.post('/lines/:id/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    
    const { id } = req.params;
    const line = await prisma.whatsappLine.findFirst({ where: { id, userId: ownerId } });
    if (!line) { res.status(404).json({ error: 'Línea no encontrada' }); return; }
    
    try {
      await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}/stop`, { method: 'POST', headers: getWahaHeaders() });
    } catch {}
    
    await prisma.whatsappLine.update({ where: { id }, data: { status: 'disconnected', phone: null } });
    res.json({ success: true });
  } catch (e: any) {
    console.error('Error desconectando línea:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /lines/:id/qr — Obtener QR de una línea
router.get('/lines/:id/qr', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    
    const { id } = req.params;
    const line = await prisma.whatsappLine.findFirst({ where: { id, userId: ownerId } });
    if (!line) { res.status(404).json({ error: 'Línea no encontrada' }); return; }
    
    let qrData: string | null = null;
    
    // Intentar obtener QR de WAHA
    try {
      const r = await fetch(`${WAHA_API_URL}/api/${line.sessionName}/auth/qr`, { headers: { ...getWahaHeaders(), 'Accept': 'application/json' } });
      if (r.ok) {
        const d = await r.json() as any;
        if (d.mimetype && d.data) qrData = `data:${d.mimetype};base64,${d.data}`;
      }
    } catch {}
    
    if (!qrData) {
      try {
        const r = await fetch(`${WAHA_API_URL}/api/${line.sessionName}/auth/qr`, { headers: { ...getWahaHeaders(), 'Accept': 'image/png' } });
        if (r.ok && r.headers.get('content-type')?.includes('image')) {
          const buf = Buffer.from(await r.arrayBuffer());
          qrData = `data:image/png;base64,${buf.toString('base64')}`;
        }
      } catch {}
    }
    
    if (!qrData) {
      try {
        const r = await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}/auth/qr`, { headers: { ...getWahaHeaders(), 'Accept': 'application/json' } });
        if (r.ok) {
          const d = await r.json() as any;
          if (d.mimetype && d.data) qrData = `data:${d.mimetype};base64,${d.data}`;
        }
      } catch {}
    }
    
    // Check if connected (no QR needed)
    if (!qrData) {
      try {
        const r = await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}`, { headers: getWahaHeaders() });
        if (r.ok) {
          const data = await r.json() as any;
          if (['WORKING', 'CONNECTED'].includes(data.status)) {
            const phone = data.me?.id?.replace('@c.us', '') || null;
            await prisma.whatsappLine.update({ where: { id }, data: { status: 'connected', ...(phone ? { phone } : {}) } }).catch(() => {});
            res.json({ qr: null, available: false, connected: true, phone });
            return;
          }
        }
      } catch {}
    }
    
    res.json({ qr: qrData, available: !!qrData });
  } catch (e: any) {
    res.json({ qr: null, available: false });
  }
});

// ===== RUTAS LEGACY (compatibilidad) =====

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
            webhooks: [{ url: webhookUrl, events: ['message', 'session.status'] }]
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

// ====================================================
// 🔄 RECONFIGURAR WEBHOOKS DE WAHA (para sesión existente)
// ====================================================
router.post('/reconfigure-webhooks', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const session = await findActiveSession(ownerId);
    if (!session) { res.status(400).json({ error: 'No hay sesión activa' }); return; }
    
    const sessionName = session.name;
    const webhookUrl = `${BACKEND_URL}/api/webhook/whatsapp`;
    
    // Actualizar configuración de la sesión con SOLO 'message' (no message.any)
    const updateRes = await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}`, {
      method: 'PUT',
      headers: getWahaHeaders(),
      body: JSON.stringify({
        config: {
          webhooks: [{ 
            url: webhookUrl, 
            events: ['message', 'session.status']
          }]
        }
      })
    });
    
    const result = await updateRes.json().catch(() => ({}));
    console.log(`🔄 Webhooks reconfigurados para ${sessionName}: ${updateRes.status}`);
    
    res.json({ 
      success: updateRes.ok, 
      message: updateRes.ok ? 'Webhooks reconfigurados' : 'Error al reconfigurar',
      session: sessionName,
      webhookUrl,
      events: ['message', 'session.status']
    });
  } catch (e: any) {
    console.error('❌ Error reconfigurando:', e.message);
    res.status(500).json({ error: e.message });
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

    // 🔒 DEDUPLICACIÓN: Ignorar si ya procesamos este mensaje (WAHA envía message + message.any)
    const msgId = payload?.id?._serialized || payload?.id?.id || payload?.key?.id || '';
    if (msgId && recentlyProcessed.has(msgId)) {
      console.log(`🔄 Duplicado ignorado: ${msgId}`);
      res.json({ success: true }); return;
    }
    if (msgId) {
      recentlyProcessed.add(msgId);
      setTimeout(() => recentlyProcessed.delete(msgId), 30000); // Limpiar después de 30s
    }

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
      // 🔍 LOG COMPLETO del payload para debugging
      console.log(`📎 === MEDIA PAYLOAD DEBUG ===`);
      console.log(`📎 type: ${payload?.type}`);
      console.log(`📎 hasMedia: ${payload?.hasMedia}`);
      console.log(`📎 mimetype: ${payload?.mimetype}`);
      console.log(`📎 mediaUrl (RAW): ${payload?.mediaUrl || 'N/A'}`);
      console.log(`📎 media keys: ${payload?.media ? Object.keys(payload.media).join(', ') : 'NO media obj'}`);
      console.log(`📎 media.url (RAW): ${payload?.media?.url || 'N/A'}`);
      console.log(`📎 media.data length: ${payload?.media?.data ? payload.media.data.length : 'N/A'}`);
      console.log(`📎 media.mimetype: ${payload?.media?.mimetype || 'N/A'}`);
      console.log(`📎 media.filename: ${payload?.media?.filename || 'N/A'}`);
      console.log(`📎 id: ${JSON.stringify(payload?.id || '').substring(0, 200)}`);
      console.log(`📎 _data keys: ${payload?._data ? Object.keys(payload._data).slice(0, 15).join(', ') : 'NO _data'}`);
      console.log(`📎 _data.body length: ${payload?._data?.body ? payload._data.body.length : 'N/A'}`);
      console.log(`📎 _data.deprecatedMms3Url: ${payload?._data?.deprecatedMms3Url?.substring(0, 100) || 'N/A'}`);
      console.log(`📎 ALL TOP KEYS: ${Object.keys(payload || {}).join(', ')}`);
      console.log(`📎 === END DEBUG ===`);
      
      // 🎤 AUDIO → Transcribir con Whisper
      if (media.mediaType === 'audio') {
        const recipientIdTemp = from.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '');
        const userIdTemp = await resolveUserFromWebhook(sessionName, recipientIdTemp);
        if (userIdTemp) {
          const user = await prisma.user.findUnique({ where: { id: userIdTemp }, select: { apiKey: true } });
          if (user?.apiKey) {
            const downloaded = await downloadMediaFromWaha(sessionName, media.messageId, payload);
            if (downloaded) {
              const transcript = await transcribeAudio(downloaded.buffer, user.apiKey);
              if (transcript) {
                body = transcript; // Solo la transcripción para el body/buffer
                savedMediaType = 'audio';
                console.log(`🎤 Audio transcrito: "${transcript.substring(0, 100)}"`);
              } else {
                body = body || '🎤 [Audio - no se pudo transcribir]';
                savedMediaType = 'audio';
              }
            } else {
              body = body || '🎤 [Audio recibido]';
              savedMediaType = 'audio';
            }
          } else {
            body = body || '🎤 [Audio recibido - sin API key]';
            savedMediaType = 'audio';
          }
        }
      }
      
      // 🖼️ IMAGEN → Guardar para mostrar en chat
      else if (media.mediaType === 'image') {
        // Intentar descargar y guardar como base64 para el chat
        if (media.messageId || media.mediaUrl) {
          const downloaded = await downloadMediaFromWaha(sessionName, media.messageId, payload);
          if (downloaded) {
            savedMediaUrl = `data:${downloaded.mimetype};base64,${downloaded.buffer.toString('base64')}`;
            console.log(`🖼️ Imagen guardada como base64: ${downloaded.buffer.length} bytes`);
          } else {
            savedMediaUrl = getMediaUrl(sessionName, media.messageId);
          }
        }
        savedMediaType = 'image';
        if (!body && media.caption) body = media.caption;
        if (!body) body = '📷 [Imagen]';
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

    // 🔗 Buscar whatsappLineId por sessionName
    const waLine = await prisma.whatsappLine.findUnique({ where: { sessionName } }).catch(() => null);
    const whatsappLineId = waLine?.id || null;

    console.log(`💬 ${senderName} (${recipientId}) → session: ${sessionName} line: ${whatsappLineId || 'none'} ${savedMediaType ? `[${savedMediaType}]` : ''}`);

    // 🔍 Búsqueda de conversación POR LÍNEA (cada línea tiene su propia conversación)
    let conv = null;
    
    if (whatsappLineId) {
      // Buscar conversación específica de esta línea
      conv = await prisma.conversation.findFirst({ where: { userId, recipientId, whatsappLineId } });
      if (!conv && recipientId.length >= 10) {
        const last10 = recipientId.slice(-10);
        conv = await prisma.conversation.findFirst({ where: { userId, recipientId: { endsWith: last10 }, whatsappLineId } });
      }
    } else {
      // Sin línea: buscar conversación global (legacy)
      conv = await prisma.conversation.findFirst({ where: { userId, recipientId, whatsappLineId: null } });
      if (!conv && recipientId.length >= 10) {
        const last10 = recipientId.slice(-10);
        conv = await prisma.conversation.findFirst({ where: { userId, recipientId: { endsWith: last10 }, whatsappLineId: null } });
      }
    }
    
    // Crear nueva conversación si no existe
    if (!conv) {
      conv = await prisma.conversation.create({ 
        data: { userId, recipientId, recipientName: senderName, lastMessage: body, stage: 'new', ...(whatsappLineId ? { whatsappLineId } : {}) } 
      });
      console.log(`🆕 Nueva conversación creada para línea ${whatsappLineId || 'global'}`);
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
    const displayContent = savedMediaType === 'audio' 
      ? `🎤 ${body}` 
      : body;
    
    await prisma.message.create({ 
      data: { 
        conversationId: conv.id, 
        content: displayContent, 
        fromMe: false, 
        userId, 
        role: 'user',
        ...(savedMediaType && { mediaType: savedMediaType }),
        ...(savedMediaUrl && { mediaUrl: savedMediaUrl })
      } 
    });
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: displayContent, recipientName: senderName } });

    // Si IA pausada, solo guardar
    if (conv.aiPaused) {
      console.log(`⏸️ IA pausada → ${senderName} (guardado, no responde)`);
      res.json({ success: true }); return;
    }

    // Para la IA, usar la transcripción limpia (sin emojis/prefijos)
    const messageForAI = body;

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
      // Buscar asistente de la línea para verificar modo voz
      let assistant = null;
      if (whatsappLineId) {
        assistant = await prisma.assistant.findFirst({ where: { userId, whatsappLineId }, select: { voiceEnabled: true, elevenLabsKey: true, selectedVoice: true } });
      }
      if (!assistant) {
        assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true }, select: { voiceEnabled: true, elevenLabsKey: true, selectedVoice: true } });
      }
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
        convId: conv.id,
        whatsappLineId
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

// =====================================================
// 🔄 RE-ANALIZAR TODAS LAS CONVERSACIONES (Asignar etapas)
// Este endpoint analiza el historial de cada conversación
// y asigna automáticamente la etapa correcta
// =====================================================
router.post('/analyze-stages', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    // Verificar token
    const jwt = await import('jsonwebtoken');
    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'bizonne-secret-2024') as any;
    } catch (e) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    
    // El userId puede estar en diferentes campos del token
    const userId = decoded.userId || decoded.id || decoded.sub;
    if (!userId) {
      console.error('❌ Token sin userId:', decoded);
      return res.status(401).json({ error: 'Token sin userId' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, apiKey: true, parentUserId: true }
    });
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    const ownerId = user.parentUserId || user.id;
    const { lineId } = req.body;

    // Etapas fijas para el análisis (las más comunes en ventas)
    const pipelineStages = [
      { id: 'Saludo', label: 'Saludo' },
      { id: 'Interesado', label: 'Interesado' },
      { id: 'En Cotización', label: 'En Cotización' },
      { id: 'Pendiente Color', label: 'Pendiente Color' },
      { id: 'Pendiente Talla', label: 'Pendiente Talla' },
      { id: 'Pendiente Info', label: 'Pendiente Info' },
      { id: 'Realizó Pedido', label: 'Realizó Pedido' },
      { id: 'Pendiente Pago', label: 'Pendiente Pago' },
      { id: 'Confirmado', label: 'Confirmado' },
      { id: 'Perdido', label: 'Perdido' }
    ];

    const stagesList = pipelineStages.map((s: any) => s.label || s.id).join(', ');

    // Obtener todas las conversaciones
    const whereClause: any = { userId: ownerId };
    if (lineId) whereClause.whatsappLineId = lineId;

    const conversations = await prisma.conversation.findMany({
      where: whereClause,
      include: {
        messages: {
          orderBy: { timestamp: 'desc' },
          take: 15 // Últimos 15 mensajes para análisis
        }
      }
    });

    console.log(`🔄 Analizando ${conversations.length} conversaciones...`);

    let updated = 0;
    let errors = 0;

    // Analizar cada conversación
    for (const conv of conversations) {
      try {
        if (!conv.messages.length) continue;

        // Construir historial de la conversación
        const history = conv.messages.reverse().map(m => 
          `${m.fromMe ? 'ASISTENTE' : 'CLIENTE'}: ${m.content}`
        ).join('\n');

        // Prompt para detectar etapa
        const prompt = `Analiza esta conversación de WhatsApp y determina en qué etapa del pipeline de ventas se encuentra.

ETAPAS DISPONIBLES: ${stagesList}

CRITERIOS:
- Saludo = Solo saludos iniciales, aún no se conoce interés
- Interesado = Mostró interés en el producto/servicio
- En Cotización = Está preguntando precios, detalles, opciones
- Pendiente Color = Falta que elija color (si aplica)
- Pendiente Talla = Falta que confirme talla (si aplica)
- Pendiente Info = Falta información (datos de envío, cantidad, etc.)
- Realizó Pedido = Confirmó que quiere comprar
- Confirmado = Pedido completo con todos los datos
- Perdido = Dijo que no le interesa o dejó de responder hace mucho

CONVERSACIÓN:
${history}

Responde SOLO con el nombre exacto de la etapa (ejemplo: "En Cotización"). Nada más.`;

        // Llamar a OpenAI
        const apiKey = user.apiKey || process.env.OPENAI_API_KEY;
        if (!apiKey) continue;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 50,
            temperature: 0.3
          })
        });

        if (response.ok) {
          const data = await response.json() as any;
          const detectedStage = data.choices?.[0]?.message?.content?.trim();

          if (detectedStage) {
            // Buscar la etapa en el pipeline
            const validStage = pipelineStages.find((s: any) =>
              s.id === detectedStage ||
              s.label === detectedStage ||
              s.id?.toLowerCase() === detectedStage.toLowerCase() ||
              s.label?.toLowerCase() === detectedStage.toLowerCase() ||
              detectedStage.toLowerCase().includes(s.id?.toLowerCase()) ||
              detectedStage.toLowerCase().includes(s.label?.toLowerCase())
            );

            if (validStage) {
              await prisma.conversation.update({
                where: { id: conv.id },
                data: { stage: validStage.id || validStage.label }
              });
              updated++;
              console.log(`✅ ${conv.recipientName || conv.recipientId}: ${validStage.id}`);
            }
          }
        }

        // Pequeña pausa para no saturar la API
        await new Promise(r => setTimeout(r, 500));

      } catch (err) {
        console.error(`❌ Error en conv ${conv.id}:`, err);
        errors++;
      }
    }

    console.log(`🎯 Análisis completado: ${updated} actualizadas, ${errors} errores`);

    res.json({
      success: true,
      total: conversations.length,
      updated,
      errors,
      message: `Se actualizaron ${updated} de ${conversations.length} conversaciones`
    });

  } catch (error) {
    console.error('❌ Error en analyze-stages:', error);
    res.status(500).json({ error: 'Error al analizar conversaciones' });
  }
});

export default router;

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
// MEJORADO: Lock de procesamiento para evitar respuestas duplicadas
// ====================================================
const BUFFER_WAIT_MS = 5000; // Esperar 5 segundos por más mensajes (antes 3s)
const recentlyProcessed = new Set<string>(); // Deduplicación de mensajes
const processingLock = new Set<string>(); // 🔒 Lock: evita que la IA procese 2 veces al mismo contacto

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
    
    // Si no hay etapas configuradas, usar default (THE FOUR)
    if (pipelineStages.length === 0) {
      pipelineStages = [
        { id: 'Saludo', label: 'Saludo' },
        { id: 'Interesado', label: 'Interesado' },
        { id: 'En Cotización', label: 'En Cotización' },
        { id: 'Pendiente Color', label: 'Pendiente Color' },
        { id: 'Pendiente Talla', label: 'Pendiente Talla' },
        { id: 'Pendiente Calidad', label: 'Pendiente Calidad' },
        { id: 'Realizó Pedido', label: 'Realizó Pedido' },
        { id: 'Pendiente Pago', label: 'Pendiente Pago' },
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
2. Si se CONFIRMÓ una cita/reunión con fecha y hora → etapa_actual = "Confirmado"
3. Si se CONFIRMÓ un pedido con fecha de entrega → etapa_actual = "Confirmado"
4. Si YA tienes todos los datos del pedido PERO falta fecha_entrega → etapa_actual = "Pendiente Entrega"
5. Si YA confirmó que quiere comprar PERO falta método de pago → etapa_actual = "Pendiente Pago"
6. Si YA tienes nombre, talla, color, calidad, cantidad, ciudad → etapa_actual = "Realizó Pedido"
7. Si FALTA la calidad (Premium/Mónaco) → etapa_actual = "Pendiente Calidad"
8. Si FALTA la talla → etapa_actual = "Pendiente Talla"
9. Si FALTA el color → etapa_actual = "Pendiente Color"
10. Si mostró interés, preguntó por precios o productos → etapa_actual = "En Cotización"
11. Si preguntó algo pero no ha dado datos → etapa_actual = "Interesado"
12. Si solo saludó → etapa_actual = "Saludo"

=== 🚨 ACCIONES AUTOMÁTICAS — MUY IMPORTANTE 🚨 ===

El campo "accion" dispara acciones REALES en el sistema. DEBES usarlo cuando:

📅 accion = "crear_cita" — Cuando el cliente CONFIRMA una cita/reunión/demostración:
   - El cliente dice "sí, mañana a las 8" y tú confirmas → accion = "crear_cita"
   - Se agenda una reunión, demo, consulta, etc. con fecha y hora definida → accion = "crear_cita"
   - Llena también: fecha_cita, hora_cita, tipo_cita (qué tipo: demo, reunión, consulta, etc.)

🛒 accion = "crear_pedido" — Cuando el cliente CONFIRMA un pedido/compra:
   - El cliente confirma que quiere comprar y tiene datos completos → accion = "crear_pedido"
   - Llena también: fecha_entrega y todos los datos del pedido

⚠️ IMPORTANTE: Solo usa la accion UNA VEZ cuando se confirma. Si "pedido" ya dice "creado" o "cita" dice "creada" en la memoria guardada, NO vuelvas a poner la accion.

=== ⚠️⚠️⚠️ BLOQUE DE MEMORIA - SUPER IMPORTANTE ⚠️⚠️⚠️ ===

🔴 OBLIGATORIO: AL FINAL de CADA respuesta, DEBES incluir este bloque de memoria.
🔴 Sin este bloque, el sistema no funcionará correctamente.
🔴 Inclúyelo SIEMPRE, incluso si solo tienes el nombre del cliente.

FORMATO EXACTO (copia y pega, luego llena los campos que conoces):

<<MEMORY_JSON>>{"nombre":"","tipo":"","talla":"","color":"","calidad":"","cantidad":"","ciudad":"","direccion":"","barrio":"","celular":"","precio_unitario":"","descuento":"","envio":"","total":"","metodo_pago":"","fecha_entrega":"","pedido":"","fecha_cita":"","hora_cita":"","tipo_cita":"","cita":"","etapa_actual":"","accion":""}<<END_MEMORY>>

INSTRUCCIONES:
- Llena SOLO los campos que ya conoces. Deja "" los que NO sabes.
- "nombre" = Nombre del cliente
- "etapa_actual" = OBLIGATORIO. Usa la REGLA DE DETECCIÓN de arriba.
- "accion" = "crear_cita" cuando SE CONFIRMA cita. "crear_pedido" cuando SE CONFIRMA pedido. Vacío en otros casos.
- "fecha_cita" = Fecha de la cita confirmada. Formato "YYYY-MM-DD" o texto como "mañana", "viernes", "13 de febrero".
- "hora_cita" = Hora de la cita. Ej: "8:00", "14:30", "3:00 pm".
- "tipo_cita" = Tipo: "demostración", "reunión", "consulta", "asesoría", etc.
- "cita" = NO lo llenes tú. El sistema lo pone en "creada" automáticamente.
- "pedido" = NO lo llenes tú. El sistema lo pone en "creado" automáticamente.
- El bloque va en la ÚLTIMA LÍNEA de tu respuesta.
- NO expliques el bloque al cliente, es interno/oculto.

EJEMPLO — Cita confirmada:
"¡Perfecto! Queda agendada tu demostración para mañana a las 8:00 am. 😊

<<MEMORY_JSON>>{"nombre":"Carlos","tipo":"","talla":"","color":"","calidad":"","cantidad":"","ciudad":"","direccion":"","barrio":"","celular":"","precio_unitario":"","descuento":"","envio":"","total":"","metodo_pago":"","fecha_entrega":"","pedido":"","fecha_cita":"mañana","hora_cita":"8:00","tipo_cita":"demostración","cita":"","etapa_actual":"Confirmado","accion":"crear_cita"}<<END_MEMORY>>"

EJEMPLO — Solo saludo:
"¡Hola! 👋 Bienvenido. ¿En qué puedo ayudarte hoy?

<<MEMORY_JSON>>{"nombre":"","tipo":"","talla":"","color":"","calidad":"","cantidad":"","ciudad":"","direccion":"","barrio":"","celular":"","precio_unitario":"","descuento":"","envio":"","total":"","metodo_pago":"","fecha_entrega":"","pedido":"","fecha_cita":"","hora_cita":"","tipo_cita":"","cita":"","etapa_actual":"Saludo","accion":""}<<END_MEMORY>>"
`);

    const systemPrompt = promptParts.join('\n\n') || 'Eres un asistente virtual amable por WhatsApp.';
    console.log(`🧠 Prompt: ${systemPrompt.length} chars | Cliente: ${clientName || 'desconocido'} | Memoria: ${Object.keys(savedContext).length} campos`);

    // Construir mensajes para OpenAI (30 mensajes = cubre flujo completo de venta)
    const recent = [...history].reverse().slice(-30);
    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    recent.forEach(m => messages.push({ role: m.fromMe ? 'assistant' : 'user', content: m.content.substring(0, 500) }));
    
    // 🔴 RECORDATORIO: Agregar al mensaje del usuario para forzar el bloque de memoria
    const memoryReminder = `\n\n[SISTEMA: Recuerda incluir <<MEMORY_JSON>>...<<END_MEMORY>> al final. Si confirmaste una cita/reunión, pon accion:"crear_cita" con fecha_cita y hora_cita. Si confirmaste un pedido, pon accion:"crear_pedido".]`;
    messages.push({ role: 'user', content: message + memoryReminder });

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
          
          // DEBUG: Ver si hay bloque de memoria en la respuesta
          if (!memoryMatch) {
            console.log(`⚠️ SIN BLOQUE DE MEMORIA en respuesta (${reply.length} chars)`);
            
            // 🔄 FALLBACK INTELIGENTE: Extraer datos del historial y respuesta
            const fullConversation = history.map(m => m.content).join(' ').toLowerCase() + ' ' + reply.toLowerCase();
            const replyLower = reply.toLowerCase();
            
            // Extraer datos del historial
            const extractedData: any = { ...savedContext };
            
            // Extraer nombre si lo mencionó
            const nombreMatch = fullConversation.match(/(?:me llamo|soy|mi nombre es)\s+([a-záéíóúñ]+)/i) ||
                               reply.match(/(?:gracias|hola|perfecto|genial),?\s+\*?\*?([a-záéíóúñ]+)\*?\*?[!,]/i);
            if (nombreMatch && !extractedData.nombre) {
              extractedData.nombre = nombreMatch[1];
            }
            
            // Extraer talla
            const tallaMatch = fullConversation.match(/talla\s*(xs|s|m|l|xl|2xl|3xl|4xl)/i) ||
                              reply.match(/talla\s+\*?\*?(xs|s|m|l|xl|2xl|3xl|4xl)\*?\*?\s+anotad/i);
            if (tallaMatch) {
              extractedData.talla = tallaMatch[1].toUpperCase();
            }
            
            // Extraer color
            const colorMatch = fullConversation.match(/color[:\s]+\*?\*?(marfil|blanco|negro|azul\s*oscuro)\*?\*?/i) ||
                              reply.match(/\*?\*?(marfil|blanco|negro|azul\s*oscuro)\*?\*?\s+anotad/i);
            if (colorMatch) {
              extractedData.color = colorMatch[1];
            }
            
            // Extraer calidad
            const calidadMatch = fullConversation.match(/(premium|mónaco|monaco)/i);
            if (calidadMatch) {
              extractedData.calidad = calidadMatch[1];
            }
            
            // Extraer cantidad
            const cantidadMatch = fullConversation.match(/(\d+)\s*(?:buzo|buzos|unidad|unidades)/i);
            if (cantidadMatch) {
              extractedData.cantidad = cantidadMatch[1];
            }
            
            // Extraer ciudad
            const ciudadMatch = fullConversation.match(/ciudad[:\s]+\*?\*?([a-záéíóúñ\s]+)\*?\*?/i) ||
                               reply.match(/(?:envío a|enviamos a|para)\s+\*?\*?([a-záéíóúñ]+)\*?\*?/i);
            if (ciudadMatch && !extractedData.ciudad) {
              extractedData.ciudad = ciudadMatch[1].trim();
            }
            
            // 🎯 DETECTAR ETAPA basándose en datos extraídos
            let fallbackStage = 'Interesado';
            const lastMsgLower = (message || '').toLowerCase();
            
            if (lastMsgLower.includes('no me interesa') || lastMsgLower.includes('no gracias') || lastMsgLower.includes('cancelar')) {
              fallbackStage = 'Perdido';
            } else if (extractedData.fecha_entrega || replyLower.includes('pedido agendado') || replyLower.includes('número de pedido')) {
              fallbackStage = 'Confirmado';
            } else if (extractedData.nombre && extractedData.talla && extractedData.color && extractedData.calidad && extractedData.cantidad && extractedData.ciudad) {
              if (replyLower.includes('fecha') || replyLower.includes('qué día')) {
                fallbackStage = 'Pendiente Entrega';
              } else if (replyLower.includes('pago') || replyLower.includes('cómo deseas pagar')) {
                fallbackStage = 'Pendiente Pago';
              } else {
                fallbackStage = 'Realizó Pedido';
              }
            } else if (extractedData.nombre && extractedData.talla && extractedData.color && extractedData.calidad && extractedData.cantidad && !extractedData.ciudad) {
              fallbackStage = 'En Cotización'; // Falta ciudad
            } else if (extractedData.nombre && extractedData.talla && extractedData.color && extractedData.calidad && !extractedData.cantidad) {
              fallbackStage = 'En Cotización'; // Falta cantidad
            } else if (extractedData.nombre && extractedData.talla && extractedData.color && !extractedData.calidad) {
              fallbackStage = 'Pendiente Calidad';
            } else if (extractedData.nombre && extractedData.talla && !extractedData.color) {
              fallbackStage = 'Pendiente Color';
            } else if (extractedData.nombre && !extractedData.talla) {
              fallbackStage = 'Pendiente Talla';
            } else if (replyLower.includes('cómo te llamas') || replyLower.includes('bienvenido')) {
              fallbackStage = 'Saludo';
            } else if (extractedData.nombre || replyLower.includes('$') || replyLower.includes('precio')) {
              fallbackStage = 'En Cotización';
            }
            
            // Guardar datos extraídos y actualizar etapa
            const validStage = pipelineStages.find((s: any) => 
              s.id === fallbackStage || s.label === fallbackStage ||
              s.id?.toLowerCase() === fallbackStage.toLowerCase()
            );
            
            const updateData: any = {};
            if (Object.keys(extractedData).length > Object.keys(savedContext).length) {
              updateData.contextData = extractedData;
              extractedData.etapa_actual = fallbackStage;
              console.log(`🔍 Datos extraídos: ${JSON.stringify(extractedData)}`);
            }
            if (validStage) {
              updateData.stage = validStage.id || validStage.label;
              console.log(`🔄 Etapa por fallback: ${updateData.stage}`);
            }
            
            if (Object.keys(updateData).length > 0) {
              await prisma.conversation.update({
                where: { id: conversationId },
                data: updateData
              });
            }
            
            // 📅 FALLBACK: Detectar citas confirmadas en la respuesta de la IA
            if (savedContext.cita !== 'creada') {
              const confirmPatterns = [
                /(?:agendamos|queda agendad|confirmad|perfecto.*(?:mañana|lunes|martes|miércoles|jueves|viernes|sábado|domingo))/i,
                /(?:reunión|demostración|cita|demo).*(?:para|el|mañana|a las)/i,
                /(?:nos vemos|te espero|te esperamos).*(?:mañana|lunes|martes|miércoles|jueves|viernes|sábado|domingo)/i,
                /(?:a las\s+\d{1,2}[:\s]*\d{0,2}\s*(?:am|pm|a\.m|p\.m)?)/i
              ];
              
              const replyHasConfirm = confirmPatterns.some(p => p.test(replyLower));
              const clientConfirmed = lastMsgLower.includes('sí') || lastMsgLower.includes('si') || lastMsgLower.includes('ok') || lastMsgLower.includes('claro') || lastMsgLower.includes('dale') || lastMsgLower.includes('perfecto') || lastMsgLower.includes('listo');
              
              if (replyHasConfirm && clientConfirmed) {
                try {
                  // Extraer hora de la conversación
                  const horaMatch = (fullConversation + ' ' + reply).match(/(?:a las|las)\s+(\d{1,2})[:\s]*(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i);
                  let citaTime = '10:00';
                  if (horaMatch) {
                    let h = parseInt(horaMatch[1]);
                    const m = horaMatch[2] ? parseInt(horaMatch[2]) : 0;
                    const mer = (horaMatch[3] || '').toLowerCase().replace('.', '');
                    if (mer === 'pm' && h < 12) h += 12;
                    if (mer === 'am' && h === 12) h = 0;
                    citaTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                  }
                  
                  // Extraer fecha
                  let citaDate = new Date();
                  citaDate.setDate(citaDate.getDate() + 1); // Default: mañana
                  
                  const fullText = (fullConversation + ' ' + reply).toLowerCase();
                  if (fullText.includes('hoy')) { citaDate = new Date(); }
                  else if (fullText.includes('mañana') || fullText.includes('manana')) { citaDate = new Date(); citaDate.setDate(citaDate.getDate() + 1); }
                  else if (fullText.includes('pasado')) { citaDate = new Date(); citaDate.setDate(citaDate.getDate() + 2); }
                  else {
                    const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
                    for (let d = 0; d < dayNames.length; d++) {
                      if (fullText.includes(dayNames[d])) {
                        citaDate = new Date();
                        const diff = d - citaDate.getDay();
                        citaDate.setDate(citaDate.getDate() + (diff <= 0 ? diff + 7 : diff));
                        break;
                      }
                    }
                  }
                  
                  const nombre = extractedData.nombre || clientName || 'Cliente WhatsApp';
                  const phoneClean = clientPhone.replace('@c.us', '').replace('@s.whatsapp.net', '');
                  
                  // Detectar tipo de cita
                  let tipoCita = 'reunión';
                  if (replyLower.includes('demo') || replyLower.includes('demostración')) tipoCita = 'demostración';
                  else if (replyLower.includes('consulta')) tipoCita = 'consulta';
                  else if (replyLower.includes('asesoría') || replyLower.includes('asesoria')) tipoCita = 'asesoría';
                  
                  await prisma.appointment.create({
                    data: {
                      userId: ownerId,
                      type: 'appointment',
                      clientName: nombre,
                      clientPhone: phoneClean,
                      date: citaDate,
                      time: citaTime,
                      status: 'pending',
                      notes: `📅 ${tipoCita.toUpperCase()} — Auto-detectada\n━━━━━━━━━━━━━━━\n👤 ${nombre}\n📱 ${phoneClean}\n🗓️ ${citaDate.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}\n🕐 ${citaTime}`,
                      whatsappLineId: whatsappLineId || null
                    }
                  });
                  
                  // Marcar como creada
                  extractedData.cita = 'creada';
                  await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { contextData: extractedData }
                  });
                  
                  console.log(`📅 FALLBACK: Cita auto-detectada: ${tipoCita} | ${nombre} | ${citaDate.toLocaleDateString('es-CO')} ${citaTime}`);
                  
                  // Auto CRM
                  const existingCrm = await prisma.client.findFirst({ where: { userId: ownerId, phone: { endsWith: phoneClean.slice(-10) } } });
                  if (!existingCrm) {
                    await prisma.client.create({
                      data: { userId: ownerId, name: nombre, phone: phoneClean, status: 'active', tags: [tipoCita, 'whatsapp'], lastContact: new Date(), whatsappLineId: whatsappLineId || null }
                    });
                    console.log(`👥 CRM: "${nombre}" creado desde fallback`);
                  }
                } catch (fbErr: any) {
                  console.error('📅 Error en fallback cita:', fbErr.message);
                }
              }
            }
          }
          
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
                  
                  // 👥 AUTO-CREAR CLIENTE EN CRM (pedido)
                  try {
                    const phoneClean2 = clientPhone.replace('@c.us', '').replace('@s.whatsapp.net', '');
                    const existingClient2 = await prisma.client.findFirst({
                      where: { userId: ownerId, phone: { endsWith: phoneClean2.slice(-10) } }
                    });
                    if (!existingClient2) {
                      await prisma.client.create({
                        data: {
                          userId: ownerId,
                          name: merged.nombre || clientName || 'Cliente WhatsApp',
                          phone: phoneClean2,
                          email: merged.email || null,
                          notes: `Cliente registrado automáticamente desde pedido WhatsApp`,
                          status: 'active',
                          tags: ['pedido', 'whatsapp'],
                          totalPurchases: parseFloat(merged.total?.replace(/[^0-9]/g, '')) || 0,
                          lastContact: new Date(),
                          whatsappLineId: whatsappLineId || null
                        }
                      });
                      console.log(`👥 CRM: Cliente "${merged.nombre || clientName}" creado desde pedido`);
                    } else {
                      await prisma.client.update({
                        where: { id: existingClient2.id },
                        data: { 
                          lastContact: new Date(),
                          totalPurchases: (existingClient2.totalPurchases || 0) + (parseFloat(merged.total?.replace(/[^0-9]/g, '')) || 0)
                        }
                      });
                    }
                  } catch (crmErr: any) {
                    console.error('⚠️ Error auto-CRM pedido:', crmErr.message);
                  }
                } catch (orderErr: any) {
                  console.error('❌ Error creando pedido:', orderErr.message);
                }
              }
              
              // 📅 CREAR CITA AUTOMÁTICA
              if (actionToTake === 'crear_cita' && merged.cita !== 'creada') {
                try {
                  // 🕐 PARSEAR FECHA INTELIGENTE
                  let citaDate = new Date();
                  const fechaCitaStr = (merged.fecha_cita || '').toLowerCase().trim();
                  const hoy = new Date();
                  
                  if (fechaCitaStr) {
                    if (fechaCitaStr.includes('hoy')) {
                      citaDate = new Date(hoy);
                    } else if (fechaCitaStr.includes('mañana') || fechaCitaStr.includes('manana')) {
                      citaDate = new Date(hoy);
                      citaDate.setDate(citaDate.getDate() + 1);
                    } else if (fechaCitaStr.includes('pasado')) {
                      citaDate = new Date(hoy);
                      citaDate.setDate(citaDate.getDate() + 2);
                    } else if (fechaCitaStr.includes('lunes') || fechaCitaStr.includes('martes') || fechaCitaStr.includes('miércoles') || fechaCitaStr.includes('miercoles') || fechaCitaStr.includes('jueves') || fechaCitaStr.includes('viernes') || fechaCitaStr.includes('sábado') || fechaCitaStr.includes('sabado') || fechaCitaStr.includes('domingo')) {
                      const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
                      const dayNamesAlt = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
                      let targetDay = dayNames.findIndex(d => fechaCitaStr.includes(d));
                      if (targetDay === -1) targetDay = dayNamesAlt.findIndex(d => fechaCitaStr.includes(d));
                      if (targetDay >= 0) {
                        citaDate = new Date(hoy);
                        const currentDay = hoy.getDay();
                        let daysAhead = targetDay - currentDay;
                        if (daysAhead <= 0) daysAhead += 7;
                        citaDate.setDate(citaDate.getDate() + daysAhead);
                      }
                    } else {
                      // Intentar formatos como "13 de febrero", "2025-02-13", "13/02/2025"
                      const monthNames: Record<string, number> = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
                      const dateMatch = fechaCitaStr.match(/(\d{1,2})\s*(?:de\s+)?(\w+)/);
                      if (dateMatch) {
                        const day = parseInt(dateMatch[1]);
                        const monthStr = dateMatch[2].toLowerCase();
                        if (monthNames[monthStr] !== undefined) {
                          citaDate = new Date(hoy.getFullYear(), monthNames[monthStr], day);
                          if (citaDate < hoy) citaDate.setFullYear(citaDate.getFullYear() + 1);
                        }
                      }
                      // Formato ISO o slash
                      const parsed = new Date(merged.fecha_cita);
                      if (!isNaN(parsed.getTime())) citaDate = parsed;
                    }
                  }
                  
                  // 🕐 PARSEAR HORA
                  let citaTime = '10:00';
                  const horaCitaStr = (merged.hora_cita || '').toLowerCase().trim();
                  if (horaCitaStr) {
                    const timeMatch = horaCitaStr.match(/(\d{1,2})[:\s]*(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i);
                    if (timeMatch) {
                      let hours = parseInt(timeMatch[1]);
                      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
                      const meridian = (timeMatch[3] || '').toLowerCase().replace('.', '');
                      if (meridian === 'pm' && hours < 12) hours += 12;
                      if (meridian === 'am' && hours === 12) hours = 0;
                      citaTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                    }
                  }

                  const tipoCita = merged.tipo_cita || 'cita';
                  const nombreCliente = merged.nombre || clientName || 'Cliente WhatsApp';
                  const phoneClean = clientPhone.replace('@c.us', '').replace('@s.whatsapp.net', '');

                  const appointmentData = {
                    userId: ownerId,
                    type: 'appointment',
                    clientName: nombreCliente,
                    clientPhone: phoneClean,
                    date: citaDate,
                    time: citaTime,
                    status: 'pending',
                    notes: `📅 ${tipoCita.toUpperCase()} — WhatsApp\n` +
                           `━━━━━━━━━━━━━━━\n` +
                           `👤 Cliente: ${nombreCliente}\n` +
                           `📱 Teléfono: ${phoneClean}\n` +
                           `🗓️ Fecha: ${citaDate.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}\n` +
                           `🕐 Hora: ${citaTime}\n` +
                           `📋 Tipo: ${tipoCita}\n` +
                           `━━━━━━━━━━━━━━━\n` +
                           `${merged.notas_cita || ''}`,
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
                  
                  console.log(`📅 CITA CREADA: ${tipoCita} | ${nombreCliente} | ${citaDate.toLocaleDateString('es-CO')} ${citaTime}`);

                  // 👥 AUTO-CREAR CLIENTE EN CRM
                  try {
                    const existingClient = await prisma.client.findFirst({
                      where: { userId: ownerId, phone: { endsWith: phoneClean.slice(-10) } }
                    });
                    if (!existingClient) {
                      await prisma.client.create({
                        data: {
                          userId: ownerId,
                          name: nombreCliente,
                          phone: phoneClean,
                          email: merged.email || null,
                          notes: `Cliente registrado automáticamente desde WhatsApp (${tipoCita})`,
                          status: 'active',
                          tags: [tipoCita, 'whatsapp'],
                          lastContact: new Date(),
                          whatsappLineId: whatsappLineId || null
                        }
                      });
                      console.log(`👥 CRM: Cliente "${nombreCliente}" creado automáticamente`);
                    } else {
                      // Actualizar último contacto
                      await prisma.client.update({
                        where: { id: existingClient.id },
                        data: { lastContact: new Date(), name: nombreCliente || existingClient.name }
                      });
                    }
                  } catch (crmErr: any) {
                    console.error('⚠️ Error auto-CRM:', crmErr.message);
                  }
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

  // 🔒 Si ya se está procesando para este contacto, re-encolar
  if (processingLock.has(bufferKey)) {
    console.log(`🔒 Lock activo para ${buf.senderName} — re-encolando ${buf.messages.length} mensaje(s)`);
    const existing = messageBuffer.get(bufferKey);
    if (existing) {
      existing.messages.push(...buf.messages);
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => processBufferedMessages(bufferKey), BUFFER_WAIT_MS);
    } else {
      buf.timer = setTimeout(() => processBufferedMessages(bufferKey), BUFFER_WAIT_MS);
      messageBuffer.set(bufferKey, buf);
    }
    return;
  }

  // 🔒 Activar lock
  processingLock.add(bufferKey);

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

    // ⌨️🎙️ Typing/Recording (refrescar porque ya pasaron 5 seg)
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
  } finally {
    // 🔓 Liberar lock
    processingLock.delete(bufferKey);

    // 🔄 Verificar si llegaron mensajes mientras procesábamos
    const pending = messageBuffer.get(bufferKey);
    if (pending) {
      console.log(`🔄 Hay ${pending.messages.length} mensaje(s) pendiente(s) de ${senderName} → procesando...`);
      clearTimeout(pending.timer);
      // Esperar un poco más por si siguen llegando
      pending.timer = setTimeout(() => processBufferedMessages(bufferKey), BUFFER_WAIT_MS);
    }
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
    const { to, message, whatsappLineId, lineId: legacyLineId, mediaUrl, mediaType: sendMediaType } = req.body;
    if (!userId || !to || (!message && !mediaUrl)) { res.status(400).json({ error: 'Faltan datos' }); return; }
    const ownerId = await getOwnerId(userId);
    const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@c.us`;
    const cleanNumber = to.replace(/\D/g, '');

    // 🔗 DETERMINAR SESIÓN CORRECTA: usar la línea específica, NO findActiveSession
    let sessionName: string | null = null;
    let lineId: string | null = whatsappLineId || legacyLineId || null; // ✅ Acepta ambos nombres

    if (whatsappLineId) {
      // Buscar sesión de la línea específica
      const line = await prisma.whatsappLine.findFirst({ where: { id: whatsappLineId, userId: ownerId } });
      if (line) {
        sessionName = line.sessionName;
        lineId = line.id;
      }
    }
    
    if (!sessionName) {
      // Fallback: buscar la conversación para saber de qué línea es
      const existingConv = await prisma.conversation.findFirst({ 
        where: { userId: ownerId, recipientId: { endsWith: cleanNumber.slice(-10) } },
        select: { whatsappLineId: true }
      });
      if (existingConv?.whatsappLineId) {
        const line = await prisma.whatsappLine.findUnique({ where: { id: existingConv.whatsappLineId } });
        if (line) {
          sessionName = line.sessionName;
          lineId = line.id;
        }
      }
    }

    if (!sessionName) {
      // Último fallback: primera línea conectada del usuario
      const firstLine = await prisma.whatsappLine.findFirst({ where: { userId: ownerId, status: 'connected' } });
      if (firstLine) {
        sessionName = firstLine.sessionName;
        lineId = firstLine.id;
      } else {
        // Legacy: findActiveSession
        const session = await findActiveSession(ownerId);
        sessionName = session?.name || getUserSessionName(ownerId);
      }
    }

    // 📤 ENVIAR MENSAJE
    let sent = false;
    if (message) {
      sent = await sendWahaMessage(sessionName, chatId, message);
    }

    // 📤 ENVIAR MEDIA (si hay)
    if (mediaUrl) {
      const mediaObj = { url: mediaUrl, type: sendMediaType || 'image', name: 'media' };
      const mediaSent = await sendWahaMedia(sessionName, chatId, mediaObj, !message ? '' : undefined);
      sent = sent || mediaSent;
    }

    if (sent) {
      // 🔍 Buscar conversación CORRECTA (filtrar por línea)
      let conv = null;
      if (lineId) {
        conv = await prisma.conversation.findFirst({ where: { userId: ownerId, recipientId: cleanNumber, whatsappLineId: lineId } });
        if (!conv && cleanNumber.length >= 10) {
          const last10 = cleanNumber.slice(-10);
          conv = await prisma.conversation.findFirst({ where: { userId: ownerId, recipientId: { endsWith: last10 }, whatsappLineId: lineId } });
        }
      } else {
        conv = await prisma.conversation.findFirst({ where: { userId: ownerId, recipientId: cleanNumber } });
        if (!conv && cleanNumber.length >= 10) {
          const last10 = cleanNumber.slice(-10);
          conv = await prisma.conversation.findFirst({ where: { userId: ownerId, recipientId: { endsWith: last10 } } });
        }
      }
      
      if (!conv) {
        conv = await prisma.conversation.create({ 
          data: { userId: ownerId, recipientId: cleanNumber, lastMessage: message || '📎 Media', stage: 'new', ...(lineId ? { whatsappLineId: lineId } : {}) } 
        });
      }

      const content = message || (sendMediaType === 'image' ? '📷 [Imagen]' : sendMediaType === 'audio' ? '🎤 [Audio]' : '📎 [Archivo]');
      await prisma.message.create({ 
        data: { 
          conversationId: conv.id, content, fromMe: true, userId, role: 'assistant',
          ...(mediaUrl && { mediaUrl, mediaType: sendMediaType || 'image' })
        } 
      });
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: content } });
      res.json({ success: true });
    } else { res.json({ success: false, error: 'No se pudo enviar' }); }
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
});

// ====================================================
// 📢 ENVÍO MASIVO — Enviar mensaje a múltiples contactos
// Con delays para evitar ban de WhatsApp
// ====================================================
router.post('/send-bulk', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const { contacts, message, whatsappLineId, lineId: legacyBulkLineId, mediaUrl, mediaType: bulkMediaType } = req.body;
    if (!contacts?.length || (!message && !mediaUrl)) { 
      res.status(400).json({ error: 'Se requieren contactos y mensaje o media' }); return; 
    }

    const effectiveLineId = whatsappLineId || legacyBulkLineId || null; // ✅ Acepta ambos

    // Determinar sesión de la línea
    let sessionName: string | null = null;
    if (effectiveLineId) {
      const line = await prisma.whatsappLine.findFirst({ where: { id: effectiveLineId, userId: ownerId } });
      if (line) sessionName = line.sessionName;
    }
    if (!sessionName) {
      const firstLine = await prisma.whatsappLine.findFirst({ where: { userId: ownerId, status: 'connected' } });
      if (firstLine) sessionName = firstLine.sessionName;
      else {
        const session = await findActiveSession(ownerId);
        sessionName = session?.name || getUserSessionName(ownerId);
      }
    }

    console.log(`📢 Envío masivo: ${contacts.length} contactos, sesión: ${sessionName}`);

    // Responder inmediatamente y procesar en background
    res.json({ success: true, message: `Enviando a ${contacts.length} contactos...`, total: contacts.length });

    // Procesar en background con delays
    let sent = 0;
    let failed = 0;
    const DELAY_BETWEEN_MESSAGES = 3000; // 3 segundos entre cada mensaje (evitar ban)

    for (const contact of contacts) {
      try {
        const phone = (contact.phone || contact.recipientId || contact).replace(/\D/g, '');
        if (!phone) { failed++; continue; }

        const chatId = `${phone}@c.us`;

        // Enviar texto
        if (message) {
          const textSent = await sendWahaMessage(sessionName!, chatId, message);
          if (!textSent) { failed++; continue; }
        }

        // Enviar media si hay
        if (mediaUrl) {
          const mediaObj = { url: mediaUrl, type: bulkMediaType || 'image', name: 'media' };
          await sendWahaMedia(sessionName!, chatId, mediaObj);
        }

        // Guardar en DB
        const cleanNumber = phone;
        let conv = await prisma.conversation.findFirst({ 
          where: { userId: ownerId, recipientId: { endsWith: cleanNumber.slice(-10) }, ...(effectiveLineId ? { whatsappLineId: effectiveLineId } : {}) } 
        });
        
        if (conv) {
          const content = message || '📎 [Media]';
          await prisma.message.create({ 
            data: { 
              conversationId: conv.id, content, fromMe: true, userId, role: 'assistant',
              ...(mediaUrl && { mediaUrl, mediaType: bulkMediaType || 'image' })
            } 
          });
          await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: content } });
        }

        sent++;
        console.log(`📢 Masivo ${sent}/${contacts.length}: ✅ ${phone}`);

        // Delay entre mensajes para evitar ban de WhatsApp
        if (sent < contacts.length) {
          await new Promise(r => setTimeout(r, DELAY_BETWEEN_MESSAGES));
        }
      } catch (e: any) {
        console.error(`📢 Masivo: ❌ Error enviando a contacto:`, e.message);
        failed++;
      }
    }

    console.log(`📢 Envío masivo completado: ${sent} enviados, ${failed} fallidos de ${contacts.length}`);
  } catch (e: any) { 
    console.error('❌ Error envío masivo:', e.message);
    res.status(500).json({ success: false, message: e.message }); 
  }
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
      activeBuffers: messageBuffer.size,
      activeLocks: processingLock.size,
      bufferWaitMs: BUFFER_WAIT_MS
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

    // 🚫 Filtrar: historias/estados de WhatsApp, broadcast (pero NO grupos)
    if (!from || from.includes('@broadcast') || from.includes('status@') || from === 'status@broadcast') {
      if (from?.includes('@broadcast') || from?.includes('status@')) {
        console.log(`🚫 Ignorado: historia/estado de WhatsApp de ${from}`);
      }
      res.json({ success: true }); return;
    }

    // 👥 DETECTAR SI ES GRUPO
    const isGroup = from.includes('@g.us');
    const participant = payload?.participant || payload?.author || payload?._data?.author || '';
    const participantName = payload?.notifyName || payload?.pushName || payload?._data?.notifyName || '';
    
    if (isGroup) {
      console.log(`👥 Mensaje de GRUPO: ${from} | Participante: ${participantName} (${participant})`);
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

    // 👥 Para grupos: recipientId es el JID del grupo, para chats: es el número limpio
    const recipientId = isGroup 
      ? from  // Mantener JID completo del grupo (123456@g.us)
      : from.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '');
    const senderName = isGroup
      ? (participantName || participant.replace('@c.us', '').replace(/\D/g, ''))  // Nombre de quien envió en el grupo
      : (notifyName || recipientId);

    // 👥 Para grupos necesitamos resolver el usuario por la sesión, no por el participante
    const participantClean = isGroup 
      ? participant.replace('@c.us', '').replace('@s.whatsapp.net', '').replace(/\D/g, '')
      : recipientId;
    
    const userId = await resolveUserFromWebhook(sessionName, participantClean);
    if (!userId) { res.status(400).json({ error: 'No user' }); return; }

    // 🔗 Buscar whatsappLineId por sessionName
    const waLine = await prisma.whatsappLine.findUnique({ where: { sessionName } }).catch(() => null);
    const whatsappLineId = waLine?.id || null;

    console.log(`💬 ${isGroup ? '👥' : '👤'} ${senderName} (${recipientId}) → session: ${sessionName} line: ${whatsappLineId || 'none'} ${savedMediaType ? `[${savedMediaType}]` : ''}`);

    // 🔍 Búsqueda de conversación POR LÍNEA
    let conv = null;
    
    if (isGroup) {
      // 👥 GRUPO: Buscar por JID del grupo
      conv = await prisma.conversation.findFirst({ 
        where: { userId, recipientId: from, isGroup: true, ...(whatsappLineId ? { whatsappLineId } : {}) } 
      });
    } else if (whatsappLineId) {
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
      // 👥 Para grupos: obtener nombre del grupo de la metadata del payload
      const groupSubject = isGroup 
        ? (payload?.subject || payload?._data?.subject || payload?.chat?.name || payload?.groupMetadata?.subject || senderName)
        : null;

      conv = await prisma.conversation.create({ 
        data: { 
          userId, 
          recipientId: isGroup ? from : recipientId, 
          recipientName: isGroup ? groupSubject : senderName, 
          lastMessage: body, 
          stage: 'new', 
          isGroup,
          ...(isGroup && { groupName: groupSubject, groupSettings: { aiEnabled: true, respondTo: 'all', triggerWords: [] } }),
          ...(whatsappLineId ? { whatsappLineId } : {}) 
        } 
      });
      console.log(`🆕 ${isGroup ? 'Grupo' : 'Conversación'} creada: ${isGroup ? groupSubject : senderName} (línea: ${whatsappLineId || 'global'})`);
    }

    // 👥 VERIFICAR CONFIGURACIÓN DE GRUPO antes de procesar
    if (isGroup) {
      const groupSettings = (conv.groupSettings as any) || { aiEnabled: true, respondTo: 'all', triggerWords: [] };
      
      if (!groupSettings.aiEnabled) {
        // IA deshabilitada para este grupo — solo guardar mensaje
        const displayContent = savedMediaType === 'audio' ? `🎤 ${body}` : body;
        await prisma.message.create({ 
          data: { conversationId: conv.id, content: `[${senderName}]: ${displayContent}`, fromMe: false, userId, role: 'user' } 
        });
        await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: `[${senderName}]: ${displayContent}` } });
        console.log(`👥 Grupo ${conv.groupName}: IA deshabilitada, mensaje guardado`);
        res.json({ success: true }); return;
      }

      // Verificar si debe responder según configuración
      const respondTo = groupSettings.respondTo || 'all';
      const triggerWords = groupSettings.triggerWords || [];
      const messageLower = body.toLowerCase();

      let shouldRespond = false;

      if (respondTo === 'all') {
        shouldRespond = true;
      } else if (respondTo === 'mentions') {
        // Solo responder si mencionan al bot o usan palabras clave
        const botMentioned = payload?.mentionedIds?.length > 0 || 
                            messageLower.includes('@elisa') || 
                            messageLower.includes('elisa') ||
                            messageLower.includes('bot');
        shouldRespond = botMentioned;
      } else if (respondTo === 'keywords') {
        // Solo responder si usan palabras clave
        shouldRespond = triggerWords.some((w: string) => messageLower.includes(w.toLowerCase()));
      }

      if (!shouldRespond) {
        // No debe responder — solo guardar
        const displayContent = savedMediaType === 'audio' ? `🎤 ${body}` : body;
        await prisma.message.create({ 
          data: { conversationId: conv.id, content: `[${senderName}]: ${displayContent}`, fromMe: false, userId, role: 'user' } 
        });
        await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: `[${senderName}]: ${displayContent}` } });
        console.log(`👥 Grupo ${conv.groupName}: No responde (modo: ${respondTo})`);
        res.json({ success: true }); return;
      }

      console.log(`👥 Grupo ${conv.groupName}: IA RESPONDE (modo: ${respondTo})`);
    }

    // ⏸️ COMANDO ".." = PAUSAR IA — inmediato
    if (body.trim() === '..') {
      await prisma.conversation.update({ where: { id: conv.id }, data: { aiPaused: true } });
      await prisma.message.create({ data: { conversationId: conv.id, content: isGroup ? `[${senderName}]: ${body}` : body, fromMe: false, userId, role: 'user' } });
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
      ? (isGroup ? `[${senderName}]: 🎤 ${body}` : `🎤 ${body}`)
      : (isGroup ? `[${senderName}]: ${body}` : body);
    
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
    // Para grupos: NO sobrescribir recipientName (es el nombre del grupo, no del participante)
    await prisma.conversation.update({ 
      where: { id: conv.id }, 
      data: { 
        lastMessage: displayContent, 
        ...(!isGroup && { recipientName: senderName })
      } 
    });

    // Si IA pausada, solo guardar
    if (conv.aiPaused) {
      console.log(`⏸️ IA pausada → ${senderName} (guardado, no responde)`);
      res.json({ success: true }); return;
    }

    // Para la IA, usar la transcripción limpia
    // En grupos: incluir quién envió para que la IA sepa a quién responder
    const messageForAI = isGroup ? `[${senderName}]: ${body}` : body;

    // ====================================================
    // 📦 MESSAGE BUFFER — Agrupar mensajes en ráfaga
    // Usuario manda varias líneas rápido → espera 5s → responde UNA vez
    // Si la IA ya está procesando → encolar para después
    // Para grupos: bufferKey usa el grupo, no el participante individual
    // ====================================================
    const bufferKey = isGroup ? `${userId}_group_${from}` : `${userId}_${recipientId}`;
    const existingBuffer = messageBuffer.get(bufferKey);
    const isLocked = processingLock.has(bufferKey);

    if (existingBuffer) {
      // Ya hay mensajes en buffer → agregar y resetear timer
      existingBuffer.messages.push(messageForAI);
      clearTimeout(existingBuffer.timer);
      existingBuffer.timer = setTimeout(() => processBufferedMessages(bufferKey), BUFFER_WAIT_MS);
      console.log(`📦 Buffer: +1 de ${senderName} (total: ${existingBuffer.messages.length}, esperando ${BUFFER_WAIT_MS/1000}s más...)`);
    } else if (isLocked) {
      // 🔒 IA procesando → crear buffer nuevo que se procesará cuando termine
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
      console.log(`🔒 Buffer (lock activo): nuevo de ${senderName} → se procesará cuando la IA termine`);
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
// 🚀 ANÁLISIS RÁPIDO DE ETAPAS (Sin IA - Basado en datos)
// Este endpoint analiza los datos guardados (contextData)
// y asigna la etapa correcta basándose en qué campos están llenos
// IMPORTANTE: Si la IA ya detectó una etapa (etapa_actual), la respeta
// =====================================================
router.post('/quick-stage-sync', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    const jwt = await import('jsonwebtoken');
    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'bizonne-secret-2024') as any;
    } catch (e) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    
    const userId = decoded.userId || decoded.id || decoded.sub;
    if (!userId) return res.status(401).json({ error: 'Token sin userId' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, parentUserId: true }
    });
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    const ownerId = user.parentUserId || user.id;
    const { lineId } = req.body;

    // Obtener conversaciones
    const whereClause: any = { userId: ownerId };
    if (lineId) whereClause.whatsappLineId = lineId;

    const conversations = await prisma.conversation.findMany({
      where: whereClause,
      select: { id: true, stage: true, contextData: true, lastMessage: true }
    });

    let updated = 0;

    for (const conv of conversations) {
      const ctx = (conv.contextData as any) || {};
      
      // 🎯 PRIORIDAD 1: Si la IA ya detectó una etapa en contextData, USAR ESA
      if (ctx.etapa_actual && ctx.etapa_actual !== '') {
        const iaStage = ctx.etapa_actual;
        if (iaStage !== conv.stage) {
          await prisma.conversation.update({
            where: { id: conv.id },
            data: { stage: iaStage }
          });
          updated++;
          console.log(`🎯 Etapa sincronizada (IA): ${conv.stage} → ${iaStage}`);
        }
        continue; // No aplicar reglas manuales si la IA ya detectó
      }
      
      // 🎯 PRIORIDAD 2: Solo si NO hay etapa_actual, aplicar reglas básicas
      let newStage = conv.stage || 'Saludo';
      
      // Detectar si perdido (por mensaje)
      const lastMsg = (conv.lastMessage || '').toLowerCase();
      const isPerdido = lastMsg.includes('no me interesa') || 
                        lastMsg.includes('no gracias') || 
                        lastMsg.includes('ya no quiero') ||
                        lastMsg.includes('cancelar');

      // Verificar si tiene datos básicos
      const hasAnyData = ctx.nombre || ctx.direccion || ctx.total || ctx.cantidad;
      
      if (isPerdido) {
        newStage = 'Perdido';
      } else if (ctx.pedido === 'creado' || ctx.fecha_entrega) {
        newStage = 'Confirmado';
      } else if (hasAnyData && ctx.direccion) {
        newStage = 'Realizó Pedido';
      } else if (hasAnyData) {
        newStage = 'En Cotización';
      } else if (conv.lastMessage && conv.lastMessage.length > 20) {
        newStage = 'Interesado';
      }

      // Actualizar solo si cambió
      if (newStage !== conv.stage) {
        await prisma.conversation.update({
          where: { id: conv.id },
          data: { stage: newStage }
        });
        updated++;
        console.log(`🎯 Etapa actualizada (reglas): ${conv.stage} → ${newStage}`);
      }
    }

    res.json({ success: true, analyzed: conversations.length, updated });
  } catch (error: any) {
    console.error('❌ Error quick-stage-sync:', error.message);
    res.status(500).json({ error: error.message });
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

    // Etapas del pipeline de THE FOUR (tienda de buzos)
    const pipelineStages = [
      { id: 'Saludo', label: 'Saludo' },
      { id: 'Interesado', label: 'Interesado' },
      { id: 'En Cotización', label: 'En Cotización' },
      { id: 'Pendiente Color', label: 'Pendiente Color' },
      { id: 'Pendiente Talla', label: 'Pendiente Talla' },
      { id: 'Pendiente Calidad', label: 'Pendiente Calidad' },
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

        // Prompt para detectar etapa - Optimizado para THE FOUR (buzos)
        const prompt = `Analiza esta conversación de WhatsApp de una tienda de buzos y determina la etapa del pipeline.

ETAPAS DISPONIBLES: ${stagesList}

CRITERIOS DE DETECCIÓN (en orden de prioridad):

1. "Perdido" = Cliente dijo "no me interesa", "no gracias", "cancelar" o no responde
2. "Confirmado" = Tiene número de pedido (#TF-), dirección completa, celular, método de pago
3. "Pendiente Pago" = Confirmó pedido pero falta método de pago
4. "Realizó Pedido" = Confirmó que quiere comprar, tiene nombre + talla + color + calidad + cantidad + ciudad
5. "Pendiente Calidad" = Tiene talla y color pero falta elegir calidad (Premium/Mónaco)
6. "Pendiente Talla" = Ya eligió color pero falta la talla
7. "Pendiente Color" = Ya sabe qué quiere pero falta el color (marfil/blanco/negro/azul oscuro)
8. "En Cotización" = Preguntando precios, tallas, colores, calidades disponibles
9. "Interesado" = Mostró interés en buzos/hoodies, ya dio su nombre
10. "Saludo" = Solo saludos iniciales, no ha dicho su nombre

PALABRAS CLAVE:
- Si menciona "Premium" o "Mónaco" = ya eligió calidad
- Si menciona XS, S, M, L, XL, 2XL, 3XL, 4XL = ya eligió talla
- Si menciona marfil, blanco, negro, azul oscuro = ya eligió color
- Si dice "confirmado", "sí quiero", "dale" después del resumen = Realizó Pedido

CONVERSACIÓN:
${history}

Responde SOLO con el nombre exacto de la etapa. Nada más.`;

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

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getOwnerId } from '../lib/helpers';
import { lidPhoneCache, apiKeyErrorCache, recentlyProcessed, recentlySentFromPlatform, processingLock } from '../lib/cache';
import { AuthRequest } from '../middleware/auth.middleware';
import { sendPushToUser } from './push.routes';

const router = Router();

// ⚡ Production: reduce console.log I/O overhead (118 logs → solo errores)
const IS_PROD = process.env.NODE_ENV === 'production';
const log = IS_PROD ? (..._args: any[]) => {} : console.log.bind(console);
// 🔥 Critical log: SIEMPRE visible, incluso en producción (para paths críticos)
const clog = console.log.bind(console);

const WAHA_API_URL = process.env.WAHA_API_URL || 'http://31.97.142.127:8080';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
const BACKEND_URL = process.env.BACKEND_URL || 'https://elisa-iaagentes-production.up.railway.app';

const getWahaHeaders = () => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WAHA_API_KEY) h['X-Api-Key'] = WAHA_API_KEY;
  return h;
};

// ====================================================
// 📦 INTELLIGENT BURST HANDLER — Manejo inteligente de ráfagas
// Detecta patrones de escritura y agrupa mensajes de forma adaptativa
// ====================================================

// ⏱️ TIMING ADAPTATIVO
const BURST_CONFIG = {
  INITIAL_WAIT_MS: 3000,      // Primera espera: 3s (usuario puede seguir escribiendo)
  CONTINUE_WAIT_MS: 2000,     // Mensajes adicionales: 2s (están activos)
  FRAGMENT_WAIT_MS: 4000,     // Fragmentos ("...", "?", <5 chars): 4s (probablemente continúan)
  MAX_WAIT_MS: 15000,         // Máximo absoluto: 15s (no bufferear forever)
  MAX_MESSAGES: 10,           // Máximo de mensajes en ráfaga
};

// 🧠 Patrones que indican "sigo escribiendo"
const FRAGMENT_PATTERNS = /^\.{2,}$|^\?{1,3}$|^!{1,3}$|^(y|o|pero|que|porque|es|si|no|ok|ya|ah|mm|hm|je|ja|jaja|xd|eee|osea|ósea|pues|mira|oye|bueno|dale|va|aver|haber|espera|wait|un momento)$/i;
const CONTINUATION_ENDINGS = /[,;:\-–—…]$|\.{2,}$/;
const COMPLETE_PATTERNS = /[.!?]$/;

// Detecta si un mensaje parece un fragmento (el usuario sigue escribiendo)
const isFragment = (msg: string): boolean => {
  const trimmed = msg.trim();
  if (trimmed.length <= 4) return true;                    // Muy corto → fragmento
  if (FRAGMENT_PATTERNS.test(trimmed)) return true;        // Palabra suelta conocida
  if (CONTINUATION_ENDINGS.test(trimmed)) return true;     // Termina en coma, puntos suspensivos
  if (trimmed.split(/\s+/).length <= 2 && !COMPLETE_PATTERNS.test(trimmed)) return true; // 1-2 palabras sin punto
  return false;
};

// Calcula el tiempo de espera óptimo según el mensaje actual y el estado del buffer
const getSmartDelay = (msg: string, messageCount: number, firstTimestamp: number): number => {
  const elapsed = Date.now() - firstTimestamp;
  const remaining = BURST_CONFIG.MAX_WAIT_MS - elapsed;
  
  // Si ya pasó el máximo, procesar inmediatamente
  if (remaining <= 0) return 50;
  
  // Si ya alcanzó el máximo de mensajes, procesar pronto
  if (messageCount >= BURST_CONFIG.MAX_MESSAGES) return 200;
  
  let delay: number;
  
  if (messageCount === 0) {
    // Primer mensaje — esperar más
    delay = BURST_CONFIG.INITIAL_WAIT_MS;
  } else if (isFragment(msg)) {
    // Fragmento — esperar más, probablemente sigue
    delay = BURST_CONFIG.FRAGMENT_WAIT_MS;
  } else {
    // Mensaje normal — espera estándar
    delay = BURST_CONFIG.CONTINUE_WAIT_MS;
  }
  
  // No exceder el tiempo máximo total
  return Math.min(delay, remaining);
};

// 🔗 Combinador inteligente: estructura los mensajes para que la IA los entienda mejor
const smartCombineMessages = (messages: string[]): string => {
  if (messages.length === 1) return messages[0];
  
  // Detectar si son fragmentos de una misma oración o mensajes separados
  const allShort = messages.every(m => m.trim().length < 30);
  const avgLen = messages.reduce((s, m) => s + m.trim().length, 0) / messages.length;
  
  if (allShort && avgLen < 15) {
    // Fragmentos cortos → unir como una oración natural
    // Ej: "hola" + "quiero" + "ver los precios" → "hola quiero ver los precios"
    return messages.map(m => m.trim()).join(' ');
  }
  
  if (messages.length <= 3) {
    // Pocos mensajes → unir con saltos de línea
    return messages.join('\n');
  }
  
  // Muchos mensajes → estructurar para la IA
  return messages.join('\n');
};

const messageBuffer: Map<string, {
  messages: string[];
  timer: ReturnType<typeof setTimeout>;
  sessionName: string;
  from: string;
  senderName: string;
  userId: string;
  convId: string;
  whatsappLineId: string | null;
  firstTimestamp: number;      // Cuando llegó el primer mensaje
  lastTimestamp: number;       // Cuando llegó el último mensaje
  hasMedia: boolean;           // Si incluye media (imágenes, audio)
}> = new Map();

// ===== SESSION MANAGEMENT (multi-tenant) =====
const getUserSessionName = (userId: string): string => `user_${userId}`;



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
    log(`📱 Usuario resuelto por línea ${sessionName}: ${waLine.userId}`);
    return waLine.userId;
  }
  
  // 2. Si es una sesión legacy tipo user_xxx (formato antiguo)
  if (sessionName.startsWith('user_')) {
    const uid = sessionName.replace('user_', '');
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, parentUserId: true } });
    if (u) {
      log(`📱 Usuario resuelto por sesión legacy: ${u.parentUserId || u.id}`);
      return u.parentUserId || u.id;
    }
  }
  
  // 3. NO buscar por conversación existente - esto causaba mezcla de datos entre usuarios
  // Cada sesión DEBE estar asociada a una línea de WhatsApp con su userId
  console.warn(`⚠️ SESIÓN NO RECONOCIDA: ${sessionName} - No tiene línea de WhatsApp asociada`);
  console.warn(`   → Para mensajes de ${recipientId}, se rechazará hasta que se configure la línea correctamente`);
  return null;
};

// =====================================================
// 📱 LID → PHONE RESOLVER (WAHA Plus @lid format)
// =====================================================
// WAHA Plus uses Linked IDs (@lid) instead of phone numbers in some cases
// This resolves LIDs to real phone numbers via WAHA API

const resolveLidToPhone = async (session: string, lidChatId: string, payload?: any): Promise<string> => {
  // 1. Cache check (24hr TTL - LID→phone mapping doesn't change)
  const cached = lidPhoneCache.get(lidChatId);
  if (cached) return cached;

  const lidClean = lidChatId.replace('@lid', '').replace('@c.us', '').replace('@s.whatsapp.net', '');
  log(`🔍 Resolviendo LID: ${lidChatId} → buscando número real...`);

  // 2. Check payload for real phone in _data fields and NOWEB key fields
  const possiblePhones = [
    // NOWEB engine: key.remoteJid often has real phone
    payload?.key?.remoteJid?.replace?.('@s.whatsapp.net', '').replace?.('@c.us', ''),
    payload?.key?.participant?.replace?.('@s.whatsapp.net', '').replace?.('@c.us', ''),
    // Standard _data fields
    payload?._data?.from?.replace?.('@c.us', '').replace?.('@s.whatsapp.net', ''),
    payload?._data?.id?.remote?.replace?.('@c.us', '').replace?.('@s.whatsapp.net', ''),
    payload?._data?.id?.participant?.replace?.('@c.us', '').replace?.('@s.whatsapp.net', ''),
    payload?._data?.chat?.id?._serialized?.replace?.('@c.us', ''),
    payload?.chat?.id?.replace?.('@c.us', ''),
    // NOWEB: chatId sometimes has real number
    payload?.chatId?.replace?.('@c.us', '').replace?.('@s.whatsapp.net', ''),
    payload?._data?.chatId?.replace?.('@c.us', '').replace?.('@s.whatsapp.net', ''),
    // participant field (for non-group chats too)
    payload?.participant?.replace?.('@c.us', '').replace?.('@s.whatsapp.net', ''),
    payload?._data?.notifyName, // sometimes contains phone
  ].filter(Boolean);

  for (const p of possiblePhones) {
    const clean = (p || '').replace(/\D/g, '');
    if (clean.length >= 7 && clean.length <= 13 && clean !== lidClean) {
      log(`✅ Número real encontrado en payload._data: ${clean}`);
      lidPhoneCache.set(lidChatId, clean);
      return clean;
    }
  }

  // 3. WAHA API: Try multiple endpoints to resolve LID → phone
  const endpoints = [
    // WAHA Plus: Get contact phone number from chatId
    { method: 'GET', url: `${WAHA_API_URL}/api/${session}/contacts?contactId=${encodeURIComponent(lidChatId)}` },
    { method: 'GET', url: `${WAHA_API_URL}/api/contacts?session=${session}&contactId=${encodeURIComponent(lidChatId)}` },
    // WAHA Plus: Get chat details
    { method: 'GET', url: `${WAHA_API_URL}/api/${session}/chats/${encodeURIComponent(lidChatId)}` },
    // WAHA Plus: Phone number resolution
    { method: 'POST', url: `${WAHA_API_URL}/api/${session}/contacts/get-about`, body: { contactId: lidChatId } },
    { method: 'POST', url: `${WAHA_API_URL}/api/contacts/get-about`, body: { session, contactId: lidChatId } },
    // WAHA Plus: Check exists (sometimes returns real number)
    { method: 'POST', url: `${WAHA_API_URL}/api/contacts/check-exists`, body: { session, phone: lidChatId } },
    // WAHA PLUS v2: Direct phone resolution
    { method: 'GET', url: `${WAHA_API_URL}/api/${session}/contacts/${encodeURIComponent(lidChatId)}` },
  ];

  for (const ep of endpoints) {
    try {
      const opts: any = { method: ep.method, headers: getWahaHeaders() };
      if (ep.body) opts.body = JSON.stringify(ep.body);
      
      const r = await fetch(ep.url, opts);
      if (r.ok) {
        const data = await r.json() as any;
        
        // Extract phone from various response formats
        const phoneFields = [
          data?.phone, data?.number, data?.phoneNumber,
          data?.id?.user, data?.id?._serialized?.replace?.('@c.us', ''),
          data?.result?.phone, data?.result?.number,
          data?.jid?.replace?.('@c.us', '').replace?.('@s.whatsapp.net', ''),
          data?.chatId?.replace?.('@c.us', ''),
          // Array responses
          ...(Array.isArray(data) ? data.map((d: any) => d?.id?.user || d?.phone || d?.number) : []),
        ].filter(Boolean);

        for (const ph of phoneFields) {
          const clean = (ph + '').replace(/\D/g, '');
          if (clean.length >= 7 && clean.length <= 13 && clean !== lidClean) {
            log(`✅ LID ${lidClean} → Número real: ${clean} (vía ${ep.url.split('/').slice(-2).join('/')})`);
            lidPhoneCache.set(lidChatId, clean);
            return clean;
          }
        }
      }
    } catch {}
  }

  // 4. Last resort: If LID digits look like they could be a phone (≤13 digits), use as-is
  if (lidClean.length >= 7 && lidClean.length <= 13) {
    log(`⚠️ No se pudo resolver LID ${lidClean}, usando como número (${lidClean.length} dígitos)`);
    return lidClean;
  }

  // 5. LID is too long (>13 digits) - store as-is (will use @lid when sending)
  log(`⚠️ LID no resuelto: ${lidClean} (${lidClean.length} dígitos) — guardando número LID directo`);
  lidPhoneCache.set(lidChatId, lidClean);
  return lidClean;
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
      if (r.ok) { log(`${mode === 'recording' ? '🎙️' : '⌨️'} ${mode} ON`); return; }
    } catch {}
  }
};

const stopPresence = async (session: string, chatId: string): Promise<void> => {
  try { await fetch(`${WAHA_API_URL}/api/stopTyping`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify({ session, chatId }) }); } catch {}
  try { await fetch(`${WAHA_API_URL}/api/${session}/sendPresence`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify({ chatId, presence: 'available' }) }); } catch {}
};

// ⚡ Delay natural REDUCIDO (0.8s - 2s máx para respuesta rápida)
const humanDelay = (textLength: number): Promise<void> => {
  const ms = Math.min(Math.max(textLength * 6, 400), 1200);
  return new Promise(r => setTimeout(r, ms));
};

// ===== MEDIA TRIGGER =====
const findMediaTrigger = (message: string, mediaItems: any[]): any | null => {
  if (!mediaItems?.length) return null;
  const norm = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Build all matches with word count for priority (more words = more specific = higher priority)
  let bestMatch: any = null;
  let bestWordCount = 0;
  for (const item of mediaItems) {
    if (!item.trigger) continue;
    const triggers = item.trigger.split(',').map((t: string) => t.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')).filter(Boolean);
    for (const t of triggers) {
      if (!t) continue;
      const words = t.split(/\s+/).filter(Boolean);
      const allMatch = words.every((w: string) => norm.includes(w));
      if (allMatch && words.length > bestWordCount) {
        bestMatch = item;
        bestWordCount = words.length;
      }
    }
  }
  return bestMatch;
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

    // WEBJS: Can send URLs directly OR base64
    // Try URL-based sending first (more efficient), fallback to base64
    if (!isBase64 && media.url) {
      // WEBJS: Try sending URL directly first (saves bandwidth)
      try {
        const urlBody: any = { session, chatId, file: { url: media.url, filename: media.name || 'file' } };
        if (caption) urlBody.caption = caption;
        const endpointMap: Record<string, string> = { image: '/api/sendImage', video: '/api/sendVideo' };
        const ep = endpointMap[media.type] || '/api/sendFile';
        const urlRes = await fetch(`${WAHA_API_URL}${ep}`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(urlBody) });
        if (urlRes.ok) { log(`✅ ${media.type} enviado OK via URL directa (${ep})`); return true; }
        log(`⚠️ URL directa falló (${urlRes.status}), descargando como base64...`);
      } catch {}

      // Fallback: Download and send as base64
      try {
        log(`📤 ${media.type}: descargando para enviar como base64...`);
        const mediaRes = await fetch(media.url);
        if (mediaRes.ok) {
          const buf = Buffer.from(await mediaRes.arrayBuffer());
          const contentType = mediaRes.headers.get('content-type') || '';
          const mimeMap: Record<string, string> = {
            image: contentType.includes('png') ? 'image/png' : 'image/jpeg',
            video: 'video/mp4',
            audio: 'audio/mpeg',
            document: contentType || 'application/octet-stream'
          };
          const extMap: Record<string, string> = {
            image: media.name || (contentType.includes('png') ? 'image.png' : 'image.jpg'),
            video: media.name || 'video.mp4',
            audio: media.name || 'audio.mp3',
            document: media.name || 'file'
          };
          fileData = {
            mimetype: mimeMap[media.type] || contentType || 'application/octet-stream',
            filename: extMap[media.type] || media.name || 'file',
            data: buf.toString('base64')
          };
          log(`📤 ${media.type} descargado: ${(buf.length / 1024 / 1024).toFixed(1)}MB → base64`);
        }
      } catch (e: any) {
        console.error(`⚠️ Media download failed: ${e.message}`);
      }
    }

    // Si no hay fileData, no podemos enviar
    if (!fileData) {
      console.error('❌ No file data available for sending');
      return false;
    }

    // WEBJS: sendFile works reliably for all media types
    const body: any = { session, chatId, file: fileData };
    if (caption) body.caption = caption;

    // Try specific endpoint first, then fallback to sendFile
    const endpointMap: Record<string, string> = { image: '/api/sendImage', video: '/api/sendVideo' };
    const primaryEndpoint = endpointMap[media.type] || '/api/sendFile';

    log(`📤 Enviando ${media.type} via ${primaryEndpoint} (base64: ${fileData.data.length > 0})`);
    const r = await fetch(`${WAHA_API_URL}${primaryEndpoint}`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(body) });
    if (r.ok) { log(`✅ ${media.type} enviado OK via ${primaryEndpoint}`); return true; }
    const errText = await r.text().catch(() => '');
    console.error(`❌ ${primaryEndpoint} (${r.status}): ${errText.substring(0, 200)}`);

    // Fallback: sendFile (delivers as document but at least arrives)
    if (primaryEndpoint !== '/api/sendFile') {
      log(`📤 Fallback: enviando via /api/sendFile...`);
      const r2 = await fetch(`${WAHA_API_URL}/api/sendFile`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(body) });
      if (r2.ok) { log(`⚠️ ${media.type} enviado via sendFile (fallback)`); return true; }
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
    if (r.ok) {
      // Marcar para que el webhook no duplique este mensaje
      const cleanId = chatId.replace(/[@\s]/g, '').replace('c.us', '').replace('g.us', '').replace('lid', '').replace('s.whatsapp.net', '');
      const dedupKey = `${cleanId}:${text.substring(0, 60)}`;
      recentlySentFromPlatform.add(dedupKey);
      setTimeout(() => recentlySentFromPlatform.delete(dedupKey), 60000);
    }
    return r.ok;
  } catch { return false; }
};

// ====================================================
// 🔊 TEXT-TO-SPEECH (ElevenLabs)
// ====================================================
const textToSpeech = async (text: string, apiKey: string, voiceId: string): Promise<Buffer | null> => {
  try {
    // Limpiar texto (quitar emojis, markdown, URLs, etc.)
    const cleanText = text
      .replace(/<<MEMORY_JSON>>[\s\S]*?<<END_MEMORY>>/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[*_~`#]/g, '')
      .replace(/<<VOZ>>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    
    if (!cleanText || cleanText.length < 3) return null;
    // Limitar a 800 chars para no gastar créditos en textos muy largos
    const trimmedText = cleanText.length > 800 ? cleanText.substring(0, 800) + '...' : cleanText;
    
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: trimmedText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true
        }
      })
    });
    
    if (!response.ok) {
      // Fallback a modelo más simple
      const response2 = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body: JSON.stringify({ text: trimmedText, model_id: 'eleven_monolingual_v1', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
      });
      if (!response2.ok) {
        console.error(`❌ ElevenLabs TTS error (${response2.status})`);
        return null;
      }
      const arrayBuffer2 = await response2.arrayBuffer();
      return Buffer.from(arrayBuffer2);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (e: any) {
    console.error('❌ ElevenLabs TTS error:', e.message);
    return null;
  }
};

// 🎤 Enviar nota de voz via WAHA
const sendVoiceNote = async (session: string, chatId: string, audioBuffer: Buffer): Promise<boolean> => {
  try {
    const base64Audio = audioBuffer.toString('base64');
    
    const r = await fetch(`${WAHA_API_URL}/api/sendFile`, {
      method: 'POST',
      headers: getWahaHeaders(),
      body: JSON.stringify({
        session,
        chatId,
        file: {
          mimetype: 'audio/mpeg',
          filename: 'voice.mp3',
          data: base64Audio
        }
      })
    });
    
    if (r.ok) {
      log('🔊 Nota de voz enviada OK');
      return true;
    }
    console.error(`❌ sendVoiceNote error (${r.status}): ${await r.text().catch(() => '')}`);
    return false;
  } catch (e: any) {
    console.error('❌ sendVoiceNote error:', e.message);
    return false;
  }
};

// ====================================================
// ☁️ WHATSAPP CLOUD API — Send Functions
// ====================================================
const CLOUD_API_URL = 'https://graph.facebook.com/v21.0';

const sendCloudText = async (phoneNumberId: string, accessToken: string, to: string, text: string): Promise<boolean> => {
  try {
    const r = await fetch(`${CLOUD_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/\D/g, ''), type: 'text', text: { body: text } })
    });
    if (r.ok) { log(`☁️ Cloud texto → ${to}`); return true; }
    console.error(`❌ Cloud sendText (${r.status}): ${(await r.text().catch(() => '')).substring(0, 200)}`);
    return false;
  } catch (e: any) { console.error('❌ Cloud sendText:', e.message); return false; }
};

// ☁️ Enviar respuesta dividida en párrafos (más natural, simula "escribiendo")
const sendCloudSplitMessages = async (phoneNumberId: string, accessToken: string, to: string, fullText: string): Promise<boolean> => {
  // Dividir por doble salto de línea en párrafos
  const paragraphs = fullText.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
  
  // Si es un solo párrafo o muy corto, enviar normal
  if (paragraphs.length <= 1 || fullText.length < 100) {
    return sendCloudText(phoneNumberId, accessToken, to, fullText);
  }
  
  // Limitar a máximo 4 mensajes para no spamear
  const chunks: string[] = [];
  if (paragraphs.length <= 4) {
    chunks.push(...paragraphs);
  } else {
    // Agrupar párrafos en máximo 4 chunks
    const perChunk = Math.ceil(paragraphs.length / 4);
    for (let i = 0; i < paragraphs.length; i += perChunk) {
      chunks.push(paragraphs.slice(i, i + perChunk).join('\n\n'));
    }
  }
  
  let allSent = true;
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      // Delay entre mensajes: 800ms-1.5s basado en longitud
      const delay = Math.min(Math.max(chunks[i].length * 4, 800), 1500);
      await new Promise(r => setTimeout(r, delay));
    }
    const sent = await sendCloudText(phoneNumberId, accessToken, to, chunks[i]);
    if (!sent) allSent = false;
  }
  return allSent;
};

const sendCloudMedia = async (phoneNumberId: string, accessToken: string, to: string, media: any, caption?: string): Promise<boolean> => {
  try {
    const cleanTo = to.replace(/\D/g, '');
    const url = media.url || '';
    const typeMap: Record<string, string> = { image: 'image', video: 'video', audio: 'audio', document: 'document' };
    const cloudType = typeMap[media.type] || 'document';
    const messageBody: any = { messaging_product: 'whatsapp', to: cleanTo, type: cloudType };

    if (url.startsWith('data:')) {
      const match = url.match(/^data:(.+?);base64,(.+)$/s);
      if (!match) return false;
      const formData = new FormData();
      const buffer = Buffer.from(match[2], 'base64');
      formData.append('file', new Blob([buffer], { type: match[1] }), media.name || 'file');
      formData.append('messaging_product', 'whatsapp');
      formData.append('type', match[1]);
      const uploadRes = await fetch(`${CLOUD_API_URL}/${phoneNumberId}/media`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}` }, body: formData
      });
      if (!uploadRes.ok) { console.error(`❌ Cloud media upload (${uploadRes.status})`); return false; }
      const uploadData = await uploadRes.json() as any;
      messageBody[cloudType] = { id: uploadData.id };
    } else {
      messageBody[cloudType] = { link: url };
      if (cloudType === 'document') messageBody[cloudType].filename = media.name || 'document';
    }
    if (caption && ['image', 'video', 'document'].includes(cloudType)) messageBody[cloudType].caption = caption;

    const r = await fetch(`${CLOUD_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(messageBody)
    });
    if (r.ok) { log(`☁️ Cloud ${media.type} → ${to}`); return true; }
    console.error(`❌ Cloud sendMedia (${r.status}): ${(await r.text().catch(() => '')).substring(0, 200)}`);
    return false;
  } catch (e: any) { console.error('❌ Cloud sendMedia:', e.message); return false; }
};

const sendCloudVoice = async (phoneNumberId: string, accessToken: string, to: string, audioBuffer: Buffer): Promise<boolean> => {
  try {
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', 'audio/ogg');
    const uploadRes = await fetch(`${CLOUD_API_URL}/${phoneNumberId}/media`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}` }, body: formData
    });
    if (!uploadRes.ok) return false;
    const uploadData = await uploadRes.json() as any;
    const r = await fetch(`${CLOUD_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/\D/g, ''), type: 'audio', audio: { id: uploadData.id } })
    });
    return r.ok;
  } catch (e: any) { console.error('❌ Cloud voice:', e.message); return false; }
};

const markCloudRead = async (phoneNumberId: string, accessToken: string, messageId: string): Promise<void> => {
  fetch(`${CLOUD_API_URL}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId })
  }).catch(() => {});
};

// ====================================================
// 🔀 UNIFIED SEND — Auto-detect Cloud API vs WAHA
// ====================================================
const lineInfoCache = new Map<string, { type: string; pnid?: string; token?: string; ttl: number }>();

const getLineInfo = async (lineId: string | null | undefined) => {
  if (!lineId) return null;
  const cached = lineInfoCache.get(lineId);
  if (cached && cached.ttl > Date.now()) return cached;
  const line = await prisma.whatsappLine.findUnique({
    where: { id: lineId },
    select: { connectionType: true, cloudPhoneNumberId: true, cloudAccessToken: true }
  });
  if (!line) return null;
  const info = { type: line.connectionType || 'waha', pnid: line.cloudPhoneNumberId || undefined, token: line.cloudAccessToken || undefined, ttl: Date.now() + 300000 };
  lineInfoCache.set(lineId, info);
  return info;
};

const unifiedSendText = async (sessionName: string, chatId: string, text: string, whatsappLineId?: string | null): Promise<boolean> => {
  const li = await getLineInfo(whatsappLineId);
  if (li?.type === 'cloud_api' && li.pnid && li.token) return sendCloudText(li.pnid, li.token, chatId.replace(/@.*/g, ''), text);
  return sendWahaMessage(sessionName, chatId, text);
};

// 🤖 Para respuestas de IA: divide en párrafos para Cloud API
const unifiedSendAIResponse = async (sessionName: string, chatId: string, text: string, whatsappLineId?: string | null): Promise<boolean> => {
  const li = await getLineInfo(whatsappLineId);
  if (li?.type === 'cloud_api' && li.pnid && li.token) return sendCloudSplitMessages(li.pnid, li.token, chatId.replace(/@.*/g, ''), text);
  return sendWahaMessage(sessionName, chatId, text);
};

const unifiedSendMedia = async (sessionName: string, chatId: string, media: any, caption: string | undefined, whatsappLineId?: string | null): Promise<boolean> => {
  const li = await getLineInfo(whatsappLineId);
  if (li?.type === 'cloud_api' && li.pnid && li.token) return sendCloudMedia(li.pnid, li.token, chatId.replace(/@.*/g, ''), media, caption);
  return sendWahaMedia(sessionName, chatId, media, caption);
};

const unifiedSendVoice = async (sessionName: string, chatId: string, audioBuffer: Buffer, whatsappLineId?: string | null): Promise<boolean> => {
  const li = await getLineInfo(whatsappLineId);
  if (li?.type === 'cloud_api' && li.pnid && li.token) return sendCloudVoice(li.pnid, li.token, chatId.replace(/@.*/g, ''), audioBuffer);
  return sendVoiceNote(sessionName, chatId, audioBuffer);
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
      log(`🎤 Whisper transcripción: "${data.text?.substring(0, 100)}"`);
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
// 👁️ ANALYZE IMAGE WITH VISION — GPT-4o-mini Vision
// Convierte imágenes del cliente en descripción de texto para que la IA entienda
// ====================================================
const analyzeImageWithVision = async (imageBuffer: Buffer, mimetype: string, apiKey: string, businessContext?: string): Promise<string | null> => {
  try {
    const base64 = imageBuffer.toString('base64');
    const mediaType = mimetype.includes('png') ? 'image/png' : mimetype.includes('webp') ? 'image/webp' : 'image/jpeg';
    
    // Limitar tamaño (max ~2MB en base64 para no exceder límites)
    if (base64.length > 2_800_000) {
      log(`⚠️ Imagen muy grande para Vision: ${(base64.length / 1_000_000).toFixed(1)}MB — omitiendo análisis`);
      return null;
    }

    const systemMsg = `Eres un asistente de visión para un negocio por WhatsApp. Analiza la imagen que el cliente envió y describe lo que ves de forma concisa y útil en español.
${businessContext ? `\nContexto del negocio: ${businessContext}` : ''}

REGLAS:
- Describe lo que ves en máximo 2-3 oraciones
- Si es un producto, describe color, tipo, detalles visibles
- Si es un comprobante de pago/transferencia, indica: monto, fecha, banco si es visible
- Si es una captura de pantalla, describe el contenido relevante
- Si es un texto/documento, transcribe el contenido relevante
- Si es una foto personal o selfie, di "El cliente envió una foto personal"
- NO inventes detalles que no puedas ver
- Responde SOLO con la descripción, sin explicaciones extras`;

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}`, detail: 'low' } },
            { type: 'text', text: 'Describe esta imagen que envió el cliente por WhatsApp.' }
          ]}
        ],
        max_tokens: 200,
        temperature: 0.3
      }),
      signal: ctrl.signal
    });
    clearTimeout(to);

    if (res.ok) {
      const data = await res.json() as any;
      const description = data.choices?.[0]?.message?.content?.trim();
      if (description) {
        log(`👁️ Vision: "${description.substring(0, 120)}"`);
        return description;
      }
    } else {
      const err = await res.text().catch(() => '');
      console.error(`❌ Vision error ${res.status}: ${err.substring(0, 200)}`);
    }
    return null;
  } catch (e: any) {
    console.error('❌ Vision error:', e.message);
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
      log(`🔄 URL reescrita: ${url.substring(0, 80)} → ${rewritten.substring(0, 80)}`);
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
        log(`✅ S1: Media de payload.media.data: ${buf.length} bytes`);
        return { buffer: buf, mimetype: payload.media.mimetype || payload?.mimetype || 'audio/ogg' };
      }
    } catch (e: any) { log(`⚠️ S1a media.data falló: ${e.message}`); }
  }
  
  if (payload?._data?.body) {
    try {
      const buf = Buffer.from(payload._data.body, 'base64');
      if (buf.length > 100) {
        log(`✅ S1b: Media de payload._data.body: ${buf.length} bytes`);
        return { buffer: buf, mimetype: payload?.mimetype || payload?._data?.mimetype || 'audio/ogg' };
      }
    } catch (e: any) { log(`⚠️ S1b _data.body falló: ${e.message}`); }
  }

  // STRATEGY 2: mediaUrl from payload (rewrite localhost → public IP)
  if (payload?.mediaUrl) {
    try {
      const url = rewriteWahaUrl(payload.mediaUrl);
      log(`📥 S2: mediaUrl: ${url.substring(0, 120)}`);
      const r = await fetch(url, { headers: getWahaHeaders() });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 100) {
          log(`✅ S2: Media via mediaUrl: ${buf.length} bytes`);
          return { buffer: buf, mimetype: r.headers.get('content-type') || payload?.mimetype || 'audio/ogg' };
        }
      } else { log(`⚠️ S2: mediaUrl ${r.status}`); }
    } catch (e: any) { log(`⚠️ S2 mediaUrl falló: ${e.message}`); }
  }

  // STRATEGY 3: media.url field (rewrite localhost → public IP)
  if (payload?.media?.url) {
    try {
      const url = rewriteWahaUrl(payload.media.url);
      log(`📥 S3: media.url: ${url.substring(0, 120)}`);
      const r = await fetch(url, { headers: getWahaHeaders() });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 100) {
          log(`✅ S3: Media via media.url: ${buf.length} bytes`);
          return { buffer: buf, mimetype: payload.media.mimetype || r.headers.get('content-type') || 'audio/ogg' };
        }
      } else { log(`⚠️ S3: media.url ${r.status}`); }
    } catch (e: any) { log(`⚠️ S3 media.url falló: ${e.message}`); }
  }

  // STRATEGY 4: WAHA files API — GET /api/files/{filename} (for WHATSAPP_FILES_MIMETYPES)
  if (messageId) {
    try {
      // Try listing files for this session to find matching file
      const filesUrl = `${WAHA_API_URL}/api/files`;
      log(`📥 S4: Buscando en files API...`);
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
              log(`📥 S4: Descargando archivo: ${fileUrl.substring(0, 120)}`);
              const fr = await fetch(fileUrl, { headers: getWahaHeaders() });
              if (fr.ok) {
                const buf = Buffer.from(await fr.arrayBuffer());
                if (buf.length > 100) {
                  log(`✅ S4: Media via files API: ${buf.length} bytes`);
                  return { buffer: buf, mimetype: fr.headers.get('content-type') || payload?.mimetype || 'audio/ogg' };
                }
              }
            } else {
              log(`⚠️ S4: No se encontró archivo para ${shortId} entre ${files.length} archivos`);
            }
          }
        } catch { log(`⚠️ S4: Respuesta no es JSON, probablemente HTML/404`); }
      } else { log(`⚠️ S4: files API ${r.status}`); }
    } catch (e: any) { log(`⚠️ S4 files API falló: ${e.message}`); }
  }

  // STRATEGY 5: WAHA API — POST /api/{session}/messages/download
  if (messageId) {
    try {
      const postUrl = `${WAHA_API_URL}/api/${session}/messages/download`;
      log(`📥 S5: POST ${postUrl.substring(0, 80)} id: ${messageId.substring(0, 60)}`);
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
            log(`✅ S5: Media via POST: ${buf.length} bytes (${contentType})`);
            return { buffer: buf, mimetype: contentType };
          }
        }
      } else { log(`⚠️ S5: POST ${r.status}`); }
    } catch (e: any) { log(`⚠️ S5 POST falló: ${e.message}`); }
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
        log(`📥 S6: GET ${url.substring(0, 120)}`);
        const r = await fetch(url, { headers: getWahaHeaders() });
        if (r.ok) {
          const contentType = r.headers.get('content-type') || 'application/octet-stream';
          if (!contentType.includes('json')) {
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length > 100) {
              log(`✅ S6: Media via GET: ${buf.length} bytes (${contentType})`);
              return { buffer: buf, mimetype: contentType };
            }
          }
        } else { log(`⚠️ S6: GET ${r.status}: ${url.substring(0, 80)}`); }
      } catch (e: any) { log(`⚠️ S6 GET falló: ${e.message}`); }
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
    log(`🔍 Media detectada: type=${typeField}, mediaType=${mediaType}, mime=${mimetype}, id=${messageId}, hasMediaUrl=${!!mediaUrl}, hasMediaData=${!!(payload?.media?.data || payload?._data?.body)}`);
  }
  
  return { hasMedia, mediaType, mimetype, messageId, caption, mediaUrl };
};

// ===== AI RESPONSE (🧠 MEMORIA PERSISTENTE + AUTO-APRENDIZAJE) =====
// 🔍 Helper: Buscar etapa por keyword parcial en el nombre
function findStageByKeyword(stages: any[], keywords: string[]): string {
  for (const kw of keywords) {
    const found = stages.find((s: any) => {
      const name = (s.label || s.id || '').toLowerCase();
      return name.includes(kw.toLowerCase());
    });
    if (found) return found.label || found.id;
  }
  return '';
}

const generateAIResponse = async (ownerId: string, message: string, conversationId: string, whatsappLineId?: string | null): Promise<string | null> => {
  try {
    // 🔒 VERIFICAR SUSCRIPCIÓN — No responder si expiró
    const owner = await prisma.user.findUnique({ 
      where: { id: ownerId }, 
      select: { apiKey: true, apiKeyConnected: true, plan: true, trialEndsAt: true } 
    });
    if (!owner?.apiKey || !owner.apiKeyConnected) {
      clog(`⚠️ AI bloqueada — Sin API key o no conectada (userId: ${ownerId})`);
      return null;
    }

    // Verificar si la suscripción está activa
    let isExpired = false;
    if (owner.plan === 'trial') {
      if (owner.trialEndsAt && owner.trialEndsAt.getTime() < Date.now()) isExpired = true;
    } else {
      const sub = await prisma.subscription.findUnique({ where: { userId: ownerId } });
      if (!sub || sub.currentPeriodEnd.getTime() < Date.now() || sub.status === 'expired' || sub.status === 'cancelled') {
        isExpired = true;
      }
    }

    if (isExpired) {
      clog(`🔒 AI bloqueada — Suscripción expirada (userId: ${ownerId}, plan: ${owner.plan})`);
      return null;
    }

    const user = owner;

    let assistant = null;

    // 🔗 PRIMERO: Buscar asistente específico de esta línea
    if (whatsappLineId) {
      assistant = await prisma.assistant.findFirst({ 
        where: { userId: ownerId, whatsappLineId: whatsappLineId } 
      });
      if (assistant) {
        log(`📋 Asistente de LÍNEA "${assistant.name}" (lineId: ${whatsappLineId})`);
      }
    }

    // 🔄 FALLBACK: Si no hay asistente de línea, usar el activo global
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true }, orderBy: { updatedAt: 'desc' } });
      if (!assistant) {
        assistant = await prisma.assistant.findFirst({ where: { userId: ownerId }, orderBy: { updatedAt: 'desc' } });
        if (assistant) await prisma.assistant.update({ where: { id: assistant.id }, data: { isActive: true } });
        else {
          clog(`⚠️ AI bloqueada — Sin asistente configurado (userId: ${ownerId})`);
          return null;
        }
      }
      log(`📋 Asistente GLOBAL "${assistant.name}" (sin asistente específico de línea)`);
    }

    log(`📋 Asistente: "${assistant.name}" (contexto: ${assistant.context?.length || 0} chars)`);

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

    // Media triggers - Instrucción para que la IA active triggers naturalmente
    const mediaItems = assistant.mediaItems as any[];
    if (mediaItems?.length) {
      const triggerList = mediaItems.filter(m => m.trigger).map(m => {
        const triggers = m.trigger.split(',').map((t: string) => t.trim()).filter(Boolean);
        if (m.type === 'catalog') {
          return `- CATÁLOGO "${m.name}" (${(m.images || []).length} fotos) → Se activa si tu respuesta contiene: ${triggers.join(', ')}`;
        }
        return `- ${m.type === 'image' ? 'IMAGEN' : m.type === 'video' ? 'VIDEO' : 'AUDIO'} → Se activa si tu respuesta contiene: ${triggers.join(', ')}`;
      }).join('\n');
      if (triggerList) promptParts.push(`\n📸 SISTEMA DE MULTIMEDIA AUTOMÁTICO:
El sistema envía archivos automáticamente cuando detecta palabras clave en TU respuesta.

${triggerList}

⚠️ REGLAS ESTRICTAS:
- NUNCA escribas nombres de archivo, URLs o referencias como [image:xxx]
- NUNCA inventes links de imágenes
- Para activar el envío automático, simplemente INCLUYE la palabra trigger de forma natural en tu respuesta
- Ejemplo: Si el trigger es "catalogo", escribe algo como "Te muestro nuestro catálogo 👇" y el sistema enviará las fotos
- Ejemplo: Si el trigger es "colores", escribe "Te muestro los colores disponibles 👇" y las fotos se envían solas
- Tu respuesta debe ser SOLO TEXTO. Las imágenes las envía el sistema después automáticamente.`);
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
    
    // Si no hay etapas configuradas, la IA no detecta etapas automáticamente
    // El usuario debe configurar su asistente con base de conocimiento para activar etapas
    
    const stagesList = pipelineStages.length > 0 
      ? pipelineStages.map((s: any) => s.id || s.label).join(', ')
      : '';

    // 🧠 INSTRUCCIONES DE MEMORIA — Esto le dice a la IA que devuelva un bloque de datos
    let memoryPrompt = `
=== REGLAS DE MEMORIA (OBLIGATORIO) ===

1. NUNCA preguntes algo que el cliente ya dijo en la conversación o que esté en la MEMORIA GUARDADA.
2. Si ya sabes algún dato del cliente — ÚSALO, no lo vuelvas a preguntar.
3. Lee TODO el historial antes de responder. Si el cliente mencionó algo antes, recuérdalo.
4. Si el cliente vuelve después de días, salúdalo por su nombre y retoma donde quedaron.
5. Responde de forma natural, como un humano por WhatsApp.
`;

    // 🎯 SOLO incluir detección de etapas si hay etapas configuradas
    if (pipelineStages.length > 0) {
      memoryPrompt += `
=== ETAPAS DEL PIPELINE (DETECCIÓN AUTOMÁTICA) ===

🚨 LISTA EXACTA DE ETAPAS PERMITIDAS (NO PUEDES INVENTAR OTRAS):
${pipelineStages.map((s: any) => `- "${s.label || s.id}"`).join('\n')}

⚠️ REGLAS ESTRICTAS DE ETAPAS:
1. El campo "etapa_actual" SOLO puede contener una etapa de la lista de arriba, EXACTAMENTE como está escrita
2. NUNCA inventes etapas nuevas que no estén en la lista
3. Si no estás seguro, usa la etapa más cercana de la lista
4. Copia el nombre EXACTO — respeta mayúsculas, acentos y espacios
5. Si ninguna etapa aplica, déjalo vacío ""
`;
    }

    memoryPrompt += `
=== 🚨 ACCIONES AUTOMÁTICAS — MUY IMPORTANTE 🚨 ===

El campo "accion" dispara acciones REALES en el sistema. DEBES usarlo cuando:

📅 accion = "crear_cita" — Cuando el cliente CONFIRMA una cita/reunión/demostración:
   - El cliente dice "sí, mañana a las 8" y tú confirmas → accion = "crear_cita"
   - Se agenda una reunión, demo, consulta, etc. con fecha y hora definida → accion = "crear_cita"
   - Llena también: fecha_cita, hora_cita, tipo_cita (qué tipo: demo, reunión, consulta, etc.)

🛒 accion = "crear_pedido" — Cuando el cliente CONFIRMA un pedido/compra:
   - El cliente confirma que quiere comprar y tiene datos completos → accion = "crear_pedido"
   - Llena también: fecha_entrega y todos los datos del pedido

🏨 accion = "crear_reserva" — Cuando el cliente CONFIRMA una reserva:
   - Reserva de mesa en restaurante, habitación de hotel, cancha deportiva, sala de eventos, turno, espacio, vehículo, servicio, etc.
   - El cliente confirma fecha, hora y lo que quiere reservar → accion = "crear_reserva"
   - Llena también: fecha_reserva, hora_reserva, tipo_reserva (qué se reserva: mesa, habitación, cancha, sala, turno, etc.), num_personas (cuántas personas), duracion_reserva (tiempo estimado en minutos si aplica)

⚠️ IMPORTANTE: Solo usa la accion de CREAR una vez cuando se confirma. Si "pedido" ya dice "creado", "cita" dice "creada", o "reserva" dice "creada" en la memoria guardada, NO vuelvas a poner la accion de crear.

🔄 ACTUALIZAR REGISTROS EXISTENTES:
Si el cliente ya tiene un pedido/cita/reserva CREADO y pide CAMBIAR algo (fecha, hora, dirección, producto, cantidad, etc.):
- accion = "actualizar_pedido" → Cuando cambia datos de un pedido ya creado
- accion = "actualizar_cita" → Cuando cambia fecha/hora de una cita ya creada
- accion = "actualizar_reserva" → Cuando cambia datos de una reserva ya creada
Actualiza los campos correspondientes con los nuevos valores y pon la accion de actualizar.
Ejemplos: "cambié de opinión, quiero el buzo rojo" → actualizar_pedido, "mejor a las 3pm" → actualizar_cita, "seremos 6 personas" → actualizar_reserva

=== ⚠️⚠️⚠️ BLOQUE DE MEMORIA - SUPER IMPORTANTE ⚠️⚠️⚠️ ===

🔴 OBLIGATORIO: AL FINAL de CADA respuesta, DEBES incluir este bloque de memoria.
🔴 Sin este bloque, el sistema no funcionará correctamente.
🔴 Inclúyelo SIEMPRE, incluso si solo tienes el nombre del cliente.

FORMATO EXACTO (copia y pega, luego llena los campos que conoces):

<<MEMORY_JSON>>{"nombre":"","nombre_empresa":"","tipo_negocio":"","telefono":"","email":"","producto_servicio":"","detalles_producto":"","cantidad":"","precio":"","descuento":"","total":"","ciudad":"","direccion":"","barrio":"","metodo_pago":"","fecha_entrega":"","pedido":"","fecha_cita":"","hora_cita":"","tipo_cita":"","cita":"","fecha_reserva":"","hora_reserva":"","tipo_reserva":"","num_personas":"","duracion_reserva":"","reserva":"","notas":"","etapa_actual":"","accion":""}<<END_MEMORY>>

INSTRUCCIONES:
- Llena SOLO los campos que ya conoces. Deja "" los que NO sabes.
- "nombre" = Nombre del cliente
- "nombre_empresa" = Nombre del negocio o empresa del cliente (ej: "Moda Express", "La Parrilla", "Sonrisa Dental")
- "tipo_negocio" = A qué se dedica: tipo de negocio y productos/servicios que ofrece (ej: "Tienda de ropa femenina - vende buzos, camisetas, jeans", "Restaurante de comida italiana - pizzas, pastas, lasagna")
- "telefono" = Teléfono o celular del cliente
- "email" = Email del cliente (si lo da)
- "producto_servicio" = Qué producto o servicio quiere (ej: "Buzo Negro XL Premium", "Consulta legal", "Paquete turístico Cancún")
- "detalles_producto" = Especificaciones adicionales como talla, color, modelo, variante, plan, etc.
- "cantidad" = Cuántas unidades quiere
- "precio" = Precio unitario o del servicio
- "descuento" = Descuento aplicado (si hay)
- "total" = Total a pagar
- "ciudad" = Ciudad de envío o del cliente
- "direccion" = Dirección completa de entrega
- "barrio" = Barrio del cliente
- "metodo_pago" = Método de pago elegido
- "fecha_entrega" = Fecha de entrega acordada
- "pedido" = NO lo llenes tú, el sistema lo actualiza
- "notas" = Cualquier dato extra relevante del cliente
- "etapa_actual" = ${pipelineStages.length > 0 ? `OBLIGATORIO. SOLO puede ser una de estas exactas: ${pipelineStages.map((s: any) => `"${s.label || s.id}"`).join(', ')}. NO inventes otras.` : 'Déjalo vacío si no hay etapas configuradas.'}
- "accion" = "crear_cita" cuando SE CONFIRMA cita. "crear_pedido" cuando SE CONFIRMA pedido. "crear_reserva" cuando SE CONFIRMA reserva. Vacío en otros casos.
- "fecha_cita" = Fecha de la cita confirmada (YYYY-MM-DD o texto como "mañana").
- "hora_cita" = Hora de la cita (ej: "8:00", "14:30").
- "tipo_cita" = Tipo: "demostración", "reunión", "consulta", "asesoría", etc.
- "fecha_reserva" = Fecha de la reserva confirmada (YYYY-MM-DD o texto como "mañana", "viernes").
- "hora_reserva" = Hora de la reserva (ej: "19:00", "8:00 pm").
- "tipo_reserva" = Qué se reserva: "mesa", "habitación", "cancha", "sala", "turno", "vehículo", "espacio", etc.
- "num_personas" = Número de personas para la reserva (ej: "2", "6", "10").
- "duracion_reserva" = Duración estimada en minutos si aplica (ej: "60", "120").
- "cita", "pedido" y "reserva" = NO los llenes tú, el sistema los actualiza automáticamente.
- El bloque va en la ÚLTIMA LÍNEA de tu respuesta.
- NO expliques el bloque al cliente, es interno/oculto.
`;

    promptParts.push(memoryPrompt);

    // 🔊 INSTRUCCIONES DE VOZ (si ElevenLabs está activo)
    if (assistant?.voiceEnabled && assistant?.elevenLabsKey && assistant?.selectedVoice) {
      promptParts.push(`
=== 🔊 MODO VOZ ACTIVADO ===

El sistema puede convertir tus respuestas en notas de voz. Usa la etiqueta <<VOZ>> al INICIO de tu respuesta cuando consideres que responder con audio mejoraría la experiencia del cliente.

CUÁNDO USAR <<VOZ>>:
- Saludos personalizados (primera interacción)
- Confirmaciones importantes (pedidos, citas, reservas confirmadas)
- Explicaciones detalladas de productos/servicios
- Seguimiento post-venta
- Cuando el cliente envía audio (responder con audio es más natural)
- Momentos emotivos o de cierre de venta

CUÁNDO NO USAR <<VOZ>> (solo texto):
- Mensajes con listas, precios, direcciones o datos técnicos (mejor leer)
- Respuestas muy cortas ("ok", "listo", "sí")
- Cuando envías links o números de cuenta

FORMATO: Si quieres voz, empieza tu respuesta con <<VOZ>> y luego tu texto normal.
Ejemplo: <<VOZ>>¡Hola Pedro! Bienvenido, me alegra que nos contactes...

El tag <<VOZ>> es interno, el cliente NO lo verá.
`);
    }

    // 🔄 INSTRUCCIONES DE TRANSFERENCIA ENTRE LÍNEAS
    if (whatsappLineId) {
      const allLines = await prisma.whatsappLine.findMany({
        where: { userId: ownerId, status: 'connected', isActive: true },
        select: { id: true, label: true, phone: true, sessionName: true }
      });
      
      if (allLines.length >= 2) {
        const currentLine = allLines.find(l => l.id === whatsappLineId);
        const otherLines = allLines.filter(l => l.id !== whatsappLineId);
        
        const linesList = otherLines.map(l => 
          `  - "${l.label}" → número: ${l.phone || 'sin número'}`
        ).join('\n');
        
        promptParts.push(`
=== 🔄 TRANSFERENCIA ENTRE LÍNEAS ===

Estás respondiendo desde la línea: "${currentLine?.label || 'Principal'}" (${currentLine?.phone || ''})

Otras líneas disponibles para transferir:
${linesList}

CÓMO TRANSFERIR:
Si el cliente necesita ser atendido por otra área/departamento/persona, usa la etiqueta <<TRANSFERIR:número>> en tu respuesta.

Ejemplo: Si necesitas transferir al +573118083993:
"Entiendo, voy a transferirte con nuestro equipo de soporte para que te ayuden mejor. <<TRANSFERIR:${otherLines[0]?.phone || '+573118083993'}>>"

TRANSFERENCIA CON RESET (para demos):
Si necesitas transferir Y LIMPIAR esta conversación para que el próximo cliente empiece de cero, usa <<TRANSFERIR_RESET:número>>
Ejemplo: "Te conecto de vuelta con Elisa 🚀 <<TRANSFERIR_RESET:+573118083993>>"
Esto borra todos los mensajes de esta conversación después de transferir.

REGLAS DE TRANSFERENCIA:
- SOLO transfiere cuando el cliente necesita un área diferente o cuando tu contexto lo indique
- El número debe ser EXACTO como aparece arriba (con código de país)
- Los tags <<TRANSFERIR:>> y <<TRANSFERIR_RESET:>> son internos, el cliente NO los verá
- Escribe un mensaje de despedida natural ANTES del tag
- La otra línea recibirá la conversación con la memoria del cliente copiada
- Si en tu contexto/instrucciones se menciona cuándo transferir a cada línea, sigue esas reglas
`);
      }
    }


    // 📅 INYECTAR DISPONIBILIDAD REAL — Para que la IA ofrezca horarios reales
    try {
      const resources = await prisma.resource.findMany({
        where: { userId: ownerId, isActive: true },
        orderBy: { order: 'asc' }
      });
      const schedules = await prisma.businessSchedule.findMany({
        where: { userId: ownerId },
        orderBy: { dayOfWeek: 'asc' }
      });

      if (schedules.length > 0 || resources.length > 0) {
        const today = new Date();
        const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        
        // Generate availability for today and next 3 days
        const availabilityLines: string[] = [];
        availabilityLines.push('=== 📅 DISPONIBILIDAD EN TIEMPO REAL (OBLIGATORIO CONSULTAR) ===');
        
        if (resources.length > 0) {
          availabilityLines.push(`🏪 Recursos disponibles: ${resources.map(r => r.name).join(', ')} (${resources.length} total)`);
        }

        // Show schedule summary
        const openDays = schedules.filter(s => s.isOpen);
        if (openDays.length > 0) {
          availabilityLines.push(`🕐 Horario: ${openDays.map(s => `${dayNames[s.dayOfWeek]}: ${s.startTime}-${s.endTime}`).join(' | ')}`);
          availabilityLines.push(`⏱️ Duración por turno: ${openDays[0].slotDuration} min`);
        }

        // Check availability for today + next 3 days
        for (let dayOffset = 0; dayOffset <= 3; dayOffset++) {
          const checkDate = new Date(today);
          checkDate.setDate(checkDate.getDate() + dayOffset);
          const dateStr = checkDate.toISOString().split('T')[0];
          const dayOfWeek = checkDate.getDay();
          const daySchedule = schedules.find(s => s.dayOfWeek === dayOfWeek);

          if (!daySchedule || !daySchedule.isOpen) {
            availabilityLines.push(`❌ ${dayNames[dayOfWeek]} ${dateStr}: CERRADO`);
            continue;
          }

          // Get appointments for this day
          const dayStart = new Date(dateStr + 'T00:00:00');
          const dayEnd = new Date(dateStr + 'T23:59:59');
          const dayAppts = await prisma.appointment.findMany({
            where: { userId: ownerId, date: { gte: dayStart, lte: dayEnd }, status: { notIn: ['cancelled'] } },
            select: { time: true, duration: true, resourceId: true }
          });

          // Generate slots
          const slotDur = daySchedule.slotDuration || 60;
          const [sH, sM] = daySchedule.startTime.split(':').map(Number);
          const [eH, eM] = daySchedule.endTime.split(':').map(Number);
          const startMin = sH * 60 + sM;
          const endMin = eH * 60 + eM;
          let bStartMin = -1, bEndMin = -1;
          if (daySchedule.breakStart && daySchedule.breakEnd) {
            const [bsH, bsM] = daySchedule.breakStart.split(':').map(Number);
            const [beH, beM] = daySchedule.breakEnd.split(':').map(Number);
            bStartMin = bsH * 60 + bsM;
            bEndMin = beH * 60 + beM;
          }

          const totalCap = resources.length || 1;
          const freeSlots: string[] = [];
          const fullSlots: string[] = [];

          for (let m = startMin; m + slotDur <= endMin; m += slotDur) {
            if (bStartMin >= 0 && m >= bStartMin && m < bEndMin) continue;
            // Skip past hours for today
            if (dayOffset === 0) {
              const nowMin = today.getHours() * 60 + today.getMinutes();
              if (m <= nowMin) continue;
            }
            const h = Math.floor(m / 60);
            const min = m % 60;
            const slot = `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;

            const overlapping = dayAppts.filter(a => {
              if (!a.time) return false;
              const [aH, aM] = a.time.split(':').map(Number);
              const aStart = aH * 60 + aM;
              const aEnd = aStart + (a.duration || slotDur);
              return aStart < m + slotDur && aEnd > m;
            });

            const freeCount = totalCap - overlapping.length;
            if (freeCount > 0) {
              if (resources.length > 0) {
                const freeR = resources.filter(r => !overlapping.some(a => a.resourceId === r.id));
                freeSlots.push(`${slot}(${freeR.map(r => r.name).join(',')})`);
              } else {
                freeSlots.push(slot);
              }
            } else {
              fullSlots.push(slot);
            }
          }

          const label = dayOffset === 0 ? 'HOY' : dayOffset === 1 ? 'MAÑANA' : dayNames[dayOfWeek];
          availabilityLines.push(`📅 ${label} ${dateStr}: ✅ Libres: ${freeSlots.length > 0 ? freeSlots.join(' | ') : 'NINGUNO'} ${fullSlots.length > 0 ? `| ❌ Llenos: ${fullSlots.join(',')}` : ''}`);
        }

        availabilityLines.push('⚠️ REGLAS: Solo ofrece horarios DISPONIBLES (✅). NUNCA ofrezcas horarios llenos (❌). Si no hay disponibilidad, sugiere otro día. Cuando confirmen cita/reserva, usa la acción correspondiente.');

        promptParts.push(availabilityLines.join('\n'));
        log(`📅 Disponibilidad inyectada: ${resources.length} recursos, ${schedules.length} horarios`);
      }
    } catch (availErr: any) {
      log(`⚠️ Error cargando disponibilidad: ${availErr.message}`);
    }


    const systemPrompt = promptParts.join('\n\n') || 'Eres un asistente virtual amable por WhatsApp.';
    log(`🧠 Prompt: ${systemPrompt.length} chars | Cliente: ${clientName || 'desconocido'} | Memoria: ${Object.keys(savedContext).length} campos`);

    // Construir mensajes para OpenAI (30 mensajes = cubre flujo completo de venta)
    const recent = [...history].reverse().slice(-30);
    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    recent.forEach(m => messages.push({ role: m.fromMe ? 'assistant' : 'user', content: m.content.substring(0, 500) }));
    
    // 🔴 RECORDATORIO: Agregar al mensaje del usuario para forzar el bloque de memoria
    const memoryReminder = `\n\n[SISTEMA: Recuerda incluir <<MEMORY_JSON>>...<<END_MEMORY>> al final. Si confirmaste una cita/reunión, pon accion:"crear_cita" con fecha_cita y hora_cita. Si confirmaste un pedido, pon accion:"crear_pedido". Si confirmaste una reserva (mesa, habitación, cancha, sala, turno, etc.), pon accion:"crear_reserva" con fecha_reserva, hora_reserva, tipo_reserva y num_personas.]`;
    messages.push({ role: 'user', content: message + memoryReminder });

    // Llamar a OpenAI
    // 💰 MODELO FIJO: gpt-4o-mini (económico y potente, ~60x más barato que gpt-4-turbo)
    // NO se cambia desde el panel — siempre usa este modelo
    const FIXED_MODEL = 'gpt-4o-mini';
    for (const model of [FIXED_MODEL]) {
      try {
        log(`🤖 OpenAI (${model}, ${messages.length} msgs)...`);
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
            log(`⚠️ SIN BLOQUE DE MEMORIA en respuesta (${reply.length} chars)`);
            
            // 🔄 FALLBACK GENÉRICO: Extraer datos universales del historial
            // ⚠️ Solo extrae campos UNIVERSALES que aplican a CUALQUIER negocio
            // Los campos específicos del producto los maneja GPT via MEMORY_JSON
            const clientMessages = history.filter(m => !m.fromMe).map(m => m.content).join(' ').toLowerCase();
            const botMessages = history.filter(m => m.fromMe).map(m => m.content).join(' ').toLowerCase();
            const fullConversation = clientMessages + ' ' + botMessages + ' ' + reply.toLowerCase();
            const replyLower = reply.toLowerCase();
            
            // Extraer datos del historial
            const extractedData: any = { ...savedContext };
            
            // 👤 Nombre — Universal para cualquier negocio
            const nombreMatch = clientMessages.match(/(?:me llamo|soy|mi nombre es)\s+([a-záéíóúñ]+)/i) ||
                               reply.match(/(?:gracias|hola|perfecto|genial),?\s+\*?\*?([a-záéíóúñ]+)\*?\*?[!,]/i);
            if (nombreMatch && !extractedData.nombre) {
              extractedData.nombre = nombreMatch[1];
            }
            
            // 📞 Teléfono — Universal
            const telefonoMatch = clientMessages.match(/(\d{7,15})/);
            if (telefonoMatch && !extractedData.telefono) {
              const num = telefonoMatch[1];
              if (num.length >= 7 && num.length <= 15) {
                extractedData.telefono = num;
              }
            }
            
            // 📧 Email — Universal
            const emailMatch = clientMessages.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
            if (emailMatch && !extractedData.email) {
              extractedData.email = emailMatch[1];
            }

            // 🔢 Cantidad — Genérico (busca patrones como "quiero 3", "2 unidades", etc.)
            const cantidadMatch = clientMessages.match(/\b(\d{1,3})\s*(?:unidad|unidades|piezas?|pares?|cajas?|bolsas?|paquetes?|servicios?)\b/i) ||
                                  clientMessages.match(/\bquiero\s+(\d{1,3})\b/i) ||
                                  clientMessages.match(/\b(\d{1,3})\s+(?:por favor|porfavor|porfa)\b/i);
            if (cantidadMatch && !extractedData.cantidad) {
              extractedData.cantidad = cantidadMatch[1];
            }

            // 💳 Método de pago — Universal
            const pagoPatterns = /(efectivo|nequi|daviplata|transferencia|pse|tarjeta|paypal|contra\s*entrega|qr|bitcoin|crypto|zelle|bancolombia|davivienda)/i;
            const pagoMatch = clientMessages.match(pagoPatterns);
            if (pagoMatch && !extractedData.metodo_pago) {
              extractedData.metodo_pago = pagoMatch[1];
            }
            
            // 🎯 DETECTAR ETAPA — GENÉRICO basado en completitud de datos
            let fallbackStage = '';
            const lastMsgLower = (message || '').toLowerCase();
            if (pipelineStages.length > 0) {
              
              // Crear mapa de etapas con keywords GENÉRICAS (sin productos específicos)
              const stageKeywords: Record<string, string[]> = {};
              for (const s of pipelineStages) {
                const name = (s.label || s.id || '').toLowerCase();
                const keywords: string[] = [name];
                
                // Keywords genéricas basadas en el NOMBRE de la etapa (funciona para cualquier negocio)
                if (name.includes('saludo') || name.includes('bienvenida') || name.includes('nuevo')) keywords.push('hola', 'bienvenido', 'cómo te llamas');
                if (name.includes('interesado') || name.includes('interés') || name.includes('interes')) keywords.push('interesado', 'quiero', 'me interesa', 'información');
                if (name.includes('cotización') || name.includes('cotizacion') || name.includes('precio')) keywords.push('precio', 'cuánto', 'cuanto', 'cuesta', 'vale', '$');
                if (name.includes('pendiente') && (name.includes('dato') || name.includes('info'))) keywords.push('datos', 'información', 'necesito');
                if (name.includes('pago') || name.includes('factura')) keywords.push('pago', 'pagar', 'transferencia', 'tarjeta', 'efectivo');
                if (name.includes('pedido') || name.includes('orden') || name.includes('compra')) keywords.push('pedido', 'confirmó', 'confirmo', 'dale', 'listo', 'compra');
                if (name.includes('envío') || name.includes('envio') || name.includes('dirección') || name.includes('direccion')) keywords.push('dirección', 'barrio', 'envío', 'entregar');
                if (name.includes('agenda') || name.includes('entrega') || name.includes('cita') || name.includes('reunión')) keywords.push('fecha', 'hora', 'cuándo', 'agendar', 'mañana');
                if (name.includes('confirm') || name.includes('cerrado') || name.includes('completo')) keywords.push('confirmado', 'agendado', 'listo', 'perfecto');
                if (name.includes('perdido') || name.includes('cancelado') || name.includes('no interesado')) keywords.push('no me interesa', 'no gracias', 'cancelar', 'no quiero');
                if (name.includes('seguimiento') || name.includes('post')) keywords.push('seguimiento', 'cómo va', 'mi pedido', 'estado');
                if (name.includes('propuesta') || name.includes('demo')) keywords.push('propuesta', 'demostración', 'demo', 'prueba');
                if (name.includes('negoci') || name.includes('cierre')) keywords.push('cerrar', 'negociar', 'acuerdo');
                
                stageKeywords[s.label || s.id] = keywords;
              }
              
              // 1. Prioridad: Si el cliente dice "no interesa" / "cancelar"
              const perdidoStage = pipelineStages.find((s: any) => {
                const n = (s.label || s.id || '').toLowerCase();
                return n.includes('perdido') || n.includes('cancelado') || n.includes('no interesado');
              });
              if (perdidoStage && (lastMsgLower.includes('no me interesa') || lastMsgLower.includes('no gracias') || lastMsgLower.includes('cancelar'))) {
                fallbackStage = perdidoStage.label || perdidoStage.id;
              }
              
              // 2. Detección GENÉRICA por completitud de datos (funciona para CUALQUIER negocio)
              if (!fallbackStage) {
                const d = extractedData;
                const hasName = !!d.nombre;
                const hasProduct = !!d.producto_servicio || !!d.detalles_producto;
                const hasQuantity = !!d.cantidad;
                const hasPrice = !!d.precio || !!d.total;
                const hasCity = !!d.ciudad;
                const hasAddress = !!d.direccion;
                const hasPayment = !!d.metodo_pago;
                const hasDelivery = !!d.fecha_entrega || !!d.fecha_cita;
                const hasOrder = !!d.pedido;
                
                // Contar campos llenos para determinar progreso
                const filledFields = [hasName, hasProduct, hasQuantity, hasPrice, hasCity, hasAddress, hasPayment, hasDelivery].filter(Boolean).length;
                
                // Buscar etapa según progreso (de más avanzado a menos avanzado)
                if (hasOrder || (hasDelivery && hasPayment && hasAddress)) {
                  fallbackStage = findStageByKeyword(pipelineStages, ['confirm', 'completo', 'finalizado', 'cerrado', 'entregado']);
                } else if (hasAddress && hasPayment) {
                  fallbackStage = findStageByKeyword(pipelineStages, ['agenda', 'entrega', 'cita', 'program', 'despacho']);
                } else if (hasPayment) {
                  fallbackStage = findStageByKeyword(pipelineStages, ['pago', 'factur', 'cobr']);
                } else if (filledFields >= 4) {
                  // Tiene suficientes datos → buscar etapa de pedido/cotización/cierre
                  fallbackStage = findStageByKeyword(pipelineStages, ['pedido', 'orden', 'cotizaci', 'cierre', 'realiz']);
                } else if (hasProduct || filledFields >= 2) {
                  // Tiene producto o algunos datos → en cotización/interesado
                  fallbackStage = findStageByKeyword(pipelineStages, ['cotizaci', 'precio', 'interes', 'calific']);
                } else if (hasName) {
                  // Solo tiene nombre → interesado/nuevo
                  fallbackStage = findStageByKeyword(pipelineStages, ['interes', 'nuevo', 'contacto', 'saludo']);
                } else {
                  // No tiene nada → nuevo/saludo
                  fallbackStage = findStageByKeyword(pipelineStages, ['saludo', 'bienven', 'nuevo', 'contacto']);
                }
                
                // Fallback: si tiene datos pero no encontró etapa
                if (!fallbackStage && filledFields > 0) {
                  fallbackStage = findStageByKeyword(pipelineStages, ['cotizaci', 'interes', 'proceso', 'pendiente']);
                }
              }
              
            } // fin de if (pipelineStages.length > 0)
            
            // ⚠️ VALIDACIÓN ESTRICTA — Solo guardar si la etapa EXISTE en el pipeline
            const validFallbackStage = fallbackStage ? pipelineStages.find((s: any) => 
              s.id === fallbackStage || s.label === fallbackStage ||
              s.id?.toLowerCase() === fallbackStage.toLowerCase() ||
              s.label?.toLowerCase() === fallbackStage.toLowerCase()
            ) : null;
            
            const updateData: any = {};
            if (Object.keys(extractedData).length > Object.keys(savedContext).length) {
              updateData.contextData = extractedData;
              if (validFallbackStage) extractedData.etapa_actual = validFallbackStage.label || validFallbackStage.id;
              log(`🔍 Datos extraídos: ${JSON.stringify(extractedData)}`);
            }
            if (validFallbackStage) {
              updateData.stage = validFallbackStage.id || validFallbackStage.label;
              log(`🔄 Etapa por fallback: ${updateData.stage}`);
            }
            
            if (Object.keys(updateData).length > 0) {
              await prisma.conversation.update({
                where: { id: conversationId },
                data: updateData
              });
            }
            
            // 📅 FALLBACK: Detectar citas confirmadas en la respuesta de la IA
            if (savedContext.cita !== 'creada' && savedContext.pedido !== 'creado') {
              // ⚠️ No crear cita si es contexto de PEDIDO (tiene producto, talla, color, etc.)
              const isOrderContext = !!(savedContext.producto_servicio || savedContext.tipo || savedContext.talla || savedContext.color || savedContext.total || savedContext.direccion);
              
              const confirmPatterns = [
                /(?:agendamos|queda agendad).*(?:cita|reunión|demo|consulta|asesoría)/i,
                /(?:reunión|demostración|cita|demo).*(?:para|el|mañana|a las)/i,
                /(?:nos vemos|te espero|te esperamos).*(?:mañana|lunes|martes|miércoles|jueves|viernes|sábado|domingo)/i,
                /(?:cita|reunión|demo).*(?:a las\s+\d{1,2}[:\s]*\d{0,2}\s*(?:am|pm|a\.m|p\.m)?)/i
              ];
              
              const replyHasConfirm = confirmPatterns.some(p => p.test(replyLower));
              const clientConfirmed = lastMsgLower.includes('sí') || lastMsgLower.includes('si') || lastMsgLower.includes('ok') || lastMsgLower.includes('claro') || lastMsgLower.includes('dale') || lastMsgLower.includes('perfecto') || lastMsgLower.includes('listo');
              
              if (replyHasConfirm && clientConfirmed && !isOrderContext) {
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
                  
                  log(`📅 FALLBACK: Cita auto-detectada: ${tipoCita} | ${nombre} | ${citaDate.toLocaleDateString('es-CO')} ${citaTime}`);
                  
                  // Auto CRM
                  const existingCrm = await prisma.client.findFirst({ where: { userId: ownerId, phone: { endsWith: phoneClean.slice(-10) } } });
                  if (!existingCrm) {
                    await prisma.client.create({
                      data: { userId: ownerId, name: nombre, phone: phoneClean, status: 'active', tags: [tipoCita, 'whatsapp'], lastContact: new Date(), whatsappLineId: whatsappLineId || null }
                    });
                    log(`👥 CRM: "${nombre}" creado desde fallback`);
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
              const detectedStage = (memoryData.etapa_actual || memoryData.paso_actual || '').trim();
              const actionToTake = memoryData.accion || '';
              
              // Actualizar conversación con memoria Y etapa
              const updateData: any = { contextData: merged };
              if (detectedStage && pipelineStages.length > 0) {
                // Verificar que la etapa existe en el pipeline (match exacto o fuzzy)
                let validStage = pipelineStages.find((s: any) => 
                  s.id === detectedStage || s.label === detectedStage ||
                  s.id?.toLowerCase().trim() === detectedStage.toLowerCase().trim() ||
                  s.label?.toLowerCase().trim() === detectedStage.toLowerCase().trim()
                );
                
                // Fuzzy match: si no hay exacto, buscar coincidencia parcial
                if (!validStage) {
                  const detectedLower = detectedStage.toLowerCase().trim();
                  validStage = pipelineStages.find((s: any) => {
                    const label = (s.label || s.id || '').toLowerCase().trim();
                    return label.includes(detectedLower) || detectedLower.includes(label);
                  });
                }
                
                if (validStage) {
                  updateData.stage = validStage.id || validStage.label;
                  log(`🎯 Etapa automática: ${updateData.stage}`);
                } else {
                  // ⚠️ La IA sugirió una etapa que NO existe — rechazar
                  log(`⚠️ Etapa RECHAZADA (no existe en pipeline): "${detectedStage}" | Etapas válidas: [${pipelineStages.map((s: any) => s.label || s.id).join(', ')}]`);
                }
              }
              
              await prisma.conversation.update({
                where: { id: conversationId },
                data: updateData
              });
              
              log(`🧠 Memoria guardada: ${JSON.stringify(merged)}`);
              
              // 🛒 CREAR PEDIDO AUTOMÁTICO CON FECHA DE ENTREGA
              // ✅ VALIDACIÓN: Solo crear pedido cuando el cliente envió datos COMPLETOS
              const hasName = !!(merged.nombre);
              const hasPhone = !!(merged.telefono || merged.celular);
              const hasAddress = !!(merged.direccion || merged.ciudad || merged.barrio);
              const hasProduct = !!(merged.producto_servicio || merged.tipo || merged.color || merged.talla);
              const dataComplete = hasName && hasAddress && hasProduct;
              
              if (actionToTake === 'crear_pedido' && merged.pedido !== 'creado') {
                if (!dataComplete) {
                  log(`⏳ Pedido pendiente - Faltan datos: ${!hasName ? 'nombre ' : ''}${!hasAddress ? 'dirección/ciudad ' : ''}${!hasProduct ? 'producto ' : ''}`);
                  // No crear el pedido aún, esperar a que el cliente complete datos
                } else {
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
                  
                  // 🧩 Construir descripción del producto (compatible con campos nuevos Y viejos)
                  let productoDesc = merged.producto_servicio || '';
                  if (!productoDesc) {
                    // Backward compatibility: construir desde campos legacy si existen
                    const legacyParts = [merged.tipo, merged.color, merged.talla, merged.calidad].filter(Boolean);
                    if (legacyParts.length > 0) productoDesc = legacyParts.join(' - ');
                  }
                  const detallesDesc = merged.detalles_producto || '';

                  const orderData = {
                    userId: ownerId,
                    type: 'order',
                    clientName: merged.nombre || clientName || 'Cliente WhatsApp',
                    clientPhone: clientPhone.replace('@c.us', ''),
                    date: deliveryDate,
                    time: '14:00',
                    duration: 300,
                    status: 'pending',
                    notes: `📦 PEDIDO WHATSAPP\n` +
                           `━━━━━━━━━━━━━━━\n` +
                           `🛍️ Producto/Servicio: ${productoDesc || 'N/A'}\n` +
                           (detallesDesc ? `📋 Detalles: ${detallesDesc}\n` : '') +
                           `📦 Cantidad: ${merged.cantidad || '1'}\n` +
                           (merged.precio ? `💰 Precio: $${merged.precio}\n` : '') +
                           ((merged.precio_unitario && !merged.precio) ? `💰 Precio: $${merged.precio_unitario}\n` : '') +
                           (merged.descuento ? `🏷️ Descuento: ${merged.descuento}\n` : '') +
                           `💵 Total: $${merged.total || '0'}\n` +
                           `💳 Pago: ${merged.metodo_pago || 'Por definir'}\n` +
                           `━━━━━━━━━━━━━━━\n` +
                           (merged.direccion ? `📍 Dirección: ${merged.direccion}\n` : '') +
                           (merged.barrio ? `🏘️ Barrio: ${merged.barrio}\n` : '') +
                           (merged.ciudad ? `🏙️ Ciudad: ${merged.ciudad}\n` : '') +
                           ((merged.telefono || merged.celular) ? `📞 Teléfono: ${merged.telefono || merged.celular}\n` : '') +
                           (merged.notas ? `📝 Notas: ${merged.notas}\n` : '') +
                           `━━━━━━━━━━━━━━━`,
                    total: parseFloat((merged.total || merged.envio || '0').toString().replace(/[^0-9.]/g, '')) || 0,
                    address: [merged.direccion, merged.barrio, merged.ciudad].filter(Boolean).join(', ').trim() || '',
                    whatsappLineId: whatsappLineId || null
                  };
                  await prisma.appointment.create({ data: orderData });
                  // Marcar pedido como creado
                  merged.pedido = 'creado';
                  // 🔔 Push — Nuevo pedido
                  sendPushToUser(ownerId, { title: '🛒 ¡Nuevo Pedido!', body: `${merged.nombre || clientName || 'Cliente'} — ${merged.producto_servicio || 'Pedido'}`.substring(0, 120), url: '/agenda', tag: `order-${Date.now()}` }).catch(() => {});
                  await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { contextData: merged }
                  });
                  log(`🛒 Pedido agendado para ${deliveryDate.toLocaleDateString('es-CO')} - ${merged.nombre || clientName}`);
                  
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
                          address: [merged.direccion, merged.barrio, merged.ciudad].filter(Boolean).join(', ') || null,
                          notes: merged.notas ? `${merged.notas}\nCliente desde WhatsApp` : `Cliente registrado automáticamente desde pedido WhatsApp`,
                          status: 'active',
                          tags: ['pedido', 'whatsapp'],
                          totalPurchases: parseFloat((merged.total || '0').toString().replace(/[^0-9.]/g, '')) || 0,
                          lastContact: new Date(),
                          whatsappLineId: whatsappLineId || null
                        }
                      });
                      log(`👥 CRM: Cliente "${merged.nombre || clientName}" creado desde pedido`);
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
                } // close else (dataComplete)
              }
              
              // 🔔 AUTO-DETECTAR: Si no hubo acción crear_pedido pero los datos están completos, crear pedido
              if (actionToTake !== 'crear_pedido' && merged.pedido !== 'creado' && dataComplete) {
                // Verificar si la IA confirmó/resumió el pedido en su respuesta
                const orderConfirmPatterns = [
                  /(?:he registrado|pedido registrado|confirmar.*pedido|proceder|resumen final|información.*registrada)/i,
                  /(?:gracias por los datos|datos.*completos|todo listo|pedido.*confirmado)/i,
                  /(?:procederé|vamos a.*confirmar|queda.*registrad)/i
                ];
                const aiConfirmedOrder = orderConfirmPatterns.some(p => p.test(reply));
                
                if (aiConfirmedOrder) {
                  try {
                    let deliveryDate = new Date();
                    if (merged.fecha_entrega) {
                      const fechaStr = merged.fecha_entrega.toLowerCase();
                      const hoy = new Date();
                      if (fechaStr.includes('mañana') || fechaStr.includes('manana')) {
                        deliveryDate = new Date(hoy); deliveryDate.setDate(deliveryDate.getDate() + 1);
                      } else if (fechaStr.includes('pasado')) {
                        deliveryDate = new Date(hoy); deliveryDate.setDate(deliveryDate.getDate() + 2);
                      } else {
                        const parsed = new Date(merged.fecha_entrega);
                        if (!isNaN(parsed.getTime())) deliveryDate = parsed;
                      }
                    }
                    
                    let productoDesc = merged.producto_servicio || '';
                    if (!productoDesc) {
                      const legacyParts = [merged.tipo, merged.color, merged.talla, merged.calidad].filter(Boolean);
                      if (legacyParts.length > 0) productoDesc = legacyParts.join(' - ');
                    }
                    
                    const orderData = {
                      userId: ownerId, type: 'order',
                      clientName: merged.nombre || clientName || 'Cliente WhatsApp',
                      clientPhone: clientPhone.replace('@c.us', ''),
                      date: deliveryDate, time: '14:00', duration: 300, status: 'pending',
                      notes: `📦 PEDIDO WHATSAPP (Auto-detectado)\n━━━━━━━━━━━━━━━\n🛍️ Producto: ${productoDesc || 'N/A'}\n💵 Total: $${merged.total || '0'}\n💳 Pago: ${merged.metodo_pago || 'Por definir'}\n━━━━━━━━━━━━━━━\n📍 ${[merged.direccion, merged.barrio, merged.ciudad].filter(Boolean).join(', ')}\n📞 ${merged.telefono || merged.celular || clientPhone.replace('@c.us', '')}\n━━━━━━━━━━━━━━━`,
                      total: parseFloat((merged.total || '0').toString().replace(/[^0-9.]/g, '')) || 0,
                      address: [merged.direccion, merged.barrio, merged.ciudad].filter(Boolean).join(', ').trim() || '',
                      whatsappLineId: whatsappLineId || null
                    };
                    await prisma.appointment.create({ data: orderData });
                    merged.pedido = 'creado';
                    await prisma.conversation.update({ where: { id: conversationId }, data: { contextData: merged } });
                    log(`🛒🔔 Pedido AUTO-DETECTADO (datos completos + confirmación IA): ${merged.nombre}`);
                    // 🔔 Push — Pedido auto-detectado
                    sendPushToUser(ownerId, { title: '🛒 ¡Nuevo Pedido!', body: `${merged.nombre || 'Cliente'} — ${merged.producto_servicio || 'Pedido auto'}`.substring(0, 120), url: '/agenda', tag: `order-${Date.now()}` }).catch(() => {});
                  } catch (autoOrderErr: any) {
                    console.error('⚠️ Error auto-pedido:', autoOrderErr.message);
                  }
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

                  const appointmentData: any = {
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

                  // 🔗 AUTO-ASIGNAR RECURSO — Verificar disponibilidad real
                  try {
                    const activeResources = await prisma.resource.findMany({
                      where: { userId: ownerId, isActive: true },
                      orderBy: { order: 'asc' }
                    });
                    if (activeResources.length > 0) {
                      const daySchedule = await prisma.businessSchedule.findFirst({
                        where: { userId: ownerId, dayOfWeek: citaDate.getDay() }
                      });
                      const slotDur = daySchedule?.slotDuration || 60;
                      const dateStr = citaDate.toISOString().split('T')[0];
                      const dayStart = new Date(dateStr + 'T00:00:00');
                      const dayEnd = new Date(dateStr + 'T23:59:59');
                      
                      const conflicting = await prisma.appointment.findMany({
                        where: { userId: ownerId, date: { gte: dayStart, lte: dayEnd }, status: { notIn: ['cancelled'] } },
                        select: { time: true, duration: true, resourceId: true }
                      });
                      
                      const [tH, tM] = citaTime.split(':').map(Number);
                      const reqStart = tH * 60 + tM;
                      const overlapping = conflicting.filter(a => {
                        if (!a.time) return false;
                        const [aH, aM] = a.time.split(':').map(Number);
                        const aStart = aH * 60 + aM;
                        const aEnd = aStart + (a.duration || slotDur);
                        return aStart < reqStart + slotDur && aEnd > reqStart;
                      });
                      
                      const occupiedIds = overlapping.map(a => a.resourceId).filter(Boolean);
                      const freeResource = activeResources.find(r => !occupiedIds.includes(r.id));
                      
                      if (freeResource) {
                        appointmentData.resourceId = freeResource.id;
                        appointmentData.resourceName = freeResource.name;
                        appointmentData.duration = slotDur;
                        log(`🔗 Recurso asignado: ${freeResource.name} (${freeResource.id})`);
                      } else {
                        log(`⚠️ Sin recursos libres para ${citaTime} — cita creada sin recurso`);
                      }
                    }
                  } catch (resErr: any) {
                    log(`⚠️ Error asignando recurso: ${resErr.message}`);
                  }

                  await prisma.appointment.create({ data: appointmentData });
                  
                  // Marcar cita como creada
                  merged.cita = 'creada';
                  // 🔔 Push — Nueva cita
                  sendPushToUser(ownerId, { title: '📅 ¡Nueva Cita!', body: `${merged.nombre || 'Cliente'} — ${merged.tipo_cita || 'Cita'} ${merged.fecha_cita || ''} ${merged.hora_cita || ''}`.trim().substring(0, 120), url: '/agenda', tag: `appt-${Date.now()}` }).catch(() => {});
                  await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { contextData: merged }
                  });
                  
                  log(`📅 CITA CREADA: ${tipoCita} | ${nombreCliente} | ${citaDate.toLocaleDateString('es-CO')} ${citaTime}`);

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
                      log(`👥 CRM: Cliente "${nombreCliente}" creado automáticamente`);
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
              
              // 🏨 CREAR RESERVA AUTOMÁTICA
              if (actionToTake === 'crear_reserva' && merged.reserva !== 'creada') {
                try {
                  // 🕐 PARSEAR FECHA
                  let reservaDate = new Date();
                  const fechaReservaStr = (merged.fecha_reserva || '').toLowerCase().trim();
                  const hoyR = new Date();
                  
                  if (fechaReservaStr) {
                    if (fechaReservaStr.includes('hoy')) {
                      reservaDate = new Date(hoyR);
                    } else if (fechaReservaStr.includes('mañana') || fechaReservaStr.includes('manana')) {
                      reservaDate = new Date(hoyR);
                      reservaDate.setDate(reservaDate.getDate() + 1);
                    } else if (fechaReservaStr.includes('pasado')) {
                      reservaDate = new Date(hoyR);
                      reservaDate.setDate(reservaDate.getDate() + 2);
                    } else if (fechaReservaStr.includes('lunes') || fechaReservaStr.includes('martes') || fechaReservaStr.includes('miércoles') || fechaReservaStr.includes('miercoles') || fechaReservaStr.includes('jueves') || fechaReservaStr.includes('viernes') || fechaReservaStr.includes('sábado') || fechaReservaStr.includes('sabado') || fechaReservaStr.includes('domingo')) {
                      const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
                      const dayNamesAlt = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
                      let targetDay = dayNames.findIndex(d => fechaReservaStr.includes(d));
                      if (targetDay === -1) targetDay = dayNamesAlt.findIndex(d => fechaReservaStr.includes(d));
                      if (targetDay >= 0) {
                        reservaDate = new Date(hoyR);
                        const currentDay = hoyR.getDay();
                        let daysAhead = targetDay - currentDay;
                        if (daysAhead <= 0) daysAhead += 7;
                        reservaDate.setDate(reservaDate.getDate() + daysAhead);
                      }
                    } else {
                      const monthNames: Record<string, number> = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
                      const dateMatch = fechaReservaStr.match(/(\d{1,2})\s*(?:de\s+)?(\w+)/);
                      if (dateMatch) {
                        const day = parseInt(dateMatch[1]);
                        const monthStr = dateMatch[2].toLowerCase();
                        if (monthNames[monthStr] !== undefined) {
                          reservaDate = new Date(hoyR.getFullYear(), monthNames[monthStr], day);
                          if (reservaDate < hoyR) reservaDate.setFullYear(reservaDate.getFullYear() + 1);
                        }
                      }
                      const parsed = new Date(merged.fecha_reserva);
                      if (!isNaN(parsed.getTime())) reservaDate = parsed;
                    }
                  }
                  
                  // 🕐 PARSEAR HORA
                  let reservaTime = '12:00';
                  const horaReservaStr = (merged.hora_reserva || '').toLowerCase().trim();
                  if (horaReservaStr) {
                    const timeMatch = horaReservaStr.match(/(\d{1,2})[:\s]*(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i);
                    if (timeMatch) {
                      let hours = parseInt(timeMatch[1]);
                      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
                      const meridian = (timeMatch[3] || '').toLowerCase().replace('.', '');
                      if (meridian === 'pm' && hours < 12) hours += 12;
                      if (meridian === 'am' && hours === 12) hours = 0;
                      reservaTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                    }
                  }

                  const tipoReserva = merged.tipo_reserva || 'reserva';
                  const numPersonas = merged.num_personas || '1';
                  const duracionReserva = parseInt(merged.duracion_reserva || '60') || 60;
                  const nombreClienR = merged.nombre || clientName || 'Cliente WhatsApp';
                  const phoneCleanR = clientPhone.replace('@c.us', '').replace('@s.whatsapp.net', '');

                  const reservaData: any = {
                    userId: ownerId,
                    type: 'reservation',
                    clientName: nombreClienR,
                    clientPhone: phoneCleanR,
                    date: reservaDate,
                    time: reservaTime,
                    duration: duracionReserva,
                    status: 'pending',
                    notes: `🏨 RESERVA — WhatsApp\n` +
                           `━━━━━━━━━━━━━━━\n` +
                           `👤 Cliente: ${nombreClienR}\n` +
                           `📱 Teléfono: ${phoneCleanR}\n` +
                           `📋 Tipo: ${tipoReserva}\n` +
                           `👥 Personas: ${numPersonas}\n` +
                           `🗓️ Fecha: ${reservaDate.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}\n` +
                           `🕐 Hora: ${reservaTime}\n` +
                           `⏱️ Duración: ${duracionReserva} min\n` +
                           `━━━━━━━━━━━━━━━\n` +
                           (merged.producto_servicio ? `🛎️ Servicio: ${merged.producto_servicio}\n` : '') +
                           (merged.total ? `💵 Total: $${merged.total}\n` : '') +
                           (merged.notas ? `📝 Notas: ${merged.notas}\n` : '') +
                           `━━━━━━━━━━━━━━━`,
                    total: parseFloat((merged.total || '0').toString().replace(/[^0-9.]/g, '')) || 0,
                    address: merged.direccion || merged.ciudad || '',
                    whatsappLineId: whatsappLineId || null
                  };

                  // 🔗 AUTO-ASIGNAR RECURSO — Verificar disponibilidad real
                  try {
                    const activeResources = await prisma.resource.findMany({
                      where: { userId: ownerId, isActive: true },
                      orderBy: { order: 'asc' }
                    });
                    if (activeResources.length > 0) {
                      const daySchedule = await prisma.businessSchedule.findFirst({
                        where: { userId: ownerId, dayOfWeek: reservaDate.getDay() }
                      });
                      const slotDur = daySchedule?.slotDuration || duracionReserva;
                      const dateStr = reservaDate.toISOString().split('T')[0];
                      const dayStart = new Date(dateStr + 'T00:00:00');
                      const dayEnd = new Date(dateStr + 'T23:59:59');
                      
                      const conflicting = await prisma.appointment.findMany({
                        where: { userId: ownerId, date: { gte: dayStart, lte: dayEnd }, status: { notIn: ['cancelled'] } },
                        select: { time: true, duration: true, resourceId: true }
                      });
                      
                      const [tH, tM] = reservaTime.split(':').map(Number);
                      const reqStart = tH * 60 + tM;
                      const overlapping = conflicting.filter(a => {
                        if (!a.time) return false;
                        const [aH, aM] = a.time.split(':').map(Number);
                        const aStart = aH * 60 + aM;
                        const aEnd = aStart + (a.duration || slotDur);
                        return aStart < reqStart + duracionReserva && aEnd > reqStart;
                      });
                      
                      const occupiedIds = overlapping.map(a => a.resourceId).filter(Boolean);
                      const freeResource = activeResources.find(r => !occupiedIds.includes(r.id));
                      
                      if (freeResource) {
                        reservaData.resourceId = freeResource.id;
                        reservaData.resourceName = freeResource.name;
                        log(`🔗 Recurso asignado a reserva: ${freeResource.name}`);
                      } else {
                        log(`⚠️ Sin recursos libres para reserva ${reservaTime} — creada sin recurso`);
                      }
                    }
                  } catch (resErr: any) {
                    log(`⚠️ Error asignando recurso reserva: ${resErr.message}`);
                  }

                  await prisma.appointment.create({ data: reservaData });
                  
                  // Marcar reserva como creada
                  merged.reserva = 'creada';
                  // 🔔 Push — Nueva reserva
                  sendPushToUser(ownerId, { title: '🏨 ¡Nueva Reserva!', body: `${merged.nombre || 'Cliente'} — ${merged.tipo_reserva || 'Reserva'} ${merged.fecha_reserva || ''} ${merged.hora_reserva || ''}`.trim().substring(0, 120), url: '/agenda', tag: `reserv-${Date.now()}` }).catch(() => {});
                  await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { contextData: merged }
                  });
                  
                  log(`🏨 RESERVA CREADA: ${tipoReserva} | ${nombreClienR} | ${numPersonas} personas | ${reservaDate.toLocaleDateString('es-CO')} ${reservaTime}`);

                  // 👥 AUTO-CREAR CLIENTE EN CRM
                  try {
                    const existingClientR = await prisma.client.findFirst({
                      where: { userId: ownerId, phone: { endsWith: phoneCleanR.slice(-10) } }
                    });
                    if (!existingClientR) {
                      await prisma.client.create({
                        data: {
                          userId: ownerId,
                          name: nombreClienR,
                          phone: phoneCleanR,
                          email: merged.email || null,
                          notes: `Cliente registrado automáticamente desde WhatsApp (reserva: ${tipoReserva})`,
                          status: 'active',
                          tags: ['reserva', tipoReserva, 'whatsapp'],
                          lastContact: new Date(),
                          whatsappLineId: whatsappLineId || null
                        }
                      });
                    } else {
                      await prisma.client.update({
                        where: { id: existingClientR.id },
                        data: { lastContact: new Date(), name: nombreClienR || existingClientR.name }
                      });
                    }
                  } catch (crmErr: any) {
                    console.error('⚠️ Error auto-CRM reserva:', crmErr.message);
                  }
                } catch (resErr: any) {
                  console.error('❌ Error creando reserva:', resErr.message);
                }
              }

              // ═══ 🔄 ACTUALIZAR PEDIDO EXISTENTE ═══
              if (actionToTake === 'actualizar_pedido' && merged.pedido === 'creado') {
                try {
                  const phoneCleanU = clientPhone.replace('@c.us', '').replace('@s.whatsapp.net', '');
                  const existingOrder = await prisma.appointment.findFirst({
                    where: { userId: ownerId, type: 'order', clientPhone: { endsWith: phoneCleanU.slice(-10) } },
                    orderBy: { createdAt: 'desc' }
                  });
                  if (existingOrder) {
                    // Recalcular datos del pedido
                    const productoDesc = merged.producto_servicio || merged.detalles_producto || '';
                    const updateOrderData: any = {
                      notes: `📦 PEDIDO ACTUALIZADO\n` +
                             `━━━━━━━━━━━━━━━\n` +
                             `🛍️ Producto/Servicio: ${productoDesc || 'N/A'}\n` +
                             (merged.detalles_producto ? `📋 Detalles: ${merged.detalles_producto}\n` : '') +
                             `📦 Cantidad: ${merged.cantidad || '1'}\n` +
                             (merged.precio ? `💰 Precio: $${merged.precio}\n` : '') +
                             `💵 Total: $${merged.total || '0'}\n` +
                             `💳 Pago: ${merged.metodo_pago || 'Por definir'}\n` +
                             `━━━━━━━━━━━━━━━\n` +
                             (merged.direccion ? `📍 Dirección: ${merged.direccion}\n` : '') +
                             (merged.barrio ? `🏘️ Barrio: ${merged.barrio}\n` : '') +
                             (merged.ciudad ? `🏙️ Ciudad: ${merged.ciudad}\n` : '') +
                             `⏱️ Actualizado: ${new Date().toLocaleString('es-CO')}\n` +
                             `━━━━━━━━━━━━━━━`,
                      total: parseFloat((merged.total || '0').toString().replace(/[^0-9.]/g, '')) || existingOrder.total,
                      status: 'pending'
                    };
                    if (merged.direccion) updateOrderData.address = [merged.direccion, merged.barrio, merged.ciudad].filter(Boolean).join(', ');
                    if (merged.nombre) updateOrderData.clientName = merged.nombre;
                    
                    // Actualizar fecha si cambió
                    if (merged.fecha_entrega) {
                      const fechaStr = merged.fecha_entrega.toLowerCase();
                      const hoy = new Date();
                      let newDate = new Date(existingOrder.date);
                      if (fechaStr.includes('hoy')) newDate = hoy;
                      else if (fechaStr.includes('mañana') || fechaStr.includes('manana')) { newDate = new Date(hoy); newDate.setDate(newDate.getDate() + 1); }
                      else if (fechaStr.includes('pasado')) { newDate = new Date(hoy); newDate.setDate(newDate.getDate() + 2); }
                      else { const parsed = new Date(merged.fecha_entrega); if (!isNaN(parsed.getTime())) newDate = parsed; }
                      updateOrderData.date = newDate;
                    }

                    await prisma.appointment.update({ where: { id: existingOrder.id }, data: updateOrderData });
                    merged.pedido = 'creado'; // Mantener como creado
                    await prisma.conversation.update({ where: { id: conversationId }, data: { contextData: merged } });
                    log(`🔄🛒 PEDIDO ACTUALIZADO: ${existingOrder.id} | ${merged.nombre || clientName}`);
                  } else {
                    log(`⚠️ No se encontró pedido para actualizar de ${phoneCleanU}`);
                  }
                } catch (upErr: any) {
                  console.error('❌ Error actualizando pedido:', upErr.message);
                }
              }

              // ═══ 🔄 ACTUALIZAR CITA EXISTENTE ═══
              if (actionToTake === 'actualizar_cita' && merged.cita === 'creada') {
                try {
                  const phoneCleanU = clientPhone.replace('@c.us', '').replace('@s.whatsapp.net', '');
                  const existingAppt = await prisma.appointment.findFirst({
                    where: { userId: ownerId, type: 'appointment', clientPhone: { endsWith: phoneCleanU.slice(-10) } },
                    orderBy: { createdAt: 'desc' }
                  });
                  if (existingAppt) {
                    const updateApptData: any = { status: 'pending' };
                    
                    // Actualizar fecha si cambió
                    if (merged.fecha_cita) {
                      const fechaStr = merged.fecha_cita.toLowerCase();
                      const hoy = new Date();
                      let newDate = new Date(existingAppt.date);
                      if (fechaStr.includes('hoy')) newDate = hoy;
                      else if (fechaStr.includes('mañana') || fechaStr.includes('manana')) { newDate = new Date(hoy); newDate.setDate(newDate.getDate() + 1); }
                      else if (fechaStr.includes('pasado')) { newDate = new Date(hoy); newDate.setDate(newDate.getDate() + 2); }
                      else { const parsed = new Date(merged.fecha_cita); if (!isNaN(parsed.getTime())) newDate = parsed; }
                      updateApptData.date = newDate;
                    }
                    
                    // Actualizar hora si cambió
                    if (merged.hora_cita) {
                      const timeMatch = merged.hora_cita.match(/(\d{1,2})[:\s]*(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i);
                      if (timeMatch) {
                        let h = parseInt(timeMatch[1]);
                        const m = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
                        const mer = (timeMatch[3] || '').toLowerCase().replace('.', '');
                        if (mer === 'pm' && h < 12) h += 12;
                        if (mer === 'am' && h === 12) h = 0;
                        updateApptData.time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                      }
                    }
                    
                    if (merged.nombre) updateApptData.clientName = merged.nombre;
                    if (merged.direccion) updateApptData.address = merged.direccion;
                    
                    const tipoCita = merged.tipo_cita || 'cita';
                    updateApptData.notes = `📅 ${tipoCita.toUpperCase()} — ACTUALIZADA\n` +
                      `━━━━━━━━━━━━━━━\n` +
                      `👤 Cliente: ${merged.nombre || existingAppt.clientName}\n` +
                      `📱 Teléfono: ${phoneCleanU}\n` +
                      `🗓️ Fecha: ${(updateApptData.date || existingAppt.date).toLocaleDateString?.('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }) || ''}\n` +
                      `🕐 Hora: ${updateApptData.time || existingAppt.time}\n` +
                      `📋 Tipo: ${tipoCita}\n` +
                      `⏱️ Actualizado: ${new Date().toLocaleString('es-CO')}\n` +
                      `━━━━━━━━━━━━━━━`;

                    await prisma.appointment.update({ where: { id: existingAppt.id }, data: updateApptData });
                    merged.cita = 'creada';
                    await prisma.conversation.update({ where: { id: conversationId }, data: { contextData: merged } });
                    log(`🔄📅 CITA ACTUALIZADA: ${existingAppt.id} | ${merged.nombre || clientName}`);
                  } else {
                    log(`⚠️ No se encontró cita para actualizar de ${phoneCleanU}`);
                  }
                } catch (upErr: any) {
                  console.error('❌ Error actualizando cita:', upErr.message);
                }
              }

              // ═══ 🔄 ACTUALIZAR RESERVA EXISTENTE ═══
              if (actionToTake === 'actualizar_reserva' && merged.reserva === 'creada') {
                try {
                  const phoneCleanU = clientPhone.replace('@c.us', '').replace('@s.whatsapp.net', '');
                  const existingRes = await prisma.appointment.findFirst({
                    where: { userId: ownerId, type: 'reservation', clientPhone: { endsWith: phoneCleanU.slice(-10) } },
                    orderBy: { createdAt: 'desc' }
                  });
                  if (existingRes) {
                    const updateResData: any = { status: 'pending' };
                    
                    if (merged.fecha_reserva) {
                      const fechaStr = merged.fecha_reserva.toLowerCase();
                      const hoy = new Date();
                      let newDate = new Date(existingRes.date);
                      if (fechaStr.includes('hoy')) newDate = hoy;
                      else if (fechaStr.includes('mañana') || fechaStr.includes('manana')) { newDate = new Date(hoy); newDate.setDate(newDate.getDate() + 1); }
                      else if (fechaStr.includes('pasado')) { newDate = new Date(hoy); newDate.setDate(newDate.getDate() + 2); }
                      else { const parsed = new Date(merged.fecha_reserva); if (!isNaN(parsed.getTime())) newDate = parsed; }
                      updateResData.date = newDate;
                    }
                    
                    if (merged.hora_reserva) {
                      const timeMatch = merged.hora_reserva.match(/(\d{1,2})[:\s]*(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i);
                      if (timeMatch) {
                        let h = parseInt(timeMatch[1]);
                        const m = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
                        const mer = (timeMatch[3] || '').toLowerCase().replace('.', '');
                        if (mer === 'pm' && h < 12) h += 12;
                        if (mer === 'am' && h === 12) h = 0;
                        updateResData.time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                      }
                    }
                    
                    if (merged.nombre) updateResData.clientName = merged.nombre;
                    const tipoRes = merged.tipo_reserva || 'reserva';
                    const numPers = merged.num_personas || '';
                    
                    updateResData.notes = `🏨 RESERVA ACTUALIZADA — ${tipoRes.toUpperCase()}\n` +
                      `━━━━━━━━━━━━━━━\n` +
                      `👤 Cliente: ${merged.nombre || existingRes.clientName}\n` +
                      `📱 Teléfono: ${phoneCleanU}\n` +
                      `🗓️ Fecha: ${(updateResData.date || existingRes.date).toLocaleDateString?.('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }) || ''}\n` +
                      `🕐 Hora: ${updateResData.time || existingRes.time}\n` +
                      (numPers ? `👥 Personas: ${numPers}\n` : '') +
                      `📋 Tipo: ${tipoRes}\n` +
                      `⏱️ Actualizado: ${new Date().toLocaleString('es-CO')}\n` +
                      `━━━━━━━━━━━━━━━`;

                    await prisma.appointment.update({ where: { id: existingRes.id }, data: updateResData });
                    merged.reserva = 'creada';
                    await prisma.conversation.update({ where: { id: conversationId }, data: { contextData: merged } });
                    log(`🔄🏨 RESERVA ACTUALIZADA: ${existingRes.id} | ${merged.nombre || clientName}`);
                  } else {
                    log(`⚠️ No se encontró reserva para actualizar de ${phoneCleanU}`);
                  }
                } catch (upErr: any) {
                  console.error('❌ Error actualizando reserva:', upErr.message);
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
            log(`✅ IA (${model}): ${reply.length} chars`);
            return reply;
          }
        } else {
          const st = res.status;
          const errBody = await res.text().catch(() => '');
          console.error(`❌ OpenAI ${model}: ${st} - ${errBody.substring(0, 200)}`);
          
          // 🔑 TRACKEAR ERROR DE API KEY
          if (st === 401) {
            apiKeyErrorCache.set(ownerId, { 
              type: 'invalid_key', 
              message: 'API Key de OpenAI inválida o expirada' 
            });
            // Marcar como desconectada
            await prisma.user.update({ where: { id: ownerId }, data: { apiKeyConnected: false } }).catch(() => {});
            console.error(`🔑❌ API Key INVÁLIDA para usuario ${ownerId}`);
            return null;
          }
          if (st === 429 || st === 402) {
            const isQuota = errBody.toLowerCase().includes('insufficient_quota') || errBody.toLowerCase().includes('billing') || st === 402;
            if (isQuota) {
              apiKeyErrorCache.set(ownerId, { 
                type: 'no_credits', 
                  message: 'Sin créditos en OpenAI. Recarga tu cuenta.' 
              });
              console.error(`💰❌ SIN CRÉDITOS OpenAI para usuario ${ownerId}`);
            } else {
              apiKeyErrorCache.set(ownerId, { 
                type: 'rate_limit', 
                  message: 'Límite de velocidad alcanzado. Reintentando...' 
              });
            }
            log('⚠️ Rate limit/quota, reintentando en 2s...'); 
            await new Promise(r => setTimeout(r, 2000)); 
            continue;
          }
        }
      } catch (e: any) {
        console.error(`❌ ${model}:`, e.message);
      }
    }
    return null;
  } catch (e: any) { console.error('❌ AI Error:', e.message); return null; }
};

// ====================================================
// 💬 FOLLOW-UP INTELIGENTE POST-MEDIA
// Genera una pregunta contextual después de enviar multimedia
// para mantener la conversación activa y avanzar en el pipeline
// ====================================================
const generateMediaFollowUp = async (
  ownerId: string, 
  convId: string, 
  mediaName: string, 
  mediaType: string,
  previousAiResponse: string | null,
  whatsappLineId?: string | null
): Promise<string | null> => {
  try {
    // ⚡ SKIP: Si la respuesta anterior YA terminó con pregunta, no duplicar
    if (previousAiResponse) {
      const trimmed = previousAiResponse.trim();
      // Detectar si ya hay pregunta al final (últimos 80 chars)
      const tail = trimmed.slice(-80);
      if (/[?¿]/.test(tail)) {
        log(`💬 Follow-up SKIP: respuesta anterior ya tiene pregunta`);
        return null;
      }
    }

    // 🧠 Cargar contexto de la conversación
    const [conv, recentMsgs, user] = await Promise.all([
      prisma.conversation.findUnique({ 
        where: { id: convId }, 
        select: { recipientName: true, stage: true, contextData: true } 
      }),
      prisma.message.findMany({ 
        where: { conversationId: convId }, 
        orderBy: { timestamp: 'desc' }, 
        take: 5,
        select: { content: true, fromMe: true }
      }),
      prisma.user.findUnique({ where: { id: ownerId }, select: { apiKey: true } })
    ]);

    if (!user?.apiKey) return null;

    const clientName = conv?.recipientName || '';
    const stage = conv?.stage || 'new';
    const savedContext = (conv?.contextData as Record<string, any>) || {};

    // 🔗 Cargar asistente para tener contexto del negocio
    let assistant: any = null;
    if (whatsappLineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, whatsappLineId } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true } });
    }

    // Último mensaje del cliente (lo que preguntó)
    const lastClientMsg = [...recentMsgs].reverse().find(m => !m.fromMe)?.content || '';
    
    // Datos conocidos del cliente
    const knownData = Object.entries(savedContext)
      .filter(([_, v]) => v && v !== '' && v !== 'null')
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    // 🧠 Construir prompt enfocado para follow-up
    const stageContext: Record<string, string> = {
      'new': 'Es un lead NUEVO. Objetivo: despertar interés y calificar si es buen prospecto.',
      'saludo': 'Acaba de saludar. Objetivo: conocer qué necesita exactamente.',
      'interested': 'Ya mostró INTERÉS. Objetivo: profundizar en sus necesidades y ofrecer opciones.',
      'interesado': 'Ya mostró INTERÉS. Objetivo: profundizar en sus necesidades y ofrecer opciones.',
      'descubrimiento': 'Está en DESCUBRIMIENTO. Objetivo: entender bien qué busca para recomendar lo ideal.',
      'cotización': 'Está en fase de COTIZACIÓN. Objetivo: resolver dudas de precio y empujar a decidir.',
      'cotizacion': 'Está en fase de COTIZACIÓN. Objetivo: resolver dudas de precio y empujar a decidir.',
      'quoting': 'Está en fase de COTIZACIÓN. Objetivo: resolver dudas de precio y empujar a decidir.',
      'pendiente_decision': 'Está DECIDIENDO. Objetivo: dar el empujón final, resolver última objeción.',
      'negotiating': 'Está NEGOCIANDO. Objetivo: cerrar el trato, ofrecer beneficio si decide ahora.',
      'converted': 'Ya COMPRÓ. Objetivo: confirmar satisfacción y abrir puerta a upsell/referidos.',
      'convertido': 'Ya COMPRÓ. Objetivo: confirmar satisfacción y abrir puerta a upsell/referidos.',
      'confirmado': 'Ya CONFIRMÓ. Objetivo: generar confianza post-compra.',
      'follow_up': 'Está en SEGUIMIENTO. Objetivo: reactivar interés y dar motivo para volver.',
      'lost': 'Se PERDIÓ antes. Objetivo: re-engagement suave, preguntar si sigue interesado.',
      'perdido': 'Se PERDIÓ antes. Objetivo: re-engagement suave, preguntar si sigue interesado.',
    };

    const stageGoal = stageContext[stage] || 'Objetivo: avanzar la conversación hacia una venta.';
    
    const systemPrompt = `Eres un vendedor experto por WhatsApp. Acabas de enviar ${
      mediaType === 'catalog' ? `un catálogo de "${mediaName}" con varias fotos` : 
      mediaType === 'video' ? `un video de "${mediaName}"` :
      mediaType === 'audio' ? `un audio de "${mediaName}"` :
      `una imagen de "${mediaName}"`
    } al cliente.

${assistant?.businessInfo ? `Negocio: ${assistant.businessInfo.substring(0, 200)}` : ''}
${assistant?.personality ? `Tu estilo: ${assistant.personality.substring(0, 100)}` : ''}

ETAPA DEL CLIENTE: ${stage}
${stageGoal}
${clientName ? `Nombre del cliente: ${clientName}` : ''}
${knownData ? `Datos conocidos: ${knownData}` : ''}

El cliente preguntó: "${lastClientMsg.substring(0, 150)}"
${previousAiResponse ? `Tu respuesta anterior fue: "${previousAiResponse.substring(0, 150)}"` : ''}
Luego enviaste las fotos/media de "${mediaName}".

GENERA UN MENSAJE CORTO de follow-up para enviar DESPUÉS de las fotos. REGLAS:
- Máximo 1-2 líneas (40 palabras máximo)
- DEBE terminar con UNA pregunta que avance la venta
- Tono natural de WhatsApp (no formal, usa emojis con moderación)
- NO repitas lo que ya dijiste
- NO digas "como puedes ver en la imagen/foto"
- La pregunta debe ser ESTRATÉGICA según la etapa:
  * Lead nuevo → ¿Cuál te llama la atención? ¿Para qué ocasión buscas?
  * Interesado → ¿Cuál es tu favorito? ¿Te preparo cotización?
  * Cotización → ¿Listo para apartar? ¿Cuándo lo necesitas?
  * Convertido → ¿Necesitas algo más? ¿Conoces nuestra línea de X?
  * Perdido → ¿Sigues interesado? Tenemos novedades
- SOLO responde con el mensaje, nada más`;

    // 🚀 Llamada rápida a OpenAI (max 80 tokens = barato y veloz)
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Genera el follow-up post-media para ${clientName || 'el cliente'} (etapa: ${stage})` }
        ],
        temperature: 0.8,
        max_tokens: 80
      }),
      signal: ctrl.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json() as any;
      let followUp = data.choices?.[0]?.message?.content?.trim();
      if (followUp) {
        // Limpiar comillas o prefijos innecesarios
        followUp = followUp.replace(/^["']|["']$/g, '').replace(/^(Follow-up|Mensaje|Respuesta):\s*/i, '').trim();
        // Limpiar tags de memoria si se colaron
        followUp = followUp.replace(/<<MEMORY_JSON>>[\s\S]*?<<END_MEMORY>>/g, '').trim();
        if (followUp.length > 5 && followUp.length < 300) {
          log(`💬 Follow-up generado: "${followUp.substring(0, 60)}..." (etapa: ${stage})`);
          return followUp;
        }
      }
    }

    return null;
  } catch (e: any) {
    log(`⚠️ Follow-up error (no crítico): ${e.message}`);
    return null;
  }
};

// ====================================================
// 📤 ENVIAR FOLLOW-UP POST-MEDIA (helper reutilizable)
// ====================================================
const sendMediaFollowUp = async (
  sessionName: string,
  from: string,
  userId: string,
  convId: string,
  mediaName: string,
  mediaType: string,
  previousAiResponse: string | null,
  whatsappLineId?: string | null
): Promise<void> => {
  try {
    const followUp = await generateMediaFollowUp(userId, convId, mediaName, mediaType, previousAiResponse, whatsappLineId);
    if (!followUp) return;

    // ⏳ Pausa natural: simular que "mira las fotos" y luego escribe
    const pauseMs = 2000 + Math.random() * 2000; // 2-4 segundos
    await new Promise(r => setTimeout(r, pauseMs));

    // ⌨️ Typing indicator
    await setPresence(sessionName, from, 'typing');
    await humanDelay(followUp.length);
    await stopPresence(sessionName, from);

    // 📤 Enviar follow-up
    const sent = await unifiedSendText(sessionName, from, followUp, whatsappLineId);
    if (sent) {
      await prisma.message.create({ 
        data: { conversationId: convId, content: followUp, fromMe: true, userId, role: 'assistant' } 
      });
      await prisma.conversation.update({ 
        where: { id: convId }, 
        data: { lastMessage: followUp } 
      });
      log(`💬 Follow-up enviado → ${from}: "${followUp.substring(0, 50)}..."`);
    }
  } catch (e: any) {
    log(`⚠️ sendMediaFollowUp error (no crítico): ${e.message}`);
  }
};

// ====================================================
// 🔄 TRANSFERIR CONVERSACIÓN ENTRE LÍNEAS
// Envía mensaje desde la línea destino al cliente
// ====================================================
const executeLineTransfer = async (
  targetPhone: string,
  customerChatId: string,
  customerName: string,
  userId: string,
  sourceLineId: string,
  sourceConvId: string,
  transferMessage: string,
  resetSource: boolean = false
): Promise<boolean> => {
  try {
    // 1. Find target line by phone number
    const cleanTarget = targetPhone.replace(/[^0-9]/g, '');
    const targetLine = await prisma.whatsappLine.findFirst({
      where: {
        userId,
        status: 'connected',
        isActive: true,
        phone: { contains: cleanTarget.slice(-10) }
      }
    });

    if (!targetLine) {
      log(`🔄❌ Línea destino no encontrada: ${targetPhone}`);
      return false;
    }

    if (targetLine.id === sourceLineId) {
      log(`🔄⚠️ Transferencia a la misma línea ignorada`);
      return false;
    }

    log(`🔄 Transferencia: ${customerName} → línea "${targetLine.label}" (${targetLine.phone})${resetSource ? ' [+RESET SOURCE]' : ''}`);

    // 2. Find or create conversation on target line
    const cleanCustomer = customerChatId.replace('@c.us', '').replace('@s.whatsapp.net', '');
    let targetConv = await prisma.conversation.findFirst({
      where: { userId, recipientId: { contains: cleanCustomer.slice(-10) }, whatsappLineId: targetLine.id }
    });

    // 3. Get context from source conversation
    const sourceConv = await prisma.conversation.findUnique({
      where: { id: sourceConvId },
      select: { contextData: true, stage: true, recipientName: true }
    });
    const ctx = (sourceConv?.contextData as Record<string, any>) || {};

    if (!targetConv) {
      targetConv = await prisma.conversation.create({
        data: {
          userId,
          recipientId: cleanCustomer,
          recipientName: customerName || cleanCustomer,
          whatsappLineId: targetLine.id,
          stage: 'new',
          lastMessage: `🔄 Transferido`,
          isActive: true,
          contextData: ctx
        }
      });
      log(`🔄 Nueva conversación creada en línea "${targetLine.label}"`);
    } else {
      // Update existing conv with fresh context and reset messages for demo
      const updateData: any = { contextData: ctx, isActive: true };
      if (resetSource) {
        // If target is being reused (demo), clear old messages first
        await prisma.message.deleteMany({ where: { conversationId: targetConv.id } });
        updateData.stage = 'new';
        log(`🔄 Conversación existente limpiada para nueva demo`);
      }
      await prisma.conversation.update({ where: { id: targetConv.id }, data: updateData });
    }

    // 4. Build smart greeting based on context
    const targetAssistant = await prisma.assistant.findFirst({
      where: { userId, whatsappLineId: targetLine.id }
    }) || await prisma.assistant.findFirst({
      where: { userId, isActive: true }
    });

    let greeting = '';
    const clientFirstName = ctx.nombre || customerName || '';
    const businessName = ctx.nombre_empresa || ctx.producto_servicio?.split(' - ')?.[0] || '';
    const businessType = ctx.tipo_negocio || ctx.producto_servicio || ctx.notas || '';

    // Smart greeting based on transfer context
    if (resetSource && clientFirstName && businessName) {
      // Coming BACK from Demo → welcome back + ask what they liked
      greeting = `¡${clientFirstName}, ya regresaste! 🎉\n\nCuéntame, ¿qué fue lo que más te gustó de la demo de *${businessName}*? 😊`;
    } else if (businessName && businessType && !resetSource) {
      // Transferring TO Demo — greet as the business
      greeting = `¡Hola! 😊 Bienvenido/a a *${businessName}*. Soy tu asistente virtual.\n\nPuedo ayudarte con todo sobre ${businessType}.\n\n¿En qué puedo ayudarte hoy?`;
    } else if (clientFirstName && (ctx.etapa_actual === 'Demo Enviada' || resetSource)) {
      // Fallback: coming back from demo without business name
      greeting = `¡${clientFirstName}, ya regresaste! 🎉\n\n¿Qué fue lo que más te gustó de la demo? 😊`;
    } else {
      // Generic fallback
      const greetingName = targetAssistant?.name || targetLine.label;
      greeting = `¡Hola${clientFirstName ? ` ${clientFirstName}` : ''}! 👋 Soy ${greetingName}. Me transfirieron tu conversación para poder ayudarte mejor. ¿En qué puedo asistirte?`;
    }

    // 5. Send greeting from target line
    await humanDelay(greeting.length);
    const sent = await sendWahaMessage(targetLine.sessionName, customerChatId, greeting);

    if (sent) {
      await prisma.message.create({
        data: { conversationId: targetConv.id, content: greeting, fromMe: true, userId, role: 'assistant' }
      });
      await prisma.conversation.update({
        where: { id: targetConv.id },
        data: { lastMessage: greeting, isActive: true }
      });

      // 6. Mark source conversation as transferred
      await prisma.message.create({
        data: {
          conversationId: sourceConvId,
          content: `🔄 Conversación transferida a línea "${targetLine.label}" (${targetLine.phone})`,
          fromMe: true, userId, role: 'system'
        }
      });
      await prisma.conversation.update({
        where: { id: sourceConvId },
        data: { lastMessage: `🔄 Transferido a ${targetLine.label}` }
      });

      // 7. RESET SOURCE if requested (for demo cleanup)
      if (resetSource) {
        await prisma.message.deleteMany({ where: { conversationId: sourceConvId } });
        await prisma.conversation.update({
          where: { id: sourceConvId },
          data: { contextData: {}, stage: 'new', lastMessage: '🔄 Demo finalizada - limpio para siguiente cliente' }
        });
        log(`🧹 Source conversation reset (demo cleanup)`);
      }

      log(`🔄✅ Transferencia exitosa: ${customerName} → "${targetLine.label}" (${targetLine.phone})`);
      return true;
    }

    return false;
  } catch (e: any) {
    console.error(`🔄❌ Error en transferencia:`, e.message);
    return false;
  }
};

// ====================================================
// 🔥 PROCESAR MENSAJES AGRUPADOS (INTELIGENTE)
// Se ejecuta cuando el timer adaptativo expira
// Combina mensajes con lógica contextual
// ====================================================
const processBufferedMessages = async (bufferKey: string) => {
  const buf = messageBuffer.get(bufferKey);
  if (!buf) return;
  messageBuffer.delete(bufferKey);

  // 🔒 Si ya se está procesando para este contacto → guardar SIN timer
  // El finally del proceso actual recogerá estos mensajes automáticamente
  if (processingLock.has(bufferKey)) {
    const existing = messageBuffer.get(bufferKey);
    if (existing) {
      existing.messages.push(...buf.messages);
      // NO timer — el finally lo procesa cuando termine la IA
    } else {
      // Guardar sin timer — el finally lo detecta
      buf.timer = null as any;
      messageBuffer.set(bufferKey, buf);
    }
    clog(`🔒 Lock activo → ${buf.messages.length} msg(s) de ${buf.senderName} guardados (serán procesados al terminar IA)`);
    return;
  }

  // 🔒 Activar lock
  processingLock.add(bufferKey);

  const { messages: msgs, sessionName, from, senderName, userId, convId, whatsappLineId, firstTimestamp } = buf;
  const burstDuration = Date.now() - firstTimestamp;
  
  // 🧠 Combinar mensajes de forma inteligente
  const combinedMessage = smartCombineMessages(msgs);

  clog(`📦 Ráfaga procesada: ${msgs.length} msg(s) de ${senderName} en ${(burstDuration/1000).toFixed(1)}s → "${combinedMessage.substring(0, 120)}${combinedMessage.length > 120 ? '...' : ''}" (lineId: ${whatsappLineId || 'global'})`);

  // 🔔 PUSH NOTIFICATION — Notificar al dueño de nuevo mensaje
  sendPushToUser(userId, {
    title: `📩 ${senderName || 'Nuevo mensaje'}`,
    body: combinedMessage.substring(0, 120),
    url: '/conversaciones',
    tag: `msg-${convId}`
  }).catch(() => {});

  // ☁️ Detectar si es Cloud API (skip typing/presence que no funciona)
  const lineInfo = await getLineInfo(whatsappLineId);
  const isCloudAPI = lineInfo?.type === 'cloud_api';

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

    // ⌨️🎙️ Typing/Recording (solo WAHA — Cloud API no soporta)
    if (!isCloudAPI) {
      if (isVoiceMode) {
        await setPresence(sessionName, from, 'recording');
      } else {
        await setPresence(sessionName, from, 'typing');
      }
    }

    if (matchedMedia) {
      log(`📎 Trigger multimedia: "${matchedMedia.name}" (tipo: ${matchedMedia.type})`);
      await stopPresence(sessionName, from);

      // ═══ PASO 1: ENVIAR MEDIA PRIMERO ═══
      let mediaSent = false;
      if (matchedMedia.type === 'catalog' && Array.isArray(matchedMedia.images) && matchedMedia.images.length > 0) {
        log(`📂 Enviando catálogo "${matchedMedia.name}" con ${matchedMedia.images.length} imágenes`);
        let sentCount = 0;
        for (let i = 0; i < matchedMedia.images.length; i++) {
          const img = matchedMedia.images[i];
          const caption = i === 0 ? (matchedMedia.caption || matchedMedia.name) : (img.name || '');
          const imgMedia = { type: 'image', url: img.url, name: img.name || `imagen-${i + 1}` };
          const sent = await unifiedSendMedia(sessionName, from, imgMedia, caption, whatsappLineId);
          if (sent) { sentCount++; log(`📂 Imagen ${i + 1}/${matchedMedia.images.length} enviada ✅`); }
          if (i < matchedMedia.images.length - 1) await new Promise(r => setTimeout(r, 1500));
        }
        await prisma.message.create({ data: { conversationId: convId, content: `📂 [Catálogo: ${matchedMedia.name} - ${sentCount} imágenes]`, fromMe: true, userId, role: 'assistant', mediaType: 'image' } });
        mediaSent = sentCount > 0;
        log(`📂 Catálogo "${matchedMedia.name}" completado: ${sentCount}/${matchedMedia.images.length} imágenes enviadas`);
      } else {
        const sent = await unifiedSendMedia(sessionName, from, matchedMedia, matchedMedia.caption || '', whatsappLineId);
        if (sent) {
          await prisma.message.create({ data: { conversationId: convId, content: `📎 [${matchedMedia.type}: ${matchedMedia.name}]`, fromMe: true, userId, role: 'assistant', mediaType: matchedMedia.type } });
          mediaSent = true;
        } else {
          const fallbackText = matchedMedia.caption
            ? `📎 ${matchedMedia.caption}`
            : `📎 Tengo ${matchedMedia.type === 'image' ? 'una imagen' : matchedMedia.type === 'video' ? 'un video' : 'un audio'} de "${matchedMedia.name}" para mostrarte. Pídeme más detalles 😊`;
          await unifiedSendText(sessionName, from, fallbackText, whatsappLineId);
          await prisma.message.create({ data: { conversationId: convId, content: fallbackText, fromMe: true, userId, role: 'assistant' } });
        }
      }

      // ═══ PASO 2: GENERAR Y ENVIAR TEXTO IA (después de la media) ═══
      if (mediaSent) {
        if (!isCloudAPI) {
          await new Promise(r => setTimeout(r, 600 + Math.random() * 600));
          await setPresence(sessionName, from, 'typing');
        } else {
          await new Promise(r => setTimeout(r, 300)); // Pausa mínima Cloud API
        }
      }
      const aiResponse = await generateAIResponse(userId, combinedMessage, convId, whatsappLineId);
      if (!isCloudAPI) await stopPresence(sessionName, from);

      if (aiResponse) {
        // 🔄 Check for transfer in media+AI path
        const mediaTransferResetMatch = aiResponse.match(/<<TRANSFERIR_RESET:(\+?\d{7,15})>>/);
        const mediaTransferMatch = mediaTransferResetMatch || aiResponse.match(/<<TRANSFERIR:(\+?\d{7,15})>>/);
        const mediaIsReset = !!mediaTransferResetMatch;
        const cleanAiResponse = aiResponse
          .replace(/<<TRANSFERIR_RESET:\+?\d{7,15}>>/g, '')
          .replace(/<<TRANSFERIR:\+?\d{7,15}>>/g, '')
          .replace(/<<VOZ>>/g, '').replace(/<<TEXTO>>/g, '').trim();
        
        if (cleanAiResponse) {
          if (!isCloudAPI) await humanDelay(cleanAiResponse.length);
          await unifiedSendAIResponse(sessionName, from, cleanAiResponse, whatsappLineId);
          await prisma.message.create({ data: { conversationId: convId, content: cleanAiResponse, fromMe: true, userId, role: 'assistant' } });
        }

        if (mediaTransferMatch && whatsappLineId) {
          await new Promise(r => setTimeout(r, 2000));
          await executeLineTransfer(mediaTransferMatch[1], from, senderName, userId, whatsappLineId, convId, cleanAiResponse, mediaIsReset);
        }
      }

      await prisma.conversation.update({ where: { id: convId }, data: { lastMessage: aiResponse || `📎 ${matchedMedia.name}` } });

      // ═══ PASO 3: FOLLOW-UP ESTRATÉGICO ═══
      await sendMediaFollowUp(sessionName, from, userId, convId, matchedMedia.name, matchedMedia.type, aiResponse, whatsappLineId);

    } else {
      // 🤖 Respuesta IA con mensaje combinado
      const aiResponse = await generateAIResponse(userId, combinedMessage, convId, whatsappLineId);
      if (!isCloudAPI) await stopPresence(sessionName, from);

      if (!aiResponse) {
        clog(`⚠️ AI sin respuesta para ${senderName} (userId: ${userId}, lineId: ${whatsappLineId || 'global'}, isCloud: ${isCloudAPI})`);
      }

      if (aiResponse) {
        // 🔊 CHECK: ¿Responder con voz?
        const shouldVoice = isVoiceMode && (
          aiResponse.includes('<<VOZ>>') || // Trigger explícito desde el contexto/IA
          (assistant?.voiceEnabled && !aiResponse.includes('<<TEXTO>>')) // Modo siempre-voz (salvo override)
        );
        
        // Limpiar tags de control antes de enviar
        const cleanResponse = aiResponse.replace(/<<VOZ>>/g, '').replace(/<<TEXTO>>/g, '').trim();

        // ═══ 🔄 DETECTAR TRANSFERENCIA ENTRE LÍNEAS ═══
        const transferResetMatch = cleanResponse.match(/<<TRANSFERIR_RESET:(\+?\d{7,15})>>/);
        const transferMatch = transferResetMatch || cleanResponse.match(/<<TRANSFERIR:(\+?\d{7,15})>>/);
        const isResetTransfer = !!transferResetMatch;
        
        if (transferMatch && whatsappLineId) {
          const targetPhone = transferMatch[1];
          const farewellMessage = cleanResponse
            .replace(/<<TRANSFERIR_RESET:\+?\d{7,15}>>/g, '')
            .replace(/<<TRANSFERIR:\+?\d{7,15}>>/g, '')
            .trim();
          
          log(`🔄 Transferencia detectada → ${targetPhone}${isResetTransfer ? ' [RESET]' : ''}`);

          // Send farewell message from current line
          if (farewellMessage) {
            if (!isCloudAPI) await humanDelay(farewellMessage.length);
            const sent = await unifiedSendAIResponse(sessionName, from, farewellMessage, whatsappLineId);
            if (sent) {
              await prisma.message.create({ data: { conversationId: convId, content: farewellMessage, fromMe: true, userId, role: 'assistant' } });
              await prisma.conversation.update({ where: { id: convId }, data: { lastMessage: farewellMessage } });
            }
          }

          // Execute transfer to target line
          await new Promise(r => setTimeout(r, 1000)); // Pause before transfer
          await executeLineTransfer(
            targetPhone,
            from,
            senderName,
            userId,
            whatsappLineId,
            convId,
            farewellMessage,
            isResetTransfer
          );

          // Skip the rest of the normal flow — transfer handled
        } else {

        // ═══ DETECTAR TRIGGER EN RESPUESTA ANTES DE ENVIAR TEXTO ═══
        const triggerableItems = mediaItems.filter((m: any) => m.trigger);
        const responseMedia = triggerableItems.length > 0 ? findMediaTrigger(cleanResponse, triggerableItems) : null;

        if (responseMedia) {
          // ═══ FLUJO: MEDIA PRIMERO → TEXTO → FOLLOW-UP ═══
          log(`📸 Trigger por RESPUESTA del bot: "${responseMedia.name}" (tipo: ${responseMedia.type})`);

          // PASO 1: Enviar media PRIMERO
          if (responseMedia.type === 'catalog' && Array.isArray(responseMedia.images) && responseMedia.images.length > 0) {
            log(`📂 Enviando catálogo "${responseMedia.name}" con ${responseMedia.images.length} imágenes`);
            let sentCount = 0;
            for (let i = 0; i < responseMedia.images.length; i++) {
              const img = responseMedia.images[i];
              const caption = i === 0 ? (responseMedia.caption || responseMedia.name) : '';
              const imgMedia = { type: 'image', url: img.url, name: img.name || `imagen-${i + 1}` };
              const imgSent = await unifiedSendMedia(sessionName, from, imgMedia, caption, whatsappLineId);
              if (imgSent) sentCount++;
              if (i < responseMedia.images.length - 1) await new Promise(r => setTimeout(r, 1500));
            }
            // Save each catalog image as message so they show in conversation
            for (let j = 0; j < responseMedia.images.length; j++) {
              const img = responseMedia.images[j];
              if (img.url) {
                await prisma.message.create({ data: { 
                  conversationId: convId, 
                  content: j === 0 ? `📂 ${responseMedia.name} (${sentCount} fotos)` : `📷 ${img.name || `Foto ${j+1}`}`, 
                  fromMe: true, userId, role: 'assistant', 
                  mediaType: 'image', mediaUrl: img.url 
                } });
              }
            }
            log(`📂 Catálogo completado: ${sentCount}/${responseMedia.images.length} imágenes`);
          } else {
            const sent = await unifiedSendMedia(sessionName, from, responseMedia, responseMedia.caption || '', whatsappLineId);
            if (sent) {
              await prisma.message.create({ data: { conversationId: convId, content: `📎 [${responseMedia.type}: ${responseMedia.name}]`, fromMe: true, userId, role: 'assistant', mediaType: responseMedia.type, mediaUrl: responseMedia.url || null } });
              log(`📎 Media enviada por trigger de respuesta: ${responseMedia.name}`);
            }
          }

          // PASO 2: Pausa natural + enviar texto IA DESPUÉS de la media
          if (!isCloudAPI) {
            await new Promise(r => setTimeout(r, 600 + Math.random() * 600));
            await setPresence(sessionName, from, 'typing');
            await humanDelay(cleanResponse.length);
            await stopPresence(sessionName, from);
          } else {
            await new Promise(r => setTimeout(r, 300));
          }

          const sent = await unifiedSendAIResponse(sessionName, from, cleanResponse, whatsappLineId);
          if (sent) {
            await prisma.message.create({ data: { conversationId: convId, content: cleanResponse, fromMe: true, userId, role: 'assistant' } });
            await prisma.conversation.update({ where: { id: convId }, data: { lastMessage: cleanResponse } });
            log(`🤖 Respuesta (post-media) → ${senderName}`);
          }

          // PASO 3: Follow-up estratégico
          await sendMediaFollowUp(sessionName, from, userId, convId, responseMedia.name, responseMedia.type, cleanResponse, whatsappLineId);

        } else {
          // ═══ FLUJO NORMAL SIN TRIGGER: Solo texto ═══
          if (!isCloudAPI) await humanDelay(cleanResponse.length);
        
          if (shouldVoice && assistant?.elevenLabsKey && assistant?.selectedVoice) {
            // 🔊 MODO VOZ: Enviar texto + audio
            const sent = await unifiedSendAIResponse(sessionName, from, cleanResponse, whatsappLineId);
            if (sent) {
              await prisma.message.create({ data: { conversationId: convId, content: cleanResponse, fromMe: true, userId, role: 'assistant' } });
              await prisma.conversation.update({ where: { id: convId }, data: { lastMessage: cleanResponse } });
            }
            
            // Generar y enviar audio
            try {
              const audioBuffer = await textToSpeech(cleanResponse, assistant.elevenLabsKey, assistant.selectedVoice);
              if (audioBuffer) {
                await unifiedSendVoice(sessionName, from, audioBuffer, whatsappLineId);
                await prisma.message.create({ data: { conversationId: convId, content: '🔊 [Nota de voz]', fromMe: true, userId, role: 'assistant', mediaType: 'audio' } });
                log(`🔊 Voz enviada → ${senderName} (${audioBuffer.length} bytes)`);
              }
            } catch (voiceErr: any) {
              console.error('⚠️ Error TTS (no crítico):', voiceErr.message);
            }
          } else {
            // 📝 MODO TEXTO: Normal (Cloud API usa mensajes divididos por párrafo)
            const sent = await unifiedSendAIResponse(sessionName, from, cleanResponse, whatsappLineId);
            if (sent) {
              await prisma.message.create({ data: { conversationId: convId, content: cleanResponse, fromMe: true, userId, role: 'assistant' } });
              await prisma.conversation.update({ where: { id: convId }, data: { lastMessage: cleanResponse } });
              clog(`🤖 Respuesta → ${senderName} (${msgs.length} msgs agrupados${isCloudAPI ? ', Cloud' : ''})`);
            }
          }
        }
        } // end transfer else
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
      clog(`🔄 ${pending.messages.length} msg(s) pendiente(s) de ${senderName} → procesando en 1.5s...`);
      clearTimeout(pending.timer);
      // Breve espera (1.5s) por si llegan más mensajes, luego procesar
      pending.timer = setTimeout(() => processBufferedMessages(bufferKey), 1500);
    }
  }
};

// ===== RUTAS AUTENTICADAS =====

// ====================================================
// 📱 WHATSAPP LINES CRUD (Multi-línea)
// ====================================================

// GET /lines — Listar líneas del usuario (respeta allowedLines para sub-usuarios)
router.get('/lines', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    
    // Obtener todas las líneas del admin
    let lines = await prisma.whatsappLine.findMany({
      where: { userId: ownerId },
      orderBy: { createdAt: 'asc' }
    });
    
    // 🔒 Filtrar por allowedLines si es sub-usuario
    // Doble verificación: por ownerId Y por role/parentUserId
    const currentUser = await prisma.user.findUnique({ 
      where: { id: userId }, 
      select: { permissions: true, name: true, email: true, role: true, parentUserId: true } 
    });
    const isSubUser = userId !== ownerId || currentUser?.parentUserId != null || currentUser?.role !== 'admin';
    
    if (isSubUser) {
      // Parsear permissions robustamente
      let perms: any = currentUser?.permissions;
      if (typeof perms === 'string') {
        try { perms = JSON.parse(perms); } catch { perms = {}; }
      }
      if (typeof perms === 'string') {
        try { perms = JSON.parse(perms); } catch { perms = {}; }
      }
      
      const allowedLines = perms?.allowedLines;
      
      log(`🔍 Sub-usuario ${currentUser?.name || currentUser?.email} (${userId})`);
      log(`   - permissions type: ${typeof currentUser?.permissions}`);
      log(`   - allowedLines: ${JSON.stringify(allowedLines)}`);
      log(`   - Total lineas admin: ${lines.length}`);
      
      if (allowedLines && Array.isArray(allowedLines) && allowedLines.length > 0 && !allowedLines.includes('all')) {
        const before = lines.length;
        lines = lines.filter((l: any) => allowedLines.includes(l.id));
        log(`   🔒 Filtrado: ${before} -> ${lines.length} lineas`);
      } else {
        log(`   ✅ Acceso a todas las lineas`);
      }
    }

    // Actualizar status de cada línea consultando WAHA (skip Cloud API)
    const updatedLines = await Promise.all(lines.map(async (line) => {
      // Cloud API lines don't need WAHA status check
      if (line.connectionType === 'cloud_api') {
        return { ...line, status: line.status || 'connected' };
      }
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
    
    // 🔒 Verificar límite de líneas según plan + addons comprados
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { plan: true } });
    const planLimits: Record<string, number> = { trial: 1, starter: 2, business: 5 };
    const basePlanLines = planLimits[owner?.plan || 'trial'] || 1;
    
    // Contar líneas extra compradas
    const extraLinesPurchased = await prisma.payment.count({
      where: { userId: ownerId, plan: 'extra_line', status: 'approved' }
    });
    const maxLines = basePlanLines + extraLinesPurchased;
    
    const currentLineCount = await prisma.whatsappLine.count({ where: { userId: ownerId } });
    if (currentLineCount >= maxLines) {
      res.status(403).json({ 
        error: `Tu plan ${owner?.plan || 'trial'} permite máximo ${maxLines} línea(s) de WhatsApp. Actualiza tu plan para agregar más.`,
        limit: maxLines,
        current: currentLineCount,
        upgrade: true
      });
      return;
    }
    
    const { label, assignedTo, assistantId, connectionType, cloudPhoneNumberId, cloudBusinessId, cloudAccessToken, cloudAppId } = req.body;
    
    // Generar nombre de sesión único
    const sessionName = connectionType === 'cloud_api' 
      ? `cloud_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`
      : `line_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`;
    
    // Buscar nombre del asignado si hay
    let assignedName: string | null = null;
    if (assignedTo) {
      const member = await prisma.user.findUnique({ where: { id: assignedTo }, select: { name: true } });
      assignedName = member?.name || null;
    }
    
    // ☁️ Cloud API: validate required fields
    let verifiedPhone: string | null = null;
    if (connectionType === 'cloud_api') {
      if (!cloudPhoneNumberId || !cloudAccessToken) {
        res.status(400).json({ error: 'Se requiere Phone Number ID y Access Token para Cloud API' }); return;
      }
      try {
        const verifyRes = await fetch(`https://graph.facebook.com/v21.0/${cloudPhoneNumberId}`, {
          headers: { 'Authorization': `Bearer ${cloudAccessToken}` }
        });
        if (!verifyRes.ok) {
          const errData = await verifyRes.json().catch(() => ({}));
          res.status(400).json({ error: `Token inválido: ${(errData as any)?.error?.message || 'No se pudo verificar'}` }); return;
        }
        const phoneData = await verifyRes.json() as any;
        verifiedPhone = phoneData.display_phone_number || null;
        log(`☁️ Cloud API verificado: ${verifiedPhone || cloudPhoneNumberId}`);
      } catch (e: any) {
        res.status(400).json({ error: `Error verificando Cloud API: ${e.message}` }); return;
      }
    }
    
    const webhookVerifyToken = connectionType === 'cloud_api' 
      ? `biz_${Math.random().toString(36).substring(2, 15)}${Date.now().toString(36)}` : null;
    
    const line = await prisma.whatsappLine.create({
      data: {
        userId: ownerId,
        label: label || 'Nueva Línea',
        sessionName,
        connectionType: connectionType || 'waha',
        assignedTo: assignedTo || null,
        assignedName,
        assistantId: assistantId || null,
        status: connectionType === 'cloud_api' ? 'connected' : 'disconnected',
        phone: verifiedPhone || null,
        ...(connectionType === 'cloud_api' && {
          cloudPhoneNumberId, cloudBusinessId: cloudBusinessId || null,
          cloudAccessToken, cloudWebhookVerifyToken: webhookVerifyToken,
          cloudAppId: cloudAppId || null,
        })
      }
    });
    
    log(`📱 Línea creada: ${line.id} (${sessionName}) [${connectionType || 'waha'}]`);
    const backendUrl = process.env.BACKEND_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000');
    
    res.json({ 
      line, success: true,
      ...(connectionType === 'cloud_api' && {
        webhookUrl: `${backendUrl}/api/webhook/whatsapp-cloud`,
        webhookVerifyToken,
        instructions: 'Configura este Webhook URL y Verify Token en tu app de Meta → WhatsApp → Configuration → Webhook'
      })
    });
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
    const { label, assignedTo, assistantId, cloudPhoneNumberId, cloudAccessToken, cloudBusinessId, cloudAppId } = req.body;
    
    // Verificar que la línea pertenece al usuario
    const existing = await prisma.whatsappLine.findFirst({ where: { id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'Línea no encontrada' }); return; }
    
    let assignedName: string | null = null;
    if (assignedTo) {
      const member = await prisma.user.findUnique({ where: { id: assignedTo }, select: { name: true } });
      assignedName = member?.name || null;
    }
    
    // Validate Cloud API token if changed
    if (cloudAccessToken && cloudPhoneNumberId && existing.connectionType === 'cloud_api') {
      try {
        const verifyRes = await fetch(`https://graph.facebook.com/v21.0/${cloudPhoneNumberId}`, {
          headers: { 'Authorization': `Bearer ${cloudAccessToken}` }
        });
        if (!verifyRes.ok) {
          const errData = await verifyRes.json().catch(() => ({}));
          res.status(400).json({ error: `Token inválido: ${(errData as any)?.error?.message || 'Error'}` }); return;
        }
      } catch (e: any) {
        res.status(400).json({ error: `Error verificando: ${e.message}` }); return;
      }
    }
    
    const line = await prisma.whatsappLine.update({
      where: { id },
      data: {
        ...(label !== undefined ? { label } : {}),
        ...(assignedTo !== undefined ? { assignedTo: assignedTo || null, assignedName } : {}),
        ...(assistantId !== undefined ? { assistantId: assistantId || null } : {}),
        ...(cloudPhoneNumberId !== undefined ? { cloudPhoneNumberId } : {}),
        ...(cloudAccessToken !== undefined ? { cloudAccessToken } : {}),
        ...(cloudBusinessId !== undefined ? { cloudBusinessId: cloudBusinessId || null } : {}),
        ...(cloudAppId !== undefined ? { cloudAppId: cloudAppId || null } : {}),
      }
    });
    
    // Clear lineInfo cache if cloud fields changed
    if (cloudAccessToken || cloudPhoneNumberId) lineInfoCache.delete(id);
    
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
    
    // Detener sesión en WAHA si no es Cloud API
    if (line.connectionType !== 'cloud_api') {
      try {
        await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}/stop`, { method: 'POST', headers: getWahaHeaders() });
      } catch {}
    }
    
    // ✅ LIMPIEZA EN CASCADA — Eliminar todo lo vinculado a esta línea
    
    // 1. Eliminar mensajes programados de esta línea
    const deletedScheduled = await prisma.scheduledMessage.deleteMany({ where: { whatsappLineId: id, userId: ownerId } });
    
    // 2. Eliminar conversaciones y sus mensajes (cascade) de esta línea
    const deletedConversations = await prisma.conversation.deleteMany({ where: { whatsappLineId: id, userId: ownerId } });
    
    // 3. Desvincular asistente de esta línea (no eliminar, podría reasignarse)
    await prisma.assistant.updateMany({ where: { whatsappLineId: id, userId: ownerId }, data: { whatsappLineId: null, isActive: false } });
    
    // 4. Desvincular productos de esta línea
    await prisma.product.updateMany({ where: { whatsappLineId: id, userId: ownerId }, data: { whatsappLineId: null } });
    
    // 5. Desvincular clientes de esta línea
    await prisma.client.updateMany({ where: { whatsappLineId: id, userId: ownerId }, data: { whatsappLineId: null } });
    
    // 6. Desvincular citas de esta línea
    await prisma.appointment.updateMany({ where: { whatsappLineId: id, userId: ownerId }, data: { whatsappLineId: null } });
    
    // 7. Eliminar la línea
    await prisma.whatsappLine.delete({ where: { id } });
    
    log(`🗑️ Línea eliminada: ${line.id} (${line.sessionName}) — ${deletedConversations.count} convs, ${deletedScheduled.count} programados limpiados`);
    res.json({ success: true, cleaned: { conversations: deletedConversations.count, scheduled: deletedScheduled.count } });
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
          engine: 'WEBJS',
          config: { webhooks: [{ url: webhookUrl, events: ['message', 'session.status'] }] }
        })
      });
      log(`📱 Sesión WAHA creada (WEBJS): ${line.sessionName}`);
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
          // WEBJS: If status is SCAN_QR_CODE but qr endpoint failed, try screenshot
          if (data.status === 'SCAN_QR_CODE' && !qrData) {
            try {
              const sr = await fetch(`${WAHA_API_URL}/api/screenshot?session=${line.sessionName}`, { headers: getWahaHeaders() });
              if (sr.ok && sr.headers.get('content-type')?.includes('image')) {
                const buf = Buffer.from(await sr.arrayBuffer());
                qrData = `data:image/png;base64,${buf.toString('base64')}`;
                log(`📱 QR obtenido via screenshot (WEBJS): ${line.sessionName}`);
              }
            } catch {}
          }
        }
      } catch {}
    }
    
    res.json({ qr: qrData, available: !!qrData });
  } catch (e: any) {
    res.json({ qr: null, available: false });
  }
});

// ===== GET /api/whatsapp/api-key-error — Verificar errores de API Key =====
router.get('/api-key-error', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    
    const error = apiKeyErrorCache.get(ownerId);
    if (error) {
      res.json({ hasError: true, ...error });
    } else {
      res.json({ hasError: false });
    }
  } catch { res.json({ hasError: false }); }
});

// ===== PUT /api/whatsapp/api-key-error/clear — Limpiar error de API Key =====
router.put('/api-key-error/clear', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    apiKeyErrorCache.delete(ownerId);
    res.json({ success: true });
  } catch { res.json({ success: true }); }
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
          engine: 'WEBJS',
          config: {
            webhooks: [{ url: webhookUrl, events: ['message', 'session.status'] }]
          }
        })
      });
      const createData = await createRes.json().catch(() => ({}));
      log(`📱 Sesión creada (WEBJS): ${sessionName} (status: ${(createData as any).status || 'unknown'})`);
      res.json({ success: true, message: 'Sesión creada', session: sessionName });
    } else {
      const data = await check.json() as any;

      if (['STOPPED', 'FAILED'].includes(data.status)) {
        // ✅ FIX: Si la sesión existe pero está detenida, iniciarla
        await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}/start`, { method: 'POST', headers: getWahaHeaders() });
        log(`🔄 Sesión reiniciada: ${sessionName}`);
      } else if (data.status === 'SCAN_QR_CODE') {
        // Ya está esperando QR, no hacer nada
        log(`📱 Sesión ya esperando QR: ${sessionName}`);
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
    
    // Actualizar configuración de la sesión con eventos WEBJS completos
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
    log(`🔄 Webhooks reconfigurados para ${sessionName}: ${updateRes.status}`);
    
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
    const cleanNumber = to.replace(/\D/g, '');
    // WEBJS: Always use @c.us (WEBJS doesn't use @lid)
    // Keep @lid fallback only for legacy NOWEB sessions
    const chatId = to.includes('@') ? to : `${cleanNumber}@c.us`;

    // 🔗 DETERMINAR SESIÓN/LÍNEA CORRECTA
    let sessionName: string | null = null;
    let lineId: string | null = whatsappLineId || legacyLineId || null;
    let lineRecord: any = null;

    if (whatsappLineId) {
      const line = await prisma.whatsappLine.findFirst({ where: { id: whatsappLineId, userId: ownerId } });
      if (line) { sessionName = line.sessionName; lineId = line.id; lineRecord = line; }
    }
    if (!sessionName) {
      const existingConv = await prisma.conversation.findFirst({ 
        where: { userId: ownerId, recipientId: { endsWith: cleanNumber.slice(-10) } },
        select: { whatsappLineId: true }
      });
      if (existingConv?.whatsappLineId) {
        const line = await prisma.whatsappLine.findUnique({ where: { id: existingConv.whatsappLineId } });
        if (line) { sessionName = line.sessionName; lineId = line.id; lineRecord = line; }
      }
    }
    if (!sessionName) {
      const firstLine = await prisma.whatsappLine.findFirst({ where: { userId: ownerId, status: 'connected' } });
      if (firstLine) { sessionName = firstLine.sessionName; lineId = firstLine.id; lineRecord = firstLine; }
      else { const session = await findActiveSession(ownerId); sessionName = session?.name || getUserSessionName(ownerId); }
    }

    // 📤 ENVIAR — detectar Cloud API vs WAHA
    let sent = false;
    const isCloud = lineRecord?.connectionType === 'cloud_api' && lineRecord?.cloudPhoneNumberId && lineRecord?.cloudAccessToken;
    
    if (isCloud) {
      if (message) sent = await sendCloudText(lineRecord.cloudPhoneNumberId, lineRecord.cloudAccessToken, cleanNumber, message);
      if (mediaUrl) {
        const mediaObj = { url: mediaUrl, type: sendMediaType || 'image', name: 'media' };
        sent = (await sendCloudMedia(lineRecord.cloudPhoneNumberId, lineRecord.cloudAccessToken, cleanNumber, mediaObj, !message ? '' : undefined)) || sent;
      }
    } else {
      if (message) sent = await sendWahaMessage(sessionName, chatId, message);
      if (mediaUrl) {
        const mediaObj = { url: mediaUrl, type: sendMediaType || 'image', name: 'media' };
        sent = (await sendWahaMedia(sessionName, chatId, mediaObj, !message ? '' : undefined)) || sent;
      }
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

    log(`📢 Envío masivo: ${contacts.length} contactos, sesión: ${sessionName}`);

    // Responder inmediatamente y procesar en background
    res.json({ success: true, message: `Enviando a ${contacts.length} contactos...`, total: contacts.length });

    // ===== 🛡️ MECANISMO ANTI-BLOQUEO =====
    let sent = 0;
    let failed = 0;
    const total = contacts.length;
    
    // Intervalos progresivos: más contactos = más lento
    const getDelay = (index: number): number => {
      const base = 5000; // 5 segundos mínimo
      const max = 18000; // 18 segundos máximo
      
      // Aleatoriedad: ±30% del delay base
      const randomFactor = 0.7 + Math.random() * 0.6; // 0.7 a 1.3
      
      // Progresivo: aumenta delay conforme avanza (fatiga del rate limit)
      const progressFactor = 1 + (index / total) * 0.5; // 1.0 a 1.5
      
      // Más contactos = más lento
      let delay: number;
      if (total <= 20) {
        delay = base * randomFactor; // 3.5-6.5s para lotes pequeños
      } else if (total <= 50) {
        delay = (base + 3000) * randomFactor * progressFactor; // 5.6-15.6s
      } else if (total <= 100) {
        delay = (base + 5000) * randomFactor * progressFactor; // 7-19.5s
      } else {
        delay = (base + 8000) * randomFactor * progressFactor; // 9.1-25.3s
      }
      
      return Math.min(delay, max + 5000); // Cap en 23s
    };
    
    // Pausa larga cada N mensajes (batch break)
    const BATCH_SIZE = 15; // Cada 15 mensajes
    const BATCH_PAUSE_MIN = 30000; // 30 segundos
    const BATCH_PAUSE_MAX = 60000; // 60 segundos
    
    log(`🛡️ Anti-bloqueo: ${total} contactos, batch=${BATCH_SIZE}, delays=5-18s`);

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      try {
        const phone = (contact.phone || contact.recipientId || contact).replace(/\D/g, '');
        // STRICT: Real phone numbers are 7-13 digits, LIDs are >13 digits
        if (!phone || phone.length < 7) { 
          log(`⏭️ Número inválido: ${phone} (${phone.length} dígitos) — saltando`);
          failed++; continue; 
        }

        // LID numbers (>13 digits) use @lid, regular phones use @c.us
        const chatId = phone.length > 13 ? `${phone}@lid` : `${phone}@c.us`;

        // 🔍 Verificar si existe en WhatsApp (con cache)
        try {
          const checkEndpoints = [
            { url: `${WAHA_API_URL}/api/contacts/check-exists`, body: { session: sessionName, phone: chatId } },
            { url: `${WAHA_API_URL}/api/${sessionName}/contacts/check-exists`, body: { phone: chatId } }
          ];
          for (const ep of checkEndpoints) {
            try {
              const cr = await fetch(ep.url, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(ep.body) });
              if (cr.ok) {
                const cd = await cr.json() as any;
                if (cd?.numberExists === false || cd?.result?.exists === false || cd?.exists === false) {
                  log(`⏭️ No existe en WhatsApp: ${phone} — saltando`);
                  failed++; break;
                }
                break; // Check passed
              }
            } catch {}
          }
          if (failed > i) continue; // Was skipped in the check loop
        } catch {}

        // ⌨️ Simular typing (más natural)
        await setPresence(sessionName!, chatId, 'typing').catch(() => {});
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        await stopPresence(sessionName!, chatId).catch(() => {});

        // 📎 PASO 1: Enviar MEDIA PRIMERO (imagen/video/audio antes del texto)
        if (mediaUrl) {
          const mediaObj = { url: mediaUrl, type: bulkMediaType || 'image', name: 'media' };
          const mediaSent = await sendWahaMedia(sessionName!, chatId, mediaObj);
          if (!mediaSent) { log(`⚠️ Media falló para ${phone}`); }
          // Pausa entre media y texto
          if (message) await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
        }

        // 💬 PASO 2: Enviar TEXTO después (con variación anti-spam)
        if (message) {
          // Variación invisible para anti-spam
          const variations = ['', ' ', '\u200B', '\u200E'];
          const variedMsg = message + variations[i % variations.length];
          const textSent = await sendWahaMessage(sessionName!, chatId, variedMsg);
          if (!textSent) { failed++; continue; }
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
        log(`📢 Masivo ${sent}/${total}: ✅ ${phone}`);

        // 🛡️ DELAY ANTI-BLOQUEO
        if (i < contacts.length - 1) {
          // Batch break: pausa larga cada BATCH_SIZE mensajes
          if (sent > 0 && sent % BATCH_SIZE === 0) {
            const batchPause = BATCH_PAUSE_MIN + Math.random() * (BATCH_PAUSE_MAX - BATCH_PAUSE_MIN);
            log(`🛡️ Pausa de batch: ${Math.round(batchPause / 1000)}s después de ${sent} mensajes`);
            await new Promise(r => setTimeout(r, batchPause));
          } else {
            // Delay normal entre mensajes
            const delay = getDelay(i);
            log(`🛡️ Delay: ${Math.round(delay / 1000)}s antes del siguiente`);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      } catch (e: any) {
        console.error(`📢 Masivo: ❌ Error enviando a contacto:`, e.message);
        failed++;
      }
    }

    log(`📢 Envío masivo completado: ${sent} enviados, ${failed} fallidos de ${total}`);
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
      burstConfig: BURST_CONFIG
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// =====================================================
// 🔑 FIX LID NUMBERS - Migrar LIDs a números reales
// =====================================================
router.post('/fix-lid-numbers', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    log('🔑 === INICIO MIGRACIÓN LID → NÚMERO REAL ===');

    // 1. Obtener todas las líneas del usuario
    const lines = await prisma.whatsappLine.findMany({ where: { userId: ownerId } });
    if (!lines.length) { res.json({ success: false, error: 'No hay líneas de WhatsApp' }); return; }

    // 2. Obtener TODAS las conversaciones con números inválidos (>13 dígitos o con LID_)
    const allConvs = await prisma.conversation.findMany({
      where: { userId: ownerId, isGroup: false },
      select: { id: true, recipientId: true, recipientName: true, whatsappLineId: true }
    });

    const invalidConvs = allConvs.filter(c => {
      const clean = c.recipientId.replace(/\D/g, '');
      return clean.length > 13 || c.recipientId.startsWith('LID_');
    });

    log(`🔑 Total conversaciones: ${allConvs.length}, Con número inválido: ${invalidConvs.length}`);

    if (invalidConvs.length === 0) {
      res.json({ success: true, message: 'No hay conversaciones con números inválidos', total: allConvs.length, invalid: 0, fixed: 0 });
      return;
    }

    // 3. Para cada línea conectada, obtener contactos de WAHA
    const wahaContacts = new Map<string, string>(); // lidNumber → realPhone

    for (const line of lines) {
      if (line.status !== 'connected') continue;
      
      log(`🔑 Consultando contactos de WAHA para sesión: ${line.sessionName}`);

      // Intentar múltiples endpoints de WAHA Plus para obtener contactos
      const contactEndpoints = [
        `${WAHA_API_URL}/api/${line.sessionName}/contacts`,
        `${WAHA_API_URL}/api/contacts?session=${line.sessionName}`,
        `${WAHA_API_URL}/api/${line.sessionName}/chats`,
        `${WAHA_API_URL}/api/chats?session=${line.sessionName}`,
      ];

      for (const url of contactEndpoints) {
        try {
          const r = await fetch(url, { headers: getWahaHeaders() });
          if (!r.ok) continue;
          
          const data = await r.json() as any;
          const contacts = Array.isArray(data) ? data : (data?.contacts || data?.chats || data?.data || []);
          
          if (!Array.isArray(contacts) || contacts.length === 0) continue;
          
          log(`🔑 Obtenidos ${contacts.length} contactos de ${url}`);
          
          for (const contact of contacts) {
            // Extract all possible phone/ID pairs
            const lid = contact?.id?.user || contact?.id?._serialized?.replace?.('@c.us', '').replace?.('@lid', '').replace?.('@s.whatsapp.net', '') || '';
            const phone = contact?.phone || contact?.number || contact?.pushname_phone || contact?.phoneNumber || '';
            const idUser = contact?.id?.user || '';
            const idSerialized = contact?.id?._serialized || '';
            const name = contact?.name || contact?.pushname || contact?.notifyName || '';
            
            // Map: if we have a lid-style number (>13 digits) and a real phone
            const lidClean = lid.replace(/\D/g, '');
            const phoneClean = (phone + '').replace(/\D/g, '');
            
            if (phoneClean.length >= 7 && phoneClean.length <= 13) {
              // This contact has a real phone number
              if (lidClean.length > 13) {
                wahaContacts.set(lidClean, phoneClean);
                log(`🔑 Mapeado: LID ${lidClean} → ${phoneClean} (${name})`);
              }
            }
            
            // Also try the serialized ID
            if (idSerialized.includes('@lid')) {
              const lidFromSerialized = idSerialized.replace('@lid', '').replace(/\D/g, '');
              if (phoneClean.length >= 7 && phoneClean.length <= 13 && lidFromSerialized.length > 13) {
                wahaContacts.set(lidFromSerialized, phoneClean);
              }
            }
          }
          
          if (wahaContacts.size > 0) break; // Got contacts, no need to try more endpoints
        } catch (e: any) {
          log(`⚠️ Error en ${url}: ${e.message}`);
        }
      }

      // 4. Si no obtuvimos contactos por lista, resolver uno por uno vía check-exists
      if (wahaContacts.size === 0) {
        log(`🔑 No se obtuvieron contactos por lista, intentando uno por uno...`);
        
        for (const conv of invalidConvs) {
          if (conv.whatsappLineId !== line.id && conv.whatsappLineId !== null) continue;
          
          const lidClean = conv.recipientId.replace('LID_', '').replace(/\D/g, '');
          const lidChatId = `${lidClean}@lid`;
          
          // Try WAHA contact profile
          const profileEndpoints = [
            { method: 'GET' as const, url: `${WAHA_API_URL}/api/${line.sessionName}/contacts/${encodeURIComponent(lidChatId)}` },
            { method: 'POST' as const, url: `${WAHA_API_URL}/api/${line.sessionName}/contacts/get-about`, body: { contactId: lidChatId } },
            { method: 'GET' as const, url: `${WAHA_API_URL}/api/${line.sessionName}/chats/${encodeURIComponent(lidChatId)}` },
            // Try with @c.us too
            { method: 'GET' as const, url: `${WAHA_API_URL}/api/${line.sessionName}/contacts/${encodeURIComponent(`${lidClean}@c.us`)}` },
          ];

          for (const ep of profileEndpoints) {
            try {
              const opts: RequestInit = { method: ep.method, headers: getWahaHeaders() };
              if ('body' in ep && ep.body) opts.body = JSON.stringify(ep.body);
              
              const r = await fetch(ep.url, opts);
              if (!r.ok) continue;
              
              const data = await r.json() as any;
              const possiblePhones = [
                data?.phone, data?.number, data?.phoneNumber,
                data?.id?.user, data?.jid?.replace?.('@c.us', ''),
                data?.result?.phone, data?.result?.number,
                data?.id?._serialized?.replace?.('@c.us', '').replace?.('@s.whatsapp.net', ''),
              ].filter(Boolean);

              for (const ph of possiblePhones) {
                const clean = (ph + '').replace(/\D/g, '');
                if (clean.length >= 7 && clean.length <= 13 && clean !== lidClean) {
                  wahaContacts.set(lidClean, clean);
                  log(`🔑 Resuelto individualmente: ${lidClean} → ${clean} (${conv.recipientName})`);
                  break;
                }
              }
              if (wahaContacts.has(lidClean)) break;
            } catch {}
          }
          
          // Small delay to not overwhelm WAHA
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    log(`🔑 Total mapeos LID→Teléfono encontrados: ${wahaContacts.size}`);

    // 5. Aplicar migraciones
    let fixed = 0;
    const results: any[] = [];

    for (const conv of invalidConvs) {
      const lidClean = conv.recipientId.replace('LID_', '').replace(/\D/g, '');
      const realPhone = wahaContacts.get(lidClean);

      if (realPhone) {
        // Verificar que no exista otra conversación con ese número real
        const existing = await prisma.conversation.findFirst({
          where: { userId: ownerId, recipientId: realPhone, id: { not: conv.id }, ...(conv.whatsappLineId ? { whatsappLineId: conv.whatsappLineId } : {}) }
        });

        if (existing) {
          // Merge: mover mensajes a la conversación existente
          await prisma.message.updateMany({ where: { conversationId: conv.id }, data: { conversationId: existing.id } });
          await prisma.conversation.delete({ where: { id: conv.id } });
          results.push({ name: conv.recipientName, old: conv.recipientId, new: realPhone, action: 'merged' });
          log(`🔑 MERGED: ${conv.recipientName} (${conv.recipientId} → ${realPhone}) con conversación existente`);
        } else {
          // Update: cambiar recipientId
          await prisma.conversation.update({ where: { id: conv.id }, data: { recipientId: realPhone } });
          results.push({ name: conv.recipientName, old: conv.recipientId, new: realPhone, action: 'fixed' });
          log(`🔑 FIXED: ${conv.recipientName} → ${realPhone}`);
        }
        fixed++;
      } else {
        results.push({ name: conv.recipientName, old: conv.recipientId, new: null, action: 'not_found' });
        log(`⚠️ NO RESUELTO: ${conv.recipientName} (${conv.recipientId})`);
      }
    }

    log(`🔑 === MIGRACIÓN COMPLETADA: ${fixed}/${invalidConvs.length} corregidos ===`);

    res.json({
      success: true,
      total: allConvs.length,
      invalid: invalidConvs.length,
      fixed,
      wahaContactsFound: wahaContacts.size,
      results
    });
  } catch (e: any) {
    console.error('🔑 Error en migración LID:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// =====================================================
// 🔑 GET WAHA CONTACTS - Debug: ver qué contactos tiene WAHA
// =====================================================
router.get('/waha-contacts', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const lines = await prisma.whatsappLine.findMany({ where: { userId: ownerId, status: 'connected' } });
    const allContacts: any[] = [];

    for (const line of lines) {
      const endpoints = [
        `${WAHA_API_URL}/api/${line.sessionName}/contacts`,
        `${WAHA_API_URL}/api/contacts?session=${line.sessionName}`,
        `${WAHA_API_URL}/api/${line.sessionName}/chats`,
      ];

      for (const url of endpoints) {
        try {
          const r = await fetch(url, { headers: getWahaHeaders() });
          if (!r.ok) continue;
          const data = await r.json() as any;
          const contacts = Array.isArray(data) ? data : (data?.contacts || data?.chats || data?.data || []);
          if (Array.isArray(contacts) && contacts.length > 0) {
            allContacts.push({ session: line.sessionName, endpoint: url, count: contacts.length, sample: contacts.slice(0, 5) });
            break;
          }
        } catch {}
      }
    }

    // Also get conversations with invalid numbers
    const invalidConvs = await prisma.conversation.findMany({
      where: { userId: ownerId, isGroup: false },
      select: { id: true, recipientId: true, recipientName: true }
    });

    const invalid = invalidConvs.filter(c => {
      const clean = c.recipientId.replace(/\D/g, '');
      return clean.length > 13 || c.recipientId.startsWith('LID_');
    });

    res.json({
      lines: lines.map(l => ({ id: l.id, session: l.sessionName, phone: (l as any).phone })),
      wahaContacts: allContacts,
      invalidConversations: invalid.map(c => ({ name: c.recipientName, recipientId: c.recipientId, digits: c.recipientId.replace(/\D/g, '').length })),
      totalConversations: invalidConvs.length,
      totalInvalid: invalid.length
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

    if (!event || event !== 'message') { res.json({ success: true }); return; }
    
    // 🔄 Para mensajes fromMe (enviados desde el celular o plataforma):
    // - Guardar en DB si fue enviado manualmente desde el celular
    // - Deduplicar si ya fue guardado por /send o AI
    const isFromMe = payload?.fromMe === true;
    
    if (isFromMe) {
      // Verificar si este mensaje ya fue enviado desde la plataforma
      const msgBody = (payload?.body || payload?.text || payload?.content || '').trim();
      const from = payload?.from || payload?.chatId || '';
      const isLidFromMe = from.includes('@lid');
      let cleanFrom = from.replace(/[@\s]/g, '').replace('c.us', '').replace('g.us', '').replace('lid', '');
      
      // Resolve LID for fromMe messages too
      if (isLidFromMe) {
        const resolved = await resolveLidToPhone(sessionName, from, payload);
        if (resolved && !resolved.startsWith('LID_')) cleanFrom = resolved;
      }
      
      const dedupKey = `${cleanFrom}:${msgBody.substring(0, 60)}`;
      
      if (recentlySentFromPlatform.has(dedupKey)) {
        // Ya fue guardado por /send o AI — ignorar
        recentlySentFromPlatform.delete(dedupKey); // Limpiar
        res.json({ success: true }); return;
      }
      
      // Mensaje enviado manualmente desde el celular → GUARDAR
      try {
        const line = await prisma.whatsappLine.findFirst({ where: { sessionName } });
        if (line) {
          const ownerId = line.userId;
          const recipientNumber = cleanFrom.replace(/\D/g, '');
          
          // Buscar conversación (try exact, then last 10 digits)
          let conv = await prisma.conversation.findFirst({ 
            where: { userId: ownerId, whatsappLineId: line.id, recipientId: { endsWith: recipientNumber.slice(-10) } } 
          });
          // If not found and number is long (LID), also try shorter match
          if (!conv && recipientNumber.length > 13) {
            conv = await prisma.conversation.findFirst({
              where: { userId: ownerId, whatsappLineId: line.id, recipientId: { contains: recipientNumber.slice(-7) } }
            });
          }
          
          if (conv && msgBody) {
            // Verificar que no sea duplicado reciente (últimos 30s)
            const recentDup = await prisma.message.findFirst({
              where: { 
                conversationId: conv.id, 
                content: msgBody, 
                fromMe: true,
                timestamp: { gte: new Date(Date.now() - 30000) }
              }
            });
            
            if (!recentDup) {
              await prisma.message.create({
                data: { conversationId: conv.id, content: msgBody, fromMe: true, userId: ownerId, role: 'assistant' }
              });
              await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: msgBody } });
              log(`📱 Mensaje manual (celular) guardado: "${msgBody.substring(0, 40)}..." → ${conv.recipientName || recipientNumber}`);
            }
          }
        }
      } catch (e: any) {
        log(`⚠️ Error guardando mensaje fromMe: ${e.message}`);
      }
      res.json({ success: true }); return;
    }

    // 🔒 DEDUPLICACIÓN: Ignorar si ya procesamos este mensaje (WAHA envía message + message.any)
    const msgId = payload?.id?._serialized || payload?.id?.id || payload?.key?.id || '';
    if (msgId && recentlyProcessed.has(msgId)) {
      log(`🔄 Duplicado ignorado: ${msgId}`);
      res.json({ success: true }); return;
    }
    if (msgId) {
      recentlyProcessed.add(msgId);
      setTimeout(() => recentlyProcessed.delete(msgId), 60000); // 60s en vez de 30s
    }

    // 🔒 DEDUP NIVEL 2: Por contenido + remitente (protege contra webhooks duplicados con IDs diferentes)
    const rawBody = payload?.body || payload?.text || payload?.content || '';
    const rawFrom = payload?.from || payload?.chatId || '';
    const contentDedupKey = `${rawFrom}:${rawBody.substring(0, 80)}:${Math.floor(Date.now() / 10000)}`; // ventana de 10s
    if (rawBody && recentlyProcessed.has(contentDedupKey)) {
      log(`🔄 Duplicado por contenido ignorado: "${rawBody.substring(0, 40)}"`);
      res.json({ success: true }); return;
    }
    if (rawBody) {
      recentlyProcessed.add(contentDedupKey);
      setTimeout(() => recentlyProcessed.delete(contentDedupKey), 15000);
    }

    const from = payload?.from || payload?.chatId || payload?.key?.remoteJid || '';
    let body = payload?.body || payload?.text || payload?.content || '';
    const notifyName = payload?.notifyName || payload?.pushName || payload?._data?.notifyName || '';

    // 🔍 DETECT @lid FORMAT (NOWEB engine only — WEBJS uses @c.us with real phone numbers)
    // Keep this for backward compatibility if NOWEB sessions still exist
    const isLid = from.includes('@lid') || (
      !from.includes('@g.us') && !from.includes('@c.us') && !from.includes('@s.whatsapp.net') &&
      from.replace(/\D/g, '').length > 13
    );
    if (isLid) {
      log(`🔑 Detectado formato LID: ${from} — resolviendo número real...`);
      log(`🔑 Payload keys: ${Object.keys(payload || {}).join(', ')}`);
      log(`🔑 _data.from: ${payload?._data?.from || 'N/A'}`);
      log(`🔑 _data.id: ${JSON.stringify(payload?._data?.id || {}).substring(0, 200)}`);
      log(`🔑 chat: ${JSON.stringify(payload?.chat || {}).substring(0, 200)}`);
    }

    // 🚫 Filtrar: historias/estados de WhatsApp, broadcast (pero NO grupos)
    if (!from || from.includes('@broadcast') || from.includes('status@') || from === 'status@broadcast') {
      if (from?.includes('@broadcast') || from?.includes('status@')) {
        log(`🚫 Ignorado: historia/estado de WhatsApp de ${from}`);
      }
      res.json({ success: true }); return;
    }

    // 👥 DETECTAR SI ES GRUPO
    const isGroup = from.includes('@g.us');
    const participant = payload?.participant || payload?.author || payload?._data?.author || '';
    const participantName = payload?.notifyName || payload?.pushName || payload?._data?.notifyName || '';
    
    if (isGroup) {
      log(`👥 Mensaje de GRUPO: ${from} | Participante: ${participantName} (${participant})`);
    }

    // 🔍 Detectar media (audio, imagen, video, sticker)
    const media = extractMediaInfo(payload);
    let savedMediaUrl: string | null = null;
    let savedMediaType: string | null = null;

    if (media.hasMedia) {
      // 🔍 LOG COMPLETO del payload para debugging
      log(`📎 === MEDIA PAYLOAD DEBUG ===`);
      log(`📎 type: ${payload?.type}`);
      log(`📎 hasMedia: ${payload?.hasMedia}`);
      log(`📎 mimetype: ${payload?.mimetype}`);
      log(`📎 mediaUrl (RAW): ${payload?.mediaUrl || 'N/A'}`);
      log(`📎 media keys: ${payload?.media ? Object.keys(payload.media).join(', ') : 'NO media obj'}`);
      log(`📎 media.url (RAW): ${payload?.media?.url || 'N/A'}`);
      log(`📎 media.data length: ${payload?.media?.data ? payload.media.data.length : 'N/A'}`);
      log(`📎 media.mimetype: ${payload?.media?.mimetype || 'N/A'}`);
      log(`📎 media.filename: ${payload?.media?.filename || 'N/A'}`);
      log(`📎 id: ${JSON.stringify(payload?.id || '').substring(0, 200)}`);
      log(`📎 _data keys: ${payload?._data ? Object.keys(payload._data).slice(0, 15).join(', ') : 'NO _data'}`);
      log(`📎 _data.body length: ${payload?._data?.body ? payload._data.body.length : 'N/A'}`);
      log(`📎 _data.deprecatedMms3Url: ${payload?._data?.deprecatedMms3Url?.substring(0, 100) || 'N/A'}`);
      log(`📎 ALL TOP KEYS: ${Object.keys(payload || {}).join(', ')}`);
      log(`📎 === END DEBUG ===`);
      
      // 🎤 AUDIO → Transcribir con Whisper
      if (media.mediaType === 'audio') {
        const recipientIdTemp = isLid 
          ? await resolveLidToPhone(sessionName, from, payload).then(r => r.replace('LID_', ''))
          : from.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '');
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
                log(`🎤 Audio transcrito: "${transcript.substring(0, 100)}"`);
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
      
      // 🖼️ IMAGEN → Descargar, analizar con Vision, guardar en chat
      else if (media.mediaType === 'image') {
        // Intentar descargar y guardar como base64 para el chat
        let downloaded: { buffer: Buffer; mimetype: string } | null = null;
        if (media.messageId || media.mediaUrl) {
          downloaded = await downloadMediaFromWaha(sessionName, media.messageId, payload);
          if (downloaded) {
            savedMediaUrl = `data:${downloaded.mimetype};base64,${downloaded.buffer.toString('base64')}`;
            log(`🖼️ Imagen guardada como base64: ${downloaded.buffer.length} bytes`);
          } else {
            savedMediaUrl = getMediaUrl(sessionName, media.messageId);
          }
        }
        savedMediaType = 'image';
        
        // 👁️ VISION: Analizar imagen con GPT-4o-mini Vision
        if (downloaded) {
          const recipientIdTemp = isLid 
            ? await resolveLidToPhone(sessionName, from, payload).then(r => r.replace('LID_', ''))
            : from.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '');
          const userIdTemp = await resolveUserFromWebhook(sessionName, recipientIdTemp);
          if (userIdTemp) {
            const userForVision = await prisma.user.findUnique({ where: { id: userIdTemp }, select: { apiKey: true } });
            if (userForVision?.apiKey) {
              // Obtener contexto del negocio para análisis más relevante
              const assistantForContext = await prisma.assistant.findFirst({ 
                where: { userId: userIdTemp, isActive: true }, 
                select: { businessInfo: true, context: true } 
              });
              const bizContext = assistantForContext?.businessInfo || assistantForContext?.context || '';
              
              const imageDescription = await analyzeImageWithVision(
                downloaded.buffer, 
                downloaded.mimetype, 
                userForVision.apiKey,
                bizContext.substring(0, 500) // Limitar contexto
              );
              
              if (imageDescription) {
                const caption = media.caption ? ` (caption: "${media.caption}")` : '';
                body = `[El cliente envió una imagen${caption}. Contenido de la imagen: ${imageDescription}]`;
                log(`👁️ Imagen analizada: "${imageDescription.substring(0, 100)}"`);
              } else {
                if (!body && media.caption) body = media.caption;
                if (!body) body = '📷 [Imagen enviada por el cliente - no se pudo analizar]';
              }
            } else {
              if (!body && media.caption) body = media.caption;
              if (!body) body = '📷 [Imagen - sin API key para analizar]';
            }
          } else {
            if (!body && media.caption) body = media.caption;
            if (!body) body = '📷 [Imagen]';
          }
        } else {
          if (!body && media.caption) body = media.caption;
          if (!body) body = '📷 [Imagen - no se pudo descargar]';
        }
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
    // 🔑 Para @lid: resolver a número real via WAHA API
    let recipientId: string;
    if (isGroup) {
      recipientId = from; // Mantener JID completo del grupo (123456@g.us)
    } else if (isLid) {
      // Resolver LID a número real
      recipientId = await resolveLidToPhone(sessionName, from, payload);
    } else {
      recipientId = from.replace('@c.us', '').replace('@s.whatsapp.net', '').replace(/\D/g, '');
    }
    
    const senderName = isGroup
      ? (participantName || participant.replace('@c.us', '').replace(/\D/g, ''))
      : (notifyName || recipientId);

    // 👥 Para grupos necesitamos resolver el usuario por la sesión, no por el participante
    const participantClean = isGroup 
      ? participant.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '')
      : recipientId.replace(/\D/g, '');
    
    const userId = await resolveUserFromWebhook(sessionName, participantClean);
    if (!userId) { res.status(400).json({ error: 'No user' }); return; }

    // 🔗 Buscar whatsappLineId por sessionName
    const waLine = await prisma.whatsappLine.findUnique({ where: { sessionName } }).catch(() => null);
    const whatsappLineId = waLine?.id || null;

    log(`💬 ${isGroup ? '👥' : '👤'} ${senderName} (${recipientId}) → session: ${sessionName} line: ${whatsappLineId || 'none'} ${savedMediaType ? `[${savedMediaType}]` : ''}`);

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
      // 🔑 LID MIGRATION: Also search by LID number if we resolved a phone
      if (!conv && isLid) {
        const lidClean = from.replace('@lid', '').replace(/\D/g, '');
        conv = await prisma.conversation.findFirst({ where: { userId, recipientId: lidClean, whatsappLineId } });
        if (!conv) {
          conv = await prisma.conversation.findFirst({ where: { userId, recipientId: { contains: lidClean.slice(-10) }, whatsappLineId } });
        }
        if (!conv) {
          // Try with LID_ prefix
          conv = await prisma.conversation.findFirst({ where: { userId, recipientId: { startsWith: 'LID_' }, whatsappLineId } });
        }
      }
    } else {
      // Sin línea: buscar conversación global (legacy)
      conv = await prisma.conversation.findFirst({ where: { userId, recipientId, whatsappLineId: null } });
      if (!conv && recipientId.length >= 10) {
        const last10 = recipientId.slice(-10);
        conv = await prisma.conversation.findFirst({ where: { userId, recipientId: { endsWith: last10 }, whatsappLineId: null } });
      }
      // 🔑 LID MIGRATION for legacy
      if (!conv && isLid) {
        const lidClean = from.replace('@lid', '').replace(/\D/g, '');
        conv = await prisma.conversation.findFirst({ where: { userId, recipientId: lidClean } });
        if (!conv) conv = await prisma.conversation.findFirst({ where: { userId, recipientId: { contains: lidClean.slice(-10) } } });
      }
    }

    // 🔑 AUTO-MIGRATE: If conv has old LID_ prefixed number, update it
    if (conv && !isGroup && isLid && !recipientId.startsWith('LID_')) {
      const oldId = conv.recipientId;
      if (oldId.startsWith('LID_')) {
        const newId = oldId.replace('LID_', '');
        await prisma.conversation.update({ where: { id: conv.id }, data: { recipientId: newId } }).catch(() => {});
        log(`🔑 AUTO-MIGRADO: ${oldId} → ${newId} (eliminado prefijo LID_)`);
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
      log(`🆕 ${isGroup ? 'Grupo' : 'Conversación'} creada: ${isGroup ? groupSubject : senderName} (línea: ${whatsappLineId || 'global'})`);
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
        log(`👥 Grupo ${conv.groupName}: IA deshabilitada, mensaje guardado`);
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
                            messageLower.includes('@bizonne') || 
                            messageLower.includes('bizonne') ||
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
        log(`👥 Grupo ${conv.groupName}: No responde (modo: ${respondTo})`);
        res.json({ success: true }); return;
      }

      log(`👥 Grupo ${conv.groupName}: IA RESPONDE (modo: ${respondTo})`);
    }

    // ⏸️ COMANDO ".." = PAUSAR IA — inmediato
    if (body.trim() === '..') {
      await prisma.conversation.update({ where: { id: conv.id }, data: { aiPaused: true } });
      await prisma.message.create({ data: { conversationId: conv.id, content: isGroup ? `[${senderName}]: ${body}` : body, fromMe: false, userId, role: 'user' } });
      await setPresence(sessionName, from, 'typing');
      await new Promise(r => setTimeout(r, 1000));
      await stopPresence(sessionName, from);
      const pauseMsg = '🙋‍♂️ Te conecto con un asesor humano. En un momento te atienden.';
      await unifiedSendText(sessionName, from, pauseMsg, whatsappLineId);
      await prisma.message.create({ data: { conversationId: conv.id, content: pauseMsg, fromMe: true, userId, role: 'assistant' } });
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: pauseMsg } });
      log(`⏸️ IA PAUSADA → ${senderName}`);
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
        await unifiedSendText(sessionName, from, resumeMsg, whatsappLineId);
        await prisma.message.create({ data: { conversationId: conv.id, content: resumeMsg, fromMe: true, userId, role: 'assistant' } });
        await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: resumeMsg } });
        log(`▶️ IA REACTIVADA → ${senderName}`);
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
      clog(`⏸️ IA pausada → ${senderName} (guardado, no responde)`);
      res.json({ success: true }); return;
    }

    // Para la IA, usar la transcripción limpia
    // En grupos: incluir quién envió para que la IA sepa a quién responder
    const messageForAI = isGroup ? `[${senderName}]: ${body}` : body;

    // ====================================================
    // 📦 INTELLIGENT BURST HANDLER — Ráfagas inteligentes
    // Timing adaptativo + detección de fragmentos + combinación inteligente
    // ====================================================
    const bufferKey = isGroup ? `${userId}_group_${from}` : `${userId}_${recipientId}`;
    const existingBuffer = messageBuffer.get(bufferKey);
    const isLocked = processingLock.has(bufferKey);
    const now = Date.now();
    const isMediaMsg = !!savedMediaUrl;

    if (existingBuffer) {
      // Ya hay mensajes en buffer → agregar con timing adaptativo
      existingBuffer.messages.push(messageForAI);
      existingBuffer.lastTimestamp = now;
      if (isMediaMsg) existingBuffer.hasMedia = true;
      clearTimeout(existingBuffer.timer);
      
      // 🧠 Timing inteligente: si es fragmento, esperar más; si es completo, menos
      const delay = getSmartDelay(messageForAI, existingBuffer.messages.length, existingBuffer.firstTimestamp);
      existingBuffer.timer = setTimeout(() => processBufferedMessages(bufferKey), delay);
      log(`📦 Ráfaga: +1 de ${senderName} (total: ${existingBuffer.messages.length}, espera: ${(delay/1000).toFixed(1)}s${isFragment(messageForAI) ? ' [fragmento]' : ''})`);
    } else if (isLocked) {
      // 🔒 IA procesando → guardar SIN timer (el finally del proceso actual lo recoge)
      messageBuffer.set(bufferKey, {
        messages: [messageForAI], timer: null as any, sessionName, from, senderName, userId,
        convId: conv.id, whatsappLineId,
        firstTimestamp: now, lastTimestamp: now, hasMedia: isMediaMsg
      });
      clog(`🔒 Ráfaga (lock): ${senderName} → guardado, se procesará al terminar IA`);
    } else {
      // Primer mensaje → crear buffer con timing adaptativo
      // Buscar asistente para verificar modo voz
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

      // 🧠 Primer mensaje: si parece fragmento o media, esperar más
      const delay = getSmartDelay(messageForAI, 0, now);
      const timer = setTimeout(() => processBufferedMessages(bufferKey), delay);
      messageBuffer.set(bufferKey, {
        messages: [messageForAI], timer, sessionName, from, senderName, userId,
        convId: conv.id, whatsappLineId,
        firstTimestamp: now, lastTimestamp: now, hasMedia: isMediaMsg
      });
      log(`📦 Ráfaga: nuevo de ${senderName} → espera inteligente ${(delay/1000).toFixed(1)}s${isFragment(messageForAI) ? ' [fragmento detectado]' : ''}`);
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

    const jwt = require('jsonwebtoken');
    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'bizonne-secret-2024') as any;
    } catch (e) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    
    const userId = decoded.userId || decoded.id || decoded.sub;
    if (!userId) return res.status(401).json({ error: 'Token sin userId' });

    const ownerId = await getOwnerId(userId);
    const { lineId } = req.body;

    // Cargar etapas configuradas de la línea
    let configuredStages: string[] = [];
    if (lineId) {
      const line = await prisma.whatsappLine.findFirst({
        where: { id: lineId, userId: ownerId },
        select: { customStages: true }
      });
      if (line?.customStages && Array.isArray(line.customStages)) {
        configuredStages = (line.customStages as any[]).map(s => s.id || s.label);
      }
    }

    // Obtener conversaciones
    const whereClause: any = { userId: ownerId };
    if (lineId) whereClause.whatsappLineId = lineId;

    const conversations = await prisma.conversation.findMany({
      where: whereClause,
      select: { id: true, stage: true, contextData: true, lastMessage: true }
    });

    // ⚡ BATCH: Acumular todas las actualizaciones
    const updates: { id: string; data: any }[] = [];

    for (const conv of conversations) {
      const ctx = (conv.contextData as any) || {};
      
      // PRIORIDAD 1: Si la IA ya detectó una etapa en contextData
      if (ctx.etapa_actual && ctx.etapa_actual !== '') {
        const iaStage = ctx.etapa_actual.trim();
        
        const isValid = configuredStages.length === 0 || configuredStages.some(s => 
          s === iaStage || 
          s.toLowerCase().trim() === iaStage.toLowerCase().trim() ||
          s.toLowerCase().trim().includes(iaStage.toLowerCase().trim()) ||
          iaStage.toLowerCase().trim().includes(s.toLowerCase().trim())
        );
        
        if (isValid && iaStage !== conv.stage) {
          const exactStage = configuredStages.find(s => 
            s.toLowerCase().trim() === iaStage.toLowerCase().trim()
          ) || configuredStages.find(s =>
            s.toLowerCase().trim().includes(iaStage.toLowerCase().trim()) ||
            iaStage.toLowerCase().trim().includes(s.toLowerCase().trim())
          ) || iaStage;
          
          updates.push({ id: conv.id, data: { stage: exactStage } });
        } else if (!isValid) {
          const cleanCtx = { ...ctx };
          delete cleanCtx.etapa_actual;
          updates.push({ id: conv.id, data: { contextData: cleanCtx, stage: conv.stage || configuredStages[0] || 'new' } });
        }
        continue;
      }
      
      // PRIORIDAD 2: Solo si NO hay etapa_actual, aplicar reglas básicas
      if (configuredStages.length === 0) continue;
      
      let newStage = conv.stage || configuredStages[0];
      
      const lastMsg = (conv.lastMessage || '').toLowerCase();
      const isPerdido = lastMsg.includes('no me interesa') || 
                        lastMsg.includes('no gracias') || 
                        lastMsg.includes('ya no quiero') ||
                        lastMsg.includes('cancelar');

      const hasAnyData = ctx.nombre || ctx.direccion || ctx.total || ctx.cantidad;
      
      if (isPerdido) {
        newStage = configuredStages.find(s => s.toLowerCase().includes('perdido')) || configuredStages[configuredStages.length - 1];
      } else if (ctx.pedido === 'creado' || ctx.fecha_entrega || ctx.cita === 'creada') {
        newStage = configuredStages.find(s => s.toLowerCase().includes('confirmado') || s.toLowerCase().includes('cerrado') || s.toLowerCase().includes('completado')) || configuredStages[configuredStages.length - 2] || configuredStages[configuredStages.length - 1];
      } else if (hasAnyData && ctx.direccion) {
        newStage = configuredStages.find(s => s.toLowerCase().includes('pedido') || s.toLowerCase().includes('orden')) || configuredStages[Math.min(Math.floor(configuredStages.length * 0.7), configuredStages.length - 1)];
      } else if (hasAnyData) {
        newStage = configuredStages.find(s => s.toLowerCase().includes('cotiza') || s.toLowerCase().includes('negoci') || s.toLowerCase().includes('propuesta')) || configuredStages[Math.min(Math.floor(configuredStages.length * 0.4), configuredStages.length - 1)];
      } else if (conv.lastMessage && conv.lastMessage.length > 20) {
        newStage = configuredStages.find(s => s.toLowerCase().includes('interesado') || s.toLowerCase().includes('contacto')) || configuredStages[Math.min(1, configuredStages.length - 1)];
      }

      if (newStage !== conv.stage) {
        updates.push({ id: conv.id, data: { stage: newStage } });
      }
    }

    // ⚡ BATCH UPDATE: Ejecutar todas las actualizaciones en paralelo (máx 20 a la vez)
    let updated = 0;
    if (updates.length > 0) {
      const batchSize = 20;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        await Promise.all(
          batch.map(u => prisma.conversation.update({ where: { id: u.id }, data: u.data }))
        );
        updated += batch.length;
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

    // Cargar etapas configuradas de la línea (NO hardcodeadas)
    let pipelineStages: any[] = [];
    if (lineId) {
      const line = await prisma.whatsappLine.findFirst({
        where: { id: lineId, userId: ownerId },
        select: { customStages: true }
      });
      if (line?.customStages && Array.isArray(line.customStages)) {
        pipelineStages = line.customStages as any[];
      }
    }
    
    if (pipelineStages.length === 0) {
      return res.status(400).json({ error: 'No hay etapas configuradas. Configura tu asistente IA primero.' });
    }

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

    log(`🔄 Analizando ${conversations.length} conversaciones...`);

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

        // Prompt para detectar etapa - Dinámico según etapas configuradas
        const prompt = `Analiza esta conversación de WhatsApp y determina la etapa del pipeline de ventas.

ETAPAS DISPONIBLES: ${stagesList}

INSTRUCCIONES:
- Analiza el contenido de la conversación para determinar en qué etapa se encuentra el cliente.
- Usa el contexto de los mensajes para inferir la etapa correcta.
- Si el cliente dijo "no me interesa", "no gracias", "cancelar" o dejó de responder, asigna la última etapa (generalmente la de abandono/pérdida).
- Si el cliente confirmó una compra, cita o servicio, asigna la etapa de confirmación.
- Si el cliente está preguntando precios o información, asigna una etapa intermedia.
- Si solo saludó, asigna la primera etapa.

CONVERSACIÓN:
${history}

Responde SOLO con el nombre exacto de una de las etapas listadas arriba. Nada más.`;

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
              log(`✅ ${conv.recipientName || conv.recipientId}: ${validStage.id}`);
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

    log(`🎯 Análisis completado: ${updated} actualizadas, ${errors} errores`);

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

// ====================================================
// 🔄 WAHA SYNC CRON — Auto-detect disconnected sessions
// Runs every 10 minutes
// ====================================================
export const startWahaSyncCron = () => {
  const syncSessions = async () => {
    try {
      const lines = await prisma.whatsappLine.findMany({
        where: { status: { not: 'disconnected' }, connectionType: { not: 'cloud_api' } }
      });

      for (const line of lines) {
        try {
          const r = await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}`, {
            headers: getWahaHeaders()
          });

          if (r.ok) {
            const data = await r.json() as any;
            const wahaStatus = data.status;
            const newStatus = ['WORKING', 'CONNECTED'].includes(wahaStatus) ? 'connected' : 'disconnected';
            // WEBJS: Extract real phone from me.id (e.g. "573115184512@c.us")
            const mePhone = data.me?.id?.replace('@c.us', '').replace('@s.whatsapp.net', '') || null;
            const updateData: any = { status: newStatus };
            if (mePhone && !line.phone) updateData.phone = mePhone;
            if (newStatus !== line.status || (mePhone && !line.phone)) {
              await prisma.whatsappLine.update({
                where: { id: line.id },
                data: updateData
              });
              console.log(`🔄 Línea ${mePhone || line.phone || line.sessionName}: ${line.status} → ${newStatus}${mePhone && !line.phone ? ` (phone: ${mePhone})` : ''}`);
            }
          } else {
            // Session doesn't exist in WAHA → mark disconnected
            await prisma.whatsappLine.update({
              where: { id: line.id },
              data: { status: 'disconnected' }
            });
            console.log(`🔄 Línea ${line.phone || line.sessionName}: ${line.status} → disconnected (sesión no existe)`);
          }
        } catch {
          // Network error, skip this line
        }
      }
    } catch (e: any) {
      console.error('🔄 Error sync WAHA:', e.message);
    }
  };

  setInterval(syncSessions, 600_000); // Every 10 minutes — reduces egress by 80%
  setTimeout(syncSessions, 30_000); // First run after 30s
  console.log('🔄 WAHA sync: every 10min (auto-detect disconnects)');
};

// ====================================================
// ☁️ CLOUD API WEBHOOK — Verification (GET)
// ====================================================
router.get('/webhook-cloud', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  console.log(`☁️ [CLOUD VERIFY] mode=${mode} token=${token ? token.toString().substring(0, 10) + '...' : 'null'} challenge=${challenge ? 'yes' : 'no'}`);
  
  if (mode === 'subscribe' && token && challenge) {
    prisma.whatsappLine.findFirst({ where: { cloudWebhookVerifyToken: token as string } })
      .then(line => {
        if (line) { log(`☁️ Webhook verificado: ${line.label}`); res.status(200).send(challenge); }
        else { console.error(`❌ Verify token no reconocido`); res.status(403).send('Forbidden'); }
      }).catch(() => res.status(500).send('Error'));
  } else {
    res.status(400).send('Bad Request');
  }
});

// ====================================================
// ☁️ CLOUD API WEBHOOK — Messages (POST)
// ====================================================
router.post('/webhook-cloud', async (req: Request, res: Response) => {
  try {
    res.status(200).json({ success: true }); // Respond fast to Meta
    
    const body = req.body;
    if (!body?.entry?.[0]?.changes?.[0]?.value) return;
    const value = body.entry[0].changes[0].value;
    const phoneNumberId = value.metadata?.phone_number_id;
    if (!phoneNumberId) return;
    
    const msgCount = value.messages?.length || 0;
    const statusCount = value.statuses?.length || 0;
    
    // Solo loggear cuando hay mensajes (no status de lectura)
    if (msgCount > 0) {
      console.log(`☁️ [CLOUD] Phone: ${phoneNumberId} | Mensajes: ${msgCount}`);
    }
    // Status de error sí se loggean
    const failedStatuses = (value.statuses || []).filter((s: any) => s.status === 'failed');
    if (failedStatuses.length > 0) {
      console.log(`☁️ [CLOUD] ⚠️ ${failedStatuses.length} status(es) fallidos`);
    }
    
    // Si solo son statuses normales (delivered/read), procesar silenciosamente
    if (msgCount === 0 && failedStatuses.length === 0) {
      // Solo procesar failed statuses, ignorar read/delivered silenciosamente
      return;
    }
    
    const line = await prisma.whatsappLine.findFirst({
      where: { cloudPhoneNumberId: phoneNumberId, connectionType: 'cloud_api' }
    });
    if (!line) { console.warn(`☁️ [CLOUD] ❌ Línea NO encontrada para phoneNumberId: ${phoneNumberId}`); return; }
    
    if (msgCount > 0) console.log(`☁️ [CLOUD] ✅ Línea: ${line.label} → ${msgCount} mensaje(s)`);
    
    const userId = line.userId;
    const whatsappLineId = line.id;
    const sessionName = line.sessionName;
    
    // Process statuses
    for (const status of (value.statuses || [])) {
      if (status.status === 'failed') {
        console.log(`☁️ [CLOUD] Msg falló → ${status.recipient_id}: ${status.errors?.[0]?.message || 'Unknown'}`);
      }
    }
    
    // Process messages
    for (const msg of (value.messages || [])) {
      const from = msg.from;
      const msgType = msg.type;
      const msgId = msg.id;
      
      console.log(`☁️ [CLOUD] 📩 Mensaje de ${from} | tipo: ${msgType} | id: ${msgId}`);
      
      if (msgId && recentlyProcessed.has(msgId)) { console.log(`☁️ [CLOUD] ⏭️ Duplicado, ignorando`); continue; }
      if (msgId) { recentlyProcessed.add(msgId); setTimeout(() => recentlyProcessed.delete(msgId), 60000); }
      
      // Mark read
      if (line.cloudAccessToken) markCloudRead(phoneNumberId, line.cloudAccessToken, msgId);
      
      // Get contact name
      const contact = (value.contacts || []).find((c: any) => c.wa_id === from);
      const senderName = contact?.profile?.name || from;
      
      // ❌ fromMe detection (Cloud API: messages from business are NOT in webhook, only customer msgs)
      // So all messages here are from customers → proceed
      
      let messageBody = '';
      let savedMediaType: string | null = null;
      let savedMediaUrl: string | null = null;
      
      if (msgType === 'text') {
        messageBody = msg.text?.body || '';
      } else if (['image', 'video', 'audio', 'document'].includes(msgType)) {
        const caption = msg[msgType]?.caption || '';
        messageBody = caption;
        savedMediaType = msgType;
        const mediaId = msg[msgType]?.id;
        if (mediaId && line.cloudAccessToken) {
          try {
            const mediaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
              headers: { 'Authorization': `Bearer ${line.cloudAccessToken}` }
            });
            if (mediaRes.ok) { savedMediaUrl = ((await mediaRes.json()) as any).url || null; }
          } catch {}
        }
        // Audio transcription
        if (msgType === 'audio' && savedMediaUrl && line.cloudAccessToken) {
          try {
            const audioRes = await fetch(savedMediaUrl, { headers: { 'Authorization': `Bearer ${line.cloudAccessToken}` } });
            if (audioRes.ok) {
              const audioBuf = Buffer.from(await audioRes.arrayBuffer());
              const owner = await prisma.user.findUnique({ where: { id: userId }, select: { apiKey: true } });
              const apiKey = owner?.apiKey || process.env.OPENAI_API_KEY;
              if (apiKey) { const t = await transcribeAudio(audioBuf, apiKey); if (t) messageBody = t; }
            }
          } catch {}
        }
        // 👁️ Image Vision analysis
        if (msgType === 'image' && savedMediaUrl && line.cloudAccessToken) {
          try {
            const imgRes = await fetch(savedMediaUrl, { headers: { 'Authorization': `Bearer ${line.cloudAccessToken}` } });
            if (imgRes.ok) {
              const imgBuf = Buffer.from(await imgRes.arrayBuffer());
              const owner = await prisma.user.findUnique({ where: { id: userId }, select: { apiKey: true } });
              const apiKey = owner?.apiKey || process.env.OPENAI_API_KEY;
              if (apiKey) {
                const assistantCtx = await prisma.assistant.findFirst({ where: { userId, isActive: true }, select: { businessInfo: true, context: true } });
                const bizCtx = assistantCtx?.businessInfo || assistantCtx?.context || '';
                const desc = await analyzeImageWithVision(imgBuf, imgRes.headers.get('content-type') || 'image/jpeg', apiKey, bizCtx.substring(0, 500));
                if (desc) {
                  const cap = caption ? ` (caption: "${caption}")` : '';
                  messageBody = `[El cliente envió una imagen${cap}. Contenido: ${desc}]`;
                  log(`☁️ 👁️ Cloud imagen analizada: "${desc.substring(0, 100)}"`);
                }
              }
            }
          } catch (vErr: any) { log(`☁️ ⚠️ Vision error: ${vErr.message}`); }
        }
      } else if (msgType === 'location') {
        messageBody = `📍 Ubicación: ${msg.location?.latitude}, ${msg.location?.longitude}`;
      } else if (msgType === 'contacts') {
        const c = msg.contacts?.[0];
        messageBody = `👤 Contacto: ${c?.name?.formatted_name || 'Sin nombre'} - ${c?.phones?.[0]?.phone || ''}`;
      } else if (msgType === 'sticker') {
        messageBody = '🏷️ Sticker';
      } else if (msgType === 'reaction') { continue; }
      else { messageBody = `[${msgType}]`; }
      
      if (!messageBody && !savedMediaType) continue;
      if (!messageBody && savedMediaType === 'image') messageBody = '📷 [Imagen enviada por el cliente]';
      if (!messageBody && savedMediaType === 'video') messageBody = '🎬 [Video recibido]';
      if (!messageBody && savedMediaType) messageBody = `📎 [${savedMediaType}]`;
      
      const recipientId = from.replace(/\D/g, '');
      
      // Find or create conversation
      let conv = await prisma.conversation.findFirst({ where: { userId, recipientId, whatsappLineId } });
      if (!conv) conv = await prisma.conversation.findFirst({ where: { userId, recipientId: { endsWith: recipientId.slice(-10) }, whatsappLineId } });
      if (!conv) {
        conv = await prisma.conversation.create({
          data: { userId, recipientId, recipientName: senderName, lastMessage: messageBody, stage: 'new', whatsappLineId }
        });
        console.log(`☁️ [CLOUD] 🆕 Nueva conversación creada: ${senderName} (${recipientId}) → convId: ${conv.id}`);
      } else {
        console.log(`☁️ [CLOUD] 📂 Conversación existente: ${conv.id} (${recipientId})`);
      }
      
      // Save message
      const displayContent = savedMediaType === 'audio' ? `🎤 ${messageBody}` : messageBody;
      await prisma.message.create({
        data: {
          conversationId: conv.id, content: displayContent || '[Media]', fromMe: false,
          userId, role: 'user',
          ...(savedMediaType && { mediaType: savedMediaType }),
          ...(savedMediaUrl && { mediaUrl: savedMediaUrl })
        }
      });
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: displayContent, recipientName: senderName } });
      console.log(`☁️ [CLOUD] ✅ Mensaje guardado: "${displayContent?.substring(0, 50)}" → conv: ${conv.id}`);
      
      if (conv.aiPaused) { clog(`☁️ ⏸️ IA pausada → ${senderName} (Cloud)`); continue; }
      
      // Pause/Resume commands
      if (messageBody.trim() === '0') {
        await prisma.conversation.update({ where: { id: conv.id }, data: { aiPaused: true } });
        const pauseMsg = '🙋‍♂️ Te conecto con un asesor humano. En un momento te atienden.';
        if (line.cloudAccessToken) await sendCloudText(phoneNumberId, line.cloudAccessToken, recipientId, pauseMsg);
        await prisma.message.create({ data: { conversationId: conv.id, content: pauseMsg, fromMe: true, userId, role: 'assistant' } });
        continue;
      }
      if (messageBody.trim() === '.') {
        if (conv.aiPaused) {
          await prisma.conversation.update({ where: { id: conv.id }, data: { aiPaused: false } });
          const resumeMsg = '🤖 ¡Hola de nuevo! Soy tu asistente virtual. ¿En qué puedo ayudarte?';
          if (line.cloudAccessToken) await sendCloudText(phoneNumberId, line.cloudAccessToken, recipientId, resumeMsg);
          await prisma.message.create({ data: { conversationId: conv.id, content: resumeMsg, fromMe: true, userId, role: 'assistant' } });
        }
        continue;
      }
      
      // 📦 Intelligent burst handler for Cloud API
      const bufferKey = `${userId}_${recipientId}`;
      const existingBuffer = messageBuffer.get(bufferKey);
      const chatIdForSend = `${recipientId}@c.us`;
      const now = Date.now();
      
      if (existingBuffer) {
        existingBuffer.messages.push(messageBody);
        existingBuffer.lastTimestamp = now;
        clearTimeout(existingBuffer.timer);
        const delay = getSmartDelay(messageBody, existingBuffer.messages.length, existingBuffer.firstTimestamp);
        existingBuffer.timer = setTimeout(() => processBufferedMessages(bufferKey), delay);
        clog(`☁️ 📦 Buffer Cloud: +1 de ${senderName} (total: ${existingBuffer.messages.length}, espera: ${(delay/1000).toFixed(1)}s)`);
      } else if (processingLock.has(bufferKey)) {
        // 🔒 IA procesando → guardar SIN timer (el finally lo recoge)
        messageBuffer.set(bufferKey, {
          messages: [messageBody], timer: null as any, sessionName,
          from: chatIdForSend, senderName, userId,
          convId: conv.id, whatsappLineId,
          firstTimestamp: now, lastTimestamp: now, hasMedia: false
        });
        clog(`☁️ 🔒 Lock activo → "${messageBody.substring(0, 50)}" de ${senderName} guardado (se procesará al terminar IA)`);
      } else {
        const delay = getSmartDelay(messageBody, 0, now);
        const timer = setTimeout(() => processBufferedMessages(bufferKey), delay);
        messageBuffer.set(bufferKey, {
          messages: [messageBody], timer, sessionName,
          from: chatIdForSend, senderName, userId,
          convId: conv.id, whatsappLineId,
          firstTimestamp: now, lastTimestamp: now, hasMedia: false
        });
        clog(`☁️ 📦 Buffer Cloud: nuevo de ${senderName} → espera ${(delay/1000).toFixed(1)}s (bufferKey: ${bufferKey})`);
      }
    }
  } catch (e: any) {
    console.error('☁️ Cloud webhook error:', e.message);
  }
});

export default router;

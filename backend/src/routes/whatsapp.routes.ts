import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getOwnerId } from '../lib/helpers';
import { lidPhoneCache, apiKeyErrorCache, recentlyProcessed, recentlySentFromPlatform, processingLock, wamidCache } from '../lib/cache';
import { AuthRequest } from '../middleware/auth.middleware';
import { sendPushToUser } from './push.routes';
import { isColombianHoliday, getUpcomingHolidays, getHolidaySummaryForAI } from './colombian-holidays';
// 🌍 NOTE: Holiday detection is Colombia-specific by default.
// For other countries, users can configure holidays in their business schedule (dayOfWeek=7 → holidays).

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
  // WAHA (webhooks rápidos, conexión directa)
  INITIAL_WAIT_MS: 3000,      // Primera espera: 3s
  CONTINUE_WAIT_MS: 2000,     // Mensajes adicionales: 2s
  FRAGMENT_WAIT_MS: 4000,     // Fragmentos: 4s
  // CLOUD API (Meta webhooks con delay 2-6s entre entregas del mismo segundo)
  CLOUD_INITIAL_WAIT_MS: 7000,  // Primera espera Cloud: 7s (Meta tarda hasta 6s)
  CLOUD_CONTINUE_WAIT_MS: 4000, // Adicionales Cloud: 4s
  CLOUD_FRAGMENT_WAIT_MS: 6000, // Fragmentos Cloud: 6s
  // Límites globales
  MAX_WAIT_MS: 25000,         // Máximo absoluto: 25s
  MAX_MESSAGES: 10,           // Máximo mensajes en ráfaga
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
const getSmartDelay = (msg: string, messageCount: number, firstTimestamp: number, isCloud: boolean = false): number => {
  const elapsed = Date.now() - firstTimestamp;
  const remaining = BURST_CONFIG.MAX_WAIT_MS - elapsed;
  
  // Si ya pasó el máximo, procesar inmediatamente
  if (remaining <= 0) return 50;
  
  // Si ya alcanzó el máximo de mensajes, procesar pronto
  if (messageCount >= BURST_CONFIG.MAX_MESSAGES) return 200;
  
  let delay: number;
  
  if (messageCount === 0) {
    delay = isCloud ? BURST_CONFIG.CLOUD_INITIAL_WAIT_MS : BURST_CONFIG.INITIAL_WAIT_MS;
  } else if (isFragment(msg)) {
    delay = isCloud ? BURST_CONFIG.CLOUD_FRAGMENT_WAIT_MS : BURST_CONFIG.FRAGMENT_WAIT_MS;
  } else {
    delay = isCloud ? BURST_CONFIG.CLOUD_CONTINUE_WAIT_MS : BURST_CONFIG.CONTINUE_WAIT_MS;
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

// 🕐 Helper: "14:00" → "2:00 PM"
const to12h = (time: string): string => {
  if (!time) return '';
  const parts = time.match(/(\d{1,2}):(\d{2})/);
  if (!parts) return time;
  let h = parseInt(parts[1]); const m = parts[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12; if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
};

// ====================================================
// 🌍 TIMEZONE HELPER — Genérico para cualquier país/zona
// El servidor corre en UTC. SIEMPRE usar getNowColombia() con TZ del usuario.
// ====================================================
const COLOMBIA_TZ = 'America/Bogota'; // Default para usuarios sin TZ configurada

/** Obtiene fecha/hora en la zona horaria especificada (o Colombia por defecto) */
const getNowColombia = (tz?: string): Date => {
  return new Date(new Date().toLocaleString('en-US', { timeZone: tz || COLOMBIA_TZ }));
};

/** Obtiene la fecha actual como string YYYY-MM-DD en la zona horaria dada */
const getTodayStringColombia = (tz?: string): string => {
  const col = getNowColombia(tz);
  return `${col.getFullYear()}-${String(col.getMonth() + 1).padStart(2, '0')}-${String(col.getDate()).padStart(2, '0')}`;
};

/** Formatea fecha bonita en la zona horaria del negocio */
const formatDateColombia = (date?: Date, tz?: string): string => {
  const d = date || new Date();
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz || COLOMBIA_TZ });
};

/** Formatea hora bonita en la zona horaria del negocio */
const formatTimeColombia = (date?: Date, tz?: string): string => {
  const d = date || new Date();
  return d.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz || COLOMBIA_TZ });
};

// 📅 Helper: Parsear fecha inteligente — "viernes", "mañana", "13 de marzo", "2025-03-07"
/**
 * Converts a Colombia-adjusted Date to a UTC Date that Prisma stores correctly.
 * Ensures the date falls within getColombiaDayRange for the correct Colombia day.
 * Stores at 12:00 UTC (7AM Colombia) — safely within the day range.
 */
const toStorableDate = (colombiaDate: Date): Date => {
  // Extract the Colombia year/month/day (works on UTC servers because getNowColombia shifts the clock)
  const y = colombiaDate.getFullYear();
  const m = colombiaDate.getMonth();
  const d = colombiaDate.getDate();
  // Return noon UTC of that date — safely inside getColombiaDayRange (05:00 UTC to 04:59 next day)
  return new Date(Date.UTC(y, m, d, 12, 0, 0));
};

const parseSmartDate = (fechaStr: string, tz?: string): Date => {
  const today = getNowColombia(tz);
  if (!fechaStr) return toStorableDate(today);
  const f = fechaStr.toLowerCase().trim();

  // Relativas
  if (f.includes('hoy')) return toStorableDate(new Date(today));
  if (f.includes('mañana') || f.includes('manana')) { const d = new Date(today); d.setDate(d.getDate() + 1); return toStorableDate(d); }
  if (f.includes('pasado')) { const d = new Date(today); d.setDate(d.getDate() + 2); return toStorableDate(d); }

  // Días de la semana: "viernes", "este viernes", "el viernes"
  const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const dayNamesAlt = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  let targetDay = dayNames.findIndex(d => f.includes(d));
  if (targetDay === -1) targetDay = dayNamesAlt.findIndex(d => f.includes(d));
  if (targetDay >= 0) {
    const d = new Date(today);
    const currentDay = today.getDay();
    let daysAhead = targetDay - currentDay;
    if (daysAhead <= 0) daysAhead += 7; // Siempre próximo, nunca pasado
    d.setDate(d.getDate() + daysAhead);
    return toStorableDate(d);
  }

  // "13 de marzo", "5 de febrero"
  const monthNames: Record<string, number> = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
  const dateMatch = f.match(/(\d{1,2})\s*(?:de\s+)?(\w+)/);
  if (dateMatch) {
    const day = parseInt(dateMatch[1]);
    const monthStr = dateMatch[2].toLowerCase();
    if (monthNames[monthStr] !== undefined) {
      const d = new Date(today.getFullYear(), monthNames[monthStr], day);
      if (d < today) d.setFullYear(d.getFullYear() + 1);
      return toStorableDate(d);
    }
  }

  // ISO / formato estándar: "2025-03-07", "03/07/2025"
  const parsed = new Date(fechaStr);
  if (!isNaN(parsed.getTime())) return toStorableDate(parsed);

  return toStorableDate(today); // Fallback
};

// 🕐 Helper: Parsear hora inteligente — "3pm", "15:00", "3:30 PM"
const parseSmartTime = (horaStr: string, defaultTime: string = '10:00'): string => {
  if (!horaStr) return defaultTime;
  const h = horaStr.toLowerCase().trim();
  const timeMatch = h.match(/(\d{1,2})[:\s]*(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const meridian = (timeMatch[3] || '').toLowerCase().replace(/\./g, '');
    if (meridian === 'pm' && hours < 12) hours += 12;
    if (meridian === 'am' && hours === 12) hours = 0;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
  return defaultTime;
};

// 🔔 Helper: Notificar al Asistente Personal cuando se crea algo
const notifyPersonalAssistant = async (ownerId: string, type: 'pedido' | 'cita' | 'reserva', details: { name: string; date: string; time: string; product?: string; total?: string; phone?: string }) => {
  try {
    // Buscar conversaciones con asistente personal activado
    const assistantConvs = await prisma.conversation.findMany({
      where: { userId: ownerId },
      select: { id: true, contextData: true, recipientId: true, whatsappLineId: true }
    });

    const paConvs = assistantConvs.filter(c => {
      const ctx = (c.contextData as Record<string, any>) || {};
      return ctx._isPersonalAssistant === true;
    });

    if (paConvs.length === 0) {
      // Sin asistente personal → enviar Push notification igual
      clog(`ℹ️ Sin asistente personal configurado para ${type}. Push enviado vía sendPushToUser.`);
      return;
    }

    const emojis: Record<string, string> = { pedido: '🛒', cita: '📅', reserva: '🏨' };
    const labels: Record<string, string> = { pedido: 'NUEVO PEDIDO', cita: 'NUEVA CITA', reserva: 'NUEVA RESERVA' };
    
    const msg = `${emojis[type]} *${labels[type]}*\n\n` +
      `👤 *Cliente:* ${details.name}\n` +
      (details.phone ? `📞 *Teléfono:* ${details.phone}\n` : '') +
      `📆 *Fecha:* ${details.date}\n` +
      `🕐 *Hora:* ${details.time}\n` +
      (details.product ? `📦 *Producto:* ${details.product}\n` : '') +
      (details.total ? `💰 *Total:* $${details.total}\n` : '') +
      `\n✅ Registrado en la agenda.`;

    for (const paConv of paConvs) {
      // Guardar como mensaje en la conversación del asistente
      await prisma.message.create({
        data: { conversationId: paConv.id, content: msg, fromMe: true, role: 'assistant', userId: ownerId }
      });
      await prisma.conversation.update({
        where: { id: paConv.id },
        data: { lastMessage: msg, updatedAt: new Date() }
      });

      // Enviar por WhatsApp
      const recipientId = paConv.recipientId;
      const lineId = paConv.whatsappLineId;
      if (recipientId && lineId) {
        const line = await prisma.whatsappLine.findUnique({ where: { id: lineId }, select: { sessionName: true, connectionType: true, cloudPhoneNumberId: true, cloudAccessToken: true } });
        if (line) {
          const isCloud = line.connectionType === 'cloud_api' && line.cloudPhoneNumberId && line.cloudAccessToken;
          const cleanNum = recipientId.replace(/@.*/, '');
          if (isCloud) {
            await sendCloudText(line.cloudPhoneNumberId!, line.cloudAccessToken!, cleanNum, msg);
          } else if (line.sessionName) {
            const chatId = recipientId.includes('@') ? recipientId : `${cleanNum}@c.us`;
            await sendWahaMessage(line.sessionName, chatId, msg);
          }
          clog(`🔔 Asistente Personal notificado: ${type} → ${recipientId}`);
        }
      }
    }
  } catch (err: any) {
    clog(`⚠️ Error notificando asistente personal: ${err.message}`);
  }
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
  isCloud: boolean;            // Cloud API = webhooks lentos de Meta
  previousContext?: string;    // Contexto del batch anterior (para continuaciones)
  quotedContext?: string;      // Mensaje al que el usuario está respondiendo (replied message)
}> = new Map();

// 🛡️ Cache de últimas respuestas enviadas — evita duplicados (30s TTL)
const lastSentResponses = new Map<string, { text: string; ts: number }>();
const LAST_SENT_TTL = 30000;

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
// 🛡️ DEDUP: Evitar enviar la misma imagen/media múltiples veces al mismo chat
const recentlySentMedia: Map<string, number> = new Map(); // key: `convId_mediaName` → timestamp
const MEDIA_DEDUP_TTL = 600000; // 10 minutos

const wasMediaRecentlySent = (convId: string, mediaName: string): boolean => {
  const key = `${convId}_${mediaName.toLowerCase().trim()}`;
  const sent = recentlySentMedia.get(key);
  if (sent && Date.now() - sent < MEDIA_DEDUP_TTL) return true;
  return false;
};

const markMediaSent = (convId: string, mediaName: string) => {
  const key = `${convId}_${mediaName.toLowerCase().trim()}`;
  recentlySentMedia.set(key, Date.now());
  // Limpiar entradas viejas cada 100 entradas
  if (recentlySentMedia.size > 100) {
    const now = Date.now();
    for (const [k, t] of recentlySentMedia) {
      if (now - t > MEDIA_DEDUP_TTL) recentlySentMedia.delete(k);
    }
  }
};

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

const sendCloudText = async (phoneNumberId: string, accessToken: string, to: string, text: string): Promise<{ ok: boolean; wamid?: string }> => {
  try {
    const r = await fetch(`${CLOUD_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/\D/g, ''), type: 'text', text: { body: text } })
    });
    if (r.ok) {
      const data = await r.json().catch(() => ({})) as any;
      const wamid = data?.messages?.[0]?.id || undefined;
      log(`☁️ Cloud texto → ${to}${wamid ? ' [' + wamid.substring(0,20) + ']' : ''}`);
      return { ok: true, wamid };
    }
    console.error(`❌ Cloud sendText (${r.status}): ${(await r.text().catch(() => '')).substring(0, 200)}`);
    return { ok: false };
  } catch (e: any) { console.error('❌ Cloud sendText:', e.message); return { ok: false }; }
};

// ☁️ Enviar respuesta dividida en párrafos (más natural, simula "escribiendo")
const sendCloudSplitMessages = async (phoneNumberId: string, accessToken: string, to: string, fullText: string): Promise<boolean> => {
  // Dividir por doble salto de línea en párrafos
  const paragraphs = fullText.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
  
  // Si es un solo párrafo o muy corto, enviar normal
  if (paragraphs.length <= 1 || fullText.length < 100) {
    return (await sendCloudText(phoneNumberId, accessToken, to, fullText)).ok;
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

const sendCloudMedia = async (phoneNumberId: string, accessToken: string, to: string, media: any, caption?: string): Promise<{ ok: boolean; wamid?: string }> => {
  try {
    const cleanTo = to.replace(/\D/g, '');
    const url = media.url || '';
    const typeMap: Record<string, string> = { image: 'image', video: 'video', audio: 'audio', document: 'document' };
    const cloudType = typeMap[media.type] || 'document';
    const messageBody: any = { messaging_product: 'whatsapp', to: cleanTo, type: cloudType };

    if (url.startsWith('data:')) {
      const match = url.match(/^data:(.+?);base64,(.+)$/s);
      if (!match) return { ok: false };
      const formData = new FormData();
      const buffer = Buffer.from(match[2], 'base64');
      formData.append('file', new Blob([buffer], { type: match[1] }), media.name || 'file');
      formData.append('messaging_product', 'whatsapp');
      formData.append('type', match[1]);
      const uploadRes = await fetch(`${CLOUD_API_URL}/${phoneNumberId}/media`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}` }, body: formData
      });
      if (!uploadRes.ok) { console.error(`❌ Cloud media upload (${uploadRes.status})`); return { ok: false }; }
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
    if (r.ok) {
      const data = await r.json().catch(() => ({})) as any;
      const wamid = data?.messages?.[0]?.id || undefined;
      log(`☁️ Cloud ${media.type} → ${to}${wamid ? ' [' + wamid.substring(0,20) + ']' : ''}`);
      return { ok: true, wamid };
    }
    console.error(`❌ Cloud sendMedia (${r.status}): ${(await r.text().catch(() => '')).substring(0, 200)}`);
    return { ok: false };
  } catch (e: any) { console.error('❌ Cloud sendMedia:', e.message); return { ok: false }; }
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
  if (li?.type === 'cloud_api' && li.pnid && li.token) return (await sendCloudText(li.pnid, li.token, chatId.replace(/@.*/g, ''), text)).ok;
  return sendWahaMessage(sessionName, chatId, text);
};

// 🤖 Para respuestas de IA: divide en párrafos para Cloud API
const unifiedSendAIResponse = async (sessionName: string, chatId: string, text: string, whatsappLineId?: string | null): Promise<{ ok: boolean; wamid?: string }> => {
  const li = await getLineInfo(whatsappLineId);
  if (li?.type === 'cloud_api' && li.pnid && li.token) {
    // Para Cloud API usamos split messages — retorna boolean, pero capturamos wamid del primer chunk
    const r = await sendCloudText(li.pnid, li.token, chatId.replace(/@.*/g, ''), text);
    return r;
  }
  const ok = await sendWahaMessage(sessionName, chatId, text);
  return { ok };
};

const unifiedSendMedia = async (sessionName: string, chatId: string, media: any, caption: string | undefined, whatsappLineId?: string | null): Promise<{ ok: boolean; wamid?: string }> => {
  const li = await getLineInfo(whatsappLineId);
  if (li?.type === 'cloud_api' && li.pnid && li.token) return sendCloudMedia(li.pnid, li.token, chatId.replace(/@.*/g, ''), media, caption);
  return { ok: await sendWahaMedia(sessionName, chatId, media, caption) };
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

const downloadMediaFromWaha = async (session: string, messageId: string, payload?: any, forceFullQuality?: boolean): Promise<{ buffer: Buffer; mimetype: string } | null> => {
  
  // STRATEGY 1a: Base64 data directly in payload.media.data (full quality from WAHA)
  if (payload?.media?.data) {
    try {
      const buf = Buffer.from(payload.media.data, 'base64');
      if (buf.length > 100) {
        log(`✅ S1: Media de payload.media.data: ${buf.length} bytes`);
        return { buffer: buf, mimetype: payload.media.mimetype || payload?.mimetype || 'audio/ogg' };
      }
    } catch (e: any) { log(`⚠️ S1a media.data falló: ${e.message}`); }
  }
  
  // STRATEGY 1b: _data.body — SKIP FOR IMAGES (this is often a low-res thumbnail!)
  if (payload?._data?.body && !forceFullQuality) {
    try {
      const buf = Buffer.from(payload._data.body, 'base64');
      const mime = payload?.mimetype || payload?._data?.mimetype || 'audio/ogg';
      const isImage = mime.startsWith('image/');
      // For images: only use _data.body if it's large enough (>50KB = likely full quality)
      if (buf.length > 100 && (!isImage || buf.length > 50000)) {
        log(`✅ S1b: Media de payload._data.body: ${buf.length} bytes`);
        return { buffer: buf, mimetype: mime };
      } else if (isImage && buf.length <= 50000) {
        log(`⚠️ S1b: Imagen thumbnail detectada (${buf.length} bytes), buscando versión completa...`);
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

// ═══════════════════════════════════════════════════════════════
// 📍 COBERTURA DE DOMICILIO — Cálculo de distancia (Haversine)
// ═══════════════════════════════════════════════════════════════
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Generic: receives biz coords + radius from assistant DB config
function checkCoverageRadius(
  clientLat: number, clientLon: number,
  bizLat: number, bizLon: number, maxKm: number
): { dentro: boolean; distanciaKm: number; mensaje: string } {
  const dist = haversineKm(bizLat, bizLon, clientLat, clientLon);
  const dentro = dist <= maxKm;
  const distStr = dist.toFixed(2);
  const mensaje = dentro
    ? "✅ DENTRO DEL ÁREA DE COBERTURA (" + distStr + " km del negocio — máx " + maxKm + " km). Puedes confirmar el servicio a domicilio."
    : "❌ FUERA DEL ÁREA DE COBERTURA (" + distStr + " km del negocio — máx " + maxKm + " km). Informa al cliente amablemente que está fuera del radio y sugiérele venir al negocio.";
  return { dentro, distanciaKm: parseFloat(distStr), mensaje };
}


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


// ====================================================
// 🖼️ DETECTAR DISEÑO DESDE NOMBRE DE IMAGEN — GENÉRICO
// Funciona para cualquier negocio en la plataforma SaaS
// Convierte "nacional_verde2.jpg" → "Nacional Verde - Opción 2"
// Convierte "masaje_relajante2.jpg" → "Masaje Relajante - Opción 2"
// Convierte "bandeja_paisa1.jpg" → "Bandeja Paisa - Opción 1"
// ====================================================
const parseImageDesign = (imageName: string): string => {
  if (!imageName) return '';

  // Limpiar extensión
  const clean = imageName.replace(/\.(jpg|jpeg|png|webp|gif|avif|bmp)$/i, '');

  // Extraer número al final (diseño/variante/opción)
  const numMatch = clean.match(/(\d+)$/);
  const numero = numMatch ? numMatch[1] : '';

  // Quitar el número final para obtener el nombre base
  const sinNumero = clean.replace(/\d+$/, '').replace(/[_-]$/, '');

  // Convertir snake_case / kebab-case a texto legible
  // "nacional_verde" → "Nacional Verde"
  // "masaje_relajante" → "Masaje Relajante"
  const nombreLegible = sinNumero
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c: string) => c.toUpperCase())
    .trim();

  if (!nombreLegible) return imageName;

  // Si tiene número → agregar "Opción N" (genérico para cualquier negocio)
  if (numero) {
    return `${nombreLegible} - Opción ${numero}`;
  }

  return nombreLegible;
};

const generateAIResponse = async (ownerId: string, message: string, conversationId: string, whatsappLineId?: string | null, quotedContext?: string): Promise<string | null> => {
  try {
    // 🔒 VERIFICAR SUSCRIPCIÓN — No responder si expiró
    const owner = await prisma.user.findUnique({ 
      where: { id: ownerId }, 
      select: { apiKey: true, apiKeyConnected: true, plan: true, trialEndsAt: true, timezone: true } 
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

    const hasModulesLoaded = !!(( assistant as any).modIdentidad || (assistant as any).modReglas || (assistant as any).agenteCliente);
    log(`📋 Asistente: "${assistant.name}" | context: ${assistant.context?.length || 0} chars | módulos: ${hasModulesLoaded ? '✅' : '❌'}`);

    // 🧠 CARGAR CONVERSACIÓN + MEMORIA PERSISTENTE
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { recipientName: true, recipientId: true, stage: true, contextData: true, isGroup: true, groupName: true }
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
        if (client.totalPurchases > 0) parts.push(`Compras previas: ${client.totalPurchases}`);
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

    // 🌍 INYECTAR FECHA Y HORA — usa timezone del usuario (genérico para cualquier país)
    const userTz = (owner as any)?.timezone || 'America/Bogota';
    const nowCol = new Date(new Date().toLocaleString('en-US', { timeZone: userTz }));
    const dayNamesCO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const monthNamesCO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const colDateStr = `${dayNamesCO[nowCol.getDay()]} ${nowCol.getDate()} de ${monthNamesCO[nowCol.getMonth()]} de ${nowCol.getFullYear()}`;
    const colTimeStr = `${nowCol.getHours().toString().padStart(2, '0')}:${nowCol.getMinutes().toString().padStart(2, '0')}`;
    const colHour = nowCol.getHours();
    const colAmPm = colHour >= 12 ? 'PM' : 'AM';
    const colHour12 = colHour === 0 ? 12 : colHour > 12 ? colHour - 12 : colHour;
    const colTime12 = `${colHour12}:${nowCol.getMinutes().toString().padStart(2, '0')} ${colAmPm}`;
    promptParts.push(`📅 FECHA Y HORA ACTUAL (zona: ${userTz}): ${colDateStr}, ${colTime12} (${colTimeStr}). Hoy es ${dayNamesCO[nowCol.getDay()]}. Usa SIEMPRE esta referencia para calcular qué horarios de HOY aún son válidos. Un horario es válido si es al menos 1 hora después de la hora actual. Si el cliente pide "hoy" y hay horarios futuros disponibles → OFRÉCELOS. Solo sugiere mañana si HOY ya no tiene horarios libres futuros.`);

    if (assistant.name) promptParts.push(`Eres ${assistant.name}, un asistente virtual por WhatsApp.`);
    if (assistant.personality?.trim()) promptParts.push(assistant.personality);
    if (assistant.businessInfo?.trim()) promptParts.push(`Info del negocio: ${assistant.businessInfo}`);
    if (assistant.instructions?.trim()) promptParts.push(`Instrucciones especiales: ${assistant.instructions}`);
    
    // 📚 ENSAMBLAR MÓDULOS — Sistema Modular v2 (prioridad) + context legacy (fallback)
    const hasModules = !!(
      (assistant as any).modOrquestador || (assistant as any).agenteCliente ||
      (assistant as any).modIdentidad   || (assistant as any).modReglas ||
      (assistant as any).modProductos   || (assistant as any).modFlujo ||
      (assistant as any).modAcciones    || (assistant as any).modDetector ||
      (assistant as any).modTriggers    || (assistant as any).modCatalogo ||
      (assistant as any).modNlu
    );

    if (hasModules) {
      // ✅ Sistema modular — ensamblar en orden correcto
      const moduleParts: string[] = [];

      const addMod = (label: string, content: string | null | undefined) => {
        if (content?.trim()) moduleParts.push(`--- ${label} ---
${content.trim()}`);
      };

      addMod('ORQUESTADOR (00)',         (assistant as any).modOrquestador);
      addMod('AGENTE_CLIENTE',           (assistant as any).agenteCliente);
      addMod('AGENTE_ADMIN',             (assistant as any).agenteAdmin);
      addMod('IDENTIDAD (01)',           (assistant as any).modIdentidad);
      addMod('REGLAS (02)',               (assistant as any).modReglas);
      addMod('PRODUCTOS (03)',           (assistant as any).modProductos);
      addMod('AGENDA (04)',              (assistant as any).modAgenda);
      addMod('FLUJOS (05)',              (assistant as any).modFlujo);
      addMod('ACCIONES + PIPELINE (06)', (assistant as any).modAcciones);
      addMod('ADMIN (07)',               (assistant as any).modAdmin);
      addMod('ZONAS (08)',               (assistant as any).modZonas);
      addMod('MEMORIA (09)',             (assistant as any).modMemoriaCliente);
      addMod('MÉTRICAS (10)',            (assistant as any).modMetricas);
      addMod('INTENCIONES (11)',         (assistant as any).modDetector);
      addMod('TRIGGERS MULTIMEDIA (12)', (assistant as any).modTriggers);
      addMod('CATÁLOGO (13)',            (assistant as any).modCatalogo);
      addMod('NLU MAP (14)',             (assistant as any).modNlu);
      addMod('MOTOR DE OFERTAS (15)',    (assistant as any).modOfertas);

      if (moduleParts.length > 0) {
        promptParts.push(`=== 📚 BASE DE CONOCIMIENTO Y CONFIGURACIÓN DEL ASISTENTE ===
${moduleParts.join('\n\n')}
=== FIN BASE DE CONOCIMIENTO ===
IMPORTANTE: Todo lo descrito en la Base de Conocimiento es tu guía principal. Síguela al pie de la letra.`);
        log(`🧩 Módulos ensamblados: ${moduleParts.length} módulos activos`);
      }
    } else if (assistant.context?.trim()) {
      // ⚠️ Fallback legacy — contexto único (formato anterior)
      promptParts.push(`=== 📚 BASE DE CONOCIMIENTO Y CONFIGURACIÓN DEL ASISTENTE ===
${assistant.context}
=== FIN BASE DE CONOCIMIENTO ===
IMPORTANTE: Todo lo descrito en la Base de Conocimiento es tu guía principal. Síguela al pie de la letra.`);
    }

    // 🧠 REGLAS DE CONVERSACIÓN NATURAL (anti-repetición)
    promptParts.push(`🚫 ANTI-REPETICIÓN (OBLIGATORIO):
- NUNCA repitas un mensaje que ya enviaste en esta conversación. Lee el historial antes de responder.
- Si ya mostraste un menú de opciones, NO lo repitas. En su lugar, pregunta directamente o reformula diferente.
- Si el cliente no entendió, reformula con OTRAS PALABRAS, no copies lo mismo.
- Sé natural como un humano real por WhatsApp: varía tu lenguaje, no uses frases idénticas dos veces.
- Si ya saludaste, NO saludes de nuevo. Si ya pediste un dato, NO lo pidas de nuevo (a menos que el cliente no lo dio).
- Cada respuesta debe AVANZAR la conversación, nunca retroceder.`);

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
      // Build concrete examples for each trigger
      const triggerExamples = mediaItems.filter(m => m.trigger).map(m => {
        const triggers = m.trigger.split(',').map((t: string) => t.trim()).filter(Boolean);
        const firstTrigger = triggers[0] || '';
        return `  • Para enviar "${m.name}" → escribe literalmente: ${firstTrigger}`;
      }).join('\n');

      if (triggerList) promptParts.push(`\n📸 SISTEMA DE MULTIMEDIA — LEE ESTO CON ATENCIÓN:
Las imágenes se envían AUTOMÁTICAMENTE cuando escribes el trigger EXACTO en tu respuesta.

ARCHIVOS DISPONIBLES:
${triggerList}

CÓMO ACTIVAR UNA IMAGEN (OBLIGATORIO):
${triggerExamples}

REGLAS CRÍTICAS — SIN EXCEPCIÓN:
1. ESCRIBE el trigger EXACTAMENTE como aparece arriba (respeta mayúsculas/minúsculas, guiones, números)
2. El trigger debe aparecer como TEXTO PLANO en tu mensaje — no entre corchetes, no en negritas
3. NUNCA describas la imagen con palabras — escribe el trigger exacto
4. NUNCA inventes URLs ni links de imágenes
5. NUNCA uses formato Markdown ![imagen](url)

EJEMPLO CORRECTO (el trigger activa la imagen automáticamente):
"¡Aquí tienes la opción! 😊
[nombre_del_trigger]
¿Te gusta?"

EJEMPLO INCORRECTO (la imagen NO llega):
"Aquí tienes la Opción 1" ← no escribe el trigger = no llega la imagen`);
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
    // Si no hay etapas por lineId, intentar cargarlas por userId (fallback)
    if (pipelineStages.length === 0 && ownerId) {
      const anyLine = await prisma.whatsappLine.findFirst({
        where: { userId: ownerId, isActive: true },
        select: { customStages: true }
      });
      if (anyLine?.customStages && Array.isArray(anyLine.customStages) && (anyLine.customStages as any[]).length > 0) {
        pipelineStages = anyLine.customStages as any[];
      }
    }
    console.log(`📊 Pipeline: ${pipelineStages.length} etapas lineId:${whatsappLineId || 'none'}`);
    
    // Si no hay etapas configuradas, la IA no detecta etapas automáticamente
    // El usuario debe configurar su asistente con base de conocimiento para activar etapas
    
    const stagesList = pipelineStages.length > 0 
      ? pipelineStages.map((s: any) => s.id || s.label).join(', ')
      : '';

    // 🧠 INSTRUCCIONES DE MEMORIA — Esto le dice a la IA que devuelva un bloque de datos
    // ════════════════════════════════════════════════════════════════════
    // 🧠 MEMORY PROMPT — 100% GENÉRICO, funciona para cualquier negocio
    // La IA aprende el negocio desde la Base de Conocimiento, NO desde aquí
    // ════════════════════════════════════════════════════════════════════
    const stagesBlock = pipelineStages.length > 0 ? `
═══ 📊 ETAPAS DEL PIPELINE ═══
LISTA EXACTA (copia el nombre tal cual, sin cambiar mayúsculas ni acentos):
${pipelineStages.map((s: any) => `  • "${s.label || s.id}"`).join('\n')}
REGLA: "etapa_actual" SOLO puede ser una de las de arriba. NUNCA inventes otras.` : '';

    let memoryPrompt = `
══════════════════════════════════════════════════════════
🧠 SISTEMA DE MEMORIA — REGLAS OBLIGATORIAS
══════════════════════════════════════════════════════════

REGLA 1 — MEMORIA:
• NUNCA preguntes algo que el cliente ya dijo o que esté en la MEMORIA GUARDADA
• Lee TODO el historial antes de responder y usa los datos que ya tienes
• Si el cliente regresa después de días → salúdalo por nombre y retoma donde quedaron
• Responde natural, como un humano por WhatsApp${stagesBlock}

══════════════════════════════════════════════════════════
🎬 ACCIONES DEL SISTEMA — TABLA COMPLETA
══════════════════════════════════════════════════════════

El campo "accion" en MEMORY_JSON ejecuta acciones REALES. Úsalas así:

┌─────────────────────────────────────────────────────────┐
│  CREAR (solo una vez cuando el cliente confirma)        │
├──────────────────┬──────────────────────────────────────┤
│ crear_cita       │ Cliente confirma cita/reunión/demo/   │
│                  │ consulta con fecha y hora definida.   │
│                  │ Llena: fecha_cita, hora_cita,         │
│                  │ tipo_cita, nombre, telefono           │
├──────────────────┼──────────────────────────────────────┤
│ crear_pedido     │ Cliente confirma compra/pedido con    │
│                  │ datos completos.                      │
│                  │ Llena: producto_servicio, cantidad,   │
│                  │ total, direccion, fecha_entrega       │
├──────────────────┼──────────────────────────────────────┤
│ crear_reserva    │ Cliente confirma reserva de mesa,     │
│                  │ habitación, cancha, turno, servicio,  │
│                  │ espacio, vehículo, etc.               │
│                  │ Llena: fecha_reserva, hora_reserva,   │
│                  │ tipo_reserva, num_personas,           │
│                  │ duracion_reserva                      │
└──────────────────┴──────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  MODIFICAR (cuando ya existe y el cliente quiere        │
│  cambiar algo: fecha, hora, producto, cantidad, etc.)   │
├──────────────────┬──────────────────────────────────────┤
│ actualizar_cita  │ Cambia fecha/hora/tipo de cita ya     │
│                  │ creada. Llena los campos nuevos.      │
├──────────────────┼──────────────────────────────────────┤
│ actualizar_pedido│ Cambia producto, cantidad, dirección  │
│                  │ o fecha de entrega de pedido creado.  │
├──────────────────┼──────────────────────────────────────┤
│ actualizar_reserva│ Cambia fecha, hora, personas o tipo  │
│                  │ de reserva ya creada.                 │
└──────────────────┴──────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  CANCELAR (confirmar con cliente ANTES de ejecutar)     │
├──────────────────┬──────────────────────────────────────┤
│ cancelar_cita    │ Cancela y libera el cupo de la cita  │
├──────────────────┼──────────────────────────────────────┤
│ cancelar_pedido  │ Cancela el pedido en el sistema      │
├──────────────────┼──────────────────────────────────────┤
│ cancelar_reserva │ Cancela y libera el espacio/turno    │
└──────────────────┴──────────────────────────────────────┘

⚠️ REGLAS CRÍTICAS DE ACCIONES:
• CREAR solo UNA vez. Si memoria dice cita:"creada"/pedido:"creado"/reserva:"creada" → accion = "" (vacío)
• MODIFICAR solo si ya está creado. No crear de nuevo.
• CANCELAR: siempre confirmar antes → "¿Confirmas cancelar?" → esperar SÍ → accion = cancelar_*
• Si el cliente dice "reagendar" o "cambiar fecha" → actualizar_*, NO cancelar + crear

══════════════════════════════════════════════════════════
📋 BLOQUE DE MEMORIA — OBLIGATORIO EN CADA RESPUESTA
══════════════════════════════════════════════════════════

🔴 INCLUYE ESTE BLOQUE AL FINAL DE CADA respuesta, SIEMPRE.
🔴 Sin él, el sistema NO guarda datos ni mueve etapas.
🔴 Es INVISIBLE para el cliente (se elimina antes de enviar).

FORMATO (llena solo lo que sabes, deja "" lo que no):

<<MEMORY_JSON>>{"nombre":"","nombre_empresa":"","tipo_negocio":"","telefono":"","email":"","producto_servicio":"","detalles_producto":"","cantidad":"","precio":"","descuento":"","total":"","ciudad":"","direccion":"","barrio":"","metodo_pago":"","fecha_entrega":"","pedido":"","fecha_cita":"","hora_cita":"","tipo_cita":"","cita":"","fecha_reserva":"","hora_reserva":"","tipo_reserva":"","num_personas":"","duracion_reserva":"","reserva":"","notas":"","etapa_actual":"","accion":""}<<END_MEMORY>>

CAMPOS:
• nombre/telefono/email → Datos de contacto del cliente
• producto_servicio → Qué quiere comprar/contratar/reservar
• detalles_producto → Especificaciones: talla, color, modelo, variante, placa, cédula, etc.
• cantidad/precio/descuento/total → Datos económicos
• ciudad/direccion/barrio → Ubicación del cliente o entrega
• metodo_pago → Cómo va a pagar
• fecha_entrega → Para pedidos: cuándo se entrega
• notas → Cualquier dato extra relevante (cédula, placa, observaciones, empresa convenio)
• etapa_actual → ${pipelineStages.length > 0 ? `OBLIGATORIO. Etapa EXACTA: ${pipelineStages.map((s: any) => `"${s.label || s.id}"`).join(' | ')}` : 'Etapa actual del cliente en el pipeline (si está configurado)'}
• accion → Ver tabla de acciones arriba. Vacío si no hay acción que ejecutar.
• fecha_cita/hora_cita/tipo_cita → Para citas (hora en formato 24h: "14:30")
• fecha_reserva/hora_reserva/tipo_reserva/num_personas/duracion_reserva → Para reservas
• cita/pedido/reserva → NO los llenes: el sistema los actualiza automáticamente

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
      // Filtrar recursos y horarios por línea (ESTRICTO por línea)
      const resWhere: any = { userId: ownerId, isActive: true };
      const schedWhere: any = { userId: ownerId };
      if (whatsappLineId) {
        resWhere.whatsappLineId = whatsappLineId;
        schedWhere.whatsappLineId = whatsappLineId;
      } else {
        resWhere.whatsappLineId = null;
        schedWhere.whatsappLineId = null;
      }
      const resources = await prisma.resource.findMany({ where: resWhere, orderBy: { order: 'asc' } });
      const schedules = await prisma.businessSchedule.findMany({ where: schedWhere, orderBy: { dayOfWeek: 'asc' } });

      if (schedules.length > 0 || resources.length > 0) {
        const today = getNowColombia(userTz);
        const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        
        // Generate availability for today and next 3 days
        const availabilityLines: string[] = [];
        availabilityLines.push('=== 📅 DISPONIBILIDAD EN TIEMPO REAL (OBLIGATORIO CONSULTAR) ===');
        
        if (resources.length > 0) {
          availabilityLines.push(`🏪 Recursos disponibles: ${resources.map(r => r.name).join(', ')} (${resources.length} total)`);
        }

        // Show schedule summary
        const openDays = schedules.filter(s => s.isOpen && s.dayOfWeek <= 6);
        if (openDays.length > 0) {
          availabilityLines.push(`🕐 Horario: ${openDays.map(s => `${dayNames[s.dayOfWeek]}: ${to12h(s.startTime)}-${to12h(s.endTime)}`).join(' | ')}`);
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

          // 🇨🇴 Check Colombian holiday
          const holiday = isColombianHoliday(dateStr);
          if (holiday) {
            // Check if business works on this holiday
            const holidayConfig = schedules.find(s => s.dayOfWeek === 7);
            const workOnAll = holidayConfig?.isOpen || false;
            let workDates: string[] = [];
            try { workDates = holidayConfig?.breakStart ? JSON.parse(holidayConfig.breakStart) : []; } catch {}
            if (!workOnAll && !workDates.includes(dateStr)) {
              availabilityLines.push(`🇨🇴 ${dayNames[dayOfWeek]} ${dateStr}: FESTIVO (${holiday.name}) — CERRADO`);
              continue;
            }
            // Working holiday - note it
            availabilityLines.push(`⚠️ ${dayNames[dayOfWeek]} ${dateStr} es festivo (${holiday.name}) pero el negocio ABRE:`);
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

          const totalCap = resources.length > 0 ? resources.reduce((sum, r) => sum + (r.capacity || 1), 0) : 1;
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
            const slot24 = `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
            // 12h display
            const ampm = h >= 12 ? 'PM' : 'AM';
            const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
            const slot = `${h12}:${min.toString().padStart(2, '0')} ${ampm}`;

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
                const freeR = resources.filter(r => {
                  const rUsed = overlapping.filter(a => a.resourceId === r.id).length;
                  return rUsed < (r.capacity || 1);
                });
                // Show slot without resource names (AI was copying "(Tecnomecanica)" to client)
                // Only add resource name if multiple resources exist
                if (resources.length > 1) {
                  freeSlots.push(`${slot}(${freeR.map(r => r.name).join(',')})`);
                } else {
                  freeSlots.push(slot);
                }
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

        availabilityLines.push('⚠️ REGLAS: Solo ofrece horarios DISPONIBLES (✅). NUNCA ofrezcas horarios llenos (❌). Si no hay disponibilidad, sugiere otro día. Cuando confirmen cita/reserva, usa la acción correspondiente. SIEMPRE muestra horarios en formato 12h (ej: 2:00 PM, no 14:00).');
        availabilityLines.push('🕐 REGLA HOY vs MAÑANA: Compara la HORA ACTUAL de Colombia (inyectada arriba) con los horarios libres de HOY. Si hay horarios de HOY que sean al menos 1 hora después de la hora actual → OFRÉCELOS. Solo di "hoy no hay disponibilidad" si TODOS los horarios libres de HOY ya pasaron. Para recogida a domicilio: el horario debe ser mínimo 1 hora después de ahora. Para cita presencial: mínimo 30 minutos después. NUNCA saltes a mañana si hoy todavía tiene horarios futuros disponibles.');
        availabilityLines.push('🚨 CRÍTICO: Esta sección de disponibilidad es INTERNA — SOLO PARA TI. NUNCA copies este bloque al cliente. NUNCA muestres "(Tecnomecanica)" ni "=== DISPONIBILIDAD ===" ni datos técnicos. Reformula la info de forma bonita y natural como un humano por WhatsApp.');

        // 🇨🇴 Add upcoming holidays
        const todayStr = today.toISOString().split('T')[0];
        const holidaySummary = getHolidaySummaryForAI(todayStr);
        if (holidaySummary) {
          availabilityLines.push('');
          availabilityLines.push(holidaySummary);
          availabilityLines.push('⚠️ Los festivos el negocio está CERRADO salvo que se indique lo contrario arriba. NO agendes citas/reservas en festivos cerrados.');
        }

        promptParts.push(availabilityLines.join('\n'));
        log(`📅 Disponibilidad inyectada: ${resources.length} recursos, ${schedules.length} horarios`);
      }
    } catch (availErr: any) {
      log(`⚠️ Error cargando disponibilidad: ${availErr.message}`);
    }


    // 🤖📊 MODO ASISTENTE INTERNO — Grupos de trabajo + Asistente Personal del admin
    const isPersonalAssistant = savedContext?._isPersonalAssistant === true;
    const isInternalAssistant = conversation?.isGroup || isPersonalAssistant;
    // 🧹 Fix: limpiar "undefined" string en accion (a veces la IA lo escribe literalmente)
    if (savedContext?.accion === 'undefined' || savedContext?.accion === 'undefinido') {
      savedContext.accion = '';
    }
    console.log(`🤖 isPersonalAssistant: ${isPersonalAssistant} | isGroup: ${conversation?.isGroup} | contextKeys: ${Object.keys(savedContext||{}).join(',')}`);
    
    if (isInternalAssistant) {
      try {
        const msgLower = message.toLowerCase();

        // ═══════════════════════════════════════════════════════
        // 🎯 DETECCIÓN DE INTENCIONES — Asistente Personal v2.0
        // ═══════════════════════════════════════════════════════
        const isAgendaQuery    = /cita|agenda|reunión|reunion|horario|programad|cronograma|calendario|consulta.*hoy|hoy.*cita|cita.*hoy|mañana.*cita|cita.*mañana|semana/i.test(msgLower);
        const isPedidoQuery    = /pedido|orden|venta|despacho|entreg|envío|envio|compra|factur/i.test(msgLower);
        const isReservaQuery   = /reserva|booking|habitación|habitacion|mesa|cancha|turno|espacio/i.test(msgLower);
        const isUpdateQuery    = /actualiz|cambiar|mover|reagend|modific|cancel|eliminar|reprogramar/i.test(msgLower);
        const isStatsQuery     = /resumen|resum|dashboard|estadístic|estadistic|cómo vamos|como vamos|cuántas|cuantas|conversacion|métrica|metrica|rendimiento|reporte|informe|estado/i.test(msgLower);
        const isGeneralQuery   = /qué tenemos|que tenemos|qué hay|que hay|novedades|pendiente|notifica|alerta/i.test(msgLower);
        // [NEW] Intenciones avanzadas del Asistente Personal
        const isProductQuery   = /producto|catálogo|catalogo|inventario|stock|precio|servicio.*lista|lista.*servicio/i.test(msgLower);
        const isClientQuery    = /cliente|lead|contacto|quien.*compro|quien.*compró|top.*cliente|mejor.*cliente/i.test(msgLower);
        const isFollowUpQuery  = /seguimiento|follow.?up|sin respuesta|abandonado|perdido|retomar|recordar|llamar/i.test(msgLower);
        const isFunnelQuery    = /embudo|funnel|conversión|conversion|tasa|etapa.*venta|pipeline.*analisis|análisis.*pipeline/i.test(msgLower);
        const isSalesplanQuery = /plan.*venta|plan.*negocio|estrategia|objetivo|meta|proyección|proyeccion|crecimiento/i.test(msgLower);
        const isSendMsgQuery   = /enviar.*mensaje|mandar.*mensaje|escribir.*a |escríbele|notificar.*cliente|avisar.*a /i.test(msgLower);
        const isLearnQuery     = /aprend|patrón|patron|tendencia|comportamiento|análisis.*conversacion|que dicen.*clientes/i.test(msgLower);
        const isRevenueQuery   = /ingreso|revenue|total.*venta|cuanto.*vendí|cuanto.*vendimos|facturaci|ganancia/i.test(msgLower);
        const isTeamQuery      = /equipo|team|miembro|asignado|agente/i.test(msgLower);

        const wantsData = isAgendaQuery || isPedidoQuery || isReservaQuery || isUpdateQuery ||
                          isStatsQuery || isGeneralQuery || isProductQuery || isClientQuery ||
                          isFollowUpQuery || isFunnelQuery || isSalesplanQuery || isSendMsgQuery ||
                          isLearnQuery || isRevenueQuery || isTeamQuery;

        if (wantsData || isPersonalAssistant) {
          const biLines: string[] = [];
          const assistantLabel = isPersonalAssistant ? 'Asistente Personal BIZONNE' : (conversation?.groupName || 'Grupo');
          biLines.push(`\n=== 📊 DATOS DE PLATAFORMA EN TIEMPO REAL (${assistantLabel}) ===`);
          biLines.push(`Fecha: ${formatDateColombia(undefined, userTz)} | Hora: ${formatTimeColombia(undefined, userTz)}`);

          const todayStart  = new Date(getTodayStringColombia() + "T05:00:00.000Z");
          const weekStart7  = getNowColombia(userTz); weekStart7.setDate(weekStart7.getDate() - 7);
          const monthStart  = getNowColombia(userTz); monthStart.setDate(1); monthStart.setHours(0,0,0,0);

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // 1️⃣  PIPELINE Y CONVERSACIONES
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          if (isStatsQuery || isGeneralQuery || isFunnelQuery || isPersonalAssistant) {
            const [totalConvs, todayConvs, weekConvs, convsByStage, aiPausedCount] = await Promise.all([
              prisma.conversation.count({ where: { userId: ownerId, isGroup: false } }),
              prisma.conversation.count({ where: { userId: ownerId, isGroup: false, createdAt: { gte: todayStart } } }),
              prisma.conversation.count({ where: { userId: ownerId, isGroup: false, createdAt: { gte: weekStart7 } } }),
              prisma.conversation.groupBy({ by: ['stage'], where: { userId: ownerId, isGroup: false }, _count: true, orderBy: { _count: { id: 'desc' } } }),
              prisma.conversation.count({ where: { userId: ownerId, isGroup: false, aiPaused: true } }),
            ]);

            // Cargar etapas personalizadas del usuario
            const userLine = await prisma.whatsappLine.findFirst({
              where: { userId: ownerId },
              select: { customStages: true }
            });
            const customStages: any[] = (userLine?.customStages as any[]) || [];
            const stageNameMap: Record<string, string> = {};
            customStages.forEach((s: any) => { if (s.id) stageNameMap[s.id] = s.label || s.id; });

            biLines.push(`\n━━━ 💬 PIPELINE CRM ━━━`);
            biLines.push(`Total leads: ${totalConvs} | Nuevos hoy: ${todayConvs} | Esta semana: ${weekConvs} | IA pausada: ${aiPausedCount}`);

            if (convsByStage.length > 0) {
              const stageSummary = convsByStage.map((s: any) => {
                const name = stageNameMap[s.stage] || s.stage || 'Sin etapa';
                const pct = totalConvs > 0 ? Math.round((s._count / totalConvs) * 100) : 0;
                return `${name}: ${s._count} (${pct}%)`;
              }).join(' | ');
              biLines.push(`Por etapa: ${stageSummary}`);
            }

            // Leads atascados: sin actividad > 3 días y no convertidos
            if (isFunnelQuery || isFollowUpQuery || isPersonalAssistant) {
              const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
              const stuckLeads = await prisma.conversation.findMany({
                where: {
                  userId: ownerId, isGroup: false,
                  updatedAt: { lt: threeDaysAgo },
                  stage: { notIn: ['converted', 'convertido', 'lost', 'perdido', 'closed', 'cerrado'] }
                },
                orderBy: { updatedAt: 'asc' },
                take: 10,
                select: { id: true, recipientName: true, recipientId: true, stage: true, updatedAt: true, lastMessage: true, whatsappLineId: true }
              });
              if (stuckLeads.length > 0) {
                biLines.push(`\n⚠️ LEADS ATASCADOS (sin actividad +3 días): ${stuckLeads.length}`);
                stuckLeads.slice(0, 5).forEach(l => {
                  const days = Math.floor((Date.now() - new Date(l.updatedAt).getTime()) / 86400000);
                  const stageName = stageNameMap[l.stage || ''] || l.stage || 'sin etapa';
                  const phone = l.recipientId?.replace('@c.us','').replace('@s.whatsapp.net','') || '';
                  biLines.push(`  • ${l.recipientName || phone} | Etapa: ${stageName} | ${days}d sin actividad | Tel: ${phone}`);
                });
              }
            }
          }

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // 2️⃣  AGENDA COMPLETA (Citas + Pedidos + Reservas)
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          const rangeStart = new Date(getTodayStringColombia() + "T05:00:00.000Z");
          const rangeEnd   = getNowColombia(userTz); rangeEnd.setDate(rangeEnd.getDate() + 7); rangeEnd.setHours(23, 59, 59, 999);
          const allAppts   = await prisma.appointment.findMany({
            where: { userId: ownerId, date: { gte: rangeStart, lte: rangeEnd }, status: { notIn: ['cancelled'] } },
            orderBy: [{ date: 'asc' }, { time: 'asc' }],
            take: 60
          });

          const citas   = allAppts.filter((a: any) => a.type === 'appointment');
          const pedidos = allAppts.filter((a: any) => a.type === 'order');
          const reservas= allAppts.filter((a: any) => a.type === 'reservation');

          biLines.push(`\n━━━ 📋 AGENDA PRÓXIMOS 7 DÍAS ━━━`);
          biLines.push(`📅 Citas: ${citas.length} | 🛒 Pedidos: ${pedidos.length} | 🏨 Reservas: ${reservas.length} | Total: ${allAppts.length}`);

          const dayNames     = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
          const filterTypes: string[] = [];
          if (isAgendaQuery)  filterTypes.push('appointment');
          if (isPedidoQuery)  filterTypes.push('order');
          if (isReservaQuery) filterTypes.push('reservation');
          if (filterTypes.length === 0) filterTypes.push('appointment','order','reservation');
          const typeLabels: Record<string, string> = { appointment: '📅 Cita', order: '🛒 Pedido', reservation: '🏨 Reserva' };
          const byDay = new Map<string, any[]>();
          for (const apt of allAppts) {
            const dk = new Date(apt.date).toISOString().split('T')[0];
            if (!byDay.has(dk)) byDay.set(dk, []);
            byDay.get(dk)!.push(apt);
          }
          let totalItems = 0;
          for (const [dateKey, appts] of byDay.entries()) {
            const d = new Date(dateKey + 'T12:00:00');
            const isToday    = dateKey === getTodayStringColombia();
            const tmrCol     = getNowColombia(userTz); tmrCol.setDate(tmrCol.getDate()+1);
            const tmrStr     = `${tmrCol.getFullYear()}-${String(tmrCol.getMonth()+1).padStart(2,'0')}-${String(tmrCol.getDate()).padStart(2,'0')}`;
            const isTomorrow = dateKey === tmrStr;
            const dayLabel   = isToday ? '📌 HOY' : isTomorrow ? '📌 MAÑANA' : dayNames[d.getDay()];
            const filtered   = appts.filter((a: any) => filterTypes.includes(a.type));
            if (filtered.length === 0) continue;
            biLines.push(`\n━━━ ${dayLabel} ${d.toLocaleDateString('es', { day: 'numeric', month: 'long' })} ━━━`);
            for (const apt of filtered) {
              totalItems++;
              const typeEmoji  = typeLabels[(apt as any).type] || '📅';
              const statusEmoji= apt.status==='confirmed'?'✅':apt.status==='pending'?'⏳':'📋';
              let det = `${typeEmoji} ${statusEmoji} ${apt.clientName||'Sin nombre'}`;
              if (apt.clientPhone) det += ` | 📞 ${apt.clientPhone}`;
              det += ` | 🕐 ${to12h(apt.time)}`;
              if (apt.duration) det += ` (${apt.duration}min)`;
              if ((apt as any).notes)   det += ` | 📝 ${(apt as any).notes}`;
              if ((apt as any).address) det += ` | 📍 ${(apt as any).address}`;
              if ((apt as any).total)   det += ` | 💰 $${(apt as any).total}`;
              det += ` | ID:${apt.id.slice(-6)}`;
              biLines.push(`  ${det}`);
            }
          }
          if (totalItems === 0 && (isAgendaQuery || isPedidoQuery || isReservaQuery)) {
            biLines.push('\n📭 No hay registros para el período consultado.');
          }

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // 3️⃣  INGRESOS Y VENTAS
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          if (isStatsQuery || isGeneralQuery || isPedidoQuery || isRevenueQuery || isPersonalAssistant) {
            const [todayOrders, monthOrders] = await Promise.all([
              prisma.appointment.findMany({ where: { userId: ownerId, type: 'order', date: { gte: todayStart }, status: { notIn: ['cancelled'] } }, select: { total: true, clientName: true } }),
              prisma.appointment.findMany({ where: { userId: ownerId, type: 'order', date: { gte: monthStart }, status: { notIn: ['cancelled'] } }, select: { total: true } }),
            ]);
            const todayRevenue = todayOrders.reduce((sum: number, o: any) => sum + (parseFloat(o.total) || 0), 0);
            const monthRevenue = monthOrders.reduce((sum: number, o: any) => sum + (parseFloat(o.total) || 0), 0);
            biLines.push(`\n━━━ 💰 VENTAS E INGRESOS ━━━`);
            biLines.push(`Hoy: ${todayOrders.length} pedidos | Ingresos hoy: $${todayRevenue.toLocaleString('es')}`);
            biLines.push(`Este mes: ${monthOrders.length} pedidos | Ingresos mes: $${monthRevenue.toLocaleString('es')}`);
          }

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // 4️⃣  PRODUCTOS / CATÁLOGO
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          if (isProductQuery || isSalesplanQuery || isPersonalAssistant) {
            const products = await prisma.product.findMany({
              where: { userId: ownerId, isActive: true },
              orderBy: { createdAt: 'desc' },
              take: 30,
              select: { name: true, price: true, category: true, stock: true, description: true }
            });
            if (products.length > 0) {
              biLines.push(`\n━━━ 🛍️ CATÁLOGO DE PRODUCTOS (${products.length}) ━━━`);
              const byCategory = new Map<string, any[]>();
              products.forEach((p: any) => {
                const cat = p.category || 'General';
                if (!byCategory.has(cat)) byCategory.set(cat, []);
                byCategory.get(cat)!.push(p);
              });
              for (const [cat, prods] of byCategory.entries()) {
                biLines.push(`  ${cat}:`);
                prods.forEach((p: any) => {
                  let line = `    • ${p.name}`;
                  if (p.price) line += ` | $${parseFloat(p.price).toLocaleString('es')}`;
                  if (p.stock !== null && p.stock !== undefined) line += ` | Stock: ${p.stock}`;
                  biLines.push(line);
                });
              }
            }
          }

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // 5️⃣  CLIENTES TOP Y SEGUIMIENTO
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          if (isClientQuery || isFollowUpQuery || isSalesplanQuery || isPersonalAssistant) {
            const [topClients, recentClients] = await Promise.all([
              prisma.client.findMany({
                where: { userId: ownerId },
                orderBy: { updatedAt: 'desc' },
                take: 10,
                select: { name: true, phone: true, status: true, tags: true, totalPurchases: true, notes: true }
              }),
              prisma.conversation.findMany({
                where: { userId: ownerId, isGroup: false, updatedAt: { gte: weekStart7 } },
                orderBy: { updatedAt: 'desc' },
                take: 10,
                select: { recipientName: true, recipientId: true, stage: true, updatedAt: true, lastMessage: true }
              })
            ]);
            if (topClients.length > 0) {
              biLines.push(`\n━━━ 👥 CLIENTES RECIENTES (${topClients.length}) ━━━`);
              topClients.forEach((c: any) => {
                let line = `  • ${c.name} | ${c.phone || 'Sin tel'}`;
                if (c.status) line += ` | ${c.status}`;
                if (c.totalPurchases) line += ` | Compras: ${c.totalPurchases}`;
                if (c.notes) line += ` | Nota: ${c.notes.substring(0,50)}`;
                biLines.push(line);
              });
            }
            if (recentClients.length > 0) {
              biLines.push(`\n━━━ 🔔 CONVERSACIONES ACTIVAS ESTA SEMANA ━━━`);
              recentClients.forEach((c: any) => {
                const phone = c.recipientId?.replace('@c.us','').replace('@s.whatsapp.net','') || '';
                const ago = Math.floor((Date.now() - new Date(c.updatedAt).getTime()) / 3600000);
                biLines.push(`  • ${c.recipientName||phone} | Etapa: ${c.stage||'nueva'} | Hace ${ago}h | "${(c.lastMessage||'').substring(0,60)}"`);
              });
            }
          }

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // 6️⃣  AUTO-APRENDIZAJE — PATRONES DE CONVERSACIONES
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          if (isLearnQuery || isFunnelQuery || isSalesplanQuery || isPersonalAssistant) {
            const [convertedConvs, lostConvs, allStageConvs] = await Promise.all([
              prisma.conversation.findMany({
                where: { userId: ownerId, isGroup: false, stage: { in: ['converted','convertido','confirmed','confirmado'] } },
                orderBy: { updatedAt: 'desc' }, take: 5,
                select: { recipientName: true, contextData: true, updatedAt: true }
              }),
              prisma.conversation.findMany({
                where: { userId: ownerId, isGroup: false, stage: { in: ['lost','perdido','lost_lead','descartado'] } },
                orderBy: { updatedAt: 'desc' }, take: 5,
                select: { recipientName: true, contextData: true, lastMessage: true }
              }),
              prisma.conversation.groupBy({
                by: ['stage'], where: { userId: ownerId, isGroup: false },
                _count: true, orderBy: { _count: { id: 'desc' } }
              })
            ]);

            if (allStageConvs.length > 1) {
              const totalLeads = allStageConvs.reduce((sum: number, s: any) => sum + s._count, 0);
              const convertedCount = allStageConvs.filter((s: any) =>
                ['converted','convertido','confirmed','confirmado'].includes(s.stage || '')
              ).reduce((sum: number, s: any) => sum + s._count, 0);
              const conversionRate = totalLeads > 0 ? Math.round((convertedCount / totalLeads) * 100) : 0;

              biLines.push(`\n━━━ 📈 ANÁLISIS DE EMBUDO ━━━`);
              biLines.push(`Tasa de conversión global: ${conversionRate}% (${convertedCount}/${totalLeads} leads)`);

              if (convertedConvs.length > 0) {
                const commonProducts = convertedConvs
                  .map((c: any) => (c.contextData as any)?.producto_servicio || (c.contextData as any)?.producto || '')
                  .filter(Boolean);
                if (commonProducts.length > 0) biLines.push(`Productos más vendidos: ${[...new Set(commonProducts)].join(', ')}`);
              }
              if (lostConvs.length > 0) {
                biLines.push(`Leads perdidos recientes: ${lostConvs.map((c: any) => c.recipientName || 'Anónimo').join(', ')}`);
              }
            }
          }

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // 7️⃣  EQUIPO (si activo)
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          if (isTeamQuery || isPersonalAssistant) {
            const teamMembers = await prisma.user.findMany({
              where: { parentUserId: ownerId, isActive: true },
              select: { name: true, role: true },
              take: 10
            });
            if (teamMembers.length > 0) {
              biLines.push(`\n━━━ 👨‍💼 EQUIPO (${teamMembers.length} miembros) ━━━`);
              teamMembers.forEach((m: any) => biLines.push(`  • ${m.name} | ${m.role || 'Agente'}`));
            }
          }

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // 8️⃣  INSTRUCCIONES ASISTENTE PERSONAL v2.0
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          biLines.push(`
=== INSTRUCCIONES — ${isPersonalAssistant ? 'ASISTENTE PERSONAL BIZONNE v2.0' : 'MODO GRUPO INTERNO'} ===

${isPersonalAssistant ? `Eres el CEREBRO DIGITAL del negocio. Tienes acceso total y en tiempo real a todos los sistemas de la plataforma Bizonne.
Tu zona horaria: la configurada por el usuario. Usa SIEMPRE la fecha/hora inyectada en el sistema para calcular fechas relativas.

🧠 LO QUE PUEDES HACER:
1. AGENDA: Ver, crear, actualizar y cancelar citas/pedidos/reservas usando acciones en MEMORY_JSON
2. CRM PIPELINE: Analizar el embudo, mover leads entre etapas, identificar atascados
3. CLIENTES: Ver historial, buscar contactos, analizar comportamiento
4. PRODUCTOS: Consultar catálogo, precios y stock
5. VENTAS: Calcular ingresos, proyecciones, comparativas
6. SEGUIMIENTO: Identificar leads fríos, sugerir acciones, crear plan de seguimiento personalizado
7. EMBUDO: Analizar tasa de conversión, cuellos de botella, mejoras por etapa
8. PLAN DE VENTAS: Crear estrategias basadas en datos reales de la plataforma
9. AUTO-APRENDIZAJE: Detectar patrones en conversaciones ganadas/perdidas
10. MENSAJES: Cuando pidan "enviar mensaje a [cliente]" → usa accion:"enviar_mensaje" con destinatario y texto

📋 REGLAS CRÍTICAS:
- SOLO reporta datos que VES en los datos de arriba. Si no hay datos, di "No hay registros".
- Horarios SIEMPRE en formato 12h (2:00 PM, no 14:00).
- Sé conciso pero COMPLETO. No omitas detalles importantes.
- Organiza con emojis y estructura clara.
- Si preguntan algo vago como "que hay", da un RESUMEN EJECUTIVO con los 3 puntos más urgentes.
- Para SEGUIMIENTO: sugiere mensajes personalizados con el nombre del cliente.
- Para EMBUDO: identifica la etapa con más pérdidas y sugiere mejora concreta.
- Para PLAN DE VENTAS: basa TODO en los números reales que tienes arriba.
- HOY vs AYER: Si preguntan "que tenemos HOY", SOLO muestra registros de HOY.
- URGENCIAS: Si hay entrega en < 1 hora o cita próxima, menciónalo PRIMERO.

🎬 ACCIONES DISPONIBLES (en MEMORY_JSON):
- accion: "crear_cita" → crear cita (requiere: cliente_nombre, cliente_telefono, fecha_cita, hora_cita, tipo_cita)
- accion: "crear_pedido" → crear pedido (requiere: cliente_nombre, cliente_telefono, producto_servicio, total, fecha_entrega)
- accion: "crear_reserva" → crear reserva (requiere: cliente_nombre, cliente_telefono, fecha_reserva, hora_reserva, tipo_reserva, num_personas)
- accion: "actualizar_cita" → reagendar cita (requiere: cliente_nombre o cliente_telefono, nueva fecha_cita/hora_cita)
- accion: "actualizar_pedido" → modificar pedido (requiere: cliente_nombre o cliente_telefono)
- accion: "actualizar_reserva" → modificar reserva (requiere: cliente_nombre o cliente_telefono)
- accion: "cancelar_cita" → cancelar cita (requiere: cliente_nombre o cliente_telefono o appointment_id)
- accion: "cancelar_pedido" → cancelar pedido (requiere: cliente_nombre o cliente_telefono o appointment_id)
- accion: "cancelar_reserva" → cancelar reserva (requiere: cliente_nombre o cliente_telefono o appointment_id)
- accion: "enviar_mensaje" → enviar WhatsApp a cliente (requiere: destinatario_nombre o destinatario_telefono, mensaje_texto)
- accion: "mover_etapa" → cambiar etapa de lead (requiere: cliente_telefono o conversacion_id, nueva_etapa)

IMPORTANTE para MEMORY_JSON del Copiloto:
- Usa "cliente_nombre" y "cliente_telefono" para el cliente objetivo de la acción
- Usa "destinatario_nombre" y "destinatario_telefono" solo para enviar_mensaje
- El ID del registro en agenda se llama "appointment_id" (últimos 6 chars del ID mostrado)
- SIEMPRE incluye <<MEMORY_JSON>>...<<END_MEMORY>> con la accion correspondiente

RECUERDA: Siempre incluir <<MEMORY_JSON>>...<<END_MEMORY>> al final de tu respuesta.` 

: `Estás en un GRUPO DE TRABAJO INTERNO. Los que escriben son miembros del equipo, NO clientes.
Puedes coordinar tareas, dar información de la agenda y responder consultas del equipo.`}
`);

          if (biLines.length > 2) {
            promptParts.push(biLines.join('\n'));
          }
          log(`🤖📊 BI inyectado (${isPersonalAssistant ? 'Personal v2.0' : 'Grupo'}): ${totalItems} agenda + 7 sistemas`);
        }
      } catch (agendaErr: any) {
        log(`⚠️ Error cargando datos internos: ${agendaErr.message}`);
      }
    }


    const systemPrompt = promptParts.join('\n\n') || 'Eres un asistente virtual amable por WhatsApp.';
    log(`🧠 Prompt: ${systemPrompt.length} chars | Cliente: ${clientName || 'desconocido'} | Memoria: ${Object.keys(savedContext).length} campos`);

    // Construir mensajes para OpenAI: 50 para asistente personal, 30 para clientes
    const historyLimit = (conversation?.isGroup || isPersonalAssistant) ? 50 : 30;
    const recent = [...history].reverse().slice(-historyLimit);
    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    recent.forEach(m => messages.push({ role: m.fromMe ? 'assistant' : 'user', content: m.content.substring(0, 800) }));
    
    // 🔴 RECORDATORIO: Agregar al mensaje del usuario para forzar el bloque de memoria
    // Reminder compacto — refuerza el bloque de memoria en cada mensaje
    const stagesHint = pipelineStages.length > 0
      ? ` Etapas válidas: ${pipelineStages.map((s: any) => `"${s.label || s.id}"`).join(' | ')}.`
      : '';
    // Recordatorio crítico inyectado al final — sin mencionar talla primero
    // Recordatorio genérico — aplica para CUALQUIER negocio SaaS
    // Las reglas específicas del negocio viven en el prompt de módulos configurado por el usuario
    const criticalRulesReminder = !isPersonalAssistant ? [
      '\n[SISTEMA: Sigue el flujo configurado en tu base de conocimiento.',
      'No repitas preguntas que ya están en la memoria.',
      'Termina con <<MEMORY_JSON>>...<<END_MEMORY>>]'
    ].join(' ') : '';

    const memoryReminder = isPersonalAssistant ? `

[COPILOTO — OBLIGATORIO: Termina con <<MEMORY_JSON>>...<<END_MEMORY>>.
ACCIONES disponibles: enviar_mensaje(destinatario_nombre,mensaje_texto) | crear_cita(cliente_nombre,fecha_cita,hora_cita,tipo_cita) | crear_pedido(cliente_nombre,producto_servicio,total,fecha_entrega) | crear_reserva(cliente_nombre,fecha_reserva,hora_reserva,tipo_reserva,num_personas) | actualizar_cita | actualizar_pedido | actualizar_reserva | cancelar_cita | cancelar_pedido | cancelar_reserva | mover_etapa(cliente_telefono,nueva_etapa)]` : `

[SISTEMA — OBLIGATORIO: Termina SIEMPRE con <<MEMORY_JSON>>...<<END_MEMORY>> actualizado.${stagesHint}
ACCIONES: crear_cita(fecha_cita,hora_cita,tipo_cita) | crear_pedido(producto_servicio,total,fecha_entrega) | crear_reserva(fecha_reserva,hora_reserva,tipo_reserva,num_personas) | actualizar_cita | actualizar_pedido | actualizar_reserva | cancelar_cita | cancelar_pedido | cancelar_reserva. Vacío si no hay acción. NUNCA crear_* si ya está creado en memoria.]`;
    // 💬 Si el usuario respondió a un mensaje, inyectar ese contexto antes del mensaje
    const messageWithQuoted = quotedContext ? `[Respondiendo a: "${quotedContext}"] ${message}` : message;
    messages.push({ role: 'user', content: messageWithQuoted + criticalRulesReminder + memoryReminder });

    // Llamar a OpenAI
    // 💰 MODELO FIJO: gpt-4o-mini para todos (económico y potente)
    const FIXED_MODEL = 'gpt-4o-mini';
    for (const model of [FIXED_MODEL]) {
      try {
        log(`🤖 OpenAI (${model}, ${messages.length} msgs)...`);
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 35000);
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.apiKey}` },
          body: JSON.stringify({
            model, messages,
            temperature: assistant.temperature || 0.7,
            max_tokens: (conversation?.isGroup || isPersonalAssistant) ? 2000 : (assistant.maxTokens || 1000)
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
            const pagoPatterns = /(efectivo|cash|transferencia|transfer|tarjeta|card|paypal|contra\s*entrega|qr|bitcoin|crypto|zelle|nequi|daviplata|pse|bancolombia|davivienda|yape|plin|mercadopago|bizum|revolut|stripe)/i;
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
          } // end if(!memoryMatch) — fallback cuando IA no incluyó MEMORY_JSON

                    console.log(`🔍 MEMORY_JSON presente: ${!!memoryMatch} | isPersonalAssistant: ${isPersonalAssistant}`);
          if (memoryMatch) {
            try {
              const memoryData = JSON.parse(memoryMatch[1].trim());
              console.log(`🔍 memoryData accion: "${memoryData.accion}" | keys: ${Object.keys(memoryData).join(',')}`);
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

              // ════════════════════════════════════════════════════════════════
              // 🤖 COPILOTO IA — ACCIONES DEL DUEÑO (isPersonalAssistant)
              // El dueño puede gestionar citas/pedidos/reservas de CUALQUIER cliente
              // y enviar mensajes a cualquier conversación desde su WhatsApp
              // ════════════════════════════════════════════════════════════════
              if (isPersonalAssistant && actionToTake) {
                console.log(`🤖 COPILOTO ACCIÓN: "${actionToTake}" | isPersonalAssistant: ${isPersonalAssistant}`);
                try {
                  // Datos del cliente objetivo (puede ser distinto al dueño)
                  const targetPhone  = (memoryData.destinatario_telefono || memoryData.cliente_telefono || memoryData.telefono || '').replace(/\D/g, '').slice(-10);
                  const targetName   = memoryData.destinatario_nombre || memoryData.cliente_nombre || memoryData.nombre || '';
                  const apptId       = memoryData.appointment_id || memoryData.cita_id || memoryData.pedido_id || memoryData.reserva_id || '';
                  
                  // Extraer mensaje: primero del campo, luego del reply de la IA (texto entre comillas)
                  let targetMsg = memoryData.mensaje_texto || memoryData.mensaje || '';
                  if (!targetMsg && actionToTake === 'enviar_mensaje') {
                    const msgMatch = reply.match(/"([^"]{5,300})"/);
                    if (msgMatch) targetMsg = msgMatch[1].trim();
                  }
                  console.log(`🤖 COPILOTO target → phone:${targetPhone} name:${targetName} msg:${targetMsg.substring(0,80)}`);

                  // ── 📨 ENVIAR MENSAJE A CLIENTE ──────────────────────────────
                  if (actionToTake === 'enviar_mensaje' && targetMsg) {
                    try {
                      // Buscar conversación del cliente objetivo
                      let targetConv = null;
                      // Buscar por teléfono primero, luego por nombre
                      if (targetPhone) {
                        targetConv = await prisma.conversation.findFirst({
                          where: { userId: ownerId, recipientId: { endsWith: targetPhone }, isGroup: false },
                          orderBy: { updatedAt: 'desc' },
                          select: { id: true, recipientId: true, whatsappLineId: true }
                        });
                      }
                      if (!targetConv && targetName) {
                        // Buscar por nombre — primero parte más larga del nombre
                        const nameParts = targetName.trim().split(' ').filter((p: string) => p.length >= 3).sort((a: string, b: string) => b.length - a.length);
                        for (const part of nameParts) {
                          // Buscar con y sin tildes — cargar todas las convs recientes y filtrar en memoria
                          const candidates = await prisma.conversation.findMany({
                            where: { userId: ownerId, isGroup: false },
                            orderBy: { updatedAt: 'desc' },
                            take: 200,
                            select: { id: true, recipientId: true, recipientName: true, whatsappLineId: true }
                          });
                          const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                          const partNorm = normalize(part);
                          const found = candidates.find((c: any) => c.recipientName && normalize(c.recipientName).includes(partNorm));
                          if (found) {
                            targetConv = found;
                            console.log("🎯 COPILOTO: conv encontrada - " + part + " -> " + found.recipientName + " (" + found.id + ")");
                            break;
                          }
                        }
                        if (!targetConv) console.log("⚠️ COPILOTO: no se encontró conversación para " + targetName + " en " + ownerId);
                      }

                      if (targetConv) {
                        const targetLine = (targetConv.whatsappLineId
                          ? await prisma.whatsappLine.findUnique({ where: { id: targetConv.whatsappLineId } })
                          : await prisma.whatsappLine.findFirst({ where: { userId: ownerId, status: 'connected' } })) as any;

                        if (targetLine) {
                          const recipientJid = targetConv.recipientId.includes('@') ? targetConv.recipientId : `${targetConv.recipientId}@c.us`;
                          let msgSent = false;

                          if (targetLine.cloudAccessToken && targetLine.phoneNumberId) {
                            // Cloud API
                            const cloudRes = await fetch(`https://graph.facebook.com/v18.0/${targetLine.phoneNumberId}/messages`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${targetLine.cloudAccessToken}` },
                              body: JSON.stringify({ messaging_product: 'whatsapp', to: targetConv.recipientId.replace(/\D/g,''), type: 'text', text: { body: targetMsg } })
                            });
                            msgSent = cloudRes.ok;
                          } else if (targetLine.wahaApiUrl && targetLine.sessionName) {
                            // WAHA
                            const wahaRes = await fetch(`${targetLine.wahaApiUrl}/api/sendText`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', ...(targetLine.wahaApiKey ? { 'X-Api-Key': targetLine.wahaApiKey } : {}) },
                              body: JSON.stringify({ chatId: recipientJid, text: targetMsg, session: targetLine.sessionName })
                            });
                            msgSent = wahaRes.ok;
                          }

                          if (msgSent) {
                            // Guardar en DB
                            await prisma.message.create({ data: { conversationId: targetConv.id, content: targetMsg, fromMe: true, userId: ownerId, role: 'assistant' } });
                            await prisma.conversation.update({ where: { id: targetConv.id }, data: { lastMessage: targetMsg } });
                            log(`📨 COPILOTO envió mensaje a ${targetName || targetPhone}: "${targetMsg.substring(0,60)}"`);
                          } else {
                            log(`⚠️ COPILOTO: fallo al enviar mensaje a ${targetName || targetPhone}`);
                          }
                        }
                      } else {
                        log(`⚠️ COPILOTO: no se encontró conversación para ${targetName || targetPhone}`);
                      }
                    } catch (sendErr: any) { log(`❌ COPILOTO enviar_mensaje: ${sendErr.message}`); }
                  }

                  // ── 📅 CREAR CITA PARA CLIENTE ───────────────────────────────
                  if (actionToTake === 'crear_cita') {
                    try {
                      const fecha = memoryData.fecha_cita || memoryData.fecha || '';
                      const hora  = memoryData.hora_cita  || memoryData.hora  || '10:00';
                      const tipo  = memoryData.tipo_cita  || 'cita';
                      const clienteNombre = targetName || 'Cliente';
                      const citaDate = parseSmartDate(fecha);
                      const citaTime = parseSmartTime(hora, '10:00');
                      await prisma.appointment.create({ data: {
                        userId: ownerId, type: 'appointment',
                        clientName: clienteNombre, clientPhone: targetPhone || '',
                        date: citaDate, time: citaTime, status: 'confirmed',
                        notes: `📅 CITA creada por Copiloto IA\n━━━━━━━━━━━━━━━\n👤 ${clienteNombre}\n📱 ${targetPhone || 'Sin tel'}\n📋 Tipo: ${tipo}\n📝 ${memoryData.notas || ''}\n━━━━━━━━━━━━━━━`,
                        address: memoryData.direccion || '', whatsappLineId: whatsappLineId || null
                      }});
                      sendPushToUser(ownerId, { title: '📅 Cita creada por Copiloto', body: `${clienteNombre} — ${tipo} ${fecha} ${hora}`.substring(0,120), url: '/agenda', tag: `copilot-cita-${Date.now()}` }).catch(()=>{});
                      log(`📅 COPILOTO: Cita creada para ${clienteNombre} el ${fecha} ${hora}`);
                    } catch(e:any){ log(`❌ COPILOTO crear_cita: ${e.message}`); }
                  }

                  // ── 🛒 CREAR PEDIDO PARA CLIENTE ─────────────────────────────
                  if (actionToTake === 'crear_pedido') {
                    try {
                      const clienteNombre = targetName || 'Cliente';
                      const producto = memoryData.producto_servicio || memoryData.producto || '';
                      const fecha = memoryData.fecha_entrega || memoryData.fecha || '';
                      const total = parseFloat((memoryData.total || '0').replace(/[^0-9.]/g,'')) || 0;
                      await prisma.appointment.create({ data: {
                        userId: ownerId, type: 'order',
                        clientName: clienteNombre, clientPhone: targetPhone || '',
                        date: parseSmartDate(fecha), time: memoryData?.hora_entrega || memoryData?.hora_cita || '12:00', status: 'pending',
                        notes: `🛒 PEDIDO creado por Copiloto IA\n━━━━━━━━━━━━━━━\n👤 ${clienteNombre}\n📱 ${targetPhone || 'Sin tel'}\n🛍️ ${producto}\n📦 Cantidad: ${memoryData.cantidad || '1'}\n💵 Total: $${memoryData.total || '0'}\n💳 Pago: ${memoryData.metodo_pago || 'Por definir'}\n📍 ${memoryData.direccion || ''} ${memoryData.ciudad || ''}\n📝 ${memoryData.notas || ''}\n━━━━━━━━━━━━━━━`,
                        total, address: memoryData.direccion || '', whatsappLineId: whatsappLineId || null
                      }});
                      sendPushToUser(ownerId, { title: '🛒 Pedido creado por Copiloto', body: `${clienteNombre} — ${producto}`.substring(0,120), url: '/agenda', tag: `copilot-pedido-${Date.now()}` }).catch(()=>{});
                      log(`🛒 COPILOTO: Pedido creado para ${clienteNombre}`);
                    } catch(e:any){ log(`❌ COPILOTO crear_pedido: ${e.message}`); }
                  }

                  // ── 🏨 CREAR RESERVA PARA CLIENTE ────────────────────────────
                  if (actionToTake === 'crear_reserva') {
                    try {
                      const clienteNombre = targetName || 'Cliente';
                      const fecha = memoryData.fecha_reserva || memoryData.fecha || '';
                      const hora  = memoryData.hora_reserva  || memoryData.hora  || '12:00';
                      const tipo  = memoryData.tipo_reserva  || 'reserva';
                      const total = parseFloat((memoryData.total || '0').replace(/[^0-9.]/g,'')) || 0;
                      await prisma.appointment.create({ data: {
                        userId: ownerId, type: 'reservation',
                        clientName: clienteNombre, clientPhone: targetPhone || '',
                        date: parseSmartDate(fecha), time: parseSmartTime(hora,'12:00'),
                        duration: parseInt(memoryData.duracion_reserva || '60') || 60,
                        status: 'pending',
                        notes: `🏨 RESERVA creada por Copiloto IA\n━━━━━━━━━━━━━━━\n👤 ${clienteNombre}\n📱 ${targetPhone || 'Sin tel'}\n📋 Tipo: ${tipo}\n👥 Personas: ${memoryData.num_personas || '1'}\n🗓️ ${fecha} ${hora}\n💵 $${memoryData.total || '0'}\n📝 ${memoryData.notas || ''}\n━━━━━━━━━━━━━━━`,
                        total, address: memoryData.direccion || '', whatsappLineId: whatsappLineId || null
                      }});
                      sendPushToUser(ownerId, { title: '🏨 Reserva creada por Copiloto', body: `${clienteNombre} — ${tipo} ${fecha}`.substring(0,120), url: '/agenda', tag: `copilot-reserva-${Date.now()}` }).catch(()=>{});
                      log(`🏨 COPILOTO: Reserva creada para ${clienteNombre}`);
                    } catch(e:any){ log(`❌ COPILOTO crear_reserva: ${e.message}`); }
                  }

                  // ── 🔄 REAGENDAR / ACTUALIZAR ────────────────────────────────
                  if (actionToTake === 'actualizar_cita' || actionToTake === 'actualizar_reserva' || actionToTake === 'actualizar_pedido') {
                    try {
                      const tipoQuery = actionToTake === 'actualizar_pedido' ? 'order' : ['appointment','reservation'];
                      const existing = await prisma.appointment.findFirst({
                        where: {
                          userId: ownerId,
                          ...(apptId ? { id: { endsWith: apptId } } : targetPhone ? { clientPhone: { endsWith: targetPhone } } : { clientName: { contains: targetName } }),
                          type: Array.isArray(tipoQuery) ? { in: tipoQuery } : tipoQuery,
                          status: { notIn: ['cancelled'] }
                        },
                        orderBy: { date: 'asc' }
                      });
                      if (existing) {
                        const updateFields: any = {};
                        const newFecha = memoryData.fecha_cita || memoryData.fecha_reserva || memoryData.fecha_entrega || memoryData.fecha;
                        const newHora  = memoryData.hora_cita  || memoryData.hora_reserva  || memoryData.hora;
                        if (newFecha) updateFields.date = parseSmartDate(newFecha);
                        if (newHora)  updateFields.time = parseSmartTime(newHora, existing.time || '10:00');
                        if (memoryData.nombre || targetName) updateFields.clientName = memoryData.nombre || targetName;
                        if (targetPhone) updateFields.clientPhone = targetPhone;
                        if (memoryData.total) updateFields.total = parseFloat(memoryData.total.replace(/[^0-9.]/g,'')) || existing.total;
                        updateFields.notes = (existing.notes || '') + `\n\n🔄 REAGENDADO por Copiloto IA — ${new Date().toLocaleString()}\n📅 Nueva fecha: ${newFecha || 'sin cambio'} ${newHora || ''}`;
                        await prisma.appointment.update({ where: { id: existing.id }, data: updateFields });
                        sendPushToUser(ownerId, { title: '🔄 Reagendado por Copiloto', body: `${existing.clientName} — ${newFecha || ''} ${newHora || ''}`.substring(0,120), url: '/agenda', tag: `copilot-update-${Date.now()}` }).catch(()=>{});
                        log(`🔄 COPILOTO: ${existing.type} ${existing.id} actualizado`);
                      } else {
                        log(`⚠️ COPILOTO: no se encontró registro para actualizar (${targetName || targetPhone || apptId})`);
                      }
                    } catch(e:any){ log(`❌ COPILOTO actualizar: ${e.message}`); }
                  }

                  // ── ❌ CANCELAR/ELIMINAR ──────────────────────────────────────
                  if (actionToTake === 'cancelar_cita' || actionToTake === 'cancelar_reserva' || actionToTake === 'cancelar_pedido' || actionToTake === 'eliminar_cita' || actionToTake === 'eliminar_pedido' || actionToTake === 'eliminar_reserva') {
                    try {
                      const tipoQuery = (actionToTake.includes('pedido')) ? 'order' : ['appointment','reservation'];
                      const existing = await prisma.appointment.findFirst({
                        where: {
                          userId: ownerId,
                          ...(apptId ? { id: { endsWith: apptId } } : targetPhone ? { clientPhone: { endsWith: targetPhone } } : { clientName: { contains: targetName } }),
                          type: Array.isArray(tipoQuery) ? { in: tipoQuery } : tipoQuery,
                          status: { notIn: ['cancelled'] }
                        },
                        orderBy: { date: 'asc' }
                      });
                      if (existing) {
                        await prisma.appointment.update({
                          where: { id: existing.id },
                          data: { status: 'cancelled', notes: (existing.notes || '') + `\n\n❌ CANCELADO por Copiloto IA — ${new Date().toLocaleString()}` }
                        });
                        sendPushToUser(ownerId, { title: '❌ Cancelado por Copiloto', body: `${existing.clientName || 'Cliente'} — ${existing.type}`.substring(0,120), url: '/agenda', tag: `copilot-cancel-${Date.now()}` }).catch(()=>{});
                        log(`❌ COPILOTO: ${existing.type} ${existing.id} cancelado (${existing.clientName})`);
                      } else {
                        log(`⚠️ COPILOTO: no se encontró registro para cancelar (${targetName || targetPhone || apptId})`);
                      }
                    } catch(e:any){ log(`❌ COPILOTO cancelar: ${e.message}`); }
                  }

                  // ── 🏷️ MOVER ETAPA DE LEAD ──────────────────────────────────
                  if (actionToTake === 'mover_etapa') {
                    try {
                      const convId = memoryData.conversacion_id || '';
                      const newStage = memoryData.nueva_etapa || memoryData.etapa_actual || '';
                      if (convId || targetPhone) {
                        const targetConvEtapa = convId
                          ? await prisma.conversation.findFirst({ where: { userId: ownerId, id: { endsWith: convId } }, select: { id: true } })
                          : await prisma.conversation.findFirst({ where: { userId: ownerId, recipientId: { endsWith: targetPhone }, isGroup: false }, select: { id: true } });
                        if (targetConvEtapa && newStage) {
                          await prisma.conversation.update({ where: { id: targetConvEtapa.id }, data: { stage: newStage } });
                          log(`🏷️ COPILOTO: Lead movido a etapa "${newStage}" (conv: ${targetConvEtapa.id})`);
                        }
                      }
                    } catch(e:any){ log(`❌ COPILOTO mover_etapa: ${e.message}`); }
                  }

                } catch (copiloErr: any) {
                  log(`❌ COPILOTO acciones: ${copiloErr.message}`);
                }
              }
              // ════════ FIN COPILOTO IA ════════════════════════════════════════
              
              // Actualizar conversación con memoria Y etapa
              const updateData: any = { contextData: merged };
              if (detectedStage) {
                if (pipelineStages.length > 0) {
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
                    // ⚠️ Etapa no existe en pipeline configurado — NO guardar para evitar etapas fantasma
                    log(`⚠️ Etapa "${detectedStage}" no está en pipeline, ignorando (no se guarda)`);
                  }
                } else {
                  // Sin pipeline configurado → guardar la etapa directamente
                  updateData.stage = detectedStage;
                  log(`🎯 Etapa sin pipeline configurado, guardando directo: "${detectedStage}"`);
                }
              }
              
              await prisma.conversation.update({
                where: { id: conversationId },
                data: updateData
              });
              
              log(`🧠 Memoria guardada: ${JSON.stringify(merged)}`);
              
              // 🛒 CREAR PEDIDO AUTOMÁTICO CON FECHA DE ENTREGA
              // ✅ VALIDACIÓN ESTRICTA: Solo crear pedido cuando el cliente confirmó TODOS los datos
              const hasName    = !!(merged.nombre);
              const hasPhone   = !!(merged.telefono || merged.celular);
              const hasProduct = !!(merged.producto_servicio || merged.detalles_producto || merged.notas);
              // dirección REAL de calle — no basta solo ciudad o barrio
              const hasRealAddress = !!(merged.direccion);
              const hasCity    = !!(merged.ciudad);
              // Pago confirmado — rechazar "Por definir", vacío o pendiente
              const rawPago = (merged.metodo_pago || '').toLowerCase().trim();
              const hasPayment = !!(rawPago && !['por definir','pendiente',''].includes(rawPago));

              const isDelivery = !!(merged.fecha_entrega);

              let dataComplete: boolean;
              // ⚠️ FIX: crear_pedido SIEMPRE exige checklist completo (delivery)
              // No caer a modo presencial aunque falte fecha_entrega — el pedido de tienda
              // siempre necesita dirección, teléfono y pago confirmado del cliente
              if (actionToTake === 'crear_pedido') {
                // 🛒 PEDIDO: checklist completo OBLIGATORIO sin excepción
                dataComplete = hasName && hasProduct && hasRealAddress && hasCity && hasPhone && hasPayment;
                if (!dataComplete) {
                  const missing = [
                    !hasName        && 'nombre',
                    !hasProduct     && 'producto',
                    !hasRealAddress && 'dirección (calle completa)',
                    !hasCity        && 'ciudad',
                    !hasPhone       && 'teléfono',
                    !hasPayment     && 'método de pago confirmado',
                  ].filter(Boolean).join(', ');
                  log(`⏳ crear_pedido bloqueado — faltan datos obligatorios: ${missing}`);
                }
              } else if (isDelivery) {
                // 🚚 DELIVERY (cita/reserva con domicilio): exige datos completos
                dataComplete = hasName && hasProduct && hasRealAddress && hasCity && hasPhone && hasPayment;
                if (!dataComplete) {
                  const missing = [
                    !hasName        && 'nombre',
                    !hasProduct     && 'producto',
                    !hasRealAddress && 'dirección (calle)',
                    !hasCity        && 'ciudad',
                    !hasPhone       && 'teléfono',
                    !hasPayment     && 'método de pago confirmado',
                  ].filter(Boolean).join(', ');
                  log(`⏳ Cita/reserva delivery pendiente — faltan: ${missing}`);
                }
              } else {
                // 🏪 PRESENCIAL (tienda, CDA, restaurante): solo nombre + producto
                dataComplete = hasName && hasProduct;
                if (!dataComplete) log(`⏳ Cita/reserva presencial pendiente — faltan: ${!hasName ? 'nombre' : 'producto'}`);
              }
              
              if (actionToTake === 'crear_pedido' && merged.pedido !== 'creado') {
                if (!dataComplete) {
                  // dataComplete ya tiene el log detallado arriba
                  // No crear el pedido aún, esperar a que el cliente complete datos
                } else {
                try {
                  // 📅 Fecha de entrega — viene del MEMORY_JSON que maneja el prompt del negocio
                  // El prompt es responsable de calcular la fecha correcta según sus reglas
                  // Fallback genérico: mañana (día+1) si el prompt no la incluyó
                  const deliveryDate = merged.fecha_entrega
                    ? parseSmartDate(merged.fecha_entrega)
                    : (() => { const d = getNowColombia(); d.setDate(d.getDate() + 1); return toStorableDate(d); })();

                  // 🕐 Hora — viene del MEMORY_JSON. Fallback genérico: '10:00'
                  // Cada prompt define su propia hora_entrega según el negocio
                  const deliveryTime = (merged.hora_entrega || '').trim() || '10:00';
                  
                  // 🧩 Construir descripción del producto (compatible con campos nuevos Y viejos)
                  // ✅ GENÉRICO: producto desde campo universal, detalles desde detalles_producto o notas
                  let productoDesc = merged.producto_servicio || merged.detalles_producto || '';
                  const detallesDesc = merged.detalles_producto && merged.producto_servicio ? merged.detalles_producto : '';

                  const orderData: any = {
                    userId: ownerId,
                    type: 'order',
                    clientName: merged.nombre || clientName || 'Cliente WhatsApp',
                    clientPhone: clientPhone.replace('@c.us', '').replace('@s.whatsapp.net', ''),
                    date: deliveryDate,
                    time: deliveryTime,
                    duration: merged.duracion ? parseInt(merged.duracion) : 60,
                    status: 'pending',
                    notes: `📦 PEDIDO WHATSAPP\n` +
                           `━━━━━━━━━━━━━━━\n` +
                           `🛍️ Producto: ${productoDesc || 'N/A'}\n` +
                           (detallesDesc ? `📋 Detalles: ${detallesDesc}\n` : '') +
                           `📦 Cantidad: ${merged.cantidad || '1'}\n` +
                           (merged.precio ? `💰 Precio: $${merged.precio}\n` : '') +
                           (merged.descuento ? `🏷️ Descuento: ${merged.descuento}\n` : '') +
                           `💵 Total: $${merged.total || '0'}\n` +
                           `💳 Pago: ${merged.metodo_pago || 'Por definir'}\n` +
                           `━━━━━━━━━━━━━━━\n` +
                           (merged.direccion ? `📍 Dirección: ${merged.direccion}\n` : '') +
                           (merged.barrio ? `🏘️ Barrio: ${merged.barrio}\n` : '') +
                           (merged.ciudad ? `🏙️ Ciudad: ${merged.ciudad}\n` : '') +
                           ((merged.telefono || merged.celular) ? `📞 Tel: ${merged.telefono || merged.celular}\n` : '') +
                           (merged.notas ? `📝 Notas: ${merged.notas}\n` : '') +
                           `━━━━━━━━━━━━━━━`,
                    total: parseFloat((merged.total || merged.envio || '0').toString().replace(/[^0-9.]/g, '')) || 0,
                    address: [merged.direccion, merged.barrio, merged.ciudad].filter(Boolean).join(', ').trim() || '',
                    whatsappLineId: whatsappLineId || null
                  };

                  // 🔗 AUTO-ASIGNAR RECURSO al pedido (igual que citas y reservas)
                  try {
                    const activeResources = await prisma.resource.findMany({
                      where: { userId: ownerId, isActive: true },
                      orderBy: { order: 'asc' }
                    });
                    if (activeResources.length > 0) {
                      const dateStr = deliveryDate.toISOString().split('T')[0];
                      const dayStart = new Date(dateStr + 'T00:00:00');
                      const dayEnd = new Date(dateStr + 'T23:59:59');
                      const conflicting = await prisma.appointment.findMany({
                        where: { userId: ownerId, date: { gte: dayStart, lte: dayEnd }, status: { notIn: ['cancelled'] } },
                        select: { time: true, duration: true, resourceId: true }
                      });
                      const occupiedCounts = new Map<string, number>();
                      for (const a of conflicting) {
                        if (a.resourceId) occupiedCounts.set(a.resourceId, (occupiedCounts.get(a.resourceId) || 0) + 1);
                      }
                      const freeResource = activeResources.find(r => {
                        const used = occupiedCounts.get(r.id) || 0;
                        return used < (r.capacity || 1);
                      });
                      if (freeResource) {
                        orderData.resourceId = freeResource.id;
                        orderData.resourceName = freeResource.name;
                        log(`🔗 Recurso asignado a pedido: ${freeResource.name}`);
                      } else {
                        log(`⚠️ Sin recurso libre para pedido ${deliveryDate.toISOString().split('T')[0]}`);
                      }
                    }
                  } catch (resErr: any) {
                    log(`⚠️ Error asignando recurso a pedido: ${resErr.message}`);
                  }

                  await prisma.appointment.create({ data: orderData });
                  // Marcar pedido como creado
                  merged.pedido = 'creado';
                  // 🔔 Push — Nuevo pedido
                  sendPushToUser(ownerId, { title: '🛒 ¡Nuevo Pedido!', body: `${merged.nombre || clientName || 'Cliente'} — ${merged.producto_servicio || 'Pedido'}`.substring(0, 120), url: '/agenda', tag: `order-${Date.now()}` }).catch(() => {});
                  // 🤖 Notificar Asistente Personal
                  notifyPersonalAssistant(ownerId, 'pedido', { name: merged.nombre || clientName || 'Cliente', date: deliveryDate.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }), time: to12h(merged.hora_entrega || merged.hora_cita || '12:00'), product: merged.producto_servicio || '', total: merged.total || '', phone: clientPhone.replace('@c.us', '') }).catch(() => {});
                  await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { contextData: merged }
                  });
                  log(`🛒 Pedido agendado para ${deliveryDate.toLocaleDateString('es')} - ${merged.nombre || clientName}`);
                  
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
              
              // 📅 CREAR CITA AUTOMÁTICA
              if (actionToTake === 'crear_cita' && merged.cita !== 'creada') {
                try {
                  // 📅 Parsear fecha y hora inteligente
                  let citaDate = parseSmartDate(merged.fecha_cita || merged.fecha_reserva || '');
                  const citaTime = parseSmartTime(merged.hora_cita || merged.hora_reserva || '', '10:00');

                  // 🕐 AUTO-AVANCE: Si la fecha es hoy pero la hora ya pasó → mover a mañana
                  const nowCol = getNowColombia(userTz);
                  const todayStr = getTodayStringColombia();
                  const citaDateCheck = citaDate.toISOString().split('T')[0];
                  if (citaDateCheck === todayStr) {
                    const [cH, cM] = citaTime.split(':').map(Number);
                    const citaMinutes = cH * 60 + cM;
                    const nowMinutes = nowCol.getHours() * 60 + nowCol.getMinutes();
                    if (citaMinutes <= nowMinutes) {
                      citaDate = toStorableDate(new Date(nowCol.getFullYear(), nowCol.getMonth(), nowCol.getDate() + 1));
                      log(`🕐 Hora ${citaTime} ya pasó hoy → movida a mañana ${citaDate.toISOString().split('T')[0]}`);
                    }
                  }

                  // 📅 Check if day is OPEN in schedule
                  const citaDateStr = citaDate.toISOString().split('T')[0];
                  const citaDayOfWeek = citaDate.getDay();
                  const citaDaySchedule = await prisma.businessSchedule.findFirst({ where: { userId: ownerId, dayOfWeek: citaDayOfWeek } });
                  let dayBlocked = false;
                  if (citaDaySchedule && !citaDaySchedule.isOpen) {
                    dayBlocked = true;
                    const dayNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
                    log(`🚫 Cita bloqueada: ${dayNames[citaDayOfWeek]} está CERRADO en el horario configurado`);
                  }
                  // 🇨🇴 Check holiday — prevent booking on closed holidays
                  const citaHoliday = isColombianHoliday(citaDateStr);
                  let holidayBlocked = false;
                  if (!dayBlocked && citaHoliday) {
                    const holConfig = await prisma.businessSchedule.findFirst({ where: { userId: ownerId, dayOfWeek: 7 } });
                    const workAll = holConfig?.isOpen || false;
                    let workDts: string[] = [];
                    try { workDts = holConfig?.breakStart ? JSON.parse(holConfig.breakStart) : []; } catch {}
                    if (!workAll && !workDts.includes(citaDateStr)) {
                      holidayBlocked = true;
                      log(`🇨🇴 Cita bloqueada: ${citaDateStr} es festivo (${citaHoliday.name})`);
                    }
                  }

                  if (dayBlocked || holidayBlocked) {
                    log(`⚠️ Cita NO creada — día cerrado o festivo`);
                  }

                  if (!dayBlocked && !holidayBlocked) {

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
                           `🗓️ Fecha: ${citaDate.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}\n` +
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
                      
                      // CAPACITY-AWARE: count per-resource, not just occupied IDs
                      const occupiedCounts = new Map<string, number>();
                      for (const a of overlapping) {
                        if (a.resourceId) occupiedCounts.set(a.resourceId, (occupiedCounts.get(a.resourceId) || 0) + 1);
                      }
                      const freeResource = activeResources.find(r => {
                        const used = occupiedCounts.get(r.id) || 0;
                        return used < (r.capacity || 1);
                      });
                      
                      if (freeResource) {
                        appointmentData.resourceId = freeResource.id;
                        appointmentData.resourceName = freeResource.name;
                        appointmentData.duration = slotDur;
                        log(`🔗 Recurso asignado: ${freeResource.name} (${freeResource.id}) — capacidad ${freeResource.capacity || 1}`);
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
                  notifyPersonalAssistant(ownerId, 'cita', { name: merged.nombre || clientName || 'Cliente', date: merged.fecha_cita || 'Pendiente', time: to12h(parseSmartTime(merged.hora_cita || '', '10:00')), phone: clientPhone.replace('@c.us', '') }).catch(() => {});
                  await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { contextData: merged }
                  });
                  
                  log(`📅 CITA CREADA: ${tipoCita} | ${nombreCliente} | ${citaDate.toLocaleDateString('es')} ${citaTime}`);

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
                  } // end if (!holidayBlocked)
                } catch (citaErr: any) {
                  console.error('❌ Error creando cita:', citaErr.message);
                }
              }
              
              // 🏨 CREAR RESERVA AUTOMÁTICA
              if (actionToTake === 'crear_reserva' && merged.reserva !== 'creada') {
                try {
                  // 📅 Parsear fecha y hora inteligente
                  let reservaDate = parseSmartDate(merged.fecha_reserva || merged.fecha_cita || '');
                  const reservaTime = parseSmartTime(merged.hora_reserva || merged.hora_cita || '', '12:00');

                  // 🕐 AUTO-AVANCE: Si la fecha es hoy pero la hora ya pasó → mover a mañana
                  const nowR = getNowColombia(userTz);
                  const todayStrR = getTodayStringColombia();
                  const reservaDateCheck = reservaDate.toISOString().split('T')[0];
                  if (reservaDateCheck === todayStrR) {
                    const [rH, rM] = reservaTime.split(':').map(Number);
                    const resMinutes = rH * 60 + rM;
                    const nowMinutesR = nowR.getHours() * 60 + nowR.getMinutes();
                    if (resMinutes <= nowMinutesR) {
                      reservaDate = toStorableDate(new Date(nowR.getFullYear(), nowR.getMonth(), nowR.getDate() + 1));
                      log(`🕐 Hora ${reservaTime} ya pasó hoy → reserva movida a mañana ${reservaDate.toISOString().split('T')[0]}`);
                    }
                  }

                  // 📅 Check if day is OPEN in schedule
                  const reservaDateStr = reservaDate.toISOString().split('T')[0];
                  const reservaDayOfWeek = reservaDate.getDay();
                  const reservaDaySchedule = await prisma.businessSchedule.findFirst({ where: { userId: ownerId, dayOfWeek: reservaDayOfWeek } });
                  let reservaDayBlocked = false;
                  if (reservaDaySchedule && !reservaDaySchedule.isOpen) {
                    reservaDayBlocked = true;
                    const dayNamesR = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
                    log('🚫 Reserva bloqueada: ' + dayNamesR[reservaDayOfWeek] + ' está CERRADO en el horario configurado');
                  }
                  // 🇨🇴 Check holiday — prevent booking on closed holidays
                  const reservaHoliday = !reservaDayBlocked ? isColombianHoliday(reservaDateStr) : null;
                  let reservaHolidayBlocked = false;
                  if (!reservaDayBlocked && reservaHoliday) {
                    const holCfg = await prisma.businessSchedule.findFirst({ where: { userId: ownerId, dayOfWeek: 7 } });
                    const workAllR = holCfg?.isOpen || false;
                    let workDtsR: string[] = [];
                    try { workDtsR = holCfg?.breakStart ? JSON.parse(holCfg.breakStart) : []; } catch {}
                    if (!workAllR && !workDtsR.includes(reservaDateStr)) {
                      reservaHolidayBlocked = true;
                      log(`🇨🇴 Reserva bloqueada: ${reservaDateStr} es festivo (${reservaHoliday.name})`);
                    }
                  }

                  if (!reservaDayBlocked && !reservaHolidayBlocked) {

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
                           `🗓️ Fecha: ${reservaDate.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}\n` +
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
                      
                      // CAPACITY-AWARE: count per-resource, not just occupied IDs
                      const occupiedCounts2 = new Map<string, number>();
                      for (const a of overlapping) {
                        if (a.resourceId) occupiedCounts2.set(a.resourceId, (occupiedCounts2.get(a.resourceId) || 0) + 1);
                      }
                      const freeResource = activeResources.find(r => {
                        const used = occupiedCounts2.get(r.id) || 0;
                        return used < (r.capacity || 1);
                      });
                      
                      if (freeResource) {
                        reservaData.resourceId = freeResource.id;
                        reservaData.resourceName = freeResource.name;
                        log(`🔗 Recurso asignado a reserva: ${freeResource.name} — capacidad ${freeResource.capacity || 1}`);
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
                  sendPushToUser(ownerId, { title: '🏨 ¡Nueva Reserva!', body: `${merged.nombre || 'Cliente'} — ${merged.tipo_reserva || 'Reserva'} ${merged.fecha_reserva || merged.fecha_cita || ''} ${merged.hora_reserva || merged.hora_cita || ''}`.trim().substring(0, 120), url: '/agenda', tag: `reserv-${Date.now()}` }).catch(() => {});
                  notifyPersonalAssistant(ownerId, 'reserva', { name: merged.nombre || clientName || 'Cliente', date: merged.fecha_reserva || merged.fecha_cita || 'Pendiente', time: to12h(parseSmartTime(merged.hora_reserva || merged.hora_cita || '', '10:00')), phone: clientPhone.replace('@c.us', '') }).catch(() => {});
                  await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { contextData: merged }
                  });
                  
                  log(`🏨 RESERVA CREADA: ${tipoReserva} | ${nombreClienR} | ${numPersonas} personas | ${reservaDate.toLocaleDateString('es')} ${reservaTime}`);

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
                  } // end if (!reservaHolidayBlocked)
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
                             `⏱️ Actualizado: ${new Date().toLocaleString()}\n` +
                             `━━━━━━━━━━━━━━━`,
                      total: parseFloat((merged.total || '0').toString().replace(/[^0-9.]/g, '')) || existingOrder.total,
                      status: 'pending'
                    };
                    if (merged.direccion) updateOrderData.address = [merged.direccion, merged.barrio, merged.ciudad].filter(Boolean).join(', ');
                    if (merged.nombre) updateOrderData.clientName = merged.nombre;
                    
                    // Actualizar fecha si cambió
                    if (merged.fecha_entrega) {
                      updateOrderData.date = parseSmartDate(merged.fecha_entrega);
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

              // ═══ 🔄 ACTUALIZAR CITA/RESERVA (TYPE-AGNOSTIC) ═══
              // AI may use actualizar_cita OR actualizar_reserva regardless of actual DB type
              if ((actionToTake === 'actualizar_cita' || actionToTake === 'actualizar_reserva') && 
                  (merged.cita === 'creada' || merged.reserva === 'creada' || merged.cita === 'actualizada' || merged.reserva === 'actualizada')) {
                try {
                  const phoneCleanU = clientPhone.replace('@c.us', '').replace('@s.whatsapp.net', '');
                  // Search for ANY active appointment/reservation for this phone
                  const existingRecord = await prisma.appointment.findFirst({
                    where: { userId: ownerId, clientPhone: { endsWith: phoneCleanU.slice(-10) }, type: { in: ['appointment', 'reservation'] }, status: { notIn: ['cancelled'] } },
                    orderBy: { createdAt: 'desc' }
                  });
                  if (existingRecord) {
                    const updateData: any = { status: 'pending' };
                    
                    // 🏍️ CASO ESPECIAL: Domicilio — solo agrega dirección sin cambiar fecha/hora
                    const isDomicilio = (merged.tipo_reserva || merged.tipo_cita || '').toLowerCase().includes('domicilio');
                    
                    // Fecha/hora: solo actualizar si NO es domicilio (domicilio mantiene fecha/hora de la cita)
                    if (!isDomicilio) {
                      const newFecha = merged.fecha_cita || merged.fecha_reserva;
                      if (newFecha) updateData.date = parseSmartDate(newFecha);
                      const newHora = merged.hora_cita || merged.hora_reserva;
                      if (newHora) updateData.time = parseSmartTime(newHora, existingRecord.time || '10:00');
                    }
                    
                    if (merged.nombre) updateData.clientName = merged.nombre;
                    
                    // Dirección: actualizar si viene en notas (domicilio) o en dirección directa
                    const domicilioDir = merged.direccion || 
                      (merged.notas ? merged.notas.match(/[Dd]omicilio:\s*([^|]+)/)?.[1]?.trim() : null);
                    if (domicilioDir) updateData.address = domicilioDir;
                    
                    const tipo = merged.tipo_cita || merged.tipo_reserva || existingRecord.type;

                    if (isDomicilio) {
                      // Para domicilio: enriquecer notes originales sin sobreescribirlas
                      const prevNotes = existingRecord.notes || '';
                      const domilicioInfo = `\n\n🏍️ DOMICILIO CONFIRMADO\n━━━━━━━━━━━━━━━\n` +
                        `🏠 Dirección: ${domicilioDir || 'Ver notas'}\n` +
                        `📝 Info adicional: ${merged.notas || ''}\n` +
                        `⏱️ Registrado: ${new Date().toLocaleString()}\n` +
                        `━━━━━━━━━━━━━━━`;
                      // Solo agregar si no está ya registrado
                      updateData.notes = prevNotes.includes('DOMICILIO CONFIRMADO') 
                        ? prevNotes 
                        : prevNotes + domilicioInfo;
                    } else {
                      updateData.notes = `📅 ${tipo.toUpperCase()} — ACTUALIZADA\n` +
                        `━━━━━━━━━━━━━━━\n` +
                        `👤 Cliente: ${merged.nombre || existingRecord.clientName}\n` +
                        `📱 Teléfono: ${phoneCleanU}\n` +
                        `🗓️ Fecha: ${(updateData.date || existingRecord.date).toLocaleDateString?.('es', { weekday: 'long', day: 'numeric', month: 'long' }) || ''}\n` +
                        `🕐 Hora: ${updateData.time || existingRecord.time}\n` +
                        `📋 Tipo: ${tipo}\n` +
                        `⏱️ Actualizado: ${new Date().toLocaleString()}\n` +
                        `━━━━━━━━━━━━━━━`;
                    }

                    await prisma.appointment.update({ where: { id: existingRecord.id }, data: updateData });
                    // Keep status as created so future updates work
                    if (existingRecord.type === 'reservation') merged.reserva = 'creada';
                    else merged.cita = 'creada';
                    merged.accion = '';
                    await prisma.conversation.update({ where: { id: conversationId }, data: { contextData: merged } });
                    if (isDomicilio) {
                      log(`🏍️ DOMICILIO AGREGADO a ${existingRecord.type} ${existingRecord.id} | ${merged.nombre || clientName} | Dir: ${domicilioDir}`);
                      sendPushToUser(ownerId, { title: '🏍️ Domicilio Confirmado', body: `${merged.nombre || 'Cliente'} — Recogida en: ${domicilioDir || 'Ver agenda'}`, url: '/agenda', tag: `domicilio-${Date.now()}` }).catch(() => {});
                    } else {
                      log(`🔄 ${existingRecord.type.toUpperCase()} ACTUALIZADA: ${existingRecord.id} | ${merged.nombre || clientName}`);
                      sendPushToUser(ownerId, { title: '🔄 Cita Actualizada', body: `${merged.nombre || 'Cliente'} actualizó su ${tipo}`, url: '/agenda', tag: `update-${Date.now()}` }).catch(() => {});
                    }
                  } else {
                    log(`⚠️ No se encontró cita/reserva activa para actualizar de ${phoneCleanU}`);
                  }
                } catch (upErr: any) {
                  console.error('❌ Error actualizando cita/reserva:', upErr.message);
                }
              }

              // ═══ 🔄 ACTUALIZAR PEDIDO EXISTENTE ═══
              if (actionToTake === 'actualizar_pedido' && (merged.pedido === 'creado' || merged.pedido === 'actualizado')) {
                try {
                  const phoneCleanU = clientPhone.replace('@c.us', '').replace('@s.whatsapp.net', '');
                  const existingOrder = await prisma.appointment.findFirst({
                    where: { userId: ownerId, type: 'order', clientPhone: { endsWith: phoneCleanU.slice(-10) }, status: { notIn: ['cancelled'] } },
                    orderBy: { createdAt: 'desc' }
                  });
                  if (existingOrder) {
                    const productoDesc = merged.producto_servicio || merged.detalles_producto || '';
                    const updateOrderData: any = {
                      clientName: merged.nombre || existingOrder.clientName,
                      address: merged.direccion || merged.ciudad || existingOrder.address,
                      notes: `🛒 PEDIDO ACTUALIZADO\n━━━━━━━━━━━━━━━\n👤 ${merged.nombre || existingOrder.clientName}\n📱 ${phoneCleanU}\n📦 ${productoDesc}\n📏 Detalles: ${merged.detalles_producto || ''}\n🔢 Cantidad: ${merged.cantidad || ''}\n💰 Total: $${merged.total || ''}\n📍 ${merged.direccion || ''} ${merged.ciudad || ''}\n💳 Pago: ${merged.metodo_pago || ''}\n⏱️ Actualizado: ${new Date().toLocaleString()}\n━━━━━━━━━━━━━━━`
                    };
                    if (merged.fecha_entrega) updateOrderData.date = parseSmartDate(merged.fecha_entrega);
                    await prisma.appointment.update({ where: { id: existingOrder.id }, data: updateOrderData });
                    merged.pedido = 'creado'; // Keep as creado for future updates
                    merged.accion = '';
                    await prisma.conversation.update({ where: { id: conversationId }, data: { contextData: merged } });
                    log(`🔄🛒 PEDIDO ACTUALIZADO: ${existingOrder.id}`);
                  }
                } catch (upErr: any) {
                  console.error('❌ Error actualizando pedido:', upErr.message);
                }
              }

              // ═══ ❌ CANCELAR CITA/RESERVA (TYPE-AGNOSTIC) ═══
              // AI may use cancelar_cita OR cancelar_reserva regardless of actual DB type
              if ((actionToTake === 'cancelar_cita' || actionToTake === 'cancelar_reserva') &&
                  (merged.cita === 'creada' || merged.reserva === 'creada' || merged.cita === 'actualizada' || merged.reserva === 'actualizada')) {
                try {
                  const phoneCleanC = clientPhone.replace('@c.us', '').replace('@s.whatsapp.net', '');
                  // Search for ANY active appointment/reservation for this phone
                  const existingRecord = await prisma.appointment.findFirst({
                    where: { userId: ownerId, clientPhone: { endsWith: phoneCleanC.slice(-10) }, type: { in: ['appointment', 'reservation'] }, status: { notIn: ['cancelled'] } },
                    orderBy: { createdAt: 'desc' }
                  });
                  if (existingRecord) {
                    // 🗑️ ELIMINAR COMPLETAMENTE de Agenda y liberar Recurso
                    await prisma.appointment.delete({ where: { id: existingRecord.id } });
                    // Clear ALL relevant memory fields
                    merged.cita = '';
                    merged.reserva = '';
                    merged.fecha_cita = '';
                    merged.hora_cita = '';
                    merged.fecha_reserva = '';
                    merged.hora_reserva = '';
                    merged.accion = '';
                    await prisma.conversation.update({ where: { id: conversationId }, data: { contextData: merged } });
                    log(`🗑️ ${existingRecord.type.toUpperCase()} ELIMINADA: ${existingRecord.id} | ${existingRecord.clientName} | ${existingRecord.date} ${existingRecord.time} | recurso liberado: ${existingRecord.resourceId || 'ninguno'}`);
                    sendPushToUser(ownerId, { title: '🗑️ Cita/Reserva Eliminada', body: `${existingRecord.clientName || 'Cliente'} canceló — eliminada de agenda`, url: '/agenda', tag: `cancel-${Date.now()}` }).catch(() => {});
                    // 🏷️ Agregar etiqueta "cliente-canceló" en CRM
                    try {
                      const phoneCleanTag = clientPhone.replace('@c.us','').replace('@s.whatsapp.net','');
                      const clientForTag = await prisma.client.findFirst({ where: { userId: ownerId, phone: { endsWith: phoneCleanTag.slice(-10) } } });
                      if (clientForTag) {
                        const existingTags: string[] = (clientForTag.tags as string[]) || [];
                        if (!existingTags.includes('cliente-canceló')) {
                          await prisma.client.update({ where: { id: clientForTag.id }, data: { tags: [...existingTags, 'cliente-canceló'] } });
                          log('🏷️ Etiqueta "cliente-canceló" agregada a ' + (existingRecord.clientName || phoneCleanTag));
                        }
                      }
                      // Also tag on conversation stage
                      await prisma.conversation.update({ where: { id: conversationId }, data: { stage: 'cancelado' } }).catch(() => {});
                    } catch (tagErr: any) { log('⚠️ Error etiqueta cancelación: ' + tagErr.message); }
                  } else {
                    log(`⚠️ No se encontró cita/reserva activa para cancelar de ${phoneCleanC}`);
                  }
                } catch (cancelErr: any) {
                  console.error('❌ Error cancelando cita/reserva:', cancelErr.message);
                }
              }

              // ═══ ❌ CANCELAR PEDIDO ═══
              if (actionToTake === 'cancelar_pedido' && (merged.pedido === 'creado' || merged.pedido === 'actualizado')) {
                try {
                  const phoneCleanC = clientPhone.replace('@c.us', '').replace('@s.whatsapp.net', '');
                  const existingOrder = await prisma.appointment.findFirst({
                    where: { userId: ownerId, type: 'order', clientPhone: { endsWith: phoneCleanC.slice(-10) }, status: { notIn: ['cancelled'] } },
                    orderBy: { createdAt: 'desc' }
                  });
                  if (existingOrder) {
                    // 🗑️ ELIMINAR COMPLETAMENTE de Agenda y liberar Recurso
                    await prisma.appointment.delete({ where: { id: existingOrder.id } });
                    merged.pedido = '';
                    merged.fecha_entrega = '';
                    merged.accion = '';
                    await prisma.conversation.update({ where: { id: conversationId }, data: { contextData: merged } });
                    log(`🗑️ PEDIDO ELIMINADO: ${existingOrder.id} | ${existingOrder.clientName} | recurso liberado: ${existingOrder.resourceId || 'ninguno'}`);
                    sendPushToUser(ownerId, { title: '🗑️ Pedido Eliminado', body: `${existingOrder.clientName || 'Cliente'} canceló su pedido — eliminado de agenda`, url: '/agenda', tag: `cancel-${Date.now()}` }).catch(() => {});
                    // 🏷️ Etiqueta "cliente-canceló" en CRM
                    try {
                      const phoneCleanTagP = clientPhone.replace('@c.us','').replace('@s.whatsapp.net','');
                      const clientForTagP = await prisma.client.findFirst({ where: { userId: ownerId, phone: { endsWith: phoneCleanTagP.slice(-10) } } });
                      if (clientForTagP) {
                        const existingTagsP: string[] = (clientForTagP.tags as string[]) || [];
                        if (!existingTagsP.includes('cliente-canceló')) {
                          await prisma.client.update({ where: { id: clientForTagP.id }, data: { tags: [...existingTagsP, 'cliente-canceló'] } });
                          log('🏷️ Etiqueta "cliente-canceló" agregada a ' + (existingOrder.clientName || phoneCleanTagP));
                        }
                      }
                      await prisma.conversation.update({ where: { id: conversationId }, data: { stage: 'cancelado' } }).catch(() => {});
                    } catch (tagErrP: any) { log('⚠️ Error etiqueta cancelación pedido: ' + tagErrP.message); }
                  }
                } catch (cancelErr: any) {
                  console.error('❌ Error cancelando pedido:', cancelErr.message);
                }
              }
              
            } catch (e) {
              console.error('⚠️ Error parseando memoria:', e);
            }
            // Limpiar el bloque de memoria de la respuesta al cliente
            reply = reply.replace(/<<MEMORY_JSON>>[\s\S]*?<<END_MEMORY>>/g, '').trim();
          }

          // Limpiar también si la IA dejó otros formatos de memoria
          reply = reply.replace(/\[MEMORY_UPDATE\][\s\S]*?\[\/MEMORY_UPDATE\]/g, '').trim();
          reply = reply.replace(/<<CONTEXT:[\s\S]*?>>/g, '').trim();
          
          // 🛡️ SAFETY NET: Limpiar cualquier tag interno residual antes de retornar
          reply = reply.replace(/<<MEMORY_JSON>>[\s\S]*?<<END_MEMORY>>/g, '').trim(); // Double-clean
          reply = reply.replace(/\[SISTEMA:.*?\]/g, '').trim(); // Limpiar recordatorio inyectado
          reply = reply.replace(/<<(?:VOZ|TEXTO)>>/g, '').trim(); // Limpiar si quedaron
          
          // 🛡️ Evitar respuestas vacías o solo espacios/emojis
          const cleanCheck = reply.replace(/[\s\u200B\u200E\uFEFF]/g, '');
          if (!cleanCheck || cleanCheck.length < 2) {
            log(`⚠️ Respuesta IA vacía después de limpieza`);
            continue;
          }

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
    // Limpiar cache de duplicados al transferir (nueva conversación)
    const transferKey = `${userId}_${customerChatId.replace(/@.*/,'')}`;
    lastSentResponses.delete(transferKey);

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

  // 🔒 Activar lock + timeout de seguridad (evita lock permanente ante crashes)
  processingLock.add(bufferKey);
  // [FIX 5] Safety timeout: si en 90s no se liberó el lock (crash/timeout de IA), forzar limpieza
  const lockSafetyTimer = setTimeout(() => {
    if (processingLock.has(bufferKey)) {
      processingLock.delete(bufferKey);
      clog(`⚠️ Lock de seguridad liberado para ${bufferKey} (90s timeout)`);
    }
  }, 90000);

  const { messages: msgs, sessionName, from, senderName, userId, convId, whatsappLineId, firstTimestamp, quotedContext: bufQuotedContext } = buf;
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

  // 🧠 Si es continuación (mensaje pendiente mientras IA procesaba), agregar contexto
  // Esto ayuda a que la IA responda brevemente sin repetir info previa
  const aiMessage = buf.previousContext
    ? `[El cliente agrega a su mensaje anterior "${buf.previousContext}":]\n${combinedMessage}`
    : combinedMessage;

  try {
    // 🔗 Buscar asistente específico de la línea primero
    let assistant = null;
    if (whatsappLineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId, whatsappLineId } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true } });
    }
    if (!assistant) {
      // ⚠️ Sin asistente configurado → no responder, evita respuestas vacías sin contexto
      clog(`⚠️ Sin asistente para userId:${userId} lineId:${whatsappLineId} → mensaje ignorado por IA`);
      return;
    }
    // ✅ Verificar base de conocimiento (context legacy O módulos separados)
    const hasKnowledge = (assistant.context && assistant.context.trim().length >= 10) ||
      !!(( assistant as any).modIdentidad || (assistant as any).modReglas || 
          (assistant as any).modProductos || (assistant as any).modFlujo ||
          (assistant as any).agenteCliente);
    if (!hasKnowledge) {
      clog(`⚠️ Asistente "${assistant.name}" sin base de conocimiento → IA puede responder sin contexto del negocio`);
    }
    
    const isVoiceMode = !!(assistant?.voiceEnabled && assistant?.elevenLabsKey && assistant?.selectedVoice);
    const mediaItems = (assistant?.mediaItems as any[]) || [];
    let matchedMedia = findMediaTrigger(combinedMessage, mediaItems);

    // ⌨️🎙️ Typing/Recording (solo WAHA — Cloud API no soporta)
    if (!isCloudAPI) {
      if (isVoiceMode) {
        await setPresence(sessionName, from, 'recording');
      } else {
        await setPresence(sessionName, from, 'typing');
      }
    }

    // 🛡️ DEDUP: Si ya se envió esta media recientemente, no enviarla de nuevo
    if (matchedMedia && wasMediaRecentlySent(convId, matchedMedia.name)) {
      log(`📎 Media "${matchedMedia.name}" ya enviada recientemente → solo texto IA`);
      matchedMedia = null; // Anular → flujo normal de solo texto
    }

    if (matchedMedia) {
      log(`📎 Trigger multimedia: "${matchedMedia.name}" (tipo: ${matchedMedia.type})`);
      await stopPresence(sessionName, from);

      // ═══ PASO 1: GENERAR Y ENVIAR TEXTO IA PRIMERO ═══
      const aiResponse = await generateAIResponse(userId, aiMessage, convId, whatsappLineId, bufQuotedContext);
      if (!isCloudAPI) await stopPresence(sessionName, from);

      let cleanAiResponse = '';
      if (aiResponse) {
        const mediaTransferResetMatch = aiResponse.match(/<<TRANSFERIR_RESET:(\+?\d{7,15})>>/);
        const mediaTransferMatch = mediaTransferResetMatch || aiResponse.match(/<<TRANSFERIR:(\+?\d{7,15})>>/);
        const mediaIsReset = !!mediaTransferResetMatch;
        cleanAiResponse = aiResponse
          .replace(/<<TRANSFERIR_RESET:\+?\d{7,15}>>/g, '')
          .replace(/<<TRANSFERIR:\+?\d{7,15}>>/g, '')
          .replace(/<<VOZ>>/g, '').replace(/<<TEXTO>>/g, '').trim();
        
        if (cleanAiResponse) {
          if (!isCloudAPI) await humanDelay(cleanAiResponse.length);
          const lastSentPre = lastSentResponses.get(bufferKey);
          const nowPre = Date.now();
          const isDupPre = lastSentPre && lastSentPre.text === cleanAiResponse && (nowPre - lastSentPre.ts) < LAST_SENT_TTL;
          if (!isDupPre) {
            const sendResult1 = await unifiedSendAIResponse(sessionName, from, cleanAiResponse, whatsappLineId);
            if (sendResult1.wamid) wamidCache.set(sendResult1.wamid, cleanAiResponse);
            await prisma.message.create({ data: { conversationId: convId, content: cleanAiResponse, fromMe: true, userId, role: 'assistant' } });
            lastSentResponses.set(bufferKey, { text: cleanAiResponse, ts: nowPre });
            log(`🤖 Respuesta IA (pre-media) → ${senderName}`);
          } else {
            log(`🚫 Pre-media duplicada bloqueada para ${senderName}`);
          }
        }

        if (mediaTransferMatch && whatsappLineId) {
          await new Promise(r => setTimeout(r, 2000));
          await executeLineTransfer(mediaTransferMatch[1], from, senderName, userId, whatsappLineId, convId, cleanAiResponse, mediaIsReset);
        }
      }

      // ═══ PASO 2: ENVIAR MEDIA DESPUÉS DEL TEXTO ═══
      if (!isCloudAPI) {
        await new Promise(r => setTimeout(r, 600 + Math.random() * 600));
      } else {
        await new Promise(r => setTimeout(r, 300));
      }

      let mediaSent = false;
      if (matchedMedia.type === 'catalog' && Array.isArray(matchedMedia.images) && matchedMedia.images.length > 0) {
        log(`📂 Enviando catálogo "${matchedMedia.name}" con ${matchedMedia.images.length} imágenes`);
        let sentCount = 0;
        const matchedWamids: (string | null)[] = [];
        for (let i = 0; i < matchedMedia.images.length; i++) {
          const img = matchedMedia.images[i];
          const designLabel = parseImageDesign(img.name || '');
          const totalImgs = matchedMedia.images.length;
          const baseCaption = matchedMedia.caption || matchedMedia.name;
          const numberedCaption = totalImgs > 1
            ? `${designLabel || baseCaption} — Opción ${i + 1} de ${totalImgs}`
            : (designLabel || baseCaption);
          const imgMedia = { type: 'image', url: img.url, name: img.name || `imagen-${i + 1}` };
          const sent = await unifiedSendMedia(sessionName, from, imgMedia, numberedCaption, whatsappLineId);
          if (sent.ok) {
            sentCount++;
            if (sent.wamid) {
              wamidCache.set(sent.wamid, designLabel || img.name || `Opción ${i+1}`);
              matchedWamids.push(sent.wamid);
            } else { matchedWamids.push(null); }
            // ✅ Guardar cada imagen individualmente con wamid en mediaUrl
            const wamidForUrl = sent.wamid ? `wamid::${sent.wamid}||${numberedCaption}` : (img.url || '');
            await prisma.message.create({ data: {
              conversationId: convId,
              content: numberedCaption,
              fromMe: true, userId, role: 'assistant',
              mediaType: 'image', mediaUrl: wamidForUrl
            }});
            log(`📂 Imagen ${i + 1}/${matchedMedia.images.length} enviada ✅`);
          } else { matchedWamids.push(null); }
          if (i < matchedMedia.images.length - 1) await new Promise(r => setTimeout(r, 1500));
        }
        // Resumen del catálogo (sin duplicar mensajes de imagen)
        if (sentCount > 0) await prisma.message.create({ data: { conversationId: convId, content: `📂 [Catálogo: ${matchedMedia.name} - ${sentCount} imágenes]`, fromMe: true, userId, role: 'assistant', mediaType: 'image' } });
        mediaSent = sentCount > 0;
        if (mediaSent) markMediaSent(convId, matchedMedia.name);
        log(`📂 Catálogo "${matchedMedia.name}" completado: ${sentCount}/${matchedMedia.images.length} imágenes enviadas`);
      } else {
        const sent = await unifiedSendMedia(sessionName, from, matchedMedia, matchedMedia.caption || '', whatsappLineId);
        if (sent) {
          await prisma.message.create({ data: { conversationId: convId, content: `📎 [${matchedMedia.type}: ${matchedMedia.name}]`, fromMe: true, userId, role: 'assistant', mediaType: matchedMedia.type } });
          mediaSent = true;
          markMediaSent(convId, matchedMedia.name);
        } else {
          const fallbackText = matchedMedia.caption
            ? `📎 ${matchedMedia.caption}`
            : `📎 Tengo ${matchedMedia.type === 'image' ? 'una imagen' : matchedMedia.type === 'video' ? 'un video' : 'un audio'} de "${matchedMedia.name}" para mostrarte. Pídeme más detalles 😊`;
          await unifiedSendText(sessionName, from, fallbackText, whatsappLineId);
          await prisma.message.create({ data: { conversationId: convId, content: fallbackText, fromMe: true, userId, role: 'assistant' } });
        }
      }

      await prisma.conversation.update({ where: { id: convId }, data: { lastMessage: cleanAiResponse || `📎 ${matchedMedia.name}` } });

      // ═══ PASO 3: FOLLOW-UP SOLO DESPUÉS DE MEDIA (foto/video) ═══
      if (mediaSent) {
        await sendMediaFollowUp(sessionName, from, userId, convId, matchedMedia.name, matchedMedia.type, aiResponse, whatsappLineId);
      }

    } else {
      // 🤖 Respuesta IA con mensaje combinado
      const aiResponse = await generateAIResponse(userId, aiMessage, convId, whatsappLineId, bufQuotedContext);
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
        let responseMedia = triggerableItems.length > 0 ? findMediaTrigger(cleanResponse, triggerableItems) : null;

        // 🛡️ DEDUP: No reenviar media que ya se mandó recientemente
        if (responseMedia && wasMediaRecentlySent(convId, responseMedia.name)) {
          log(`📎 Media "${responseMedia.name}" ya enviada → solo texto`);
          responseMedia = null;
        }

        if (responseMedia) {
          // ═══ FLUJO: TEXTO PRIMERO → MEDIA DESPUÉS → FOLLOW-UP ═══
          log(`📸 Trigger por RESPUESTA del bot: "${responseMedia.name}" (tipo: ${responseMedia.type})`);

          // PASO 1: Enviar TEXTO primero
          if (!isCloudAPI) {
            await humanDelay(cleanResponse.length);
          }

          const textResult = await unifiedSendAIResponse(sessionName, from, cleanResponse, whatsappLineId);
          const textSent = textResult.ok;
          const botWamid = textResult.wamid;
          if (textSent) {
            if (botWamid) wamidCache.set(botWamid, cleanResponse);
            await prisma.message.create({ data: { conversationId: convId, content: cleanResponse, fromMe: true, userId, role: 'assistant' } });
            await prisma.conversation.update({ where: { id: convId }, data: { lastMessage: cleanResponse } });
            log(`🤖 Respuesta (pre-media) → ${senderName}`);
          }

          // PASO 2: Pausa natural + enviar MEDIA después del texto
          if (!isCloudAPI) {
            await new Promise(r => setTimeout(r, 600 + Math.random() * 600));
          } else {
            await new Promise(r => setTimeout(r, 300));
          }

          if (responseMedia.type === 'catalog' && Array.isArray(responseMedia.images) && responseMedia.images.length > 0) {
            log(`📂 Enviando catálogo "${responseMedia.name}" con ${responseMedia.images.length} imágenes`);
            let sentCount = 0;
            const sentWamids: (string | null)[] = []; // ✅ Colectar wamids para guardar en DB
            for (let i = 0; i < responseMedia.images.length; i++) {
              const img = responseMedia.images[i];
              const designLabel = parseImageDesign(img.name || '');
              const totalImgs = responseMedia.images.length;
              const baseCaption = i === 0 ? (responseMedia.caption || responseMedia.name) : responseMedia.name;
              // ✅ Caption numerado: "América Negro — Opción 1 de 2"
              const numberedCaption = totalImgs > 1
                ? `${designLabel || baseCaption} — Opción ${i + 1} de ${totalImgs}`
                : (designLabel || baseCaption);
              const imgMedia = { type: 'image', url: img.url, name: img.name || `imagen-${i + 1}` };
              const imgResult = await unifiedSendMedia(sessionName, from, imgMedia, numberedCaption, whatsappLineId);
              if (imgResult.ok) {
                sentCount++;
                if (imgResult.wamid) {
                  // ✅ Cache en memoria (rápido) + guardado en DB abajo (persistente entre reinicios)
                  wamidCache.set(imgResult.wamid, designLabel || img.name || `Opción ${i+1}`);
                  sentWamids.push(imgResult.wamid);
                } else {
                  sentWamids.push(null);
                }
              } else {
                sentWamids.push(null);
              }
              if (i < responseMedia.images.length - 1) await new Promise(r => setTimeout(r, 1500));
            }
            // ✅ Guardar cada imagen en DB — wamid embebido en mediaUrl con prefijo "wamid::"
            // Esto evita necesitar nueva columna en DB
            for (let j = 0; j < responseMedia.images.length; j++) {
              const img = responseMedia.images[j];
              if (img.url) {
                const designLabelDb = parseImageDesign(img.name || '');
                const totalImgsDb = responseMedia.images.length;
                const savedContent = totalImgsDb > 1
                  ? `${designLabelDb || img.name} — Opción ${j + 1} de ${totalImgsDb}`
                  : (designLabelDb || img.name || `📷 ${responseMedia.name}`);
                // Formato mediaUrl: "wamid::wamid.HBgM...||contenido" — lookup sin nueva columna
                const wamidForUrl = sentWamids[j]
                  ? `wamid::${sentWamids[j]}||${savedContent}`
                  : img.url;
                await prisma.message.create({ data: { 
                  conversationId: convId, 
                  content: savedContent,
                  fromMe: true, userId, role: 'assistant', 
                  mediaType: 'image',
                  mediaUrl: wamidForUrl
                } });
              }
            }
            log(`📂 Catálogo completado: ${sentCount}/${responseMedia.images.length} imágenes`);
            if (sentCount > 0) markMediaSent(convId, responseMedia.name);
          } else {
            const sent = await unifiedSendMedia(sessionName, from, responseMedia, responseMedia.caption || '', whatsappLineId);
            if (sent) {
              await prisma.message.create({ data: { conversationId: convId, content: `📎 [${responseMedia.type}: ${responseMedia.name}]`, fromMe: true, userId, role: 'assistant', mediaType: responseMedia.type, mediaUrl: responseMedia.url || null } });
              log(`📎 Media enviada por trigger de respuesta: ${responseMedia.name}`);
              markMediaSent(convId, responseMedia.name);
            }
          }

          // PASO 3: Follow-up estratégico SOLO después de foto/video
          await sendMediaFollowUp(sessionName, from, userId, convId, responseMedia.name, responseMedia.type, cleanResponse, whatsappLineId);

        } else {
          // ═══ FLUJO NORMAL SIN TRIGGER: Solo texto ═══
          if (!isCloudAPI) await humanDelay(cleanResponse.length);
        
          if (shouldVoice && assistant?.elevenLabsKey && assistant?.selectedVoice) {
            // 🔊 MODO VOZ: Enviar texto + audio
            const lastSentVoice = lastSentResponses.get(bufferKey);
            const nowVoice = Date.now();
            const isDuplicateVoice = lastSentVoice && lastSentVoice.text === cleanResponse && (nowVoice - lastSentVoice.ts) < LAST_SENT_TTL;
            if (isDuplicateVoice) { clog(`🚫 Voz duplicada bloqueada para ${senderName}`); } else {
            const sent = await unifiedSendAIResponse(sessionName, from, cleanResponse, whatsappLineId);
            if (sent) {
              await prisma.message.create({ data: { conversationId: convId, content: cleanResponse, fromMe: true, userId, role: 'assistant' } });
              await prisma.conversation.update({ where: { id: convId }, data: { lastMessage: cleanResponse } });
              lastSentResponses.set(bufferKey, { text: cleanResponse, ts: nowVoice });
            }}
            
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
            // 🛡️ ANTI-DUPLICADO: Verificar que no sea la misma respuesta que la anterior
            const lastSent = lastSentResponses.get(bufferKey);
            const now = Date.now();
            const isDuplicate = lastSent && 
              lastSent.text === cleanResponse && 
              (now - lastSent.ts) < LAST_SENT_TTL;
            
            if (isDuplicate) {
              clog(`🚫 Respuesta duplicada bloqueada para ${senderName}`);
            } else {
              const sentResult = await unifiedSendAIResponse(sessionName, from, cleanResponse, whatsappLineId);
              if (sentResult.ok) {
                if (sentResult.wamid) wamidCache.set(sentResult.wamid, cleanResponse);
                await prisma.message.create({ data: { conversationId: convId, content: cleanResponse, fromMe: true, userId, role: 'assistant' } });
                await prisma.conversation.update({ where: { id: convId }, data: { lastMessage: cleanResponse } });
                lastSentResponses.set(bufferKey, { text: cleanResponse, ts: now });
                // Limpiar entradas viejas del cache
                for (const [k, v] of lastSentResponses) {
                  if (now - v.ts > LAST_SENT_TTL * 2) lastSentResponses.delete(k);
                }
                clog(`🤖 Respuesta → ${senderName} (${msgs.length} msgs agrupados${isCloudAPI ? ', Cloud' : ''})`);
              }
            }
          }
        }
        } // end transfer else
      }
    }
  } catch (e: any) {
    console.error(`❌ Error procesando buffer de ${senderName}:`, e.message);
  } finally {
    // 🔓 Liberar lock + cancelar safety timer
    clearTimeout(lockSafetyTimer);
    processingLock.delete(bufferKey);

    // 🔄 Verificar si llegaron mensajes mientras procesábamos
    const pending = messageBuffer.get(bufferKey);
    if (pending) {
      clearTimeout(pending.timer);
      
      // 🧠 Agregar contexto para que la IA sepa que es continuación
      // Esto evita que repita información de la respuesta anterior
      const realPendingCount = pending.messages.length;
      if (combinedMessage) {
        pending.previousContext = combinedMessage.substring(0, 120);
      }
      
      // Cloud API: esperar 5s más (webhooks de Meta llegan con delay impredecible)
      // WAHA: esperar 1.5s
      const pendingDelay = pending.isCloud ? 5000 : 1500;
      clog(`🔄 ${realPendingCount} msg(s) pendiente(s) de ${senderName} → procesando en ${(pendingDelay/1000).toFixed(1)}s${pending.isCloud ? ' (Cloud)' : ''}...`);
      pending.timer = setTimeout(() => processBufferedMessages(bufferKey), pendingDelay);
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
          config: { webhooks: [{ url: webhookUrl, events: ['message', 'message.any', 'message.new', 'session.status'] }] }
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
        body: JSON.stringify({ config: { webhooks: [{ url: webhookUrl, events: ['message', 'message.any', 'message.new', 'session.status'] }] } })
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
            webhooks: [{ url: webhookUrl, events: ['message', 'message.any', 'message.new', 'session.status'] }]
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
            events: ['message', 'message.any', 'message.new', 'session.status']
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
      events: ['message', 'message.any', 'message.new', 'session.status']
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
      if (message) sent = (await sendCloudText(lineRecord.cloudPhoneNumberId, lineRecord.cloudAccessToken, cleanNumber, message)).ok;
      if (mediaUrl) {
        const mediaObj = { url: mediaUrl, type: sendMediaType || 'image', name: 'media' };
        sent = (await sendCloudMedia(lineRecord.cloudPhoneNumberId, lineRecord.cloudAccessToken, cleanNumber, mediaObj, !message ? '' : undefined)).ok || sent;
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
        // 🔍 ÚLTIMA BÚSQUEDA ANTI-DUPLICADOS: últimos 7 dígitos sin filtro de línea
        if (cleanNumber.length >= 7) {
          const last7 = cleanNumber.slice(-7);
          conv = await prisma.conversation.findFirst({ 
            where: { userId: ownerId, recipientId: { endsWith: last7 }, isGroup: { not: true } },
            orderBy: { updatedAt: 'desc' }
          });
          if (conv && lineId && !conv.whatsappLineId) {
            await prisma.conversation.update({ where: { id: conv.id }, data: { whatsappLineId: lineId } }).catch(() => {});
          }
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

        // 💬 PASO 1: Enviar TEXTO PRIMERO
        if (message) {
          // Variación invisible para anti-spam
          const variations = ['', ' ', '\u200B', '\u200E'];
          const variedMsg = message + variations[i % variations.length];
          const textSent = await sendWahaMessage(sessionName!, chatId, variedMsg);
          if (!textSent) { failed++; continue; }
        }

        // 📎 PASO 2: Enviar MEDIA DESPUÉS del texto
        if (mediaUrl) {
          if (message) await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
          const mediaObj = { url: mediaUrl, type: bulkMediaType || 'image', name: 'media' };
          const mediaSent = await sendWahaMedia(sessionName!, chatId, mediaObj);
          if (!mediaSent) { log(`⚠️ Media falló para ${phone}`); }
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
// ===== ACTUALIZAR CONTACTO / CONVERSACIÓN =====
// =====================================================
router.put('/conversations/:id/update-contact', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    const { recipientName, stage, contextData, leadScore } = req.body;

    // Verify ownership
    const conv = await prisma.conversation.findFirst({ where: { id, userId } });
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    const updateData: any = {};
    if (recipientName !== undefined) updateData.recipientName = recipientName;
    if (stage !== undefined) updateData.stage = stage;
    if (contextData !== undefined) updateData.contextData = contextData;
    if (leadScore !== undefined) updateData.leadScore = leadScore;

    const updated = await prisma.conversation.update({
      where: { id },
      data: updateData
    });

    res.json(updated);
  } catch (e: any) {
    console.error('❌ update-contact error:', e.message);
    res.status(500).json({ error: 'Error actualizando contacto' });
  }
});

// =====================================================
// ===== WEBHOOK PÚBLICO (recibe mensajes WhatsApp) =====
// =====================================================
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const { event, session, payload } = req.body;
    const sessionName = session || 'default';

    // [FIX 1] Aceptar TODOS los eventos de mensaje de WAHA Plus:
    // WEBJS engine: 'message' | NOWEB engine: 'message.any' | ambos posibles
    // También ignorar session.status y otros eventos no relevantes
    const isMessageEvent = event === 'message' || event === 'message.any' || event === 'message.new';
    if (!event || !isMessageEvent) { res.json({ success: true }); return; }
    
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

    // [FIX 2] Dedup SOLO si NO tenemos msgId confiable (evitar desechar mensajes legítimos)
    // Ventana reducida a 3s (era 10s) — solo para webhooks duplicados reales
    const rawBody = payload?.body || payload?.text || payload?.content || '';
    const rawFrom = payload?.from || payload?.chatId || '';
    // Solo aplicar dedup por contenido si el msgId era vacío (no lo pudo deduplicar por ID)
    if (!msgId && rawBody) {
      const contentDedupKey = `${rawFrom}:${rawBody.substring(0, 80)}:${Math.floor(Date.now() / 3000)}`; // ventana 3s
      if (recentlyProcessed.has(contentDedupKey)) {
        log(`🔄 Duplicado por contenido (sin ID) ignorado: "${rawBody.substring(0, 40)}"`);
        res.json({ success: true }); return;
      }
      recentlyProcessed.add(contentDedupKey);
      setTimeout(() => recentlyProcessed.delete(contentDedupKey), 5000);
    }

    const from = payload?.from || payload?.chatId || payload?.key?.remoteJid || '';
    let body = payload?.body || payload?.text || payload?.content || '';
    const notifyName = payload?.notifyName || payload?.pushName || payload?._data?.notifyName || '';

    // 💬 QUOTED MESSAGE — cuando el usuario responde a un mensaje específico
    // WAHA WEBJS: payload._data.quotedMsg | WAHA NOWEB: payload.contextInfo.quotedMessage
    const quotedMsg = payload?._data?.quotedMsg || payload?.contextInfo?.quotedMessage || payload?.quotedMessage || null;
    let quotedContext = '';
    if (quotedMsg) {
      const quotedBody = quotedMsg?.body || quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '';
      const quotedType = quotedMsg?.type || quotedMsg?.imageMessage ? 'imagen' : quotedMsg?.documentMessage ? 'documento' : 'texto';
      const quotedCaption = quotedMsg?.caption || quotedMsg?.imageMessage?.caption || quotedMsg?.documentMessage?.caption || '';
      // Si es imagen/media, usar filename o caption como referencia
      const rawImgName = quotedMsg?.documentMessage?.fileName || quotedCaption || '';
      const parsedDesign = rawImgName ? parseImageDesign(rawImgName) : '';
      const quotedMedia = quotedMsg?.type === 'image' || quotedMsg?.imageMessage
        ? `[cliente seleccionó imagen: ${parsedDesign || quotedCaption || 'sin caption'}]`
        : quotedMsg?.type === 'document' || quotedMsg?.documentMessage
        ? `[documento: ${rawImgName || 'sin nombre'}]`
        : '';
      const quotedText = quotedBody || quotedMedia;
      if (quotedText) {
        quotedContext = `[Respondiendo a: "${quotedText.substring(0, 120)}"] `;
        log('Quoted: "' + quotedText.substring(0, 80) + '"');
      }
    }



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

    // 🚫 Filtrar: historias/estados, broadcast, newsletters de Meta (publicidad)
    const isSpam = !from || 
      from.includes('@broadcast') || 
      from.includes('status@') || 
      from === 'status@broadcast' ||
      from.includes('@newsletter');  // ← newsletters/publicidad de Meta
    if (isSpam) {
      if (from) log('🚫 Ignorado: mensaje no válido (' + from + ')');
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

    // 📍 WAHA: Detectar mensajes de ubicación
    if (!body && (payload?.type === 'location' || payload?._data?.type === 'location')) {
      const locLat = payload?.location?.lat || payload?.location?.latitude || payload?._data?.lat;
      const locLon = payload?.location?.lng || payload?.location?.longitude || payload?._data?.lng;
      if (locLat && locLon) {
        const mapsLink = "https://maps.google.com/?q=" + locLat + "," + locLon;
        // Load coverage config from assistant (generic — only active if configured)
        let coverageMsg = "";
        try {
          const waLine = await prisma.whatsappLine.findFirst({ where: { sessionName }, select: { userId: true, id: true } });
          if (waLine) {
            const asst = await prisma.assistant.findFirst({
              where: { userId: waLine.userId, isActive: true },
              select: { coverageLat: true, coverageLon: true, coverageRadiusKm: true }
            });
            if (asst?.coverageLat && asst?.coverageLon && asst?.coverageRadiusKm) {
              const cov = checkCoverageRadius(parseFloat(locLat), parseFloat(locLon), asst.coverageLat, asst.coverageLon, asst.coverageRadiusKm);
              coverageMsg = "\n[SISTEMA COBERTURA]: " + cov.mensaje;
              console.log("📍 WAHA Cobertura: " + locLat + ", " + locLon + " → " + (cov.dentro ? "DENTRO" : "FUERA") + " (" + cov.distanciaKm + "km)");
            }
          }
        } catch (covErr) { /* no coverage config, skip */ }
        body = "📍 El cliente compartió su ubicación por WhatsApp.\nCoordenadas: " + locLat + ", " + locLon + "\nVer en Maps: " + mapsLink + coverageMsg;
      } else {
        body = "📍 El cliente compartió una ubicación (sin coordenadas válidas)";
      }
    }

    // [FIX 4] Si no hay body pero hay media detectada, usar placeholder
    // Esto evita que la conversación no se cree cuando el cliente manda
    // un sticker/audio que falla en descargar
    if (!body) {
      // Stickers: ignorar completamente — no pasar a IA
      if (media?.mediaType === 'sticker' || payload?.type === 'sticker') {
        res.json({ success: true }); return;
      }
      if (media.hasMedia) {
        body = `📎 [Archivo multimedia - ${media.mediaType || 'desconocido'}]`;
      } else if (payload?.type && payload.type !== 'chat') {
        // Tipo de mensaje no estándar (reacción, contacto, etc.)
        body = `[Mensaje ${payload.type}]`;
      } else {
        // Realmente vacío — ignorar
        res.json({ success: true }); return;
      }
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

    // 🚫 ANTI-LOOP: ignorar mensajes del propio número de la línea
    // Previene loops infinitos donde el bot se responde a sí mismo
    if (waLine?.phone) {
      const linePhone = waLine.phone.replace(/\D/g, '').slice(-10);
      const senderPhone = recipientId.replace(/\D/g, '').slice(-10);
      if (linePhone === senderPhone) {
        log(`🚫 ANTI-LOOP: mensaje ignorado — remitente (${senderPhone}) ES la línea propia`);
        res.json({ success: true }); return;
      }
    }



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
      // 🔍 ÚLTIMA BÚSQUEDA ANTI-DUPLICADOS: buscar por últimos 7 dígitos
      if (!isGroup && recipientId.length >= 7) {
        const last7 = recipientId.replace(/\D/g, '').slice(-7);
        // Primero en la misma línea
        if (whatsappLineId) {
          conv = await prisma.conversation.findFirst({ 
            where: { userId, recipientId: { endsWith: last7 }, whatsappLineId, isGroup: { not: true } },
            orderBy: { updatedAt: 'desc' }
          });
        }
        // Solo buscar en otras líneas si la conv no tiene línea asignada aún
        if (!conv) {
          conv = await prisma.conversation.findFirst({ 
            where: { userId, recipientId: { endsWith: last7 }, whatsappLineId: null, isGroup: { not: true } },
            orderBy: { updatedAt: 'desc' }
          });
        }
        if (conv) {
          log(`Anti-duplicado: encontrada conv existente ${conv.recipientId} para ${recipientId} (match ultimos 7)`);
          if (whatsappLineId && !conv.whatsappLineId) {
            await prisma.conversation.update({ where: { id: conv.id }, data: { whatsappLineId } }).catch(() => {});
          }
          if (recipientId.length > (conv.recipientId?.length || 0)) {
            await prisma.conversation.update({ where: { id: conv.id }, data: { recipientId } }).catch(() => {});
          }
        }
      }
    }
    
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
        firstTimestamp: now, lastTimestamp: now, hasMedia: isMediaMsg, isCloud: false,
        quotedContext: quotedContext || undefined
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
        firstTimestamp: now, lastTimestamp: now, hasMedia: isMediaMsg, isCloud: false,
        quotedContext: quotedContext || undefined
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
          // ⚠️ Etapa de la IA no reconocida en pipeline configurado
          // NUNCA borrar etapa_actual ni resetear a primera etapa — simplemente saltar
          log(`⚠️ quick-stage-sync: etapa "${iaStage}" no válida en pipeline, ignorando (no resetear)`);
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
        const errCode = status.errors?.[0]?.code || '';
        const errMsg = status.errors?.[0]?.message || 'Unknown';
        // Código 131053 = error en carga de medios (imagen muy pesada o formato inválido)
        // Código 131047 = mensaje re-enviado por el cliente (forward)
        if (errCode !== 131047) { // No loggear re-envíos normales
          console.log(`☁️ [CLOUD] ❌ Msg falló → ${status.recipient_id}: [${errCode}] ${errMsg}`);
        }
      }
    }
    
    // Process messages
    for (const msg of (value.messages || [])) {
      const from = msg.from;
      const msgType = msg.type;
      const msgId = msg.id;
      
      // 🚫 ANTI-LOOP Cloud: ignorar si el remitente ES el número de la línea propia
      if (line.phone) {
        const linePhone = line.phone.replace(/\D/g, '').slice(-10);
        const senderPhone = from.replace(/\D/g, '').slice(-10);
        if (linePhone === senderPhone) {
          console.log(`☁️ 🚫 ANTI-LOOP: ignorado auto-mensaje de ${from} (es la línea propia)`);
          continue;
        }

      }
      
      console.log(`☁️ [CLOUD] 📩 Mensaje de ${from} | tipo: ${msgType} | id: ${msgId}`);
      
      if (msgId && recentlyProcessed.has(msgId)) { console.log(`☁️ [CLOUD] ⏭️ Duplicado, ignorando`); continue; }
      if (msgId) { recentlyProcessed.add(msgId); setTimeout(() => recentlyProcessed.delete(msgId), 60000); }
      
      // Guardar wamid del mensaje entrante para lookup futuro de quoted
      const incomingWamid = msgId || null;
      
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

      // 💬 QUOTED MESSAGE — context.from + context.id (Meta no incluye el texto)
      const cloudQuotedMsgId = msg.context?.id || null;
      const cloudQuotedFrom = msg.context?.from || null;
      let cloudQuotedContext = '';


      // Resolver texto del quoted usando el earlyBuffer (ya tiene convId si es ráfaga)
      // o buscando la conv directamente
      if (cloudQuotedMsgId && cloudQuotedFrom) {
        try {
          const rId = from.replace(/\D/g, '');
          // Intentar usar earlyBuffer primero (ya tiene convId)
          const existingBuf = messageBuffer.get(`${userId}_${rId}`);
          const resolveConvId = existingBuf?.convId || null;

          // Si no hay buffer, buscar conv en DB
          let finalConvId = resolveConvId;
          if (!finalConvId) {
            const qConv = await prisma.conversation.findFirst({
              where: { userId, recipientId: { endsWith: rId.slice(-10) } },
              orderBy: { updatedAt: 'desc' },
              select: { id: true }
            });
            finalConvId = qConv?.id || null;
          }



          if (finalConvId) {
            // Buscar por wamid EXACTO
            // Buscar en wamidCache (en memoria, sin DB)
            if (cloudQuotedMsgId) {
              // ✅ LOOKUP 1: wamidCache en memoria (rápido, disponible si no hubo restart)
              const cached = wamidCache.get(cloudQuotedMsgId);
              if (cached) {
                const parsedCached = parseImageDesign(cached);
                const finalCached = parsedCached !== cached ? `cliente seleccionó: ${parsedCached}` : cached;
                cloudQuotedContext = finalCached.substring(0, 120);
                log('💬 Quoted (cache): "' + cloudQuotedContext.substring(0, 60) + '"');
              } else {
                // ✅ LOOKUP 2: DB fallback — buscar en mediaUrl el prefijo "wamid::{id}"
                // No requiere nueva columna — usa mediaUrl existente
                try {
                  const wamidPrefix = `wamid::${cloudQuotedMsgId}||`;
                  const dbMsg = await prisma.message.findFirst({
                    where: { 
                      fromMe: true,
                      mediaType: 'image',
                      mediaUrl: { startsWith: wamidPrefix }
                    },
                    select: { content: true, mediaUrl: true },
                    orderBy: { timestamp: 'desc' }
                  });
                  if (dbMsg?.mediaUrl?.startsWith(wamidPrefix)) {
                    // Extraer contenido después del "||"
                    const dbContent = dbMsg.mediaUrl.split('||')[1] || dbMsg.content;
                    const parsedDb = parseImageDesign(dbContent);
                    const finalDb = `cliente seleccionó: ${parsedDb || dbContent}`;
                    cloudQuotedContext = finalDb.substring(0, 120);
                    // Repoblar cache para próximas veces
                    wamidCache.set(cloudQuotedMsgId, dbContent);
                    log('💬 Quoted (DB fallback): "' + cloudQuotedContext.substring(0, 60) + '"');
                  }
                } catch (dbLookupErr: any) {
                  log('⚠️ DB wamid lookup error: ' + dbLookupErr.message);
                }
              }
            }
          }
        } catch (qErr: any) {
          log('⚠️ Error quoted: ' + qErr.message);
        }
      }

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
            if (mediaRes.ok) {
              const mediaData = (await mediaRes.json()) as any;
              const mediaDownloadUrl = mediaData.url;
              // For images: download full content and store as base64 (temp URLs expire!)
              if (mediaDownloadUrl && (msgType === 'image' || msgType === 'video' || msgType === 'sticker')) {
                try {
                  const fullRes = await fetch(mediaDownloadUrl, {
                    headers: { 'Authorization': `Bearer ${line.cloudAccessToken}` }
                  });
                  if (fullRes.ok) {
                    const imgBuf = Buffer.from(await fullRes.arrayBuffer());
                    const mime = fullRes.headers.get('content-type') || (msgType === 'image' ? 'image/jpeg' : 'video/mp4');
                    savedMediaUrl = `data:${mime};base64,${imgBuf.toString('base64')}`;
                    log(`☁️ 🖼️ ${msgType} descargado: ${imgBuf.length} bytes → base64`);
                  } else {
                    savedMediaUrl = mediaDownloadUrl;
                  }
                } catch {
                  savedMediaUrl = mediaDownloadUrl;
                }
              } else {
                savedMediaUrl = mediaDownloadUrl || null;
              }
            }
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
        if (msgType === 'image' && savedMediaUrl) {
          try {
            let imgBuf: Buffer;
            let imgMime = 'image/jpeg';
            // If base64, extract buffer directly (no re-download needed)
            if (savedMediaUrl.startsWith('data:')) {
              const match = savedMediaUrl.match(/^data:(.+?);base64,(.+)$/s);
              if (match) {
                imgMime = match[1];
                imgBuf = Buffer.from(match[2], 'base64');
              } else { throw new Error('Invalid base64 data URL'); }
            } else if (line.cloudAccessToken) {
              const imgRes = await fetch(savedMediaUrl, { headers: { 'Authorization': `Bearer ${line.cloudAccessToken}` } });
              if (!imgRes.ok) throw new Error(`Fetch failed: ${imgRes.status}`);
              imgBuf = Buffer.from(await imgRes.arrayBuffer());
              imgMime = imgRes.headers.get('content-type') || 'image/jpeg';
            } else { throw new Error('No access token'); }

            const owner = await prisma.user.findUnique({ where: { id: userId }, select: { apiKey: true } });
            const apiKey = owner?.apiKey || process.env.OPENAI_API_KEY;
            if (apiKey) {
              const assistantCtx = await prisma.assistant.findFirst({ where: { userId, isActive: true }, select: { businessInfo: true, context: true } });
              const bizCtx = assistantCtx?.businessInfo || assistantCtx?.context || '';
              const desc = await analyzeImageWithVision(imgBuf!, imgMime, apiKey, bizCtx.substring(0, 500));
              if (desc) {
                const cap = caption ? ` (caption: "${caption}")` : '';
                messageBody = `[El cliente envió una imagen${cap}. Contenido: ${desc}]`;
                log(`☁️ 👁️ Cloud imagen analizada: "${desc.substring(0, 100)}"`);
              }
            }
          } catch (vErr: any) { log(`☁️ ⚠️ Vision error: ${vErr.message}`); }
        }
      } else if (msgType === 'location') {
        const locLat = msg.location?.latitude;
        const locLon = msg.location?.longitude;
        if (locLat && locLon) {
          const mapsLink = "https://maps.google.com/?q=" + locLat + "," + locLon;
          // Load coverage config — generic, only if assistant has it configured
          let coverageMsg = "";
          try {
            const asst = await prisma.assistant.findFirst({
              where: { userId, isActive: true },
              select: { coverageLat: true, coverageLon: true, coverageRadiusKm: true }
            });
            if (asst?.coverageLat && asst?.coverageLon && asst?.coverageRadiusKm) {
              const cov = checkCoverageRadius(locLat, locLon, asst.coverageLat, asst.coverageLon, asst.coverageRadiusKm);
              coverageMsg = "\n[SISTEMA COBERTURA]: " + cov.mensaje;
              console.log("☁️ 📍 Cobertura: " + locLat + ", " + locLon + " → " + (cov.dentro ? "DENTRO" : "FUERA") + " (" + cov.distanciaKm + "km)");
            }
          } catch { /* no coverage config, skip */ }
          messageBody = "📍 El cliente compartió su ubicación por WhatsApp.\nCoordenadas: " + locLat + ", " + locLon + "\nVer en Maps: " + mapsLink + coverageMsg;
        } else {
          messageBody = "📍 El cliente compartió una ubicación (sin coordenadas válidas)";
        }
      } else if (msgType === 'contacts') {
        const c = msg.contacts?.[0];
        messageBody = `👤 Contacto: ${c?.name?.formatted_name || 'Sin nombre'} - ${c?.phones?.[0]?.phone || ''}`;
      } else if (msgType === 'sticker') {
        continue; // 🏷️ Stickers: ignorar silenciosamente — no pasar a IA
      } else if (msgType === 'reaction') { continue; }
      else { messageBody = `[${msgType}]`; }
      
      if (!messageBody && !savedMediaType) continue;
      if (!messageBody && savedMediaType === 'image') messageBody = '📷 [Imagen enviada por el cliente]';
      if (!messageBody && savedMediaType === 'video') messageBody = '🎬 [Video recibido]';
      if (!messageBody && savedMediaType) messageBody = `📎 [${savedMediaType}]`;
      
      const recipientId = from.replace(/\D/g, '');
      
      // ⚡ EARLY BUFFER CHECK — Agregar al buffer ANTES de cualquier await
      // Esto previene race condition: el timer puede dispararse durante un await de DB
      // Excluir comandos especiales (0=pausar, .=resumir) que necesitan procesamiento directo
      const bufferKey = `${userId}_${recipientId}`;
      const earlyBuffer = messageBuffer.get(bufferKey);
      const isSpecialCommand = messageBody.trim() === '0' || messageBody.trim() === '.';
      if (earlyBuffer && messageBody && !isSpecialCommand) {
        // Buffer existe → agregar inmediatamente (sync, sin await)
        earlyBuffer.messages.push(messageBody);
        earlyBuffer.lastTimestamp = Date.now();
        // Si este mensaje tiene quoted context y el buffer no lo tiene aún, agregarlo
        if (cloudQuotedContext && !earlyBuffer.quotedContext) earlyBuffer.quotedContext = cloudQuotedContext;
        clearTimeout(earlyBuffer.timer);
        const delay = getSmartDelay(messageBody, earlyBuffer.messages.length, earlyBuffer.firstTimestamp, true);
        earlyBuffer.timer = setTimeout(() => processBufferedMessages(bufferKey), delay);
        clog(`☁️ 📦 Buffer Cloud: +1 de ${senderName} (total: ${earlyBuffer.messages.length}, espera: ${(delay/1000).toFixed(1)}s) [early]`);
        
        // Guardar en DB async (no bloquea el buffer)
        const convId = earlyBuffer.convId;
        const displayContent = savedMediaType === 'audio' ? `🎤 ${messageBody}` : messageBody;
        prisma.message.create({
          data: {
            conversationId: convId, content: displayContent || '[Media]', fromMe: false,
            userId, role: 'user',
            ...(savedMediaType && { mediaType: savedMediaType }),
            ...(savedMediaUrl && { mediaUrl: savedMediaUrl })
          }
        }).catch(() => {});
        prisma.conversation.update({ where: { id: convId }, data: { lastMessage: displayContent, recipientName: senderName } }).catch(() => {});
        console.log(`☁️ [CLOUD] ✅ Mensaje guardado: "${displayContent?.substring(0, 50)}" → conv: ${convId}`);
        continue; // Ya está en el buffer, siguiente mensaje
      }

      // Find or create conversation
      let conv = await prisma.conversation.findFirst({ where: { userId, recipientId, whatsappLineId } });
      if (!conv) conv = await prisma.conversation.findFirst({ where: { userId, recipientId: { endsWith: recipientId.slice(-10) }, whatsappLineId } });
      // 🔍 ANTI-DUPLICADOS: buscar en misma línea primero, luego global
      if (!conv && recipientId.length >= 7) {
        // Primero buscar en la misma línea (evita cross-line contamination)
        if (whatsappLineId) {
          conv = await prisma.conversation.findFirst({ 
            where: { userId, recipientId: { endsWith: recipientId.slice(-7) }, whatsappLineId, isGroup: { not: true } },
            orderBy: { updatedAt: 'desc' }
          });
        }
        // Solo si no encontramos en la línea actual, buscar en conversaciones SIN línea asignada
        if (!conv) {
          conv = await prisma.conversation.findFirst({ 
            where: { userId, recipientId: { endsWith: recipientId.slice(-7) }, whatsappLineId: null, isGroup: { not: true } },
            orderBy: { updatedAt: 'desc' }
          });
          if (conv && whatsappLineId) {
            // Asignar la línea correcta a esta conversación huérfana
            await prisma.conversation.update({ where: { id: conv.id }, data: { whatsappLineId } }).catch(() => {});
          }
        }
      }
      if (!conv) {
        conv = await prisma.conversation.create({
          data: { userId, recipientId, recipientName: senderName, lastMessage: messageBody, stage: 'new', whatsappLineId }
        });
        console.log(`☁️ [CLOUD] 🆕 Nueva conversación creada: ${senderName} (${recipientId}) → convId: ${conv.id}`);
      } else {
        console.log(`☁️ [CLOUD] 📂 Conversación existente: ${conv.id} (${recipientId})`);
      }
      
      // Save message
      // 💬 QUOTED MESSAGE Cloud API — detecta si el cliente respondió a un mensaje
      const cloudQuotedContent = msg.context?.id ? '📩 Respondió a un mensaje' : undefined;
      const displayContent = savedMediaType === 'audio' ? `🎤 ${messageBody}` : messageBody;
      await prisma.message.create({
        data: {
          conversationId: conv.id, content: displayContent || '[Media]', fromMe: false,
          userId, role: 'user',
          ...(savedMediaType && { mediaType: savedMediaType }),
          ...(savedMediaUrl && { mediaUrl: savedMediaUrl }),
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
      // 📦 Buffer handling (bufferKey already defined above in early check)
      const existingBuffer = messageBuffer.get(bufferKey);
      const chatIdForSend = `${recipientId}@c.us`;
      const now = Date.now();

      // quoted context ya fue resuelto antes del early buffer check

      if (existingBuffer) {
        existingBuffer.messages.push(messageBody);
        existingBuffer.lastTimestamp = now;
        clearTimeout(existingBuffer.timer);
        const delay = getSmartDelay(messageBody, existingBuffer.messages.length, existingBuffer.firstTimestamp, true);
        existingBuffer.timer = setTimeout(() => processBufferedMessages(bufferKey), delay);
        clog(`☁️ 📦 Buffer Cloud: +1 de ${senderName} (total: ${existingBuffer.messages.length}, espera: ${(delay/1000).toFixed(1)}s)`);
      } else if (processingLock.has(bufferKey)) {
        // 🔒 IA procesando → guardar SIN timer (el finally lo recoge)
        messageBuffer.set(bufferKey, {
          messages: [messageBody], timer: null as any, sessionName,
          from: chatIdForSend, senderName, userId,
          convId: conv.id, whatsappLineId,
          firstTimestamp: now, lastTimestamp: now, hasMedia: false, isCloud: true,
          quotedContext: cloudQuotedContext || undefined
        });
        clog(`☁️ 🔒 Lock activo → "${messageBody.substring(0, 50)}" de ${senderName} guardado (se procesará al terminar IA)`);
      } else {
        const delay = getSmartDelay(messageBody, 0, now, true);
        const timer = setTimeout(() => processBufferedMessages(bufferKey), delay);
        messageBuffer.set(bufferKey, {
          messages: [messageBody], timer, sessionName,
          from: chatIdForSend, senderName, userId,
          convId: conv.id, whatsappLineId,
          firstTimestamp: now, lastTimestamp: now, hasMedia: false, isCloud: true,
          quotedContext: cloudQuotedContext || undefined
        });
        clog(`☁️ 📦 Buffer Cloud: nuevo de ${senderName} → espera ${(delay/1000).toFixed(1)}s (bufferKey: ${bufferKey})`);
      }
    }
  } catch (e: any) {
    console.error('☁️ Cloud webhook error:', e.message);
  }
});

export default router;

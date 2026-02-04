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
// ====================================================
const BUFFER_WAIT_MS = 3000;
const messageBuffer: Map<string, {
  messages: string[];
  timer: ReturnType<typeof setTimeout>;
  sessionName: string;
  from: string;
  senderName: string;
  userId: string;
  convId: string;
  lineId?: string;
}> = new Map();

// ===== SESSION MANAGEMENT =====
const getUserSessionName = (userId: string): string => `user_${userId}`;
const getLineSessionName = (lineId: string): string => `line_${lineId}`;

const getOwnerId = async (userId: string): Promise<string> => {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  return u?.parentUserId || userId;
};

// Check WAHA session status
const checkWahaSession = async (sessionName: string): Promise<any | null> => {
  try {
    const r = await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}`, { headers: getWahaHeaders() });
    if (r.ok) {
      const d = await r.json() as any;
      return d;
    }
  } catch {}
  return null;
};

// Legacy: find any active session for a user (backward compat)
const findActiveSession = async (userId: string): Promise<{ name: string; data: any } | null> => {
  const ownerId = await getOwnerId(userId);
  
  // 1. Check multi-line sessions first
  const lines = await prisma.whatsappLine.findMany({ 
    where: { userId: ownerId, isActive: true },
    orderBy: { isDefault: 'desc' }
  });
  
  for (const line of lines) {
    const d = await checkWahaSession(line.sessionName);
    if (d && ['WORKING', 'CONNECTED', 'SCAN_QR_CODE', 'STARTING'].includes(d.status)) {
      return { name: line.sessionName, data: d };
    }
  }

  // 2. Fallback: legacy user_ session
  for (const sn of [getUserSessionName(ownerId), 'default']) {
    const d = await checkWahaSession(sn);
    if (d && ['WORKING', 'CONNECTED', 'SCAN_QR_CODE', 'STARTING'].includes(d.status)) {
      return { name: sn, data: d };
    }
  }
  return null;
};

// Resolve which user owns a session (updated for multi-line)
const resolveUserFromWebhook = async (sessionName: string, recipientId: string): Promise<{ userId: string; lineId?: string } | null> => {
  // 1. Check if it's a line_ session
  if (sessionName.startsWith('line_')) {
    const lineId = sessionName.replace('line_', '');
    const line = await prisma.whatsappLine.findFirst({ where: { id: lineId } });
    if (line) return { userId: line.userId, lineId: line.id };
  }

  // 2. Check if it's a user_ session
  if (sessionName.startsWith('user_')) {
    const uid = sessionName.replace('user_', '');
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, parentUserId: true } });
    if (u) return { userId: u.parentUserId || u.id };
  }

  // 3. Fallback: find by conversation
  const conv = await prisma.conversation.findFirst({ where: { recipientId }, select: { userId: true, whatsappLineId: true } });
  if (conv) return { userId: conv.userId, lineId: conv.whatsappLineId || undefined };

  // 4. Last resort
  const u = await prisma.user.findFirst({ where: { apiKeyConnected: true, parentUserId: null }, select: { id: true } });
  return u ? { userId: u.id } : null;
};

// Find the correct assistant for a line (or default active)
const findAssistantForLine = async (ownerId: string, lineId?: string): Promise<any | null> => {
  // If line has a specific assistant assigned
  if (lineId) {
    const line = await prisma.whatsappLine.findUnique({ where: { id: lineId }, select: { assistantId: true } });
    if (line?.assistantId) {
      const a = await prisma.assistant.findUnique({ where: { id: line.assistantId } });
      if (a) return a;
    }
  }
  // Default: active assistant
  let assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true }, orderBy: { updatedAt: 'desc' } });
  if (!assistant) {
    assistant = await prisma.assistant.findFirst({ where: { userId: ownerId }, orderBy: { updatedAt: 'desc' } });
    if (assistant) await prisma.assistant.update({ where: { id: assistant.id }, data: { isActive: true } });
  }
  return assistant;
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

// ===== AI RESPONSE (🧠 MEMORIA PERSISTENTE + AUTO-APRENDIZAJE) =====
// Updated to accept optional lineId for per-line assistant selection
const generateAIResponse = async (ownerId: string, message: string, conversationId: string, lineId?: string): Promise<string | null> => {
  try {
    const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { apiKey: true, apiKeyConnected: true } });
    if (!user?.apiKey || !user.apiKeyConnected) return null;

    const assistant = await findAssistantForLine(ownerId, lineId);
    if (!assistant) return null;

    console.log(`📋 Asistente: "${assistant.name}" (contexto: ${assistant.context?.length || 0} chars)${lineId ? ` [línea: ${lineId}]` : ''}`);

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
    
    if (Object.keys(savedContext).length > 0) {
      memoryBlock.push('📋 MEMORIA GUARDADA DEL CLIENTE (datos de conversaciones anteriores):');
      for (const [key, value] of Object.entries(savedContext)) {
        if (value && value !== '' && value !== 'null' && value !== 'undefined') {
          memoryBlock.push(`  - ${key}: ${value}`);
        }
      }
      memoryBlock.push('⚠️ USA estos datos. NO vuelvas a preguntar nada que ya esté aquí.');
    }

    if (clientName) {
      memoryBlock.push(`\n🧠 CLIENTE ACTUAL: "${clientName}" (teléfono: ${clientPhone})`);
      memoryBlock.push(`REGLA: Ya conoces su nombre. NUNCA le preguntes cómo se llama.`);
    }

    if (crmInfo) {
      memoryBlock.push(`\n📊 DATOS DEL CRM:\n${crmInfo}`);
    }

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

    // 🧠 INSTRUCCIONES DE MEMORIA
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

    const recent = [...history].reverse().slice(-30);
    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    recent.forEach(m => messages.push({ role: m.fromMe ? 'assistant' : 'user', content: m.content.substring(0, 500) }));
    messages.push({ role: 'user', content: message });

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
              const merged = { ...savedContext };
              for (const [key, value] of Object.entries(memoryData)) {
                if (value && value !== '' && value !== 'null' && value !== 'undefined') {
                  merged[key] = value;
                }
              }
              await prisma.conversation.update({
                where: { id: conversationId },
                data: { contextData: merged }
              });
              console.log(`🧠 Memoria guardada: ${JSON.stringify(merged)}`);
            } catch (e) {
              console.error('⚠️ Error parseando memoria:', e);
            }
            reply = reply.replace(/<<MEMORY_JSON>>[\s\S]*?<<END_MEMORY>>/, '').trim();
          }

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
// 🔥 PROCESAR MENSAJES AGRUPADOS (updated for multi-line)
// ====================================================
const processBufferedMessages = async (bufferKey: string) => {
  const buf = messageBuffer.get(bufferKey);
  if (!buf) return;
  messageBuffer.delete(bufferKey);

  const { messages: msgs, sessionName, from, senderName, userId, convId, lineId } = buf;
  const combinedMessage = msgs.join('\n');

  console.log(`📦 Buffer procesado: ${msgs.length} mensaje(s) de ${senderName} → "${combinedMessage.substring(0, 100)}..."`);

  try {
    const assistant = await findAssistantForLine(userId, lineId);
    const isVoiceMode = !!(assistant?.voiceEnabled && assistant?.elevenLabsKey && assistant?.selectedVoice);
    const mediaItems = (assistant?.mediaItems as any[]) || [];
    const matchedMedia = findMediaTrigger(combinedMessage, mediaItems);

    if (isVoiceMode) {
      await setPresence(sessionName, from, 'recording');
    } else {
      await setPresence(sessionName, from, 'typing');
    }

    if (matchedMedia) {
      console.log(`📎 Trigger multimedia: "${matchedMedia.name}"`);
      const aiResponse = await generateAIResponse(userId, combinedMessage, convId, lineId);
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
      const aiResponse = await generateAIResponse(userId, combinedMessage, convId, lineId);
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

// =====================================================
// ===== PLAN LIMITS HELPER =====
// =====================================================
const PLAN_LIMITS: Record<string, { maxLines: number }> = {
  trial: { maxLines: 3 },
  starter: { maxLines: 3 },
  business: { maxLines: 999 } // unlimited
};

const getUserPlanLimit = async (ownerId: string): Promise<number> => {
  const u = await prisma.user.findUnique({ where: { id: ownerId }, select: { plan: true } });
  const plan = u?.plan || 'trial';
  return PLAN_LIMITS[plan]?.maxLines || 3;
};

// =====================================================
// ===== MULTI-LINE CRUD =====
// =====================================================

// GET /api/whatsapp/lines — List all lines for user
router.get('/lines', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const lines = await prisma.whatsappLine.findMany({
      where: { userId: ownerId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
    });

    // Sync status with WAHA for each line
    const enrichedLines = await Promise.all(lines.map(async (line) => {
      try {
        const d = await checkWahaSession(line.sessionName);
        if (d) {
          const isConnected = ['WORKING', 'CONNECTED'].includes(d.status);
          const phone = isConnected && d.me?.id ? d.me.id.replace('@c.us', '') : line.phone;
          const newStatus = isConnected ? 'connected' : d.status === 'SCAN_QR_CODE' ? 'connecting' : 'disconnected';
          
          // Update DB if changed
          if (newStatus !== line.status || (phone && phone !== line.phone)) {
            await prisma.whatsappLine.update({ 
              where: { id: line.id }, 
              data: { status: newStatus, ...(phone ? { phone } : {}) } 
            }).catch(() => {});
          }
          return { ...line, status: newStatus, phone: phone || line.phone };
        }
      } catch {}
      return { ...line, status: line.status || 'disconnected' };
    }));

    res.json({ lines: enrichedLines });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/whatsapp/lines — Create new line
router.post('/lines', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    // Check plan limit
    const maxLines = await getUserPlanLimit(ownerId);
    const currentCount = await prisma.whatsappLine.count({ where: { userId: ownerId, isActive: true } });
    if (currentCount >= maxLines) {
      res.status(403).json({ error: `Tu plan permite máximo ${maxLines} líneas. Actualiza a Business para líneas ilimitadas.` });
      return;
    }

    const { label, assignedTo, assistantId } = req.body;
    if (!label?.trim()) { res.status(400).json({ error: 'El nombre de la línea es requerido' }); return; }

    const isFirst = currentCount === 0;

    // Create line with unique session name
    const line = await prisma.whatsappLine.create({
      data: {
        userId: ownerId,
        label: label.trim(),
        sessionName: '', // temp, will update
        assignedTo: assignedTo || null,
        assignedName: assignedTo ? (await prisma.user.findUnique({ where: { id: assignedTo }, select: { name: true, email: true } }))?.name || null : null,
        assistantId: assistantId || null,
        isDefault: isFirst
      }
    });

    // Set session name using line ID
    await prisma.whatsappLine.update({
      where: { id: line.id },
      data: { sessionName: getLineSessionName(line.id) }
    });

    console.log(`📱 Línea creada: "${label}" (${line.id})`);
    res.status(201).json({ line: { ...line, sessionName: getLineSessionName(line.id) } });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUT /api/whatsapp/lines/:id — Update line
router.put('/lines/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;

    const existing = await prisma.whatsappLine.findFirst({ where: { id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'Línea no encontrada' }); return; }

    const { label, assignedTo, assistantId } = req.body;
    
    const line = await prisma.whatsappLine.update({
      where: { id },
      data: {
        ...(label !== undefined ? { label: label.trim() } : {}),
        ...(assignedTo !== undefined ? { 
          assignedTo: assignedTo || null,
          assignedName: assignedTo ? (await prisma.user.findUnique({ where: { id: assignedTo }, select: { name: true } }))?.name || null : null
        } : {}),
        ...(assistantId !== undefined ? { assistantId: assistantId || null } : {}),
      }
    });

    res.json({ line });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/whatsapp/lines/:id — Delete line (disconnect first)
router.delete('/lines/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;

    const line = await prisma.whatsappLine.findFirst({ where: { id, userId: ownerId } });
    if (!line) { res.status(404).json({ error: 'Línea no encontrada' }); return; }

    // Stop WAHA session
    try {
      await fetch(`${WAHA_API_URL}/api/sessions/${line.sessionName}/stop`, { method: 'POST', headers: getWahaHeaders() });
    } catch {}

    // Soft delete
    await prisma.whatsappLine.update({ where: { id }, data: { isActive: false, status: 'disconnected' } });
    
    console.log(`🗑️ Línea eliminada: "${line.label}" (${id})`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// =====================================================
// ===== PER-LINE CONNECT / DISCONNECT / QR =====
// =====================================================

// POST /api/whatsapp/lines/:id/connect
router.post('/lines/:id/connect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;

    const line = await prisma.whatsappLine.findFirst({ where: { id, userId: ownerId, isActive: true } });
    if (!line) { res.status(404).json({ error: 'Línea no encontrada' }); return; }

    const sessionName = line.sessionName;
    const webhookUrl = `${BACKEND_URL}/api/webhook/whatsapp`;

    // Check if already connected
    const existing = await checkWahaSession(sessionName);
    if (existing && ['WORKING', 'CONNECTED'].includes(existing.status)) {
      await prisma.whatsappLine.update({ where: { id }, data: { status: 'connected' } });
      res.json({ success: true, message: 'Ya conectado', session: sessionName }); return;
    }

    if (!existing || existing.status === undefined) {
      // Create new session
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
      console.log(`📱 Sesión creada para línea "${line.label}": ${sessionName} (status: ${(createData as any).status || 'unknown'})`);
    } else if (['STOPPED', 'FAILED'].includes(existing.status)) {
      await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}/start`, { method: 'POST', headers: getWahaHeaders() });
      console.log(`🔄 Sesión reiniciada: ${sessionName}`);
    }

    await prisma.whatsappLine.update({ where: { id }, data: { status: 'connecting' } });
    res.json({ success: true, message: 'Sesión activada', session: sessionName });
  } catch (e: any) {
    console.error(`❌ Error connect line:`, e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/whatsapp/lines/:id/disconnect
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
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /api/whatsapp/lines/:id/qr
router.get('/lines/:id/qr', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;

    const line = await prisma.whatsappLine.findFirst({ where: { id, userId: ownerId } });
    if (!line) { res.status(404).json({ error: 'Línea no encontrada' }); return; }

    const sn = line.sessionName;
    let qr: string | null = null;

    // 1. JSON base64
    try {
      const r = await fetch(`${WAHA_API_URL}/api/${sn}/auth/qr`, { headers: { ...getWahaHeaders(), 'Accept': 'application/json' } });
      if (r.ok) {
        const d = await r.json() as any;
        if (d.mimetype && d.data) qr = `data:${d.mimetype};base64,${d.data}`;
      }
    } catch {}

    // 2. Binary PNG
    if (!qr) {
      try {
        const r = await fetch(`${WAHA_API_URL}/api/${sn}/auth/qr`, { headers: { ...getWahaHeaders(), 'Accept': 'image/png' } });
        if (r.ok && r.headers.get('content-type')?.includes('image')) {
          const buf = Buffer.from(await r.arrayBuffer());
          qr = `data:image/png;base64,${buf.toString('base64')}`;
        }
      } catch {}
    }

    // 3. Legacy fallback
    if (!qr) {
      try {
        const r = await fetch(`${WAHA_API_URL}/api/sessions/${sn}/auth/qr`, { headers: { ...getWahaHeaders(), 'Accept': 'application/json' } });
        if (r.ok) {
          const d = await r.json() as any;
          if (d.mimetype && d.data) qr = `data:${d.mimetype};base64,${d.data}`;
        }
      } catch {}
    }

    res.json({ qr, available: !!qr });
  } catch { res.json({ qr: null, available: false }); }
});

// =====================================================
// ===== LEGACY ROUTES (backward compat) =====
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
      const createRes = await fetch(`${WAHA_API_URL}/api/sessions`, {
        method: 'POST', headers: getWahaHeaders(),
        body: JSON.stringify({
          name: sessionName, start: true,
          config: { webhooks: [{ url: webhookUrl, events: ['message', 'message.any', 'session.status'] }] }
        })
      });
      const createData = await createRes.json().catch(() => ({}));
      console.log(`📱 Sesión creada: ${sessionName} (status: ${(createData as any).status || 'unknown'})`);
      res.json({ success: true, message: 'Sesión creada', session: sessionName });
    } else {
      const data = await check.json() as any;
      if (['STOPPED', 'FAILED'].includes(data.status)) {
        await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}/start`, { method: 'POST', headers: getWahaHeaders() });
      }
      res.json({ success: true, message: 'Sesión activada', session: sessionName });
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
    const sessionToCheck = session ? sn : getUserSessionName(ownerId);

    let qrData: string | null = null;
    try {
      const r = await fetch(`${WAHA_API_URL}/api/${sessionToCheck}/auth/qr`, { headers: { ...getWahaHeaders(), 'Accept': 'application/json' } });
      if (r.ok) { const d = await r.json() as any; if (d.mimetype && d.data) qrData = `data:${d.mimetype};base64,${d.data}`; }
    } catch {}
    if (!qrData) {
      try {
        const r = await fetch(`${WAHA_API_URL}/api/${sessionToCheck}/auth/qr`, { headers: { ...getWahaHeaders(), 'Accept': 'image/png' } });
        if (r.ok && r.headers.get('content-type')?.includes('image')) { const buf = Buffer.from(await r.arrayBuffer()); qrData = `data:image/png;base64,${buf.toString('base64')}`; }
      } catch {}
    }
    if (!qrData) {
      try {
        const r = await fetch(`${WAHA_API_URL}/api/sessions/${sessionToCheck}/auth/qr`, { headers: { ...getWahaHeaders(), 'Accept': 'application/json' } });
        if (r.ok) { const d = await r.json() as any; if (d.mimetype && d.data) qrData = `data:${d.mimetype};base64,${d.data}`; }
      } catch {}
    }
    res.json({ qr: qrData, available: !!qrData });
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
    const { to, message, lineId } = req.body;
    if (!userId || !to || !message) { res.status(400).json({ error: 'Faltan datos' }); return; }
    const ownerId = await getOwnerId(userId);

    // Determine which session to use
    let sn: string;
    if (lineId) {
      const line = await prisma.whatsappLine.findFirst({ where: { id: lineId, userId: ownerId, status: 'connected' } });
      sn = line?.sessionName || getUserSessionName(ownerId);
    } else {
      const session = await findActiveSession(ownerId);
      sn = session?.name || getUserSessionName(ownerId);
    }

    const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@c.us`;
    const r = await fetch(`${WAHA_API_URL}/api/sendText`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify({ session: sn, chatId, text: message }) });
    if (r.ok) {
      const cleanNumber = to.replace(/\D/g, '');
      let conv = await prisma.conversation.findFirst({ where: { userId: ownerId, recipientId: cleanNumber } });
      if (!conv) conv = await prisma.conversation.findFirst({ where: { userId: ownerId, recipientId: `+${cleanNumber}` } });
      if (!conv) conv = await prisma.conversation.findFirst({ where: { userId: ownerId, recipientId: to } });
      if (!conv && cleanNumber.length >= 10) {
        const last10 = cleanNumber.slice(-10);
        conv = await prisma.conversation.findFirst({ where: { userId: ownerId, recipientId: { endsWith: last10 } } });
      }
      if (!conv) conv = await prisma.conversation.create({ data: { userId: ownerId, recipientId: cleanNumber, lastMessage: message, stage: 'new', whatsappLineId: lineId || null } });
      
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
    const lines = await prisma.whatsappLine.findMany({ where: { userId: ownerId, isActive: true } });
    res.json({
      user, ownerId,
      session: session ? { name: session.name, status: session.data.status } : null,
      assistant: assistant ? { id: assistant.id, name: assistant.name, contextLength: assistant.context?.length || 0 } : null,
      conversations: await prisma.conversation.count({ where: { userId: ownerId } }),
      teamMembers: team,
      lines: lines.map(l => ({ id: l.id, label: l.label, status: l.status, phone: l.phone, session: l.sessionName })),
      activeBuffers: messageBuffer.size
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// =====================================================
// ===== WEBHOOK PÚBLICO (recibe mensajes WhatsApp) =====
// Updated for multi-line: resolves lineId from session
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

    if (!from || !body || from.includes('@g.us') || from.includes('@broadcast') || from.includes('status@') || from === 'status@broadcast') {
      if (from.includes('@broadcast') || from.includes('status@')) {
        console.log(`🚫 Ignorado: historia/estado de WhatsApp de ${from}`);
      }
      res.json({ success: true }); return;
    }

    const recipientId = from.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '');
    const senderName = notifyName || recipientId;

    // 🔄 Updated: resolve user AND lineId from session
    const resolved = await resolveUserFromWebhook(sessionName, recipientId);
    if (!resolved) { res.status(400).json({ error: 'No user' }); return; }
    const { userId, lineId } = resolved;

    console.log(`💬 ${senderName} (${recipientId}) → session: ${sessionName}${lineId ? ` [línea: ${lineId}]` : ''}`);

    // 🔍 Búsqueda flexible de conversación existente
    let conv = await prisma.conversation.findFirst({ where: { userId, recipientId } });
    if (!conv && recipientId.length >= 10) {
      const last10 = recipientId.slice(-10);
      conv = await prisma.conversation.findFirst({ where: { userId, recipientId: { endsWith: last10 } } });
    }
    if (!conv) {
      conv = await prisma.conversation.create({ 
        data: { userId, recipientId, recipientName: senderName, lastMessage: body, stage: 'new', whatsappLineId: lineId || null } 
      });
    } else if (lineId && !conv.whatsappLineId) {
      // Update existing conv with lineId if not set
      await prisma.conversation.update({ where: { id: conv.id }, data: { whatsappLineId: lineId } }).catch(() => {});
    }

    // ⏸️ COMANDO ".." = PAUSAR IA
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

    // ▶️ COMANDO "." = REACTIVAR IA
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

    // Guardar mensaje en DB
    await prisma.message.create({ data: { conversationId: conv.id, content: body, fromMe: false, userId, role: 'user' } });
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: body, recipientName: senderName } });

    if (conv.aiPaused) {
      console.log(`⏸️ IA pausada → ${senderName} (guardado, no responde)`);
      res.json({ success: true }); return;
    }

    // 📦 MESSAGE BUFFER
    const bufferKey = `${userId}_${recipientId}`;
    const existingBuffer = messageBuffer.get(bufferKey);

    if (existingBuffer) {
      existingBuffer.messages.push(body);
      clearTimeout(existingBuffer.timer);
      existingBuffer.timer = setTimeout(() => processBufferedMessages(bufferKey), BUFFER_WAIT_MS);
      console.log(`📦 Buffer: +1 de ${senderName} (total: ${existingBuffer.messages.length})`);
    } else {
      const assistant = await findAssistantForLine(userId, lineId);
      const isVoiceMode = !!(assistant?.voiceEnabled && assistant?.elevenLabsKey && assistant?.selectedVoice);

      if (isVoiceMode) {
        setPresence(sessionName, from, 'recording');
      } else {
        setPresence(sessionName, from, 'typing');
      }

      const timer = setTimeout(() => processBufferedMessages(bufferKey), BUFFER_WAIT_MS);
      messageBuffer.set(bufferKey, {
        messages: [body],
        timer,
        sessionName,
        from,
        senderName,
        userId,
        convId: conv.id,
        lineId
      });
      console.log(`📦 Buffer: nuevo de ${senderName} → esperando ${BUFFER_WAIT_MS/1000}s`);
    }

    res.json({ success: true });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

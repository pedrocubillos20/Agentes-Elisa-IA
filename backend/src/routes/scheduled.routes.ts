import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';
import { uploadFile } from '../lib/storage';
import { sendCloudTemplate } from './whatsapp.routes';

const router = Router();

const WAHA_API_URL = process.env.WAHA_API_URL || 'http://31.97.142.127:8080';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';

// ===== HELPERS =====
const log = (msg: string) => { if (process.env.NODE_ENV !== 'production') console.log(msg); else console.log(msg); };

const getWahaHeaders = () => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WAHA_API_KEY) h['X-Api-Key'] = WAHA_API_KEY;
  return h;
};

const ownerIdCache = new Map<string, { value: string; ts: number }>();
const getOwnerId = async (userId: string): Promise<string> => {
  const cached = ownerIdCache.get(userId);
  if (cached && Date.now() - cached.ts < 300000) return cached.value;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  const ownerId = user?.parentUserId || userId;
  ownerIdCache.set(userId, { value: ownerId, ts: Date.now() });
  return ownerId;
};

// ===== ANTI-BLOQUEO: Random delay =====
const randomDelay = (minMs: number, maxMs: number): Promise<void> => {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise(r => setTimeout(r, ms));
};

// ===== TYPING SIMULATION =====
const simulateTyping = async (session: string, chatId: string): Promise<void> => {
  const endpoints = [
    `${WAHA_API_URL}/api/startTyping`,
    `${WAHA_API_URL}/api/sendPresence`
  ];
  for (const url of endpoints) {
    try {
      const body = url.includes('Presence') 
        ? { session, chatId, presence: 'typing' }
        : { session, chatId };
      const r = await fetch(url, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(body) });
      if (r.ok) return;
    } catch {}
  }
};

const stopTyping = async (session: string, chatId: string): Promise<void> => {
  try { await fetch(`${WAHA_API_URL}/api/stopTyping`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify({ session, chatId }) }); } catch {}
};

// ===== VALIDATE & FORMAT chatId =====
const formatChatId = (raw: string, isGroup = false): string | null => {
  if (!raw) return null;
  
  // Already formatted
  if (raw.includes('@g.us')) return raw;
  if (raw.includes('@c.us')) {
    const num = raw.replace('@c.us', '');
    if (num.length < 7 || num.length > 15) return null;
    return raw;
  }
  
  // Clean non-digits
  const clean = raw.replace(/\D/g, '');
  if (!clean || clean.length < 7 || clean.length > 15) return null;
  
  if (isGroup) return `${clean}@g.us`;
  return `${clean}@c.us`;
};

// ===== SEND TEXT with retry =====
const sendText = async (session: string, chatId: string, text: string, retries = 3): Promise<boolean> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const r = await fetch(`${WAHA_API_URL}/api/sendText`, {
        method: 'POST', headers: getWahaHeaders(),
        body: JSON.stringify({ session, chatId, text })
      });
      if (r.ok) return true;
      
      const errText = await r.text().catch(() => '');
      log(`⚠️ sendText intento ${attempt}/${retries} (${r.status}): ${errText.substring(0, 100)}`);
      
      if (attempt < retries) await randomDelay(2000, 5000);
    } catch (e: any) {
      log(`⚠️ sendText error intento ${attempt}/${retries}: ${e.message}`);
      if (attempt < retries) await randomDelay(2000, 5000);
    }
  }
  return false;
};

// ===== SEND MEDIA with retry =====
const sendMedia = async (session: string, chatId: string, mediaUrl: string, mediaType: string, caption?: string, retries = 3): Promise<boolean> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const isBase64 = mediaUrl.startsWith('data:');
      let fileData: any = null;
      
      if (isBase64) {
        const match = mediaUrl.match(/^data:(.+?);base64,(.+)$/s);
        if (match) fileData = { mimetype: match[1], filename: 'media', data: match[2] };
        else return false;
      }
      
      // Determine endpoint
      let endpoint = '/api/sendFile';
      if (mediaType === 'image') endpoint = '/api/sendImage';
      else if (mediaType === 'video') endpoint = '/api/sendVideo';
      else if (mediaType === 'audio') endpoint = '/api/sendFile'; // audio as file
      
      const body: any = { session, chatId };
      if (fileData) body.file = fileData;
      else body.file = { url: mediaUrl };
      if (caption) body.caption = caption;
      
      const r = await fetch(`${WAHA_API_URL}${endpoint}`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(body) });
      if (r.ok) return true;
      
      // Fallback to /api/sendFile
      if (endpoint !== '/api/sendFile') {
        const r2 = await fetch(`${WAHA_API_URL}/api/sendFile`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(body) });
        if (r2.ok) return true;
      }
      
      const errText = await r.text().catch(() => '');
      log(`⚠️ sendMedia intento ${attempt}/${retries} (${r.status}): ${errText.substring(0, 100)}`);
      
      if (attempt < retries) await randomDelay(3000, 6000);
    } catch (e: any) {
      log(`⚠️ sendMedia error intento ${attempt}/${retries}: ${e.message}`);
      if (attempt < retries) await randomDelay(3000, 6000);
    }
  }
  return false;
};

// ===== MESSAGE VARIATION (anti-spam) =====
const varyMessage = (text: string, index: number): string => {
  if (!text) return text;
  
  // Add invisible variation to avoid spam detection
  const variations = [
    '', ' ', '​', '‎', '‏' // empty, space, zero-width space, LRM, RLM
  ];
  const suffix = variations[index % variations.length];
  
  // Randomly add/remove trailing punctuation
  const trimmed = text.trimEnd();
  if (index % 3 === 1 && !trimmed.endsWith('!') && !trimmed.endsWith('?')) {
    return trimmed + suffix;
  }
  
  return text + suffix;
};

// ====================================================
// 📋 GET /api/scheduled — Listar mensajes programados
// ====================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const messages = await prisma.scheduledMessage.findMany({
      where: { userId: ownerId },
      orderBy: { scheduledAt: 'asc' }
    });

    res.json({ scheduled: messages });
  } catch (e: any) {
    console.error('Error listando programados:', e.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ====================================================
// ➕ POST /api/scheduled — Crear mensaje programado
// ====================================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const {
      whatsappLineId, targetType, targetId, targetName,
      message, mediaUrl, mediaType,
      scheduledAt, recurrence, recurrenceDays, recurrenceTime, recurrenceEnd,
      timezone, bulkRecipients,
      templateName, templateLanguage, templateVariables, interactive
    } = req.body;

    if (!targetId || !scheduledAt) {
      res.status(400).json({ error: 'Se requiere destinatario y fecha/hora' }); return;
    }
    if (!message && !mediaUrl && !req.body.templateName) {
      res.status(400).json({ error: 'Se requiere mensaje, media o plantilla de WhatsApp' }); return;
    }

    // 🖼️ Si mediaUrl es base64, subir a R2 primero
    let finalMediaUrl = mediaUrl || null;
    if (mediaUrl && mediaUrl.startsWith('data:')) {
      try {
        const match = mediaUrl.match(/^data:(.+?);base64,(.+)$/s);
        if (match) {
          const mimetype = match[1];
          const buffer = Buffer.from(match[2], 'base64');
          const ext = mimetype.includes('png') ? 'png' : mimetype.includes('video') ? 'mp4' : mimetype.includes('audio') ? 'ogg' : 'jpg';
          const result = await uploadFile(ownerId, `scheduled-${Date.now()}.${ext}`, buffer, mimetype, 'scheduled');
          finalMediaUrl = result.url;
        }
      } catch (e: any) {
        console.error('⚠️ Error subiendo media programada a R2:', e.message);
      }
    }

    const scheduled = await prisma.scheduledMessage.create({
      data: {
        userId: ownerId, whatsappLineId: whatsappLineId || null,
        targetType: targetType || 'contact', targetId,
        targetName: targetName || null,
        message: message || (templateName ? `[Plantilla: ${templateName}]` : null),
        mediaUrl: finalMediaUrl, mediaType: mediaType || null,
        scheduledAt: new Date(scheduledAt), recurrence: recurrence || 'once',
        ...(templateName && { templateName, templateLanguage: templateLanguage || 'es', templateVariables: JSON.stringify(templateVariables || []) }),
        ...(interactive && { interactiveData: JSON.stringify(interactive) }),
        recurrenceDays: recurrenceDays || null, recurrenceTime: recurrenceTime || null,
        recurrenceEnd: recurrenceEnd ? new Date(recurrenceEnd) : null,
        timezone: timezone || 'America/Bogota', status: 'pending',
        // Store bulkRecipients serialized in targetId for bulk_excel type
        ...(bulkRecipients && Array.isArray(bulkRecipients) && {
          targetId: targetType === 'bulk_excel' ? JSON.stringify(bulkRecipients) : targetId
        })
      }
    });

    log(`📅 Mensaje programado creado: ${scheduled.id} → ${targetId} @ ${scheduledAt}`);
    res.json({ success: true, scheduled });
  } catch (e: any) {
    console.error('Error creando programado:', e.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ====================================================
// ✏️ PUT /api/scheduled/:id — Editar mensaje programado
// ====================================================
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const existing = await prisma.scheduledMessage.findFirst({ where: { id: req.params.id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'No encontrado' }); return; }

    const {
      targetType, targetId, targetName, message, mediaUrl, mediaType,
      scheduledAt, recurrence, recurrenceDays, recurrenceTime, recurrenceEnd,
      timezone, status
    } = req.body;

    // 🖼️ Si mediaUrl es base64, subir a R2
    let finalMediaUrl = mediaUrl;
    if (mediaUrl && mediaUrl.startsWith('data:')) {
      try {
        const match = mediaUrl.match(/^data:(.+?);base64,(.+)$/s);
        if (match) {
          const mimetype = match[1];
          const buffer = Buffer.from(match[2], 'base64');
          const ext = mimetype.includes('png') ? 'png' : mimetype.includes('video') ? 'mp4' : 'jpg';
          const result = await uploadFile(ownerId, `scheduled-${Date.now()}.${ext}`, buffer, mimetype, 'scheduled');
          finalMediaUrl = result.url;
        }
      } catch (e: any) { console.error('⚠️ Error R2 scheduled update:', e.message); }
    }

    const updated = await prisma.scheduledMessage.update({
      where: { id: req.params.id },
      data: {
        ...(targetType !== undefined && { targetType }), ...(targetId !== undefined && { targetId }),
        ...(targetName !== undefined && { targetName }), ...(message !== undefined && { message }),
        ...(finalMediaUrl !== undefined && { mediaUrl: finalMediaUrl }), ...(mediaType !== undefined && { mediaType }),
        ...(scheduledAt !== undefined && { scheduledAt: new Date(scheduledAt) }),
        ...(recurrence !== undefined && { recurrence }), ...(recurrenceDays !== undefined && { recurrenceDays }),
        ...(recurrenceTime !== undefined && { recurrenceTime }),
        ...(recurrenceEnd !== undefined && { recurrenceEnd: recurrenceEnd ? new Date(recurrenceEnd) : null }),
        ...(timezone !== undefined && { timezone }), ...(status !== undefined && { status }),
      }
    });

    res.json({ success: true, scheduled: updated });
  } catch (e: any) {
    console.error('Error actualizando programado:', e.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ====================================================
// 🗑️ DELETE /api/scheduled/:id — Eliminar programado
// ====================================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const existing = await prisma.scheduledMessage.findFirst({ where: { id: req.params.id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'No encontrado' }); return; }

    await prisma.scheduledMessage.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e: any) {
    console.error('Error eliminando programado:', e.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ====================================================
// ⏰ CRON: Verificar mensajes pendientes cada 3 minutos
// ====================================================
export const startScheduledMessagesCron = () => {
  log('⏰ Cron de mensajes programados INICIADO (cada 3min)');

  setInterval(async () => {
    try {
      const now = new Date();
      const pending = await prisma.scheduledMessage.findMany({
        where: { status: 'pending', scheduledAt: { lte: now } },
        take: 20 // Máx 20 a la vez (más seguro para anti-bloqueo)
      });

      if (pending.length === 0) return;
      log(`⏰ Procesando ${pending.length} mensajes programados...`);

      for (const msg of pending) {
        try {
          // Marcar como processing para evitar doble ejecución
          await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { status: 'processing' as any } });
          await processScheduledMessage(msg);
        } catch (e: any) {
          console.error(`⏰ Error procesando ${msg.id}:`, e.message);
          await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { status: 'failed', error: e.message } }).catch(() => {});
        }
      }
    } catch (e: any) {
      console.error('⏰ Error en cron de programados:', e.message);
    }
  }, 180_000); // 3 minutes — reduces egress by 67%
};

// ====================================================
// 🚀 Procesar un mensaje programado — MEJORADO COMPLETO
// ====================================================
const processScheduledMessage = async (msg: any) => {
  const { userId, whatsappLineId, targetType, targetId, message, mediaUrl, mediaType } = msg;

  // 1. Determinar sesión de WhatsApp
  let sessionName: string | null = null;
  let effectiveLineId = whatsappLineId;

  if (whatsappLineId) {
    const line = await prisma.whatsappLine.findFirst({ where: { id: whatsappLineId, userId } });
    if (line) sessionName = line.sessionName;
  }
  if (!sessionName) {
    const firstLine = await prisma.whatsappLine.findFirst({ where: { userId, status: 'connected' }, orderBy: { isDefault: 'desc' } });
    if (firstLine) {
      sessionName = firstLine.sessionName;
      effectiveLineId = firstLine.id;
    }
  }
  if (!sessionName) {
    await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { status: 'failed', error: 'Sin sesión de WhatsApp activa' } });
    return;
  }

  // 2. Verificar que la sesión esté activa en WAHA
  try {
    const checkRes = await fetch(`${WAHA_API_URL}/api/sessions/${sessionName}`, { headers: getWahaHeaders() });
    if (checkRes.ok) {
      const sessionData = await checkRes.json() as any;
      if (!['WORKING', 'CONNECTED'].includes(sessionData?.status)) {
        log(`⚠️ Sesión ${sessionName} no está activa (${sessionData?.status}), reintentando...`);
        await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { status: 'pending', error: `Sesión ${sessionData?.status}` } });
        return;
      }
    }
  } catch {}

  // 3. Resolver destinatarios
  let targets: { chatId: string; name?: string }[] = [];

  if (targetType === 'contact') {
    const chatId = formatChatId(targetId, false);
    if (chatId) targets = [{ chatId, name: msg.targetName }];

  } else if (targetType === 'group') {
    const chatId = formatChatId(targetId, true);
    if (chatId) targets = [{ chatId, name: msg.targetName }];

  } else if (targetType === 'stage') {
    const where: any = { userId, stage: targetId };
    if (whatsappLineId) where.whatsappLineId = whatsappLineId;

    const convs = await prisma.conversation.findMany({
      where,
      select: { recipientId: true, recipientName: true, isGroup: true }
    });

    targets = convs
      .map(c => {
        const chatId = formatChatId(c.recipientId, c.isGroup);
        return chatId ? { chatId, name: c.recipientName || undefined } : null;
      })
      .filter(Boolean) as { chatId: string; name?: string }[];

  } else if (targetType === 'bulk_excel') {
    // 📊 Destinatarios importados desde Excel — almacenados en targetId como JSON
    let bulkList: any[] = [];
    try { bulkList = JSON.parse(msg.targetId || '[]'); } catch { bulkList = []; }
    targets = bulkList
      .map((r: any) => {
        const phone = String(r.phone || r.telefono || r.number || '').replace(/\D/g, '');
        const chatId = formatChatId(phone, false);
        return chatId ? { chatId, name: r.name || r.nombre || undefined } : null;
      })
      .filter(Boolean) as { chatId: string; name?: string }[];
  }

  if (targets.length === 0) {
    await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { status: 'failed', error: 'Sin destinatarios válidos' } });
    return;
  }

  // Deduplicate targets
  const seen = new Set<string>();
  targets = targets.filter(t => { if (seen.has(t.chatId)) return false; seen.add(t.chatId); return true; });

  // Load line data for Cloud API template sending
  const lineData = effectiveLineId ? await prisma.whatsappLine.findFirst({
    where: { id: effectiveLineId },
    select: { connectionType: true, cloudAccessToken: true, cloudPhoneNumberId: true, cloudBusinessId: true }
  }) : null;

  log(`📅 Enviando programado ${msg.id} a ${targets.length} destinatarios vía sesión ${sessionName}`);

  // 4. 🛡️ ANTI-BLOQUEO CONFIG
  const BATCH_SIZE = 10;                    // Pausa larga cada 10 mensajes
  const DELAY_MIN = 8000;                   // Mínimo 8 segundos entre envíos
  const DELAY_MAX = 18000;                  // Máximo 18 segundos
  const BATCH_PAUSE_MIN = 30000;            // Pausa de batch: 30s mínimo
  const BATCH_PAUSE_MAX = 60000;            // Pausa de batch: 60s máximo
  const TYPING_DURATION_MIN = 2000;         // Simular typing: 2-5s
  const TYPING_DURATION_MAX = 5000;

  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    
    try {
      // 🛡️ BATCH BREAK: pausa larga cada N mensajes
      if (sentCount > 0 && sentCount % BATCH_SIZE === 0) {
        const batchPause = BATCH_PAUSE_MIN + Math.random() * (BATCH_PAUSE_MAX - BATCH_PAUSE_MIN);
        log(`🛡️ Pausa anti-bloqueo: ${Math.round(batchPause / 1000)}s después de ${sentCount} envíos`);
        await randomDelay(batchPause, batchPause + 1000);
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 📋 PLANTILLA DE FACEBOOK (Cloud API) — envío directo
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const phone = target.chatId.replace('@c.us', '').replace(/\D/g, '');

      if (msg.templateName && lineData?.connectionType === 'cloud_api' && lineData?.cloudAccessToken && lineData?.cloudPhoneNumberId) {
        // ✅ Usar sendCloudTemplate centralizado (mismo que funciona en envío manual)
        const tplVars: string[] = msg.templateVariables ? JSON.parse(msg.templateVariables) : [];
        // Reemplazar {{nombre}} por nombre del destinatario si la variable es el placeholder
        const resolvedVars = tplVars.map((v: string) => {
          if (v === '{{nombre}}' || v === '{nombre}') return target.name || v;
          return v;
        });

        // 🖼️ Obtener header de la plantilla desde Meta (puede tener video/imagen)
        let headerMedia: { type: 'image' | 'video' | 'document'; url: string } | undefined;
        try {
          const WABA_ID = lineData.cloudBusinessId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
          if (WABA_ID) {
            const tplRes = await fetch(
              `https://graph.facebook.com/v18.0/${WABA_ID}/message_templates?name=${encodeURIComponent(msg.templateName)}&fields=components`,
              { headers: { 'Authorization': `Bearer ${lineData.cloudAccessToken}` } }
            );
            if (tplRes.ok) {
              const tplData = await tplRes.json() as any;
              const tpl = tplData?.data?.[0];
              const headerComp = tpl?.components?.find((c: any) => c.type === 'HEADER');
              if (headerComp && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerComp.format)) {
                const exampleUrl = headerComp.example?.header_handle?.[0];
                if (exampleUrl) {
                  headerMedia = { type: headerComp.format.toLowerCase() as any, url: exampleUrl };
                }
              }
            }
          }
        } catch (hErr: any) {
          console.error('⚠️ No se pudo obtener header de plantilla:', hErr.message);
        }

        const result = await sendCloudTemplate(
          lineData.cloudPhoneNumberId,
          lineData.cloudAccessToken,
          phone,
          msg.templateName,
          msg.templateLanguage || 'es_CO',
          resolvedVars,
          headerMedia
        );

        if (result.ok) {
          sentCount++;
          log(`✅ Plantilla '${msg.templateName}' enviada a ${target.name || phone}`);
        } else {
          console.error(`❌ Plantilla falló para ${target.name || phone}`);
          failedCount++;
        }
        continue; // Skip normal send flow for template messages
      }

      // ⌨️ Simular typing antes de enviar (solo para mensajes normales)
      await simulateTyping(sessionName!, target.chatId);
      await randomDelay(TYPING_DURATION_MIN, TYPING_DURATION_MAX);
      await stopTyping(sessionName!, target.chatId);

      let mediaSent = false;
      let textSent = false;

      // 📎 PASO 1: Enviar MEDIA PRIMERO (imagen/video/audio/archivo)
      if (mediaUrl) {
        mediaSent = await sendMedia(sessionName!, target.chatId, mediaUrl, mediaType || 'image', undefined, 3);
        if (!mediaSent) {
          log(`❌ Media falló para ${target.name || target.chatId}`);
        }
        if (message && mediaSent) await randomDelay(1500, 3000);
      }

      // 💬 PASO 2: Enviar TEXTO después (con variación anti-spam)
      // 🔘 Interactive buttons (Cloud API only)
      if ((msg as any).interactiveData && lineData?.connectionType === 'cloud_api' && lineData?.cloudAccessToken && lineData?.cloudPhoneNumberId) {
        try {
          const iData = JSON.parse((msg as any).interactiveData);
          const { sendCloudInteractive } = require('./whatsapp.routes');
          const iResult = await sendCloudInteractive(
            lineData.cloudPhoneNumberId!, lineData.cloudAccessToken!, phone,
            { type: iData.type || 'button', body: msg.message || iData.body || '', buttons: iData.buttons || [], footer: iData.footer }
          );
          if (iResult.ok) {
            log(`✅ Botones interactivos enviados a ${target.name || phone}`);
            await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { status: 'sent', sentAt: new Date() } });
          } else {
            log(`❌ Error enviando botones a ${target.name || phone}`);
            await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { status: 'failed' } });
          }
        } catch (ie: any) { log(`❌ Interactive scheduled error: ${ie.message}`); }
        continue;
      }

      if (message && !msg.templateName) {
        const variedMsg = varyMessage(message, i);
        textSent = await sendText(sessionName!, target.chatId, variedMsg, 3);
        if (!textSent) {
          log(`❌ Texto falló para ${target.name || target.chatId}`);
        }
      }

      // Si nada se envió, es fallo total
      if (!mediaSent && !textSent) {
        failedCount++;
        log(`❌ Falló completamente para ${target.name || target.chatId}`);
        continue;
      }

      // 💾 Guardar en conversación si existe
      try {
        const cleanNumber = target.chatId.replace('@c.us', '').replace('@g.us', '');
        const conv = await prisma.conversation.findFirst({
          where: {
            userId,
            recipientId: { endsWith: cleanNumber.slice(-10) },
            ...(effectiveLineId ? { whatsappLineId: effectiveLineId } : {})
          }
        });

        if (conv) {
          const content = message || '📎 [Media programada]';
          await prisma.message.create({
            data: {
              conversationId: conv.id, content: `📅 ${content}`, fromMe: true, userId, role: 'assistant',
              ...(mediaUrl && { mediaUrl, mediaType: mediaType || 'image' })
            }
          });
          await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: `📅 ${content}` } });
        }
      } catch (dbErr: any) {
        log(`⚠️ Error guardando en DB: ${dbErr.message}`);
      }

      sentCount++;
      log(`✅ Programado ${sentCount}/${targets.length}: ${target.name || target.chatId}`);

      // 🛡️ DELAY ANTI-BLOQUEO entre envíos (variable con progreso)
      if (i < targets.length - 1) {
        const progressFactor = 1 + (i / targets.length) * 0.3; // Más lento al avanzar
        const delay = (DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN)) * progressFactor;
        await randomDelay(delay, delay + 2000);
      }

    } catch (e: any) {
      failedCount++;
      console.error(`⏰ Error enviando a ${target.chatId}:`, e.message);
    }
  }

  log(`📅 Programado ${msg.id}: ${sentCount}/${targets.length} enviados, ${failedCount} fallidos`);

  // 5. Actualizar estado según recurrencia
  const finalStatus = sentCount > 0 ? 'sent' : 'failed';
  const errorMsg = failedCount > 0 ? `${failedCount}/${targets.length} fallidos` : null;

  if (msg.recurrence === 'once') {
    await prisma.scheduledMessage.update({
      where: { id: msg.id },
      data: { 
        status: finalStatus, sentAt: new Date(), lastSentAt: new Date(), sendCount: msg.sendCount + 1, error: errorMsg,
        // (bulkSent/bulkFailed stats not tracked in schema — use error field for summary)
      }
    });
  } else {
    const nextDate = calculateNextOccurrence(msg);
    if (nextDate && (!msg.recurrenceEnd || nextDate <= new Date(msg.recurrenceEnd))) {
      await prisma.scheduledMessage.update({
        where: { id: msg.id },
        data: { status: 'pending', scheduledAt: nextDate, lastSentAt: new Date(), sendCount: msg.sendCount + 1, error: errorMsg }
      });
      log(`📅 Próximo envío recurrente: ${nextDate.toISOString()}`);
    } else {
      await prisma.scheduledMessage.update({
        where: { id: msg.id },
        data: { status: finalStatus, lastSentAt: new Date(), sendCount: msg.sendCount + 1, error: errorMsg }
      });
    }
  }
};

// ====================================================
// 🔄 Calcular siguiente ocurrencia de mensaje recurrente
// ====================================================
const calculateNextOccurrence = (msg: any): Date | null => {
  const current = new Date(msg.scheduledAt);
  const time = msg.recurrenceTime || `${current.getHours()}:${current.getMinutes().toString().padStart(2, '0')}`;
  const [hours, minutes] = time.split(':').map(Number);

  if (msg.recurrence === 'daily') {
    const next = new Date(current);
    next.setDate(next.getDate() + 1);
    next.setHours(hours, minutes, 0, 0);
    return next;
  } else if (msg.recurrence === 'weekly') {
    const days = msg.recurrenceDays as number[] || [];
    if (days.length === 0) {
      const next = new Date(current);
      next.setDate(next.getDate() + 7);
      next.setHours(hours, minutes, 0, 0);
      return next;
    }
    const today = current.getDay();
    const sortedDays = [...days].sort((a, b) => a - b);
    let nextDay = sortedDays.find(d => d > today);
    let daysToAdd: number;
    if (nextDay !== undefined) { daysToAdd = nextDay - today; }
    else { nextDay = sortedDays[0]; daysToAdd = 7 - today + nextDay; }
    const next = new Date(current);
    next.setDate(next.getDate() + daysToAdd);
    next.setHours(hours, minutes, 0, 0);
    return next;
  } else if (msg.recurrence === 'monthly') {
    const next = new Date(current);
    next.setMonth(next.getMonth() + 1);
    next.setHours(hours, minutes, 0, 0);
    return next;
  }
  return null;
};

// ====================================================
// 🔔 CRON: Recordatorios automáticos de citas/reservas/pedidos
// Corre cada 15 minutos
// - Recordatorio 2h antes de la cita
// - Seguimiento 1 día después del servicio (status: 'completed')
// ====================================================
// In-memory sets to track sent reminders/followups (avoids schema migration)
const reminderSentIds = new Set<string>();
const followUpSentIds = new Set<string>();

export const startAppointmentReminderCron = () => {
  log('🔔 Cron de recordatorios de citas INICIADO (cada 15min)');

  const runReminders = async () => {
    try {
      const now = new Date();
      // Colombia UTC-5
      const nowColombia = new Date(now.getTime() - 5 * 60 * 60 * 1000);

      // ── 1. RECORDATORIO 2H ANTES ──────────────────────────────
      // Buscar citas/reservas/pedidos con fecha HOY, en las próximas 1h55–2h05
      const windowStart = new Date(nowColombia.getTime() + (2 * 60 - 5) * 60 * 1000);
      const windowEnd   = new Date(nowColombia.getTime() + (2 * 60 + 5) * 60 * 1000);

      const upcomingAppts = await prisma.appointment.findMany({
        where: {
          status: { in: ['pending', 'confirmed'] },
          date: {
            gte: new Date(nowColombia.toISOString().split('T')[0] + 'T00:00:00'),
            lte: new Date(nowColombia.toISOString().split('T')[0] + 'T23:59:59'),
          }
        },
        select: {
          id: true, userId: true, type: true,
          clientName: true, clientPhone: true,
          date: true, time: true,
          whatsappLineId: true, notes: true
        }
      });

      for (const appt of upcomingAppts) {
        try {
          // Construir datetime de la cita en Colombia
          const [h, m] = (appt.time || '00:00').split(':').map(Number);
          const apptDate = new Date(appt.date);
          const apptColombia = new Date(apptDate.getTime() - 5 * 60 * 60 * 1000);
          apptColombia.setHours(h, m, 0, 0);

          // ¿Ya se envió recordatorio? (dedup en memoria)
          if (reminderSentIds.has(appt.id)) continue;

          // ¿Está dentro del window 2h antes?
          if (apptColombia < windowStart || apptColombia > windowEnd) continue;

          // Encontrar sesión WhatsApp del usuario
          const line = await prisma.whatsappLine.findFirst({
            where: {
              userId: appt.userId,
              status: 'connected',
              ...(appt.whatsappLineId ? { id: appt.whatsappLineId } : {})
            },
            orderBy: { isDefault: 'desc' }
          });
          if (!line) continue;

          const phoneClean = (appt.clientPhone || '')
            .replace(/\D/g, '').replace(/^57/, '');
          if (!phoneClean || phoneClean.length < 7) continue;
          const chatId = `57${phoneClean}@c.us`;

          // Formato hora 12h
          const ampm = h >= 12 ? 'PM' : 'AM';
          const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
          const timeStr = `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;

          // Mensaje según tipo
          let msg = '';
          const nombre = (appt.clientName || 'cliente').split(' ')[0];
          const tipo = appt.type;

          if (tipo === 'order') {
            msg = `📦 *¡Hola ${nombre}!* Te recordamos que hoy es el día de entrega de tu pedido 🎉\n\n🕐 Hora estimada: ${timeStr}\n\n¿Tienes alguna duda? Con gusto te ayudamos 😊`;
          } else if (tipo === 'reservation') {
            msg = `📋 *¡Hola ${nombre}!* Te recordamos tu reserva de hoy 😊\n\n🕐 Hora: ${timeStr}\n\nRecuerda traer tus documentos. ¡Te esperamos! 🙌`;
          } else {
            // appointment (cita)
            msg = `🏍 *¡Hola ${nombre}!* Te recordamos tu cita de hoy en *CDA Ready to Race* 😊\n\n🕐 Hora: ${timeStr}\n\n📌 Recuerda traer:\n- Tarjeta de propiedad\n- SOAT vigente\n- Cédula\n- Moto limpia\n\n¡Te esperamos! 🌟`;
          }

          // Enviar WhatsApp
          const r = await fetch(`${WAHA_API_URL}/api/sendText`, {
            method: 'POST',
            headers: getWahaHeaders(),
            body: JSON.stringify({ session: line.sessionName, chatId, text: msg })
          });

          if (r.ok) {
            // Marcar en memoria para no repetir
            reminderSentIds.add(appt.id);
            log(`🔔 Recordatorio 2h enviado → ${nombre} (${chatId}) | ${tipo}`);
          }

        } catch (e: any) {
          log(`⚠️ Error recordatorio cita ${appt.id}: ${e.message}`);
        }
      }

      // ── 2. SEGUIMIENTO POST-SERVICIO (1 día después) ───────────
      // Buscar citas completadas ayer
      const yesterday = new Date(nowColombia);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      const completedYesterday = await prisma.appointment.findMany({
        where: {
          status: 'completed',
          date: {
            gte: new Date(yesterdayStr + 'T00:00:00'),
            lte: new Date(yesterdayStr + 'T23:59:59'),
          }
        },
        select: {
          id: true, userId: true, type: true,
          clientName: true, clientPhone: true,
          whatsappLineId: true
        }
      });

      for (const appt of completedYesterday) {
        try {
          // ¿Ya se envió seguimiento? (dedup en memoria)
          if (followUpSentIds.has(appt.id)) continue;

          const line = await prisma.whatsappLine.findFirst({
            where: {
              userId: appt.userId,
              status: 'connected',
              ...(appt.whatsappLineId ? { id: appt.whatsappLineId } : {})
            },
            orderBy: { isDefault: 'desc' }
          });
          if (!line) continue;

          const phoneClean = (appt.clientPhone || '').replace(/\D/g, '').replace(/^57/, '');
          if (!phoneClean || phoneClean.length < 7) continue;
          const chatId = `57${phoneClean}@c.us`;

          const nombre = (appt.clientName || 'cliente').split(' ')[0];
          const tipo = appt.type;

          let msg = '';
          if (tipo === 'order') {
            msg = `📦 *¡Hola ${nombre}!* Esperamos que hayas recibido tu pedido sin novedad 😊\n\n¿Todo llegó bien? Tu opinión nos ayuda a mejorar 🙏`;
          } else if (tipo === 'reservation') {
            msg = `😊 *¡Hola ${nombre}!* ¿Cómo te fue con tu servicio de ayer?\n\nTu opinión es muy valiosa para nosotros. ¿Quedaste satisfecho/a? 🌟`;
          } else {
            msg = `🏍 *¡Hola ${nombre}!* ¿Cómo te fue con tu revisión de ayer en *CDA Ready to Race*?\n\nNos importa tu experiencia. ¿Quedaste satisfecho/a con el servicio? 😊\n\n¡Gracias por confiar en nosotros! 🙌`;
          }

          const r = await fetch(`${WAHA_API_URL}/api/sendText`, {
            method: 'POST',
            headers: getWahaHeaders(),
            body: JSON.stringify({ session: line.sessionName, chatId, text: msg })
          });

          if (r.ok) {
            // Marcar en memoria para no repetir
            followUpSentIds.add(appt.id);
            log(`✅ Seguimiento post-servicio enviado → ${nombre} (${chatId})`);
          }

        } catch (e: any) {
          log(`⚠️ Error seguimiento post-servicio ${appt.id}: ${e.message}`);
        }
      }

    } catch (e: any) {
      console.error('🔔 Error en cron de recordatorios:', e.message);
    }
  };

  // Correr inmediatamente al iniciar, luego cada 15 minutos
  runReminders();
  setInterval(runReminders, 15 * 60 * 1000);
};

export default router;

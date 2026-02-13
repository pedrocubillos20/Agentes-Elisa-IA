import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

const WAHA_API_URL = process.env.WAHA_API_URL || 'http://31.97.142.127:8080';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';

// ===== HELPERS =====
const getWahaHeaders = () => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WAHA_API_KEY) h['X-Api-Key'] = WAHA_API_KEY;
  return h;
};

const getOwnerId = async (userId: string): Promise<string> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  return user?.parentUserId || userId;
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
    if (r.ok) return true;
    if (endpoint !== '/api/sendFile') {
      const r2 = await fetch(`${WAHA_API_URL}/api/sendFile`, { method: 'POST', headers: getWahaHeaders(), body: JSON.stringify(body) });
      if (r2.ok) return true;
    }
    return false;
  } catch { return false; }
};

// ====================================================
// 📋 GET /api/scheduled — Listar mensajes programados
// ====================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const lineId = req.query.lineId as string;

    const where: any = { userId: ownerId };
    if (lineId) where.whatsappLineId = lineId;

    const messages = await prisma.scheduledMessage.findMany({
      where,
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
      timezone
    } = req.body;

    if (!targetId || !scheduledAt) {
      res.status(400).json({ error: 'Se requiere destinatario y fecha/hora' });
      return;
    }

    if (!message && !mediaUrl) {
      res.status(400).json({ error: 'Se requiere mensaje o media' });
      return;
    }

    const scheduled = await prisma.scheduledMessage.create({
      data: {
        userId: ownerId,
        whatsappLineId: whatsappLineId || null,
        targetType: targetType || 'contact',
        targetId,
        targetName: targetName || null,
        message: message || null,
        mediaUrl: mediaUrl || null,
        mediaType: mediaType || null,
        scheduledAt: new Date(scheduledAt),
        recurrence: recurrence || 'once',
        recurrenceDays: recurrenceDays || null,
        recurrenceTime: recurrenceTime || null,
        recurrenceEnd: recurrenceEnd ? new Date(recurrenceEnd) : null,
        timezone: timezone || 'America/Bogota',
        status: 'pending'
      }
    });

    console.log(`📅 Mensaje programado creado: ${scheduled.id} → ${targetId} @ ${scheduledAt}`);
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
      targetType, targetId, targetName,
      message, mediaUrl, mediaType,
      scheduledAt, recurrence, recurrenceDays, recurrenceTime, recurrenceEnd,
      timezone, status
    } = req.body;

    const updated = await prisma.scheduledMessage.update({
      where: { id: req.params.id },
      data: {
        ...(targetType !== undefined && { targetType }),
        ...(targetId !== undefined && { targetId }),
        ...(targetName !== undefined && { targetName }),
        ...(message !== undefined && { message }),
        ...(mediaUrl !== undefined && { mediaUrl }),
        ...(mediaType !== undefined && { mediaType }),
        ...(scheduledAt !== undefined && { scheduledAt: new Date(scheduledAt) }),
        ...(recurrence !== undefined && { recurrence }),
        ...(recurrenceDays !== undefined && { recurrenceDays }),
        ...(recurrenceTime !== undefined && { recurrenceTime }),
        ...(recurrenceEnd !== undefined && { recurrenceEnd: recurrenceEnd ? new Date(recurrenceEnd) : null }),
        ...(timezone !== undefined && { timezone }),
        ...(status !== undefined && { status }),
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
// ⏰ CRON: Verificar mensajes pendientes cada 60 segundos
// ====================================================
export const startScheduledMessagesCron = () => {
  console.log('⏰ Cron de mensajes programados INICIADO (cada 60s)');

  setInterval(async () => {
    try {
      const now = new Date();

      // Buscar mensajes pendientes cuya hora ya pasó
      const pending = await prisma.scheduledMessage.findMany({
        where: {
          status: 'pending',
          scheduledAt: { lte: now }
        },
        take: 50 // Procesar máx 50 a la vez
      });

      if (pending.length === 0) return;

      console.log(`⏰ Procesando ${pending.length} mensajes programados...`);

      for (const msg of pending) {
        try {
          await processScheduledMessage(msg);
        } catch (e: any) {
          console.error(`⏰ Error procesando ${msg.id}:`, e.message);
          await prisma.scheduledMessage.update({
            where: { id: msg.id },
            data: { status: 'failed', error: e.message }
          });
        }
      }
    } catch (e: any) {
      console.error('⏰ Error en cron de programados:', e.message);
    }
  }, 60000); // Cada 60 segundos
};

// ====================================================
// 🚀 Procesar un mensaje programado
// ====================================================
const processScheduledMessage = async (msg: any) => {
  const { userId, whatsappLineId, targetType, targetId, message, mediaUrl, mediaType } = msg;

  // Determinar sesión de WhatsApp
  let sessionName: string | null = null;

  if (whatsappLineId) {
    const line = await prisma.whatsappLine.findFirst({ where: { id: whatsappLineId, userId } });
    if (line) sessionName = line.sessionName;
  }
  if (!sessionName) {
    const firstLine = await prisma.whatsappLine.findFirst({ where: { userId, status: 'connected' } });
    if (firstLine) {
      sessionName = firstLine.sessionName;
    } else {
      sessionName = `user_${userId}`;
    }
  }

  // Determinar destinatarios según targetType
  let targets: { chatId: string; name?: string }[] = [];

  if (targetType === 'contact') {
    // Un solo contacto
    const phone = targetId.replace(/\D/g, '');
    targets = [{ chatId: phone.includes('@') ? phone : `${phone}@c.us`, name: msg.targetName }];

  } else if (targetType === 'group') {
    // Un grupo de WhatsApp
    targets = [{ chatId: targetId.includes('@g.us') ? targetId : `${targetId}@g.us`, name: msg.targetName }];

  } else if (targetType === 'stage') {
    // Todos los contactos en una etapa del embudo
    const where: any = { userId, stage: targetId };
    if (whatsappLineId) where.whatsappLineId = whatsappLineId;

    const convs = await prisma.conversation.findMany({
      where,
      select: { recipientId: true, recipientName: true }
    });

    targets = convs.map(c => ({
      chatId: c.recipientId.includes('@') ? c.recipientId : `${c.recipientId}@c.us`,
      name: c.recipientName || undefined
    }));
  }

  if (targets.length === 0) {
    await prisma.scheduledMessage.update({
      where: { id: msg.id },
      data: { status: 'failed', error: 'Sin destinatarios' }
    });
    return;
  }

  console.log(`📅 Enviando programado ${msg.id} a ${targets.length} destinatarios...`);

  let sentCount = 0;
  const DELAY = 3000; // 3s entre envíos

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    try {
      // Enviar texto
      if (message) {
        const sent = await sendWahaMessage(sessionName!, target.chatId, message);
        if (!sent) { console.error(`⏰ Falló envío a ${target.chatId}`); continue; }
      }

      // Enviar media
      if (mediaUrl) {
        const mediaObj = { url: mediaUrl, type: mediaType || 'image', name: 'media' };
        await sendWahaMedia(sessionName!, target.chatId, mediaObj, message ? undefined : undefined);
      }

      // Guardar mensaje en conversación si existe
      const conv = await prisma.conversation.findFirst({
        where: {
          userId,
          recipientId: { endsWith: target.chatId.replace('@c.us', '').replace('@g.us', '').slice(-10) },
          ...(whatsappLineId ? { whatsappLineId } : {})
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

      sentCount++;

      // Delay entre envíos
      if (i < targets.length - 1) {
        await new Promise(r => setTimeout(r, DELAY));
      }
    } catch (e: any) {
      console.error(`⏰ Error enviando a ${target.chatId}:`, e.message);
    }
  }

  console.log(`📅 Programado ${msg.id}: ${sentCount}/${targets.length} enviados`);

  // Actualizar estado según recurrencia
  if (msg.recurrence === 'once') {
    await prisma.scheduledMessage.update({
      where: { id: msg.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        lastSentAt: new Date(),
        sendCount: msg.sendCount + 1
      }
    });
  } else {
    // Recurrente: calcular siguiente envío
    const nextDate = calculateNextOccurrence(msg);

    if (nextDate && (!msg.recurrenceEnd || nextDate <= new Date(msg.recurrenceEnd))) {
      await prisma.scheduledMessage.update({
        where: { id: msg.id },
        data: {
          scheduledAt: nextDate,
          lastSentAt: new Date(),
          sendCount: msg.sendCount + 1
        }
      });
      console.log(`📅 Próximo envío: ${nextDate.toISOString()}`);
    } else {
      // Fin de recurrencia
      await prisma.scheduledMessage.update({
        where: { id: msg.id },
        data: {
          status: 'sent',
          lastSentAt: new Date(),
          sendCount: msg.sendCount + 1
        }
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
      // Si no hay días específicos, repetir cada 7 días
      const next = new Date(current);
      next.setDate(next.getDate() + 7);
      next.setHours(hours, minutes, 0, 0);
      return next;
    }

    // Buscar siguiente día de la semana
    const today = current.getDay(); // 0=Dom, 1=Lun...
    const sortedDays = [...days].sort((a, b) => a - b);

    // Buscar el siguiente día después de hoy
    let nextDay = sortedDays.find(d => d > today);
    let daysToAdd: number;

    if (nextDay !== undefined) {
      daysToAdd = nextDay - today;
    } else {
      // No hay más días esta semana, ir al primer día de la próxima semana
      nextDay = sortedDays[0];
      daysToAdd = 7 - today + nextDay;
    }

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

export default router;

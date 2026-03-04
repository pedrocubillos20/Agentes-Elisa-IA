import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { sendPushToUser } from './push.routes';

// =============================================
// 📅 APPOINTMENTS / ORDERS / RESERVATIONS
// 
// Full sync: Agenda ↔ Recursos ↔ Conversaciones
//
// When admin updates from agenda:
// 1. Updates the appointment in DB
// 2. Finds the client's WhatsApp conversation
// 3. Sends notification to client via WhatsApp
// 4. Updates conversation contextData (AI memory)
// 5. Saves system message in conversation thread
// 6. Push notification to admin
// =============================================

interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string; parentUserId?: string };
}

const router = Router();

// ⚡ getOwnerId with cache
const ownerIdCache = new Map<string, { value: string; ts: number }>();
const getOwnerId = async (userId: string): Promise<string> => {
  const cached = ownerIdCache.get(userId);
  if (cached && Date.now() - cached.ts < 300000) return cached.value;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  const ownerId = user?.parentUserId || userId;
  ownerIdCache.set(userId, { value: ownerId, ts: Date.now() });
  return ownerId;
};

// Helper: convert date string to DateTime
function toDateTime(dateStr: string): Date {
  if (!dateStr) return new Date();
  if (dateStr.includes('T')) return new Date(dateStr);
  return new Date(dateStr + 'T12:00:00.000Z');
}

// =============================================
// 📱 WHATSAPP SEND HELPERS (self-contained)
// Supports both WAHA and Cloud API
// =============================================
const WAHA_API_URL = process.env.WAHA_API_URL || 'http://31.97.142.127:8080';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
const CLOUD_API_URL = 'https://graph.facebook.com/v21.0';

const getWahaHeaders = () => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WAHA_API_KEY) h['X-Api-Key'] = WAHA_API_KEY;
  return h;
};

const sendWahaText = async (sessionName: string, chatId: string, text: string): Promise<boolean> => {
  try {
    const r = await fetch(`${WAHA_API_URL}/api/sendText`, {
      method: 'POST',
      headers: getWahaHeaders(),
      body: JSON.stringify({ session: sessionName, chatId, text })
    });
    return r.ok;
  } catch (e: any) {
    console.error('❌ WAHA sendText error:', e.message);
    return false;
  }
};

const sendCloudText = async (phoneNumberId: string, accessToken: string, to: string, text: string): Promise<boolean> => {
  try {
    const r = await fetch(`${CLOUD_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/\D/g, ''), type: 'text', text: { body: text } })
    });
    return r.ok;
  } catch (e: any) {
    console.error('❌ Cloud sendText error:', e.message);
    return false;
  }
};

// =============================================
// 🔗 SYNC ENGINE — Core sync logic
// =============================================

interface SyncOptions {
  userId: string;
  appointment: any;
  previousData?: any;
  action: 'created' | 'updated' | 'status_changed' | 'cancelled' | 'deleted';
  changes?: Record<string, { from: any; to: any }>;
  notifyClient?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  appointment: 'Cita', order: 'Pedido', reservation: 'Reserva',
  cita: 'Cita', pedido: 'Pedido', reserva: 'Reserva',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente', confirmed: 'Confirmada', completed: 'Completada',
  cancelled: 'Cancelada', delivered: 'Entregada', in_progress: 'En proceso',
};

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = d.getUTCDate();
  const month = MONTH_NAMES[d.getUTCMonth()];
  const dayName = DAY_NAMES[d.getUTCDay()];
  return `${dayName} ${day} de ${month}`;
}

function formatProducts(products: any): string {
  if (!products) return '';
  try {
    const items = typeof products === 'string' ? JSON.parse(products) : products;
    if (Array.isArray(items)) {
      return items.map((p: any) => {
        const name = p.name || p.producto || p.nombre || 'Producto';
        const qty = p.quantity || p.cantidad || 1;
        const price = p.price || p.precio || 0;
        return `  • ${qty}x ${name}${price ? ` ($${Number(price).toLocaleString('es-CO')})` : ''}`;
      }).join('\n');
    }
    return '';
  } catch { return ''; }
}

// Build notification message for WhatsApp
function buildNotificationMessage(opts: SyncOptions): string {
  const { appointment, action, changes } = opts;
  const typeLabel = TYPE_LABELS[appointment.type] || 'Registro';
  const isFeminine = typeLabel === 'Cita' || typeLabel === 'Reserva';
  const dateStr = appointment.date ? formatDate(appointment.date) : '';
  const timeStr = appointment.time || '';

  switch (action) {
    case 'created':
      return [
        `✅ ¡Tu ${typeLabel.toLowerCase()} ha sido registrad${isFeminine ? 'a' : 'o'}!`,
        '',
        dateStr ? `📅 Fecha: ${dateStr}` : '',
        timeStr ? `🕐 Hora: ${timeStr}` : '',
        appointment.duration ? `⏱️ Duración: ${appointment.duration} min` : '',
        appointment.resourceName ? `📍 ${appointment.resourceName}` : '',
        appointment.address ? `📍 Dirección: ${appointment.address}` : '',
        appointment.type === 'order' && appointment.products ? `\n🛒 Productos:\n${formatProducts(appointment.products)}` : '',
        appointment.total ? `\n💰 Total: $${Number(appointment.total).toLocaleString('es-CO')}` : '',
        appointment.notes ? `📝 Notas: ${appointment.notes}` : '',
        `\n📋 Estado: ${STATUS_LABELS[appointment.status] || appointment.status}`,
        `\nSi necesitas cambiar algo, escríbenos 😊`,
      ].filter(Boolean).join('\n');

    case 'updated': {
      const changeLines: string[] = [];
      if (changes) {
        if (changes.date) changeLines.push(`📅 Fecha: ${formatDate(changes.date.from)} → ${formatDate(changes.date.to)}`);
        if (changes.time) changeLines.push(`🕐 Hora: ${changes.time.from} → ${changes.time.to}`);
        if (changes.duration) changeLines.push(`⏱️ Duración: ${changes.duration.from} min → ${changes.duration.to} min`);
        if (changes.address) changeLines.push(`📍 Dirección actualizada: ${changes.address.to}`);
        if (changes.notes) changeLines.push(`📝 Notas: ${changes.notes.to}`);
        if (changes.products) changeLines.push(`🛒 Productos actualizados`);
        if (changes.total) changeLines.push(`💰 Total: $${Number(changes.total.from).toLocaleString('es-CO')} → $${Number(changes.total.to).toLocaleString('es-CO')}`);
        if (changes.resourceName) changeLines.push(`📍 Recurso: ${changes.resourceName.from || 'Sin asignar'} → ${changes.resourceName.to}`);
      }
      return [
        `📝 Tu ${typeLabel.toLowerCase()} ha sido actualizad${isFeminine ? 'a' : 'o'}:`,
        '', ...changeLines, '',
        `📅 ${dateStr}${timeStr ? ` a las ${timeStr}` : ''}`,
        appointment.resourceName ? `📍 ${appointment.resourceName}` : '',
        `\nSi tienes alguna duda, escríbenos 😊`,
      ].filter(Boolean).join('\n');
    }

    case 'status_changed': {
      const statusLabel = STATUS_LABELS[appointment.status] || appointment.status;
      const emoji = appointment.status === 'confirmed' ? '✅' : appointment.status === 'completed' ? '🎉' : appointment.status === 'cancelled' ? '❌' : '📋';
      return [
        `${emoji} Tu ${typeLabel.toLowerCase()} ha sido ${statusLabel.toLowerCase()}`,
        '',
        dateStr ? `📅 ${dateStr}${timeStr ? ` a las ${timeStr}` : ''}` : '',
        appointment.resourceName ? `📍 ${appointment.resourceName}` : '',
        appointment.status === 'confirmed' ? '\n¡Te esperamos! 😊' : '',
        appointment.status === 'cancelled' ? '\nSi deseas reagendar, escríbenos.' : '',
        appointment.status === 'completed' ? '\n¡Gracias por tu visita! Aquí estamos para lo que necesites.' : '',
      ].filter(Boolean).join('\n');
    }

    case 'cancelled':
    case 'deleted':
      return [
        `❌ Tu ${typeLabel.toLowerCase()} ha sido cancelad${isFeminine ? 'a' : 'o'}.`,
        '',
        dateStr ? `📅 Era para el ${dateStr}${timeStr ? ` a las ${timeStr}` : ''}` : '',
        '\nSi deseas agendar de nuevo, escríbenos. Estamos para servirte 😊',
      ].filter(Boolean).join('\n');

    default:
      return '';
  }
}

// Build contextData update for the conversation AI memory
function buildContextUpdate(appointment: any, action: string): Record<string, any> {
  const update: Record<string, any> = {};
  const type = appointment.type;
  const isCancelled = action === 'deleted' || action === 'cancelled' || 
    (action === 'status_changed' && appointment.status === 'cancelled');
  const isCompleted = action === 'status_changed' && appointment.status === 'completed';
  const isConfirmed = action === 'status_changed' && appointment.status === 'confirmed';

  if (type === 'appointment' || type === 'cita') {
    update.cita = isCancelled ? 'cancelada' : isCompleted ? 'completada' : isConfirmed ? 'confirmada' : action === 'created' ? 'creada' : 'actualizada';
    update.fecha_cita = appointment.date ? new Date(appointment.date).toISOString().split('T')[0] : '';
    update.hora_cita = appointment.time || '';
    if (appointment.notes) update.tipo_cita = appointment.notes;
  } else if (type === 'order' || type === 'pedido') {
    update.pedido = isCancelled ? 'cancelado' : isCompleted ? 'completado' : isConfirmed ? 'confirmado' : action === 'created' ? 'creado' : 'actualizado';
    update.fecha_entrega = appointment.date ? new Date(appointment.date).toISOString().split('T')[0] : '';
    if (appointment.products) {
      try {
        const items = typeof appointment.products === 'string' ? JSON.parse(appointment.products) : appointment.products;
        if (Array.isArray(items) && items.length > 0) {
          update.producto_servicio = items.map((p: any) => p.name || p.producto || p.nombre).filter(Boolean).join(', ');
          update.cantidad = items.reduce((sum: number, p: any) => sum + (p.quantity || p.cantidad || 1), 0).toString();
        }
      } catch {}
    }
    if (appointment.total) update.total = appointment.total.toString();
    if (appointment.address) update.direccion = appointment.address;
  } else if (type === 'reservation' || type === 'reserva') {
    update.reserva = isCancelled ? 'cancelada' : isCompleted ? 'completada' : isConfirmed ? 'confirmada' : action === 'created' ? 'creada' : 'actualizada';
    update.fecha_reserva = appointment.date ? new Date(appointment.date).toISOString().split('T')[0] : '';
    update.hora_reserva = appointment.time || '';
    if (appointment.notes) update.tipo_reserva = appointment.notes;
  }

  return update;
}

// Main sync function
async function syncAppointmentWithConversation(opts: SyncOptions): Promise<{ sent: boolean; conversationId?: string }> {
  const { userId, appointment, action, notifyClient = true } = opts;
  const phone = appointment.clientPhone;
  if (!phone) {
    console.log('⚠️ Sync skipped: no clientPhone');
    return { sent: false };
  }

  try {
    const cleanPhone = phone.replace(/\D/g, '');
    const last10 = cleanPhone.slice(-10);
    const lineId = appointment.whatsappLineId;

    // 1. Find the conversation — multiple strategies
    let conversation = await prisma.conversation.findFirst({
      where: { userId, recipientId: cleanPhone, ...(lineId ? { whatsappLineId: lineId } : {}) }
    });
    if (!conversation) {
      conversation = await prisma.conversation.findFirst({
        where: { userId, recipientId: { endsWith: last10 }, ...(lineId ? { whatsappLineId: lineId } : {}) }
      });
    }
    if (!conversation) {
      conversation = await prisma.conversation.findFirst({
        where: {
          userId,
          OR: [
            { recipientId: `${cleanPhone}@c.us` },
            { recipientId: `${cleanPhone}@s.whatsapp.net` },
            { recipientId: { endsWith: `${last10}@c.us` } },
            { recipientId: { endsWith: `${last10}@s.whatsapp.net` } },
          ],
          ...(lineId ? { whatsappLineId: lineId } : {})
        }
      });
    }
    // Last fallback: any line
    if (!conversation && lineId) {
      conversation = await prisma.conversation.findFirst({
        where: {
          userId,
          OR: [
            { recipientId: cleanPhone },
            { recipientId: { endsWith: last10 } },
            { recipientId: `${cleanPhone}@c.us` },
            { recipientId: { endsWith: `${last10}@c.us` } },
          ]
        }
      });
    }

    if (!conversation) {
      console.log(`⚠️ Sync: No conversation found for ${cleanPhone}`);
      return { sent: false };
    }

    // 2. Update contextData (AI memory)
    const existingContext = (conversation.contextData as Record<string, any>) || {};
    const contextUpdate = buildContextUpdate(appointment, action);
    const mergedContext = { ...existingContext, ...contextUpdate };

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { contextData: mergedContext }
    });
    console.log(`🧠 Context synced for ${appointment.clientName}: ${Object.keys(contextUpdate).join(', ')}`);

    // 3. Send WhatsApp notification
    let sent = false;
    if (notifyClient) {
      const message = buildNotificationMessage(opts);
      if (message) {
        const effectiveLineId = lineId || conversation.whatsappLineId;

        if (effectiveLineId) {
          const line = await prisma.whatsappLine.findUnique({
            where: { id: effectiveLineId },
            select: { sessionName: true, connectionType: true, cloudPhoneNumberId: true, cloudAccessToken: true }
          });

          if (line) {
            const isCloud = line.connectionType === 'cloud_api' && line.cloudPhoneNumberId && line.cloudAccessToken;
            if (isCloud) {
              sent = await sendCloudText(line.cloudPhoneNumberId!, line.cloudAccessToken!, cleanPhone, message);
            } else if (line.sessionName) {
              const chatId = conversation.recipientId || `${cleanPhone}@c.us`;
              sent = await sendWahaText(line.sessionName, chatId, message);
            }
          }
        }

        // 4. Save notification as message in conversation
        if (sent) {
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              content: message,
              fromMe: true,
              userId,
              role: 'assistant'
            }
          });

          // Update lastMessage with a short summary
          const typeLabel = TYPE_LABELS[appointment.type] || 'Registro';
          const isFeminine = typeLabel === 'Cita' || typeLabel === 'Reserva';
          const shortMsg = action === 'status_changed'
            ? `📋 ${typeLabel} ${STATUS_LABELS[appointment.status] || appointment.status}`
            : action === 'deleted' || action === 'cancelled'
              ? `❌ ${typeLabel} cancelad${isFeminine ? 'a' : 'o'}`
              : action === 'created'
                ? `✅ ${typeLabel} registrad${isFeminine ? 'a' : 'o'}`
                : `📝 ${typeLabel} actualizad${isFeminine ? 'a' : 'o'}`;

          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessage: shortMsg, updatedAt: new Date() }
          });

          console.log(`📱 WhatsApp sent to ${appointment.clientName} (${cleanPhone}) — ${action}`);
        } else {
          console.log(`⚠️ WhatsApp send failed for ${appointment.clientName} (${cleanPhone})`);
        }
      }
    }

    // 5. Push notification to admin
    try {
      const typeLabel = TYPE_LABELS[appointment.type] || 'Registro';
      const actionLabels: Record<string, string> = {
        created: 'creado', updated: 'actualizado', status_changed: 'cambió estado',
        cancelled: 'cancelado', deleted: 'eliminado'
      };
      await sendPushToUser(userId, {
        title: `📅 ${typeLabel} ${actionLabels[action] || action}`,
        body: `${appointment.clientName} — ${appointment.time || ''} ${appointment.date ? formatDate(appointment.date) : ''}`,
        url: '/agenda',
        tag: `appointment-${appointment.id}`
      });
    } catch (e) { /* Push is best-effort */ }

    return { sent, conversationId: conversation.id };
  } catch (error: any) {
    console.error(`❌ Sync error for appointment ${appointment.id}:`, error.message);
    return { sent: false };
  }
}

// Helper: detect what changed between old and new
function detectChanges(existing: any, updated: any): Record<string, { from: any; to: any }> | null {
  const changes: Record<string, { from: any; to: any }> = {};
  const fields = ['date', 'time', 'duration', 'notes', 'address', 'products', 'total', 'status', 'resourceName', 'resourceId', 'clientName'];

  for (const field of fields) {
    const oldVal = existing[field];
    const newVal = updated[field];
    if (newVal === undefined || newVal === null) continue;

    if (field === 'date') {
      const oldDate = oldVal ? new Date(oldVal).toISOString().split('T')[0] : '';
      const newDate = typeof newVal === 'string' 
        ? (newVal.includes('T') ? new Date(newVal).toISOString().split('T')[0] : newVal)
        : new Date(newVal).toISOString().split('T')[0];
      if (oldDate !== newDate) changes[field] = { from: oldVal, to: newVal };
    } else if (field === 'products') {
      if (JSON.stringify(oldVal || []) !== JSON.stringify(newVal || [])) {
        changes[field] = { from: oldVal, to: newVal };
      }
    } else if (String(oldVal || '') !== String(newVal || '')) {
      changes[field] = { from: oldVal, to: newVal };
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

// =============================================
// 📋 ROUTES
// =============================================

// GET /api/appointments
router.get('/', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    const userId = await getOwnerId(user?.id || '');
    const { type, status, date, startDate, endDate, limit = '100', lineId } = req.query;

    const where: any = { userId };
    if (lineId) where.whatsappLineId = lineId as string;
    if (type && type !== 'all') where.type = type;
    if (status && status !== 'all') where.status = status;

    if (date) {
      const targetDate = new Date(date as string);
      targetDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);
      where.date = { gte: targetDate, lt: nextDay };
    }

    if (startDate && endDate) {
      where.date = { gte: new Date(startDate as string), lte: new Date(endDate as string) };
    }

    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      take: parseInt(limit as string),
      include: { client: { select: { id: true, name: true, phone: true, email: true } } }
    });

    res.json({ appointments });
  } catch (error: any) {
    console.error('Error listando citas:', error);
    res.status(500).json({ error: 'Error al obtener citas' });
  }
});

// GET /api/appointments/today
router.get('/today', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    const userId = await getOwnerId(user?.id || '');
    const { lineId } = req.query;

    // Use Colombia timezone for "today"
    const now = new Date();
    const colombiaOffset = -5;
    const colombiaMs = now.getTime() + (colombiaOffset * 60 + now.getTimezoneOffset()) * 60000;
    const colombiaTime = new Date(colombiaMs);
    const todayStr = colombiaTime.toISOString().split('T')[0];

    const today = new Date(todayStr + 'T05:00:00.000Z'); // Midnight Colombia = 5 AM UTC
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const where: any = { userId, date: { gte: today, lt: tomorrow } };
    if (lineId) where.whatsappLineId = lineId as string;

    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: { time: 'asc' },
      include: { client: true }
    });

    res.json({ appointments });
  } catch (error) {
    console.error('Error obteniendo citas de hoy:', error);
    res.status(500).json({ error: 'Error al obtener citas' });
  }
});

// GET /api/appointments/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    const userId = await getOwnerId(user?.id || '');
    const { lineId } = req.query;
    const where: any = { userId };
    if (lineId) where.whatsappLineId = lineId as string;

    const total = await prisma.appointment.count({ where });
    const pending = await prisma.appointment.count({ where: { ...where, status: 'pending' } });
    const confirmed = await prisma.appointment.count({ where: { ...where, status: 'confirmed' } });
    const completed = await prisma.appointment.count({ where: { ...where, status: 'completed' } });

    res.json({ total, pending, confirmed, completed });
  } catch (error) {
    console.error('Error stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// POST /api/appointments — Create (with sync)
router.post('/', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    const userId = await getOwnerId(user?.id || '');
    const {
      type, clientId, clientName, clientPhone,
      date, time, duration, notes, address,
      products, total, status, lineId,
      resourceId, resourceName,
      notifyClient = true
    } = req.body;

    if (!clientName || !clientPhone || !date || !time) {
      return res.status(400).json({ error: 'Nombre, teléfono, fecha y hora son requeridos' });
    }

    if (clientId) {
      const client = await prisma.client.findFirst({ where: { id: clientId, userId } });
      if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Auto-assign resource if not specified
    let assignedResourceId = resourceId || null;
    let assignedResourceName = resourceName || null;

    if (!assignedResourceId) {
      const resWhere: any = { userId, isActive: true };
      if (lineId) resWhere.OR = [{ whatsappLineId: lineId }, { whatsappLineId: null }];
      const activeResources = await prisma.resource.findMany({ where: resWhere, orderBy: { order: 'asc' } });

      if (activeResources.length > 0 && date && time) {
        const dayStart = new Date(toDateTime(date).toISOString().split('T')[0] + 'T00:00:00Z');
        const dayEnd = new Date(toDateTime(date).toISOString().split('T')[0] + 'T23:59:59Z');

        const [tH, tM] = time.split(':').map(Number);
        const requestMin = tH * 60 + tM;
        const slotDuration = duration || 60;

        const dayAppts = await prisma.appointment.findMany({
          where: { userId, date: { gte: dayStart, lte: dayEnd }, status: { notIn: ['cancelled'] } },
          select: { time: true, duration: true, resourceId: true }
        });

        const overlapping = dayAppts.filter(a => {
          if (!a.time) return false;
          const [aH, aM] = a.time.split(':').map(Number);
          const aStart = aH * 60 + aM;
          const aEnd = aStart + (a.duration || slotDuration);
          return aStart < (requestMin + slotDuration) && aEnd > requestMin;
        });

        const occupiedCounts = new Map<string, number>();
        for (const a of overlapping) {
          if (a.resourceId) occupiedCounts.set(a.resourceId, (occupiedCounts.get(a.resourceId) || 0) + 1);
        }
        const freeResource = activeResources.find(r => {
          const used = occupiedCounts.get(r.id) || 0;
          return used < (r.capacity || 1);
        });
        if (freeResource) {
          assignedResourceId = freeResource.id;
          assignedResourceName = freeResource.name;
        }
      }
    }

    const appointment = await prisma.appointment.create({
      data: {
        userId: userId!,
        clientId: clientId || null,
        type: type || 'appointment',
        clientName, clientPhone,
        date: toDateTime(date), time,
        duration: duration || null,
        status: status || 'pending',
        notes: notes || null,
        address: address || null,
        products: products || null,
        total: total || null,
        whatsappLineId: lineId || null,
        resourceId: assignedResourceId,
        resourceName: assignedResourceName
      },
      include: { client: { select: { id: true, name: true, phone: true } } }
    });

    if (type === 'order' && total && clientId) {
      await prisma.client.update({
        where: { id: clientId },
        data: { totalPurchases: { increment: total }, status: 'active', lastContact: new Date() }
      });
    }

    // 🔗 SYNC
    if (notifyClient) {
      syncAppointmentWithConversation({ userId, appointment, action: 'created', notifyClient: true })
        .catch(e => console.error('Sync error:', e.message));
    }

    res.status(201).json({ appointment });
  } catch (error: any) {
    console.error('Error creando cita:', error);
    res.status(500).json({ error: 'Error al crear cita' });
  }
});

// PUT /api/appointments/:id — Update (with sync)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    const userId = await getOwnerId(user?.id || '');
    const { id } = req.params;
    const {
      type, clientName, clientPhone, date, time,
      duration, notes, address, products, total, status,
      resourceId, resourceName,
      notifyClient = true
    } = req.body;

    const existing = await prisma.appointment.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ error: 'Cita no encontrada' });

    const updateData: any = {
      type: type !== undefined ? type : existing.type,
      clientName: clientName !== undefined ? clientName : existing.clientName,
      clientPhone: clientPhone !== undefined ? clientPhone : existing.clientPhone,
      date: date !== undefined ? toDateTime(date) : existing.date,
      time: time !== undefined ? time : existing.time,
      duration: duration !== undefined ? duration : existing.duration,
      notes: notes !== undefined ? notes : existing.notes,
      address: address !== undefined ? address : existing.address,
      products: products !== undefined ? products : existing.products,
      total: total !== undefined ? total : existing.total,
      status: status !== undefined ? status : existing.status,
      resourceId: resourceId !== undefined ? resourceId : existing.resourceId,
      resourceName: resourceName !== undefined ? resourceName : existing.resourceName,
    };

    const appointment = await prisma.appointment.update({
      where: { id },
      data: updateData,
      include: { client: { select: { id: true, name: true, phone: true } } }
    });

    const changes = detectChanges(existing, updateData);
    const hasStatusChange = changes && changes.status;
    const action = hasStatusChange 
      ? (updateData.status === 'cancelled' ? 'cancelled' : 'status_changed') 
      : 'updated';

    // 🔗 SYNC
    if (changes && notifyClient) {
      syncAppointmentWithConversation({
        userId, appointment, previousData: existing,
        action, changes, notifyClient: true
      }).catch(e => console.error('Sync error:', e.message));
    }

    res.json({ appointment, changes });
  } catch (error: any) {
    console.error('Error actualizando cita:', error);
    res.status(500).json({ error: 'Error al actualizar cita' });
  }
});

// PUT /api/appointments/:id/status — Change status (with sync)
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    const userId = await getOwnerId(user?.id || '');
    const { id } = req.params;
    const { status, notifyClient = true } = req.body;

    const existing = await prisma.appointment.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ error: 'Cita no encontrada' });

    if (existing.status === status) {
      return res.json({ appointment: existing, message: 'Estado sin cambios' });
    }

    const appointment = await prisma.appointment.update({ where: { id }, data: { status } });

    // Completed orders → update client stats
    if (status === 'completed' && existing.type === 'order' && existing.total && existing.clientId) {
      await prisma.client.update({
        where: { id: existing.clientId },
        data: { totalPurchases: { increment: existing.total }, lastContact: new Date() }
      });
    }

    if (status === 'cancelled' && existing.resourceId) {
      console.log(`🔓 Resource ${existing.resourceName} freed — appointment ${id} cancelled`);
    }

    // 🔗 SYNC
    const action = status === 'cancelled' ? 'cancelled' : 'status_changed';
    if (notifyClient) {
      syncAppointmentWithConversation({
        userId, appointment: { ...existing, ...appointment },
        previousData: existing, action,
        changes: { status: { from: existing.status, to: status } },
        notifyClient: true
      }).catch(e => console.error('Sync error:', e.message));
    }

    res.json({ appointment });
  } catch (error) {
    console.error('Error actualizando estado:', error);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

// DELETE /api/appointments/:id — Delete (with sync)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    const userId = await getOwnerId(user?.id || '');
    const { id } = req.params;
    const notifyClient = req.query.notify !== 'false';

    const existing = await prisma.appointment.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ error: 'Cita no encontrada' });

    // SYNC BEFORE delete (need the data)
    if (notifyClient) {
      await syncAppointmentWithConversation({
        userId, appointment: existing, action: 'deleted', notifyClient: true
      }).catch(e => console.error('Sync error:', e.message));
    }

    await prisma.appointment.delete({ where: { id } });
    res.json({ message: 'Cita eliminada' });
  } catch (error) {
    console.error('Error eliminando cita:', error);
    res.status(500).json({ error: 'Error al eliminar cita' });
  }
});

export default router;

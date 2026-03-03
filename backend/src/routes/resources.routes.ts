import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

// =============================================
// 📅 RESOURCES & AVAILABILITY SYSTEM
// 
// Manages business resources (tables, modules, chairs, rooms)
// and checks real-time availability for appointments.
//
// Works for any business type:
// - CDA: modules/stations for vehicle inspection
// - Restaurant: tables with capacity
// - Barbershop/Salon: chairs/stations
// - Clinic: rooms/offices
// - Gym: courts/equipment
// - Hotel: rooms
// =============================================

interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string; parentUserId?: string };
}

const router = Router();

// Helper: get owner ID
const ownerCache = new Map<string, { value: string; ts: number }>();
const getOwnerId = async (userId: string): Promise<string> => {
  const cached = ownerCache.get(userId);
  if (cached && Date.now() - cached.ts < 300000) return cached.value;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  const ownerId = user?.parentUserId || userId;
  ownerCache.set(userId, { value: ownerId, ts: Date.now() });
  return ownerId;
};

// =============================================
// 🏪 RESOURCES CRUD
// =============================================

// GET /api/resources — List all resources (filtered by lineId)
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);
    const lineId = req.query.lineId as string || null;

    const where: any = { userId: ownerId };
    if (lineId) {
      where.OR = [{ whatsappLineId: lineId }, { whatsappLineId: null }];
    }

    const resources = await prisma.resource.findMany({
      where,
      orderBy: [{ order: 'asc' }, { name: 'asc' }]
    });

    res.json({ resources });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/resources — Create resource
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    const { name, type, capacity, notes, order, whatsappLineId } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });

    const resource = await prisma.resource.create({
      data: {
        userId: ownerId,
        name,
        type: type || 'generic',
        capacity: capacity || 1,
        notes: notes || null,
        order: order || 0,
        whatsappLineId: whatsappLineId || null
      }
    });

    res.status(201).json({ resource });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/resources/:id — Update resource
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;

    const existing = await prisma.resource.findFirst({ where: { id, userId: ownerId } });
    if (!existing) return res.status(404).json({ error: 'Recurso no encontrado' });

    const { name, type, capacity, notes, order, isActive } = req.body;

    const resource = await prisma.resource.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existing.name,
        type: type !== undefined ? type : existing.type,
        capacity: capacity !== undefined ? capacity : existing.capacity,
        notes: notes !== undefined ? notes : existing.notes,
        order: order !== undefined ? order : existing.order,
        isActive: isActive !== undefined ? isActive : existing.isActive,
      }
    });

    res.json({ resource });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/resources/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;

    const existing = await prisma.resource.findFirst({ where: { id, userId: ownerId } });
    if (!existing) return res.status(404).json({ error: 'Recurso no encontrado' });

    await prisma.resource.delete({ where: { id } });
    res.json({ message: 'Recurso eliminado' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// 🕐 BUSINESS SCHEDULE CRUD
// =============================================

// GET /api/resources/schedule — Get business hours (filtered by lineId)
router.get('/schedule', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);
    const lineId = req.query.lineId as string || null;

    const where: any = { userId: ownerId };
    if (lineId) where.whatsappLineId = lineId;
    else where.whatsappLineId = null; // Global schedules only

    let schedule = await prisma.businessSchedule.findMany({
      where,
      orderBy: { dayOfWeek: 'asc' }
    });

    // Auto-create default schedule if empty for this line
    if (schedule.length === 0) {
      const defaults = [];
      for (let day = 0; day <= 6; day++) {
        defaults.push({
          userId: ownerId,
          dayOfWeek: day,
          isOpen: day >= 1 && day <= 6,
          startTime: '08:00',
          endTime: '18:00',
          slotDuration: 60,
          whatsappLineId: lineId || null
        });
      }
      try {
        await prisma.businessSchedule.createMany({ data: defaults, skipDuplicates: true });
      } catch (e: any) {
        console.log(`⚠️ Schedule auto-create skipped (duplicates): ${e.message?.substring(0, 80)}`);
      }
      schedule = await prisma.businessSchedule.findMany({
        where,
        orderBy: { dayOfWeek: 'asc' }
      });
    }

    res.json({ schedule });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/resources/schedule — Update business hours (bulk, per line)
router.put('/schedule', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    const { schedule, whatsappLineId } = req.body;
    if (!Array.isArray(schedule)) return res.status(400).json({ error: 'schedule debe ser un array' });
    const lineId = whatsappLineId || null;

    for (const day of schedule) {
      // findFirst + update/create (upsert doesn't work well with nullable compound unique)
      const existing = await prisma.businessSchedule.findFirst({
        where: { userId: ownerId, dayOfWeek: day.dayOfWeek, whatsappLineId: lineId }
      });
      const data = {
        isOpen: day.isOpen ?? true,
        startTime: day.startTime || '08:00',
        endTime: day.endTime || '18:00',
        slotDuration: day.slotDuration || 60,
        breakStart: day.breakStart || null,
        breakEnd: day.breakEnd || null,
      };
      if (existing) {
        await prisma.businessSchedule.update({ where: { id: existing.id }, data });
      } else {
        await prisma.businessSchedule.create({ data: { userId: ownerId, dayOfWeek: day.dayOfWeek, whatsappLineId: lineId, ...data } });
      }
    }

    const updated = await prisma.businessSchedule.findMany({
      where: { userId: ownerId, whatsappLineId: lineId },
      orderBy: { dayOfWeek: 'asc' }
    });

    res.json({ schedule: updated });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// 📊 AVAILABILITY CHECK — Core logic
// 
// GET /api/resources/availability?date=2026-02-28
// Returns available time slots per resource for a given date
// =============================================
router.get('/availability', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    const { date, resourceId, lineId } = req.query;
    if (!date) return res.status(400).json({ error: 'Fecha requerida (date=YYYY-MM-DD)' });

    const targetDate = new Date(date as string);
    const dayOfWeek = targetDate.getDay();
    const selectedLineId = lineId as string || null;

    // 1. Get business schedule for this day (line-specific or global)
    let daySchedule = await prisma.businessSchedule.findFirst({
      where: { userId: ownerId, dayOfWeek, whatsappLineId: selectedLineId }
    });
    // Fallback to global schedule if no line-specific one
    if (!daySchedule && selectedLineId) {
      daySchedule = await prisma.businessSchedule.findFirst({
        where: { userId: ownerId, dayOfWeek, whatsappLineId: null }
      });
    }

    if (!daySchedule || !daySchedule.isOpen) {
      return res.json({ available: false, message: 'Cerrado este día', slots: [] });
    }

    // 2. Get active resources (line-specific + global)
    const resourceWhere: any = { userId: ownerId, isActive: true };
    if (resourceId) resourceWhere.id = resourceId as string;
    else if (selectedLineId) resourceWhere.OR = [{ whatsappLineId: selectedLineId }, { whatsappLineId: null }];

    const resources = await prisma.resource.findMany({
      where: resourceWhere,
      orderBy: [{ order: 'asc' }, { name: 'asc' }]
    });

    // 3. Get existing appointments for this date
    const dayStart = new Date(date as string + 'T00:00:00');
    const dayEnd = new Date(date as string + 'T23:59:59');

    const appointments = await prisma.appointment.findMany({
      where: {
        userId: ownerId,
        date: { gte: dayStart, lte: dayEnd },
        status: { notIn: ['cancelled'] }
      },
      select: { time: true, duration: true, resourceId: true, resourceName: true, clientName: true, type: true, status: true }
    });

    // 4. Generate time slots
    const slotDuration = daySchedule.slotDuration || 60;
    const slots: string[] = [];
    
    const [startH, startM] = daySchedule.startTime.split(':').map(Number);
    const [endH, endM] = daySchedule.endTime.split(':').map(Number);
    const startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;

    // Break time
    let breakStartMin = -1, breakEndMin = -1;
    if (daySchedule.breakStart && daySchedule.breakEnd) {
      const [bsH, bsM] = daySchedule.breakStart.split(':').map(Number);
      const [beH, beM] = daySchedule.breakEnd.split(':').map(Number);
      breakStartMin = bsH * 60 + bsM;
      breakEndMin = beH * 60 + beM;
    }

    for (let m = startMin; m + slotDuration <= endMin; m += slotDuration) {
      // Skip break time
      if (breakStartMin >= 0 && m >= breakStartMin && m < breakEndMin) continue;
      
      const h = Math.floor(m / 60);
      const min = m % 60;
      slots.push(`${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`);
    }

    // 5. Calculate availability per slot
    const hasResources = resources.length > 0;
    const totalCapacity = hasResources ? resources.length : 1; // If no resources configured, treat as single slot

    const availability = slots.map(slot => {
      // Count appointments at this time slot
      const slotAppointments = appointments.filter(a => {
        const apptTime = a.time;
        if (!apptTime) return false;
        
        // Check if appointment overlaps with this slot
        const [aH, aM] = apptTime.split(':').map(Number);
        const apptStartMin = aH * 60 + aM;
        const apptDuration = a.duration || slotDuration;
        const apptEndMin = apptStartMin + apptDuration;

        const [sH, sM] = slot.split(':').map(Number);
        const slotStartMin = sH * 60 + sM;
        const slotEndMin = slotStartMin + slotDuration;

        // Overlap check
        return apptStartMin < slotEndMin && apptEndMin > slotStartMin;
      });

      const occupiedCount = slotAppointments.length;
      const freeCount = totalCapacity - occupiedCount;

      // Per-resource detail
      let resourceDetail: any[] = [];
      if (hasResources) {
        resourceDetail = resources.map(r => {
          const isOccupied = slotAppointments.some(a => a.resourceId === r.id);
          const occupant = slotAppointments.find(a => a.resourceId === r.id);
          return {
            id: r.id,
            name: r.name,
            type: r.type,
            available: !isOccupied,
            occupant: isOccupied ? { name: occupant?.clientName, type: occupant?.type } : null
          };
        });
      }

      return {
        time: slot,
        totalCapacity,
        occupied: occupiedCount,
        free: freeCount,
        available: freeCount > 0,
        resources: hasResources ? resourceDetail : undefined
      };
    });

    // Summary
    const totalSlots = availability.length;
    const availableSlots = availability.filter(s => s.available).length;

    res.json({
      date: date,
      dayOfWeek,
      dayName: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][dayOfWeek],
      isOpen: true,
      schedule: {
        start: daySchedule.startTime,
        end: daySchedule.endTime,
        slotDuration,
        breakStart: daySchedule.breakStart,
        breakEnd: daySchedule.breakEnd,
      },
      resources: hasResources ? resources.map(r => ({ id: r.id, name: r.name, type: r.type, capacity: r.capacity })) : [],
      totalSlots,
      availableSlots,
      occupiedSlots: totalSlots - availableSlots,
      slots: availability
    });
  } catch (e: any) {
    console.error('❌ Availability error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// 📊 AVAILABILITY FOR AI — Compact format for prompt injection
// 
// GET /api/resources/ai-availability?date=2026-02-28
// Returns a compact string the AI can use to offer slots
// =============================================
router.get('/ai-availability', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    const { date, lineId } = req.query;
    if (!date) return res.status(400).json({ error: 'Fecha requerida' });
    const selectedLineId = lineId as string || null;

    const targetDate = new Date(date as string);
    const dayOfWeek = targetDate.getDay();
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

    // Schedule (line-specific or global fallback)
    let daySchedule = await prisma.businessSchedule.findFirst({
      where: { userId: ownerId, dayOfWeek, whatsappLineId: selectedLineId }
    });
    if (!daySchedule && selectedLineId) {
      daySchedule = await prisma.businessSchedule.findFirst({
        where: { userId: ownerId, dayOfWeek, whatsappLineId: null }
      });
    }

    if (!daySchedule || !daySchedule.isOpen) {
      return res.json({ text: `❌ ${dayNames[dayOfWeek]} ${date}: CERRADO. No hay disponibilidad.` });
    }

    // Resources (line-specific + global)
    const resWhere: any = { userId: ownerId, isActive: true };
    if (selectedLineId) resWhere.OR = [{ whatsappLineId: selectedLineId }, { whatsappLineId: null }];
    const resources = await prisma.resource.findMany({
      where: resWhere,
      orderBy: { order: 'asc' }
    });

    // Appointments
    const dayStart = new Date(date as string + 'T00:00:00');
    const dayEnd = new Date(date as string + 'T23:59:59');
    const appointments = await prisma.appointment.findMany({
      where: {
        userId: ownerId,
        date: { gte: dayStart, lte: dayEnd },
        status: { notIn: ['cancelled'] }
      },
      select: { time: true, duration: true, resourceId: true, resourceName: true }
    });

    const slotDuration = daySchedule.slotDuration || 60;
    const [startH, startM] = daySchedule.startTime.split(':').map(Number);
    const [endH, endM] = daySchedule.endTime.split(':').map(Number);
    const startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;

    let breakStartMin = -1, breakEndMin = -1;
    if (daySchedule.breakStart && daySchedule.breakEnd) {
      const [bsH, bsM] = daySchedule.breakStart.split(':').map(Number);
      const [beH, beM] = daySchedule.breakEnd.split(':').map(Number);
      breakStartMin = bsH * 60 + bsM;
      breakEndMin = beH * 60 + beM;
    }

    const totalCapacity = resources.length || 1;
    const availableSlots: string[] = [];
    const occupiedSlots: string[] = [];

    for (let m = startMin; m + slotDuration <= endMin; m += slotDuration) {
      if (breakStartMin >= 0 && m >= breakStartMin && m < breakEndMin) continue;

      const h = Math.floor(m / 60);
      const min = m % 60;
      const slot = `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;

      const slotAppts = appointments.filter(a => {
        if (!a.time) return false;
        const [aH, aM] = a.time.split(':').map(Number);
        const aStart = aH * 60 + aM;
        const aEnd = aStart + (a.duration || slotDuration);
        const sStart = m;
        const sEnd = m + slotDuration;
        return aStart < sEnd && aEnd > sStart;
      });

      const freeCount = totalCapacity - slotAppts.length;
      if (freeCount > 0) {
        const freeResources = resources.length > 0
          ? resources.filter(r => !slotAppts.some(a => a.resourceId === r.id)).map(r => r.name)
          : [];
        availableSlots.push(
          resources.length > 0
            ? `${slot} (${freeCount} libre${freeCount > 1 ? 's' : ''}: ${freeResources.join(', ')})`
            : `${slot}`
        );
      } else {
        occupiedSlots.push(slot);
      }
    }

    const text = [
      `📅 ${dayNames[dayOfWeek]} ${date} — Horario: ${daySchedule.startTime}-${daySchedule.endTime}`,
      resources.length > 0 ? `🏪 Recursos: ${resources.map(r => r.name).join(', ')} (${resources.length} total)` : '',
      `✅ DISPONIBLES (${availableSlots.length}): ${availableSlots.length > 0 ? availableSlots.join(' | ') : 'NINGUNO'}`,
      occupiedSlots.length > 0 ? `❌ OCUPADOS (${occupiedSlots.length}): ${occupiedSlots.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    res.json({ text, availableSlots: availableSlots.length, occupiedSlots: occupiedSlots.length, totalCapacity });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// 🔍 POST /api/resources/check-slot — Check if a specific slot is available
// Used by AI before creating an appointment
// =============================================
router.post('/check-slot', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    const { date, time, duration, resourceId, whatsappLineId } = req.body;
    if (!date || !time) return res.status(400).json({ error: 'date y time requeridos' });
    const lineId = whatsappLineId || null;

    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay();

    // Check if open (line-specific or global)
    let daySchedule = await prisma.businessSchedule.findFirst({
      where: { userId: ownerId, dayOfWeek, whatsappLineId: lineId }
    });
    if (!daySchedule && lineId) {
      daySchedule = await prisma.businessSchedule.findFirst({
        where: { userId: ownerId, dayOfWeek, whatsappLineId: null }
      });
    }

    if (!daySchedule || !daySchedule.isOpen) {
      return res.json({ available: false, reason: 'Cerrado este día' });
    }

    // Check time within business hours
    const [tH, tM] = time.split(':').map(Number);
    const timeMin = tH * 60 + tM;
    const [sH, sM] = daySchedule.startTime.split(':').map(Number);
    const [eH, eM] = daySchedule.endTime.split(':').map(Number);

    if (timeMin < sH * 60 + sM || timeMin >= eH * 60 + eM) {
      return res.json({ available: false, reason: `Fuera del horario (${daySchedule.startTime}-${daySchedule.endTime})` });
    }

    // Check break
    if (daySchedule.breakStart && daySchedule.breakEnd) {
      const [bsH, bsM] = daySchedule.breakStart.split(':').map(Number);
      const [beH, beM] = daySchedule.breakEnd.split(':').map(Number);
      if (timeMin >= bsH * 60 + bsM && timeMin < beH * 60 + beM) {
        return res.json({ available: false, reason: `Hora de descanso (${daySchedule.breakStart}-${daySchedule.breakEnd})` });
      }
    }

    // Check conflicts
    const slotDuration = duration || daySchedule.slotDuration || 60;
    const dayStart = new Date(date + 'T00:00:00');
    const dayEnd = new Date(date + 'T23:59:59');

    const conflictWhere: any = {
      userId: ownerId,
      date: { gte: dayStart, lte: dayEnd },
      status: { notIn: ['cancelled'] }
    };
    if (resourceId) conflictWhere.resourceId = resourceId;

    const conflicts = await prisma.appointment.findMany({
      where: conflictWhere,
      select: { time: true, duration: true, resourceId: true, clientName: true }
    });

    const overlapping = conflicts.filter(a => {
      if (!a.time) return false;
      const [aH, aM] = a.time.split(':').map(Number);
      const aStart = aH * 60 + aM;
      const aEnd = aStart + (a.duration || slotDuration);
      const reqEnd = timeMin + slotDuration;
      return aStart < reqEnd && aEnd > timeMin;
    });

    // If resource specified, check just that resource
    if (resourceId) {
      const conflict = overlapping.find(a => a.resourceId === resourceId);
      if (conflict) {
        return res.json({ available: false, reason: `Recurso ocupado a esa hora (${conflict.clientName})` });
      }
      return res.json({ available: true });
    }

    // If no resource specified, check total capacity
    const resources = await prisma.resource.findMany({
      where: { userId: ownerId, isActive: true }
    });

    const totalCapacity = resources.length || 1;
    if (overlapping.length >= totalCapacity) {
      return res.json({ available: false, reason: `Todos los espacios ocupados a las ${time}` });
    }

    // Find a free resource to assign
    const occupiedResourceIds = overlapping.map(a => a.resourceId).filter(Boolean);
    const freeResource = resources.find(r => !occupiedResourceIds.includes(r.id));

    res.json({
      available: true,
      suggestedResource: freeResource ? { id: freeResource.id, name: freeResource.name } : null
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

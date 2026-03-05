import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getColombianHolidays, isColombianHoliday, getHolidaysInRange, getHolidaySummaryForAI, getUpcomingHolidays } from './colombian-holidays';

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
// 🌎 TIMEZONE HELPER — Colombia is UTC-5
// Ensures consistent date handling regardless of server timezone
// =============================================
const COLOMBIA_OFFSET = -5; // UTC-5

function getColombiaDate(dateStr: string): Date {
  // Parse YYYY-MM-DD as Colombia midnight
  const [year, month, day] = dateStr.split('-').map(Number);
  const utcHour = -COLOMBIA_OFFSET; // 5 AM UTC = midnight Colombia
  return new Date(Date.UTC(year, month - 1, day, utcHour, 0, 0, 0));
}

function getColombiaDayOfWeek(dateStr: string): number {
  const d = getColombiaDate(dateStr);
  // Adjust to Colombia timezone before getting day
  const colombiaTime = new Date(d.getTime() + COLOMBIA_OFFSET * 60 * 60 * 1000);
  return colombiaTime.getUTCDay();
}

function getColombiaDayRange(dateStr: string): { dayStart: Date; dayEnd: Date } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const utcHour = -COLOMBIA_OFFSET; // 5 AM UTC = midnight Colombia
  const dayStart = new Date(Date.UTC(year, month - 1, day, utcHour, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(year, month - 1, day, utcHour + 23, 59, 59, 999));
  return { dayStart, dayEnd };
}

// =============================================
// 🕐 BUSINESS SCHEDULE CRUD
// 
// ⚠️ CRITICAL: These MUST be defined BEFORE /:id routes!
// Express matches routes in order, and PUT /schedule would
// be caught by PUT /:id (with id="schedule") if /:id comes first.
// =============================================

// GET /api/resources/schedule — Get business hours (filtered by lineId)
router.get('/schedule', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);
    const lineId = req.query.lineId as string || null;

    const where: any = { userId: ownerId, dayOfWeek: { lte: 6 } };
    if (lineId) where.whatsappLineId = lineId;
    else where.whatsappLineId = null; // Global schedules only

    let schedule = await prisma.businessSchedule.findMany({
      where,
      orderBy: { dayOfWeek: 'asc' }
    });

    // [FIX] Dedup: if multiple entries per day exist (no @@unique in schema), keep only latest
    const seenDays = new Map<number, typeof schedule[0]>();
    for (const s of schedule) {
      const existing = seenDays.get(s.dayOfWeek);
      if (!existing || new Date(s.updatedAt) > new Date(existing.updatedAt)) {
        seenDays.set(s.dayOfWeek, s);
      }
    }
    if (schedule.length > seenDays.size) {
      // Duplicates found — clean them up in background
      const keepIds = new Set([...seenDays.values()].map(s => s.id));
      const dupeIds = schedule.filter(s => !keepIds.has(s.id)).map(s => s.id);
      if (dupeIds.length > 0) {
        prisma.businessSchedule.deleteMany({ where: { id: { in: dupeIds } } }).catch(() => {});
        console.log(`🧹 Cleaned ${dupeIds.length} duplicate schedule entries for user ${ownerId}`);
      }
      schedule = [...seenDays.values()].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    }

    // Auto-create default schedule if empty for this line
    if (schedule.length === 0) {
      // [FIX] Use upsert per day to avoid unique constraint errors
      for (let day = 0; day <= 6; day++) {
        try {
          await prisma.businessSchedule.upsert({
            where: {
              userId_dayOfWeek_whatsappLineId: {
                userId: ownerId,
                dayOfWeek: day,
                whatsappLineId: lineId || ''
              }
            },
            update: {}, // Don't overwrite if exists
            create: {
              userId: ownerId,
              dayOfWeek: day,
              isOpen: day >= 1 && day <= 5,
              startTime: '08:00',
              endTime: '18:00',
              slotDuration: 60,
              whatsappLineId: lineId || null
            }
          });
        } catch (e: any) {
          // Fallback: try without compound key
          try {
            const existing = await prisma.businessSchedule.findFirst({
              where: { userId: ownerId, dayOfWeek: day, whatsappLineId: lineId }
            });
            if (!existing) {
              await prisma.businessSchedule.create({
                data: {
                  userId: ownerId, dayOfWeek: day, isOpen: day >= 1 && day <= 5,
                  startTime: '08:00', endTime: '18:00', slotDuration: 60,
                  whatsappLineId: lineId || null
                }
              });
            }
          } catch { /* ignore — will be created on next load */ }
        }
      }

      schedule = await prisma.businessSchedule.findMany({
        where,
        orderBy: { dayOfWeek: 'asc' }
      });
    }

    // [FIX] Ensure all 7 days exist (fill gaps) — safe per-day create
    const existingDays = new Set(schedule.map(s => s.dayOfWeek));
    let gapsFilled = false;
    for (let day = 0; day <= 6; day++) {
      if (!existingDays.has(day)) {
        try {
          const exists = await prisma.businessSchedule.findFirst({
            where: { userId: ownerId, dayOfWeek: day, whatsappLineId: lineId }
          });
          if (!exists) {
            await prisma.businessSchedule.create({
              data: {
                userId: ownerId, dayOfWeek: day, isOpen: false,
                startTime: '08:00', endTime: '18:00', slotDuration: 60,
                whatsappLineId: lineId || null
              }
            });
            gapsFilled = true;
          }
        } catch { /* ignore unique constraint errors */ }
      }
    }
    if (gapsFilled) {
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

    // [FIX] Validate schedule data before saving
    for (const day of schedule) {
      if (day.dayOfWeek === undefined || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
        return res.status(400).json({ error: `dayOfWeek inválido: ${day.dayOfWeek}` });
      }

      if (day.isOpen) {
        // Validate time format
        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
        if (day.startTime && !timeRegex.test(day.startTime)) {
          return res.status(400).json({ error: `Hora de apertura inválida: ${day.startTime}` });
        }
        if (day.endTime && !timeRegex.test(day.endTime)) {
          return res.status(400).json({ error: `Hora de cierre inválida: ${day.endTime}` });
        }

        // Validate startTime < endTime
        if (day.startTime && day.endTime && day.startTime >= day.endTime) {
          return res.status(400).json({ 
            error: `${['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][day.dayOfWeek]}: hora de apertura (${day.startTime}) debe ser anterior a hora de cierre (${day.endTime})` 
          });
        }

        // Validate slotDuration
        if (day.slotDuration && (day.slotDuration < 5 || day.slotDuration > 480)) {
          return res.status(400).json({ error: `Duración de turno inválida: ${day.slotDuration} min` });
        }

        // Validate break times
        if (day.breakStart && day.breakEnd) {
          if (!timeRegex.test(day.breakStart) || !timeRegex.test(day.breakEnd)) {
            return res.status(400).json({ error: 'Formato de hora de descanso inválido' });
          }
          if (day.breakStart >= day.breakEnd) {
            return res.status(400).json({ error: 'Inicio de descanso debe ser antes del fin' });
          }
          // Break should be within business hours
          if (day.startTime && day.breakStart < day.startTime) {
            return res.status(400).json({ error: 'Descanso no puede empezar antes de la hora de apertura' });
          }
          if (day.endTime && day.breakEnd > day.endTime) {
            return res.status(400).json({ error: 'Descanso no puede terminar después de la hora de cierre' });
          }
        }
      }
    }

    for (const day of schedule) {
      // findFirst + update/create (upsert doesn't work well with nullable compound unique)
      const existing = await prisma.businessSchedule.findFirst({
        where: { userId: ownerId, dayOfWeek: day.dayOfWeek, whatsappLineId: lineId }
      });

      // [FIX] Handle break fields correctly - empty strings → null
      const breakStart = day.breakStart && day.breakStart.trim() ? day.breakStart.trim() : null;
      const breakEnd = day.breakEnd && day.breakEnd.trim() ? day.breakEnd.trim() : null;

      const data = {
        isOpen: day.isOpen ?? true,
        startTime: day.startTime || '08:00',
        endTime: day.endTime || '18:00',
        slotDuration: day.slotDuration || 60,
        breakStart: (breakStart && breakEnd) ? breakStart : null, // [FIX] Both or neither
        breakEnd: (breakStart && breakEnd) ? breakEnd : null,
      };

      if (existing) {
        await prisma.businessSchedule.update({ where: { id: existing.id }, data });
      } else {
        try {
          await prisma.businessSchedule.create({ 
            data: { userId: ownerId, dayOfWeek: day.dayOfWeek, whatsappLineId: lineId, ...data } 
          });
        } catch (e: any) {
          // Unique constraint: try finding and updating instead
          const retry = await prisma.businessSchedule.findFirst({
            where: { userId: ownerId, dayOfWeek: day.dayOfWeek, whatsappLineId: lineId }
          });
          if (retry) await prisma.businessSchedule.update({ where: { id: retry.id }, data });
        }
      }
    }

    // [FIX] Also clean up any duplicates while we're here
    const allForLine = await prisma.businessSchedule.findMany({
      where: { userId: ownerId, whatsappLineId: lineId },
      orderBy: [{ dayOfWeek: 'asc' }, { updatedAt: 'desc' }]
    });
    const seenDays = new Map<number, string>();
    const dupeIds: string[] = [];
    for (const s of allForLine) {
      if (seenDays.has(s.dayOfWeek)) {
        dupeIds.push(s.id);
      } else {
        seenDays.set(s.dayOfWeek, s.id);
      }
    }
    if (dupeIds.length > 0) {
      await prisma.businessSchedule.deleteMany({ where: { id: { in: dupeIds } } });
    }

    const updated = await prisma.businessSchedule.findMany({
      where: { userId: ownerId, whatsappLineId: lineId },
      orderBy: { dayOfWeek: 'asc' }
    });

    res.json({ schedule: updated, message: 'Horarios guardados correctamente' });
  } catch (e: any) {
    console.error('❌ Schedule save error:', e.message);
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

    // [FIX] Use Colombia timezone for correct day-of-week
    const dayOfWeek = getColombiaDayOfWeek(date as string);
    const selectedLineId = lineId as string || null;
    const dateStr = date as string;
    const dayName = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][dayOfWeek];

    // 🇨🇴 CHECK HOLIDAY
    const holiday = isColombianHoliday(dateStr);
    if (holiday) {
      // Check if user works on this holiday
      const holidayConfig = await prisma.businessSchedule.findFirst({
        where: { userId: ownerId, dayOfWeek: 7 }
      });
      const workOnAll = holidayConfig?.isOpen || false;
      let workDates: string[] = [];
      try { workDates = holidayConfig?.breakStart ? JSON.parse(holidayConfig.breakStart) : []; } catch {}
      const worksThisHoliday = workOnAll || workDates.includes(dateStr);

      if (!worksThisHoliday) {
        return res.json({
          available: false, message: `🇨🇴 Festivo: ${holiday.name}`, slots: [], totalSlots: 0,
          availableSlots: 0, occupiedSlots: 0, isOpen: false, isHoliday: true,
          holiday: { name: holiday.name, type: holiday.type },
          date: dateStr, dayOfWeek, dayName, resources: [], schedule: null
        });
      }
    }

    // 1. Get business schedule for this day (line-specific or global fallback)
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
      return res.json({ available: false, message: 'Cerrado este día', slots: [], totalSlots: 0, availableSlots: 0, occupiedSlots: 0, isOpen: false,
        date, dayOfWeek, dayName: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][dayOfWeek],
        resources: [], schedule: null
      });
    }

    // 2. Get active resources (STRICT per line)
    const resourceWhere: any = { userId: ownerId, isActive: true };
    if (resourceId) resourceWhere.id = resourceId as string;
    else if (selectedLineId) resourceWhere.whatsappLineId = selectedLineId;
    else resourceWhere.whatsappLineId = null;

    const resources = await prisma.resource.findMany({
      where: resourceWhere,
      orderBy: [{ order: 'asc' }, { name: 'asc' }]
    });

    // 3. Get existing appointments for this date
    // [FIX] Use Colombia timezone for date range
    const { dayStart, dayEnd } = getColombiaDayRange(date as string);

    // [FIX] Filter appointments by line if specified
    const appointmentWhere: any = {
      userId: ownerId,
      date: { gte: dayStart, lte: dayEnd },
      status: { notIn: ['cancelled'] }
    };
    if (selectedLineId) {
      appointmentWhere.whatsappLineId = selectedLineId;
    }

    const appointments = await prisma.appointment.findMany({
      where: appointmentWhere,
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
      // Skip break time — [FIX] check if slot OVERLAPS with break, not just starts in it
      if (breakStartMin >= 0) {
        const slotEnd = m + slotDuration;
        if (m < breakEndMin && slotEnd > breakStartMin) continue;
      }
      
      const h = Math.floor(m / 60);
      const min = m % 60;
      slots.push(`${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`);
    }

    // 5. Calculate availability per slot — CAPACITY-AWARE
    // Each resource has a capacity (e.g. Tecnomecanica capacity=5 means 5 motos per hour)
    // totalCapacity = SUM of all resource capacities, not just count of resources
    const hasResources = resources.length > 0;
    const totalCapacity = hasResources ? resources.reduce((sum, r) => sum + (r.capacity || 1), 0) : 1;

    const availability = slots.map(slot => {
      // Count appointments at this time slot
      const slotAppointments = appointments.filter(a => {
        const apptTime = a.time;
        if (!apptTime) return false;
        
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
      const freeCount = Math.max(0, totalCapacity - occupiedCount);

      // Per-resource detail with CAPACITY support
      let resourceDetail: any[] = [];
      if (hasResources) {
        resourceDetail = resources.map(r => {
          const resourceAppts = slotAppointments.filter(a => a.resourceId === r.id);
          const resourceOccupied = resourceAppts.length;
          const resourceCapacity = r.capacity || 1;
          const resourceFree = Math.max(0, resourceCapacity - resourceOccupied);
          const isFull = resourceFree <= 0;

          return {
            id: r.id,
            name: r.name,
            type: r.type,
            capacity: resourceCapacity,
            occupied: resourceOccupied,
            free: resourceFree,
            available: !isFull,
            occupants: resourceAppts.map(a => ({ name: a.clientName, type: a.type }))
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
      dayName,
      isOpen: true,
      isHoliday: !!holiday,
      holiday: holiday ? { name: holiday.name, type: holiday.type } : null,
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

    // [FIX] Colombia timezone
    const dayOfWeek = getColombiaDayOfWeek(date as string);
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

    // 🇨🇴 CHECK HOLIDAY
    const holiday = isColombianHoliday(date as string);
    if (holiday) {
      const holidayConfig = await prisma.businessSchedule.findFirst({ where: { userId: ownerId, dayOfWeek: 7 } });
      const workOnAll = holidayConfig?.isOpen || false;
      let workDates: string[] = [];
      try { workDates = holidayConfig?.breakStart ? JSON.parse(holidayConfig.breakStart) : []; } catch {}
      const worksThisHoliday = workOnAll || workDates.includes(date as string);

      if (!worksThisHoliday) {
        const upcoming = getUpcomingHolidays(date as string, 3).filter(h => h.date !== date);
        let text = `🇨🇴 ${dayNames[dayOfWeek]} ${date} es FESTIVO: ${holiday.name}. NO hay disponibilidad. El negocio está cerrado por festivo.`;
        if (upcoming.length > 0) {
          text += `\nPróximos festivos: ${upcoming.map(h => `${h.date} (${h.name})`).join(', ')}`;
        }
        return res.json({ text, isHoliday: true, holidayName: holiday.name });
      }
    }

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

    // Resources (STRICT per line)
    const resWhere: any = { userId: ownerId, isActive: true };
    if (selectedLineId) resWhere.whatsappLineId = selectedLineId;
    else resWhere.whatsappLineId = null;
    const resources = await prisma.resource.findMany({
      where: resWhere,
      orderBy: { order: 'asc' }
    });

    // Appointments — [FIX] use Colombia timezone + filter by line
    const { dayStart, dayEnd } = getColombiaDayRange(date as string);
    const appointmentWhere: any = {
      userId: ownerId,
      date: { gte: dayStart, lte: dayEnd },
      status: { notIn: ['cancelled'] }
    };
    if (selectedLineId) appointmentWhere.whatsappLineId = selectedLineId;

    const appointments = await prisma.appointment.findMany({
      where: appointmentWhere,
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

    const totalCapacity = resources.length > 0 ? resources.reduce((sum, r) => sum + (r.capacity || 1), 0) : 1;
    const availableSlots: string[] = [];
    const occupiedSlots: string[] = [];

    for (let m = startMin; m + slotDuration <= endMin; m += slotDuration) {
      // [FIX] Overlap-based break check
      if (breakStartMin >= 0) {
        const slotEnd = m + slotDuration;
        if (m < breakEndMin && slotEnd > breakStartMin) continue;
      }

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
        // Show per-resource availability with capacity
        const resourceInfo = resources.length > 0
          ? resources.map(r => {
              const rAppts = slotAppts.filter(a => a.resourceId === r.id).length;
              const rCap = r.capacity || 1;
              const rFree = Math.max(0, rCap - rAppts);
              return rFree > 0 ? `${r.name} (${rFree}/${rCap} libres)` : null;
            }).filter(Boolean)
          : [];
        availableSlots.push(
          resourceInfo.length > 0
            ? `${slot} (${freeCount} libre${freeCount > 1 ? 's' : ''}: ${resourceInfo.join(', ')})`
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

    // [FIX] Colombia timezone
    const dayOfWeek = getColombiaDayOfWeek(date);

    // 🇨🇴 CHECK HOLIDAY
    const holiday = isColombianHoliday(date);
    if (holiday) {
      const holidayConfig = await prisma.businessSchedule.findFirst({ where: { userId: ownerId, dayOfWeek: 7 } });
      const workOnAll = holidayConfig?.isOpen || false;
      let workDates: string[] = [];
      try { workDates = holidayConfig?.breakStart ? JSON.parse(holidayConfig.breakStart) : []; } catch {}
      if (!workOnAll && !workDates.includes(date)) {
        return res.json({ available: false, reason: `🇨🇴 Festivo: ${holiday.name}. Negocio cerrado.`, isHoliday: true });
      }
    }

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

    // Check conflicts — [FIX] use Colombia timezone + filter by line
    const slotDuration = duration || daySchedule.slotDuration || 60;
    const { dayStart, dayEnd } = getColombiaDayRange(date);

    const conflictWhere: any = {
      userId: ownerId,
      date: { gte: dayStart, lte: dayEnd },
      status: { notIn: ['cancelled'] }
    };
    if (resourceId) conflictWhere.resourceId = resourceId;
    if (lineId) conflictWhere.whatsappLineId = lineId;

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

    // If resource specified, check that resource's CAPACITY
    if (resourceId) {
      const resource = await prisma.resource.findFirst({ where: { id: resourceId, userId: ownerId } });
      const resourceCapacity = resource?.capacity || 1;
      const resourceAppts = overlapping.filter(a => a.resourceId === resourceId);
      if (resourceAppts.length >= resourceCapacity) {
        return res.json({ available: false, reason: `Recurso lleno a esa hora (${resourceAppts.length}/${resourceCapacity} ocupados)` });
      }
      return res.json({ available: true, currentOccupied: resourceAppts.length, capacity: resourceCapacity });
    }

    // If no resource specified, check total capacity across all resources
    const resources = await prisma.resource.findMany({
      where: { userId: ownerId, isActive: true }
    });

    const totalCapacity = resources.length > 0 ? resources.reduce((sum, r) => sum + (r.capacity || 1), 0) : 1;
    if (overlapping.length >= totalCapacity) {
      return res.json({ available: false, reason: `Todos los espacios ocupados a las ${time} (${overlapping.length}/${totalCapacity})` });
    }

    // Find a resource with available capacity to assign
    const freeResource = resources.find(r => {
      const rAppts = overlapping.filter(a => a.resourceId === r.id).length;
      return rAppts < (r.capacity || 1);
    });

    res.json({
      available: true,
      suggestedResource: freeResource ? { id: freeResource.id, name: freeResource.name, capacity: freeResource.capacity } : null
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// =============================================
// 🇨🇴 COLOMBIAN HOLIDAYS
// =============================================

// GET /api/resources/holidays — Get holidays for a year/month
router.get('/holidays', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month as string) : undefined;

    let holidays = getColombianHolidays(year);

    if (month !== undefined) {
      const monthStr = month.toString().padStart(2, '0');
      holidays = holidays.filter(h => h.date.substring(5, 7) === monthStr);
    }

    // Get user's holiday work preferences (stored in dayOfWeek=7 BusinessSchedule)
    const holidayConfig = await prisma.businessSchedule.findFirst({
      where: { userId: ownerId, dayOfWeek: 7 }
    });

    // Parse work dates from breakStart field (JSON array of dates)
    let workOnHolidays = false;
    let holidayWorkDates: string[] = [];
    if (holidayConfig) {
      workOnHolidays = holidayConfig.isOpen; // isOpen = work on ALL holidays
      try {
        holidayWorkDates = holidayConfig.breakStart ? JSON.parse(holidayConfig.breakStart) : [];
      } catch { holidayWorkDates = []; }
    }

    // Enrich holidays with work status
    const enriched = holidays.map(h => ({
      ...h,
      isWorkDay: workOnHolidays || holidayWorkDates.includes(h.date)
    }));

    res.json({ holidays: enriched, workOnHolidays, holidayWorkDates, year });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/resources/holidays — Update holiday work preferences
router.put('/holidays', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    const { workOnHolidays, holidayWorkDates, toggleDate } = req.body;

    // Get or create the holiday config record (dayOfWeek=7)
    let holidayConfig = await prisma.businessSchedule.findFirst({
      where: { userId: ownerId, dayOfWeek: 7 }
    });

    let currentWorkDates: string[] = [];
    if (holidayConfig) {
      try { currentWorkDates = holidayConfig.breakStart ? JSON.parse(holidayConfig.breakStart) : []; } catch { currentWorkDates = []; }
    }

    // Toggle a specific date
    if (toggleDate) {
      if (currentWorkDates.includes(toggleDate)) {
        currentWorkDates = currentWorkDates.filter(d => d !== toggleDate);
      } else {
        currentWorkDates.push(toggleDate);
      }
    }

    // Explicit set of work dates
    if (holidayWorkDates !== undefined) {
      currentWorkDates = holidayWorkDates;
    }

    const data = {
      userId: ownerId,
      dayOfWeek: 7,
      isOpen: workOnHolidays !== undefined ? workOnHolidays : (holidayConfig?.isOpen || false),
      startTime: '00:00',
      endTime: '23:59',
      slotDuration: 60,
      breakStart: JSON.stringify(currentWorkDates),
      breakEnd: null
    };

    if (holidayConfig) {
      await prisma.businessSchedule.update({ where: { id: holidayConfig.id }, data });
    } else {
      try {
        await prisma.businessSchedule.create({ data });
      } catch {
        // Unique constraint — find and update instead
        const retry = await prisma.businessSchedule.findFirst({
          where: { userId: ownerId, dayOfWeek: 7 }
        });
        if (retry) await prisma.businessSchedule.update({ where: { id: retry.id }, data });
      }
    }

    res.json({
      message: 'Configuración de festivos actualizada',
      workOnHolidays: data.isOpen,
      holidayWorkDates: currentWorkDates
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// 🏪 RESOURCES CRUD
// 
// ⚠️ These parametric routes (/:id) MUST come AFTER
// all static routes (/schedule, /availability, etc.)
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
      where.whatsappLineId = lineId;  // [FIX] Strict: solo recursos de ESTA línea
    } else {
      where.whatsappLineId = null;  // Sin línea: solo globales
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

    // [FIX] Validate unique name per user+line
    const existing = await prisma.resource.findFirst({
      where: { userId: ownerId, name: name.trim(), whatsappLineId: whatsappLineId || null }
    });
    if (existing) {
      return res.status(400).json({ error: `Ya existe un recurso llamado "${name.trim()}"` });
    }

    const resource = await prisma.resource.create({
      data: {
        userId: ownerId,
        name: name.trim(),
        type: type || 'generic',
        capacity: Math.max(1, parseInt(capacity) || 1),
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

    // [FIX] Added whatsappLineId to updatable fields
    const { name, type, capacity, notes, order, isActive, whatsappLineId } = req.body;

    const resource = await prisma.resource.update({
      where: { id },
      data: {
        name: name !== undefined ? name.trim() : existing.name,
        type: type !== undefined ? type : existing.type,
        capacity: capacity !== undefined ? Math.max(1, parseInt(capacity) || 1) : existing.capacity,
        notes: notes !== undefined ? (notes || null) : existing.notes,
        order: order !== undefined ? order : existing.order,
        isActive: isActive !== undefined ? isActive : existing.isActive,
        whatsappLineId: whatsappLineId !== undefined ? (whatsappLineId || null) : existing.whatsappLineId,
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

    // [FIX] Check if resource has upcoming appointments before deleting
    const upcomingAppointments = await prisma.appointment.count({
      where: {
        resourceId: id,
        date: { gte: new Date() },
        status: { notIn: ['cancelled'] }
      }
    });

    if (upcomingAppointments > 0) {
      return res.status(400).json({ 
        error: `Este recurso tiene ${upcomingAppointments} cita(s) pendiente(s). Desactívalo en vez de eliminarlo, o cancela las citas primero.` 
      });
    }

    await prisma.resource.delete({ where: { id } });
    res.json({ message: 'Recurso eliminado' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

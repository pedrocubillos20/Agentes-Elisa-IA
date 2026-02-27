import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

// =============================================
// 📅 GOOGLE CALENDAR INTEGRATION
// 
// OAuth2 flow + bidirectional sync with appointments
// Each user connects their own Google account
//
// Requiere:
// 1. Google Cloud Console → Enable Calendar API
// 2. Create OAuth2 credentials (Web Application)
// 3. Set redirect URI: {BACKEND_URL}/api/gcal/callback
// 4. Variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// =============================================

interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string; parentUserId?: string };
}

const router = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const BACKEND_URL = process.env.BACKEND_URL || process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
  : 'http://localhost:3001';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const REDIRECT_URI = `${BACKEND_URL}/api/gcal/callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events'
].join(' ');

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
// 🔗 GET /api/gcal/status — Check connection status
// =============================================
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    const user = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { googleRefreshToken: true, googleCalendarId: true, googleCalendarEmail: true }
    });

    const configured = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
    const connected = !!(user?.googleRefreshToken);

    res.json({
      configured,
      connected,
      calendarId: user?.googleCalendarId || 'primary',
      email: user?.googleCalendarEmail || null
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// 🔐 GET /api/gcal/auth — Start OAuth2 flow
// =============================================
router.get('/auth', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(400).json({ error: 'Google Calendar no configurado. Falta GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.' });
    }

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${encodeURIComponent(ownerId)}`;

    res.json({ authUrl });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// 🔄 GET /api/gcal/callback — OAuth2 callback (public, no auth middleware)
// =============================================
export async function handleGCalCallback(req: Request, res: Response) {
  try {
    const { code, state: userId, error: oauthError } = req.query;

    if (oauthError) {
      console.error('❌ Google OAuth error:', oauthError);
      return res.redirect(`${FRONTEND_URL}/integraciones?gcal=error&reason=${oauthError}`);
    }

    if (!code || !userId) {
      return res.redirect(`${FRONTEND_URL}/integraciones?gcal=error&reason=missing_params`);
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    const tokens: any = await tokenRes.json();

    if (!tokens.access_token) {
      console.error('❌ Google token exchange failed:', tokens);
      return res.redirect(`${FRONTEND_URL}/integraciones?gcal=error&reason=token_failed`);
    }

    // Get user email from Google
    let googleEmail = '';
    try {
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const profile: any = await profileRes.json();
      googleEmail = profile.email || '';
    } catch {}

    // Save tokens to user
    await prisma.user.update({
      where: { id: userId as string },
      data: {
        googleAccessToken: tokens.access_token,
        googleRefreshToken: tokens.refresh_token || undefined,
        googleTokenExpiry: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
        googleCalendarId: 'primary',
        googleCalendarEmail: googleEmail
      }
    });

    console.log(`📅 Google Calendar: Conectado para usuario ${userId} (${googleEmail})`);
    res.redirect(`${FRONTEND_URL}/integraciones?gcal=success`);
  } catch (e: any) {
    console.error('❌ Google Calendar callback error:', e.message);
    res.redirect(`${FRONTEND_URL}/integraciones?gcal=error&reason=server_error`);
  }
}

// =============================================
// 🔄 Refresh access token if expired
// =============================================
async function getValidAccessToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleAccessToken: true, googleRefreshToken: true, googleTokenExpiry: true }
  });

  if (!user?.googleRefreshToken) return null;

  // Check if token is still valid (with 5 min buffer)
  if (user.googleAccessToken && user.googleTokenExpiry && 
      new Date(user.googleTokenExpiry).getTime() > Date.now() + 300000) {
    return user.googleAccessToken;
  }

  // Refresh the token
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: user.googleRefreshToken,
        grant_type: 'refresh_token'
      })
    });

    const tokens: any = await tokenRes.json();

    if (!tokens.access_token) {
      console.error('❌ Google token refresh failed:', tokens);
      return null;
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        googleAccessToken: tokens.access_token,
        googleTokenExpiry: new Date(Date.now() + (tokens.expires_in || 3600) * 1000)
      }
    });

    return tokens.access_token;
  } catch (e: any) {
    console.error('❌ Google token refresh error:', e.message);
    return null;
  }
}

// =============================================
// 📅 SYNC FUNCTIONS — Used by appointments routes
// =============================================

/**
 * Create event in Google Calendar
 * Returns the Google Calendar event ID
 */
export async function createGCalEvent(userId: string, appointment: any): Promise<string | null> {
  try {
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) return null;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleCalendarId: true }
    });

    const calendarId = user?.googleCalendarId || 'primary';
    
    // Build event datetime
    const dateStr = appointment.date instanceof Date 
      ? appointment.date.toISOString().split('T')[0] 
      : String(appointment.date).split('T')[0];
    const timeStr = appointment.time || '12:00';
    const startDateTime = `${dateStr}T${timeStr}:00`;
    const durationMin = appointment.duration || 60;
    const endDate = new Date(new Date(startDateTime).getTime() + durationMin * 60000);

    // Type label
    const typeLabels: Record<string, string> = {
      appointment: '📅 Cita',
      order: '🛒 Pedido',
      reservation: '🏨 Reserva'
    };
    const typeLabel = typeLabels[appointment.type] || '📅 Cita';

    const event = {
      summary: `${typeLabel} — ${appointment.clientName}`,
      description: [
        `📱 Tel: ${appointment.clientPhone}`,
        appointment.notes ? `📝 Notas: ${appointment.notes}` : '',
        appointment.address ? `📍 Dirección: ${appointment.address}` : '',
        appointment.products ? `📦 Productos: ${JSON.stringify(appointment.products)}` : '',
        appointment.total ? `💰 Total: $${appointment.total.toLocaleString()}` : '',
        `\n🔗 Creado desde BizonneCRM`
      ].filter(Boolean).join('\n'),
      start: {
        dateTime: new Date(startDateTime).toISOString(),
        timeZone: 'America/Bogota'
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: 'America/Bogota'
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 30 },
          { method: 'popup', minutes: 10 }
        ]
      }
    };

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      }
    );

    const result: any = await response.json();

    if (result.id) {
      console.log(`📅 GCal: Evento creado "${event.summary}" (${result.id})`);
      return result.id;
    } else {
      console.error('❌ GCal create event error:', result.error?.message || JSON.stringify(result));
      return null;
    }
  } catch (e: any) {
    console.error('❌ GCal create event error:', e.message);
    return null;
  }
}

/**
 * Update event in Google Calendar
 */
export async function updateGCalEvent(userId: string, googleEventId: string, appointment: any): Promise<boolean> {
  try {
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken || !googleEventId) return false;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleCalendarId: true }
    });

    const calendarId = user?.googleCalendarId || 'primary';

    const dateStr = appointment.date instanceof Date 
      ? appointment.date.toISOString().split('T')[0] 
      : String(appointment.date).split('T')[0];
    const timeStr = appointment.time || '12:00';
    const startDateTime = `${dateStr}T${timeStr}:00`;
    const durationMin = appointment.duration || 60;
    const endDate = new Date(new Date(startDateTime).getTime() + durationMin * 60000);

    const typeLabels: Record<string, string> = {
      appointment: '📅 Cita',
      order: '🛒 Pedido',
      reservation: '🏨 Reserva'
    };
    const typeLabel = typeLabels[appointment.type] || '📅 Cita';

    const statusColors: Record<string, string> = {
      pending: '⏳',
      confirmed: '✅',
      completed: '🎉',
      cancelled: '❌'
    };
    const statusIcon = statusColors[appointment.status] || '';

    const event = {
      summary: `${statusIcon} ${typeLabel} — ${appointment.clientName}`,
      description: [
        `📱 Tel: ${appointment.clientPhone}`,
        `Estado: ${appointment.status}`,
        appointment.notes ? `📝 Notas: ${appointment.notes}` : '',
        appointment.address ? `📍 Dirección: ${appointment.address}` : '',
        appointment.total ? `💰 Total: $${appointment.total?.toLocaleString()}` : '',
        `\n🔗 Actualizado desde BizonneCRM`
      ].filter(Boolean).join('\n'),
      start: {
        dateTime: new Date(startDateTime).toISOString(),
        timeZone: 'America/Bogota'
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: 'America/Bogota'
      }
    };

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${googleEventId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      }
    );

    const result: any = await response.json();
    if (result.id) {
      console.log(`📅 GCal: Evento actualizado "${event.summary}"`);
      return true;
    }
    return false;
  } catch (e: any) {
    console.error('❌ GCal update event error:', e.message);
    return false;
  }
}

/**
 * Delete event from Google Calendar
 */
export async function deleteGCalEvent(userId: string, googleEventId: string): Promise<boolean> {
  try {
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken || !googleEventId) return false;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleCalendarId: true }
    });

    const calendarId = user?.googleCalendarId || 'primary';

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${googleEventId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    if (response.ok || response.status === 204 || response.status === 410) {
      console.log(`📅 GCal: Evento eliminado (${googleEventId})`);
      return true;
    }
    return false;
  } catch (e: any) {
    console.error('❌ GCal delete event error:', e.message);
    return false;
  }
}

// =============================================
// 📋 GET /api/gcal/calendars — List user's calendars
// =============================================
router.get('/calendars', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    const accessToken = await getValidAccessToken(ownerId);
    if (!accessToken) return res.status(400).json({ error: 'No conectado a Google Calendar' });

    const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const data: any = await response.json();
    const calendars = (data.items || []).map((cal: any) => ({
      id: cal.id,
      summary: cal.summary,
      primary: cal.primary || false,
      backgroundColor: cal.backgroundColor
    }));

    res.json({ calendars });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// 🔧 PUT /api/gcal/settings — Update calendar settings
// =============================================
router.put('/settings', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    const { calendarId } = req.body;

    await prisma.user.update({
      where: { id: ownerId },
      data: { googleCalendarId: calendarId || 'primary' }
    });

    res.json({ success: true, calendarId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// 🔌 POST /api/gcal/disconnect — Disconnect Google Calendar
// =============================================
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    // Revoke token with Google
    const user = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { googleAccessToken: true }
    });

    if (user?.googleAccessToken) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${user.googleAccessToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
      } catch {}
    }

    // Clear all Google fields
    await prisma.user.update({
      where: { id: ownerId },
      data: {
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiry: null,
        googleCalendarId: null,
        googleCalendarEmail: null
      }
    });

    console.log(`📅 Google Calendar: Desconectado para usuario ${ownerId}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// 🔄 POST /api/gcal/sync-all — Sync all existing appointments to Google
// =============================================
router.post('/sync-all', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    const accessToken = await getValidAccessToken(ownerId);
    if (!accessToken) return res.status(400).json({ error: 'No conectado a Google Calendar' });

    // Get appointments without googleEventId (not yet synced)
    const appointments = await prisma.appointment.findMany({
      where: { 
        userId: ownerId,
        googleEventId: null,
        status: { notIn: ['cancelled', 'completed'] }
      },
      orderBy: { date: 'asc' },
      take: 50
    });

    let synced = 0;
    for (const appt of appointments) {
      const eventId = await createGCalEvent(ownerId, appt);
      if (eventId) {
        await prisma.appointment.update({
          where: { id: appt.id },
          data: { googleEventId: eventId }
        });
        synced++;
      }
      // Rate limit: max 5 requests per second
      await new Promise(r => setTimeout(r, 250));
    }

    res.json({ success: true, synced, total: appointments.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

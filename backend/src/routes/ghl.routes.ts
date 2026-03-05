import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import crypto from 'crypto';

const router = Router();

// ⚡ getOwnerId — sub-usuarios usan integración del admin owner
const _ghlOwnerCache = new Map<string, {v: string; ts: number}>();
const getOwnerId = async (uid: string): Promise<string> => {
  const c = _ghlOwnerCache.get(uid);
  if (c && Date.now() - c.ts < 300000) return c.v;
  const u = await prisma.user.findUnique({ where: { id: uid }, select: { parentUserId: true } });
  const oid = u?.parentUserId || uid;
  _ghlOwnerCache.set(uid, { v: oid, ts: Date.now() });
  return oid;
};

// ====================================================
// ⚙️ GHL CONFIG
// ====================================================
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_AUTH_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const GHL_TOKEN_URL = `${GHL_BASE}/oauth/token`;

// OAuth (optional — only if admin configured marketplace app)
const GHL_CLIENT_ID = process.env.GHL_CLIENT_ID || '';
const GHL_CLIENT_SECRET = process.env.GHL_CLIENT_SECRET || '';
const BACKEND_URL = process.env.BACKEND_URL || '';
const FRONTEND_URL = process.env.FRONTEND_URL || '';
const GHL_REDIRECT_URI = `${BACKEND_URL}/api/ghl/callback`;
const GHL_WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET || '';

// ====================================================
// 🔑 HELPERS: Get valid auth header for GHL API calls
// ====================================================
async function getAuthHeader(integ: any): Promise<string | null> {
  // Method 1: API Key (user's own key)
  if (integ.authMethod === 'apikey' && integ.ghlApiKey) {
    return `Bearer ${integ.ghlApiKey}`;
  }

  // Method 2: OAuth token (refresh if needed)
  if (integ.authMethod === 'oauth' && integ.accessToken) {
    // Check expiry (5min buffer)
    if (integ.tokenExpiresAt && new Date(integ.tokenExpiresAt) > new Date(Date.now() + 5 * 60_000)) {
      return `Bearer ${integ.accessToken}`;
    }
    // Refresh
    if (!GHL_CLIENT_ID || !integ.refreshToken) return null;
    try {
      const r = await fetch(GHL_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GHL_CLIENT_ID, client_secret: GHL_CLIENT_SECRET,
          grant_type: 'refresh_token', refresh_token: integ.refreshToken,
        }),
      });
      if (!r.ok) {
        await prisma.ghlIntegration.update({ where: { id: integ.id }, data: { lastError: `Token refresh: ${r.status}` } });
        return null;
      }
      const d: any = await r.json();
      await prisma.ghlIntegration.update({
        where: { id: integ.id },
        data: {
          accessToken: d.access_token,
          refreshToken: d.refresh_token || integ.refreshToken,
          tokenExpiresAt: new Date(Date.now() + (d.expires_in || 86400) * 1000),
          lastError: null,
        },
      });
      return `Bearer ${d.access_token}`;
    } catch (e: any) {
      console.error('❌ GHL refresh:', e.message);
      return null;
    }
  }
  return null;
}

async function ghlFetch(integ: any, path: string, opts: any = {}) {
  const auth = await getAuthHeader(integ);
  if (!auth) throw new Error('No valid GHL credentials');
  const r = await fetch(`${GHL_BASE}${path}`, {
    ...opts,
    headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'Version': '2021-07-28', ...opts.headers },
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`GHL ${r.status}: ${e}`); }
  return r.json();
}

// ====================================================
// 🔑 POST /connect-apikey — User enters their own API Key
// (No env vars needed — each user self-serves)
// ====================================================
router.post('/connect-apikey', async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const ownerId = await getOwnerId(userId);
    const { apiKey, locationId } = req.body;

    if (!apiKey || !locationId) {
      return res.status(400).json({ error: 'API Key y Location ID son requeridos' });
    }

    // Validate the API key by calling GHL
    let locationName = '';
    try {
      const testRes = await fetch(`${GHL_BASE}/locations/${locationId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Version': '2021-07-28' },
      });
      if (!testRes.ok) {
        const err = await testRes.text();
        return res.status(400).json({ error: `API Key inválida o Location ID incorrecto. GHL respondió: ${testRes.status}` });
      }
      const locData: any = await testRes.json();
      locationName = locData.location?.name || locData.name || '';
    } catch (e: any) {
      return res.status(400).json({ error: `No se pudo conectar con GHL: ${e.message}` });
    }

    // Save integration
    await prisma.ghlIntegration.upsert({
      where: { userId: ownerId },
      create: {
        userId, authMethod: 'apikey', ghlApiKey: apiKey, locationId, locationName,
      },
      update: {
        authMethod: 'apikey', ghlApiKey: apiKey, locationId, locationName,
        isActive: true, lastError: null,
      },
    });

    console.log(`✅ GHL API Key connected: ${locationName} (user: ${userId})`);
    res.json({ success: true, locationName });
  } catch (e: any) {
    console.error('❌ GHL connect-apikey:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ====================================================
// 🔗 GET /auth — OAuth redirect URL (optional, if admin configured)
// ====================================================
router.get('/auth', async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!GHL_CLIENT_ID) return res.status(400).json({ error: 'OAuth no configurado. Usa API Key en su lugar.', oauthAvailable: false });
    const state = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString('base64url');
    const params = new URLSearchParams({
      response_type: 'code', redirect_uri: GHL_REDIRECT_URI, client_id: GHL_CLIENT_ID,
      scope: 'contacts.readonly contacts.write opportunities.readonly opportunities.write calendars.readonly calendars.write calendars/events.readonly calendars/events.write conversations.readonly conversations.write conversations/message.readonly conversations/message.write locations.readonly',
      state,
    });
    res.json({ url: `${GHL_AUTH_URL}?${params}`, oauthAvailable: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// 🔗 GET /callback — OAuth callback
// ====================================================
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.redirect(`${FRONTEND_URL}/integraciones?error=missing_params`);
    let stateData: any;
    try { stateData = JSON.parse(Buffer.from(state as string, 'base64url').toString()); } catch { return res.redirect(`${FRONTEND_URL}/integraciones?error=invalid_state`); }
    const { userId } = stateData;
    if (!userId) return res.redirect(`${FRONTEND_URL}/integraciones?error=no_user`);

    const tokenRes = await fetch(GHL_TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: GHL_CLIENT_ID, client_secret: GHL_CLIENT_SECRET, grant_type: 'authorization_code', code: code as string, redirect_uri: GHL_REDIRECT_URI }),
    });
    if (!tokenRes.ok) return res.redirect(`${FRONTEND_URL}/integraciones?error=token_failed`);
    const tokens: any = await tokenRes.json();

    let locationName = '';
    try { const lr = await fetch(`${GHL_BASE}/locations/${tokens.locationId}`, { headers: { 'Authorization': `Bearer ${tokens.access_token}`, 'Version': '2021-07-28' } }); if (lr.ok) { const ld: any = await lr.json(); locationName = ld.location?.name || ld.name || ''; } } catch {}

    const ownerId = userId; // OAuth callback: el userId del state ES el owner (no sub-usuario)
    await prisma.ghlIntegration.upsert({
      where: { userId: ownerId },
      create: { userId: ownerId, authMethod: 'oauth', accessToken: tokens.access_token, refreshToken: tokens.refresh_token, tokenExpiresAt: new Date(Date.now() + (tokens.expires_in || 86400) * 1000), locationId: tokens.locationId || '', locationName, companyId: tokens.companyId || null },
      update: { authMethod: 'oauth', accessToken: tokens.access_token, refreshToken: tokens.refresh_token, tokenExpiresAt: new Date(Date.now() + (tokens.expires_in || 86400) * 1000), locationId: tokens.locationId || '', locationName, isActive: true, lastError: null },
    });

    console.log(`✅ GHL OAuth connected: ${locationName} (user: ${userId})`);
    res.redirect(`${FRONTEND_URL}/integraciones?success=ghl_connected`);
  } catch (e: any) {
    console.error('❌ GHL callback:', e.message);
    res.redirect(`${FRONTEND_URL}/integraciones?error=callback_failed`);
  }
});

// ====================================================
// 📊 GET /status
// ====================================================
router.get('/status', async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const ownerId = await getOwnerId(userId);
    const integ = await prisma.ghlIntegration.findUnique({ where: { userId: ownerId } });
    if (!integ) return res.json({ connected: false, oauthAvailable: !!GHL_CLIENT_ID });

    let pipelines: any[] = [], calendars: any[] = [];
    try { const p: any = await ghlFetch(integ, `/opportunities/pipelines?locationId=${integ.locationId}`); pipelines = p.pipelines || []; } catch {}
    try { const c: any = await ghlFetch(integ, `/calendars/?locationId=${integ.locationId}`); calendars = c.calendars || []; } catch {}

    // Don't expose tokens
    const { accessToken, refreshToken, ghlApiKey, ...safe } = integ as any;
    res.json({ connected: true, oauthAvailable: !!GHL_CLIENT_ID, hasApiKey: !!ghlApiKey, ...safe, pipelines, calendars });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// ✏️ PUT /settings
// ====================================================
router.put('/settings', async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const ownerId = await getOwnerId(userId);
    const { syncContacts, syncPipeline, syncCalendar, syncConversations, syncDirection, pipelineId, pipelineStages, calendarId, isActive } = req.body;
    await prisma.ghlIntegration.update({
      where: { userId: ownerId },
      data: {
        ...(syncContacts !== undefined && { syncContacts }), ...(syncPipeline !== undefined && { syncPipeline }),
        ...(syncCalendar !== undefined && { syncCalendar }), ...(syncConversations !== undefined && { syncConversations }),
        ...(syncDirection !== undefined && { syncDirection }), ...(pipelineId !== undefined && { pipelineId }),
        ...(pipelineStages !== undefined && { pipelineStages }), ...(calendarId !== undefined && { calendarId }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// 🔌 DELETE /disconnect
// ====================================================
router.delete('/disconnect', async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const ownerId = await getOwnerId(userId);
    await prisma.ghlIntegration.delete({ where: { userId: ownerId } });
    console.log(`🔌 GHL disconnected (user: ${userId})`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// 📤 POST /sync/push — Bizonne → GHL
// ====================================================
router.post('/sync/push', async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const ownerId = await getOwnerId(userId);
    const integ = await prisma.ghlIntegration.findUnique({ where: { userId: ownerId } });
    if (!integ?.isActive) return res.status(400).json({ error: 'GHL no conectado' });

    const results = { contacts: 0, opportunities: 0, appointments: 0, errors: [] as string[] };

    // 1. CONTACTS
    if (integ.syncContacts) {
      const convs = await prisma.conversation.findMany({
        where: { userId: ownerId, isGroup: false }, select: { id: true, recipientId: true, recipientName: true, stage: true, contextData: true },
      });
      for (const c of convs) {
        try {
          const phone = c.recipientId?.replace(/@c\.us|@g\.us/g, '') || '';
          if (!phone || phone.length < 7) continue;
          const ctx = (c.contextData || {}) as any;
          const name = c.recipientName || ctx.nombre || ctx.NOMBRE || 'Sin nombre';
          const search: any = await ghlFetch(integ, `/contacts/search/duplicate?locationId=${integ.locationId}&phone=${phone}`);
          if (search.contact) {
            await ghlFetch(integ, `/contacts/${search.contact.id}`, { method: 'PUT', body: JSON.stringify({ name, phone: `+${phone}`, tags: [c.stage || 'new', 'bizonne'] }) });
          } else {
            await ghlFetch(integ, '/contacts/', { method: 'POST', body: JSON.stringify({ locationId: integ.locationId, name, phone: `+${phone}`, tags: [c.stage || 'new', 'bizonne'], source: 'Bizonne WhatsApp' }) });
          }
          results.contacts++;
        } catch (e: any) { results.errors.push(`Contact ${c.recipientName}: ${e.message}`); }
      }
    }

    // 2. OPPORTUNITIES
    if (integ.syncPipeline && integ.pipelineId) {
      const stageMap = (integ.pipelineStages || {}) as Record<string, string>;
      const convs = await prisma.conversation.findMany({ where: { userId, isGroup: false, stage: { not: 'new' } }, select: { id: true, recipientId: true, recipientName: true, stage: true } });
      for (const c of convs) {
        try {
          const phone = c.recipientId?.replace(/@c\.us/g, '') || '';
          const ghlStage = stageMap[c.stage || ''];
          if (!ghlStage || !phone) continue;
          const search: any = await ghlFetch(integ, `/contacts/search/duplicate?locationId=${integ.locationId}&phone=${phone}`);
          if (!search.contact) continue;
          const opps: any = await ghlFetch(integ, `/opportunities/search?locationId=${integ.locationId}&contactId=${search.contact.id}&pipelineId=${integ.pipelineId}`);
          if (opps.opportunities?.length) {
            await ghlFetch(integ, `/opportunities/${opps.opportunities[0].id}`, { method: 'PUT', body: JSON.stringify({ stageId: ghlStage }) });
          } else {
            await ghlFetch(integ, '/opportunities/', { method: 'POST', body: JSON.stringify({ locationId: integ.locationId, pipelineId: integ.pipelineId, stageId: ghlStage, contactId: search.contact.id, name: `${c.recipientName || phone} - WhatsApp`, status: 'open', source: 'Bizonne' }) });
          }
          results.opportunities++;
        } catch (e: any) { results.errors.push(`Opp ${c.recipientName}: ${e.message}`); }
      }
    }

    // 3. APPOINTMENTS
    if (integ.syncCalendar && integ.calendarId) {
      const apts = await prisma.appointment.findMany({ where: { userId, date: { gte: new Date() }, status: { not: 'cancelled' } } });
      for (const a of apts) {
        try {
          const phone = a.clientPhone?.replace(/\D/g, '') || '';
          let contactId = '';
          const search: any = await ghlFetch(integ, `/contacts/search/duplicate?locationId=${integ.locationId}&phone=${phone}`);
          if (search.contact) { contactId = search.contact.id; }
          else { const nc: any = await ghlFetch(integ, '/contacts/', { method: 'POST', body: JSON.stringify({ locationId: integ.locationId, name: a.clientName, phone: `+${phone}` }) }); contactId = nc.contact?.id || ''; }
          if (!contactId) continue;
          const [h, m] = (a.time || '09:00').split(':').map(Number);
          const start = new Date(a.date); start.setHours(h, m, 0, 0);
          const end = new Date(start.getTime() + (a.duration || 60) * 60000);
          await ghlFetch(integ, '/calendars/events', { method: 'POST', body: JSON.stringify({ calendarId: integ.calendarId, locationId: integ.locationId, contactId, title: `${a.type || 'Cita'} - ${a.clientName}`, startTime: start.toISOString(), endTime: end.toISOString(), appointmentStatus: 'confirmed' }) });
          results.appointments++;
        } catch (e: any) { results.errors.push(`Apt ${a.clientName}: ${e.message}`); }
      }
    }

    await prisma.ghlIntegration.update({ where: { userId: ownerId }, data: { lastSyncAt: new Date(), totalSynced: { increment: results.contacts + results.opportunities + results.appointments }, lastError: results.errors[0] || null } });
    console.log(`📤 GHL push: ${results.contacts}C ${results.opportunities}O ${results.appointments}A (user: ${userId})`);
    res.json({ success: true, results });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// 📥 POST /sync/pull — GHL → Bizonne
// ====================================================
router.post('/sync/pull', async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const ownerId = await getOwnerId(userId);
    const integ = await prisma.ghlIntegration.findUnique({ where: { userId: ownerId } });
    if (!integ?.isActive) return res.status(400).json({ error: 'GHL no conectado' });

    const results = { contacts: 0, opportunities: 0, appointments: 0, errors: [] as string[] };

    // 1. PULL CONTACTS
    if (integ.syncContacts) {
      try {
        const data: any = await ghlFetch(integ, `/contacts/?locationId=${integ.locationId}&limit=100`);
        for (const c of (data.contacts || [])) {
          const phone = c.phone?.replace(/[^0-9]/g, '') || '';
          if (!phone || phone.length < 7) continue;
          const ex = await prisma.client.findFirst({ where: { userId, phone: { contains: phone.slice(-10) } } });
          if (ex) { await prisma.client.update({ where: { id: ex.id }, data: { name: c.name || ex.name, email: c.email || ex.email, tags: [...new Set([...(ex.tags || []), 'ghl-sync'])] } }); }
          else { await prisma.client.create({ data: { userId, name: c.name || phone, phone, email: c.email || null, tags: ['ghl-sync'], status: 'lead' } }); }
          results.contacts++;
        }
      } catch (e: any) { results.errors.push(`Pull contacts: ${e.message}`); }
    }

    // 2. PULL PIPELINE
    if (integ.syncPipeline && integ.pipelineId) {
      try {
        const data: any = await ghlFetch(integ, `/opportunities/search?locationId=${integ.locationId}&pipelineId=${integ.pipelineId}&limit=100`);
        const stageMap = (integ.pipelineStages || {}) as Record<string, string>;
        const rev: Record<string, string> = {};
        for (const [b, g] of Object.entries(stageMap)) rev[g as string] = b;
        for (const o of (data.opportunities || [])) {
          if (!o.contact?.phone) continue;
          const phone = o.contact.phone.replace(/[^0-9]/g, '');
          const bStage = rev[o.pipelineStageId];
          if (!bStage) continue;
          const conv = await prisma.conversation.findFirst({ where: { userId, recipientId: { contains: phone.slice(-10) } } });
          if (conv && conv.stage !== bStage) { await prisma.conversation.update({ where: { id: conv.id }, data: { stage: bStage } }); results.opportunities++; }
        }
      } catch (e: any) { results.errors.push(`Pull pipeline: ${e.message}`); }
    }

    // 3. PULL CALENDAR
    if (integ.syncCalendar && integ.calendarId) {
      try {
        const now = new Date(); const next = new Date(now.getTime() + 30 * 86400000);
        const data: any = await ghlFetch(integ, `/calendars/events?locationId=${integ.locationId}&calendarId=${integ.calendarId}&startTime=${now.toISOString()}&endTime=${next.toISOString()}`);
        for (const ev of (data.events || [])) {
          const phone = ev.contact?.phone?.replace(/[^0-9]/g, '') || '';
          if (!phone) continue;
          const d = new Date(ev.startTime);
          const t = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
          const exists = await prisma.appointment.findFirst({ where: { userId, clientPhone: { contains: phone.slice(-10) }, date: { gte: new Date(d.toDateString()), lt: new Date(new Date(d.toDateString()).getTime() + 86400000) } } });
          if (!exists) { await prisma.appointment.create({ data: { userId, clientName: ev.contact?.name || phone, clientPhone: phone, date: d, time: t, type: ev.title || 'Cita GHL', status: 'pending', notes: `GHL: ${ev.title || ''}` } }); results.appointments++; }
        }
      } catch (e: any) { results.errors.push(`Pull calendar: ${e.message}`); }
    }

    await prisma.ghlIntegration.update({ where: { userId: ownerId }, data: { lastSyncAt: new Date(), totalSynced: { increment: results.contacts + results.opportunities + results.appointments }, lastError: results.errors[0] || null } });
    console.log(`📥 GHL pull: ${results.contacts}C ${results.opportunities}O ${results.appointments}A (user: ${userId})`);
    res.json({ success: true, results });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// 📋 GET /logs
// ====================================================
router.get('/logs', async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const ownerId = await getOwnerId(userId);
    const logs = await prisma.ghlSyncLog.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    res.json(logs);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// 🪝 POST /webhook — GHL → Bizonne (realtime)
// ====================================================
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const event = req.body;
    const type = event.type || event.event;
    console.log(`🪝 GHL webhook: ${type}`);

    if (GHL_WEBHOOK_SECRET) {
      const sig = req.headers['x-ghl-signature'] as string;
      if (sig) {
        const expected = crypto.createHmac('sha256', GHL_WEBHOOK_SECRET).update(JSON.stringify(req.body)).digest('hex');
        if (sig !== expected) return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const locId = event.locationId || event.location?.id;
    if (!locId) return res.status(200).json({ ok: true });
    const integ = await prisma.ghlIntegration.findFirst({ where: { locationId: locId, isActive: true } });
    if (!integ) return res.status(200).json({ ok: true });
    const userId = integ.userId;

    switch (type) {
      case 'ContactCreate': case 'ContactUpdate': {
        if (!integ.syncContacts) break;
        const c = event.contact || event;
        const phone = c.phone?.replace(/[^0-9]/g, '') || '';
        if (!phone || phone.length < 7) break;
        const ex = await prisma.client.findFirst({ where: { userId, phone: { contains: phone.slice(-10) } } });
        if (ex) { await prisma.client.update({ where: { id: ex.id }, data: { name: c.name || c.firstName || ex.name, email: c.email || ex.email, tags: [...new Set([...(ex.tags || []), 'ghl-sync'])] } }); }
        else { await prisma.client.create({ data: { userId, name: c.name || c.firstName || phone, phone, email: c.email || null, tags: ['ghl-sync'] } }); }
        await prisma.ghlSyncLog.create({ data: { integrationId: integ.id, userId, action: type === 'ContactCreate' ? 'contact_created' : 'contact_updated', direction: 'from_ghl', entityType: 'contact', ghlId: c.id } });
        break;
      }
      case 'OpportunityCreate': case 'OpportunityStageUpdate': {
        if (!integ.syncPipeline) break;
        const o = event.opportunity || event;
        if (!o.contactId) break;
        try {
          const cd: any = await ghlFetch(integ, `/contacts/${o.contactId}`);
          const phone = cd.contact?.phone?.replace(/[^0-9]/g, '') || '';
          if (!phone) break;
          const stageMap = (integ.pipelineStages || {}) as Record<string, string>;
          const rev: Record<string, string> = {}; for (const [b, g] of Object.entries(stageMap)) rev[g as string] = b;
          const bStage = rev[o.pipelineStageId || o.stageId];
          if (!bStage) break;
          const conv = await prisma.conversation.findFirst({ where: { userId, recipientId: { contains: phone.slice(-10) } } });
          if (conv) await prisma.conversation.update({ where: { id: conv.id }, data: { stage: bStage } });
        } catch {}
        await prisma.ghlSyncLog.create({ data: { integrationId: integ.id, userId, action: 'opportunity_synced', direction: 'from_ghl', entityType: 'opportunity', ghlId: o.id } });
        break;
      }
      case 'AppointmentCreate': {
        if (!integ.syncCalendar) break;
        const a = event.appointment || event;
        const phone = a.contact?.phone?.replace(/[^0-9]/g, '') || '';
        if (phone) {
          const d = new Date(a.startTime || a.start_time);
          const t = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
          await prisma.appointment.create({ data: { userId, clientName: a.contact?.name || phone, clientPhone: phone, date: d, time: t, type: a.title || 'Cita GHL', status: 'pending', notes: `GHL: ${a.title || ''}` } });
        }
        await prisma.ghlSyncLog.create({ data: { integrationId: integ.id, userId, action: 'appointment_synced', direction: 'from_ghl', entityType: 'appointment', ghlId: a.id } });
        break;
      }
    }
    res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('❌ GHL webhook:', e.message);
    res.status(200).json({ ok: true });
  }
});

export default router;

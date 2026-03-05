// ============================================
// calls.routes.ts - Sistema de Llamadas IA con Retell AI
// BizonneCRM v2.0 — Soporte Twilio SIP Trunking + Números internacionales
// ============================================

import { Router } from 'express';
import prisma from '../lib/prisma';
import crypto from 'crypto';

const router = Router();

// ⚡ getOwnerId — sub-usuarios resuelven al owner admin
const _ownerIdCache = new Map<string, {v: string; ts: number}>();
const getOwnerId = async (uid: string): Promise<string> => {
  const c = _ownerIdCache.get(uid);
  if (c && Date.now() - c.ts < 300000) return c.v;
  const u = await db.user.findUnique({ where: { id: uid }, select: { parentUserId: true } });
  const oid = u?.parentUserId || uid;
  _ownerIdCache.set(uid, { v: oid, ts: Date.now() });
  return oid;
};
const db = prisma as any;

// ============================================
// RETELL API HELPER
// ============================================
const RETELL_API = 'https://api.retellai.com';
const RETELL_KEY = process.env.RETELL_API_KEY || '';

async function retellFetch(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
  const opts: any = {
    method,
    headers: { 'Authorization': `Bearer ${RETELL_KEY}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${RETELL_API}${endpoint}`, opts);
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`❌ Retell API error [${method} ${endpoint}]:`, data);
    throw new Error(data?.message || data?.error || `Retell API error ${res.status}`);
  }
  return data;
}

// ============================================
// TWILIO HELPER
// ============================================
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';

function twilioAuth() {
  if (!TWILIO_SID || !TWILIO_TOKEN) throw new Error('Twilio no configurado. Agrega TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN.');
  return Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
}

// ============================================
// 1. GET /config
// ============================================
router.get('/config', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const ownerId = await getOwnerId(userId);
    let config = await db.callConfig.findUnique({ where: { userId: ownerId } });
    if (!config) {
      config = await db.callConfig.create({ data: { id: crypto.randomUUID(), userId: ownerId, agentName: 'Asistente', agentLanguage: 'es', voiceId: '11labs-Adrian' } });
    }
    const hasAddon = !!(await db.payment.findFirst({ where: { userId: ownerId, plan: 'ai_calls', status: 'approved' } }));
    res.json({ ...config, hasRetellKey: !!RETELL_KEY, hasTwilio: !!(TWILIO_SID && TWILIO_TOKEN), hasAddon });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================
// 2. PUT /config
// ============================================
router.put('/config', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const ownerId = await getOwnerId(userId);
    const allowed = ['agentName','agentGreeting','agentPrompt','agentLanguage','voiceId','voiceProvider','voiceSpeed','voiceTemperature','enableAutoReminders','reminderHoursBefore','enableBackchannel','maxCallDuration'];
    const data: any = {};
    for (const key of allowed) { if (req.body[key] !== undefined) data[key] = req.body[key]; }

    let config = await db.callConfig.findUnique({ where: { userId: ownerId } });
    if (!config) { config = await db.callConfig.create({ data: { id: crypto.randomUUID(), userId: ownerId, ...data } }); }
    else { config = await db.callConfig.update({ where: { userId: ownerId }, data }); }

    // Sync con Retell si activo
    if (config.isActive && config.retellAgentId) {
      try {
        const agentUpdate: any = {};
        if (data.voiceId) agentUpdate.voice_id = data.voiceId;
        if (data.voiceSpeed !== undefined) agentUpdate.voice_speed = data.voiceSpeed;
        if (data.voiceTemperature !== undefined) agentUpdate.voice_temperature = data.voiceTemperature;
        if (data.enableBackchannel !== undefined) agentUpdate.enable_backchannel = data.enableBackchannel;
        if (Object.keys(agentUpdate).length) await retellFetch(`/update-agent/${config.retellAgentId}`, 'PATCH', agentUpdate);

        if ((data.agentPrompt !== undefined || data.agentGreeting !== undefined || data.agentName !== undefined) && config.retellLlmId) {
          const assistant = await prisma.assistant.findFirst({ where: { userId: ownerId }, select: { name: true, context: true, personality: true, businessInfo: true, instructions: true } });
          const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } });
          const llmUpdate: any = { general_prompt: buildAgentPrompt(config, assistant, user?.name || 'Negocio') };
          if (data.agentGreeting !== undefined) llmUpdate.begin_message = data.agentGreeting || `Hola, ¿en qué puedo ayudarle?`;
          await retellFetch(`/update-retell-llm/${config.retellLlmId}`, 'PATCH', llmUpdate);
        }
      } catch (e: any) { console.warn(`⚠️ Sync Retell: ${e.message}`); }
    }
    res.json(config);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================
// 3. POST /activate — Activar (Retell directo o Twilio SIP)
// ============================================
router.post('/activate', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { phoneMode, twilioPhoneNumber, countryCode } = req.body;
    // phoneMode: 'retell' | 'twilio_import'
    
    if (!RETELL_KEY) return res.status(400).json({ error: 'Retell API key no configurada' });
    let config = await db.callConfig.findUnique({ where: { userId } });
    if (!config) config = await db.callConfig.create({ data: { id: crypto.randomUUID(), userId } });
    if (config.isActive && config.retellAgentId && config.retellPhoneNumber) return res.json({ message: 'Línea ya activa', config });

    const assistant = await prisma.assistant.findFirst({ where: { userId }, select: { name: true, context: true, personality: true, businessInfo: true, instructions: true } });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const businessName = user?.name || 'Negocio';
    const baseUrl = process.env.API_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3001');

    // 1. Crear LLM
    console.log('📝 Creando LLM en Retell...');
    const llm: any = await retellFetch('/create-retell-llm', 'POST', {
      general_prompt: buildAgentPrompt(config, assistant, businessName),
      begin_message: config.agentGreeting || `Hola, gracias por comunicarse con ${businessName}. ¿En qué puedo ayudarle?`,
      general_tools: [{ type: 'end_call', name: 'end_call', description: 'Terminar la llamada cuando el cliente se despide' }],
      model: 'gpt-4o-mini',
    });

    // 2. Crear Agente
    console.log('🤖 Creando Agente en Retell...');
    const voiceId = config.voiceId || '11labs-Adrian';
    const agentPayload: any = {
      response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
      agent_name: `${businessName} - ${config.agentName}`,
      voice_id: voiceId,
      voice_speed: config.voiceSpeed || 1,
      voice_temperature: config.voiceTemperature || 1,
      language: config.agentLanguage === 'es' ? 'es-ES' : config.agentLanguage,
      enable_backchannel: config.enableBackchannel,
      backchannel_frequency: 0.8,
      backchannel_words: ['sí', 'ajá', 'claro', 'entiendo'],
      responsiveness: 0.8,
      interruption_sensitivity: 0.7,
      max_call_duration_ms: config.maxCallDuration || 300000,
      ambient_sound: 'call-center',
      ambient_sound_volume: 0.3,
      webhook_url: `${baseUrl}/api/webhook/retell`,
      normalize_for_speech: true,
      post_call_analysis_data: [
        { type: 'string', name: 'call_summary', key: 'call_summary', description: 'Resumen breve de la llamada en español' },
        { type: 'enum', name: 'sentiment', key: 'sentiment', description: 'Sentimiento', choices: ['positive', 'neutral', 'negative'] },
      ],
    };
    if (voiceId.startsWith('11labs')) agentPayload.voice_model = 'eleven_flash_v2_5';
    const agent: any = await retellFetch('/create-agent', 'POST', agentPayload);

    // 3. Número según modo
    let phoneNumber: string | null = null;
    let phoneNumberId: string | null = null;
    const mode = phoneMode || 'retell';

    if (mode === 'twilio_import' && twilioPhoneNumber) {
      // ═══ MODO TWILIO SIP ═══
      const formatted = formatE164(twilioPhoneNumber, countryCode || 'CO');
      console.log(`📞 Importando ${formatted} via SIP Trunk...`);
      try {
        const sipData: any = await retellFetch('/import-phone-number', 'POST', {
          phone_number: formatted,
          inbound_agent_id: agent.agent_id,
          outbound_agent_id: agent.agent_id,
          termination_uri: process.env.TWILIO_SIP_TERMINATION_URI || `${TWILIO_SID}.pstn.twilio.com`,
          ...(process.env.TWILIO_SIP_USERNAME && { sip_trunk_auth_username: process.env.TWILIO_SIP_USERNAME }),
          ...(process.env.TWILIO_SIP_PASSWORD && { sip_trunk_auth_password: process.env.TWILIO_SIP_PASSWORD }),
          nickname: `${businessName} - ${countryCode || 'CO'}`,
        });
        phoneNumber = formatted;
        phoneNumberId = sipData.phone_number_id || sipData.phone_number || formatted;
        console.log(`✅ Número importado SIP: ${phoneNumber}`);
      } catch (sipErr: any) {
        // Limpiar agente y LLM creados
        try { await retellFetch(`/delete-agent/${agent.agent_id}`, 'DELETE'); } catch {}
        try { await retellFetch(`/delete-retell-llm/${llm.llm_id}`, 'DELETE'); } catch {}
        throw new Error(`Error importando número SIP: ${sipErr.message}. Verifica que el SIP trunk de Twilio esté configurado.`);
      }
    } else {
      // ═══ MODO RETELL (US/CA) ═══
      console.log('📞 Comprando número Retell...');
      try {
        const phoneData: any = await retellFetch('/create-phone-number', 'POST', {
          inbound_agent_id: agent.agent_id,
          outbound_agent_id: agent.agent_id,
        });
        phoneNumber = phoneData.phone_number;
        phoneNumberId = phoneData.phone_number_id || phoneData.phone_number;
        console.log(`✅ Número Retell: ${phoneNumber}`);
      } catch (phoneErr: any) {
        console.warn('⚠️ No se pudo comprar número:', phoneErr.message);
      }
    }

    // 4. Guardar
    config = await db.callConfig.update({
      where: { userId },
      data: {
        retellAgentId: agent.agent_id, retellLlmId: llm.llm_id,
        retellPhoneNumber: phoneNumber, retellPhoneNumberId: phoneNumberId,
        isActive: true, activatedAt: new Date(),
      }
    });
    console.log(`✅ Línea IA activada | Agent: ${agent.agent_id} | Phone: ${phoneNumber || 'N/A'} | Mode: ${mode}`);
    res.json({ success: true, config, phone: phoneNumber, mode });
  } catch (e: any) {
    console.error('❌ Error activando:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 4. POST /deactivate
// ============================================
router.post('/deactivate', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const ownerId = await getOwnerId(userId);
    const config = await db.callConfig.findUnique({ where: { userId: ownerId } });
    if (!config) return res.status(404).json({ error: 'No config' });
    if (config.retellPhoneNumber) { try { await retellFetch(`/delete-phone-number/${config.retellPhoneNumber}`, 'DELETE'); } catch {} }
    if (config.retellAgentId) { try { await retellFetch(`/delete-agent/${config.retellAgentId}`, 'DELETE'); } catch {} }
    if (config.retellLlmId) { try { await retellFetch(`/delete-retell-llm/${config.retellLlmId}`, 'DELETE'); } catch {} }
    await db.callConfig.update({ where: { userId: ownerId }, data: { retellAgentId: null, retellLlmId: null, retellPhoneNumber: null, retellPhoneNumberId: null, isActive: false } });
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================
// 5. GET /voices
// ============================================
router.get('/voices', async (req: any, res) => {
  try {
    if (!RETELL_KEY) return res.json(getDefaultVoices());
    const voices: any = await retellFetch('/list-voices');
    const spanishAccents = ['mexican', 'spanish', 'latin america', 'latin american', 'colombian', 'argentinian', 'chilean', 'peruvian', 'hispanic'];
    const mapped = (Array.isArray(voices) ? voices : []).map((v: any) => ({
      voice_id: v.voice_id, voice_name: v.voice_name, provider: v.provider,
      gender: v.gender, accent: v.accent || 'General', age: v.age || 'Adult',
      preview_audio_url: v.preview_audio_url,
      isSpanish: spanishAccents.some((sa: string) => (v.accent || '').toLowerCase().includes(sa)),
    }));
    mapped.sort((a: any, b: any) => { if (a.isSpanish && !b.isSpanish) return -1; if (!a.isSpanish && b.isSpanish) return 1; return a.voice_name.localeCompare(b.voice_name); });
    if (req.query.lang === 'es') return res.json(mapped.filter((v: any) => v.isSpanish));
    res.json(mapped);
  } catch { res.json(getDefaultVoices()); }
});

// ============================================
// 5b. GET /twilio/numbers — Buscar números disponibles
// ============================================
router.get('/twilio/numbers', async (req: any, res) => {
  try {
    const country = (req.query.country as string) || 'CO';
    const type = (req.query.type as string) || 'Mobile';
    const auth = twilioAuth();
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/AvailablePhoneNumbers/${country}/${type}.json?PageSize=10`;
    const r = await fetch(url, { headers: { 'Authorization': `Basic ${auth}` } });
    if (!r.ok) { const e: any = await r.json().catch(() => ({})); throw new Error(e?.message || `Twilio ${r.status}`); }
    const data: any = await r.json();
    res.json({ numbers: (data.available_phone_numbers || []).map((n: any) => ({ phoneNumber: n.phone_number, friendlyName: n.friendly_name, locality: n.locality, region: n.region })), country });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================
// 5c. POST /twilio/buy — Comprar número en Twilio
// ============================================
router.post('/twilio/buy', async (req: any, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber requerido' });
    const auth = twilioAuth();
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/IncomingPhoneNumbers.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ PhoneNumber: phoneNumber }).toString(),
    });
    if (!r.ok) { const e: any = await r.json().catch(() => ({})); throw new Error(e?.message || `Twilio ${r.status}`); }
    const data: any = await r.json();
    console.log(`📞 Twilio comprado: ${data.phone_number} (SID: ${data.sid})`);
    res.json({ success: true, phoneNumber: data.phone_number, sid: data.sid });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================
// 5d. POST /twilio/setup-sip — Auto-config SIP trunk
// ============================================
router.post('/twilio/setup-sip', async (req: any, res) => {
  try {
    const auth = twilioAuth();
    const headers: any = { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' };
    // 1. Crear trunk
    const trR = await fetch('https://trunking.twilio.com/v1/Trunks', { method: 'POST', headers, body: new URLSearchParams({ FriendlyName: `Retell-Bizonne-${Date.now()}` }).toString() });
    if (!trR.ok) throw new Error(`Trunk creation failed: ${trR.status}`);
    const trunk: any = await trR.json();
    // 2. Origination URI (inbound → Retell)
    await fetch(`https://trunking.twilio.com/v1/Trunks/${trunk.sid}/OriginationUrls`, {
      method: 'POST', headers,
      body: new URLSearchParams({ FriendlyName: 'Retell AI', SipUrl: 'sip:sip.retellai.com', Priority: '1', Weight: '1', Enabled: 'true' }).toString(),
    }).catch(() => {});
    const termUri = `${TWILIO_SID}.pstn.twilio.com`;
    console.log(`✅ SIP Trunk: ${trunk.sid} | Term: ${termUri}`);
    res.json({ success: true, trunkSid: trunk.sid, terminationUri: termUri, retellSipUri: 'sip:sip.retellai.com' });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================
// 6. POST /call — Iniciar llamada
// ============================================
router.post('/call', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const ownerId = await getOwnerId(userId);
    const { toNumber, toName, clientId, appointmentId, callType = 'manual', countryCode = 'CO' } = req.body;
    if (!toNumber) return res.status(400).json({ error: 'Número requerido' });
    const config = await db.callConfig.findUnique({ where: { userId: ownerId } });
    if (!config?.isActive || !config.retellAgentId) return res.status(400).json({ error: 'Línea no activada' });
    if (!config.retellPhoneNumber) return res.status(400).json({ error: 'No hay número asignado' });
    const formatted = formatE164(toNumber, countryCode);
    let clientName = toName;
    const ctx: string[] = [];
    if (clientId) {
      const cl = await prisma.client.findFirst({ where: { id: clientId, userId: ownerId }, select: { name: true, email: true, notes: true } });
      if (cl) { clientName = clientName || cl.name; ctx.push(`Cliente: ${cl.name}${cl.email ? ` | ${cl.email}` : ''}${cl.notes ? ` | ${cl.notes}` : ''}`); }
    }
    if (appointmentId) {
      const apt = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { type: true, date: true, time: true, notes: true } });
      if (apt) { const d = new Date(apt.date).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }); ctx.push(`Cita: ${apt.type} el ${d} a las ${apt.time}`); }
    }
    const rc: any = await retellFetch('/v2/create-phone-call', 'POST', {
      from_number: config.retellPhoneNumber, to_number: formatted, override_agent_id: config.retellAgentId,
      metadata: { bizonne_user_id: userId, client_id: clientId, appointment_id: appointmentId, call_type: callType },
      ...(ctx.length && { retell_llm_dynamic_variables: { client_context: ctx.join('\n') } }),
    });
    const call = await db.call.create({
      data: { id: crypto.randomUUID(), userId: ownerId, callConfigId: config.id, retellCallId: rc.call_id, retellCallStatus: rc.call_status || 'registered', direction: 'outbound', fromNumber: config.retellPhoneNumber, toNumber: formatted, toName: clientName || null, clientId: clientId || null, appointmentId: appointmentId || null, status: 'initiated', callType, startedAt: new Date() }
    });
    console.log(`📞 Llamada: ${call.id} → ${formatted}`);
    res.json({ success: true, call: { id: call.id, retellCallId: rc.call_id, status: 'initiated', toNumber: formatted, toName: clientName } });
  } catch (e: any) { console.error('❌ Call error:', e.message); res.status(500).json({ error: e.message }); }
});

// ============================================
// 7. GET /call/:id
// ============================================
router.get('/call/:id', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const call = await db.call.findFirst({ where: { id: req.params.id, userId } });
    if (!call) return res.status(404).json({ error: 'No encontrada' });
    if (call.retellCallId && ['initiated', 'in_progress'].includes(call.status)) {
      try {
        const rd: any = await retellFetch(`/v2/get-call/${call.retellCallId}`);
        const ns = mapRetellStatus(rd.call_status);
        if (ns !== call.status) {
          await db.call.update({ where: { id: call.id }, data: { status: ns, retellCallStatus: rd.call_status, duration: rd.duration_ms ? Math.round(rd.duration_ms / 1000) : null, transcript: rd.transcript || null, recordingUrl: rd.recording_url || null, endReason: rd.disconnection_reason || null, endedAt: rd.end_timestamp ? new Date(rd.end_timestamp) : null } });
          return res.json({ ...call, status: ns, duration: rd.duration_ms ? Math.round(rd.duration_ms / 1000) : call.duration, transcript: rd.transcript || call.transcript, recordingUrl: rd.recording_url || call.recordingUrl });
        }
      } catch {}
    }
    res.json(call);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================
// 8. GET /history | 9. GET /stats
// ============================================
router.get('/history', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const ownerId = await getOwnerId(userId);
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const where: any = { userId: ownerId };
    if (req.query.status) where.status = req.query.status;
    if (req.query.search) where.OR = [{ toName: { contains: req.query.search } }, { toNumber: { contains: req.query.search } }, { transcript: { contains: req.query.search } }];
    const [calls, total] = await Promise.all([db.call.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), db.call.count({ where })]);
    res.json({ calls, total, page, totalPages: Math.ceil(total / limit) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/stats', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const ownerId = await getOwnerId(userId);
    const som = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [tc, mc, cc, tm] = await Promise.all([db.call.count({ where: { userId: ownerId } }), db.call.count({ where: { userId: ownerId, createdAt: { gte: som } } }), db.call.count({ where: { userId: ownerId, status: 'completed' } }), db.call.aggregate({ where: { userId: ownerId, duration: { not: null } }, _sum: { duration: true } })]);
    const cfg = await db.callConfig.findUnique({ where: { userId: ownerId }, select: { minutesUsed: true, minutesLimit: true, isActive: true, retellPhoneNumber: true } });
    res.json({ totalCalls: tc, monthCalls: mc, completedCalls: cc, totalMinutes: Math.round((tm._sum.duration || 0) / 60 * 10) / 10, minutesUsed: cfg?.minutesUsed || 0, isActive: cfg?.isActive || false, phoneNumber: cfg?.retellPhoneNumber || null });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================
// 10. WEBHOOK Retell (PÚBLICO)
// ============================================
export async function handleRetellWebhook(req: any, res: any) {
  try {
    const event = req.body;
    console.log(`📨 Retell Webhook: ${event.event} | Call: ${event.call?.call_id || 'N/A'}`);
    if (!event.event || !event.call) return res.status(200).json({ ok: true });
    const retellCallId = event.call.call_id;
    const cd = event.call;
    const call = await db.call.findFirst({ where: { retellCallId } });
    if (!call) {
      if (event.event === 'call_started' && cd.direction === 'inbound') {
        const cfg = await db.callConfig.findFirst({ where: { retellPhoneNumber: cd.to_number } });
        if (cfg) await db.call.create({ data: { id: crypto.randomUUID(), userId: cfg.userId, callConfigId: cfg.id, retellCallId: cd.call_id, retellCallStatus: 'ongoing', direction: 'inbound', fromNumber: cd.from_number, toNumber: cd.to_number, status: 'in_progress', callType: 'inbound', startedAt: new Date() } });
      }
      return res.status(200).json({ ok: true });
    }
    switch (event.event) {
      case 'call_started': await db.call.update({ where: { id: call.id }, data: { status: 'in_progress', retellCallStatus: 'ongoing', startedAt: new Date() } }); break;
      case 'call_ended': {
        const dur = cd.duration_ms ? Math.round(cd.duration_ms / 1000) : null;
        const min = dur ? dur / 60 : 0;
        await db.call.update({ where: { id: call.id }, data: { status: 'completed', retellCallStatus: cd.call_status || 'ended', duration: dur, costUsd: Math.round(min * 0.145 * 1000) / 1000, transcript: cd.transcript || null, recordingUrl: cd.recording_url || null, endReason: cd.disconnection_reason || null, endedAt: new Date(), summary: cd.call_analysis?.call_summary || null, sentiment: cd.call_analysis?.sentiment || null } });
        if (min > 0) await db.callConfig.update({ where: { id: call.callConfigId }, data: { minutesUsed: { increment: min } } });
        console.log(`✅ Llamada: ${call.id} | ${dur}s | $${(min * 0.145).toFixed(3)}`);
        break;
      }
      case 'call_analyzed': if (cd.call_analysis) await db.call.update({ where: { id: call.id }, data: { summary: cd.call_analysis.call_summary || null, sentiment: cd.call_analysis.sentiment || null } }); break;
    }
    res.status(200).json({ ok: true });
  } catch (e: any) { console.error('❌ Webhook:', e.message); res.status(200).json({ ok: true }); }
}

// ============================================
// 11. CRON
// ============================================
let reminderInterval: NodeJS.Timeout | null = null;
export function startCallReminderCron() {
  if (reminderInterval) clearInterval(reminderInterval);
  reminderInterval = setInterval(async () => {
    try {
      const cfgs = await db.callConfig.findMany({ where: { isActive: true, enableAutoReminders: true, retellPhoneNumber: { not: null } }, select: { userId: true, reminderHoursBefore: true, retellAgentId: true, retellPhoneNumber: true, id: true } });
      if (!cfgs.length) return;
      const now = new Date();
      for (const c of cfgs) {
        if (!c.retellAgentId || !c.retellPhoneNumber) continue;
        const target = new Date(now.getTime() + c.reminderHoursBefore * 3600000);
        const apts = await prisma.appointment.findMany({ where: { userId: c.userId, date: { gte: new Date(target.getTime() - 900000), lte: target }, status: { in: ['pending', 'confirmed'] }, clientPhone: { not: '' } } });
        for (const a of apts) {
          if (await db.call.findFirst({ where: { userId: c.userId, appointmentId: a.id, callType: 'auto_reminder', createdAt: { gte: new Date(now.getTime() - 86400000) } } })) continue;
          if (!a.clientPhone) continue;
          try {
            const ph = formatE164(a.clientPhone, 'CO');
            const ds = new Date(a.date).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
            const rc: any = await retellFetch('/v2/create-phone-call', 'POST', { from_number: c.retellPhoneNumber, to_number: ph, override_agent_id: c.retellAgentId, metadata: { bizonne_user_id: c.userId, appointment_id: a.id, call_type: 'auto_reminder' }, retell_llm_dynamic_variables: { client_context: `RECORDATORIO.\nCliente: ${a.clientName}\nCita: ${a.type} el ${ds} a las ${a.time}` } });
            await db.call.create({ data: { id: crypto.randomUUID(), userId: c.userId, callConfigId: c.id, retellCallId: rc.call_id, direction: 'outbound', fromNumber: c.retellPhoneNumber, toNumber: ph, toName: a.clientName, clientId: a.clientId, appointmentId: a.id, status: 'initiated', callType: 'auto_reminder', startedAt: new Date() } });
            console.log(`⏰ Recordatorio: ${a.clientName} → ${a.type} ${a.time}`);
          } catch (err: any) { console.error(`❌ Reminder ${a.id}: ${err.message}`); }
        }
      }
    } catch (e: any) { console.error('Cron:', e.message); }
  }, 900000);
  console.log('⏰ Cron recordatorios de llamadas iniciado');
}

// ============================================
// HELPERS
// ============================================
function buildAgentPrompt(config: any, assistant: any, biz: string): string {
  return `Eres ${config.agentName || 'Asistente'}, asistente virtual de ${biz}.\nAtiendes llamadas en español de manera profesional y amable.\n\n${config.agentPrompt ? `INSTRUCCIONES:\n${config.agentPrompt}\n` : ''}${assistant?.businessInfo ? `NEGOCIO:\n${assistant.businessInfo}\n` : ''}${assistant?.context ? `CONTEXTO:\n${assistant.context}\n` : ''}${assistant?.personality ? `PERSONALIDAD:\n${assistant.personality}\n` : ''}${assistant?.instructions ? `REGLAS:\n${assistant.instructions}\n` : ''}\nREGLAS GENERALES:\n- Español natural y fluido\n- Respuestas cortas (2-3 oraciones)\n- Si no sabes, ofrece tomar mensaje\n- No inventes precios\n- Para citas: toma nombre, teléfono, servicio, fecha/hora\n- Despídete amablemente\n\n{{client_context}}`;
}

const CC: Record<string, { code: string; len: number }> = {
  CO: { code: '57', len: 10 }, US: { code: '1', len: 10 }, MX: { code: '52', len: 10 },
  AR: { code: '54', len: 10 }, CL: { code: '56', len: 9 }, PE: { code: '51', len: 9 },
  EC: { code: '593', len: 9 }, VE: { code: '58', len: 10 }, ES: { code: '34', len: 9 }, BR: { code: '55', len: 11 },
};

function formatE164(phone: string, country: string = 'CO'): string {
  let c = phone.replace(/[\s\-\(\)\.]/g, '');
  if (c.startsWith('+') && c.length >= 10) return c;
  if (c.startsWith('+')) c = c.substring(1);
  const info = CC[country] || CC.CO;
  if (c.startsWith(info.code) && c.length >= info.len + info.code.length) return '+' + c;
  if (c.length >= info.len - 1 && c.length <= info.len + 1) return '+' + info.code + c;
  return '+' + c;
}

function mapRetellStatus(s: string): string { return ({ registered: 'initiated', ongoing: 'in_progress', ended: 'completed', error: 'failed' } as any)[s] || s; }

function getDefaultVoices() {
  return [
    { voice_id: '11labs-Adrian', voice_name: 'Adrian', provider: 'elevenlabs', gender: 'male', accent: 'American', age: 'Young', preview_audio_url: null, isSpanish: false },
    { voice_id: '11labs-Myra', voice_name: 'Myra', provider: 'elevenlabs', gender: 'female', accent: 'American', age: 'Young', preview_audio_url: null, isSpanish: false },
    { voice_id: '11labs-Paola', voice_name: 'Paola', provider: 'elevenlabs', gender: 'female', accent: 'Latin American', age: 'Young', preview_audio_url: null, isSpanish: true },
    { voice_id: '11labs-Valentino', voice_name: 'Valentino', provider: 'elevenlabs', gender: 'male', accent: 'Latin American', age: 'Middle Aged', preview_audio_url: null, isSpanish: true },
    { voice_id: 'openai-Alloy', voice_name: 'Alloy', provider: 'openai', gender: 'female', accent: 'Neutral', age: 'Young', preview_audio_url: null, isSpanish: false },
    { voice_id: 'openai-Echo', voice_name: 'Echo', provider: 'openai', gender: 'male', accent: 'Neutral', age: 'Middle Aged', preview_audio_url: null, isSpanish: false },
    { voice_id: 'openai-Nova', voice_name: 'Nova', provider: 'openai', gender: 'female', accent: 'Neutral', age: 'Young', preview_audio_url: null, isSpanish: false },
  ];
}

export default router;

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();
const log = (msg: string) => console.log(`📞 ${msg}`);

// ====================================================
// 📞 LLAMADAS IA — Twilio + ElevenLabs Conversational AI
// ====================================================
// Flow:
//   Outbound: Backend → Twilio REST API (create call) → Twilio connects →
//             TwiML returns <Connect><Stream> → ElevenLabs WebSocket agent converses
//   Inbound:  Customer calls Twilio number → Twilio hits webhook →
//             TwiML <Connect><Stream> → ElevenLabs agent answers
//
// Required env vars (or per-user config):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (or per-user in CallConfig)
//   ELEVENLABS API Key (per-user in CallConfig)
// ====================================================

interface AuthRequest extends Request { user?: { id: string; userId?: string } }

const getOwnerId = async (userId: string): Promise<string> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  return user?.parentUserId || userId;
};

const BACKEND_URL = process.env.BACKEND_URL || 
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3001');
const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

// ====================================================
// 📞 GET /config — Obtener configuración de llamadas
// ====================================================
router.get('/config', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const config = await prisma.callConfig.findUnique({ where: { userId: ownerId } });
    
    const [totalCalls, todayCalls, totalMinutesAgg] = await Promise.all([
      prisma.call.count({ where: { userId: ownerId } }),
      prisma.call.count({ where: { userId: ownerId, createdAt: { gte: new Date(new Date().setHours(0,0,0,0)) } } }),
      prisma.call.aggregate({ where: { userId: ownerId, duration: { gt: 0 } }, _sum: { duration: true } })
    ]);

    // Mask sensitive fields
    const safeConfig = config ? {
      ...config,
      twilioAuthToken: config.twilioAuthToken ? '••••••' + config.twilioAuthToken.slice(-4) : '',
      elevenLabsApiKey: config.elevenLabsApiKey ? '••••••' + config.elevenLabsApiKey.slice(-4) : '',
    } : null;

    res.json({ 
      config: safeConfig,
      stats: {
        totalCalls,
        todayCalls,
        totalMinutes: Math.round((totalMinutesAgg._sum.duration || 0) / 60)
      }
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// 📞 POST /config — Guardar configuración
// ====================================================
router.post('/config', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const { 
      twilioAccountSid, twilioAuthToken, twilioPhoneNumber,
      elevenLabsAgentId, elevenLabsApiKey,
      voiceId, voiceName, systemPrompt, firstMessage, language,
      callsEnabled, autoCallReminders, autoCallFollowup, autoCallReactivation,
      reminderHoursBefore
    } = req.body;

    // Don't overwrite tokens with masked values
    const existing = await prisma.callConfig.findUnique({ where: { userId: ownerId } });
    const finalAuthToken = twilioAuthToken && !twilioAuthToken.startsWith('••') ? twilioAuthToken : existing?.twilioAuthToken || '';
    const finalApiKey = elevenLabsApiKey && !elevenLabsApiKey.startsWith('••') ? elevenLabsApiKey : existing?.elevenLabsApiKey || '';

    const config = await prisma.callConfig.upsert({
      where: { userId: ownerId },
      create: {
        userId: ownerId,
        twilioAccountSid: twilioAccountSid || '', twilioAuthToken: finalAuthToken, twilioPhoneNumber: twilioPhoneNumber || '',
        elevenLabsAgentId: elevenLabsAgentId || '', elevenLabsApiKey: finalApiKey,
        voiceId: voiceId || '', voiceName: voiceName || '',
        systemPrompt: systemPrompt || '', firstMessage: firstMessage || '',
        language: language || 'es', callsEnabled: callsEnabled ?? false,
        autoCallReminders: autoCallReminders ?? false, autoCallFollowup: autoCallFollowup ?? false,
        autoCallReactivation: autoCallReactivation ?? false, reminderHoursBefore: reminderHoursBefore ?? 24,
      },
      update: {
        ...(twilioAccountSid !== undefined && { twilioAccountSid }),
        ...(twilioPhoneNumber !== undefined && { twilioPhoneNumber }),
        twilioAuthToken: finalAuthToken,
        elevenLabsApiKey: finalApiKey,
        ...(elevenLabsAgentId !== undefined && { elevenLabsAgentId }),
        ...(voiceId !== undefined && { voiceId }),
        ...(voiceName !== undefined && { voiceName }),
        ...(systemPrompt !== undefined && { systemPrompt }),
        ...(firstMessage !== undefined && { firstMessage }),
        ...(language !== undefined && { language }),
        ...(callsEnabled !== undefined && { callsEnabled }),
        ...(autoCallReminders !== undefined && { autoCallReminders }),
        ...(autoCallFollowup !== undefined && { autoCallFollowup }),
        ...(autoCallReactivation !== undefined && { autoCallReactivation }),
        ...(reminderHoursBefore !== undefined && { reminderHoursBefore }),
      }
    });

    log(`Config guardada: ${ownerId}`);
    res.json({ success: true, config: { ...config, twilioAuthToken: '••••••', elevenLabsApiKey: '••••••' } });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// 📞 POST /create-agent — Crear agente ElevenLabs
// ====================================================
router.post('/create-agent', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const config = await prisma.callConfig.findUnique({ where: { userId: ownerId } });
    if (!config?.elevenLabsApiKey) { res.status(400).json({ error: 'Configura tu API Key de ElevenLabs primero' }); return; }

    // Get assistant context for the agent personality
    const assistant = await prisma.assistant.findFirst({ 
      where: { userId: ownerId, isActive: true },
      select: { name: true, context: true, personality: true, businessInfo: true, instructions: true }
    });

    const prompt = config.systemPrompt || [
      `Eres ${assistant?.name || 'un asistente virtual'} de atención telefónica.`,
      assistant?.businessInfo || '',
      assistant?.personality || '',
      'Responde de forma natural, amable y profesional en español. Sé conciso.',
      assistant?.instructions || '',
      'IMPORTANTE: Estás en una llamada telefónica. Sé breve y natural. No uses emojis ni formato. Si el cliente pide agendar una cita, solicita: nombre, fecha, hora y servicio.'
    ].filter(Boolean).join(' ');

    const firstMsg = config.firstMessage || `¡Hola! Soy ${assistant?.name || 'el asistente virtual'}. ¿En qué puedo ayudarte hoy?`;

    const agentRes = await fetch(`${ELEVENLABS_API}/convai/agents/create`, {
      method: 'POST',
      headers: { 'xi-api-key': config.elevenLabsApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Bizonne - ${assistant?.name || 'Asistente'}`,
        conversation_config: {
          agent: {
            prompt: { prompt },
            first_message: firstMsg,
            language: config.language || 'es'
          },
          tts: {
            voice_id: config.voiceId || undefined
          }
        }
      })
    });

    if (!agentRes.ok) {
      const err = await agentRes.text();
      log(`❌ Error creando agente: ${err}`);
      res.status(agentRes.status).json({ error: `ElevenLabs: ${err}` }); return;
    }

    const agent = await agentRes.json() as any;
    log(`✅ Agente creado: ${agent.agent_id}`);

    await prisma.callConfig.update({
      where: { userId: ownerId },
      data: { elevenLabsAgentId: agent.agent_id }
    });

    res.json({ success: true, agentId: agent.agent_id });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// 📞 POST /update-agent — Actualizar agente existente
// ====================================================
router.post('/update-agent', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const config = await prisma.callConfig.findUnique({ where: { userId: ownerId } });
    if (!config?.elevenLabsApiKey || !config?.elevenLabsAgentId) {
      res.status(400).json({ error: 'Crea un agente primero' }); return;
    }

    const { systemPrompt, firstMessage, voiceId, language } = req.body;

    const updateRes = await fetch(`${ELEVENLABS_API}/convai/agents/${config.elevenLabsAgentId}`, {
      method: 'PATCH',
      headers: { 'xi-api-key': config.elevenLabsApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_config: {
          agent: {
            ...(systemPrompt && { prompt: { prompt: systemPrompt } }),
            ...(firstMessage && { first_message: firstMessage }),
            ...(language && { language })
          },
          ...(voiceId && { tts: { voice_id: voiceId } })
        }
      })
    });

    if (!updateRes.ok) {
      res.status(updateRes.status).json({ error: await updateRes.text() }); return;
    }

    // Update local config too
    const updateData: any = {};
    if (systemPrompt) updateData.systemPrompt = systemPrompt;
    if (firstMessage) updateData.firstMessage = firstMessage;
    if (voiceId) updateData.voiceId = voiceId;
    if (language) updateData.language = language;
    if (Object.keys(updateData).length > 0) {
      await prisma.callConfig.update({ where: { userId: ownerId }, data: updateData });
    }

    log(`✅ Agente actualizado: ${config.elevenLabsAgentId}`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// 📞 GET /voices — Listar voces ElevenLabs
// ====================================================
router.get('/voices', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    // Check if user sent apiKey in query, else use config
    const apiKeyParam = req.query.apiKey as string;
    let apiKey = apiKeyParam;
    
    if (!apiKey) {
      const config = await prisma.callConfig.findUnique({ where: { userId: ownerId } });
      apiKey = config?.elevenLabsApiKey || '';
    }
    if (!apiKey) { res.status(400).json({ error: 'API Key de ElevenLabs requerida' }); return; }

    const voiceRes = await fetch(`${ELEVENLABS_API}/voices`, { headers: { 'xi-api-key': apiKey } });
    if (!voiceRes.ok) { res.status(voiceRes.status).json({ error: 'Error fetching voices' }); return; }

    const data = await voiceRes.json() as any;
    const voices = (data.voices || []).map((v: any) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
      labels: v.labels,
      preview_url: v.preview_url,
      description: v.description
    }));

    res.json({ voices });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// 📞 POST /call — Iniciar llamada saliente
// ====================================================
router.post('/call', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const { to, context: callContext, type, clientName } = req.body;
    if (!to) { res.status(400).json({ error: 'Número de destino requerido' }); return; }

    const config = await prisma.callConfig.findUnique({ where: { userId: ownerId } });
    if (!config?.callsEnabled) { res.status(400).json({ error: 'Las llamadas no están habilitadas' }); return; }
    if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioPhoneNumber) {
      res.status(400).json({ error: 'Configura Twilio primero' }); return;
    }
    if (!config.elevenLabsAgentId || !config.elevenLabsApiKey) {
      res.status(400).json({ error: 'Crea un agente de voz primero' }); return;
    }

    const cleanNumber = to.replace(/\D/g, '');
    const phoneE164 = cleanNumber.startsWith('+') ? cleanNumber : `+${cleanNumber}`;

    // Create call record
    const call = await prisma.call.create({
      data: {
        userId: ownerId, direction: 'outbound', type: type || 'manual',
        phoneNumber: phoneE164, clientName: clientName || null,
        status: 'initiating', agentId: config.elevenLabsAgentId,
        context: callContext || null
      }
    });

    // Twilio REST API → create outbound call
    const twilioAuth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
    const webhookUrl = `${BACKEND_URL}/api/calls/twilio-webhook?callId=${call.id}`;

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Calls.json`,
      {
        method: 'POST',
        headers: { 'Authorization': `Basic ${twilioAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          To: phoneE164,
          From: config.twilioPhoneNumber,
          Url: webhookUrl,
          StatusCallback: `${BACKEND_URL}/api/calls/twilio-status?callId=${call.id}`,
          StatusCallbackEvent: 'initiated ringing answered completed',
          Record: 'true',
          RecordingStatusCallback: `${BACKEND_URL}/api/calls/twilio-recording?callId=${call.id}`
        }).toString()
      }
    );

    if (!twilioRes.ok) {
      const err = await twilioRes.text();
      await prisma.call.update({ where: { id: call.id }, data: { status: 'failed', error: err } });
      res.status(twilioRes.status).json({ error: `Twilio: ${err}` }); return;
    }

    const twilioData = await twilioRes.json() as any;
    await prisma.call.update({ where: { id: call.id }, data: { twilioCallSid: twilioData.sid, status: 'ringing' } });

    log(`📞 Llamada → ${phoneE164} (SID: ${twilioData.sid})`);
    res.json({ success: true, callId: call.id, twilioSid: twilioData.sid });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// 📞 GET /history — Historial de llamadas
// ====================================================
router.get('/history', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const direction = req.query.direction as string;
    const status = req.query.status as string;

    const where: any = { userId: ownerId };
    if (direction) where.direction = direction;
    if (status) where.status = status;

    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        select: {
          id: true, direction: true, type: true, phoneNumber: true, clientName: true,
          status: true, duration: true, transcript: true, summary: true,
          recordingUrl: true, error: true,
          createdAt: true, answeredAt: true, endedAt: true
        }
      }),
      prisma.call.count({ where })
    ]);

    res.json({ calls, total, page, pages: Math.ceil(total / limit) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// 📞 GET /:id — Detalle de llamada
// ====================================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const call = await prisma.call.findFirst({ where: { id: req.params.id, userId: ownerId } });
    if (!call) { res.status(404).json({ error: 'No encontrada' }); return; }
    res.json({ call });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ====================================================
// 📞 DELETE /:id — Eliminar llamada
// ====================================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const call = await prisma.call.findFirst({ where: { id: req.params.id, userId: ownerId } });
    if (!call) { res.status(404).json({ error: 'No encontrada' }); return; }
    await prisma.call.delete({ where: { id: call.id } });
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;

// ====================================================
// 🌐 PUBLIC WEBHOOK ROUTES (no auth)
// ====================================================
export const callsPublicRouter = Router();

// 📞 Twilio webhook — returns TwiML to connect ElevenLabs agent
callsPublicRouter.post('/twilio-webhook', async (req: Request, res: Response) => {
  try {
    const { callId } = req.query;
    const call = callId ? await prisma.call.findUnique({ where: { id: callId as string } }) : null;
    if (!call) { res.status(404).send('Not found'); return; }

    const config = await prisma.callConfig.findUnique({ where: { userId: call.userId } });
    if (!config?.elevenLabsAgentId || !config?.elevenLabsApiKey) {
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say language="es-MX">El agente de voz no está disponible.</Say><Hangup/></Response>`);
      return;
    }

    // Get ElevenLabs signed URL for Twilio <Stream>
    const signRes = await fetch(
      `${ELEVENLABS_API}/convai/twilio/get_signed_url?agent_id=${config.elevenLabsAgentId}`,
      { method: 'GET', headers: { 'xi-api-key': config.elevenLabsApiKey } }
    );

    if (!signRes.ok) {
      log(`❌ ElevenLabs signed URL error: ${signRes.status}`);
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say language="es-MX">Servicio no disponible. Intente más tarde.</Say><Hangup/></Response>`);
      return;
    }

    const { signed_url } = await signRes.json() as any;

    // TwiML: connect Twilio audio stream to ElevenLabs WebSocket
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${signed_url}">
      <Parameter name="callId" value="${callId}" />
    </Stream>
  </Connect>
</Response>`);

    await prisma.call.update({ where: { id: call.id }, data: { status: 'in_progress', answeredAt: new Date() } });
    log(`📞 Conectado a ElevenLabs: ${call.phoneNumber}`);
  } catch (e: any) {
    log(`❌ Webhook error: ${e.message}`);
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say language="es-MX">Error interno.</Say><Hangup/></Response>`);
  }
});

// 📞 Twilio status callback
callsPublicRouter.post('/twilio-status', async (req: Request, res: Response) => {
  try {
    const { callId } = req.query;
    const { CallStatus, CallDuration } = req.body;
    if (!callId) { res.status(200).send('OK'); return; }

    const data: any = {};
    if (CallStatus === 'completed') {
      data.status = 'completed'; data.endedAt = new Date(); data.duration = parseInt(CallDuration) || 0;
    } else if (['busy', 'no-answer', 'canceled', 'failed'].includes(CallStatus)) {
      data.status = 'failed'; data.endedAt = new Date(); data.error = CallStatus;
    } else if (CallStatus === 'in-progress') {
      data.status = 'in_progress'; data.answeredAt = new Date();
    } else if (CallStatus === 'ringing') {
      data.status = 'ringing';
    }

    if (Object.keys(data).length > 0) {
      await prisma.call.update({ where: { id: callId as string }, data }).catch(() => {});
      log(`📞 Status ${CallStatus}: ${callId}`);
    }
    res.status(200).send('OK');
  } catch { res.status(200).send('OK'); }
});

// 📞 Twilio recording callback
callsPublicRouter.post('/twilio-recording', async (req: Request, res: Response) => {
  try {
    const { callId } = req.query;
    const { RecordingUrl, RecordingDuration } = req.body;
    if (callId && RecordingUrl) {
      await prisma.call.update({
        where: { id: callId as string },
        data: { recordingUrl: RecordingUrl, duration: parseInt(RecordingDuration) || undefined }
      }).catch(() => {});
      log(`🎙️ Recording: ${callId}`);
    }
    res.status(200).send('OK');
  } catch { res.status(200).send('OK'); }
});

// 📞 Twilio inbound call
callsPublicRouter.post('/twilio-inbound', async (req: Request, res: Response) => {
  try {
    const { To, From, CallSid } = req.body;
    const cleanTo = (To || '').replace(/[^0-9]/g, '');

    // Find user by Twilio phone number
    const config = await prisma.callConfig.findFirst({
      where: { twilioPhoneNumber: { contains: cleanTo.slice(-10) }, callsEnabled: true }
    });

    if (!config?.elevenLabsAgentId || !config?.elevenLabsApiKey) {
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say language="es-MX">Este número no está configurado.</Say><Hangup/></Response>`);
      return;
    }

    const call = await prisma.call.create({
      data: {
        userId: config.userId, direction: 'inbound', type: 'inbound',
        phoneNumber: From || 'unknown', twilioCallSid: CallSid,
        status: 'in_progress', agentId: config.elevenLabsAgentId, answeredAt: new Date()
      }
    });

    const signRes = await fetch(
      `${ELEVENLABS_API}/convai/twilio/get_signed_url?agent_id=${config.elevenLabsAgentId}`,
      { method: 'GET', headers: { 'xi-api-key': config.elevenLabsApiKey } }
    );

    if (!signRes.ok) {
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say language="es-MX">Nuestro asistente no está disponible.</Say><Hangup/></Response>`);
      return;
    }

    const { signed_url } = await signRes.json() as any;
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${signed_url}">
      <Parameter name="callId" value="${call.id}" />
    </Stream>
  </Connect>
</Response>`);

    log(`📞 Inbound: ${From} → agente (${call.id})`);
  } catch (e: any) {
    log(`❌ Inbound error: ${e.message}`);
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say language="es-MX">Error interno.</Say><Hangup/></Response>`);
  }
});

// 📞 ElevenLabs conversation webhook (transcript)
callsPublicRouter.post('/elevenlabs-webhook', async (req: Request, res: Response) => {
  try {
    const { conversation_id, transcript, metadata } = req.body;
    const callId = metadata?.callId;
    if (callId && transcript) {
      await prisma.call.update({
        where: { id: callId },
        data: { transcript: JSON.stringify(transcript), elevenLabsConversationId: conversation_id }
      }).catch(() => {});
      log(`📝 Transcript: ${callId}`);
    }
    res.status(200).json({ ok: true });
  } catch { res.status(200).json({ ok: true }); }
});

// ====================================================
// 📞 CRON: Auto-llamadas de recordatorio
// ====================================================
export const startCallReminderCron = () => {
  const checkReminders = async () => {
    try {
      const configs = await prisma.callConfig.findMany({
        where: { callsEnabled: true, autoCallReminders: true }
      });

      for (const config of configs) {
        if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioPhoneNumber || !config.elevenLabsAgentId) continue;

        const hoursAhead = config.reminderHoursBefore || 24;
        const now = new Date();
        const target = new Date(now.getTime() + hoursAhead * 3600000);
        const windowStart = new Date(target.getTime() - 1800000);
        const windowEnd = new Date(target.getTime() + 1800000);

        const appointments = await prisma.appointment.findMany({
          where: { userId: config.userId, date: { gte: windowStart, lte: windowEnd }, status: { in: ['pending', 'confirmed'] } },
          select: { id: true, clientName: true, clientPhone: true, date: true, time: true, type: true }
        });

        for (const apt of appointments) {
          if (!apt.clientPhone) continue;
          const existing = await prisma.call.findFirst({ where: { userId: config.userId, type: 'reminder', context: { contains: apt.id } } });
          if (existing) continue;

          try {
            const phoneE164 = apt.clientPhone.startsWith('+') ? apt.clientPhone : `+${apt.clientPhone.replace(/\D/g, '')}`;
            const twilioAuth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
            const call = await prisma.call.create({
              data: {
                userId: config.userId, direction: 'outbound', type: 'reminder',
                phoneNumber: phoneE164, clientName: apt.clientName, status: 'initiating',
                agentId: config.elevenLabsAgentId,
                context: JSON.stringify({ appointmentId: apt.id, clientName: apt.clientName, date: apt.date, time: apt.time, type: apt.type })
              }
            });

            await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Calls.json`, {
              method: 'POST',
              headers: { 'Authorization': `Basic ${twilioAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                To: phoneE164, From: config.twilioPhoneNumber,
                Url: `${BACKEND_URL}/api/calls/twilio-webhook?callId=${call.id}`,
                StatusCallback: `${BACKEND_URL}/api/calls/twilio-status?callId=${call.id}`,
                StatusCallbackEvent: 'initiated ringing answered completed'
              }).toString()
            });

            log(`📞 Auto-reminder: ${apt.clientName} (${phoneE164})`);
          } catch (err: any) { log(`⚠️ Reminder error: ${err.message}`); }
        }
      }
    } catch (e: any) { log(`⚠️ Cron error: ${e.message}`); }
  };

  setInterval(checkReminders, 15 * 60 * 1000);
  setTimeout(checkReminders, 60_000);
  console.log('   📞 Call reminders cron: every 15min');
};

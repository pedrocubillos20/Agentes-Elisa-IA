<<<<<<< HEAD
// ============================================
// calls.routes.ts - Sistema de Llamadas IA con Retell AI
// BizonneCRM
// ============================================

import { Router } from 'express';
import prisma from '../lib/prisma';
import crypto from 'crypto';

const router = Router();

// ============================================
// RETELL API HELPER
// ============================================
const RETELL_API = 'https://api.retellai.com';
const RETELL_KEY = process.env.RETELL_API_KEY || '';

async function retellFetch(endpoint: string, method: string = 'GET', body?: any) {
  const opts: any = {
    method,
    headers: {
      'Authorization': `Bearer ${RETELL_KEY}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  
  const res = await fetch(`${RETELL_API}${endpoint}`, opts);
  const data = await res.json().catch(() => null);
  
  if (!res.ok) {
    console.error(`❌ Retell API error [${method} ${endpoint}]:`, data);
    throw new Error(data?.message || data?.error || `Retell API error ${res.status}`);
  }
  return data;
}

// ============================================
// 1. GET /config - Obtener configuración
// ============================================
router.get('/config', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    
    let config = await prisma.callConfig.findUnique({ where: { userId } });
    
    if (!config) {
      config = await prisma.callConfig.create({
        data: {
          id: crypto.randomUUID(),
          userId,
          agentName: 'Asistente',
          agentLanguage: 'es',
          voiceId: '11labs-Adrian',
        }
      });
    }
    
    res.json({ ...config, hasRetellKey: !!RETELL_KEY });
  } catch (e: any) {
    console.error('Error obteniendo config:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 2. PUT /config - Actualizar configuración
// ============================================
router.put('/config', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const {
      voiceId, voiceProvider, voiceModel, voiceSpeed, voiceTemperature,
      agentName, agentLanguage, agentGreeting, agentPrompt,
      enableAutoReminders, reminderHoursBefore, maxCallDuration,
      enableBackchannel,
    } = req.body;
    
    let config = await prisma.callConfig.findUnique({ where: { userId } });
    if (!config) return res.status(404).json({ error: 'Configuración no encontrada' });
    
    config = await prisma.callConfig.update({
      where: { userId },
      data: {
        ...(voiceId !== undefined && { voiceId }),
        ...(voiceProvider !== undefined && { voiceProvider }),
        ...(voiceModel !== undefined && { voiceModel }),
        ...(voiceSpeed !== undefined && { voiceSpeed: parseFloat(voiceSpeed) }),
        ...(voiceTemperature !== undefined && { voiceTemperature: parseFloat(voiceTemperature) }),
        ...(agentName !== undefined && { agentName }),
        ...(agentLanguage !== undefined && { agentLanguage }),
        ...(agentGreeting !== undefined && { agentGreeting }),
        ...(agentPrompt !== undefined && { agentPrompt }),
        ...(enableAutoReminders !== undefined && { enableAutoReminders }),
        ...(reminderHoursBefore !== undefined && { reminderHoursBefore }),
        ...(maxCallDuration !== undefined && { maxCallDuration }),
        ...(enableBackchannel !== undefined && { enableBackchannel }),
      }
    });
    
    // Sync con Retell si ya tiene agente
    if (config.retellAgentId) {
      try {
        await retellFetch(`/update-agent/${config.retellAgentId}`, 'PATCH', {
          agent_name: config.agentName,
          voice_id: config.voiceId,
          voice_model: config.voiceModel || 'eleven_turbo_v2',
          voice_speed: config.voiceSpeed,
          voice_temperature: config.voiceTemperature,
          language: config.agentLanguage === 'es' ? 'es-ES' : config.agentLanguage,
          enable_backchannel: config.enableBackchannel,
          max_call_duration_ms: config.maxCallDuration,
          ...(config.agentGreeting && { begin_message: config.agentGreeting }),
        });
      } catch (err: any) {
        console.warn('⚠️ No se pudo sincronizar agente en Retell:', err.message);
      }
    }
    
    res.json(config);
  } catch (e: any) {
    console.error('Error actualizando config:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 3. POST /activate - Activar línea IA
// ============================================
router.post('/activate', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    
    if (!RETELL_KEY) return res.status(400).json({ error: 'Retell API key no configurada en el servidor' });
    
    let config = await prisma.callConfig.findUnique({ where: { userId } });
    if (!config) {
      config = await prisma.callConfig.create({ data: { id: crypto.randomUUID(), userId } });
    }
    if (config.isActive && config.retellAgentId && config.retellPhoneNumber) {
      return res.json({ message: 'Línea ya activa', config });
    }
    
    // Info del asistente y negocio
    const assistant = await prisma.assistant.findFirst({
      where: { userId },
      select: { name: true, context: true, personality: true, businessInfo: true, instructions: true }
    });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, businessName: true }
    });
    const businessName = user?.businessName || user?.name || 'Negocio';
    const systemPrompt = buildAgentPrompt(config, assistant, businessName);
    
    // Webhook URL
    const baseUrl = process.env.API_URL
      || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3001');
    
    // PASO 1: Crear LLM
    console.log('📝 Creando LLM en Retell...');
    const llm = await retellFetch('/create-retell-llm', 'POST', {
      general_prompt: systemPrompt,
      begin_message: config.agentGreeting || `Hola, gracias por comunicarse con ${businessName}. ¿En qué puedo ayudarle?`,
      general_tools: [
        { type: 'end_call', name: 'end_call', description: 'Terminar la llamada cuando el cliente se despide' }
      ],
      model: 'gpt-4o-mini',
    });
    
    // PASO 2: Crear Agente
    console.log('🤖 Creando Agente en Retell...');
    const agent = await retellFetch('/create-agent', 'POST', {
      response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
      agent_name: `${businessName} - ${config.agentName}`,
      voice_id: config.voiceId || '11labs-Adrian',
      voice_model: config.voiceModel || 'eleven_turbo_v2',
      voice_speed: config.voiceSpeed || 1,
      voice_temperature: config.voiceTemperature || 1,
      language: config.agentLanguage === 'es' ? 'es-ES' : config.agentLanguage,
      enable_backchannel: config.enableBackchannel,
      backchannel_frequency: 0.8,
      backchannel_words: ['sí', 'ajá', 'claro', 'entiendo'],
      responsiveness: 0.8,
      interruption_sensitivity: 0.7,
      max_call_duration_ms: config.maxCallDuration || 300000,
      ambient_sound: 'office',
      ambient_sound_volume: 0.3,
      webhook_url: `${baseUrl}/api/webhook/retell`,
      normalize_for_speech: true,
      post_call_analysis_data: [
        { type: 'string', key: 'call_summary', description: 'Resumen breve de la llamada en español' },
        { type: 'enum', key: 'sentiment', description: 'Sentimiento del cliente', choices: ['positive', 'neutral', 'negative'] },
      ],
    });
    
    // PASO 3: Comprar número
    console.log('📞 Comprando número en Retell...');
    let phoneData: any = null;
    try {
      phoneData = await retellFetch('/create-phone-number', 'POST', {
        inbound_agent_id: agent.agent_id,
        outbound_agent_id: agent.agent_id,
      });
      console.log(`✅ Número comprado: ${phoneData.phone_number}`);
    } catch (phoneErr: any) {
      console.warn('⚠️ No se pudo comprar número:', phoneErr.message);
    }
    
    // PASO 4: Guardar en DB
    config = await prisma.callConfig.update({
      where: { userId },
      data: {
        retellAgentId: agent.agent_id,
        retellLlmId: llm.llm_id,
        retellPhoneNumber: phoneData?.phone_number || null,
        retellPhoneNumberId: phoneData?.phone_number || null,
        isActive: true,
        activatedAt: new Date(),
      }
    });
    
    console.log(`✅ Línea IA activada | Agent: ${agent.agent_id} | Phone: ${phoneData?.phone_number || 'N/A'}`);
    
    res.json({ success: true, config, phone: phoneData?.phone_number || null });
  } catch (e: any) {
    console.error('❌ Error activando línea:', e.message);
    res.status(500).json({ error: `Error activando: ${e.message}` });
  }
});

// ============================================
// 4. POST /deactivate - Desactivar línea
// ============================================
router.post('/deactivate', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const config = await prisma.callConfig.findUnique({ where: { userId } });
    if (!config) return res.status(404).json({ error: 'No hay configuración' });
    
    // Limpiar en Retell
    if (config.retellPhoneNumber) {
      try { await retellFetch(`/delete-phone-number/${config.retellPhoneNumber}`, 'DELETE'); } catch {}
    }
    if (config.retellAgentId) {
      try { await retellFetch(`/delete-agent/${config.retellAgentId}`, 'DELETE'); } catch {}
    }
    if (config.retellLlmId) {
      try { await retellFetch(`/delete-retell-llm/${config.retellLlmId}`, 'DELETE'); } catch {}
    }
    
    await prisma.callConfig.update({
      where: { userId },
      data: { retellAgentId: null, retellLlmId: null, retellPhoneNumber: null, retellPhoneNumberId: null, isActive: false }
    });
    
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 5. GET /voices - Listar voces
// ============================================
router.get('/voices', async (req: any, res) => {
  try {
    if (!RETELL_KEY) return res.json(getDefaultVoices());
    
    const voices = await retellFetch('/list-voices');
    const mapped = voices.map((v: any) => ({
      voice_id: v.voice_id,
      voice_name: v.voice_name,
      provider: v.provider,
      gender: v.gender,
      accent: v.accent || 'General',
      age: v.age || 'Adult',
      preview_audio_url: v.preview_audio_url,
    }));
    
    res.json(mapped);
  } catch (e: any) {
    res.json(getDefaultVoices());
  }
});

// ============================================
// 6. POST /call - Iniciar llamada
// ============================================
router.post('/call', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { toNumber, toName, clientId, appointmentId, callType = 'manual' } = req.body;
    
    if (!toNumber) return res.status(400).json({ error: 'Número requerido' });
    
    const config = await prisma.callConfig.findUnique({ where: { userId } });
    if (!config?.isActive || !config.retellAgentId) return res.status(400).json({ error: 'Línea no activada' });
    if (!config.retellPhoneNumber) return res.status(400).json({ error: 'No hay número asignado' });
    
    const formattedNumber = formatE164(toNumber);
    
    // Info contextual
    let clientName = toName;
    let contextParts: string[] = [];
    
    if (clientId) {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: { name: true, email: true, notes: true }
      });
      if (client) {
        clientName = clientName || client.name;
        contextParts.push(`Cliente: ${client.name}${client.email ? ` | Email: ${client.email}` : ''}${client.notes ? ` | Notas: ${client.notes}` : ''}`);
      }
    }
    
    if (appointmentId) {
      const apt = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: { type: true, date: true, time: true, notes: true }
      });
      if (apt) {
        const dateStr = new Date(apt.date).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
        contextParts.push(`Cita: ${apt.type} el ${dateStr} a las ${apt.time}${apt.notes ? `. ${apt.notes}` : ''}`);
      }
    }
    
    const retellCall = await retellFetch('/v2/create-phone-call', 'POST', {
      from_number: config.retellPhoneNumber,
      to_number: formattedNumber,
      override_agent_id: config.retellAgentId,
      metadata: { bizonne_user_id: userId, client_id: clientId, appointment_id: appointmentId, call_type: callType },
      ...(contextParts.length > 0 && {
        retell_llm_dynamic_variables: { client_context: contextParts.join('\n') }
      }),
    });
    
    const call = await prisma.call.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        callConfigId: config.id,
        retellCallId: retellCall.call_id,
        retellCallStatus: retellCall.call_status || 'registered',
        direction: 'outbound',
        fromNumber: config.retellPhoneNumber,
        toNumber: formattedNumber,
        toName: clientName || null,
        clientId: clientId || null,
        appointmentId: appointmentId || null,
        status: 'initiated',
        callType,
        startedAt: new Date(),
      }
    });
    
    console.log(`📞 Llamada: ${call.id} → ${formattedNumber} (Retell: ${retellCall.call_id})`);
    res.json({ success: true, call: { id: call.id, retellCallId: retellCall.call_id, status: 'initiated', toNumber: formattedNumber, toName: clientName } });
  } catch (e: any) {
    console.error('❌ Error llamada:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 7. GET /call/:id - Detalle de llamada
// ============================================
router.get('/call/:id', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const call = await prisma.call.findFirst({ where: { id: req.params.id, userId } });
    if (!call) return res.status(404).json({ error: 'No encontrada' });
    
    // Sync con Retell si en curso
    if (call.retellCallId && ['initiated', 'in_progress'].includes(call.status)) {
      try {
        const rd = await retellFetch(`/v2/get-call/${call.retellCallId}`);
        const newStatus = mapRetellStatus(rd.call_status);
        if (newStatus !== call.status) {
          await prisma.call.update({
            where: { id: call.id },
            data: {
              status: newStatus,
              retellCallStatus: rd.call_status,
              duration: rd.duration_ms ? Math.round(rd.duration_ms / 1000) : null,
              transcript: rd.transcript || null,
              transcriptObject: rd.transcript_object || undefined,
              recordingUrl: rd.recording_url || null,
              endReason: rd.disconnection_reason || null,
              endedAt: rd.end_timestamp ? new Date(rd.end_timestamp) : null,
            }
          });
          return res.json({ ...call, status: newStatus, duration: rd.duration_ms ? Math.round(rd.duration_ms / 1000) : call.duration, transcript: rd.transcript || call.transcript, recordingUrl: rd.recording_url || call.recordingUrl });
        }
      } catch {}
    }
    
    res.json(call);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 8. GET /history - Historial
// ============================================
router.get('/history', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const status = req.query.status as string;
    const search = req.query.search as string;
    
    const where: any = { userId };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { toName: { contains: search } },
        { toNumber: { contains: search } },
        { transcript: { contains: search } },
      ];
    }
    
    const [calls, total] = await Promise.all([
      prisma.call.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.call.count({ where }),
    ]);
    
    res.json({ calls, total, page, totalPages: Math.ceil(total / limit) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 9. GET /stats - Estadísticas
// ============================================
router.get('/stats', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    
    const [totalCalls, monthCalls, completedCalls, totalMinutes] = await Promise.all([
      prisma.call.count({ where: { userId } }),
      prisma.call.count({ where: { userId, createdAt: { gte: startOfMonth } } }),
      prisma.call.count({ where: { userId, status: 'completed' } }),
      prisma.call.aggregate({ where: { userId, duration: { not: null } }, _sum: { duration: true } }),
    ]);
    
    const config = await prisma.callConfig.findUnique({
      where: { userId },
      select: { minutesUsed: true, minutesLimit: true, isActive: true, retellPhoneNumber: true }
    });
    
    res.json({
      totalCalls, monthCalls, completedCalls,
      totalMinutes: Math.round((totalMinutes._sum.duration || 0) / 60 * 10) / 10,
      minutesUsed: config?.minutesUsed || 0,
      isActive: config?.isActive || false,
      phoneNumber: config?.retellPhoneNumber || null,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
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
    const callData = event.call;
    
    const call = await prisma.call.findFirst({ where: { retellCallId } });
    
    if (!call) {
      // Inbound nueva
      if (event.event === 'call_started' && callData.direction === 'inbound') {
        const config = await prisma.callConfig.findFirst({ where: { retellPhoneNumber: callData.to_number } });
        if (config) {
          await prisma.call.create({
            data: {
              id: crypto.randomUUID(), userId: config.userId, callConfigId: config.id,
              retellCallId: callData.call_id, retellCallStatus: 'ongoing',
              direction: 'inbound', fromNumber: callData.from_number, toNumber: callData.to_number,
              status: 'in_progress', callType: 'inbound', startedAt: new Date(),
            }
          });
        }
      }
      return res.status(200).json({ ok: true });
    }
    
    switch (event.event) {
      case 'call_started':
        await prisma.call.update({ where: { id: call.id }, data: { status: 'in_progress', retellCallStatus: 'ongoing', startedAt: new Date() } });
        break;
        
      case 'call_ended': {
        const durationSec = callData.duration_ms ? Math.round(callData.duration_ms / 1000) : null;
        const durationMin = durationSec ? durationSec / 60 : 0;
        const costUsd = durationMin * 0.145;
        
        await prisma.call.update({
          where: { id: call.id },
          data: {
            status: 'completed', retellCallStatus: callData.call_status || 'ended',
            duration: durationSec, costUsd: Math.round(costUsd * 1000) / 1000,
            transcript: callData.transcript || null, transcriptObject: callData.transcript_object || undefined,
            recordingUrl: callData.recording_url || null, endReason: callData.disconnection_reason || null,
            endedAt: new Date(),
            summary: callData.call_analysis?.call_summary || null,
            sentiment: callData.call_analysis?.sentiment || null,
          }
        });
        
        if (durationMin > 0) {
          await prisma.callConfig.update({ where: { id: call.callConfigId }, data: { minutesUsed: { increment: durationMin } } });
        }
        console.log(`✅ Llamada completada: ${call.id} | ${durationSec}s | $${costUsd.toFixed(3)}`);
        break;
      }
      
      case 'call_analyzed':
        if (callData.call_analysis) {
          await prisma.call.update({
            where: { id: call.id },
            data: { summary: callData.call_analysis.call_summary || null, sentiment: callData.call_analysis.sentiment || null }
          });
        }
        break;
    }
    
    res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('❌ Webhook error:', e.message);
    res.status(200).json({ ok: true });
  }
}

// ============================================
// 11. CRON - Auto recordatorios
// ============================================
let reminderInterval: NodeJS.Timeout | null = null;

export function startCallReminderCron() {
  if (reminderInterval) clearInterval(reminderInterval);
  
  reminderInterval = setInterval(async () => {
    try {
      const configs = await prisma.callConfig.findMany({
        where: { isActive: true, enableAutoReminders: true, retellPhoneNumber: { not: null } },
        select: { userId: true, reminderHoursBefore: true, retellAgentId: true, retellPhoneNumber: true, id: true }
      });
      
      if (!configs.length) return;
      const now = new Date();
      
      for (const config of configs) {
        if (!config.retellAgentId || !config.retellPhoneNumber) continue;
        
        const targetTime = new Date(now.getTime() + config.reminderHoursBefore * 3600000);
        const windowStart = new Date(targetTime.getTime() - 900000); // 15min window
        
        const appointments = await prisma.appointment.findMany({
          where: {
            userId: config.userId,
            date: { gte: windowStart, lte: targetTime },
            status: { in: ['pending', 'confirmed'] },
            clientPhone: { not: null },
          }
        });
        
        for (const apt of appointments) {
          const exists = await prisma.call.findFirst({
            where: { userId: config.userId, appointmentId: apt.id, callType: 'auto_reminder', createdAt: { gte: new Date(now.getTime() - 86400000) } }
          });
          if (exists || !apt.clientPhone) continue;
          
          try {
            const phone = formatE164(apt.clientPhone);
            const dateStr = new Date(apt.date).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
            
            const rc = await retellFetch('/v2/create-phone-call', 'POST', {
              from_number: config.retellPhoneNumber,
              to_number: phone,
              override_agent_id: config.retellAgentId,
              metadata: { bizonne_user_id: config.userId, appointment_id: apt.id, call_type: 'auto_reminder' },
              retell_llm_dynamic_variables: {
                client_context: `RECORDATORIO DE CITA.\nCliente: ${apt.clientName}\nCita: ${apt.type} el ${dateStr} a las ${apt.time}`
              }
            });
            
            await prisma.call.create({
              data: {
                id: crypto.randomUUID(), userId: config.userId, callConfigId: config.id,
                retellCallId: rc.call_id, direction: 'outbound', fromNumber: config.retellPhoneNumber,
                toNumber: phone, toName: apt.clientName, clientId: apt.clientId,
                appointmentId: apt.id, status: 'initiated', callType: 'auto_reminder', startedAt: new Date(),
              }
            });
            console.log(`⏰ Recordatorio: ${apt.clientName} → ${apt.type} ${apt.time}`);
          } catch (err: any) {
            console.error(`❌ Recordatorio error cita ${apt.id}:`, err.message);
          }
        }
      }
    } catch (e: any) {
      console.error('Cron error:', e.message);
    }
  }, 900000); // 15 min
  
  console.log('⏰ Cron recordatorios llamadas iniciado');
}

// ============================================
// HELPERS
// ============================================

function buildAgentPrompt(config: any, assistant: any, businessName: string): string {
  return `Eres ${config.agentName}, asistente virtual de ${businessName}.
Atiendes llamadas telefónicas de manera profesional y amable en español.

${config.agentPrompt ? `INSTRUCCIONES:\n${config.agentPrompt}\n` : ''}
${assistant?.businessInfo ? `NEGOCIO:\n${assistant.businessInfo}\n` : ''}
${assistant?.context ? `CONTEXTO:\n${assistant.context}\n` : ''}
${assistant?.personality ? `PERSONALIDAD:\n${assistant.personality}\n` : ''}
${assistant?.instructions ? `REGLAS ADICIONALES:\n${assistant.instructions}\n` : ''}

REGLAS GENERALES:
- Habla siempre en español natural y fluido
- Respuestas cortas (2-3 oraciones por turno)
- Si no sabes algo, ofrece tomar mensaje para que el dueño se comunique
- No inventes precios ni disponibilidad
- Para citas: toma nombre, teléfono, servicio, fecha/hora preferida
- Despídete amablemente cuando terminen

{{client_context}}`;
}

function formatE164(phone: string): string {
  let c = phone.replace(/[\s\-\(\)\.]/g, '');
  if (!c.startsWith('+')) {
    if (c.startsWith('57') && c.length >= 12) c = '+' + c;
    else if (c.length === 10) c = '+57' + c;
    else c = '+' + c;
  }
  return c;
}

function mapRetellStatus(s: string): string {
  return ({ registered: 'initiated', ongoing: 'in_progress', ended: 'completed', error: 'failed' } as any)[s] || s;
}

function getDefaultVoices() {
  return [
    { voice_id: '11labs-Adrian', voice_name: 'Adrian', provider: 'elevenlabs', gender: 'male', accent: 'American', age: 'Young', preview_audio_url: null },
    { voice_id: '11labs-Myra', voice_name: 'Myra', provider: 'elevenlabs', gender: 'female', accent: 'American', age: 'Young', preview_audio_url: null },
    { voice_id: '11labs-Chris', voice_name: 'Chris', provider: 'elevenlabs', gender: 'male', accent: 'American', age: 'Middle Aged', preview_audio_url: null },
    { voice_id: '11labs-Paola', voice_name: 'Paola', provider: 'elevenlabs', gender: 'female', accent: 'American', age: 'Young', preview_audio_url: null },
    { voice_id: '11labs-Valentino', voice_name: 'Valentino', provider: 'elevenlabs', gender: 'male', accent: 'American', age: 'Middle Aged', preview_audio_url: null },
    { voice_id: '11labs-Marissa', voice_name: 'Marissa', provider: 'elevenlabs', gender: 'female', accent: 'American', age: 'Young', preview_audio_url: null },
    { voice_id: 'openai-Alloy', voice_name: 'Alloy', provider: 'openai', gender: 'female', accent: 'Neutral', age: 'Young', preview_audio_url: null },
    { voice_id: 'openai-Echo', voice_name: 'Echo', provider: 'openai', gender: 'male', accent: 'Neutral', age: 'Middle Aged', preview_audio_url: null },
    { voice_id: 'openai-Shimmer', voice_name: 'Shimmer', provider: 'openai', gender: 'female', accent: 'Neutral', age: 'Young', preview_audio_url: null },
    { voice_id: 'openai-Nova', voice_name: 'Nova', provider: 'openai', gender: 'female', accent: 'Neutral', age: 'Young', preview_audio_url: null },
    { voice_id: 'deepgram-Angus', voice_name: 'Angus', provider: 'deepgram', gender: 'male', accent: 'Irish', age: 'Middle Aged', preview_audio_url: null },
    { voice_id: 'deepgram-Athena', voice_name: 'Athena', provider: 'deepgram', gender: 'female', accent: 'British', age: 'Young', preview_audio_url: null },
  ];
}

export default router;
=======
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
>>>>>>> ce20e1575e5027dcb338cc860a7784291f7c620e

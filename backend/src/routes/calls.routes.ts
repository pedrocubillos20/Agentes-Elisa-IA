// ============================================
// calls.routes.ts - Sistema de Llamadas IA con Retell AI
// BizonneCRM
// ============================================

import { Router } from 'express';
import prisma from '../lib/prisma';
import crypto from 'crypto';

const router = Router();

// Prisma models CallConfig y Call son nuevos — usar "as any" para evitar errores TS
const db = prisma as any;

// ============================================
// RETELL API HELPER
// ============================================
const RETELL_API = 'https://api.retellai.com';
const RETELL_KEY = process.env.RETELL_API_KEY || '';

async function retellFetch(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
  const opts: any = {
    method,
    headers: {
      'Authorization': `Bearer ${RETELL_KEY}`,
      'Content-Type': 'application/json',
    },
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
// 1. GET /config - Obtener configuración
// ============================================
router.get('/config', async (req: any, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    
    let config = await db.callConfig.findUnique({ where: { userId } });
    
    if (!config) {
      config = await db.callConfig.create({
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
    
    let config = await db.callConfig.findUnique({ where: { userId } });
    if (!config) return res.status(404).json({ error: 'Configuración no encontrada' });
    
    config = await db.callConfig.update({
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
    
    let config = await db.callConfig.findUnique({ where: { userId } });
    if (!config) {
      config = await db.callConfig.create({ data: { id: crypto.randomUUID(), userId } });
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
      select: { name: true }
    });
    const businessName = user?.name || 'Negocio';
    const systemPrompt = buildAgentPrompt(config, assistant, businessName);
    
    // Webhook URL
    const baseUrl = process.env.API_URL
      || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3001');
    
    // PASO 1: Crear LLM
    console.log('📝 Creando LLM en Retell...');
    const llm: any = await retellFetch('/create-retell-llm', 'POST', {
      general_prompt: systemPrompt,
      begin_message: config.agentGreeting || `Hola, gracias por comunicarse con ${businessName}. ¿En qué puedo ayudarle?`,
      general_tools: [
        { type: 'end_call', name: 'end_call', description: 'Terminar la llamada cuando el cliente se despide' }
      ],
      model: 'gpt-4o-mini',
    });
    
    // PASO 2: Crear Agente
    console.log('🤖 Creando Agente en Retell...');
    const agent: any = await retellFetch('/create-agent', 'POST', {
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
      ambient_sound: 'call-center',
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
    config = await db.callConfig.update({
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
    const config = await db.callConfig.findUnique({ where: { userId } });
    if (!config) return res.status(404).json({ error: 'No hay configuración' });
    
    if (config.retellPhoneNumber) {
      try { await retellFetch(`/delete-phone-number/${config.retellPhoneNumber}`, 'DELETE'); } catch {}
    }
    if (config.retellAgentId) {
      try { await retellFetch(`/delete-agent/${config.retellAgentId}`, 'DELETE'); } catch {}
    }
    if (config.retellLlmId) {
      try { await retellFetch(`/delete-retell-llm/${config.retellLlmId}`, 'DELETE'); } catch {}
    }
    
    await db.callConfig.update({
      where: { userId },
      data: { retellAgentId: null, retellLlmId: null, retellPhoneNumber: null, retellPhoneNumberId: null, isActive: false }
    });
    
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 5. GET /voices - Listar voces (español primero)
// ============================================
router.get('/voices', async (req: any, res) => {
  try {
    if (!RETELL_KEY) return res.json(getDefaultVoices());
    
    const voices: any = await retellFetch('/list-voices');
    const spanishAccents = ['mexican', 'spanish', 'latin america', 'latin american', 'colombian', 'argentinian', 'chilean', 'peruvian', 'hispanic'];
    
    const mapped = (Array.isArray(voices) ? voices : []).map((v: any) => {
      const accent = (v.accent || '').toLowerCase();
      const isSpanish = spanishAccents.some((sa: string) => accent.includes(sa));
      return {
        voice_id: v.voice_id,
        voice_name: v.voice_name,
        provider: v.provider,
        gender: v.gender,
        accent: v.accent || 'General',
        age: v.age || 'Adult',
        preview_audio_url: v.preview_audio_url,
        isSpanish,
      };
    });
    
    // Español primero, luego el resto por nombre
    mapped.sort((a: any, b: any) => {
      if (a.isSpanish && !b.isSpanish) return -1;
      if (!a.isSpanish && b.isSpanish) return 1;
      return a.voice_name.localeCompare(b.voice_name);
    });
    
    // ?lang=es filtra solo español
    const filter = req.query.lang as string;
    if (filter === 'es') return res.json(mapped.filter((v: any) => v.isSpanish));
    
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
    
    const config = await db.callConfig.findUnique({ where: { userId } });
    if (!config?.isActive || !config.retellAgentId) return res.status(400).json({ error: 'Línea no activada' });
    if (!config.retellPhoneNumber) return res.status(400).json({ error: 'No hay número asignado' });
    
    const formattedNumber = formatE164(toNumber);
    
    let clientName = toName;
    const contextParts: string[] = [];
    
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
    
    const retellCall: any = await retellFetch('/v2/create-phone-call', 'POST', {
      from_number: config.retellPhoneNumber,
      to_number: formattedNumber,
      override_agent_id: config.retellAgentId,
      metadata: { bizonne_user_id: userId, client_id: clientId, appointment_id: appointmentId, call_type: callType },
      ...(contextParts.length > 0 && {
        retell_llm_dynamic_variables: { client_context: contextParts.join('\n') }
      }),
    });
    
    const call = await db.call.create({
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
    const call = await db.call.findFirst({ where: { id: req.params.id, userId } });
    if (!call) return res.status(404).json({ error: 'No encontrada' });
    
    if (call.retellCallId && ['initiated', 'in_progress'].includes(call.status)) {
      try {
        const rd: any = await retellFetch(`/v2/get-call/${call.retellCallId}`);
        const newStatus = mapRetellStatus(rd.call_status);
        if (newStatus !== call.status) {
          await db.call.update({
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
      db.call.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      db.call.count({ where }),
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
      db.call.count({ where: { userId } }),
      db.call.count({ where: { userId, createdAt: { gte: startOfMonth } } }),
      db.call.count({ where: { userId, status: 'completed' } }),
      db.call.aggregate({ where: { userId, duration: { not: null } }, _sum: { duration: true } }),
    ]);
    
    const config = await db.callConfig.findUnique({
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
    
    const call = await db.call.findFirst({ where: { retellCallId } });
    
    if (!call) {
      if (event.event === 'call_started' && callData.direction === 'inbound') {
        const config = await db.callConfig.findFirst({ where: { retellPhoneNumber: callData.to_number } });
        if (config) {
          await db.call.create({
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
        await db.call.update({ where: { id: call.id }, data: { status: 'in_progress', retellCallStatus: 'ongoing', startedAt: new Date() } });
        break;
        
      case 'call_ended': {
        const durationSec = callData.duration_ms ? Math.round(callData.duration_ms / 1000) : null;
        const durationMin = durationSec ? durationSec / 60 : 0;
        const costUsd = durationMin * 0.145;
        
        await db.call.update({
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
          await db.callConfig.update({ where: { id: call.callConfigId }, data: { minutesUsed: { increment: durationMin } } });
        }
        console.log(`✅ Llamada completada: ${call.id} | ${durationSec}s | $${costUsd.toFixed(3)}`);
        break;
      }
      
      case 'call_analyzed':
        if (callData.call_analysis) {
          await db.call.update({
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
      const configs = await db.callConfig.findMany({
        where: { isActive: true, enableAutoReminders: true, retellPhoneNumber: { not: null } },
        select: { userId: true, reminderHoursBefore: true, retellAgentId: true, retellPhoneNumber: true, id: true }
      });
      
      if (!configs.length) return;
      const now = new Date();
      
      for (const config of configs) {
        if (!config.retellAgentId || !config.retellPhoneNumber) continue;
        
        const targetTime = new Date(now.getTime() + config.reminderHoursBefore * 3600000);
        const windowStart = new Date(targetTime.getTime() - 900000);
        
        const appointments = await prisma.appointment.findMany({
          where: {
            userId: config.userId,
            date: { gte: windowStart, lte: targetTime },
            status: { in: ['pending', 'confirmed'] },
            clientPhone: { not: null },
          }
        });
        
        for (const apt of appointments) {
          const exists = await db.call.findFirst({
            where: { userId: config.userId, appointmentId: apt.id, callType: 'auto_reminder', createdAt: { gte: new Date(now.getTime() - 86400000) } }
          });
          if (exists || !apt.clientPhone) continue;
          
          try {
            const phone = formatE164(apt.clientPhone);
            const dateStr = new Date(apt.date).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
            
            const rc: any = await retellFetch('/v2/create-phone-call', 'POST', {
              from_number: config.retellPhoneNumber,
              to_number: phone,
              override_agent_id: config.retellAgentId,
              metadata: { bizonne_user_id: config.userId, appointment_id: apt.id, call_type: 'auto_reminder' },
              retell_llm_dynamic_variables: {
                client_context: `RECORDATORIO DE CITA.\nCliente: ${apt.clientName}\nCita: ${apt.type} el ${dateStr} a las ${apt.time}`
              }
            });
            
            await db.call.create({
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
  }, 900000);
  
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

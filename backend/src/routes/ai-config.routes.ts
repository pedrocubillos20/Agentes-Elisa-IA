import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getOwnerId } from '../lib/helpers';
import { AuthRequest } from '../middleware/auth.middleware';
import multer from 'multer';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// pdf-parse: import the actual parser directly (bypasses test file issue)
let pdfParseFn: any = null;
try {
  pdfParseFn = require('pdf-parse/lib/pdf-parse.js');
} catch {
  try { pdfParseFn = require('pdf-parse'); } catch {}
}
if (pdfParseFn && typeof pdfParseFn !== 'function' && pdfParseFn.default) {
  pdfParseFn = pdfParseFn.default;
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ====================================================
// 🤖 AI CONFIG v2.0 — Genera base de conocimiento desde PDF
// Genera prompts OPTIMIZADOS para la plataforma BizonneCRM:
// - Pipeline CRM con etapas auto-detectadas
// - Triggers multimedia integrados
// - Acciones automáticas (crear_pedido, crear_cita, crear_reserva)
// - Bloque MEMORY_JSON para memoria persistente
// - Flujo conversacional paso a paso
// ====================================================

// ✅ STATUS — Verificar acceso
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const hasPurchased = await prisma.payment.findFirst({
      where: { userId: ownerId, plan: 'ai_config', status: 'approved' }
    });
    const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { plan: true } });
    const hasAccess = !!hasPurchased;

    res.json({ hasAccess, purchased: !!hasPurchased, plan: user?.plan });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 🧠 GENERATE — Subir PDF + generar base de conocimiento
router.post('/generate', upload.single('pdf'), async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    // Verify access
    const hasPurchased = await prisma.payment.findFirst({
      where: { userId: ownerId, plan: 'ai_config', status: 'approved' }
    });
    const user = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { plan: true, apiKey: true, apiKeyConnected: true }
    });
    if (!hasPurchased) {
      res.status(403).json({ error: 'Necesitas comprar el addon "Configuración IA" para usar esta función.' });
      return;
    }
    if (!user?.apiKey || !user.apiKeyConnected) {
      res.status(400).json({ error: 'Necesitas conectar tu API Key de OpenAI primero (Configuración → API Key).' });
      return;
    }

    const { assistantId, format, businessName, businessType, lineId } = req.body;
    const outputFormat = format || 'markdown';

    // Find or auto-detect assistant
    let assistant: any = null;
    if (assistantId) {
      assistant = await prisma.assistant.findFirst({ where: { id: assistantId, userId: ownerId } });
    }
    if (!assistant && lineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, whatsappLineId: lineId } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true } });
    }

    // Extract PDF text
    let pdfText = '';
    if (req.file) {
      try {
        // Method 1: pdf-parse library
        if (pdfParseFn && typeof pdfParseFn === 'function') {
          try {
            const data = await pdfParseFn(req.file.buffer);
            pdfText = data.text || '';
            console.log(`📄 PDF extraído (pdf-parse): ${pdfText.length} chars`);
          } catch (e1: any) {
            console.log(`⚠️ pdf-parse falló: ${e1.message}, intentando pdftotext...`);
          }
        }

        // Method 2: pdftotext fallback (if poppler-utils installed)
        if (!pdfText) {
          try {
            const tmpPdf = path.join('/tmp', `aiconfig-${Date.now()}.pdf`);
            const tmpTxt = tmpPdf.replace('.pdf', '.txt');
            fs.writeFileSync(tmpPdf, req.file.buffer);
            execSync(`pdftotext -layout "${tmpPdf}" "${tmpTxt}"`, { timeout: 15000 });
            pdfText = fs.readFileSync(tmpTxt, 'utf-8');
            try { fs.unlinkSync(tmpPdf); } catch {}
            try { fs.unlinkSync(tmpTxt); } catch {}
            console.log(`📄 PDF extraído (pdftotext): ${pdfText.length} chars`);
          } catch (e2: any) {
            console.log(`⚠️ pdftotext no disponible: ${e2.message}`);
          }
        }

        if (!pdfText) {
          res.status(400).json({ error: 'No se pudo leer el PDF. Intenta con otro archivo.' });
          return;
        }
      } catch (e: any) {
        console.error('❌ Error leyendo PDF:', e.message);
        res.status(400).json({ error: 'Error al procesar el PDF.' });
        return;
      }
    }

    if (!pdfText && !businessName) {
      res.status(400).json({ error: 'Sube un PDF o escribe el nombre de tu negocio.' });
      return;
    }

    // ====================================================
    // 📎 Read existing media items for triggers
    // FIX v2: field is m.trigger (string, comma-separated), NOT m.triggers
    // ====================================================
    const mediaItems = assistant ? ((assistant.mediaItems as any[]) || []) : [];
    const mediaSummary = mediaItems.filter((m: any) => m.trigger || m.name).map((m: any) => {
      // Handle both formats: m.trigger (string) and m.triggers (array)
      let triggerStr = '';
      if (m.trigger && typeof m.trigger === 'string') {
        triggerStr = m.trigger;
      } else if (Array.isArray(m.triggers) && m.triggers.length) {
        triggerStr = m.triggers.join(', ');
      }
      
      const triggerDisplay = triggerStr || 'sin trigger';
      
      if (m.type === 'catalog') {
        const imgCount = (m.images || []).length;
        return `- CATÁLOGO "${m.name || 'Sin nombre'}" (${imgCount} fotos) → Trigger: "${triggerDisplay}"`;
      }
      if (m.type === 'video') return `- VIDEO "${m.name || 'Sin nombre'}" → Trigger: "${triggerDisplay}"`;
      if (m.type === 'image') return `- IMAGEN "${m.name || 'Sin nombre'}" → Trigger: "${triggerDisplay}"`;
      if (m.type === 'audio') return `- AUDIO "${m.name || 'Sin nombre'}" → Trigger: "${triggerDisplay}"`;
      return `- ${(m.type || 'MEDIA').toUpperCase()} "${m.name || ''}" → Trigger: "${triggerDisplay}"`;
    }).join('\n');

    // Detect business type from PDF content
    const detectedType = detectBusinessType(pdfText || '', businessType || '');

    // Build prompt
    const systemPrompt = buildSystemPrompt(outputFormat, mediaSummary, businessName, businessType, detectedType);
    const userPrompt = pdfText
      ? `Aquí está toda la información del negocio extraída de su PDF:\n\n${pdfText.slice(0, 25000)}`
      : `Nombre del negocio: ${businessName}\nTipo: ${businessType || 'Negocio general'}\nGenera una base de conocimiento completa.`;

    console.log(`🤖 AI Config v2: generando ${outputFormat} para "${businessName || 'nuevo'}" (${pdfText.length} chars PDF, ${mediaItems.length} media, tipo: ${detectedType})`);

    // Call OpenAI
    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',  // [FIX] Base de conocimiento requiere máxima calidad
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.4,  // [FIX] Más precisión en extracción de datos del PDF
        max_tokens: 12000  // [FIX] MD completo necesita más tokens
      })
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      console.error('❌ OpenAI error:', err);
      res.status(500).json({ error: 'Error con OpenAI. Verifica tu API Key.' });
      return;
    }

    const aiData: any = await aiRes.json();
    let generated = aiData.choices?.[0]?.message?.content || '';

    if (!generated || generated.length < 100) {
      res.status(500).json({ error: 'La IA no generó contenido suficiente. Intenta con un PDF más detallado.' });
      return;
    }

    // [FIX 8] Post-process: limpiar backticks + validar secciones críticas
    generated = generated.replace(/^```(?:markdown|json|md)?\n?/gm, '').replace(/\n?```$/gm, '').trim();

    // Verificar secciones críticas para la plataforma
    const hasPipeline = /##.*ETAPAS.*PIPELINE/i.test(generated) || /\n- [A-ZÁ-Ú]/.test(generated);
    const hasFlow = /##.*FLUJO/i.test(generated);
    const hasRules = /##.*REGLAS/i.test(generated);
    const hasMemory = /##.*MEMORIA|MEMORY_JSON|etapa_actual/i.test(generated);
    
    const warnings: string[] = [];
    if (!hasPipeline) warnings.push('⚠️ Falta sección ETAPAS DEL PIPELINE — el CRM no tendrá etapas automáticas');
    if (!hasFlow) warnings.push('⚠️ Falta sección FLUJO CONVERSACIONAL — el bot no sabrá el orden de pasos');
    if (!hasRules) warnings.push('⚠️ Falta sección REGLAS — el bot puede cometer errores críticos');
    
    console.log(`✅ AI Config v3 generado: ${generated.length} chars | Pipeline:${hasPipeline} Flow:${hasFlow} Rules:${hasRules} Memory:${hasMemory}`);
    if (warnings.length) console.warn(warnings.join('\n'));

    res.json({
      success: true,
      content: generated,
      format: outputFormat,
      assistantId: assistant?.id || null,
      stats: {
        inputChars: pdfText.length,
        outputChars: generated.length,
        mediaItemsDetected: mediaItems.length,
        tokensUsed: aiData.usage?.total_tokens || 0,
        hasPipeline: /##.*ETAPAS.*PIPELINE/i.test(generated) || /\n- [A-ZÁ-Ú]/.test(generated),
        hasFlow: /##.*FLUJO/i.test(generated),
        hasRules: /##.*REGLAS/i.test(generated),
        sectionsFound: (generated.match(/^## /gm) || []).length
      }
    });
  } catch (e: any) {
    console.error('❌ AI Config error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 💾 APPLY — Guardar en asistente (crea si no existe)
router.post('/apply', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const { assistantId, lineId, content, businessName } = req.body;
    if (!content) { res.status(400).json({ error: 'content es requerido' }); return; }

    let assistant: any = null;

    // Try to find existing assistant
    if (assistantId) {
      assistant = await prisma.assistant.findFirst({ where: { id: assistantId, userId: ownerId } });
    }
    if (!assistant && lineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, whatsappLineId: lineId } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true } });
    }

    if (assistant) {
      // Update existing
      await prisma.assistant.update({
        where: { id: assistant.id },
        data: { context: content }
      });
      console.log(`💾 AI Config: actualizado asistente "${assistant.name}" (${content.length} chars)`);
    } else {
      // Create new assistant
      const effectiveLineId = lineId || null;
      assistant = await prisma.assistant.create({
        data: {
          userId: ownerId,
          name: businessName || 'Asistente IA',
          context: content,
          isActive: true,
          whatsappLineId: effectiveLineId,
          knowledgeItems: [],
          mediaItems: [],
          learningHistory: [],
          model: 'gpt-4-turbo-preview',
          temperature: 0.7,
          maxTokens: 500
        }
      });

      // Link to whatsapp line if exists
      if (effectiveLineId) {
        await prisma.whatsappLine.update({
          where: { id: effectiveLineId },
          data: { assistantId: assistant.id }
        }).catch(() => {});
      }

      console.log(`🆕 AI Config: creado asistente "${assistant.name}" (${content.length} chars)`);
    }

    // Extract and auto-save pipeline stages
    const stages = extractStages(content);
    if (stages.length > 0 && assistant.whatsappLineId) {
      await prisma.whatsappLine.update({
        where: { id: assistant.whatsappLineId },
        data: { customStages: stages, stagesConfigured: true }
      }).catch(() => {});
      console.log(`📋 Auto-etapas: ${stages.map((s: any) => s.label).join(', ')}`);
    }

    res.json({ success: true, assistantId: assistant.id, stagesExtracted: stages.length });
  } catch (e: any) {
    console.error('❌ AI Config apply error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ====================================================
// 🔍 DETECT BUSINESS TYPE — Heuristic from PDF content
// ====================================================
function detectBusinessType(pdfText: string, userType: string): string {
  const text = (pdfText + ' ' + userType).toLowerCase();

  if (/restaurante|comida|menú|menu|plato|cocina|chef|reserva.*mesa|delivery|domicilio/i.test(text)) return 'restaurante';
  if (/hotel|hospedaje|habitación|habitacion|hostal|alojamiento|check-in|check-out/i.test(text)) return 'hotel';
  if (/médic|medic|doctor|clínic|clinic|consultorio|paciente|salud|dental|odontolog/i.test(text)) return 'clinica';
  if (/abogad|legal|jurídic|juridic|demanda|contrato|asesoría legal/i.test(text)) return 'legal';
  if (/inmobiliaria|propiedad|apartamento|casa.*venta|arriendo|lote|finca/i.test(text)) return 'inmobiliaria';
  if (/gym|gimnasio|fitness|entrenamiento|membresía|membresia/i.test(text)) return 'gym';
  if (/salon|peluquería|peluqueria|barbería|barberia|spa|belleza|uñas|manicure/i.test(text)) return 'salon';
  if (/curso|academia|clase|formación|formacion|capacitación|enseñanza|educación/i.test(text)) return 'educacion';
  if (/software|saas|app|plataforma|suscripción|demo|trial|onboarding/i.test(text)) return 'saas';
  if (/cancha|alquiler.*cancha|fútbol|futbol|sintética|sintetica|deporte.*alquiler/i.test(text)) return 'canchas';
  if (/vehículo|vehiculo|auto|carro|moto|alquiler.*auto|rent.*car/i.test(text)) return 'vehiculos';
  if (/tienda|producto|precio|envío|envio|talla|color|compra|pedido|catálogo|catalogo/i.test(text)) return 'tienda';
  if (/servicio|cotización|cotizacion|consultoría|consultoria|asesoría|asesoria|proyecto/i.test(text)) return 'servicios';
  if (/veterinaria|veterinario|mascota|perro|gato|animal|clínica.*animal/i.test(text)) return 'veterinaria';
  if (/tecnomecanica|tecnomecánica|revisión.*vehiculo|rtm|revisión.*técnica/i.test(text)) return 'tecnomecanica';
  if (/seguro|póliza|poliza|aseguradora|riesgo.*cobertura/i.test(text)) return 'seguros';
  if (/evento|boda|matrimonio|quinceaño|cumpleaño|catering|banquete/i.test(text)) return 'eventos';
  if (/transporte|mudanza|flete|carga|domicilio.*empresa|mensajería/i.test(text)) return 'transporte';
  if (/taller|mecánica|mecanico|reparación.*auto|cambio.*aceite|diagnóstico.*vehiculo/i.test(text)) return 'taller';
  
  return 'general';
}

// ====================================================
// 🏗️ PROMPT BUILDER v2.0 — Genera prompts PERFECTOS
// ====================================================
function buildSystemPrompt(format: string, mediaSummary: string, businessName?: string, businessType?: string, detectedType?: string): string {
  
  const bizType = detectedType || 'general';
  
  // Determine action type based on business
  // [FIX 4] Acción principal + acciones secundarias según el tipo de negocio
  let actionType = 'crear_pedido';
  let actionLabel = 'pedido';
  let actionFields = 'producto_servicio, cantidad, precio, total, direccion, ciudad, fecha_entrega';
  let secondaryActions = '';
  
  if (['clinica', 'legal', 'salon', 'educacion', 'saas', 'servicios'].includes(bizType)) {
    actionType = 'crear_cita';
    actionLabel = 'cita';
    actionFields = 'tipo_cita, fecha_cita, hora_cita, nombre, telefono';
    secondaryActions = 'También puede usar crear_pedido si vende productos físicos.';
  } else if (['restaurante', 'hotel', 'canchas', 'vehiculos', 'gym'].includes(bizType)) {
    actionType = 'crear_reserva';
    actionLabel = 'reserva';
    actionFields = 'tipo_reserva, fecha_reserva, hora_reserva, num_personas, nombre, telefono';
    secondaryActions = bizType === 'restaurante' ? 'También puede usar crear_pedido para domicilios/delivery.' : '';
  } else if (bizType === 'inmobiliaria') {
    actionType = 'crear_cita';
    actionLabel = 'visita';
    actionFields = 'tipo_cita, fecha_cita, hora_cita, nombre, telefono';
    secondaryActions = 'tipo_cita = "visita inmueble"';
  }

  const mediaSection = mediaSummary
    ? `\n📎 MULTIMEDIA YA CONFIGURADA EN EL ASISTENTE:\n${mediaSummary}\n\nREGLAS: Incluye TODOS estos triggers en la sección "TRIGGERS MULTIMEDIA" e indica en qué paso del flujo se activan. Si hay productos sin trigger, sugiere nuevos al final.`
    : '\n📎 No hay multimedia configurada. Sugiere triggers útiles que el cliente podría subir.';

  // ====================================================
  // 🧠 PLATFORM KNOWLEDGE — Enseña la arquitectura
  // ====================================================
  const platformKnowledge = `
=== CÓMO LA PLATAFORMA USA ESTA BASE DE CONOCIMIENTO ===

1. MEMORIA (MEMORY_JSON): Cada respuesta del bot incluye un bloque oculto con datos del cliente. El campo "etapa_actual" MUEVE la conversación en el CRM. El campo "accion" CREA registros reales en la Agenda.

2. PIPELINE CRM: El sistema extrae etapas de la sección "## ETAPAS DEL PIPELINE" buscando líneas "- Nombre". Cada etapa DEBE tener nombre corto (2-35 chars) y único.

3. TRIGGERS MULTIMEDIA: Cuando el bot escribe una palabra trigger en su respuesta, el sistema envía el archivo automáticamente. El bot NUNCA escribe URLs ni [imagen:xxx].

4. ACCIONES: "accion":"${actionType}" crea un ${actionLabel} REAL en la Agenda cuando el cliente confirma y TODOS los datos están completos.

5. FLUJO: Paso a paso, cada paso indica etapa + trigger. Datos del cliente se piden ANTES del resumen, NUNCA después.`;

  // ====================================================
  // 📄 JSON FORMAT
  // ====================================================
  if (format === 'json') {
    return `Eres un experto en crear bases de conocimiento para asistentes de ventas por WhatsApp en BizonneCRM.

Negocio: ${businessName || 'No especificado'} (${businessType || 'general'}) | Tipo: ${bizType} | Acción: ${actionType}
${mediaSection}
${platformKnowledge}

GENERA un JSON VÁLIDO con esta estructura:
{
  "negocio": { "nombre": "", "tipo": "", "descripcion": "", "horarios": "", "ubicacion": "", "contacto": {} },
  "asistente": { "nombre": "", "personalidad": [], "objetivo": "", "tono": "" },
  "productos_servicios": [{ "nombre": "", "descripcion": "", "precio": "", "caracteristicas": [] }],
  "precios": { "moneda": "COP", "metodos_pago": [], "descuentos": [], "envios": [] },
  "etapas_pipeline": [{ "nombre": "", "descripcion": "", "accion_bot": "" }],
  "triggers_multimedia": [{ "trigger": "", "tipo": "", "nombre": "", "paso_flujo": "" }],
  "faq": [{ "pregunta": "", "respuesta": "" }],
  "flujo_conversacional": [{ "paso": 1, "nombre": "", "etapa": "", "bot_dice": "", "trigger_activo": "", "campos_memoria": [] }],
  "campos_memoria": { "accion_principal": "${actionType}", "campos_requeridos": [] },
  "reglas": []
}

Extrae TODA la info del PDF. Precios EXACTOS. Mínimo 6 etapas, 10 FAQ. JSON VÁLIDO, sin backticks. Responde SOLO con el JSON.`;
  }

  // ====================================================
  // 📝 MARKDOWN FORMAT (default) — THE MEGA PROMPT
  // ====================================================

  // Stage suggestions by business type
  const stageExamples: Record<string, string> = {
    tienda: 'Nuevo Contacto, Interesado, Eligiendo Producto, Pendiente Datos, Cotizado, Realizó Pedido, Pendiente Pago, Confirmado, Despachado, Entregado, Perdido',
    restaurante: 'Nuevo Contacto, Consultando Menú, Eligiendo Platos, Pendiente Reserva, Reserva Confirmada, Atendido, Perdido',
    clinica: 'Nuevo Contacto, Consultando Servicios, Eligiendo Tratamiento, Pendiente Cita, Cita Confirmada, Atendido, Seguimiento, Perdido',
    salon: 'Nuevo Contacto, Consultando Servicios, Eligiendo Servicio, Pendiente Cita, Cita Confirmada, Atendido, Perdido',
    hotel: 'Nuevo Contacto, Consultando Disponibilidad, Eligiendo Habitación, Pendiente Reserva, Reserva Confirmada, Check-in, Check-out, Perdido',
    inmobiliaria: 'Nuevo Contacto, Interesado, Visita Programada, Negociación, Propuesta Enviada, Cierre, Perdido',
    saas: 'Nuevo Contacto, Interesado, Demo Programada, Evaluación, Propuesta, Activación, Onboarding, Perdido',
    canchas: 'Nuevo Contacto, Consultando Horarios, Pendiente Reserva, Reserva Confirmada, Perdido',
    gym: 'Nuevo Contacto, Consultando Planes, Eligiendo Membresía, Prueba Gratis, Inscrito, Perdido',
    educacion: 'Nuevo Contacto, Consultando Cursos, Eligiendo Programa, Pendiente Matrícula, Inscrito, Perdido',
    legal: 'Nuevo Contacto, Consultando Caso, Asesoría Inicial, Pendiente Documentos, Caso Activo, Resuelto, Perdido',
    servicios: 'Nuevo Contacto, Interesado, Cotización Enviada, Negociación, Contratado, En Ejecución, Completado, Perdido',
    vehiculos: 'Nuevo Contacto, Consultando Vehículos, Eligiendo Vehículo, Pendiente Reserva, Reserva Confirmada, Entregado, Perdido',
    general: 'Nuevo Contacto, Interesado, En Cotización, Pendiente Datos, Confirmado, En Proceso, Completado, Perdido',
    veterinaria: 'Nuevo Contacto, Consultando Servicios, Eligiendo Tratamiento, Pendiente Cita, Cita Confirmada, Atendido, Seguimiento, Perdido',
    tecnomecanica: 'Nuevo Contacto, Consultando Disponibilidad, Pendiente Cita RTM, Cita Confirmada, Vehículo en Revisión, Revisión Completada, Perdido',
    seguros: 'Nuevo Contacto, Consultando Seguros, Cotización Enviada, Evaluando Propuesta, Póliza Activa, Perdido',
    eventos: 'Nuevo Contacto, Consultando Disponibilidad, Propuesta Enviada, Negociando, Reserva Confirmada, Evento Realizado, Perdido',
    transporte: 'Nuevo Contacto, Consultando Ruta, Cotización Enviada, Servicio Confirmado, En Tránsito, Entregado, Perdido',
    taller: 'Nuevo Contacto, Consultando Servicio, Pendiente Cita, Cita Confirmada, Vehículo en Taller, Listo para Entrega, Entregado, Perdido',
    inmobiliaria: 'Nuevo Contacto, Interesado, Visita Programada, Propuesta Enviada, Negociación, Promesa Firmada, Cierre, Perdido'
  };

  const suggestedStages = stageExamples[bizType] || stageExamples.general;

  // ════════════════════════════════════════════════════════════
  // 🧠 MEGA PROMPT v3.0 — El cerebro perfecto de la plataforma
  // ════════════════════════════════════════════════════════════
  return `Eres el mejor experto mundial en crear bases de conocimiento para asistentes de ventas por WhatsApp.
Tu output se convierte DIRECTAMENTE en el cerebro de un bot que vende, agenda y gestiona clientes en BizonneCRM.
Un MD mal generado = bot que no funciona. Un MD perfecto = bot que vende solo 24/7.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 DATOS DEL NEGOCIO A CONFIGURAR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Nombre: ${businessName || '[extraer del PDF]'}
Tipo: ${businessType || '[detectar del PDF]'}
Tipo detectado: ${bizType}
Acción principal: ${actionType}
Etapas sugeridas: ${suggestedStages}
${mediaSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏗️ ARQUITECTURA DE LA PLATAFORMA (cómo usa el MD)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
La plataforma tiene 6 sistemas que se activan CON ESTE MD:

[SISTEMA 1 — CRM/PIPELINE]
Lee la sección "## 📋 ETAPAS DEL PIPELINE" buscando líneas "- NombreEtapa".
Cada "- Etapa" se convierte en una columna Kanban. El bot mueve el lead entre columnas via etapa_actual en el MEMORY_JSON.
CRÍTICO: Las etapas del flujo y las etapas del pipeline DEBEN SER LAS MISMAS palabras exactas.

[SISTEMA 2 — MEMORY_JSON]
Al final de CADA respuesta del bot va un bloque oculto:
<<MEMORY_JSON>>{"nombre":"","telefono":"","producto_servicio":"","detalles_producto":"","cantidad":"","precio":"","descuento":"","total":"","ciudad":"","direccion":"","barrio":"","metodo_pago":"","fecha_entrega":"","pedido":"","fecha_cita":"","hora_cita":"","tipo_cita":"","cita":"","fecha_reserva":"","hora_reserva":"","tipo_reserva":"","num_personas":"","duracion_reserva":"","reserva":"","notas":"","nombre_empresa":"","tipo_negocio":"","email":"","etapa_actual":"","accion":""}<<END_MEMORY>>
Este bloque persiste entre mensajes. El bot lee y actualiza estos campos progresivamente.

[SISTEMA 3 — ACCIONES AUTOMÁTICAS]
Cuando "accion" tiene valor, el sistema crea un registro REAL en la Agenda:
- accion:"crear_cita" → Crea cita en Agenda (requiere: fecha_cita, hora_cita, tipo_cita, nombre, telefono)
- accion:"crear_pedido" → Crea pedido en Agenda (requiere: producto_servicio, cantidad, precio, total, nombre, telefono, ciudad, direccion)
- accion:"crear_reserva" → Crea reserva en Agenda (requiere: fecha_reserva, hora_reserva, tipo_reserva, num_personas, nombre, telefono)
- accion:"actualizar_cita/pedido/reserva" → Modifica registro existente
- accion:"cancelar_cita/pedido/reserva" → Cancela registro existente
⚠️ El bot SOLO pone acción cuando EL CLIENTE CONFIRMA y TODOS los datos están completos.

[SISTEMA 4 — TRIGGERS MULTIMEDIA]
El bot incluye palabras clave naturalmente en sus respuestas → el sistema detecta y envía el archivo automáticamente.
El bot NUNCA escribe URLs, rutas ni [imagen:x]. Solo la palabra trigger sola o dentro de una oración.
Ejemplo: "Te envío nuestro catálogo completo" → si "catálogo completo" es el trigger, se envía el archivo.

[SISTEMA 5 — LLAMADAS IA]
Si el negocio tiene Llamadas IA configuradas, la sección "## 🎭 IDENTIDAD" + "## ⚠️ REGLAS" definen la voz del agente.
Las llamadas también leen la base de conocimiento para responder preguntas.

[SISTEMA 6 — AGENDA/RECURSOS]
Las citas/pedidos/reservas creados via accion aparecen en la Agenda con todos los datos del MEMORY_JSON.
Si el negocio tiene "Recursos" configurados (doctores, salas, mesas), el sistema asigna automáticamente.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 GENERA EXACTAMENTE ESTA ESTRUCTURA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# [NOMBRE NEGOCIO] — Base de Conocimiento IA

---

## 🎭 IDENTIDAD DEL ASISTENTE

**Nombre:** [Nombre cercano y representativo. Ej: "Sofía de MiTienda", "Carlos de ClinicaSalud"]
**Personalidad:** [3-5 rasgos: amable, resolutivo, entusiasta, profesional, etc.]
**Objetivo principal:** [En 1 línea: qué logra el bot. Siempre orientado a ${actionType}]
**Tono:** [Cercano/Profesional/Juvenil según el negocio] · Idioma: Español Colombia · Emojis: Moderados
**Presenta el negocio como:** [Frase corta de valor. Ej: "La tienda de ropa con mejor calidad-precio de Bogotá"]

---

## 📋 ETAPAS DEL PIPELINE

⚠️ FORMATO OBLIGATORIO — una etapa por línea con guión, sin descripción en la misma línea:

- [Etapa 1]
- [Etapa 2]
- [Etapa 3]
[... MÍNIMO 6, MÁXIMO 12 etapas. Adaptar de: ${suggestedStages}]
- Perdido

REGLA: Nombres cortos (2-30 caracteres), descriptivos, sin caracteres especiales.
Estas etapas son las ÚNICAS que el bot puede usar en etapa_actual. Deben reflejar el journey real del cliente.

---

## 🔄 FLUJO CONVERSACIONAL COMPLETO

⚠️ GUÍA EXACTA: El bot DEBE seguir estos pasos en orden. Incluye mensaje ejemplo + etapa CRM + trigger multimedia si aplica.
⚠️ REGLA DE ORO: Datos del cliente SIEMPRE antes del resumen. Resumen SIEMPRE antes de confirmar.

### PASO 1 — Saludo y Presentación
**Etapa CRM:** [Primera etapa del pipeline]
**El bot dice:**
"[Mensaje de bienvenida con emoji. Presentar asistente y negocio. Preguntar nombre.]"
**Objetivo:** Capturar nombre → guardarlo en memoria como "nombre"

### PASO 2 — Identificar Necesidad
**Etapa CRM:** [Segunda etapa]
**El bot dice:**
"[Hola {nombre}! Preguntar qué busca / en qué puede ayudar. Si hay catálogo → activar trigger aquí]"
**Trigger multimedia:** [trigger si aplica] → Envía [tipo de archivo]
**Objetivo:** Entender qué quiere el cliente

### PASO 3 — Presentar Opciones / Cotizar
**Etapa CRM:** [Tercera etapa]
**El bot dice:**
"[Mostrar opciones relevantes con precios. Preguntar cuál le interesa.]"
**Trigger multimedia:** [trigger si aplica]
**Objetivo:** Cliente elige producto/servicio específico → guardar en producto_servicio

[CONTINUAR CON TODOS LOS PASOS NECESARIOS SEGÚN EL NEGOCIO]

### PASO [N-2] — Recopilar Datos del Cliente
**Etapa CRM:** [Etapa de datos/pendiente]
**El bot dice:**
"[Para procesar tu ${actionType === 'crear_pedido' ? 'pedido' : actionType === 'crear_cita' ? 'cita' : 'reserva'}, necesito:]"
${actionType === 'crear_pedido' ? `1. ¿Cuál es tu nombre completo?
2. ¿Número de celular?
3. ¿Dirección de entrega?
4. ¿Barrio?
5. ¿Ciudad?` : actionType === 'crear_cita' ? `1. ¿Cuál es tu nombre completo?
2. ¿Número de celular?
3. ¿Qué fecha prefieres?
4. ¿Qué hora te queda mejor?` : `1. ¿Cuál es tu nombre completo?
2. ¿Número de celular?
3. ¿Qué fecha?
4. ¿A qué hora?
5. ¿Cuántas personas?`}
**Objetivo:** Completar TODOS los campos requeridos en memoria antes de mostrar resumen

### PASO [N-1] — Resumen y Confirmación
**Etapa CRM:** [Etapa de resumen/cotizado]
**El bot dice:**
"[Resumen COMPLETO con TODOS los datos: nombre, ${actionType === 'crear_pedido' ? 'producto, cantidad, precio, total, dirección' : actionType === 'crear_cita' ? 'servicio, fecha, hora, nombre, teléfono' : 'servicio, fecha, hora, personas, nombre, teléfono'}]
¿Todo está correcto? ✅ Confirmar / ❌ Modificar"
**Objetivo:** Cliente revisa y confirma

### PASO [N] — Confirmación Final
**Etapa CRM:** [Última etapa positiva del pipeline]
**El bot dice:**
"[Confirmar ${actionType === 'crear_pedido' ? 'pedido' : actionType === 'crear_cita' ? 'cita' : 'reserva'} + dar número/código de referencia + próximos pasos + despedida cálida]"
**Acción MEMORY_JSON:** accion = "${actionType}" (SE ACTIVA AQUÍ con datos completos)
**Objetivo:** ${actionType} creado en Agenda, cliente satisfecho

---

## 📦 PRODUCTOS Y SERVICIOS

[Extraer TODO del PDF. Si hay muchos → usar tabla. Si no hay precios → poner "Consultar al asesor"]

| Producto/Servicio | Descripción | Precio | Disponible |
|---|---|---|---|
| [nombre] | [descripción corta] | $[precio] COP | ✅ |

[Si hay variantes (tallas, colores, planes, duraciones) → listarlas explícitamente]
[Si hay combos o paquetes → describir qué incluye cada uno]

---

## 💰 PRECIOS, PAGOS Y ENVÍOS

**Moneda:** COP (Pesos colombianos)
**Métodos de pago aceptados:** [Extraer del PDF. Si no hay → poner: Transferencia bancaria, Nequi, Daviplata, Efectivo, Tarjeta]
**Envíos:** [Costo, zonas, tiempo estimado. Si no hay → [Ajustar según negocio]]
**Descuentos:** [Del PDF o "Sin descuentos activos por el momento"]
**Facturación:** [Del PDF o "Se envía factura por WhatsApp al confirmar"]

---

## 🎬 TRIGGERS MULTIMEDIA

⚠️ Cuando el bot escriba estas palabras en su respuesta, el sistema envía el archivo automáticamente.
⚠️ El bot NUNCA escribe URLs, rutas de archivos ni [imagen:xxx]. Solo la palabra/frase trigger.

${mediaSummary ? `TRIGGERS CONFIGURADOS (usar EXACTAMENTE como están escritos):
${mediaSummary}` : `[No hay multimedia configurada aún. Sugerir al menos 3 triggers útiles que el cliente debería subir:]
- "ver catálogo" → Catálogo de productos (PDF o imágenes)
- "ver precios" → Lista de precios actualizada
- "ver menú" / "ver servicios" → Menú o portafolio de servicios`}

INSTRUCCIÓN AL BOT: En el flujo, cuando corresponda enviar multimedia, escribe algo como:
"Aquí tienes [el trigger]" o "Te comparto [el trigger]" — nunca las rutas ni archivos directos.

---

## ❓ PREGUNTAS FRECUENTES (FAQ)

[Mínimo 12 preguntas reales que haría un cliente de este negocio. Basarse en el PDF.]

**P: ¿Cuál es el horario de atención?**
R: [Del PDF o [Ajustar]]

**P: ¿Cómo hago un ${actionType === 'crear_pedido' ? 'pedido' : actionType === 'crear_cita' ? 'cita' : 'reserva'}?**
R: [Describir el proceso en 3 pasos simples]

**P: ¿Cuáles son los métodos de pago?**
R: [Listar métodos]

**P: ¿Hacen envíos a toda Colombia?**
R: [Del PDF o [Ajustar]]

**P: ¿Cuánto tiempo demora [entrega/cita/reserva]?**
R: [Del PDF o [Ajustar]]

**P: ¿Tienen garantía?**
R: [Del PDF o política razonable]

**P: ¿Puedo cancelar o cambiar mi ${actionType === 'crear_pedido' ? 'pedido' : actionType === 'crear_cita' ? 'cita' : 'reserva'}?**
R: [Ver sección de política]

[Agregar 5+ preguntas específicas del negocio extraídas del PDF]

---

## 🔄 POLÍTICA DE CAMBIOS Y CANCELACIONES

[Del PDF. Si no hay → generar política razonable para Colombia:]

**Cambios:** [Condiciones para cambiar pedido/cita/reserva — tiempo límite, cómo solicitarlo]
**Cancelaciones:** [Condiciones, penalidades si aplica, tiempo límite]
**Devoluciones:** [Si aplica — condiciones, plazos, proceso]
**Garantías:** [Si aplica]

---

## 🧠 INSTRUCCIONES DE MEMORIA (MEMORY_JSON)

El bot actualiza estos campos progresivamente en cada mensaje:

**Campos críticos para este negocio:**
- nombre → Nombre completo del cliente (pedir en paso 1)
- telefono → Celular del cliente (pedir antes del resumen)
- nombre_empresa → Nombre del negocio si es cliente empresarial
- tipo_negocio → Tipo de negocio del cliente (si es B2B)
- producto_servicio → ${bizType === 'tienda' ? 'Producto(s) seleccionados con talla/color/variante' : bizType === 'clinica' || bizType === 'salon' ? 'Servicio o tratamiento elegido' : bizType === 'restaurante' ? 'Platos o servicios solicitados' : 'Producto o servicio solicitado'}
- detalles_producto → Especificaciones adicionales (talla, color, modelo, plan, variante)
- cantidad → Unidades o número de elementos
- precio → Precio unitario del producto/servicio
- total → Total a pagar (incluye envío, descuentos)
- metodo_pago → Método de pago elegido por el cliente
${actionType === 'crear_pedido' ? `- ciudad → Ciudad de entrega
- direccion → Dirección completa de entrega
- barrio → Barrio para la entrega
- fecha_entrega → Fecha de entrega acordada
- pedido → NO modificar — el sistema lo actualiza a "creado"` : actionType === 'crear_cita' ? `- fecha_cita → Fecha de la cita (formato: YYYY-MM-DD o texto natural)
- hora_cita → Hora de la cita (formato: HH:MM o "10am")
- tipo_cita → Tipo de servicio: ${bizType === 'clinica' ? 'consulta, control, tratamiento' : bizType === 'salon' ? 'corte, tinte, manicure' : 'consulta, asesoría, reunión'}
- cita → NO modificar — el sistema lo actualiza a "creada"` : `- fecha_reserva → Fecha de la reserva
- hora_reserva → Hora de inicio de la reserva
- tipo_reserva → Qué se reserva (${bizType === 'restaurante' ? 'mesa, salón' : bizType === 'hotel' ? 'habitación, suite' : bizType === 'canchas' ? 'cancha, espacio' : 'espacio, servicio'})
- num_personas → Número de personas
- duracion_reserva → Duración en minutos si aplica
- reserva → NO modificar — el sistema lo actualiza a "creada"`}
- notas → Observaciones especiales del cliente
- etapa_actual → EXACTA de las etapas del pipeline (mover en cada paso del flujo)
- accion → Vacío siempre EXCEPTO cuando el cliente confirma con datos completos:
  - "${actionType}" al confirmar
  - "actualizar_${actionType.replace('crear_','')}" para cambios
  - "cancelar_${actionType.replace('crear_','')}" para cancelaciones

---

## 📞 HORARIOS Y CONTACTO

[Del PDF]
**Horario de atención:** [Días y horas]
**Dirección/Ubicación:** [Si aplica]
**Teléfono adicional:** [Si aplica]
**Email:** [Si aplica]
**Ciudad(es) donde opera:** [Importante para envíos y cobertura]

---

## ⚠️ REGLAS CRÍTICAS DEL BOT

### ❌ NUNCA HACER:
- ${actionType === 'crear_pedido' ? 'Confirmar pedido sin tener: nombre, teléfono, dirección, ciudad y barrio' : actionType === 'crear_cita' ? 'Confirmar cita sin tener: nombre, teléfono, fecha y hora' : 'Confirmar reserva sin tener: nombre, teléfono, fecha, hora y número de personas'}
- Pedir datos de envío/contacto DESPUÉS de confirmar
- Mostrar resumen sin tener TODOS los datos del cliente
- Inventar precios que no están en la base de conocimiento
- Escribir URLs, rutas de archivos o [imagen:xxx] en los mensajes
- Saltar etapas del pipeline
- Usar etapas que no estén exactamente en el pipeline configurado
- Crear ${actionType.replace('crear_','')} dos veces para el mismo cliente
- Prometer algo que no está en la base de conocimiento

### ✅ SIEMPRE HACER:
- Pedir nombre en el primer mensaje
- Seguir el flujo conversacional en orden
- Actualizar etapa_actual en CADA respuesta
- Incluir el bloque MEMORY_JSON al final de CADA respuesta
- Pedir TODOS los datos necesarios ANTES del resumen
- Mostrar resumen COMPLETO antes de pedir confirmación
- Activar triggers multimedia en los pasos indicados
- Usar emojis con moderación (máximo 2-3 por mensaje)
- Responder en el tono y personalidad definidos
- Si no sabe algo → decir "déjame verificar" o "te comunico con un asesor"

### 🔁 MANEJO DE CAMBIOS Y CANCELACIONES:
- Si pide cambiar antes de confirmar → simplemente actualizar los datos en memoria
- Si pide cambiar después de confirmar → usar accion = "actualizar_${actionType.replace('crear_','')}"
- Si pide cancelar → confirmar antes, luego usar accion = "cancelar_${actionType.replace('crear_','')}"
- Siempre confirmar con el cliente los cambios antes de ejecutarlos

---

═══════════════════════════════════════
📌 INSTRUCCIONES DE GENERACIÓN (NO incluir en el output)
═══════════════════════════════════════
1. Extrae TODA la información del PDF — precios EXACTOS, nombres EXACTOS, opciones COMPLETAS
2. Si falta info esencial → genera valores RAZONABLES para Colombia y marca [Ajustar]
3. Las etapas en "## 📋 ETAPAS DEL PIPELINE" DEBEN ser "- NombreEtapa" (guión + espacio + nombre)
4. El flujo debe tener UN PASO por cada decisión importante del cliente
5. Los triggers multimedia deben aparecer en el flujo EN EL PASO donde se activan
6. FAQ: mínimo 12, basadas en objeciones reales de clientes colombianos
7. Todo en español Colombia natural (no castizo)
8. Responde SOLO con el Markdown completo, sin backticks ni texto antes/después
9. El MD completo debe tener mínimo 2000 palabras para ser útil`;
}

// ====================================================
// 📋 EXTRACT PIPELINE STAGES v2
// ====================================================
function extractStages(context: string): any[] {
  if (!context || context.length < 50) return [];
  const stages: any[] = [];
  const colors = ['blue', 'cyan', 'yellow', 'orange', 'purple', 'green', 'pink', 'red', 'indigo', 'teal', 'emerald', 'rose', 'amber', 'violet', 'lime'];

  // Find the PIPELINE/ETAPAS section
  // [FIX 7] Regex mejorado: acepta más variantes del título de sección
  const sectionMatch = context.match(/##?\s*[^\n]*?(?:ETAPAS|PIPELINE|FASES|ESTADOS|ETAPA)[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n\n\n|$)/i);
  if (!sectionMatch) {
    // Fallback: buscar cualquier lista con guión en el contexto (para MDs mal formateados)
    const fallbackMatch = context.match(/(?:^|\n)(?:-\s+[A-ZÁ-Ú][^\n]{2,30}\n){3,}/m);
    if (!fallbackMatch) return [];
  }

  const section = sectionMatch[1];
  const foundItems: string[] = [];
  const lines = section.split('\n');

  for (const line of lines) {
    let stageName = '';
    
    // Format 1: Table row
    const tableMatch = line.match(/\|\s*\*?\*?([^*|]+?)\*?\*?\s*\|/);
    if (tableMatch && !tableMatch[1].match(/^[-\s]+$/) && !tableMatch[1].toLowerCase().includes('etapa') && !tableMatch[1].toLowerCase().includes('descripción') && !tableMatch[1].toLowerCase().includes('acción')) {
      stageName = tableMatch[1].replace(/\*\*/g, '').trim();
    }
    
    // Format 2: List with dash/asterisk
    if (!stageName) {
      const listMatch = line.match(/^[-*]\s+\*?\*?([^→\n|*]+?)(?:\*\*)?(?:\s*[→|:].*)?$/);
      if (listMatch) stageName = listMatch[1].replace(/\*\*/g, '').trim();
    }
    
    // Format 3: Numbered list
    if (!stageName) {
      const numMatch = line.match(/^\d+[.)]\s*\*?\*?([^→\n|*]+?)(?:\*\*)?(?:\s*[→|:].*)?$/);
      if (numMatch) stageName = numMatch[1].replace(/\*\*/g, '').trim();
    }

    // Validate
    if (stageName && stageName.length >= 2 && stageName.length <= 40 &&
        !stageName.toLowerCase().includes('etapa') && !stageName.toLowerCase().includes('descripción') &&
        !stageName.toLowerCase().includes('acción del bot') && !stageName.includes('---') && 
        !stageName.match(/^[-|]+$/) && !stageName.toLowerCase().startsWith('nota') &&
        !stageName.toLowerCase().includes('formato') && !stageName.toLowerCase().includes('regla') &&
        !stageName.toLowerCase().includes('obligatorio') && !stageName.toLowerCase().includes('mínimo') &&
        !stageName.toLowerCase().includes('máximo') && !stageName.toLowerCase().includes('sugerida')) {
      foundItems.push(stageName);
    }
  }

  if (foundItems.length < 2) return [];
  const unique = Array.from(new Set(foundItems));
  unique.slice(0, 15).forEach((label, index) => {
    stages.push({ id: label, label, color: colors[index % colors.length], description: '' });
  });
  return stages;
}

export default router;

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
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.6,
        max_tokens: 8000
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

    // Post-process: clean up any markdown code fences the AI may have added
    generated = generated.replace(/^```(?:markdown|json|md)?\n?/gm, '').replace(/\n?```$/gm, '').trim();

    console.log(`✅ AI Config v2 generado: ${generated.length} caracteres`);

    res.json({
      success: true,
      content: generated,
      format: outputFormat,
      assistantId: assistant?.id || null,
      stats: {
        inputChars: pdfText.length,
        outputChars: generated.length,
        mediaItemsDetected: mediaItems.length,
        tokensUsed: aiData.usage?.total_tokens || 0
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
  
  return 'general';
}

// ====================================================
// 🏗️ PROMPT BUILDER v2.0 — Genera prompts PERFECTOS
// ====================================================
function buildSystemPrompt(format: string, mediaSummary: string, businessName?: string, businessType?: string, detectedType?: string): string {
  
  const bizType = detectedType || 'general';
  
  // Determine action type based on business
  let actionType = 'crear_pedido';
  let actionLabel = 'pedido';
  let actionFields = 'producto_servicio, cantidad, precio, total, direccion, ciudad, fecha_entrega';
  
  if (['clinica', 'legal', 'salon', 'educacion', 'saas', 'servicios'].includes(bizType)) {
    actionType = 'crear_cita';
    actionLabel = 'cita';
    actionFields = 'tipo_cita, fecha_cita, hora_cita';
  } else if (['restaurante', 'hotel', 'canchas', 'vehiculos', 'gym'].includes(bizType)) {
    actionType = 'crear_reserva';
    actionLabel = 'reserva';
    actionFields = 'tipo_reserva, fecha_reserva, hora_reserva, num_personas';
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
    general: 'Nuevo Contacto, Interesado, En Cotización, Pendiente Datos, Confirmado, En Proceso, Completado, Perdido'
  };

  const suggestedStages = stageExamples[bizType] || stageExamples.general;

  return `Eres un experto en crear bases de conocimiento PERFECTAS para asistentes de ventas por WhatsApp en la plataforma BizonneCRM.

Tu trabajo: leer la info del negocio (PDF o datos) y generar un Markdown COMPLETO que active TODOS los sistemas de la plataforma automáticamente.

Negocio: ${businessName || 'No especificado'} (${businessType || 'general'})
Tipo detectado: ${bizType}
Acción principal: ${actionType} (${actionLabel})
Campos para la acción: ${actionFields}
Etapas sugeridas para este tipo: ${suggestedStages}
${mediaSection}
${platformKnowledge}

=== GENERA EXACTAMENTE ESTA ESTRUCTURA ===

# 🤖 [NOMBRE DEL NEGOCIO] — BASE DE CONOCIMIENTO

---

## 🎭 IDENTIDAD
[Nombre del asistente, personalidad, objetivo. Usa emojis, tono cercano, orientado a ${actionLabel}s]

---

## 📋 ETAPAS DEL PIPELINE

⚠️ FORMATO OBLIGATORIO — lista con guión para auto-extracción:

- [Etapa 1]
- [Etapa 2]
- [... adaptar las sugeridas: ${suggestedStages}]
- Perdido

Ajusta/agrega etapas según lo que dice el PDF. Mínimo 6, máximo 15.

---

## 🔄 FLUJO CONVERSACIONAL — PASO A PASO

⚠️ Cada paso DEBE tener: mensaje ejemplo del bot + etapa correspondiente + trigger si aplica.

### PASO 1: SALUDO (etapa: [primera etapa])
[Bienvenida + pedir nombre]

### PASO 2: IDENTIFICAR NECESIDAD (etapa: [segunda etapa])
[Preguntar qué necesita. Si hay catálogo → indicar: "Incluir '[trigger]' en la respuesta"]

### PASO 3-N: [SIGUIENTES PASOS]
[Uno por cada dato/decisión necesaria. Indicar trigger multimedia si aplica en ese paso]

### PASO [penúltimo]: DATOS DEL CLIENTE (etapa: [etapa de datos])
⚠️ SIEMPRE pedir datos ANTES del resumen:
${actionType === 'crear_pedido' ? '1. Nombre completo\n2. Teléfono\n3. Dirección\n4. Barrio\n5. Ciudad' :
  actionType === 'crear_cita' ? '1. Nombre completo\n2. Teléfono\n3. Fecha preferida\n4. Hora preferida' :
  '1. Nombre completo\n2. Teléfono\n3. Fecha\n4. Hora\n5. Número de personas'}

### PASO [último-1]: RESUMEN COMPLETO (etapa: [etapa cotizado/resumen])
[Mostrar resumen CON todos los datos. Preguntar: ¿Confirmamos?]

### PASO [último]: CONFIRMACIÓN (etapa: [etapa confirmado])
[Cliente confirma → activar ${actionType}. Preguntar método de pago si aplica]

---

## 📦 PRODUCTOS Y SERVICIOS
[Extraer TODO del PDF: nombres, precios, opciones, variantes. Usar tablas si hay múltiples. Si no hay precios → poner "Consultar"]

---

## 💰 PRECIOS Y PAGOS
[Precios exactos del PDF, métodos de pago, descuentos, envíos. Si falta info → generar valores razonables para Colombia y marcar [Ajustar]]

---

## 🎬 TRIGGERS MULTIMEDIA

Cuando la IA necesite enviar multimedia, incluir estas palabras naturalmente:

[Listar cada trigger en formato:]
- "[trigger exacto]" → Envía [TIPO] [nombre] — Se usa en: Paso [N]
[Sugerir triggers nuevos si hay productos/categorías sin trigger]

⚠️ NUNCA escribir URLs ni [imagen:xxx]. Solo incluir la palabra trigger naturalmente.

---

## ❓ PREGUNTAS FRECUENTES
[Mínimo 10 FAQ basadas en el PDF. Formato: **P:** pregunta **R:** respuesta]

---

## 🔄 POLÍTICA DE CAMBIOS/CANCELACIONES
[Del PDF o generar política razonable]

---

## 🧠 CAMPOS DE MEMORIA

Campos para el MEMORY_JSON de este negocio:
- nombre → Nombre del cliente
- telefono → Teléfono
- producto_servicio → [Qué vende/ofrece]
- detalles_producto → [Especificaciones]
- cantidad, precio, total
- ciudad, direccion, barrio
- metodo_pago
- etapa_actual → EXACTA de "ETAPAS DEL PIPELINE"
- accion → "${actionType}" cuando confirma con datos completos
${actionType === 'crear_cita' ? '- fecha_cita, hora_cita, tipo_cita' : actionType === 'crear_reserva' ? '- fecha_reserva, hora_reserva, tipo_reserva, num_personas' : '- fecha_entrega'}

---

## ⚠️ REGLAS IMPORTANTES

### ❌ NUNCA:
- ${actionType === 'crear_pedido' ? 'Confirmar pedido SIN datos de envío completos' : actionType === 'crear_cita' ? 'Confirmar cita SIN nombre, teléfono, fecha y hora' : 'Confirmar reserva SIN nombre, fecha, hora y personas'}
- Pedir datos DESPUÉS de confirmar
- Mostrar resumen SIN datos del cliente
- Inventar precios
- Escribir URLs o [imagen:xxx]
- Saltar pasos del flujo

### ✅ SIEMPRE:
- Seguir etapas en orden
- Datos ANTES del resumen
- Resumen COMPLETO antes de confirmación
- Emojis y tono cercano
- Activar triggers cuando corresponda

---

=== REGLAS DE GENERACIÓN ===
1. Extrae TODA la info del PDF — precios EXACTOS, opciones COMPLETAS
2. Si falta info (horarios, pagos), genera valores RAZONABLES para Colombia y marca [Ajustar]
3. Etapas en formato "- Nombre" (lista con guión) — OBLIGATORIO para auto-extracción
4. Incluye TODOS los triggers multimedia existentes + sugiere nuevos si necesario
5. Flujo conversacional PASO A PASO con etapa + trigger en cada paso
6. Español Colombia, formato WhatsApp (emojis, mensajes cortos)
7. Responde SOLO con el Markdown completo, sin backticks ni explicaciones`;
}

// ====================================================
// 📋 EXTRACT PIPELINE STAGES v2
// ====================================================
function extractStages(context: string): any[] {
  if (!context || context.length < 50) return [];
  const stages: any[] = [];
  const colors = ['blue', 'cyan', 'yellow', 'orange', 'purple', 'green', 'pink', 'red', 'indigo', 'teal', 'emerald', 'rose', 'amber', 'violet', 'lime'];

  // Find the PIPELINE/ETAPAS section
  const sectionMatch = context.match(/##?\s*[^\n]*?(?:ETAPAS|PIPELINE|FASES|ESTADOS)[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n\n\n|$)/i);
  if (!sectionMatch) return [];

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

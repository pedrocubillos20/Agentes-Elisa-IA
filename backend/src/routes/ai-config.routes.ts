import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getOwnerId } from '../lib/helpers';
import { AuthRequest } from '../middleware/auth.middleware';
import multer from 'multer';

// pdf-parse: handle both ESM and CJS imports
const pdfParseModule = require('pdf-parse');
const pdfParse = typeof pdfParseModule === 'function' ? pdfParseModule : (pdfParseModule.default || pdfParseModule);

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ====================================================
// 🤖 AI CONFIG — Genera base de conocimiento desde PDF
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
        const pdfData = await pdfParse(req.file.buffer);
        pdfText = pdfData.text || '';
        console.log(`📄 PDF extraído: ${pdfText.length} caracteres`);
      } catch (e: any) {
        console.error('❌ Error leyendo PDF:', e.message);
        res.status(400).json({ error: 'No se pudo leer el PDF. Asegúrate de que no esté protegido.' });
        return;
      }
    }

    if (!pdfText && !businessName) {
      res.status(400).json({ error: 'Sube un PDF o escribe el nombre de tu negocio.' });
      return;
    }

    // Read existing media items for triggers
    const mediaItems = assistant ? ((assistant.mediaItems as any[]) || []) : [];
    const mediaSummary = mediaItems.map((m: any) => {
      const triggers = (m.triggers || []).join(', ');
      if (m.type === 'catalog') {
        const products = (m.products || []).map((p: any) => `${p.name} ($${p.price || '?'})`).join(', ');
        return `- CATÁLOGO "${m.label || 'Sin nombre'}": Triggers=[${triggers}] | Productos: ${products}`;
      }
      if (m.type === 'video') return `- VIDEO "${m.label || 'Sin nombre'}": Triggers=[${triggers}]`;
      if (m.type === 'image') return `- IMAGEN "${m.label || 'Sin nombre'}": Triggers=[${triggers}]`;
      if (m.type === 'audio') return `- AUDIO "${m.label || 'Sin nombre'}": Triggers=[${triggers}]`;
      if (m.type === 'document') return `- DOCUMENTO "${m.label || 'Sin nombre'}": Triggers=[${triggers}]`;
      return `- ${m.type?.toUpperCase() || 'MEDIA'} "${m.label || ''}": Triggers=[${triggers}]`;
    }).join('\n');

    // Build prompt
    const systemPrompt = buildSystemPrompt(outputFormat, mediaSummary, businessName, businessType);
    const userPrompt = pdfText
      ? `Aquí está toda la información del negocio extraída de su PDF:\n\n${pdfText.slice(0, 25000)}`
      : `Nombre del negocio: ${businessName}\nTipo: ${businessType || 'Negocio general'}\nGenera una base de conocimiento completa.`;

    console.log(`🤖 AI Config: generando ${outputFormat} para "${businessName || 'nuevo'}" (${pdfText.length} chars PDF, ${mediaItems.length} media)`);

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
        temperature: 0.7,
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
    const generated = aiData.choices?.[0]?.message?.content || '';

    if (!generated || generated.length < 100) {
      res.status(500).json({ error: 'La IA no generó contenido suficiente. Intenta con un PDF más detallado.' });
      return;
    }

    console.log(`✅ AI Config generado: ${generated.length} caracteres`);

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
// 🏗️ PROMPT BUILDER
// ====================================================
function buildSystemPrompt(format: string, mediaSummary: string, businessName?: string, businessType?: string): string {
  const mediaSection = mediaSummary
    ? `\n\n📎 ARCHIVOS MULTIMEDIA YA CONFIGURADOS EN EL ASISTENTE:
${mediaSummary}

IMPORTANTE: Debes incluir TODOS estos triggers de multimedia en la sección correspondiente.
Cada trigger debe indicar cuándo el bot envía ese archivo.
Formato: **Trigger:** "palabra" → Envía [tipo] [nombre]`
    : '\n\nNo hay archivos multimedia configurados aún.';

  if (format === 'json') {
    return `Eres un experto en crear bases de conocimiento para asistentes de ventas por WhatsApp.
Tu trabajo es leer la información del negocio y generar un JSON estructurado COMPLETO para un chatbot de ventas.

El negocio es: ${businessName || 'No especificado'} (${businessType || 'general'})
${mediaSection}

GENERA UN JSON VÁLIDO con esta estructura:
{
  "negocio": { "nombre": "...", "tipo": "...", "descripcion": "...", "horarios": "...", "ubicacion": "...", "contacto": {} },
  "asistente": { "nombre": "Elisa", "personalidad": [...], "objetivo": "...", "tono": "..." },
  "productos_servicios": [{ "nombre": "...", "descripcion": "...", "precio": "...", "caracteristicas": [...] }],
  "precios": { "moneda": "COP", "metodos_pago": [...], "politica_envio": "..." },
  "etapas_pipeline": [{ "nombre": "...", "descripcion": "...", "accion_bot": "..." }],
  "triggers_multimedia": [{ "trigger": "...", "tipo": "...", "nombre": "...", "cuando_enviar": "..." }],
  "faq": [{ "pregunta": "...", "respuesta": "..." }],
  "flujo_conversacional": { "saludo": "...", "identificacion_necesidad": "...", "presentacion_producto": "...", "manejo_objeciones": [...], "cierre": "...", "seguimiento": "..." },
  "reglas": [...]
}

REGLAS:
- Extrae TODA la info del PDF
- Precios EXACTOS si están en el PDF
- Incluye TODOS los triggers multimedia
- Mínimo 5 etapas pipeline, 10 FAQ
- JSON VÁLIDO, sin comentarios, sin backticks
- Responde SOLO con el JSON`;
  }

  return `Eres un experto en crear bases de conocimiento para asistentes de ventas por WhatsApp.
Tu trabajo es leer la información del negocio y generar un Markdown COMPLETO y profesional para un chatbot de ventas.

El negocio es: ${businessName || 'No especificado'} (${businessType || 'general'})
${mediaSection}

GENERA UN MARKDOWN con esta estructura EXACTA:

# 🤖 [NOMBRE] - BASE DE CONOCIMIENTO

---

## 🎭 IDENTIDAD
Eres **[nombre asistente]**, el asistente virtual de **[negocio]**, [descripción].

**Tu personalidad:**
- Vendedor estratégico y directo
- Natural, humano y cercano
- Siempre usa emojis
- Respuestas cortas en líneas separadas
- Orientado a cerrar ventas

🎯 **Objetivo:** Convertir cada conversación en una venta real.

---

## 📦 PRODUCTOS Y SERVICIOS
[Lista completa con precios, características, opciones]

---

## 💰 PRECIOS Y PAGOS
[Precios exactos, métodos de pago, envíos, descuentos]

---

## 📋 ETAPAS DEL PIPELINE (CRM)

| **Etapa** | **Descripción** | **Acción del Bot** |
|---|---|---|
| Interesado | Cliente mostró interés | Enviar catálogo |
[...mínimo 5-8 etapas relevantes]

---

## 🎬 TRIGGERS MULTIMEDIA
[Documentar CADA trigger + crear nuevos si necesario]

---

## ❓ PREGUNTAS FRECUENTES (FAQ)
[Mínimo 10-15 FAQ con respuestas detalladas]

---

## 🔄 FLUJO CONVERSACIONAL

### Saludo
### Identificación de Necesidad
### Presentación del Producto
### Manejo de Objeciones
### Cierre de Venta
### Seguimiento Post-venta

---

## ⚠️ REGLAS IMPORTANTES
- Nunca inventar precios
- Siempre ofrecer opciones
- Preguntar nombre al inicio
[Reglas específicas del negocio]

---

REGLAS DE GENERACIÓN:
- Extrae TODA la info del PDF
- Precios EXACTOS si están en el PDF
- Incluye TODOS los triggers multimedia
- Etapas en formato TABLA (para detección automática)
- Contenido completo, no dejar secciones vacías
- Español (Colombia/LATAM)
- Responde SOLO con el Markdown`;
}

// ====================================================
// 📋 EXTRACT PIPELINE STAGES
// ====================================================
function extractStages(context: string): any[] {
  if (!context || context.length < 50) return [];
  const stages: any[] = [];
  const colors = ['blue', 'cyan', 'yellow', 'orange', 'purple', 'green', 'pink', 'red', 'indigo', 'teal'];

  const sectionMatch = context.match(/##?\s*[^\n]*?ETAPAS[^\n]*(?:PIPELINE|CRM|FLUJO)?[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n\n\n|$)/i);
  if (!sectionMatch) return [];

  const section = sectionMatch[1];
  const foundItems: string[] = [];
  const lines = section.split('\n');

  for (const line of lines) {
    let stageName = '';
    const tableMatch = line.match(/\|\s*\*\*([^*|]+)\*\*\s*\|/);
    if (tableMatch) stageName = tableMatch[1].trim();
    if (!stageName) {
      const listMatch = line.match(/^[-*]\s*\*?\*?([^→\n|]+?)(?:\*\*)?(?:\s*[→|:].*)?$/);
      if (listMatch) stageName = listMatch[1].replace(/\*\*/g, '').trim();
    }
    if (!stageName) {
      const numMatch = line.match(/^\d+\.\s*\*?\*?([^→\n|]+?)(?:\*\*)?(?:\s*[→|:].*)?$/);
      if (numMatch) stageName = numMatch[1].replace(/\*\*/g, '').trim();
    }
    if (stageName && stageName.length >= 2 && stageName.length <= 40 &&
        !stageName.toLowerCase().includes('etapa') && !stageName.toLowerCase().includes('descripción') &&
        !stageName.toLowerCase().includes('acción') && !stageName.includes('---') && !stageName.match(/^[-|]+$/)) {
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

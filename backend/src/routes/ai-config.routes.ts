import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getOwnerId } from '../lib/helpers';
import { AuthRequest } from '../middleware/auth.middleware';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }); // 15MB max

// ====================================================
// 🤖 AI CONFIG — Genera base de conocimiento desde PDF
// Addon de pago: $20 USD
// ====================================================

// ✅ CHECK — Verificar si el usuario tiene el addon comprado
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    const hasPurchased = await prisma.payment.findFirst({
      where: { userId: ownerId, plan: 'ai_config', status: 'approved' }
    });

    // Business plan includes it free
    const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { plan: true } });
    const hasAccess = !!hasPurchased || user?.plan === 'business';

    res.json({ hasAccess, purchased: !!hasPurchased, plan: user?.plan });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 🧠 GENERATE — Subir PDF + generar base de conocimiento
router.post('/generate', upload.single('pdf'), async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    // Verify access
    const hasPurchased = await prisma.payment.findFirst({
      where: { userId: ownerId, plan: 'ai_config', status: 'approved' }
    });
    const user = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { plan: true, apiKey: true, apiKeyConnected: true }
    });
    if (!hasPurchased && user?.plan !== 'business') {
      return res.status(403).json({ error: 'Necesitas comprar el addon "Configuración IA" para usar esta función.' });
    }
    if (!user?.apiKey || !user.apiKeyConnected) {
      return res.status(400).json({ error: 'Necesitas conectar tu API Key de OpenAI primero.' });
    }

    const { assistantId, format, businessName, businessType } = req.body;
    const outputFormat = format || 'markdown';

    if (!assistantId) return res.status(400).json({ error: 'assistantId es requerido' });

    // Get assistant with its media items
    const assistant = await prisma.assistant.findFirst({
      where: { id: assistantId, userId: ownerId }
    });
    if (!assistant) return res.status(404).json({ error: 'Asistente no encontrado' });

    // Extract PDF text
    let pdfText = '';
    if (req.file) {
      try {
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(req.file.buffer);
        pdfText = pdfData.text || '';
        console.log(`📄 PDF extraído: ${pdfText.length} caracteres`);
      } catch (e: any) {
        console.error('❌ Error leyendo PDF:', e.message);
        return res.status(400).json({ error: 'No se pudo leer el PDF. Asegúrate de que no esté protegido con contraseña.' });
      }
    }

    if (!pdfText && !businessName) {
      return res.status(400).json({ error: 'Sube un PDF con información de tu negocio o escribe el nombre del negocio.' });
    }

    // Read existing media items for triggers
    const mediaItems = (assistant.mediaItems as any[]) || [];
    const mediaSummary = mediaItems.map((m: any, i: number) => {
      const triggers = (m.triggers || []).join(', ');
      if (m.type === 'catalog') {
        const products = (m.products || []).map((p: any) => `${p.name} ($${p.price || '?'})`).join(', ');
        return `- CATÁLOGO "${m.label || 'Sin nombre'}": Triggers=[${triggers}] | Productos: ${products}`;
      }
      if (m.type === 'video') return `- VIDEO "${m.label || 'Sin nombre'}": Triggers=[${triggers}] | URL: ${m.url || 'N/A'}`;
      if (m.type === 'image') return `- IMAGEN "${m.label || 'Sin nombre'}": Triggers=[${triggers}] | URL: ${m.url || 'N/A'}`;
      if (m.type === 'audio') return `- AUDIO "${m.label || 'Sin nombre'}": Triggers=[${triggers}] | URL: ${m.url || 'N/A'}`;
      if (m.type === 'document') return `- DOCUMENTO "${m.label || 'Sin nombre'}": Triggers=[${triggers}] | URL: ${m.url || 'N/A'}`;
      return `- ${m.type?.toUpperCase() || 'MEDIA'} "${m.label || ''}": Triggers=[${triggers}]`;
    }).join('\n');

    // Build the mega-prompt
    const systemPrompt = buildSystemPrompt(outputFormat, mediaSummary, businessName, businessType);
    const userPrompt = pdfText
      ? `Aquí está toda la información del negocio extraída de su PDF:\n\n${pdfText.slice(0, 25000)}`
      : `Nombre del negocio: ${businessName}\nTipo: ${businessType || 'Negocio general'}\nGenera una base de conocimiento completa basada en este tipo de negocio.`;

    // Call OpenAI
    console.log(`🤖 AI Config: generando ${outputFormat} para "${businessName || assistant.name}" (${pdfText.length} chars PDF)`);

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
      return res.status(500).json({ error: 'Error al generar con IA. Verifica tu API Key de OpenAI.' });
    }

    const aiData: any = await aiRes.json();
    const generated = aiData.choices?.[0]?.message?.content || '';

    if (!generated || generated.length < 100) {
      return res.status(500).json({ error: 'La IA no generó contenido suficiente. Intenta con un PDF más detallado.' });
    }

    console.log(`✅ AI Config generado: ${generated.length} caracteres`);

    res.json({
      success: true,
      content: generated,
      format: outputFormat,
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

// 💾 APPLY — Guardar el contenido generado en el asistente
router.post('/apply', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });
    const ownerId = await getOwnerId(userId);

    const { assistantId, content } = req.body;
    if (!assistantId || !content) return res.status(400).json({ error: 'assistantId y content son requeridos' });

    const assistant = await prisma.assistant.findFirst({ where: { id: assistantId, userId: ownerId } });
    if (!assistant) return res.status(404).json({ error: 'Asistente no encontrado' });

    // Update context
    await prisma.assistant.update({
      where: { id: assistantId },
      data: { context: content }
    });

    // Extract and auto-save pipeline stages
    const stages = extractStages(content);
    if (stages.length > 0 && assistant.whatsappLineId) {
      await prisma.whatsappLine.update({
        where: { id: assistant.whatsappLineId },
        data: { customStages: stages, stagesConfigured: true }
      }).catch(() => {});
      console.log(`📋 Auto-etapas: ${stages.map(s => s.label).join(', ')}`);
    }

    console.log(`💾 AI Config aplicado: ${content.length} chars → asistente ${assistant.name}`);
    res.json({ success: true, stagesExtracted: stages.length });
  } catch (e: any) {
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

IMPORTANTE: Debes incluir TODOS estos triggers de multimedia en la sección correspondiente del documento.
Cada trigger debe estar documentado indicando cuándo el bot debe enviar ese archivo.
Usa el formato: **Trigger:** "palabra_trigger" → Envía [tipo] [nombre]`
    : '\n\nNo hay archivos multimedia configurados aún.';

  if (format === 'json') {
    return `Eres un experto en crear bases de conocimiento para asistentes de ventas por WhatsApp.
Tu trabajo es leer la información del negocio que te envían y generar un JSON estructurado COMPLETO para configurar un chatbot de ventas.

El negocio es: ${businessName || 'No especificado'} (${businessType || 'general'})
${mediaSection}

GENERA UN JSON VÁLIDO con esta estructura exacta:
{
  "negocio": {
    "nombre": "...",
    "tipo": "...",
    "descripcion": "...",
    "horarios": "...",
    "ubicacion": "...",
    "contacto": { "telefono": "...", "email": "...", "web": "..." }
  },
  "asistente": {
    "nombre": "Elisa",
    "personalidad": ["vendedora estratégica", "natural y cercana", "usa emojis", "respuestas cortas"],
    "objetivo": "Convertir cada conversación en una venta real",
    "tono": "cercano, humano, profesional"
  },
  "productos_servicios": [
    { "nombre": "...", "descripcion": "...", "precio": "...", "caracteristicas": ["..."] }
  ],
  "precios": { "moneda": "COP", "metodos_pago": ["..."], "politica_envio": "..." },
  "etapas_pipeline": [
    { "nombre": "Interesado", "descripcion": "Cliente mostró interés", "accion_bot": "..." },
    { "nombre": "En Cotización", "descripcion": "Se envió precio", "accion_bot": "..." }
  ],
  "triggers_multimedia": [
    { "trigger": "palabra_clave", "tipo": "video/imagen/catalogo", "nombre": "...", "cuando_enviar": "..." }
  ],
  "faq": [
    { "pregunta": "...", "respuesta": "..." }
  ],
  "flujo_conversacional": {
    "saludo": "...",
    "identificacion_necesidad": "...",
    "presentacion_producto": "...",
    "manejo_objeciones": ["..."],
    "cierre": "...",
    "seguimiento": "..."
  },
  "reglas": [
    "Nunca inventar precios",
    "Siempre ofrecer opciones",
    "Preguntar nombre al inicio"
  ]
}

REGLAS:
- Extrae TODA la información del PDF proporcionado
- Si falta info, deduce valores razonables basados en el tipo de negocio
- Los precios deben ser exactos si están en el PDF
- Incluye TODOS los triggers multimedia listados arriba
- Crea mínimo 5 etapas de pipeline realistas
- Genera mínimo 10 preguntas frecuentes
- El JSON debe ser VÁLIDO (parseable)
- NO incluyas comentarios ni texto fuera del JSON
- Responde SOLO con el JSON, sin \`\`\`json ni explicaciones`;
  }

  // MARKDOWN format (default)
  return `Eres un experto en crear bases de conocimiento para asistentes de ventas por WhatsApp.
Tu trabajo es leer la información del negocio que te envían y generar un documento Markdown COMPLETO y profesional para configurar un chatbot de ventas.

El negocio es: ${businessName || 'No especificado'} (${businessType || 'general'})
${mediaSection}

GENERA UN MARKDOWN con esta estructura EXACTA (usa estos headers):

# 🤖 [NOMBRE DEL NEGOCIO] - BASE DE CONOCIMIENTO

---

## 🎭 IDENTIDAD
Eres **[nombre del asistente]**, el asistente virtual de **[negocio]**, [descripción corta].

**Tu personalidad:**
- Vendedor estratégico y directo
- Hablas natural, humano y cercano
- Siempre usas emojis
- Respuestas cortas en líneas separadas
- Orientado a cerrar ventas

🎯 **Objetivo:** Convertir cada conversación en una venta real.

---

## 📦 PRODUCTOS Y SERVICIOS
[Lista completa de todos los productos/servicios con precios, características, opciones]

---

## 💰 PRECIOS Y PAGOS
[Tabla o lista con precios exactos, métodos de pago, envíos, descuentos]

---

## 📋 ETAPAS DEL PIPELINE (CRM)

| **Etapa** | **Descripción** | **Acción del Bot** |
|---|---|---|
| Interesado | Cliente mostró interés | Enviar catálogo |
| En Cotización | Se preguntó por precios | Enviar precios detallados |
[...crear mínimo 5-8 etapas relevantes para el negocio]

---

## 🎬 TRIGGERS MULTIMEDIA
[Documentar CADA trigger multimedia existente + crear nuevos si es necesario]

**Triggers configurados:**
- Cuando el cliente dice "X" → Enviar [tipo] "[nombre]"
[Incluir TODOS los triggers de los archivos multimedia listados]

---

## ❓ PREGUNTAS FRECUENTES (FAQ)
[Mínimo 10-15 preguntas frecuentes con respuestas detalladas]

---

## 🔄 FLUJO CONVERSACIONAL

### Saludo
[Cómo saludar al cliente]

### Identificación de Necesidad
[Cómo preguntar qué busca]

### Presentación del Producto
[Cómo presentar productos/servicios]

### Manejo de Objeciones
[Respuestas a objeciones comunes: "es muy caro", "lo voy a pensar", etc.]

### Cierre de Venta
[Cómo cerrar la venta, pedir datos de envío, confirmar pedido]

### Seguimiento Post-venta
[Cómo hacer seguimiento después de la compra]

---

## ⚠️ REGLAS IMPORTANTES
- Nunca inventar precios que no estén aquí
- Siempre ofrecer opciones
- Preguntar el nombre al inicio
- Si no sabes algo, decir "déjame consultarlo con el equipo"
[Agregar reglas específicas del negocio]

---

REGLAS DE GENERACIÓN:
- Extrae TODA la información del PDF proporcionado
- Si falta información, deduce valores razonables basados en el tipo de negocio
- Los precios deben ser EXACTOS si están en el PDF
- Incluye ABSOLUTAMENTE TODOS los triggers multimedia listados arriba en la sección correspondiente
- La sección de ETAPAS DEL PIPELINE debe tener formato de tabla para que el sistema la detecte automáticamente
- Genera contenido completo y detallado, no dejes secciones vacías
- Escribe en español (Colombia/LATAM)
- Usa emojis en los headers
- Responde SOLO con el Markdown, sin explicaciones adicionales`;
}

// ====================================================
// 📋 EXTRACT PIPELINE STAGES
// ====================================================
function extractStages(context: string): any[] {
  if (!context || context.length < 50) return [];
  const stages: any[] = [];
  const colors = ['blue', 'cyan', 'yellow', 'orange', 'purple', 'green', 'pink', 'red', 'indigo', 'teal'];

  const sectionMatch = context.match(/##?\s*[^\n]*?ETAPAS[^\n]*(?:PIPELINE|CRM|FLUJO|AUTOMÁTICO)?[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n\n\n|$)/i);
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

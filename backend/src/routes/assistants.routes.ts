import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// GET /api/assistants
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    let assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true } });
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId } });
      if (assistant) {
        assistant = await prisma.assistant.update({ where: { id: assistant.id }, data: { isActive: true } });
      }
    }
    res.json({ assistant });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/assistants
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const body = req.body;
    console.log(`💾 Guardando asistente para ${userId}: context=${body.context?.length || 0} chars, media=${body.mediaItems?.length || 0}`);

    const data: any = {
      name: body.name || 'Asistente',
      context: body.context || null,
      personality: body.personality || null,
      businessInfo: body.businessInfo || null,
      instructions: body.instructions || null,
      knowledgeItems: body.knowledgeItems || [],
      mediaItems: body.mediaItems || [],
      elevenLabsKey: body.elevenLabsKey || null,
      selectedVoice: body.selectedVoice || null,
      voiceEnabled: body.voiceEnabled || false,
      autoLearn: body.autoLearn !== false,
      learningHistory: body.learningHistory || [],
      model: body.model || 'gpt-4-turbo-preview',
      temperature: body.temperature || 0.7,
      maxTokens: body.maxTokens || 500,
      isActive: true
    };

    let assistant = await prisma.assistant.findFirst({ where: { userId } });

    if (assistant) {
      await prisma.assistant.updateMany({ where: { userId, id: { not: assistant.id } }, data: { isActive: false } });
      assistant = await prisma.assistant.update({ where: { id: assistant.id }, data });
    } else {
      assistant = await prisma.assistant.create({ data: { ...data, userId } });
    }

    console.log(`✅ Asistente guardado: ${assistant.name}`);
    res.json({ assistant, message: 'Guardado correctamente' });
  } catch (error: any) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: error.message || 'Error' });
  }
});

// PUT /api/assistants/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const { id } = req.params;
    const existing = await prisma.assistant.findFirst({ where: { id, userId } });
    if (!existing) { res.status(404).json({ error: 'No encontrado' }); return; }

    const body = req.body;
    const data: any = {};
    const fields = ['name', 'context', 'personality', 'businessInfo', 'instructions', 'knowledgeItems',
      'mediaItems', 'elevenLabsKey', 'selectedVoice', 'voiceEnabled', 'autoLearn', 'learningHistory',
      'model', 'temperature', 'maxTokens', 'isActive'];
    fields.forEach(f => { if (body[f] !== undefined) data[f] = body[f]; });
    data.isActive = true;

    const assistant = await prisma.assistant.update({ where: { id }, data });
    res.json({ assistant, message: 'Actualizado' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Error' });
  }
});

// POST /api/assistants/:id/activate
router.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    await prisma.assistant.updateMany({ where: { userId }, data: { isActive: false } });
    const assistant = await prisma.assistant.update({ where: { id: req.params.id }, data: { isActive: true } });
    res.json({ assistant, message: 'Activado' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// ===== AUTO-APRENDIZAJE =====
// POST /api/assistants/learn - Analizar conversaciones y generar sugerencias
router.post('/learn', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { apiKey: true, apiKeyConnected: true } });
    if (!user?.apiKey) { res.status(400).json({ error: 'Configura tu API Key de OpenAI primero' }); return; }

    // Obtener últimas 20 conversaciones con mensajes
    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: {
        messages: { orderBy: { timestamp: 'desc' }, take: 10 }
      }
    });

    if (conversations.length === 0) {
      res.json({ suggestions: [], message: 'Sin conversaciones para analizar' }); return;
    }

    // Obtener asistente actual
    const assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true } });
    const currentContext = assistant?.context || '';

    // Construir resumen de conversaciones para análisis
    const convSummaries = conversations.map(c => {
      const msgs = [...c.messages].reverse();
      return {
        contact: c.recipientName || c.recipientId,
        stage: c.stage,
        messages: msgs.map(m => `${m.fromMe ? 'BOT' : 'CLIENTE'}: ${m.content}`).join('\n')
      };
    });

    const analysisPrompt = `Eres un experto en optimización de chatbots de ventas. Analiza estas conversaciones reales y el contexto actual del asistente para generar sugerencias de mejora.

CONTEXTO ACTUAL DEL ASISTENTE (primeros 2000 chars):
${currentContext.substring(0, 2000)}

ÚLTIMAS CONVERSACIONES:
${convSummaries.slice(0, 10).map((c, i) => 
  `--- Conversación ${i+1} con ${c.contact} (etapa: ${c.stage}) ---\n${c.messages}`
).join('\n\n')}

Genera exactamente 3-5 sugerencias concretas en JSON. Cada sugerencia debe ser una mejora específica al contexto del asistente basada en patrones reales de las conversaciones.

Enfócate en:
1. Preguntas frecuentes que el bot no supo responder bien
2. Información que los clientes piden pero no está en el contexto
3. Patrones de conversación que se pueden mejorar
4. Respuestas que fueron muy largas o confusas
5. Oportunidades de venta perdidas

RESPONDE SOLO con un JSON array así:
[
  {
    "type": "add_faq",
    "title": "Título corto de la sugerencia",
    "suggestion": "Texto exacto que se debe agregar al contexto",
    "reason": "Por qué se sugiere esto basado en las conversaciones"
  }
]

Tipos válidos: add_faq, improve_response, add_info, fix_error, add_greeting`;

    console.log(`🧠 Analizando ${conversations.length} conversaciones para auto-aprendizaje...`);

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.apiKey}` },
      body: JSON.stringify({
        model: assistant?.model || 'gpt-4-turbo-preview',
        messages: [{ role: 'user', content: analysisPrompt }],
        temperature: 0.3,
        max_tokens: 2000
      })
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      console.error('❌ OpenAI error:', err);
      res.status(500).json({ error: 'Error al analizar con OpenAI' }); return;
    }

    const aiData = await aiRes.json() as any;
    const raw = aiData.choices?.[0]?.message?.content || '[]';

    // Parse JSON (tolerante a markdown backticks)
    let suggestions: any[] = [];
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      suggestions = JSON.parse(cleaned);
    } catch {
      console.error('❌ Error parsing suggestions:', raw);
      suggestions = [];
    }

    // Agregar metadata
    const now = new Date().toISOString();
    suggestions = suggestions.map((s: any, i: number) => ({
      id: `learn_${Date.now()}_${i}`,
      ...s,
      date: now,
      applied: false,
      dismissed: false
    }));

    // Guardar en learningHistory
    if (assistant && suggestions.length > 0) {
      const existingHistory = (assistant.learningHistory as any[]) || [];
      await prisma.assistant.update({
        where: { id: assistant.id },
        data: { learningHistory: [...suggestions, ...existingHistory].slice(0, 50) }
      });
    }

    console.log(`✅ Auto-aprendizaje: ${suggestions.length} sugerencias generadas`);
    res.json({ suggestions, message: `${suggestions.length} sugerencias generadas` });
  } catch (error: any) {
    console.error('❌ Error learn:', error);
    res.status(500).json({ error: error.message || 'Error' });
  }
});

// POST /api/assistants/learn/apply - Aplicar una sugerencia al contexto
router.post('/learn/apply', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const { suggestionId, suggestion } = req.body;

    const assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true } });
    if (!assistant) { res.status(404).json({ error: 'Sin asistente' }); return; }

    // Agregar sugerencia al final del contexto
    const newContext = (assistant.context || '') + '\n\n' + suggestion;

    // Marcar como aplicada en learningHistory
    const history = (assistant.learningHistory as any[]) || [];
    const updatedHistory = history.map((h: any) => 
      h.id === suggestionId ? { ...h, applied: true, appliedAt: new Date().toISOString() } : h
    );

    await prisma.assistant.update({
      where: { id: assistant.id },
      data: { context: newContext, learningHistory: updatedHistory }
    });

    console.log(`✅ Sugerencia aplicada al contexto (+${suggestion.length} chars)`);
    res.json({ success: true, message: 'Sugerencia aplicada al contexto' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Error' });
  }
});

// POST /api/assistants/learn/dismiss - Descartar sugerencia
router.post('/learn/dismiss', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const { suggestionId } = req.body;
    const assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true } });
    if (!assistant) { res.status(404).json({ error: 'Sin asistente' }); return; }

    const history = (assistant.learningHistory as any[]) || [];
    const updatedHistory = history.map((h: any) => 
      h.id === suggestionId ? { ...h, dismissed: true } : h
    );

    await prisma.assistant.update({ where: { id: assistant.id }, data: { learningHistory: updatedHistory } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Error' });
  }
});

// POST /api/assistants/elevenlabs/voices
router.post('/elevenlabs/voices', async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;
    const response = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey } });
    if (response.ok) {
      const data = await response.json() as any;
      res.json({ voices: data.voices });
    } else {
      res.status(400).json({ error: 'API Key inválida' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

export default router;

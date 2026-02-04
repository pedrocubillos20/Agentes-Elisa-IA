import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

const getOwnerId = async (userId: string): Promise<string> => {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  return u?.parentUserId || userId;
};

// GET /api/assistants?lineId=xxx
// Returns the assistant for a specific line, or the active one if no lineId
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { lineId } = req.query;

    let assistant = null;

    if (lineId) {
      // Find assistant specifically assigned to this line
      assistant = await prisma.assistant.findFirst({ 
        where: { userId: ownerId, whatsappLineId: lineId as string },
        orderBy: { updatedAt: 'desc' }
      });
      
      // If line has an assistantId in WhatsappLine, use that
      if (!assistant) {
        const line = await prisma.whatsappLine.findUnique({ where: { id: lineId as string }, select: { assistantId: true } });
        if (line?.assistantId) {
          assistant = await prisma.assistant.findUnique({ where: { id: line.assistantId } });
        }
      }
    }

    // Fallback: active assistant (legacy behavior)
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true }, orderBy: { updatedAt: 'desc' } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId }, orderBy: { updatedAt: 'desc' } });
      if (assistant) await prisma.assistant.update({ where: { id: assistant.id }, data: { isActive: true } });
    }

    // Also return all assistants for this user (for line assignment dropdown)
    const allAssistants = await prisma.assistant.findMany({ 
      where: { userId: ownerId }, 
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, whatsappLineId: true, isActive: true, updatedAt: true }
    });

    res.json({ assistant, assistants: allAssistants });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/assistants — Create or update assistant
// If lineId is provided, creates/updates the assistant for that specific line
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const body = req.body;
    const lineId = body.lineId || body.whatsappLineId || null;
    
    console.log(`💾 Guardando asistente para ${ownerId}: lineId=${lineId}, context=${body.context?.length || 0} chars`);

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

    let assistant;

    if (lineId) {
      // WORKSPACE MODE: find or create assistant for this specific line
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, whatsappLineId: lineId } });
      
      if (assistant) {
        // Update existing line assistant
        assistant = await prisma.assistant.update({ where: { id: assistant.id }, data });
      } else {
        // Create new assistant for this line
        data.whatsappLineId = lineId;
        assistant = await prisma.assistant.create({ data: { ...data, userId: ownerId } });
      }

      // Link the assistant to the WhatsappLine
      await prisma.whatsappLine.update({ 
        where: { id: lineId }, 
        data: { assistantId: assistant.id } 
      }).catch(() => {});
      
    } else {
      // LEGACY MODE: single assistant per user
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, whatsappLineId: null } });
      if (!assistant) assistant = await prisma.assistant.findFirst({ where: { userId: ownerId } });

      if (assistant) {
        await prisma.assistant.updateMany({ where: { userId: ownerId, id: { not: assistant.id }, whatsappLineId: null }, data: { isActive: false } });
        assistant = await prisma.assistant.update({ where: { id: assistant.id }, data });
      } else {
        assistant = await prisma.assistant.create({ data: { ...data, userId: ownerId } });
      }
    }

    console.log(`✅ Asistente guardado: ${assistant.name} ${lineId ? `(línea: ${lineId})` : '(global)'}`);
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
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;
    const existing = await prisma.assistant.findFirst({ where: { id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'No encontrado' }); return; }

    const body = req.body;
    const data: any = {};
    const fields = ['name', 'context', 'personality', 'businessInfo', 'instructions', 'knowledgeItems',
      'mediaItems', 'elevenLabsKey', 'selectedVoice', 'voiceEnabled', 'autoLearn', 'learningHistory',
      'model', 'temperature', 'maxTokens', 'isActive', 'whatsappLineId'];
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
    const ownerId = await getOwnerId(userId);
    await prisma.assistant.updateMany({ where: { userId: ownerId }, data: { isActive: false } });
    const assistant = await prisma.assistant.update({ where: { id: req.params.id }, data: { isActive: true } });
    res.json({ assistant, message: 'Activado' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// ===== AUTO-APRENDIZAJE =====
// POST /api/assistants/learn
router.post('/learn', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { lineId } = req.body;

    const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { apiKey: true, apiKeyConnected: true } });
    if (!user?.apiKey) { res.status(400).json({ error: 'Configura tu API Key de OpenAI primero' }); return; }

    // Get conversations filtered by line if provided
    const convWhere: any = { userId: ownerId };
    if (lineId) convWhere.whatsappLineId = lineId;

    const conversations = await prisma.conversation.findMany({
      where: convWhere, orderBy: { updatedAt: 'desc' }, take: 20,
      include: { messages: { orderBy: { timestamp: 'desc' }, take: 10 } }
    });

    if (conversations.length === 0) {
      res.json({ suggestions: [], message: 'Sin conversaciones para analizar' }); return;
    }

    // Get assistant for this line
    let assistant;
    if (lineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, whatsappLineId: lineId } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true } });
    }
    const currentContext = assistant?.context || '';

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

    console.log(`🧠 Analizando ${conversations.length} conversaciones (línea: ${lineId || 'global'})...`);

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.apiKey}` },
      body: JSON.stringify({
        model: assistant?.model || 'gpt-4-turbo-preview',
        messages: [{ role: 'user', content: analysisPrompt }],
        temperature: 0.3, max_tokens: 2000
      })
    });

    if (!aiRes.ok) { res.status(500).json({ error: 'Error al analizar con OpenAI' }); return; }

    const aiData = await aiRes.json() as any;
    const raw = aiData.choices?.[0]?.message?.content || '[]';

    let suggestions: any[] = [];
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      suggestions = JSON.parse(cleaned);
    } catch { suggestions = []; }

    const now = new Date().toISOString();
    suggestions = suggestions.map((s: any, i: number) => ({
      id: `learn_${Date.now()}_${i}`, ...s, date: now, applied: false, dismissed: false
    }));

    if (assistant && suggestions.length > 0) {
      const existingHistory = (assistant.learningHistory as any[]) || [];
      await prisma.assistant.update({
        where: { id: assistant.id },
        data: { learningHistory: [...suggestions, ...existingHistory].slice(0, 50) }
      });
    }

    res.json({ suggestions, message: `${suggestions.length} sugerencias generadas` });
  } catch (error: any) {
    console.error('❌ Error learn:', error);
    res.status(500).json({ error: error.message || 'Error' });
  }
});

// POST /api/assistants/learn/apply
router.post('/learn/apply', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { suggestionId, suggestion, lineId } = req.body;

    let assistant;
    if (lineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, whatsappLineId: lineId } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true } });
    }
    if (!assistant) { res.status(404).json({ error: 'Sin asistente' }); return; }

    const newContext = (assistant.context || '') + '\n\n' + suggestion;
    const history = (assistant.learningHistory as any[]) || [];
    const updatedHistory = history.map((h: any) => 
      h.id === suggestionId ? { ...h, applied: true, appliedAt: new Date().toISOString() } : h
    );

    await prisma.assistant.update({ where: { id: assistant.id }, data: { context: newContext, learningHistory: updatedHistory } });
    res.json({ success: true, message: 'Sugerencia aplicada al contexto' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Error' });
  }
});

// POST /api/assistants/learn/dismiss
router.post('/learn/dismiss', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { suggestionId, lineId } = req.body;
    
    let assistant;
    if (lineId) assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, whatsappLineId: lineId } });
    if (!assistant) assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true } });
    if (!assistant) { res.status(404).json({ error: 'Sin asistente' }); return; }

    const history = (assistant.learningHistory as any[]) || [];
    const updatedHistory = history.map((h: any) => h.id === suggestionId ? { ...h, dismissed: true } : h);
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
    } else { res.status(400).json({ error: 'API Key inválida' }); }
  } catch { res.status(500).json({ error: 'Error' }); }
});

export default router;

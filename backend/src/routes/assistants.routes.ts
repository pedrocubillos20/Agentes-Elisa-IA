import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// GET /api/assistants - returns assistant for specific line or default
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const { lineId } = req.query;

    console.log(`🔍 GET assistants: userId=${userId}, lineId=${lineId || 'none'}`);

    let assistant = null;

    if (lineId) {
      // 1. Buscar asistente específico de esta línea por whatsappLineId
      assistant = await prisma.assistant.findFirst({
        where: { userId, whatsappLineId: lineId as string }
      });
      console.log(`  Step 1 (by whatsappLineId): ${assistant ? assistant.name : 'null'}`);

      // 2. Si NO encontró, esta línea no tiene asistente → retornar null
      if (!assistant) {
        console.log(`  ✅ Línea ${lineId} sin asistente → retornando null`);
        res.json({ assistant: null, isNewLine: true });
        return;
      }
    } else {
      // Sin lineId: buscar el activo por defecto (legacy)
      assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true } });
      if (!assistant) {
        assistant = await prisma.assistant.findFirst({ where: { userId } });
        if (assistant) {
          assistant = await prisma.assistant.update({ where: { id: assistant.id }, data: { isActive: true } });
        }
      }
    }

    console.log(`  → Retornando: ${assistant ? assistant.name : 'null'}`);
    res.json({ assistant });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/assistants - create/update assistant (supports lineId)
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const body = req.body;
    const lineId = body.lineId || null;
    console.log(`💾 Guardando asistente para ${userId} ${lineId ? `(línea: ${lineId})` : '(global)'}: context=${body.context?.length || 0} chars`);

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
      // Buscar asistente específico de esta línea
      assistant = await prisma.assistant.findFirst({
        where: { userId, whatsappLineId: lineId }
      });

      if (assistant) {
        // Actualizar existente
        assistant = await prisma.assistant.update({
          where: { id: assistant.id },
          data
        });
      } else {
        // Crear nuevo para esta línea
        assistant = await prisma.assistant.create({
          data: { ...data, userId, whatsappLineId: lineId }
        });
      }

      // 🎯 EXTRAER ETAPAS AUTOMÁTICAMENTE DE LA BASE DE CONOCIMIENTO
      const extractedStages = extractStagesFromContext(body.context || '');
      if (extractedStages.length > 0) {
        await prisma.whatsappLine.update({
          where: { id: lineId },
          data: { 
            assistantId: assistant.id,
            customStages: extractedStages,
            stagesConfigured: true
          }
        }).catch(() => {});
        console.log(`🎯 Etapas auto-extraídas para línea ${lineId}: ${extractedStages.map((s: any) => s.label).join(', ')}`);
      } else {
        // Vincular con la línea sin etapas
        await prisma.whatsappLine.update({
          where: { id: lineId },
          data: { assistantId: assistant.id }
        }).catch(() => {});
      }
    } else {
      // Legacy: sin lineId, buscar/crear global
      assistant = await prisma.assistant.findFirst({ where: { userId } });

      if (assistant) {
        await prisma.assistant.updateMany({ where: { userId, id: { not: assistant.id } }, data: { isActive: false } });
        assistant = await prisma.assistant.update({ where: { id: assistant.id }, data });
      } else {
        assistant = await prisma.assistant.create({ data: { ...data, userId } });
      }
    }

    console.log(`✅ Asistente guardado: ${assistant.name} ${lineId ? `(línea: ${lineId})` : ''}`);
    res.json({ assistant, message: 'Guardado correctamente' });
  } catch (error: any) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: error.message || 'Error' });
  }
});

// 🎯 FUNCIÓN: Extraer etapas automáticamente del contexto/base de conocimiento
function extractStagesFromContext(context: string): any[] {
  if (!context || context.length < 50) return [];
  
  const stages: any[] = [];
  const colors = ['blue', 'cyan', 'yellow', 'orange', 'purple', 'green', 'pink', 'red', 'indigo', 'teal'];
  
  // Buscar secciones que contengan etapas
  const sectionPatterns = [
    /##?\s*(?:ETAPAS?|FLUJO|EMBUDO|PIPELINE|FASES?|PROCESO)[^\n]*\n([\s\S]*?)(?=\n##|\n\n\n|$)/gi,
    /(?:etapas?|flujo|embudo|pipeline|fases?|proceso)[\s:]+\n?([\s\S]*?)(?=\n##|\n\n\n|$)/gi
  ];
  
  let foundItems: string[] = [];
  
  for (const pattern of sectionPatterns) {
    const matches = context.matchAll(pattern);
    for (const match of matches) {
      const section = match[1] || '';
      // Buscar items con bullets o números
      const items = section.match(/[-•*\d.]\s*\*?\*?([^*\n-•]+)/g);
      if (items) {
        items.forEach(item => {
          const clean = item.replace(/[-•*\d.]/g, '').replace(/\*\*/g, '').trim();
          if (clean && clean.length > 2 && clean.length < 50) {
            foundItems.push(clean);
          }
        });
      }
    }
  }
  
  // Si no encontramos con patrones de sección, buscar keywords comunes
  if (foundItems.length === 0) {
    const keywords = [
      'saludo', 'interesado', 'cotización', 'cotizacion', 'pendiente', 'pedido', 
      'confirmado', 'perdido', 'nuevo', 'calidad', 'color', 'talla', 'pago',
      'entrega', 'enviado', 'completado', 'cerrado', 'seguimiento'
    ];
    
    const lines = context.split('\n');
    for (const line of lines) {
      const lower = line.toLowerCase();
      for (const kw of keywords) {
        if (lower.includes(kw) && line.match(/[-•*\d.]\s/)) {
          const clean = line.replace(/[-•*\d.]/g, '').replace(/\*\*/g, '').trim();
          if (clean && clean.length > 2 && clean.length < 50 && !foundItems.includes(clean)) {
            foundItems.push(clean);
          }
        }
      }
    }
  }
  
  // Eliminar duplicados y crear stages con colores
  const unique = Array.from(new Set(foundItems));
  unique.slice(0, 12).forEach((label, index) => {
    stages.push({
      id: label,
      label: label,
      color: colors[index % colors.length],
      description: ''
    });
  });
  
  // Si no encontramos nada, crear etapas por defecto básicas
  if (stages.length === 0) {
    return [
      { id: 'Saludo', label: 'Saludo', color: 'blue', description: 'Primer contacto' },
      { id: 'Interesado', label: 'Interesado', color: 'cyan', description: 'Mostró interés' },
      { id: 'En Cotización', label: 'En Cotización', color: 'yellow', description: 'Pidiendo información' },
      { id: 'Pendiente Info', label: 'Pendiente Info', color: 'orange', description: 'Faltan datos' },
      { id: 'Realizó Pedido', label: 'Realizó Pedido', color: 'green', description: 'Confirmó compra' },
      { id: 'Confirmado', label: 'Confirmado', color: 'purple', description: 'Pedido completo' },
      { id: 'Perdido', label: 'Perdido', color: 'red', description: 'No compró' }
    ];
  }
  
  return stages;
}

// PUT /api/assistants/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const { id } = req.params;
    const existing = await prisma.assistant.findFirst({ where: { id, userId } });
    if (!existing) { res.status(404).json({ error: 'No encontrado' }); return; }

    const body = req.body;
    const assistant = await prisma.assistant.update({
      where: { id },
      data: {
        name: body.name,
        context: body.context,
        personality: body.personality,
        businessInfo: body.businessInfo,
        instructions: body.instructions,
        knowledgeItems: body.knowledgeItems,
        mediaItems: body.mediaItems,
        elevenLabsKey: body.elevenLabsKey,
        selectedVoice: body.selectedVoice,
        voiceEnabled: body.voiceEnabled,
        autoLearn: body.autoLearn,
        learningHistory: body.learningHistory,
        model: body.model,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        isActive: body.isActive
      }
    });

    res.json({ assistant, message: 'Actualizado' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Error' });
  }
});

// POST /api/assistants/learn - Auto-aprendizaje (filtra por lineId)
router.post('/learn', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const { lineId } = req.body;

    // Buscar asistente correcto
    let assistant;
    if (lineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId, whatsappLineId: lineId, isActive: true } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true } });
    }
    if (!assistant) { res.status(404).json({ error: 'Sin asistente' }); return; }

    // Obtener conversaciones recientes filtradas por línea
    const convWhere: any = { userId };
    if (lineId) convWhere.whatsappLineId = lineId;

    const recentConversations = await prisma.conversation.findMany({
      where: convWhere,
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: { messages: { orderBy: { timestamp: 'desc' }, take: 20 } }
    });

    if (recentConversations.length === 0) {
      res.json({ suggestions: [], message: 'No hay conversaciones para analizar' });
      return;
    }

    // Extraer patrones
    const allMessages = recentConversations.flatMap(c => c.messages);
    const customerMessages = allMessages.filter(m => !m.fromMe).map(m => m.content);
    
    // Análisis simple de patrones frecuentes
    const wordFreq: Record<string, number> = {};
    customerMessages.forEach(msg => {
      msg.toLowerCase().split(/\s+/).forEach(word => {
        if (word.length > 3) wordFreq[word] = (wordFreq[word] || 0) + 1;
      });
    });

    const topWords = Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const commonQuestions = customerMessages.filter(m => m.includes('?')).slice(0, 5);
    
    const suggestions = [
      {
        id: `learn_${Date.now()}`,
        type: 'pattern',
        title: 'Temas frecuentes detectados',
        content: `Los clientes preguntan frecuentemente sobre: ${topWords.map(([w, c]) => `${w} (${c}x)`).join(', ')}`,
        applied: false,
        createdAt: new Date().toISOString()
      }
    ];

    if (commonQuestions.length > 0) {
      suggestions.push({
        id: `learn_q_${Date.now()}`,
        type: 'questions',
        title: 'Preguntas frecuentes',
        content: `Preguntas comunes:\n${commonQuestions.map(q => `- ${q}`).join('\n')}`,
        applied: false,
        createdAt: new Date().toISOString()
      });
    }

    // Guardar en learningHistory
    const history = [...((assistant.learningHistory as any[]) || []), ...suggestions];
    await prisma.assistant.update({
      where: { id: assistant.id },
      data: { learningHistory: history }
    });

    console.log(`🧠 Auto-aprendizaje: ${suggestions.length} sugerencias generadas${lineId ? ` (línea: ${lineId})` : ''}`);
    res.json({ suggestions, message: `${suggestions.length} sugerencias generadas` });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Error' });
  }
});

// POST /api/assistants/learn/apply - Aplicar sugerencia al contexto
router.post('/learn/apply', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const { suggestionId, suggestion, lineId } = req.body;
    
    let assistant;
    if (lineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId, whatsappLineId: lineId, isActive: true } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true } });
    }
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

    const { suggestionId, lineId } = req.body;
    let assistant;
    if (lineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId, whatsappLineId: lineId, isActive: true } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId, isActive: true } });
    }
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

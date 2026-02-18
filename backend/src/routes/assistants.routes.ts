import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getOwnerId } from '../lib/helpers';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();
// GET /api/assistants - returns assistant for specific line or default
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { lineId } = req.query;

    let assistant = null;

    if (lineId) {
      assistant = await prisma.assistant.findFirst({
        where: { userId: ownerId, whatsappLineId: lineId as string }
      });

      if (!assistant) {
        res.json({ assistant: null, isNewLine: true });
        return;
      }
    } else {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true } });
      if (!assistant) {
        assistant = await prisma.assistant.findFirst({ where: { userId: ownerId } });
        if (assistant) {
          assistant = await prisma.assistant.update({ where: { id: assistant.id }, data: { isActive: true } });
        }
      }
    }

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
    const ownerId = await getOwnerId(userId);

    const body = req.body;
    const lineId = body.lineId || null;

    const mediaItems = body.mediaItems || [];

    const data: any = {
      name: body.name || 'Asistente',
      context: body.context || null,
      personality: body.personality || null,
      businessInfo: body.businessInfo || null,
      instructions: body.instructions || null,
      knowledgeItems: body.knowledgeItems || [],
      mediaItems,
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
      assistant = await prisma.assistant.findFirst({
        where: { userId: ownerId, whatsappLineId: lineId }
      });

      if (assistant) {
        assistant = await prisma.assistant.update({
          where: { id: assistant.id },
          data
        });
      } else {
        assistant = await prisma.assistant.create({
          data: { ...data, userId: ownerId, whatsappLineId: lineId }
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
      } else {
        await prisma.whatsappLine.update({
          where: { id: lineId },
          data: { assistantId: assistant.id }
        }).catch(() => {});
      }
    } else {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId } });

      if (assistant) {
        await prisma.assistant.updateMany({ where: { userId: ownerId, id: { not: assistant.id } }, data: { isActive: false } });
        assistant = await prisma.assistant.update({ where: { id: assistant.id }, data });
      } else {
        assistant = await prisma.assistant.create({ data: { ...data, userId: ownerId } });
      }
    }

    res.json({ assistant, message: 'Guardado correctamente' });
  } catch (error: any) {
    console.error('❌ Error guardando asistente:', error.message || error);
    // Provide specific error messages for common failures
    if (error.code === 'P2024' || error.message?.includes('timeout')) {
      res.status(408).json({ error: 'Los archivos son muy pesados y se agotó el tiempo. Intenta eliminar algunos archivos de video/audio grandes y guarda de nuevo.' });
    } else if (error.code === 'P2000') {
      res.status(413).json({ error: 'Los datos son demasiado grandes para guardar. Reduce el tamaño o cantidad de archivos multimedia.' });
    } else {
      res.status(500).json({ error: error.message || 'Error al guardar' });
    }
  }
});

// 🎯 FUNCIÓN: Extraer etapas automáticamente del contexto/base de conocimiento
function extractStagesFromContext(context: string): any[] {
  if (!context || context.length < 50) return [];
  
  const stages: any[] = [];
  const colors = ['blue', 'cyan', 'yellow', 'orange', 'purple', 'green', 'pink', 'red', 'indigo', 'teal'];
  
  // ===== BUSCAR SECCIÓN DE ETAPAS =====
  // Formatos válidos:
  // ## ETAPAS DEL PIPELINE
  // ## 🎯 ETAPAS DEL PIPELINE (CRM AUTOMÁTICO)  
  // # ETAPAS
  
  const sectionMatch = context.match(/##?\s*[^\n]*?ETAPAS[^\n]*(?:PIPELINE|CRM|FLUJO|AUTOMÁTICO)?[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n\n\n|$)/i);
  
  if (!sectionMatch) {
    console.log('  📋 No se encontró sección de etapas en el contexto');
    return [];
  }
  
  const section = sectionMatch[1];
  const foundItems: string[] = [];
  
  const lines = section.split('\n');
  for (const line of lines) {
    let stageName = '';
    
    // FORMATO 1: Tabla Markdown → | **Etapa** | Descripción |
    const tableMatch = line.match(/\|\s*\*\*([^*|]+)\*\*\s*\|/);
    if (tableMatch) {
      stageName = tableMatch[1].trim();
    }
    
    // FORMATO 2: Lista → - **Etapa** → Descripción  o  - Etapa
    if (!stageName) {
      const listMatch = line.match(/^[-*]\s*\*?\*?([^→\n|]+?)(?:\*\*)?(?:\s*[→|:].*)?$/);
      if (listMatch) {
        stageName = listMatch[1].replace(/\*\*/g, '').trim();
      }
    }
    
    // FORMATO 3: Lista numerada → 1. **Etapa** o 1. Etapa
    if (!stageName) {
      const numMatch = line.match(/^\d+\.\s*\*?\*?([^→\n|]+?)(?:\*\*)?(?:\s*[→|:].*)?$/);
      if (numMatch) {
        stageName = numMatch[1].replace(/\*\*/g, '').trim();
      }
    }
    
    // Validar que es un nombre de etapa válido
    if (stageName && 
        stageName.length >= 2 && 
        stageName.length <= 40 && 
        !stageName.toLowerCase().includes('etapa') &&     // Evitar header "Etapa"
        !stageName.toLowerCase().includes('descripción') && // Evitar header "Descripción"
        !stageName.toLowerCase().includes('cliente') &&
        !stageName.toLowerCase().includes('sistema') &&
        !stageName.toLowerCase().includes('bot') &&
        !stageName.includes('---') &&                       // Evitar separadores de tabla
        !stageName.match(/^[-|]+$/)) {                      // Evitar líneas de tabla
      foundItems.push(stageName);
    }
  }
  
  // Necesitamos al menos 2 etapas válidas
  if (foundItems.length < 2) {
    console.log(`  📋 Muy pocas etapas encontradas (${foundItems.length}), retornando vacío`);
    return [];
  }
  
  // Eliminar duplicados y crear stages con colores
  const unique = Array.from(new Set(foundItems));
  console.log(`  📋 Etapas extraídas del MD: [${unique.join(', ')}]`);
  
  unique.slice(0, 15).forEach((label, index) => {
    stages.push({
      id: label,
      label: label,
      color: colors[index % colors.length],
      description: ''
    });
  });
  
  return stages;
}

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
    const ownerId = await getOwnerId(userId);
    const { lineId } = req.body;

    // Buscar asistente correcto
    let assistant;
    if (lineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, whatsappLineId: lineId, isActive: true } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true } });
    }
    if (!assistant) { res.status(404).json({ error: 'Sin asistente' }); return; }

    // Obtener conversaciones recientes filtradas por línea
    const convWhere: any = { userId: ownerId };
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
    const ownerId = await getOwnerId(userId);

    const { suggestionId, suggestion, lineId } = req.body;
    
    let assistant;
    if (lineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, whatsappLineId: lineId, isActive: true } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true } });
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
    const ownerId = await getOwnerId(userId);

    const { suggestionId, lineId } = req.body;
    let assistant;
    if (lineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, whatsappLineId: lineId, isActive: true } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true } });
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
    if (!apiKey) return res.status(400).json({ error: 'API Key requerida' });
    const response = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey } });
    if (response.ok) {
      const data = await response.json() as any;
      res.json({ voices: data.voices });
    } else {
      const errText = await response.text().catch(() => '');
      res.status(400).json({ error: `API Key inválida (${response.status})`, detail: errText.substring(0, 200) });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Error de conexión: ' + error.message });
  }
});

// POST /api/assistants/elevenlabs/preview — Previsualizar voz
router.post('/elevenlabs/preview', async (req: Request, res: Response) => {
  try {
    const { apiKey, voiceId, text } = req.body;
    if (!apiKey || !voiceId) return res.status(400).json({ error: 'apiKey y voiceId requeridos' });
    
    const previewText = text || 'Hola, soy tu asistente virtual. ¿En qué puedo ayudarte hoy?';
    
    // Intentar con multilingual v2, fallback a monolingual v1
    const models = ['eleven_multilingual_v2', 'eleven_multilingual_v1', 'eleven_monolingual_v1'];
    const errors: string[] = [];
    
    for (const model of models) {
      try {
        console.log(`🔊 TTS preview: model=${model}, voiceId=${voiceId.substring(0, 8)}...`);
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg'
          },
          body: JSON.stringify({
            text: previewText,
            model_id: model,
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
          })
        });
        
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          console.log(`🔊 TTS OK: model=${model}, size=${arrayBuffer.byteLength} bytes`);
          const base64 = Buffer.from(arrayBuffer).toString('base64');
          return res.json({ audio: `data:audio/mpeg;base64,${base64}`, model });
        }
        
        const errText = await response.text().catch(() => '');
        errors.push(`${model}: ${response.status} - ${errText.substring(0, 150)}`);
        console.error(`❌ TTS ${model}: ${response.status} - ${errText.substring(0, 150)}`);
        
        // Si es error de autenticación no intentar más modelos
        if (response.status === 401) break;
      } catch (modelErr: any) {
        errors.push(`${model}: ${modelErr.message}`);
        console.error(`❌ TTS ${model} exception:`, modelErr.message);
      }
    }
    
    res.status(400).json({ error: `No se pudo generar audio. Detalles: ${errors.join(' | ')}` });
  } catch (error: any) {
    console.error('❌ TTS preview error:', error.message);
    res.status(500).json({ error: 'Error servidor: ' + error.message });
  }
});

export default router;

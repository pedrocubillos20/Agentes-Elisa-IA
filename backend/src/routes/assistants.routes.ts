import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getOwnerId } from '../lib/helpers';
import { AuthRequest } from '../middleware/auth.middleware';
import { removeFile } from '../lib/storage';

const router = Router();

// ====================================================
// 🧹 CLEANUP HELPERS
// ====================================================

/**
 * Compare old vs new mediaItems and delete files from R2/storage
 * that were removed by the user
 */
const cleanupRemovedMedia = async (userId: string, oldItems: any[], newItems: any[]) => {
  if (!oldItems?.length) return;

  const newUrls = new Set((newItems || []).map((m: any) => m.url).filter(Boolean));
  // For catalogs, also track image URLs
  (newItems || []).forEach((m: any) => {
    if (m.images) m.images.forEach((img: any) => { if (img.url) newUrls.add(img.url); });
  });

  let deleted = 0;

  for (const oldItem of oldItems) {
    // Single file media (video, audio, image)
    if (oldItem.url && oldItem.key && !newUrls.has(oldItem.url)) {
      try {
        await removeFile(userId, oldItem.key);
        deleted++;
      } catch (e: any) {
        console.error(`⚠️ Error borrando media ${oldItem.key}:`, e.message);
      }
    }

    // Catalog images
    if (oldItem.images) {
      for (const img of oldItem.images) {
        if (img.url && img.key && !newUrls.has(img.url)) {
          try {
            await removeFile(userId, img.key);
            deleted++;
          } catch (e: any) {
            console.error(`⚠️ Error borrando imagen ${img.key}:`, e.message);
          }
        }
      }
    }
  }

  if (deleted > 0) {
    console.log(`🧹 Cleanup: ${deleted} archivos eliminados de storage para user ${userId.slice(0, 8)}...`);
  }
};

/**
 * Delete ALL media files for an assistant from R2/storage
 */
const deleteAllAssistantMedia = async (userId: string, mediaItems: any[]) => {
  if (!mediaItems?.length) return;
  let deleted = 0;

  for (const item of mediaItems) {
    if (item.url && item.key) {
      try { await removeFile(userId, item.key); deleted++; } catch {}
    }
    if (item.images) {
      for (const img of item.images) {
        if (img.url && img.key) {
          try { await removeFile(userId, img.key); deleted++; } catch {}
        }
      }
    }
  }

  if (deleted > 0) {
    console.log(`🧹 Cleanup: ${deleted} archivos eliminados (all media) para user ${userId.slice(0, 8)}...`);
  }
};

/**
 * Trim learningHistory to max N entries, removing oldest dismissed/applied ones first
 */
const trimLearningHistory = (history: any[], maxEntries: number = 20): any[] => {
  if (!history || history.length <= maxEntries) return history || [];

  // Sort: keep active (not applied, not dismissed) first, then by date
  const sorted = [...history].sort((a, b) => {
    if (a.dismissed && !b.dismissed) return 1;
    if (!a.dismissed && b.dismissed) return -1;
    if (a.applied && !b.applied) return 1;
    if (!a.applied && b.applied) return -1;
    return 0;
  });

  return sorted.slice(0, maxEntries);
};


// ====================================================
// 📍 ROUTES
// ====================================================

// GET /api/assistants
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

// POST /api/assistants - create/update assistant
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const body = req.body;
    const lineId = body.lineId || null;
    const newMediaItems = body.mediaItems || [];

    const data: any = {
      name: body.name || 'Asistente',
      context: body.context || null,
      // 🛡️ PRESERVE: Solo actualizar si el frontend envía estos campos explícitamente
      // El frontend principal (asistentes/page.tsx) no envía estos campos,
      // así que los preservamos del asistente existente si no vienen en el body
      ...(body.personality !== undefined && { personality: body.personality || null }),
      ...(body.businessInfo !== undefined && { businessInfo: body.businessInfo || null }),
      ...(body.instructions !== undefined && { instructions: body.instructions || null }),
      // 🧩 MÓDULOS MODULARES v2
      ...(body.modIdentidad !== undefined && { modIdentidad: body.modIdentidad || null }),
      ...(body.modReglas !== undefined && { modReglas: body.modReglas || null }),
      ...(body.modProductos !== undefined && { modProductos: body.modProductos || null }),
      ...(body.modAgenda !== undefined && { modAgenda: body.modAgenda || null }),
      ...(body.modFlujo !== undefined && { modFlujo: body.modFlujo || null }),
      ...(body.modAcciones !== undefined && { modAcciones: body.modAcciones || null }),
      ...(body.modAdmin !== undefined && { modAdmin: body.modAdmin || null }),
      ...(body.agenteCliente !== undefined && { agenteCliente: body.agenteCliente || null }),
      ...(body.agenteAdmin !== undefined && { agenteAdmin: body.agenteAdmin || null }),
      knowledgeItems: body.knowledgeItems || [],
      mediaItems: newMediaItems,
      elevenLabsKey: body.elevenLabsKey || null,
      selectedVoice: body.selectedVoice || null,
      voiceEnabled: body.voiceEnabled || false,
      // 📍 Cobertura de domicilio (opcional)
      coverageLat: body.coverageLat ?? null,
      coverageLon: body.coverageLon ?? null,
      coverageRadiusKm: body.coverageRadiusKm ?? null,
      autoLearn: body.autoLearn !== false,
      // ✅ Trim learningHistory to prevent bloat (max 20 entries)
      learningHistory: trimLearningHistory(body.learningHistory || [], 20),
      model: body.model || 'gpt-4o-mini',
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
        // ✅ CLEANUP: Delete removed media files from R2/storage
        const oldMediaItems = (assistant.mediaItems as any[]) || [];
        await cleanupRemovedMedia(ownerId, oldMediaItems, newMediaItems);

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
        // ✅ CLEANUP: Delete removed media files from R2/storage
        const oldMediaItems = (assistant.mediaItems as any[]) || [];
        await cleanupRemovedMedia(ownerId, oldMediaItems, newMediaItems);

        // ✅ DELETE orphan assistants (instead of just deactivating)
        const orphans = await prisma.assistant.findMany({
          where: { userId: ownerId, id: { not: assistant.id } },
          select: { id: true, mediaItems: true }
        });

        for (const orphan of orphans) {
          // Delete orphan media files
          await deleteAllAssistantMedia(ownerId, (orphan.mediaItems as any[]) || []);
        }

        // Delete orphan assistant records
        if (orphans.length > 0) {
          await prisma.assistant.deleteMany({
            where: { userId: ownerId, id: { not: assistant.id } }
          });
          console.log(`🧹 Cleanup: ${orphans.length} asistentes huérfanos eliminados para user ${ownerId.slice(0, 8)}...`);
        }

        assistant = await prisma.assistant.update({ where: { id: assistant.id }, data });
      } else {
        assistant = await prisma.assistant.create({ data: { ...data, userId: ownerId } });
      }
    }

    res.json({ assistant, message: 'Guardado correctamente' });
  } catch (error: any) {
    console.error('❌ Error guardando asistente:', error.message || error);
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

    if (stageName &&
        stageName.length >= 2 &&
        stageName.length <= 40 &&
        !stageName.toLowerCase().includes('etapa') &&
        !stageName.toLowerCase().includes('descripción') &&
        !stageName.toLowerCase().includes('cliente') &&
        !stageName.toLowerCase().includes('sistema') &&
        !stageName.toLowerCase().includes('bot') &&
        !stageName.includes('---') &&
        !stageName.match(/^[-|]+$/)) {
      foundItems.push(stageName);
    }
  }

  if (foundItems.length < 2) return [];

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
    const newMediaItems = body.mediaItems || [];

    // ✅ CLEANUP: Delete removed media files from R2/storage
    const oldMediaItems = (existing.mediaItems as any[]) || [];
    await cleanupRemovedMedia(ownerId, oldMediaItems, newMediaItems);

    const assistant = await prisma.assistant.update({
      where: { id },
      data: {
        name: body.name,
        context: body.context,
        personality: body.personality,
        businessInfo: body.businessInfo,
        instructions: body.instructions,
        knowledgeItems: body.knowledgeItems,
        mediaItems: newMediaItems,
        elevenLabsKey: body.elevenLabsKey,
        selectedVoice: body.selectedVoice,
        voiceEnabled: body.voiceEnabled,
        coverageLat: body.coverageLat ?? null,
        coverageLon: body.coverageLon ?? null,
        coverageRadiusKm: body.coverageRadiusKm ?? null,
        autoLearn: body.autoLearn,
        learningHistory: trimLearningHistory(body.learningHistory || [], 20),
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

// ====================================================
// 🗑️ DELETE ASSISTANT — Full cleanup
// ====================================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;

    const existing = await prisma.assistant.findFirst({ where: { id, userId: ownerId } });
    if (!existing) { res.status(404).json({ error: 'No encontrado' }); return; }

    // ✅ Delete ALL media files from R2/storage
    const mediaItems = (existing.mediaItems as any[]) || [];
    await deleteAllAssistantMedia(ownerId, mediaItems);

    // ✅ Delete the assistant record completely
    await prisma.assistant.delete({ where: { id } });

    // ✅ Unlink from WhatsApp line
    if (existing.whatsappLineId) {
      await prisma.whatsappLine.update({
        where: { id: existing.whatsappLineId },
        data: { assistantId: null }
      }).catch(() => {});
    }

    console.log(`🗑️ Asistente eliminado completamente: ${existing.name} (${id.slice(0, 8)}...)`);
    res.json({ success: true, message: 'Asistente y archivos eliminados completamente' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Error al eliminar' });
  }
});

// ====================================================
// 🧹 CLEANUP ENDPOINT — Manual cleanup for admin
// ====================================================
router.post('/cleanup', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    let cleaned = { orphanAssistants: 0, orphanFiles: 0, trimmedHistory: 0 };

    // 1. Find assistants for this user
    const assistants = await prisma.assistant.findMany({
      where: { userId: ownerId },
      orderBy: { updatedAt: 'desc' }
    });

    // 2. Get active line IDs
    const lines = await prisma.whatsappLine.findMany({
      where: { userId: ownerId },
      select: { id: true, assistantId: true }
    });
    const activeLineIds = new Set(lines.map(l => l.id));
    const activeAssistantIds = new Set(lines.map(l => l.assistantId).filter(Boolean));

    // 3. Delete orphan assistants (not linked to any active line, except the primary one)
    for (const ast of assistants) {
      if (ast.whatsappLineId && !activeLineIds.has(ast.whatsappLineId) && !activeAssistantIds.has(ast.id)) {
        await deleteAllAssistantMedia(ownerId, (ast.mediaItems as any[]) || []);
        await prisma.assistant.delete({ where: { id: ast.id } });
        cleaned.orphanAssistants++;
      }
    }

    // 4. Trim learningHistory on all remaining assistants
    const remaining = await prisma.assistant.findMany({ where: { userId: ownerId } });
    for (const ast of remaining) {
      const history = (ast.learningHistory as any[]) || [];
      if (history.length > 20) {
        await prisma.assistant.update({
          where: { id: ast.id },
          data: { learningHistory: trimLearningHistory(history, 20) }
        });
        cleaned.trimmedHistory += history.length - 20;
      }
    }

    // 5. Find orphan MediaFile records (files in DB but not referenced by any assistant)
    const allMediaFiles = await prisma.mediaFile.findMany({
      where: { userId: ownerId, category: 'assistant' }
    });

    // Collect all URLs referenced by assistants
    const referencedUrls = new Set<string>();
    for (const ast of remaining) {
      const items = (ast.mediaItems as any[]) || [];
      for (const item of items) {
        if (item.url) referencedUrls.add(item.url);
        if (item.images) item.images.forEach((img: any) => { if (img.url) referencedUrls.add(img.url); });
      }
    }

    // Delete orphan files
    for (const file of allMediaFiles) {
      if (!referencedUrls.has(file.url)) {
        await removeFile(ownerId, file.key);
        cleaned.orphanFiles++;
      }
    }

    console.log(`🧹 Cleanup completo para ${ownerId.slice(0, 8)}...: ${JSON.stringify(cleaned)}`);
    res.json({ success: true, cleaned });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Error en cleanup' });
  }
});


// ====================================================
// 🧠 AUTO-APRENDIZAJE
// ====================================================

// POST /api/assistants/learn
router.post('/learn', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { lineId } = req.body;

    let assistant;
    if (lineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, whatsappLineId: lineId, isActive: true } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true } });
    }
    if (!assistant) { res.status(404).json({ error: 'Sin asistente' }); return; }

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

    const allMessages = recentConversations.flatMap(c => c.messages);
    const customerMessages = allMessages.filter(m => !m.fromMe).map(m => m.content);

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

    // ✅ Trim history BEFORE adding new entries
    const oldHistory = (assistant.learningHistory as any[]) || [];
    const trimmed = trimLearningHistory(oldHistory, 18); // Leave room for new suggestions
    const history = [...trimmed, ...suggestions];

    await prisma.assistant.update({
      where: { id: assistant.id },
      data: { learningHistory: history }
    });

    console.log(`🧠 Auto-aprendizaje: ${suggestions.length} sugerencias (history: ${history.length} entries)${lineId ? ` (línea: ${lineId})` : ''}`);
    res.json({ suggestions, message: `${suggestions.length} sugerencias generadas` });
  } catch (error: any) {
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
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, whatsappLineId: lineId, isActive: true } });
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

    await prisma.assistant.update({
      where: { id: assistant.id },
      data: { context: newContext, learningHistory: trimLearningHistory(updatedHistory, 20) }
    });

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
    if (lineId) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, whatsappLineId: lineId, isActive: true } });
    }
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId: ownerId, isActive: true } });
    }
    if (!assistant) { res.status(404).json({ error: 'Sin asistente' }); return; }

    // ✅ Remove dismissed suggestion entirely (don't just mark it)
    const history = (assistant.learningHistory as any[]) || [];
    const cleaned = history.filter((h: any) => h.id !== suggestionId);

    await prisma.assistant.update({ where: { id: assistant.id }, data: { learningHistory: cleaned } });
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

// POST /api/assistants/elevenlabs/preview
router.post('/elevenlabs/preview', async (req: Request, res: Response) => {
  try {
    const { apiKey, voiceId, text } = req.body;
    if (!apiKey || !voiceId) return res.status(400).json({ error: 'apiKey y voiceId requeridos' });

    const previewText = text || 'Hola, soy tu asistente virtual. ¿En qué puedo ayudarte hoy?';
    const models = ['eleven_multilingual_v2', 'eleven_multilingual_v1', 'eleven_monolingual_v1'];
    const errors: string[] = [];

    for (const model of models) {
      try {
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
          const base64 = Buffer.from(arrayBuffer).toString('base64');
          return res.json({ audio: `data:audio/mpeg;base64,${base64}`, model });
        }

        const errText = await response.text().catch(() => '');
        errors.push(`${model}: ${response.status} - ${errText.substring(0, 150)}`);
        if (response.status === 401) break;
      } catch (modelErr: any) {
        errors.push(`${model}: ${modelErr.message}`);
      }
    }

    res.status(400).json({ error: `No se pudo generar audio. Detalles: ${errors.join(' | ')}` });
  } catch (error: any) {
    res.status(500).json({ error: 'Error servidor: ' + error.message });
  }
});

export default router;

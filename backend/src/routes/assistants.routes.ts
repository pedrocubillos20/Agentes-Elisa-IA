import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// GET /api/assistants - Obtener asistente del usuario
// FIX: Devuelve TANTO { assistant } como { assistants } para compatibilidad
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    // Obtener TODOS los asistentes del usuario, ordenados por más reciente
    const allAssistants = await prisma.assistant.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' }
    });

    // Buscar el activo
    let active = allAssistants.find(a => a.isActive);

    // Si no hay activo pero hay asistentes, activar el más reciente
    if (!active && allAssistants.length > 0) {
      active = await prisma.assistant.update({
        where: { id: allAssistants[0].id },
        data: { isActive: true }
      });
    }

    // Si hay más de un asistente activo, desactivar los demás
    const activeOnes = allAssistants.filter(a => a.isActive);
    if (activeOnes.length > 1) {
      const keepId = active?.id || activeOnes[0].id;
      await prisma.assistant.updateMany({
        where: { userId, id: { not: keepId } },
        data: { isActive: false }
      });
    }

    // Devolver en AMBOS formatos para compatibilidad
    res.json({ 
      assistant: active || null,
      assistants: allAssistants 
    });
  } catch (error) {
    console.error('Error obteniendo asistente:', error);
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/assistants - Crear o actualizar asistente
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const body = req.body;

    console.log(`💾 Guardando asistente para usuario ${userId}:`);
    console.log(`   - name: ${body.name || 'Sin nombre'}`);
    console.log(`   - context: ${body.context ? `${body.context.length} chars` : 'VACÍO'}`);
    console.log(`   - personality: ${body.personality ? `${body.personality.length} chars` : 'VACÍO'}`);
    console.log(`   - businessInfo: ${body.businessInfo ? `${body.businessInfo.length} chars` : 'VACÍO'}`);
    console.log(`   - instructions: ${body.instructions ? `${body.instructions.length} chars` : 'VACÍO'}`);

    const data: any = {
      name: body.name || 'Asistente Principal',
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
      model: body.model || 'gpt-4-turbo-preview',
      temperature: body.temperature || 0.7,
      maxTokens: body.maxTokens || 500,
      isActive: true
    };

    // FIX: Desactivar TODOS primero
    await prisma.assistant.updateMany({
      where: { userId },
      data: { isActive: false }
    });

    // Buscar asistente existente - el más reciente con contexto O el primero
    let assistant = await prisma.assistant.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' }
    });

    if (assistant) {
      assistant = await prisma.assistant.update({
        where: { id: assistant.id },
        data
      });
      console.log(`✅ Asistente actualizado: ${assistant.name} (ID: ${assistant.id}, context: ${assistant.context?.length || 0} chars)`);
    } else {
      assistant = await prisma.assistant.create({
        data: { ...data, userId }
      });
      console.log(`✅ Asistente creado: ${assistant.name} (ID: ${assistant.id})`);
    }

    res.json({ assistant, message: 'Guardado correctamente' });
  } catch (error: any) {
    console.error('❌ Error guardando asistente:', error);
    res.status(500).json({ error: error.message || 'Error guardando asistente' });
  }
});

// PUT /api/assistants/:id - Actualizar asistente específico
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const { id } = req.params;
    const body = req.body;

    const existing = await prisma.assistant.findFirst({ where: { id, userId } });
    if (!existing) { res.status(404).json({ error: 'Asistente no encontrado' }); return; }

    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.context !== undefined) data.context = body.context;
    if (body.personality !== undefined) data.personality = body.personality;
    if (body.businessInfo !== undefined) data.businessInfo = body.businessInfo;
    if (body.instructions !== undefined) data.instructions = body.instructions;
    if (body.knowledgeItems !== undefined) data.knowledgeItems = body.knowledgeItems;
    if (body.mediaItems !== undefined) data.mediaItems = body.mediaItems;
    if (body.elevenLabsKey !== undefined) data.elevenLabsKey = body.elevenLabsKey;
    if (body.selectedVoice !== undefined) data.selectedVoice = body.selectedVoice;
    if (body.voiceEnabled !== undefined) data.voiceEnabled = body.voiceEnabled;
    if (body.autoLearn !== undefined) data.autoLearn = body.autoLearn;
    if (body.model !== undefined) data.model = body.model;
    if (body.temperature !== undefined) data.temperature = body.temperature;
    if (body.maxTokens !== undefined) data.maxTokens = body.maxTokens;
    data.isActive = true;

    const assistant = await prisma.assistant.update({ where: { id }, data });
    console.log(`✅ Asistente ${assistant.name} actualizado (context: ${assistant.context?.length || 0} chars)`);

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

// POST /api/assistants/elevenlabs/voices
router.post('/elevenlabs/voices', async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey }
    });
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

// DELETE - Limpiar asistentes duplicados (utilidad)
router.delete('/cleanup', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const assistants = await prisma.assistant.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' }
    });

    if (assistants.length <= 1) {
      res.json({ message: 'No hay duplicados', count: assistants.length });
      return;
    }

    // Mantener el más reciente, eliminar el resto
    const keep = assistants[0];
    const toDelete = assistants.slice(1).map(a => a.id);

    await prisma.assistant.deleteMany({
      where: { id: { in: toDelete } }
    });

    // Asegurar que el que queda está activo
    await prisma.assistant.update({
      where: { id: keep.id },
      data: { isActive: true }
    });

    console.log(`🧹 Limpiados ${toDelete.length} asistentes duplicados. Quedó: ${keep.name} (${keep.id})`);
    res.json({ message: `Eliminados ${toDelete.length} duplicados`, kept: keep.name });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

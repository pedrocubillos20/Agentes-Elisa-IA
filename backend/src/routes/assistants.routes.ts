import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// GET /api/assistants - Obtener asistente del usuario
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    // Buscar asistente activo primero
    let assistant = await prisma.assistant.findFirst({
      where: { userId, isActive: true }
    });

    // Si no hay activo, buscar cualquiera
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({
        where: { userId }
      });

      // Si encontramos uno, activarlo
      if (assistant) {
        assistant = await prisma.assistant.update({
          where: { id: assistant.id },
          data: { isActive: true }
        });
      }
    }

    res.json({ assistant });
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

    // Datos a guardar
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
      model: body.model || 'gpt-4-turbo-preview',
      temperature: body.temperature || 0.7,
      maxTokens: body.maxTokens || 500,
      // SIEMPRE activar al guardar
      isActive: true
    };

    // Buscar asistente existente
    let assistant = await prisma.assistant.findFirst({
      where: { userId }
    });

    if (assistant) {
      // Desactivar otros asistentes del usuario
      await prisma.assistant.updateMany({
        where: { userId, id: { not: assistant.id } },
        data: { isActive: false }
      });

      // Actualizar el existente
      assistant = await prisma.assistant.update({
        where: { id: assistant.id },
        data
      });
      console.log(`✅ Asistente actualizado: ${assistant.name} (ID: ${assistant.id})`);
    } else {
      // Crear nuevo
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

    // Verificar que el asistente pertenece al usuario
    const existing = await prisma.assistant.findFirst({
      where: { id, userId }
    });

    if (!existing) {
      res.status(404).json({ error: 'Asistente no encontrado' });
      return;
    }

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
    if (body.isActive !== undefined) data.isActive = body.isActive;

    // SIEMPRE activar al actualizar
    data.isActive = true;

    const assistant = await prisma.assistant.update({
      where: { id },
      data
    });

    console.log(`✅ Asistente ${assistant.name} actualizado (context: ${assistant.context?.length || 0} chars)`);

    res.json({ assistant, message: 'Actualizado' });
  } catch (error: any) {
    console.error('❌ Error actualizando asistente:', error);
    res.status(500).json({ error: error.message || 'Error' });
  }
});

// POST /api/assistants/:id/activate - Activar asistente
router.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const { id } = req.params;

    // Desactivar todos
    await prisma.assistant.updateMany({
      where: { userId },
      data: { isActive: false }
    });

    // Activar el seleccionado
    const assistant = await prisma.assistant.update({
      where: { id },
      data: { isActive: true }
    });

    res.json({ assistant, message: 'Activado' });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/assistants/elevenlabs/voices - Obtener voces de ElevenLabs
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

export default router;

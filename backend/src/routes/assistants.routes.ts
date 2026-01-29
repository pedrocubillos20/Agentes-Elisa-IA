import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// GET /api/assistants
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const assistants = await prisma.assistant.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' }
    });
    res.json({ assistants });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener asistentes' });
  }
});

// GET /api/assistants/active
router.get('/active', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    let assistant = await prisma.assistant.findFirst({
      where: { userId, isActive: true }
    });
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({ where: { userId } });
    }
    res.json({ assistant });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener asistente' });
  }
});

// POST /api/assistants
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const body = req.body;

    let assistant = await prisma.assistant.findFirst({
      where: { userId, isActive: true }
    });

    const data = {
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
      maxTokens: body.maxTokens || 500
    };

    if (assistant) {
      assistant = await prisma.assistant.update({
        where: { id: assistant.id },
        data
      });
    } else {
      assistant = await prisma.assistant.create({
        data: { ...data, userId: userId!, isActive: true }
      });
    }

    res.json({ assistant, message: 'Asistente guardado correctamente' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al guardar asistente' });
  }
});

// POST /api/assistants/elevenlabs/voices
router.post('/elevenlabs/voices', async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey) {
      res.status(400).json({ error: 'API Key requerida' });
      return;
    }

    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey }
    });

    if (response.ok) {
      const data = await response.json();
      res.json({ voices: data.voices });
    } else {
      res.status(400).json({ error: 'API Key inválida' });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al conectar con ElevenLabs' });
  }
});

export default router;

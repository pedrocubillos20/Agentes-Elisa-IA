import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();
const prisma = new PrismaClient();

// Configuración de Multer para upload de archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 
                          'video/mp4', 'video/quicktime', 'video/webm',
                          'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido'));
    }
  }
});

// ==========================================
// GET /api/assistants - Listar asistentes
// ==========================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const assistants = await prisma.assistant.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        mediaFiles: true
      }
    });

    res.json({ assistants });
  } catch (error) {
    console.error('Error listando asistentes:', error);
    res.status(500).json({ error: 'Error al obtener asistentes' });
  }
});

// ==========================================
// GET /api/assistants/active - Obtener asistente activo
// ==========================================
router.get('/active', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    let assistant = await prisma.assistant.findFirst({
      where: { userId, isActive: true },
      include: { mediaFiles: true }
    });

    // Si no hay activo, buscar cualquiera
    if (!assistant) {
      assistant = await prisma.assistant.findFirst({
        where: { userId },
        include: { mediaFiles: true }
      });
    }

    res.json({ assistant });
  } catch (error) {
    console.error('Error obteniendo asistente activo:', error);
    res.status(500).json({ error: 'Error al obtener asistente' });
  }
});

// ==========================================
// POST /api/assistants - Crear/Actualizar asistente
// ==========================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const {
      name,
      context,
      personality,
      businessInfo,
      instructions,
      knowledgeItems,
      mediaItems,
      elevenLabsKey,
      selectedVoice,
      voiceEnabled,
      autoLearn,
      model,
      temperature,
      maxTokens,
      isActive
    } = req.body;

    // Buscar asistente existente activo
    let assistant = await prisma.assistant.findFirst({
      where: { userId, isActive: true }
    });

    if (assistant) {
      // Actualizar existente
      assistant = await prisma.assistant.update({
        where: { id: assistant.id },
        data: {
          name: name || assistant.name,
          context,
          personality,
          businessInfo,
          instructions,
          knowledgeItems: knowledgeItems || [],
          mediaItems: mediaItems || [],
          elevenLabsKey,
          selectedVoice,
          voiceEnabled: voiceEnabled || false,
          autoLearn: autoLearn !== false,
          model: model || 'gpt-4-turbo-preview',
          temperature: temperature || 0.7,
          maxTokens: maxTokens || 500
        }
      });
    } else {
      // Crear nuevo
      assistant = await prisma.assistant.create({
        data: {
          userId,
          name: name || 'Asistente Principal',
          context,
          personality,
          businessInfo,
          instructions,
          knowledgeItems: knowledgeItems || [],
          mediaItems: mediaItems || [],
          elevenLabsKey,
          selectedVoice,
          voiceEnabled: voiceEnabled || false,
          autoLearn: autoLearn !== false,
          model: model || 'gpt-4-turbo-preview',
          temperature: temperature || 0.7,
          maxTokens: maxTokens || 500,
          isActive: true
        }
      });
    }

    res.json({ assistant, message: 'Asistente guardado correctamente' });
  } catch (error) {
    console.error('Error guardando asistente:', error);
    res.status(500).json({ error: 'Error al guardar asistente' });
  }
});

// ==========================================
// PUT /api/assistants/:id - Actualizar asistente específico
// ==========================================
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;

    // Verificar propiedad
    const existing = await prisma.assistant.findFirst({
      where: { id, userId }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }

    const assistant = await prisma.assistant.update({
      where: { id },
      data: req.body
    });

    res.json({ assistant });
  } catch (error) {
    console.error('Error actualizando asistente:', error);
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

// ==========================================
// POST /api/assistants/:id/activate - Activar asistente
// ==========================================
router.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
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

    res.json({ assistant, message: 'Asistente activado' });
  } catch (error) {
    console.error('Error activando asistente:', error);
    res.status(500).json({ error: 'Error al activar' });
  }
});

// ==========================================
// DELETE /api/assistants/:id - Eliminar asistente
// ==========================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;

    await prisma.assistant.deleteMany({
      where: { id, userId }
    });

    res.json({ message: 'Asistente eliminado' });
  } catch (error) {
    console.error('Error eliminando asistente:', error);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// ==========================================
// MULTIMEDIA - Upload de archivos
// ==========================================

// POST /api/assistants/media/upload - Subir archivo
router.post('/media/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const file = req.file;
    const { type, trigger, assistantId } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'No se recibió archivo' });
    }

    // Determinar tipo de archivo
    let fileType = 'image';
    if (file.mimetype.startsWith('video/')) fileType = 'video';
    if (file.mimetype.startsWith('audio/')) fileType = 'audio';

    // Guardar en base de datos
    const mediaFile = await prisma.mediaFile.create({
      data: {
        userId,
        assistantId: assistantId || null,
        name: file.originalname,
        type: fileType,
        url: `/uploads/${file.filename}`,
        trigger: trigger || null,
        size: file.size
      }
    });

    res.json({ 
      media: mediaFile,
      message: 'Archivo subido correctamente' 
    });
  } catch (error) {
    console.error('Error subiendo archivo:', error);
    res.status(500).json({ error: 'Error al subir archivo' });
  }
});

// GET /api/assistants/media - Listar archivos multimedia
router.get('/media', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const mediaFiles = await prisma.mediaFile.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ mediaFiles });
  } catch (error) {
    console.error('Error listando archivos:', error);
    res.status(500).json({ error: 'Error al obtener archivos' });
  }
});

// DELETE /api/assistants/media/:id - Eliminar archivo
router.delete('/media/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;

    const mediaFile = await prisma.mediaFile.findFirst({
      where: { id, userId }
    });

    if (!mediaFile) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // Eliminar archivo físico
    const filePath = path.join(__dirname, '../..', mediaFile.url);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Eliminar de base de datos
    await prisma.mediaFile.delete({ where: { id } });

    res.json({ message: 'Archivo eliminado' });
  } catch (error) {
    console.error('Error eliminando archivo:', error);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// ==========================================
// ELEVENLABS - Text to Speech
// ==========================================

// POST /api/assistants/elevenlabs/voices - Obtener voces disponibles
router.post('/elevenlabs/voices', async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: 'API Key requerida' });
    }

    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey }
    });

    if (!response.ok) {
      return res.status(400).json({ error: 'API Key inválida' });
    }

    const data = await response.json();
    res.json({ voices: data.voices });
  } catch (error) {
    console.error('Error obteniendo voces:', error);
    res.status(500).json({ error: 'Error al conectar con ElevenLabs' });
  }
});

// POST /api/assistants/elevenlabs/speak - Generar audio
router.post('/elevenlabs/speak', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { text, voiceId } = req.body;

    // Obtener asistente con API key de ElevenLabs
    const assistant = await prisma.assistant.findFirst({
      where: { userId, isActive: true }
    });

    if (!assistant?.elevenLabsKey || !assistant?.voiceEnabled) {
      return res.status(400).json({ error: 'ElevenLabs no configurado' });
    }

    const voice = voiceId || assistant.selectedVoice;
    if (!voice) {
      return res.status(400).json({ error: 'Voz no seleccionada' });
    }

    // Llamar a ElevenLabs API
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: 'POST',
      headers: {
        'xi-api-key': assistant.elevenLabsKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!response.ok) {
      return res.status(400).json({ error: 'Error generando audio' });
    }

    const audioBuffer = await response.arrayBuffer();
    
    // Guardar audio temporalmente
    const filename = `audio-${Date.now()}.mp3`;
    const uploadDir = path.join(__dirname, '../../uploads/audio');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, Buffer.from(audioBuffer));

    res.json({ 
      audioUrl: `/uploads/audio/${filename}`,
      message: 'Audio generado correctamente'
    });
  } catch (error) {
    console.error('Error generando audio:', error);
    res.status(500).json({ error: 'Error al generar audio' });
  }
});

// ==========================================
// AUTO-APRENDIZAJE
// ==========================================

// GET /api/assistants/learning - Obtener sugerencias de aprendizaje
router.get('/learning', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const logs = await prisma.learningLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    res.json({ learningLogs: logs });
  } catch (error) {
    console.error('Error obteniendo logs:', error);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// POST /api/assistants/learning/apply/:id - Aplicar sugerencia
router.post('/learning/apply/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;

    const log = await prisma.learningLog.updateMany({
      where: { id, userId },
      data: { 
        applied: true,
        appliedAt: new Date()
      }
    });

    res.json({ message: 'Sugerencia aplicada' });
  } catch (error) {
    console.error('Error aplicando sugerencia:', error);
    res.status(500).json({ error: 'Error al aplicar' });
  }
});

// POST /api/assistants/learning/analyze - Analizar conversaciones (llamado internamente)
router.post('/learning/analyze', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    // Obtener conversaciones recientes sin respuesta adecuada
    const conversations = await prisma.conversation.findMany({
      where: { userId },
      include: { messages: { orderBy: { timestamp: 'desc' }, take: 50 } },
      take: 10
    });

    // Aquí iría la lógica de análisis con IA
    // Por ahora, solo devolvemos un mensaje
    res.json({ 
      message: 'Análisis completado',
      analyzed: conversations.length 
    });
  } catch (error) {
    console.error('Error analizando:', error);
    res.status(500).json({ error: 'Error en análisis' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// Default stages
const DEFAULT_STAGES = [
  { id: 'new', label: 'Nuevo', color: 'blue', description: 'Solo escribió/preguntó' },
  { id: 'interested', label: 'Interesado', color: 'cyan', description: 'Mostró interés en productos' },
  { id: 'quoting', label: 'En Cotización', color: 'yellow', description: 'Pidiendo precios/info' },
  { id: 'negotiating', label: 'Negociando', color: 'orange', description: 'Discutiendo términos' },
  { id: 'pending_confirm', label: 'Por Confirmar', color: 'purple', description: 'Falta confirmación de pago' },
  { id: 'converted', label: 'Convertido', color: 'green', description: 'Realizó compra' },
  { id: 'follow_up', label: 'Seguimiento', color: 'pink', description: 'Requiere seguimiento' },
  { id: 'lost', label: 'Perdido', color: 'red', description: 'No compró' },
];

// GET /api/stages - Get user's custom stages
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { customStages: true } });
    
    let stages = DEFAULT_STAGES;
    if (user?.customStages && Array.isArray(user.customStages) && (user.customStages as any[]).length > 0) {
      stages = user.customStages as any[];
    }

    res.json({ stages });
  } catch (error) {
    console.error('Error getting stages:', error);
    res.status(500).json({ error: 'Error' });
  }
});

// PUT /api/stages - Save user's custom stages
router.put('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const { stages } = req.body;
    
    if (!Array.isArray(stages) || stages.length === 0) {
      res.status(400).json({ error: 'Stages must be a non-empty array' });
      return;
    }

    // Validate each stage has required fields
    for (const stage of stages) {
      if (!stage.id || !stage.label || !stage.color) {
        res.status(400).json({ error: 'Each stage needs id, label, and color' });
        return;
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: { customStages: stages }
    });

    console.log(`✅ Stages saved for ${userId}: ${stages.length} stages`);
    res.json({ stages, message: 'Etapas guardadas' });
  } catch (error) {
    console.error('Error saving stages:', error);
    res.status(500).json({ error: 'Error al guardar etapas' });
  }
});

export default router;

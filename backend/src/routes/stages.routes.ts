import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// Default stages
const DEFAULT_STAGES = [
  { id: 'Saludo', label: 'Saludo', color: 'blue', description: 'Primer contacto' },
  { id: 'Interesado', label: 'Interesado', color: 'cyan', description: 'Mostró interés' },
  { id: 'En Cotización', label: 'En Cotización', color: 'yellow', description: 'Pidiendo información' },
  { id: 'Pendiente Info', label: 'Pendiente Info', color: 'orange', description: 'Faltan datos' },
  { id: 'Realizó Pedido', label: 'Realizó Pedido', color: 'green', description: 'Confirmó compra' },
  { id: 'Confirmado', label: 'Confirmado', color: 'purple', description: 'Pedido completo' },
  { id: 'Perdido', label: 'Perdido', color: 'red', description: 'No compró' },
];

// GET /api/stages - Get stages (supports lineId query param for line-specific stages)
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const lineId = req.query.lineId as string | undefined;
    
    let stages = DEFAULT_STAGES;
    
    // Si hay lineId, buscar etapas de la línea
    if (lineId) {
      const line = await prisma.whatsappLine.findFirst({ 
        where: { id: lineId, userId },
        select: { customStages: true, stagesConfigured: true }
      });
      
      if (line?.customStages && Array.isArray(line.customStages) && (line.customStages as any[]).length > 0) {
        stages = line.customStages as any[];
      }
      
      res.json({ stages, configured: line?.stagesConfigured || false, source: 'line' });
      return;
    }
    
    // Fallback: buscar en user (legacy)
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { customStages: true } });
    
    if (user?.customStages && Array.isArray(user.customStages) && (user.customStages as any[]).length > 0) {
      stages = user.customStages as any[];
    }

    res.json({ stages, source: 'user' });
  } catch (error) {
    console.error('Error getting stages:', error);
    res.status(500).json({ error: 'Error' });
  }
});

// PUT /api/stages - Save stages (supports lineId in body for line-specific)
router.put('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const { stages, lineId } = req.body;
    
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

    // Si hay lineId, guardar en la línea
    if (lineId) {
      await prisma.whatsappLine.update({
        where: { id: lineId },
        data: { customStages: stages, stagesConfigured: true }
      });
      console.log(`✅ Stages saved for line ${lineId}: ${stages.length} stages`);
      res.json({ stages, message: 'Etapas guardadas para la línea' });
      return;
    }

    // Fallback: guardar en user (legacy)
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

// POST /api/stages/sync - Sincronizar etapas desde base de conocimiento del asistente
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const { lineId } = req.body;
    if (!lineId) { res.status(400).json({ error: 'lineId requerido' }); return; }

    // Buscar asistente de la línea
    const assistant = await prisma.assistant.findFirst({
      where: { userId, whatsappLineId: lineId },
      select: { context: true }
    });

    if (!assistant?.context) {
      res.status(400).json({ error: 'No hay base de conocimiento configurada para esta línea' });
      return;
    }

    // Extraer etapas del contexto
    const stages = extractStagesFromContext(assistant.context);
    
    if (stages.length === 0) {
      res.status(400).json({ error: 'No se encontraron etapas en la base de conocimiento. Agrega una sección de ETAPAS o FLUJO.' });
      return;
    }

    // Guardar etapas en la línea
    await prisma.whatsappLine.update({
      where: { id: lineId },
      data: { customStages: stages, stagesConfigured: true }
    });

    console.log(`🎯 Etapas sincronizadas para línea ${lineId}: ${stages.map(s => s.label).join(', ')}`);
    res.json({ stages, message: `${stages.length} etapas sincronizadas correctamente` });
  } catch (error) {
    console.error('Error syncing stages:', error);
    res.status(500).json({ error: 'Error al sincronizar etapas' });
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
  
  const unique = Array.from(new Set(foundItems));
  unique.slice(0, 12).forEach((label, index) => {
    stages.push({
      id: label,
      label: label,
      color: colors[index % colors.length],
      description: ''
    });
  });
  
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

export default router;

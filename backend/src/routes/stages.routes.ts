import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// ⚡ getOwnerId con cache — sub-usuarios heredan datos del admin
const ownerIdCache = new Map<string, { value: string; ts: number }>();
const getOwnerId = async (userId: string): Promise<string> => {
  const cached = ownerIdCache.get(userId);
  if (cached && Date.now() - cached.ts < 300000) return cached.value;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  const ownerId = user?.parentUserId || userId;
  ownerIdCache.set(userId, { value: ownerId, ts: Date.now() });
  return ownerId;
};

// ❌ NO hay DEFAULT_STAGES — las etapas vienen SOLO de la base de conocimiento de cada línea/asistente

// GET /api/stages - Get stages (supports lineId query param for line-specific stages)
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    // ⚡ Sub-usuarios ven las etapas del admin
    const ownerId = await getOwnerId(userId);
    const lineId = req.query.lineId as string | undefined;
    
    let stages: any[] = [];
    let configured = false;

    // Si hay lineId, buscar etapas de la línea
    if (lineId) {
      const line = await prisma.whatsappLine.findFirst({ 
        where: { id: lineId, userId: ownerId },
        select: { customStages: true, stagesConfigured: true }
      });
      
      if (line?.customStages && Array.isArray(line.customStages) && (line.customStages as any[]).length > 0) {
        stages = line.customStages as any[];
        configured = line.stagesConfigured || false;
      }
      
      // Si no tiene etapas configuradas, intentar extraerlas del asistente
      if (stages.length === 0) {
        const assistant = await prisma.assistant.findFirst({
          where: { userId: ownerId, whatsappLineId: lineId },
          select: { context: true }
        });
        
        if (assistant?.context) {
          const extracted = extractStagesFromContext(assistant.context);
          if (extracted.length > 0) {
            await prisma.whatsappLine.update({
              where: { id: lineId },
              data: { customStages: extracted, stagesConfigured: true }
            });
            stages = extracted;
            configured = true;
            console.log(`🎯 Auto-extracción: ${extracted.length} etapas desde base de conocimiento de línea ${lineId}`);
          }
        }
      }
      
      res.json({ stages, configured, source: 'line' });
      return;
    }
    
    // Sin lineId: buscar la primera línea del usuario que tenga etapas
    const lines = await prisma.whatsappLine.findMany({
      where: { userId: ownerId },
      select: { id: true, customStages: true, stagesConfigured: true }
    });
    
    for (const line of lines) {
      if (line.customStages && Array.isArray(line.customStages) && (line.customStages as any[]).length > 0) {
        stages = line.customStages as any[];
        configured = true;
        break;
      }
    }

    res.json({ stages, configured, source: stages.length > 0 ? 'line' : 'none' });
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
    const ownerId = await getOwnerId(userId);

    const { stages, lineId } = req.body;
    
    if (!Array.isArray(stages) || stages.length === 0) {
      res.status(400).json({ error: 'Stages must be a non-empty array' });
      return;
    }

    for (const stage of stages) {
      if (!stage.id || !stage.label || !stage.color) {
        res.status(400).json({ error: 'Each stage needs id, label, and color' });
        return;
      }
    }

    if (lineId) {
      await prisma.whatsappLine.update({
        where: { id: lineId },
        data: { customStages: stages, stagesConfigured: true }
      });
      res.json({ stages, message: 'Etapas guardadas para la línea' });
      return;
    }

    const firstLine = await prisma.whatsappLine.findFirst({ where: { userId: ownerId } });
    if (firstLine) {
      await prisma.whatsappLine.update({
        where: { id: firstLine.id },
        data: { customStages: stages, stagesConfigured: true }
      });
    }

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
    const ownerId = await getOwnerId(userId);

    const { lineId } = req.body;
    if (!lineId) { res.status(400).json({ error: 'lineId requerido' }); return; }

    const assistant = await prisma.assistant.findFirst({
      where: { userId: ownerId, whatsappLineId: lineId },
      select: { context: true }
    });

    if (!assistant?.context) {
      res.status(400).json({ error: 'No hay base de conocimiento configurada para esta línea. Configura tu asistente primero.' });
      return;
    }

    const stages = extractStagesFromContext(assistant.context);
    
    if (stages.length === 0) {
      res.status(400).json({ error: 'No se encontraron etapas en la base de conocimiento. Define las etapas de tu negocio en la base de conocimiento del asistente.' });
      return;
    }

    await prisma.whatsappLine.update({
      where: { id: lineId },
      data: { customStages: stages, stagesConfigured: true }
    });

    console.log(`🎯 Etapas sincronizadas para línea ${lineId}: ${stages.map((s: any) => s.label).join(', ')}`);
    res.json({ stages, message: `${stages.length} etapas sincronizadas correctamente` });
  } catch (error) {
    console.error('Error syncing stages:', error);
    res.status(500).json({ error: 'Error al sincronizar etapas' });
  }
});

// 🎯 Extraer etapas automáticamente del contexto/base de conocimiento
// SOLO extrae de la sección de pipeline/etapas — nunca del resto del prompt
function extractStagesFromContext(context: string): any[] {
  if (!context || context.length < 50) return [];
  
  const stages: any[] = [];
  const colors = ['blue', 'cyan', 'yellow', 'orange', 'purple', 'green', 'pink', 'red', 'indigo', 'teal'];
  
  let foundItems: string[] = [];

  // PASO 1: Buscar la sección delimitada de etapas/pipeline
  // Acepta bloques de tipo:
  //   ## 🗺️ ETAPAS DEL PIPELINE
  //   1. Nuevo Contacto → ...
  //   2. Consultando Servicio → ...
  //   ...
  // O también:
  //   Nuevo Contacto → Saludo → Pendiente → Confirmado → ...
  
  // Patrón 1: Sección Markdown con título de etapas
  const sectionMatch = context.match(
    /##?[^\n]*(?:ETAPAS?|PIPELINE|EMBUDO|FLUJO|FASES?|PASOS?)[^\n]*\n([\s\S]*?)(?=\n##|\n---|\/\*|$)/i
  );

  if (sectionMatch) {
    const section = sectionMatch[1];

    // Extraer líneas numeradas: "1. Nuevo Contacto → descripción"
    const numbered = [...section.matchAll(/^\s*\d+\.?\s+([^\n→\-:]{2,40}?)(?:\s*[→\-–].*)?$/gm)];
    for (const m of numbered) {
      const label = m[1].replace(/\*\*/g, '').trim();
      // Filtrar líneas que sean instrucciones, no etapa names
      if (label.length >= 3 && label.length <= 40 && !/^(REGLA|NUNCA|SIEMPRE|Regla|Nota|Ejemplo)/i.test(label)) {
        foundItems.push(label);
      }
    }

    // Si no hay numeradas, buscar un flujo en línea: "Nuevo Contacto → Saludo → Confirmado"
    if (foundItems.length === 0) {
      const inlineFlow = section.match(/([A-ZÁÉÍÓÚ][^→\n]{2,35}?)(?:\s*→\s*([A-ZÁÉÍÓÚ][^→\n]{2,35}?))+/g);
      if (inlineFlow) {
        inlineFlow[0].split('→').forEach(part => {
          const label = part.replace(/\*\*/g, '').trim();
          if (label.length >= 2 && label.length <= 40) foundItems.push(label);
        });
      }
    }

    // Si tampoco, buscar bullet list: "- Nuevo Contacto" o "• Confirmado"
    if (foundItems.length === 0) {
      const bullets = [...section.matchAll(/^\s*[-•*]\s+([^\n:→]{2,40}?)(?:\s*[→:].*)?$/gm)];
      for (const m of bullets) {
        const label = m[1].replace(/\*\*/g, '').trim();
        if (label.length >= 2 && label.length <= 40 && !/^(REGLA|NUNCA|SIEMPRE|Regla|Nota)/i.test(label)) {
          foundItems.push(label);
        }
      }
    }
  }

  // PASO 2: Buscar flujo inline si no hubo sección
  // Ej: "Nuevo Contacto → Saludo → Pendiente Equipo → Confirmado → Perdido"
  if (foundItems.length === 0) {
    const inlinePatterns = context.matchAll(/([A-ZÁÉÍÓÚ][^→\n]{2,35}?)(?:\s*→\s*([A-ZÁÉÍÓÚ][^→\n]{2,35}?)){2,}/g);
    for (const m of inlinePatterns) {
      const fullMatch = m[0];
      fullMatch.split('→').forEach(part => {
        const label = part.replace(/\*\*/g, '').trim();
        if (label.length >= 2 && label.length <= 40) foundItems.push(label);
      });
      if (foundItems.length > 0) break; // Solo el primer flujo encontrado
    }
  }

  if (foundItems.length < 2) return [];
  
  // Deduplicar y limpiar
  const unique = Array.from(new Set(foundItems))
    .filter(s => s.length >= 2 && s.length <= 45)
    .filter(s => !/^(REGLA|NUNCA|SIEMPRE|Regla de avance|Nota|Ejemplo|Ver tabla)/i.test(s));

  unique.slice(0, 15).forEach((label, index) => {
    // IMPORTANTE: id = label (sin hyphen) para que el match exacto con etapa_actual de la IA funcione
    stages.push({
      id: label,
      label: label,
      color: colors[index % colors.length],
      description: ''
    });
  });
  
  return stages;
}

export default router;

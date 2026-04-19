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
// ⚡ SIEMPRE re-extrae y sobrescribe — permite actualizar cuando cambia el prompt
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
      res.status(400).json({ error: 'No se encontraron etapas en la base de conocimiento. Asegúrate de tener una sección "ETAPAS DEL PIPELINE" con una lista numerada en tu base de conocimiento.' });
      return;
    }

    // Obtener etapas actuales para preservar colores personalizados si el label coincide
    const currentLine = await prisma.whatsappLine.findFirst({
      where: { id: lineId },
      select: { customStages: true }
    });
    const currentStages: any[] = (currentLine?.customStages as any[]) || [];
    
    // Merge: si una etapa ya existía con ese label, conservar su color personalizado
    const mergedStages = stages.map((newStage: any) => {
      const existing = currentStages.find((s: any) => 
        s.label?.toLowerCase().trim() === newStage.label?.toLowerCase().trim()
      );
      return existing ? { ...newStage, color: existing.color } : newStage;
    });

    await prisma.whatsappLine.update({
      where: { id: lineId },
      data: { customStages: mergedStages, stagesConfigured: true }
    });

    console.log(`🎯 Etapas sincronizadas para línea ${lineId}: ${mergedStages.map((s: any) => s.label).join(', ')}`);
    res.json({ stages: mergedStages, message: `${mergedStages.length} etapas sincronizadas correctamente` });
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
  const colors = ['blue', 'cyan', 'yellow', 'orange', 'purple', 'green', 'pink', 'teal', 'indigo', 'red', 'lime', 'gray'];
  
  let foundItems: string[] = [];

  // ══════════════════════════════════════════════════════
  // PASO 0 (PRIORIDAD MÁXIMA): Extraer del JSON pipeline_etapas
  // Formato: "pipeline_etapas": ["Etapa 1", "Etapa 2", ...]
  // Compatible con módulo 07_acciones.json de Bizonne
  // ══════════════════════════════════════════════════════
  const jsonPipelineMatch = context.match(/"pipeline_etapas"\s*:\s*\[([\s\S]*?)\]/);
  if (jsonPipelineMatch) {
    const items = [...jsonPipelineMatch[1].matchAll(/"([^"]+)"/g)].map(m => m[1].trim());
    const NOISE_JSON = /^(REGLA|NUNCA|SIEMPRE|Nota|Ejemplo|PASO|accion|Pipeline|etapa_actual)/i;
    const validItems = items.filter(s => s.length >= 2 && s.length <= 45 && !NOISE_JSON.test(s));
    if (validItems.length >= 2) {
      console.log(`🎯 Etapas extraídas de pipeline_etapas JSON: ${validItems.join(', ')}`);
      validItems.slice(0, 15).forEach((label, index) => {
        stages.push({ id: label, label, color: colors[index % colors.length], description: '' });
      });
      return stages;
    }
  }

  // ══════════════════════════════════════════════════════
  // PASO 0B: Extraer de arrays JSON con nombre de etapa dentro de acciones
  // Formato alternativo: "etapas": ["Etapa 1", ...] o "stages": [...]
  // ══════════════════════════════════════════════════════
  const jsonAltMatch = context.match(/"(?:etapas?|stages?|pipeline|fases?|embudo)"\s*:\s*\[([\s\S]*?)\]/i);
  if (jsonAltMatch) {
    const items = [...jsonAltMatch[1].matchAll(/"([^"]+)"/g)].map(m => m[1].trim());
    const validItems = items.filter(s => s.length >= 2 && s.length <= 45);
    if (validItems.length >= 2) {
      console.log(`🎯 Etapas extraídas de JSON alternativo: ${validItems.join(', ')}`);
      validItems.slice(0, 15).forEach((label, index) => {
        stages.push({ id: label, label, color: colors[index % colors.length], description: '' });
      });
      return stages;
    }
  }

  // ══════════════════════════════════════════════════════
  // PASO 1: Buscar sección de etapas/pipeline por headers
  // Incluye ahora: acciones.json, 07_acciones, CRM, etc.
  // ══════════════════════════════════════════════════════
  const STAGE_SECTION_PATTERNS = [
    /##?[^\n]*(?:ETAPAS?\s+DEL\s+PIPELINE)[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n═|\/\*|$)/i,
    /##?[^\n]*(?:PIPELINE)[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n═|\/\*|$)/i,
    /##?[^\n]*(?:EMBUDO)[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n═|\/\*|$)/i,
    /##?[^\n]*(?:FASES?)[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n═|\/\*|$)/i,
    /##?[^\n]*(?:acciones?\.json|07_acciones)[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n═|\/\*|$)/i,
    /##?[^\n]*(?:CRM)[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n═|\/\*|$)/i,
    /##?[^\n]*(?:FLUJO\s+DEL?\s+(?:NEGOCIO|CLIENTE|PROCESO|PIPELINE))[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n═|\/\*|$)/i,
  ];
  let sectionMatch: RegExpMatchArray | null = null;
  for (const pat of STAGE_SECTION_PATTERNS) {
    sectionMatch = context.match(pat);
    if (sectionMatch) break;
  }

  if (sectionMatch) {
    const section = sectionMatch[1];

    // Intentar primero extraer del JSON dentro de la sección
    const sectionJsonMatch = section.match(/"pipeline_etapas"\s*:\s*\[([\s\S]*?)\]/);
    if (sectionJsonMatch) {
      const items = [...sectionJsonMatch[1].matchAll(/"([^"]+)"/g)].map(m => m[1].trim());
      if (items.length >= 2) {
        foundItems = items;
      }
    }

    if (foundItems.length === 0) {
      // Extraer líneas numeradas: "1. Nombre Etapa"
      const numbered = [...section.matchAll(/^\s*\d+\.?\s+([^\n→\-:`]{2,40}?)(?:\s*[→\-–].*)?$/gm)];
      for (const m of numbered) {
        const label = m[1].replace(/\*\*/g, '').replace(/[`]/g, '').trim();
        const isInstruction = /^(REGLA|NUNCA|SIEMPRE|Regla|Nota|Ejemplo|PASO|Saludo|Pedir|Cliente|Mostrar|Informar|Preguntar|Dar |Verificar|Resumen|Confirmar|Enviar|Orientar|Agendar|Ver |Sin |Si |Si no)/i.test(label);
        if (!isInstruction && label.length >= 3 && label.length <= 40) {
          foundItems.push(label);
        }
      }
    }

    // Fallback: bullet list dentro de la sección
    if (foundItems.length === 0) {
      const bullets = [...section.matchAll(/^\s*[-•*]\s+([^\n:→]{2,40}?)(?:\s*[→:].*)?$/gm)];
      for (const m of bullets) {
        const label = m[1].replace(/\*\*/g, '').trim();
        if (label.length >= 2 && label.length <= 40 && !/^(REGLA|NUNCA|SIEMPRE|Regla|Nota)/i.test(label)) {
          foundItems.push(label);
        }
      }
    }

    // Fallback: flujo inline con → DENTRO de la sección
    if (foundItems.length === 0) {
      const inSection = [...section.matchAll(/([A-ZÁÉÍÓÚÑ][^\n→`*]{1,35}?)(?:\s*→\s*)/g)];
      for (const m of inSection) {
        const label = m[1].replace(/\*\*/g, '').replace(/`/g, '').trim();
        if (label.length >= 2 && label.length <= 40 && !/^(PASO|REGLA|NUNCA|→|\d)/i.test(label)) {
          foundItems.push(label);
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════
  // PASO 2: Flujo inline en contexto completo (último recurso)
  // ══════════════════════════════════════════════════════
  if (foundItems.length === 0) {
    const inlinePatterns = context.matchAll(/([A-ZÁÉÍÓÚ][^\n→]{2,30}?)(?:\s*→\s*([A-ZÁÉÍÓÚ][^\n→]{2,30}?)){2,}/g);
    for (const m of inlinePatterns) {
      m[0].split('→').forEach(part => {
        const label = part.replace(/\*\*/g, '').trim();
        if (label.length >= 2 && label.length <= 40) foundItems.push(label);
      });
      if (foundItems.length > 0) break;
    }
  }

  if (foundItems.length < 2) return [];
  
  // Deduplicar y filtrar ruido
  const NOISE = /^(REGLA|NUNCA|SIEMPRE|Regla de avance|Nota|Ejemplo|Ver tabla|etapa actual|etapa_actual|MEMORY|accion|Pipeline|Flujo|Embudo|PASO [0-9])/i;
  const unique = Array.from(new Set(foundItems))
    .filter(s => s.length >= 2 && s.length <= 45)
    .filter(s => !NOISE.test(s));

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


export default router;

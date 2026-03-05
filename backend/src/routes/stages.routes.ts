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
      // [FIX] Verificar ownership antes de actualizar
      const line = await prisma.whatsappLine.findFirst({ where: { id: lineId, userId: ownerId } });
      if (!line) { res.status(403).json({ error: 'Línea no encontrada o sin permisos' }); return; }
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

    // [FIX] Verify ownership before updating
    const syncLine = await prisma.whatsappLine.findFirst({ where: { id: lineId, userId: ownerId } });
    if (!syncLine) { res.status(403).json({ error: 'Línea no encontrada o sin permisos' }); return; }
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
function extractStagesFromContext(context: string): any[] {
  if (!context || context.length < 50) return [];
  
  const stages: any[] = [];
  const colors = ['blue', 'cyan', 'yellow', 'orange', 'purple', 'green', 'pink', 'red', 'indigo', 'teal'];
  
  const sectionPatterns = [
    /##?\s*(?:ETAPAS?|FLUJO|EMBUDO|PIPELINE|FASES?|PROCESO|PASOS?|ESTADOS?)[^\n]*\n([\s\S]*?)(?=\n##|\n\n\n|$)/gi,
    /(?:etapas?|flujo|embudo|pipeline|fases?|proceso|pasos?|estados?)\s*[:\-]\s*\n?([\s\S]*?)(?=\n##|\n\n\n|$)/gi
  ];
  
  let foundItems: string[] = [];
  
  for (const pattern of sectionPatterns) {
    const matches = context.matchAll(pattern);
    for (const match of matches) {
      const section = match[1] || '';
      const items = section.match(/[-•*\d.]\s*\*?\*?([^*\n\-•]+)/g);
      if (items) {
        items.forEach(item => {
          let clean = item.replace(/^[-•*\d.)\s]+/, '').replace(/\*\*/g, '').trim();
          if (clean.includes(':')) clean = clean.split(':')[0].trim();
          if (clean.includes('→')) clean = clean.split('→')[0].trim();
          if (clean.includes('–')) clean = clean.split('–')[0].trim();
          if (clean && clean.length > 1 && clean.length < 40) {
            foundItems.push(clean);
          }
        });
      }
    }
  }
  
  if (foundItems.length < 3) {
    const keywords = [
      // Ventas general
      'saludo', 'interesado', 'cotización', 'cotizacion', 'pendiente', 'pedido', 
      'confirmado', 'perdido', 'nuevo', 'pago', 'entrega', 'enviado', 'completado', 
      'cerrado', 'seguimiento', 'contacto', 'negociación', 'negociacion', 'propuesta', 
      'cierre', 'postventa', 'agendado', 'facturado', 'cobrado',
      // SaaS / Servicios
      'demo', 'activación', 'activacion', 'onboarding', 'prueba', 'trial',
      'suscripción', 'suscripcion', 'renovación', 'renovacion', 'cancelado',
      // Citas / Agenda
      'cita', 'reunión', 'reunion', 'consulta', 'asesoría', 'asesoria',
      // E-commerce / Retail
      'carrito', 'compra', 'despacho', 'devuelto', 'cambio', 'reembolso',
      // Inmobiliaria / Servicios pro
      'visita', 'evaluación', 'evaluacion', 'contrato', 'firma', 'aprobado',
      // Genéricos por sector
      'calificado', 'descartado', 'recibido', 'procesando', 'listo', 'finalizado',
      'en proceso', 'en espera', 'activo', 'inactivo', 'vip', 'premium',
      // Producto específico (auto-detecta del contexto del usuario)
      'calidad', 'color', 'talla', 'modelo', 'variante', 'plan', 'paquete',
      'servicio', 'producto', 'cotizado', 'presupuesto'
    ];
    
    const lines = context.split('\n');
    for (const line of lines) {
      const lower = line.toLowerCase();
      for (const kw of keywords) {
        if (lower.includes(kw) && line.match(/[-•*\d.]\s/)) {
          let clean = line.replace(/^[-•*\d.)\s]+/, '').replace(/\*\*/g, '').trim();
          if (clean.includes(':')) clean = clean.split(':')[0].trim();
          if (clean && clean.length > 1 && clean.length < 40 && !foundItems.includes(clean)) {
            foundItems.push(clean);
          }
        }
      }
    }
  }
  
  if (foundItems.length < 2) return [];
  
  const unique = Array.from(new Set(foundItems));
  unique.slice(0, 12).forEach((label, index) => {
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

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// ⚡ getOwnerId con cache — sub-usuarios heredan clientes del admin
const ownerIdCache = new Map<string, { value: string; ts: number }>();
const getOwnerId = async (userId: string): Promise<string> => {
  const cached = ownerIdCache.get(userId);
  if (cached && Date.now() - cached.ts < 300000) return cached.value;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  const ownerId = user?.parentUserId || userId;
  ownerIdCache.set(userId, { value: ownerId, ts: Date.now() });
  return ownerId;
};

// GET /api/clients
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { search, status, lineId } = req.query;

    const where: any = { userId: ownerId };
    if (lineId) where.whatsappLineId = lineId as string;
    if (status) where.status = status;
    
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string } },
        { email: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    const clients = await prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ clients });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});

// GET /api/clients/export — Exportar clientes como JSON (frontend lo convierte a Excel)
router.get('/export', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { lineId } = req.query;
    const where: any = { userId: ownerId };
    if (lineId) where.whatsappLineId = lineId as string;

    const clients = await prisma.client.findMany({ where, orderBy: { createdAt: 'desc' } });
    const exportData = clients.map(c => ({
      nombre: c.name || '',
      telefono: c.phone || '',
      email: c.email || '',
      direccion: c.address || '',
      notas: c.notes || '',
      tags: (c.tags || []).join(', '),
      estado: c.status || '',
      total_compras: c.totalPurchases || 0,
      fecha_registro: c.createdAt?.toISOString().split('T')[0] || ''
    }));
    res.json({ data: exportData, count: exportData.length });
  } catch (error) {
    console.error('Error export:', error);
    res.status(500).json({ error: 'Error al exportar' });
  }
});

// POST /api/clients/import — Importar clientes desde JSON [{nombre, telefono, email?}]
router.post('/import', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    
    // Verificar rol (admin o manager)
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true, role: true } });
    const isAdminOrManager = !user?.parentUserId || user?.role === 'manager';
    if (!isAdminOrManager) { res.status(403).json({ error: 'Solo admin y gerente pueden importar' }); return; }

    const { contacts, lineId } = req.body;
    if (!Array.isArray(contacts) || contacts.length === 0) {
      res.status(400).json({ error: 'Se requiere array de contactos' }); return;
    }

    let imported = 0, skipped = 0, errors = 0;
    for (const c of contacts) {
      try {
        const name = (c.nombre || c.name || c.Nombre || c.Name || '').trim();
        const phone = (c.telefono || c.phone || c.Telefono || c.Phone || c.celular || c.Celular || '').toString().trim().replace(/[^0-9+]/g, '');
        const email = (c.email || c.Email || c.correo || c.Correo || '').trim();
        
        if (!phone) { skipped++; continue; }
        
        // Check duplicado
        const exists = await prisma.client.findFirst({
          where: { userId: ownerId, phone: { endsWith: phone.slice(-10) } }
        });
        
        if (exists) {
          // Actualizar nombre si estaba vacío
          // Actualizar datos si estaban vacíos
          const updateData: any = {};
          if (!exists.name && name) updateData.name = name;
          if (!exists.email && email) updateData.email = email;
          const addr = (c.direccion || c.address || '').trim();
          if (!exists.address && addr) updateData.address = addr;
          const nts = (c.notas || c.notes || '').trim();
          if (!exists.notes && nts) updateData.notes = nts;
          if (Object.keys(updateData).length > 0) {
            await prisma.client.update({ where: { id: exists.id }, data: updateData });
          }
          skipped++;
          continue;
        }
        
        const address = (c.direccion || c.address || c.Direccion || c.Address || '').trim();
        const notes = (c.notas || c.notes || c.Notas || c.Notes || '').trim();
        const tags = (c.tags || c.etiquetas || c.Tags || '').toString().split(',').map((t: string) => t.trim()).filter(Boolean);
        const status = (c.estado || c.status || c.Estado || 'lead').toString().trim().toLowerCase();
        const totalPurchases = parseFloat((c.total_compras || c.totalPurchases || c.total || '0').toString().replace(/[^0-9.]/g, '')) || 0;
        
        await prisma.client.create({
          data: {
            userId: ownerId,
            name: name || `Contacto ${phone.slice(-4)}`,
            phone,
            email: email || null,
            address: address || null,
            notes: notes || null,
            status: ['active', 'lead', 'inactive', 'vip'].includes(status) ? status : 'lead',
            tags: tags.length > 0 ? tags : ['importado'],
            totalPurchases,
            whatsappLineId: lineId || null
          }
        });
        imported++;
      } catch (e) { errors++; }
    }
    
    res.json({ imported, skipped, errors, total: contacts.length });
  } catch (error) {
    console.error('Error import:', error);
    res.status(500).json({ error: 'Error al importar' });
  }
});

// GET /api/clients/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { lineId } = req.query;
    const where: any = { userId: ownerId };
    if (lineId) where.whatsappLineId = lineId as string;

    const total = await prisma.client.count({ where });
    const active = await prisma.client.count({ where: { ...where, status: 'active' } });
    const leads = await prisma.client.count({ where: { ...where, status: 'lead' } });

    res.json({ total, active, leads });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// POST /api/clients
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { name, phone, email, address, notes, tags, status, lineId } = req.body;

    const client = await prisma.client.create({
      data: {
        userId: ownerId,
        name,
        phone,
        email,
        address,
        notes,
        tags: tags || [],
        status: status || 'lead',
        whatsappLineId: lineId || null
      }
    });

    res.status(201).json({ client });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al crear cliente' });
  }
});

// PUT /api/clients/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;
    const { name, phone, email, address, notes, tags, status } = req.body;

    const existing = await prisma.client.findFirst({ where: { id, userId: ownerId } });
    if (!existing) {
      res.status(404).json({ error: 'Cliente no encontrado' });
      return;
    }

    const client = await prisma.client.update({
      where: { id },
      data: { name, phone, email, address, notes, tags, status }
    });

    res.json({ client });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al actualizar cliente' });
  }
});

// DELETE /api/clients/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);
    const { id } = req.params;

    await prisma.client.deleteMany({ where: { id, userId: ownerId } });
    res.json({ message: 'Cliente eliminado' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al eliminar cliente' });
  }
});

export default router;

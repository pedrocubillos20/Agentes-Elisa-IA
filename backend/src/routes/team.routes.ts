import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();

const ROLE_DEFAULTS: Record<string, any> = {
  manager:  { dashboard: true, conversations: true, crm: true, agenda: true, assistants: true, whatsapp: true, config: true, team: true, products: true },
  agent:    { dashboard: true, conversations: true, crm: true, agenda: true, assistants: false, whatsapp: false, config: false, team: false, products: true },
  support:  { dashboard: true, conversations: true, crm: true, agenda: false, assistants: false, whatsapp: false, config: false, team: false, products: false },
  viewer:   { dashboard: true, conversations: false, crm: false, agenda: false, assistants: false, whatsapp: false, config: false, team: false, products: false }
};

// Resolver al dueño (admin principal) — con cache
const ownerIdCache = new Map<string, { value: string; ts: number }>();
const getOwnerId = async (userId: string): Promise<string> => {
  const cached = ownerIdCache.get(userId);
  if (cached && Date.now() - cached.ts < 300000) return cached.value;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { parentUserId: true } });
  const ownerId = u?.parentUserId || userId;
  ownerIdCache.set(userId, { value: ownerId, ts: Date.now() });
  return ownerId;
};

// Verificar permiso
const hasPermission = async (userId: string, perm: string): Promise<boolean> => {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, permissions: true, parentUserId: true } });
  if (!u) return false;
  if (!u.parentUserId) return true; // Owner tiene todo
  return (u.permissions as any)?.[perm] === true;
};

// 🔒 Verificar que el plan permite acceso a Equipo
const planAllowsTeam = async (userId: string): Promise<boolean> => {
  const ownerId = await getOwnerId(userId);
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { plan: true } });
  if (!owner) return false;
  // Solo business permite equipo
  const plansWithTeam = ['business'];
  return plansWithTeam.includes(owner.plan);
};

// GET /api/team — Listar equipo + líneas disponibles
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    // 🔒 Verificar plan
    if (!(await planAllowsTeam(userId))) {
      res.status(403).json({ error: 'plan_required', message: 'La función de Equipo requiere el plan Business.', upgrade: true });
      return;
    }

    const ownerId = await getOwnerId(userId);

    const members = await prisma.user.findMany({
      where: { parentUserId: ownerId },
      select: { id: true, email: true, name: true, role: true, permissions: true, isActive: true, phone: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });

    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, email: true, name: true, role: true, createdAt: true }
    });

    // Líneas disponibles del admin
    const lines = await prisma.whatsappLine.findMany({
      where: { userId: ownerId },
      select: { id: true, label: true, phone: true, status: true }
    });

    // Chats asignados por miembro
    const assignments = await prisma.conversation.groupBy({
      by: ['assignedTo'],
      where: { userId: ownerId, assignedTo: { not: null } },
      _count: { id: true }
    });
    const assignMap: Record<string, number> = {};
    assignments.forEach(a => { if (a.assignedTo) assignMap[a.assignedTo] = a._count.id; });

    res.json({
      owner,
      members: members.map(m => ({ ...m, assignedConversations: assignMap[m.id] || 0 })),
      lines,
      total: members.length
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/team — Crear sub-usuario
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    if (!(await hasPermission(userId, 'team'))) { res.status(403).json({ error: 'Sin permiso' }); return; }

    // 🔒 Verificar plan
    if (!(await planAllowsTeam(userId))) {
      res.status(403).json({ error: 'plan_required', message: 'La función de Equipo requiere el plan Business.', upgrade: true });
      return;
    }

    const ownerId = await getOwnerId(userId);
    const { email: rawEmail, password, name, role, permissions } = req.body;
    const email = rawEmail?.trim().toLowerCase();

    if (!email || !password) { res.status(400).json({ error: 'Email y contraseña son requeridos' }); return; }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) { res.status(400).json({ error: 'El email ya está registrado' }); return; }

    const validRole = ['manager', 'agent', 'support', 'viewer'].includes(role) ? role : 'agent';
    const perms = permissions || ROLE_DEFAULTS[validRole] || ROLE_DEFAULTS.agent;

    const newUser = await prisma.user.create({
      data: {
        email, password: await bcrypt.hash(password, 10), name: name || null,
        role: validRole, parentUserId: ownerId, permissions: perms,
        invitedBy: userId, isActive: true
      }
    });

    console.log(`👥 Nuevo sub-usuario: ${email} (${validRole}) por ${userId}`);
    res.status(201).json({
      member: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role, permissions: newUser.permissions, isActive: true },
      message: 'Miembro creado'
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUT /api/team/:id — Actualizar sub-usuario
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    if (!(await hasPermission(userId, 'team'))) { res.status(403).json({ error: 'Sin permiso' }); return; }

    const ownerId = await getOwnerId(userId);
    const { id } = req.params;

    const member = await prisma.user.findFirst({ where: { id, parentUserId: ownerId } });
    if (!member) { res.status(404).json({ error: 'No encontrado' }); return; }

    const { name, role, permissions, isActive, password } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (role !== undefined) data.role = role;
    if (permissions !== undefined) data.permissions = permissions;
    if (isActive !== undefined) data.isActive = isActive;
    if (password) data.password = await bcrypt.hash(password, 10);

    const updated = await prisma.user.update({ where: { id }, data });
    res.json({ member: { id: updated.id, email: updated.email, name: updated.name, role: updated.role, permissions: updated.permissions, isActive: updated.isActive } });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/team/:id — Eliminar sub-usuario
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    if (!(await hasPermission(userId, 'team'))) { res.status(403).json({ error: 'Sin permiso' }); return; }

    const ownerId = await getOwnerId(userId);
    const { id } = req.params;

    const member = await prisma.user.findFirst({ where: { id, parentUserId: ownerId } });
    if (!member) { res.status(404).json({ error: 'No encontrado' }); return; }

    // Desasignar chats del miembro eliminado
    await prisma.conversation.updateMany({ where: { assignedTo: id }, data: { assignedTo: null, assignedName: null } });
    await prisma.user.delete({ where: { id } });

    console.log(`👥 Sub-usuario eliminado: ${member.email}`);
    res.json({ message: 'Eliminado' });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/team/assign — Asignar conversación a un miembro del equipo
router.post('/assign', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }

    const ownerId = await getOwnerId(userId);
    const { conversationId, assignToUserId } = req.body;
    if (!conversationId) { res.status(400).json({ error: 'conversationId requerido' }); return; }

    const conv = await prisma.conversation.findFirst({ where: { id: conversationId, userId: ownerId } });
    if (!conv) { res.status(404).json({ error: 'Conversación no encontrada' }); return; }

    if (assignToUserId) {
      const member = await prisma.user.findFirst({
        where: { id: assignToUserId, OR: [{ parentUserId: ownerId }, { id: ownerId }] },
        select: { id: true, name: true, email: true }
      });
      if (!member) { res.status(404).json({ error: 'Miembro no encontrado' }); return; }

      await prisma.conversation.update({ where: { id: conversationId }, data: { assignedTo: assignToUserId, assignedName: member.name || member.email } });
      res.json({ message: `Asignada a ${member.name || member.email}` });
    } else {
      await prisma.conversation.update({ where: { id: conversationId }, data: { assignedTo: null, assignedName: null } });
      res.json({ message: 'Desasignada' });
    }
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/team/roles — Roles y permisos disponibles
router.get('/roles', async (_req: Request, res: Response) => {
  res.json({
    roles: [
      { id: 'manager', label: 'Gerente', desc: 'Acceso total', permissions: ROLE_DEFAULTS.manager },
      { id: 'agent', label: 'Vendedor', desc: 'Conversaciones, CRM, Agenda', permissions: ROLE_DEFAULTS.agent },
      { id: 'support', label: 'Soporte', desc: 'Solo conversaciones y CRM', permissions: ROLE_DEFAULTS.support },
      { id: 'viewer', label: 'Observador', desc: 'Solo dashboard', permissions: ROLE_DEFAULTS.viewer }
    ],
    allPermissions: [
      { id: 'dashboard', label: 'Dashboard' }, { id: 'conversations', label: 'Conversaciones' },
      { id: 'crm', label: 'CRM' }, { id: 'agenda', label: 'Agenda' },
      { id: 'assistants', label: 'Asistente IA' }, { id: 'whatsapp', label: 'WhatsApp' },
      { id: 'config', label: 'Configuración' }, { id: 'team', label: 'Equipo' },
      { id: 'products', label: 'Productos' }
    ]
  });
});

export default router;

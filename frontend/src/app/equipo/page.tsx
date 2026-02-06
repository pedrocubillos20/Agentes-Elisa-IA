'use client';

import { useState, useEffect } from 'react';
import {
  Users, Plus, Shield, Trash2, Edit3, X, Eye, EyeOff,
  CheckCircle, AlertCircle, UserPlus, Crown, Briefcase, Headphones,
  MessageSquare, BarChart3, Calendar, Bot, Smartphone, Settings, Package, Loader2
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const ROLES = [
  { id: 'manager', label: 'Gerente', icon: Crown, color: '#a855f7', desc: 'Acceso total excepto config avanzada' },
  { id: 'agent', label: 'Vendedor', icon: Briefcase, color: '#3b82f6', desc: 'Conversaciones, CRM, Agenda' },
  { id: 'support', label: 'Soporte', icon: Headphones, color: '#10b981', desc: 'Solo conversaciones y CRM' },
  { id: 'viewer', label: 'Observador', icon: Eye, color: '#6b7280', desc: 'Solo dashboard (lectura)' }
];

const PERMS = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'conversations', label: 'Conversaciones', icon: MessageSquare },
  { id: 'crm', label: 'CRM', icon: Users },
  { id: 'agenda', label: 'Agenda', icon: Calendar },
  { id: 'assistants', label: 'Asistente IA', icon: Bot },
  { id: 'whatsapp', label: 'WhatsApp', icon: Smartphone },
  { id: 'config', label: 'Configuración', icon: Settings },
  { id: 'team', label: 'Equipo', icon: Shield },
  { id: 'products', label: 'Productos', icon: Package }
];

const ROLE_DEFAULTS: Record<string, any> = {
  manager: { dashboard: true, conversations: true, crm: true, agenda: true, assistants: true, whatsapp: true, config: true, team: true, products: true },
  agent: { dashboard: true, conversations: true, crm: true, agenda: true, assistants: false, whatsapp: false, config: false, team: false, products: true },
  support: { dashboard: true, conversations: true, crm: true, agenda: false, assistants: false, whatsapp: false, config: false, team: false, products: false },
  viewer: { dashboard: true, conversations: false, crm: false, agenda: false, assistants: false, whatsapp: false, config: false, team: false, products: false }
};

export default function EquipoPage() {
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<any[]>([]);
  const [owner, setOwner] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [form, setForm] = useState({
    email: '', password: '', name: '', role: 'agent',
    permissions: { ...ROLE_DEFAULTS.agent }
  });

  useEffect(() => { fetchTeam(); fetchUser(); }, []);
  useEffect(() => { if (message.text) { const t = setTimeout(() => setMessage({ type: '', text: '' }), 4000); return () => clearTimeout(t); } }, [message]);

  const fetchUser = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) { const data = await res.json(); if (!owner) setOwner(data.user); }
    } catch {}
  };

  const fetchTeam = async () => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }
    try {
      const res = await fetch(`${API_URL}/api/team`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) { const data = await res.json(); setMembers(data.members || []); setOwner(data.owner); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleRoleChange = (role: string) => {
    setForm(prev => ({ ...prev, role, permissions: { ...ROLE_DEFAULTS[role] } }));
  };

  const togglePerm = (perm: string) => {
    setForm(prev => ({ ...prev, permissions: { ...prev.permissions, [perm]: !prev.permissions[perm] } }));
  };

  const handleCreate = async () => {
    if (!form.email || !form.password) { setMessage({ type: 'error', text: 'Email y contraseña son requeridos' }); return; }
    if (form.password.length < 6) { setMessage({ type: 'error', text: 'La contraseña debe tener al menos 6 caracteres' }); return; }
    setSaving(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/team`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: `✅ ${form.name || form.email} agregado al equipo` });
        setShowCreate(false);
        setForm({ email: '', password: '', name: '', role: 'agent', permissions: { ...ROLE_DEFAULTS.agent } });
        fetchTeam();
      } else { setMessage({ type: 'error', text: data.error || 'Error' }); }
    } catch { setMessage({ type: 'error', text: 'Error de conexión' }); }
    finally { setSaving(false); }
  };

  const handleToggleActive = async (member: any) => {
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/team/${member.id}`, {
        method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !member.isActive })
      });
      fetchTeam();
      setMessage({ type: 'success', text: `${member.name || member.email} ${member.isActive ? 'desactivado' : 'activado'}` });
    } catch {}
  };

  const handleDelete = async (member: any) => {
    if (!confirm(`¿Eliminar a ${member.name || member.email} del equipo? Esta acción no se puede deshacer.`)) return;
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/team/${member.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      fetchTeam();
      setMessage({ type: 'success', text: 'Miembro eliminado' });
    } catch {}
  };

  const handleUpdatePerms = async (member: any, newPerms: any) => {
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/team/${member.id}`, {
        method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: newPerms })
      });
      fetchTeam();
    } catch {}
  };

  const getRoleInfo = (role: string) => ROLES.find(r => r.id === role) || ROLES[1];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <img src="/bizonne.png" alt="Bizonne" className="w-16 h-16 rounded-xl animate-pulse" />
        <div className="loading-spinner" />
      </div>
    );
  }

  // 🔒 BLOQUEO PLAN STARTER - Equipo solo disponible en Business
  if (owner?.plan === 'starter') {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <div className="card p-10 border-purple-500/30">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-purple-500/20 flex items-center justify-center">
            <Users className="w-10 h-10 text-purple-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">Equipo disponible en Plan Business</h2>
          <p className="text-[var(--text-muted)] mb-6">
            Agrega vendedores, gerentes y soporte con roles y permisos personalizados.
            Asigna chats a miembros del equipo y controla el acceso.
          </p>
          <div className="flex flex-col items-center gap-4">
            <a href="/subscription" className="px-8 py-3 bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-bold rounded-xl text-lg hover:shadow-lg hover:shadow-purple-500/30 transition-all hover:scale-105">
              🚀 Upgrade a Business — USD$50/mes
            </a>
            <p className="text-xs text-[var(--text-muted)]">Equipo multi-usuario · Roles · Asignación de chats</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #a855f7, #3b82f6)' }}>
            <Users className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Equipo</h1>
            <p className="text-[var(--text-muted)]">Gestiona sub-usuarios, roles y permisos</p>
          </div>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> Agregar Miembro
        </button>
      </div>

      {/* Mensaje */}
      {message.text && (
        <div className={`p-4 rounded-xl border animate-fade-in ${message.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
          {message.text}
        </div>
      )}

      {/* Owner Card */}
      {owner && (
        <div className="card" style={{ borderColor: 'rgba(16, 185, 129, 0.3)', background: 'rgba(16, 185, 129, 0.05)' }}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-emerald-500/20">
              <Crown className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">{owner.name || owner.email}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">Administrador</span>
              </div>
              <p className="text-sm text-[var(--text-muted)]">{owner.email} — Acceso completo</p>
            </div>
          </div>
        </div>
      )}

      {/* Formulario Crear Miembro */}
      {showCreate && (
        <div className="card animate-fade-in" style={{ borderColor: 'rgba(59, 130, 246, 0.3)' }}>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-blue-400" /> Nuevo Miembro
            </h3>
            <button onClick={() => setShowCreate(false)} className="p-2 text-[var(--text-muted)] hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-5">
            {/* Datos básicos */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="input-label">Nombre</label>
                <input type="text" className="input" placeholder="Juan Pérez" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">Email *</label>
                <input type="email" className="input" placeholder="juan@empresa.com" value={form.email} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">Contraseña *</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} className="input pr-10" placeholder="Mínimo 6 caracteres" value={form.password} onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))} />
                  <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Selector de Rol */}
            <div>
              <label className="input-label">Rol</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {ROLES.map(role => (
                  <button key={role.id} onClick={() => handleRoleChange(role.id)}
                    className="p-4 rounded-xl border-2 text-center transition-all"
                    style={{
                      borderColor: form.role === role.id ? `${role.color}80` : 'var(--border-primary)',
                      background: form.role === role.id ? `${role.color}15` : 'transparent'
                    }}>
                    <role.icon className="w-6 h-6 mx-auto mb-2" style={{ color: form.role === role.id ? role.color : 'var(--text-muted)' }} />
                    <p className="text-sm font-semibold text-white">{role.label}</p>
                    <p className="text-[10px] text-[var(--text-muted)] mt-1">{role.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Grid de permisos */}
            <div>
              <label className="input-label">Permisos Personalizados</label>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                {PERMS.map(perm => (
                  <button key={perm.id} onClick={() => togglePerm(perm.id)}
                    className="p-3 rounded-xl flex flex-col items-center gap-2 text-center transition-all border"
                    style={{
                      borderColor: form.permissions[perm.id] ? 'rgba(16, 185, 129, 0.5)' : 'var(--border-primary)',
                      background: form.permissions[perm.id] ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-tertiary)',
                      opacity: form.permissions[perm.id] ? 1 : 0.5
                    }}>
                    <perm.icon className="w-5 h-5" style={{ color: form.permissions[perm.id] ? '#10b981' : 'var(--text-muted)' }} />
                    <span className="text-[10px] font-medium text-white">{perm.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Acciones */}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancelar</button>
              <button onClick={handleCreate} disabled={saving} className="btn-primary">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Crear Miembro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lista de miembros */}
      <div className="space-y-4">
        {members.length > 0 ? (
          members.map(member => {
            const roleInfo = getRoleInfo(member.role);
            const perms = (typeof member.permissions === 'string' ? JSON.parse(member.permissions) : member.permissions) || {};
            const isExpanded = editingId === member.id;

            return (
              <div key={member.id} className={`card transition-all ${!member.isActive ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `${roleInfo.color}30` }}>
                    <roleInfo.icon className="w-6 h-6" style={{ color: roleInfo.color }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-white">{member.name || member.email}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${roleInfo.color}30`, color: roleInfo.color }}>
                        {roleInfo.label}
                      </span>
                      {!member.isActive && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">Inactivo</span>
                      )}
                    </div>
                    <p className="text-sm text-[var(--text-muted)] truncate">{member.email}</p>
                  </div>

                  <div className="text-right hidden md:block">
                    <p className="text-lg font-bold text-white">{member.assignedConversations || 0}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">chats</p>
                  </div>

                  <div className="flex items-center gap-1">
                    <button onClick={() => setEditingId(isExpanded ? null : member.id)} className="p-2 rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-all">
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleToggleActive(member)} className="p-2 rounded-lg transition-all" style={{ color: member.isActive ? '#10b981' : '#ef4444' }}>
                      {member.isActive ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    </button>
                    <button onClick={() => handleDelete(member)} className="p-2 rounded-lg text-red-400 hover:bg-red-500/20 transition-all">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Editor de permisos expandido */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-[var(--border-primary)] animate-fade-in">
                    <p className="text-sm font-medium text-white mb-3">Permisos de {member.name || member.email}</p>
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                      {PERMS.map(perm => (
                        <button key={perm.id} onClick={() => handleUpdatePerms(member, { ...perms, [perm.id]: !perms[perm.id] })}
                          className="p-2.5 rounded-lg flex flex-col items-center gap-1.5 text-center transition-all border"
                          style={{
                            borderColor: perms[perm.id] ? 'rgba(16, 185, 129, 0.5)' : 'var(--border-primary)',
                            background: perms[perm.id] ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                            opacity: perms[perm.id] ? 1 : 0.4
                          }}>
                          <perm.icon className="w-4 h-4" style={{ color: perms[perm.id] ? '#10b981' : 'var(--text-muted)' }} />
                          <span className="text-[9px] font-medium text-white">{perm.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="card text-center py-16">
            <Users className="w-16 h-16 mx-auto mb-4 text-[var(--text-muted)]" style={{ opacity: 0.3 }} />
            <h3 className="text-xl font-semibold text-white mb-2">Sin miembros de equipo</h3>
            <p className="text-[var(--text-muted)] mb-6">Agrega vendedores, soporte o gerentes para distribuir el trabajo</p>
            <button onClick={() => setShowCreate(true)} className="btn-primary"><UserPlus className="w-4 h-4" />Agregar Primer Miembro</button>
          </div>
        )}
      </div>

      {/* Info Card */}
      <div className="card" style={{ background: 'rgba(59, 130, 246, 0.05)', borderColor: 'rgba(59, 130, 246, 0.2)' }}>
        <h4 className="font-semibold mb-3 flex items-center gap-2" style={{ color: '#3b82f6' }}>
          <Shield className="w-4 h-4" />Cómo funciona
        </h4>
        <div className="text-sm text-[var(--text-muted)] space-y-2">
          <p>• <strong className="text-white">Vendedor:</strong> Ve conversaciones, CRM, agenda y productos. Ideal para equipo de ventas.</p>
          <p>• <strong className="text-white">Soporte:</strong> Solo conversaciones y CRM. Para atención al cliente.</p>
          <p>• <strong className="text-white">Gerente:</strong> Acceso completo. Para jefes de área.</p>
          <p>• <strong className="text-white">Asignar chats:</strong> Desde Conversaciones puedes asignar cada chat a un miembro.</p>
          <p>• Los sub-usuarios comparten el WhatsApp y la IA del administrador.</p>
          <p>• Cada sub-usuario inicia sesión con su email y contraseña propios.</p>
          <p>• <strong className="text-white">&quot;..&quot;</strong> pausa la IA (hablar con humano) • <strong className="text-white">&quot;.&quot;</strong> reactiva la IA.</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center py-6">
        <div className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white/5 border border-white/10">
          <img src="/bizonne.png" alt="Bizonne" className="w-8 h-8 rounded-lg" />
          <span className="text-sm text-[var(--text-muted)]">Powered by <span className="text-white font-semibold">Bizonne</span></span>
        </div>
      </div>
    </div>
  );
}

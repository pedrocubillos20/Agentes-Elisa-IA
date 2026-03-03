'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Shield, Users, CreditCard, Clock, Search, 
  RefreshCw, X,
  DollarSign, UserCheck, UserX, Edit3, Save, Lock,
  Tag, Plus, Trash2, ToggleLeft, ToggleRight, Gift, Percent, Copy, Check,
  Wrench
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function AdminPage() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [users, setUsers] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'users' | 'payments' | 'discounts' | 'audit' | 'implementations'>('users');
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState('trial');
  const [editDays, setEditDays] = useState(30);
  const [actionLoading, setActionLoading] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [addonLoading, setAddonLoading] = useState('');
  const [auditData, setAuditData] = useState<any>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<any>(null);

  // Discount codes state
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [showCreateDiscount, setShowCreateDiscount] = useState(false);
  const [newDiscount, setNewDiscount] = useState({
    code: '',
    description: '',
    discountType: 'percent',
    discountValue: '',
    applicablePlans: [] as string[],
    applicablePeriods: [] as string[],
    maxUses: '',
    maxUsesPerUser: '1',
    expiresAt: ''
  });
  const [discountLoading, setDiscountLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState('');

  // Implementations state
  const [implementations, setImplementations] = useState<any[]>([]);
  const [implStats, setImplStats] = useState({ total: 0, completed: 0, inProgress: 0, pending: 0 });
  const [implLoading, setImplLoading] = useState(false);

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  // 🔒 Verificar admin via backend API (no más contraseña hardcodeada)
  useEffect(() => {
    const verifyAdmin = async () => {
      if (!token) { router.push('/login'); return; }
      try {
        const res = await fetch(`${API_URL}/api/auth/admin/verify`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.isAdmin) {
            setAuthenticated(true);
          } else {
            alert('No tienes permisos de administrador');
            router.push('/dashboard');
          }
        } else {
          alert('No tienes permisos de administrador');
          router.push('/dashboard');
        }
      } catch (error) {
        console.error('Error verificando admin:', error);
        router.push('/dashboard');
      } finally {
        setChecking(false);
      }
    };
    verifyAdmin();
  }, []);

  useEffect(() => {
    if (authenticated) loadAll();
  }, [authenticated]);

  const loadAll = async () => {
    if (!token) { router.push('/login'); return; }
    setRefreshing(true);
    setLoading(true);
    try {
      const [usersRes, paymentsRes, discountsRes] = await Promise.all([
        fetch(`${API_URL}/api/subscription/admin/users`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/api/subscription/admin/payments`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/api/subscription/admin/discounts`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      if (usersRes.ok) setUsers((await usersRes.json()).users || []);
      else if (usersRes.status === 403) { alert('No tienes permisos de administrador'); router.push('/dashboard'); return; }
      if (paymentsRes.ok) setPayments((await paymentsRes.json()).payments || []);
      if (discountsRes.ok) setDiscounts((await discountsRes.json()).discounts || []);
      // Cargar implementaciones en paralelo
      loadImplementations();
    } catch (e) { console.error(e); }
    setLoading(false);
    setRefreshing(false);
  };

  const handleExtend = async (targetUserId: string) => {
    setActionLoading(targetUserId);
    try {
      const res = await fetch(`${API_URL}/api/subscription/admin/extend`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId, plan: editPlan, days: editDays })
      });
      if (res.ok) { alert('✅ Plan actualizado'); setEditingUser(null); loadAll(); }
      else alert('❌ Error al actualizar');
    } catch (e) { alert('❌ Error de conexión'); }
    setActionLoading('');
  };

  const handleAddon = async (targetUserId: string, addonPlan: string, action: 'add' | 'remove') => {
    setAddonLoading(`${targetUserId}-${addonPlan}`);
    try {
      const res = await fetch(`${API_URL}/api/subscription/admin/addon`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId, addonPlan, action })
      });
      const data = await res.json();
      if (res.ok) { loadAll(); }
      else alert(`❌ ${data.error || 'Error'}`);
    } catch (e) { alert('❌ Error de conexión'); }
    setAddonLoading('');
  };

  // ===== DISCOUNT FUNCTIONS =====
  const handleCreateDiscount = async () => {
    if (!newDiscount.code || !newDiscount.discountValue) {
      alert('Código y valor son requeridos');
      return;
    }

    setDiscountLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/subscription/admin/discounts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newDiscount,
          code: newDiscount.code.toUpperCase().trim()
        })
      });

      const data = await res.json();
      if (res.ok) {
        alert('✅ Código de descuento creado');
        setShowCreateDiscount(false);
        setNewDiscount({
          code: '', description: '', discountType: 'percent', discountValue: '',
          applicablePlans: [], applicablePeriods: [], maxUses: '', maxUsesPerUser: '1', expiresAt: ''
        });
        loadAll();
      } else {
        alert(`❌ ${data.error || 'Error al crear'}`);
      }
    } catch (e) { alert('❌ Error de conexión'); }
    setDiscountLoading(false);
  };

  const handleToggleDiscount = async (id: string, currentActive: boolean) => {
    try {
      const res = await fetch(`${API_URL}/api/subscription/admin/discounts/${id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentActive })
      });
      if (res.ok) loadAll();
    } catch (e) { console.error(e); }
  };

  const handleDeleteDiscount = async (id: string, code: string) => {
    if (!confirm(`¿Eliminar el código "${code}"? Esta acción no se puede deshacer.`)) return;
    try {
      const res = await fetch(`${API_URL}/api/subscription/admin/discounts/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) { alert('✅ Código eliminado'); loadAll(); }
    } catch (e) { alert('❌ Error'); }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(''), 2000);
  };

  const togglePlan = (plan: string) => {
    setNewDiscount(prev => ({
      ...prev,
      applicablePlans: prev.applicablePlans.includes(plan)
        ? prev.applicablePlans.filter(p => p !== plan)
        : [...prev.applicablePlans, plan]
    }));
  };

  const togglePeriod = (period: string) => {
    setNewDiscount(prev => ({
      ...prev,
      applicablePeriods: prev.applicablePeriods.includes(period)
        ? prev.applicablePeriods.filter(p => p !== period)
        : [...prev.applicablePeriods, period]
    }));
  };

  // ===== IMPLEMENTATION FUNCTIONS =====
  const loadImplementations = async () => {
    setImplLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/subscription/admin/implementations`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setImplementations(data.implementations || []);
        setImplStats({ total: data.total, completed: data.completed, inProgress: data.inProgress, pending: data.pending });
      }
    } catch (e) { console.error(e); }
    setImplLoading(false);
  };

  const handleImpersonate = async (targetUserId: string, userName: string, userEmail: string) => {
    if (!confirm(`¿Entrar a la cuenta de "${userName}"?\n\nTendrás acceso total por 2 horas.\nUsa el banner naranja para volver al panel admin.`)) return;
    
    try {
      const res = await fetch(`${API_URL}/api/auth/admin/impersonate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId })
      });
      
      if (res.ok) {
        const data = await res.json();
        
        // Guardar token admin original
        localStorage.setItem('bizonne_admin_token', token!);
        localStorage.setItem('bizonne_impersonating', JSON.stringify({
          userId: data.user.id,
          userName: data.user.name || data.user.email,
          userEmail: data.user.email,
          startedAt: new Date().toISOString()
        }));
        
        // Limpiar cache del usuario actual
        localStorage.removeItem('bizonne_user_cache');
        
        // Reemplazar con token del usuario target
        localStorage.setItem('token', data.token);
        
        // Redirigir al dashboard del usuario
        window.location.href = '/dashboard';
      } else {
        const err = await res.json();
        alert(`❌ ${err.error || 'Error al impersonar'}`);
      }
    } catch (e) {
      alert('❌ Error de conexión');
    }
  };

  const formatCOP = (n: number) => '$' + Math.round(n).toLocaleString('es-CO');
  const formatDate = (d: string) => new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

  // ===== VERIFICANDO ACCESO =====
  if (checking || !authenticated) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-3xl p-10 shadow-2xl text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-red-500/20 to-orange-500/20 rounded-2xl mx-auto mb-4 flex items-center justify-center border border-red-500/20">
            <Shield className="w-10 h-10 text-red-400" />
          </div>
          <h1 className="text-2xl font-black text-white">Panel de Administración</h1>
          <p className="text-gray-500 text-sm mt-2">Verificando permisos...</p>
          <div className="mt-6 flex justify-center">
            <RefreshCw className="w-6 h-6 text-red-400 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  // ===== PANEL ADMIN =====
  const filteredUsers = users.filter(u => {
    const matchSearch = !search || u.email?.toLowerCase().includes(search.toLowerCase()) || u.name?.toLowerCase().includes(search.toLowerCase());
    const matchPlan = filterPlan === 'all' || u.plan === filterPlan;
    const matchStatus = filterStatus === 'all' || u.subscriptionStatus === filterStatus;
    return matchSearch && matchPlan && matchStatus;
  });

  const totalUsers = users.length;
  const activeTrials = users.filter(u => u.subscriptionStatus === 'trial').length;
  const activePaid = users.filter(u => u.subscription && u.subscription.status === 'active').length;
  const expired = users.filter(u => u.subscriptionStatus === 'expired').length;
  const totalRevenueUsd = payments.filter(p => p.status === 'approved').reduce((sum, p) => sum + (p.amountUsd || 0), 0);
  const totalRevenue = payments.filter(p => p.status === 'approved').reduce((sum, p) => sum + (p.totalCop || 0), 0);

  const statusColors: Record<string, string> = {
    trial: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    expired: 'bg-red-500/20 text-red-400 border-red-500/30',
    cancelled: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    past_due: 'bg-amber-500/20 text-amber-400 border-amber-500/30'
  };
  const statusLabels: Record<string, string> = { trial: '🧪 Trial', active: '✅ Activo', expired: '❌ Expirado', cancelled: '⏹️ Cancelado', past_due: '⚠️ Mora' };
  const planLabels: Record<string, string> = { trial: 'Trial Gratis', starter: 'Starter', business: 'Business' };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3"><Shield className="w-8 h-8 text-red-400" /> Panel de Administración</h1>
          <p className="text-[var(--text-muted)] mt-1">Gestiona usuarios, suscripciones y pagos</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={loadAll} disabled={refreshing} className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-xl text-sm font-medium text-white hover:bg-white/15 transition">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Actualizar
          </button>
          <button onClick={() => { router.push('/dashboard'); }}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/20 transition border border-red-500/20">
            <Lock className="w-4 h-4" /> Cerrar Admin
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total Usuarios', value: totalUsers, icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Trials Activos', value: activeTrials, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Pagos Activos', value: activePaid, icon: UserCheck, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Expirados', value: expired, icon: UserX, color: 'text-red-400', bg: 'bg-red-500/10' },
          { label: 'Ingresos USD', value: `$${totalRevenueUsd.toLocaleString()}`, icon: DollarSign, color: 'text-green-400', bg: 'bg-green-500/10' },
        ].map((s, i) => (
          <div key={i} className={`${s.bg} rounded-2xl p-4 border border-white/5`}>
            <div className="flex items-center gap-2 mb-2"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-gray-500 font-medium">{s.label}</span></div>
            <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10">
        {[
          { id: 'users' as const, label: 'Usuarios', icon: Users, count: totalUsers },
          { id: 'payments' as const, label: 'Pagos', icon: CreditCard, count: payments.length },
          { id: 'discounts' as const, label: 'Descuentos', icon: Tag, count: discounts.length },
          { id: 'implementations' as const, label: 'Implementaciones', icon: Wrench, count: implStats.total },
          { id: 'audit' as const, label: 'Auditoría DB', icon: Shield, count: 0 },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition ${tab === t.id ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            <t.icon className="w-4 h-4" /> {t.label} <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full">{t.count}</span>
          </button>
        ))}
      </div>

      {/* ===== USERS TAB ===== */}
      {tab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input type="text" placeholder="Buscar por email o nombre..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:border-emerald-500/50 focus:outline-none" />
            </div>
            <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none">
              <option value="all">Todos los planes</option><option value="trial">Trial</option><option value="starter">Starter</option><option value="business">Business</option>
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none">
              <option value="all">Todos</option><option value="trial">Trial activo</option><option value="active">Pagado</option><option value="expired">Expirado</option>
            </select>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
            <table className="w-full">
              <thead><tr className="border-b border-white/10 text-left">
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Usuario</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Plan</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Addons</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Estado</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Días</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Chats</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Registro</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Acciones</th>
              </tr></thead>
              <tbody>
                {filteredUsers.map(u => (
                  <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.03] transition">
                    <td className="px-5 py-4"><div className="font-semibold text-white text-sm">{u.name || 'Sin nombre'}</div><div className="text-gray-500 text-xs">{u.email}</div></td>
                    <td className="px-5 py-4">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${u.plan === 'business' ? 'bg-purple-500/20 text-purple-400' : u.plan === 'starter' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-400'}`}>
                        {planLabels[u.plan] || u.plan}
                      </span>
                      {u.subscription?.period && <span className="text-[10px] text-gray-600 ml-1">({u.subscription.period === 'annual' ? 'Anual' : u.subscription.period === 'semiannual' ? '6M' : 'Mes'})</span>}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1">
                        {u.addons?.implementation && <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">🛠️ Impl</span>}
                        {u.addons?.prioritySupport && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">📞 Sop</span>}
                        {u.addons?.aiConfig && <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400">🤖 IA</span>}
                        {u.addons?.extraLines > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">📱 +{u.addons.extraLines}</span>}
                        {u.addons?.extraProducts > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">📦 +{u.addons.extraProducts * 10}</span>}
                        {!u.addons?.implementation && !u.addons?.prioritySupport && !u.addons?.aiConfig && !u.addons?.extraLines && !u.addons?.extraProducts && <span className="text-[9px] text-gray-600">—</span>}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${statusColors[u.subscriptionStatus] || statusColors.expired}`}>{statusLabels[u.subscriptionStatus] || u.subscriptionStatus}</span>
                      {u.daysUntilDeletion !== null && u.daysUntilDeletion !== undefined && u.subscriptionStatus === 'expired' && (
                        <div className="mt-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${u.daysUntilDeletion <= 3 ? 'bg-red-600/30 text-red-300 animate-pulse' : u.daysUntilDeletion <= 7 ? 'bg-orange-500/20 text-orange-400' : 'bg-gray-500/15 text-gray-500'}`}>
                            🗑️ {u.plan === 'trial' ? '5d' : '5d'} gracia → {u.daysUntilDeletion}d
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4"><span className={`text-sm font-bold ${u.daysLeft <= 5 ? 'text-red-400' : u.daysLeft <= 10 ? 'text-amber-400' : 'text-emerald-400'}`}>{u.daysLeft}d</span></td>
                    <td className="px-5 py-4 text-sm text-gray-400">{u._count?.conversations || 0}</td>
                    <td className="px-5 py-4 text-xs text-gray-500">{formatDate(u.createdAt)}</td>
                    <td className="px-5 py-4">
                      {editingUser === u.id ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <select value={editPlan} onChange={e => setEditPlan(e.target.value)} className="bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-xs text-white">
                              <option value="trial">Trial</option><option value="starter">Starter</option><option value="business">Business</option>
                            </select>
                            <input type="number" value={editDays} onChange={e => setEditDays(Number(e.target.value))} className="w-16 bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-xs text-white" />
                            <button onClick={() => handleExtend(u.id)} disabled={actionLoading === u.id} className="p-1.5 bg-emerald-500/20 rounded-lg text-emerald-400 hover:bg-emerald-500/30">
                              {actionLoading === u.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={() => setEditingUser(null)} className="p-1.5 bg-red-500/20 rounded-lg text-red-400 hover:bg-red-500/30"><X className="w-3.5 h-3.5" /></button>
                          </div>
                          {/* Addon toggles */}
                          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-white/5">
                            {[
                              { plan: 'implementation', label: '🛠️ Impl', active: u.addons?.implementation },
                              { plan: 'priority_support', label: '📞 Sop', active: u.addons?.prioritySupport },
                              { plan: 'ai_config', label: '🤖 IA', active: u.addons?.aiConfig },
                              { plan: 'extra_line', label: '📱 +Línea', active: false },
                              { plan: 'extra_products', label: '📦 +Prod', active: false }
                            ].map(a => (
                              <button key={a.plan} disabled={addonLoading === `${u.id}-${a.plan}`}
                                onClick={() => handleAddon(u.id, a.plan, a.active ? 'remove' : 'add')}
                                className={`text-[9px] px-2 py-1 rounded-lg border transition-all ${
                                  addonLoading === `${u.id}-${a.plan}` ? 'opacity-50' :
                                  a.active ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400 hover:bg-red-500/20 hover:border-red-500/30 hover:text-red-400' :
                                  'bg-white/5 border-white/10 text-gray-500 hover:bg-emerald-500/10 hover:border-emerald-500/20 hover:text-emerald-400'
                                }`}>
                                {addonLoading === `${u.id}-${a.plan}` ? '...' : a.active ? `✅ ${a.label}` : `+ ${a.label}`}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <>
                        <button onClick={() => { setEditingUser(u.id); setEditPlan(u.plan); setEditDays(30); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/10 transition">
                          <Edit3 className="w-3.5 h-3.5" /> Editar
                        </button>
                        {u.addons?.implementation && (
                          <button onClick={() => handleImpersonate(u.id, u.name || u.email, u.email)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/10 rounded-lg text-xs text-orange-400 hover:bg-orange-500/20 transition border border-orange-500/20">
                            <Wrench className="w-3.5 h-3.5" /> Implementar
                          </button>
                        )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredUsers.length === 0 && <div className="text-center py-12 text-gray-500"><Users className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>No se encontraron usuarios</p></div>}
          </div>
        </div>
      )}

      {/* ===== PAYMENTS TAB ===== */}
      {tab === 'payments' && (
        <div className="space-y-4">
          {payments.length === 0 ? (
            <div className="text-center py-16 text-gray-500"><CreditCard className="w-12 h-12 mx-auto mb-4 opacity-30" /><p className="text-lg font-semibold">No hay pagos registrados</p></div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
              <table className="w-full">
                <thead><tr className="border-b border-white/10 text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Usuario</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Plan</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">USD</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">COP</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Descuento</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Método</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Estado</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Fecha</th>
                </tr></thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.03] transition">
                      <td className="px-5 py-4"><div className="text-sm font-medium text-white">{p.user?.name || 'Sin nombre'}</div><div className="text-xs text-gray-500">{p.user?.email}</div></td>
                      <td className="px-5 py-4"><span className="text-xs font-bold">{p.plan === 'business' ? '🏢 Business' : '🚀 Starter'}</span></td>
                      <td className="px-5 py-4 text-sm font-semibold text-white">${p.amountUsd}</td>
                      <td className="px-5 py-4 text-sm text-emerald-400">{formatCOP(p.totalCop)}</td>
                      <td className="px-5 py-4">
                        {p.discountCode ? (
                          <div>
                            <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full font-bold">🏷️ {p.discountCode}</span>
                            {p.discountAmount && <div className="text-[10px] text-purple-400 mt-1">-{formatCOP(p.discountAmount)}</div>}
                          </div>
                        ) : <span className="text-xs text-gray-600">—</span>}
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-400">{p.method || '—'}</td>
                      <td className="px-5 py-4"><span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${p.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : p.status === 'pending' ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'}`}>
                        {p.status === 'approved' ? '✅ Aprobado' : p.status === 'pending' ? '⏳ Pendiente' : '❌ ' + p.status}
                      </span></td>
                      <td className="px-5 py-4 text-xs text-gray-500">{formatDate(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {payments.filter(p => p.status === 'approved').length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <div className="bg-emerald-500/10 rounded-2xl p-5 border border-emerald-500/20"><p className="text-xs text-gray-500 mb-1">Total COP</p><p className="text-2xl font-black text-emerald-400">{formatCOP(totalRevenue)}</p></div>
              <div className="bg-green-500/10 rounded-2xl p-5 border border-green-500/20"><p className="text-xs text-gray-500 mb-1">Total USD</p><p className="text-2xl font-black text-green-400">${totalRevenueUsd.toLocaleString()}</p></div>
              <div className="bg-blue-500/10 rounded-2xl p-5 border border-blue-500/20"><p className="text-xs text-gray-500 mb-1">Pagos Aprobados</p><p className="text-2xl font-black text-blue-400">{payments.filter(p => p.status === 'approved').length}</p></div>
            </div>
          )}
        </div>
      )}

      {/* ===== DISCOUNTS TAB ===== */}
      {tab === 'discounts' && (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2"><Tag className="w-5 h-5 text-purple-400" /> Códigos de Descuento</h2>
              <p className="text-gray-500 text-sm mt-1">Crea y gestiona códigos para campañas y promociones</p>
            </div>
            <button
              onClick={() => setShowCreateDiscount(!showCreateDiscount)}
              className="flex items-center gap-2 px-4 py-2.5 bg-purple-500/20 border border-purple-500/30 text-purple-300 rounded-xl text-sm font-semibold hover:bg-purple-500/30 transition">
              <Plus className="w-4 h-4" /> Crear Código
            </button>
          </div>

          {/* Create Form */}
          {showCreateDiscount && (
            <div className="bg-purple-500/5 border border-purple-500/20 rounded-2xl p-6 space-y-5">
              <h3 className="font-bold text-purple-300 flex items-center gap-2"><Gift className="w-5 h-5" /> Nuevo Código de Descuento</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Code */}
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Código *</label>
                  <input
                    type="text"
                    value={newDiscount.code}
                    onChange={e => setNewDiscount(prev => ({ ...prev, code: e.target.value.toUpperCase().replace(/\s/g, '') }))}
                    placeholder="Ej: BIENVENIDO20"
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-600 focus:border-purple-500/50 focus:outline-none uppercase tracking-wider"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Descripción</label>
                  <input
                    type="text"
                    value={newDiscount.description}
                    onChange={e => setNewDiscount(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Ej: Descuento de bienvenida"
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-600 focus:border-purple-500/50 focus:outline-none"
                  />
                </div>

                {/* Discount Type */}
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Tipo de descuento</label>
                  <select
                    value={newDiscount.discountType}
                    onChange={e => setNewDiscount(prev => ({ ...prev, discountType: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none">
                    <option value="percent">Porcentaje (%)</option>
                    <option value="fixed_usd">Monto fijo USD ($)</option>
                    <option value="fixed_cop">Monto fijo COP ($)</option>
                  </select>
                </div>

                {/* Discount Value */}
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">
                    Valor * {newDiscount.discountType === 'percent' ? '(%)' : newDiscount.discountType === 'fixed_usd' ? '(USD)' : '(COP)'}
                  </label>
                  <input
                    type="number"
                    value={newDiscount.discountValue}
                    onChange={e => setNewDiscount(prev => ({ ...prev, discountValue: e.target.value }))}
                    placeholder={newDiscount.discountType === 'percent' ? 'Ej: 20' : newDiscount.discountType === 'fixed_usd' ? 'Ej: 10' : 'Ej: 50000'}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-600 focus:border-purple-500/50 focus:outline-none"
                  />
                </div>

                {/* Max Uses */}
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Usos máximos totales</label>
                  <input
                    type="number"
                    value={newDiscount.maxUses}
                    onChange={e => setNewDiscount(prev => ({ ...prev, maxUses: e.target.value }))}
                    placeholder="Vacío = ilimitado"
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-600 focus:border-purple-500/50 focus:outline-none"
                  />
                </div>

                {/* Max Uses Per User */}
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Usos por usuario</label>
                  <input
                    type="number"
                    value={newDiscount.maxUsesPerUser}
                    onChange={e => setNewDiscount(prev => ({ ...prev, maxUsesPerUser: e.target.value }))}
                    placeholder="1"
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-600 focus:border-purple-500/50 focus:outline-none"
                  />
                </div>

                {/* Expiry */}
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Fecha de expiración</label>
                  <input
                    type="datetime-local"
                    value={newDiscount.expiresAt}
                    onChange={e => setNewDiscount(prev => ({ ...prev, expiresAt: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:border-purple-500/50 focus:outline-none"
                  />
                  <p className="text-gray-600 text-[10px] mt-1">Vacío = sin expiración</p>
                </div>
              </div>

              {/* Applicable Plans */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">Planes aplicables (vacío = todos)</label>
                <div className="flex gap-2">
                  {['starter', 'business'].map(p => (
                    <button key={p} onClick={() => togglePlan(p)}
                      className={`px-4 py-2 rounded-xl text-xs font-semibold border transition ${
                        newDiscount.applicablePlans.includes(p)
                          ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                          : 'bg-white/5 border-white/10 text-gray-500 hover:text-gray-300'
                      }`}>
                      {p === 'starter' ? '🚀 Starter' : '🏢 Business'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Applicable Periods */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">Periodos aplicables (vacío = todos)</label>
                <div className="flex gap-2">
                  {[
                    { id: 'monthly', label: 'Mensual' },
                    { id: 'semiannual', label: '6 Meses' },
                    { id: 'annual', label: 'Anual' }
                  ].map(p => (
                    <button key={p.id} onClick={() => togglePeriod(p.id)}
                      className={`px-4 py-2 rounded-xl text-xs font-semibold border transition ${
                        newDiscount.applicablePeriods.includes(p.id)
                          ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                          : 'bg-white/5 border-white/10 text-gray-500 hover:text-gray-300'
                      }`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleCreateDiscount}
                  disabled={discountLoading || !newDiscount.code || !newDiscount.discountValue}
                  className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-xl font-semibold text-sm hover:bg-purple-500 transition disabled:opacity-40">
                  {discountLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Crear Código
                </button>
                <button onClick={() => setShowCreateDiscount(false)}
                  className="px-6 py-3 bg-white/5 text-gray-400 rounded-xl text-sm hover:bg-white/10 transition">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Discounts List */}
          {discounts.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Tag className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-semibold">No hay códigos de descuento</p>
              <p className="text-sm mt-1">Crea tu primer código para ofrecer promociones a tus clientes</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {discounts.map(d => (
                <div key={d.id} className={`rounded-2xl border p-5 transition ${d.isActive ? 'bg-white/[0.02] border-white/10' : 'bg-red-500/5 border-red-500/10 opacity-60'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      {/* Code Badge */}
                      <div className="flex items-center gap-2">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${d.isActive ? 'bg-purple-500/20' : 'bg-gray-500/20'}`}>
                          <Tag className={`w-6 h-6 ${d.isActive ? 'text-purple-400' : 'text-gray-500'}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-lg text-white tracking-wider">{d.code}</span>
                            <button onClick={() => copyCode(d.code)} className="p-1 hover:bg-white/10 rounded-lg transition" title="Copiar código">
                              {copiedCode === d.code ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-gray-500" />}
                            </button>
                            {!d.isActive && <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-bold">INACTIVO</span>}
                          </div>
                          {d.description && <p className="text-xs text-gray-500 mt-0.5">{d.description}</p>}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleToggleDiscount(d.id, d.isActive)}
                        className={`p-2 rounded-lg transition ${d.isActive ? 'hover:bg-amber-500/10 text-emerald-400' : 'hover:bg-emerald-500/10 text-gray-500'}`}
                        title={d.isActive ? 'Desactivar' : 'Activar'}>
                        {d.isActive ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                      </button>
                      <button onClick={() => handleDeleteDiscount(d.id, d.code)}
                        className="p-2 hover:bg-red-500/10 rounded-lg text-gray-500 hover:text-red-400 transition"
                        title="Eliminar">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4 pt-4 border-t border-white/5">
                    <div>
                      <span className="text-[10px] text-gray-600 uppercase font-semibold">Descuento</span>
                      <div className="text-sm font-bold text-purple-400 mt-0.5">
                        {d.discountType === 'percent' ? `${d.discountValue}%` : 
                         d.discountType === 'fixed_usd' ? `$${d.discountValue} USD` : 
                         `$${d.discountValue.toLocaleString('es-CO')} COP`}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-600 uppercase font-semibold">Usos</span>
                      <div className="text-sm font-bold text-white mt-0.5">
                        {d.currentUses}{d.maxUses ? ` / ${d.maxUses}` : ' / ∞'}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-600 uppercase font-semibold">Por usuario</span>
                      <div className="text-sm font-bold text-white mt-0.5">{d.maxUsesPerUser}x</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-600 uppercase font-semibold">Planes</span>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {d.applicablePlans?.length > 0 ? d.applicablePlans.join(', ') : 'Todos'}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-600 uppercase font-semibold">Expira</span>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {d.expiresAt ? formatDate(d.expiresAt) : 'Sin expiración'}
                        {d.expiresAt && new Date(d.expiresAt) < new Date() && (
                          <span className="text-red-400 text-[10px] ml-1">(vencido)</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== AUDITORÍA DB ===== */}
      {tab === 'implementations' && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total', value: implStats.total, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
              { label: 'Pendientes', value: implStats.pending, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
              { label: 'En Progreso', value: implStats.inProgress, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
              { label: 'Completadas', value: implStats.completed, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
            ].map((s, i) => (
              <div key={i} className={`${s.bg} rounded-2xl p-4 border ${s.border}`}>
                <p className="text-xs text-gray-500 font-medium">{s.label}</p>
                <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Cards */}
          {implLoading ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="w-6 h-6 text-orange-400 animate-spin" />
            </div>
          ) : implementations.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Wrench className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-semibold">No hay implementaciones</p>
              <p className="text-sm mt-1">Cuando un cliente compre el servicio de implementación, aparecerá aquí</p>
            </div>
          ) : (
            <div className="space-y-4">
              {implementations.map((impl: any) => (
                <div key={impl.paymentId} className="bg-white/[0.02] border border-white/10 rounded-2xl overflow-hidden">
                  {/* Header */}
                  <div className="p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
                        impl.status === 'completed' ? 'bg-emerald-500/20' :
                        impl.status === 'in_progress' ? 'bg-blue-500/20' :
                        'bg-orange-500/20'
                      }`}>
                        <span className="text-2xl">
                          {impl.status === 'completed' ? '✅' : impl.status === 'in_progress' ? '🔧' : '⏳'}
                        </span>
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-white">{impl.user.name || 'Sin nombre'}</h3>
                        <p className="text-sm text-gray-500">{impl.user.email}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            impl.user.plan === 'business' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                          }`}>
                            {impl.user.plan?.toUpperCase()}
                          </span>
                          {impl.user.phone && <span className="text-[10px] text-gray-600">📱 {impl.user.phone}</span>}
                          <span className="text-[10px] text-gray-600">💰 ${impl.amountUsd} USD</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleImpersonate(impl.user.id, impl.user.name || impl.user.email, impl.user.email)}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition hover:brightness-110"
                      style={{
                        background: 'linear-gradient(135deg, #ea580c, #f59e0b)',
                        boxShadow: '0 4px 15px rgba(249,115,22,0.3)'
                      }}
                    >
                      🛠️ Implementar
                    </button>
                  </div>

                  {/* Progress Bar */}
                  <div className="px-5 pb-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-gray-500">Progreso: {impl.completedSteps}/{impl.totalSteps}</span>
                      <span className={`text-xs font-bold ${
                        impl.progress === 100 ? 'text-emerald-400' : impl.progress > 0 ? 'text-blue-400' : 'text-orange-400'
                      }`}>{impl.progress}%</span>
                    </div>
                    <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          impl.progress === 100 ? 'bg-emerald-500' : impl.progress > 0 ? 'bg-blue-500' : 'bg-orange-500'
                        }`}
                        style={{ width: `${impl.progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Checklist */}
                  <div className="px-5 pb-5 pt-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {Object.entries(impl.checklist).map(([key, check]: [string, any]) => (
                        <div
                          key={key}
                          className={`flex items-center gap-2 p-2.5 rounded-xl border ${
                            check.done
                              ? 'bg-emerald-500/10 border-emerald-500/20'
                              : 'bg-white/[0.02] border-white/5'
                          }`}
                        >
                          <span className="text-sm">{check.done ? '✅' : '⬜'}</span>
                          <div>
                            <p className={`text-xs font-semibold ${check.done ? 'text-emerald-400' : 'text-gray-400'}`}>
                              {check.label}
                            </p>
                            <p className="text-[10px] text-gray-600">{check.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Stats footer */}
                  <div className="px-5 pb-4 flex flex-wrap gap-3 border-t border-white/5 pt-3">
                    <span className="text-[10px] text-gray-600">💬 {impl.user.stats.conversations} chats</span>
                    <span className="text-[10px] text-gray-600">👥 {impl.user.stats.clients} clientes</span>
                    <span className="text-[10px] text-gray-600">📱 {impl.user.stats.connectedLines}/{impl.user.stats.lines} líneas</span>
                    <span className="text-[10px] text-gray-600">🤖 {impl.user.stats.assistants} asistentes</span>
                    <span className="text-[10px] text-gray-600">📦 {impl.user.stats.products} productos</span>
                    <span className="text-[10px] text-gray-600 ml-auto">Pagó: {formatDate(impl.paidAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== AUDITORÍA DB (original) ===== */}
      {tab === 'audit' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <button 
              onClick={async () => {
                setAuditLoading(true);
                try {
                  const token = localStorage.getItem('token');
                  const res = await fetch(`${API_URL}/api/subscription/admin/audit`, { headers: { 'Authorization': `Bearer ${token}` } });
                  if (res.ok) setAuditData(await res.json());
                  else alert('Error al auditar');
                } catch { alert('Error de conexión'); }
                setAuditLoading(false);
              }}
              disabled={auditLoading}
              className="px-5 py-2.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg font-bold text-sm hover:bg-blue-500/30 disabled:opacity-50"
            >
              {auditLoading ? '🔍 Analizando...' : '🔍 Ejecutar Auditoría'}
            </button>
            <button 
              onClick={async () => {
                if (!confirm('¿Estás seguro de ejecutar la limpieza? Esto eliminará registros huérfanos permanentemente.')) return;
                setCleanupLoading(true);
                try {
                  const token = localStorage.getItem('token');
                  const res = await fetch(`${API_URL}/api/subscription/admin/cleanup`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
                  if (res.ok) { 
                    const data = await res.json();
                    setCleanupResult(data); 
                    setAuditData(null);
                  } else alert('Error al limpiar');
                } catch { alert('Error de conexión'); }
                setCleanupLoading(false);
              }}
              disabled={cleanupLoading}
              className="px-5 py-2.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg font-bold text-sm hover:bg-red-500/30 disabled:opacity-50"
            >
              {cleanupLoading ? '🧹 Limpiando...' : '🧹 Ejecutar Limpieza'}
            </button>
          </div>

          {auditData && (
            <div className="space-y-3">
              <div className={`p-4 rounded-xl border ${auditData.status?.includes('✅') ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                <h3 className="font-bold text-white text-lg">{auditData.status}</h3>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><span className="text-gray-500">Usuarios:</span> <span className="text-white font-bold">{auditData.totals?.users}</span></div>
                  <div><span className="text-gray-500">Líneas:</span> <span className="text-white font-bold">{auditData.totals?.lines}</span></div>
                  <div><span className="text-gray-500">Conversaciones:</span> <span className="text-white font-bold">{auditData.totals?.conversations}</span></div>
                  <div><span className="text-gray-500">Media:</span> <span className="text-white font-bold">{auditData.totals?.mediaFiles}</span></div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(auditData.orphans || {}).map(([key, val]: [string, any]) => (
                  <div key={key} className={`p-3 rounded-xl border ${val.count > 0 ? 'border-red-500/20 bg-red-500/5' : 'border-white/5 bg-white/[0.02]'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{key}</span>
                      <span className={`text-sm font-bold ${val.count > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{val.count}</span>
                    </div>
                    {val.description && <p className="text-[10px] text-gray-600 mt-1">{val.description}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {cleanupResult && (
            <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
              <h3 className="font-bold text-emerald-400 mb-2">{cleanupResult.message}</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(cleanupResult.cleaned || {}).map(([key, val]: [string, any]) => (
                  <div key={key} className="text-sm">
                    <span className="text-gray-400">{key}:</span> <span className={`font-bold ${val > 0 ? 'text-amber-400' : 'text-gray-600'}`}>{val}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

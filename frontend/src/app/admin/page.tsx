'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Shield, Users, CreditCard, Clock, Crown, Search, ChevronDown, 
  ArrowLeft, RefreshCw, AlertTriangle, Check, X, Zap, Calendar,
  TrendingUp, DollarSign, UserCheck, UserX, Eye, Edit3, Save
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://elisa-ia-agentes-production.up.railway.app';

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'users' | 'payments' | 'stats'>('users');
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState('trial');
  const [editDays, setEditDays] = useState(30);
  const [actionLoading, setActionLoading] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    if (!token) { router.push('/login'); return; }
    setRefreshing(true);

    try {
      const [userRes, usersRes, paymentsRes] = await Promise.all([
        fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/api/subscription/admin/users`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/api/subscription/admin/payments`, { headers: { Authorization: `Bearer ${token}` } })
      ]);

      if (userRes.ok) {
        const d = await userRes.json();
        setUser(d.user);
        // Verificar que es admin
        if (d.user.parentUserId) { router.push('/dashboard'); return; }
      }
      if (usersRes.ok) {
        const d = await usersRes.json();
        setUsers(d.users || []);
      }
      if (paymentsRes.ok) {
        const d = await paymentsRes.json();
        setPayments(d.payments || []);
      }
    } catch (e) {
      console.error(e);
    }
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
      if (res.ok) {
        alert('✅ Plan actualizado correctamente');
        setEditingUser(null);
        loadAll();
      } else {
        alert('❌ Error al actualizar');
      }
    } catch (e) {
      alert('❌ Error de conexión');
    }
    setActionLoading('');
  };

  const formatCOP = (n: number) => '$' + Math.round(n).toLocaleString('es-CO');
  const formatDate = (d: string) => new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

  // Filtros
  const filteredUsers = users.filter(u => {
    const matchSearch = !search || 
      u.email?.toLowerCase().includes(search.toLowerCase()) || 
      u.name?.toLowerCase().includes(search.toLowerCase());
    const matchPlan = filterPlan === 'all' || u.plan === filterPlan;
    const matchStatus = filterStatus === 'all' || u.subscriptionStatus === filterStatus;
    return matchSearch && matchPlan && matchStatus;
  });

  // Stats
  const totalUsers = users.length;
  const activeTrials = users.filter(u => u.subscriptionStatus === 'trial').length;
  const activePaid = users.filter(u => u.subscription && u.subscription.status === 'active').length;
  const expired = users.filter(u => u.subscriptionStatus === 'expired').length;
  const totalRevenue = payments.filter(p => p.status === 'approved').reduce((sum, p) => sum + (p.totalCop || 0), 0);
  const totalRevenueUsd = payments.filter(p => p.status === 'approved').reduce((sum, p) => sum + (p.amountUsd || 0), 0);

  const statusColors: Record<string, string> = {
    trial: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    expired: 'bg-red-500/20 text-red-400 border-red-500/30',
    cancelled: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    past_due: 'bg-amber-500/20 text-amber-400 border-amber-500/30'
  };

  const statusLabels: Record<string, string> = {
    trial: '🧪 Trial',
    active: '✅ Activo',
    expired: '❌ Expirado',
    cancelled: '⏹️ Cancelado',
    past_due: '⚠️ Mora'
  };

  const planLabels: Record<string, string> = {
    trial: 'Trial Gratis',
    starter: 'Starter',
    business: 'Business'
  };

  if (loading) return (
    <div className="min-h-screen bg-[#06060b] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Shield className="w-8 h-8 text-emerald-400" />
            Panel de Administración
          </h1>
          <p className="text-[var(--text-muted)] mt-1">Gestiona usuarios, suscripciones y pagos</p>
        </div>
        <button onClick={loadAll} disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-xl text-sm font-medium text-white hover:bg-white/15 transition">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total Usuarios', value: totalUsers, icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Trials Activos', value: activeTrials, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Pagos Activos', value: activePaid, icon: UserCheck, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Expirados', value: expired, icon: UserX, color: 'text-red-400', bg: 'bg-red-500/10' },
          { label: 'Ingresos USD', value: `$${totalRevenueUsd.toLocaleString()}`, icon: DollarSign, color: 'text-green-400', bg: 'bg-green-500/10' },
        ].map((s, i) => (
          <div key={i} className={`${s.bg} rounded-2xl p-4 border border-white/5`}>
            <div className="flex items-center gap-2 mb-2">
              <s.icon className={`w-4 h-4 ${s.color}`} />
              <span className="text-xs text-gray-500 font-medium">{s.label}</span>
            </div>
            <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-0">
        {[
          { id: 'users' as const, label: 'Usuarios', icon: Users, count: totalUsers },
          { id: 'payments' as const, label: 'Pagos', icon: CreditCard, count: payments.length },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition ${
              tab === t.id ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            <t.icon className="w-4 h-4" /> {t.label}
            <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full">{t.count}</span>
          </button>
        ))}
      </div>

      {/* Users Tab */}
      {tab === 'users' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text" placeholder="Buscar por email o nombre..."
                value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:border-emerald-500/50 focus:outline-none"
              />
            </div>
            <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none">
              <option value="all">Todos los planes</option>
              <option value="trial">Trial</option>
              <option value="starter">Starter</option>
              <option value="business">Business</option>
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none">
              <option value="all">Todos los estados</option>
              <option value="trial">Trial activo</option>
              <option value="active">Pagado activo</option>
              <option value="expired">Expirado</option>
            </select>
          </div>

          {/* Users Table */}
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Usuario</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Plan</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Estado</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Días</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Chats</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Registro</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => (
                  <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.03] transition">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-white text-sm">{u.name || 'Sin nombre'}</div>
                      <div className="text-gray-500 text-xs">{u.email}</div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                        u.plan === 'business' ? 'bg-purple-500/20 text-purple-400' :
                        u.plan === 'starter' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {planLabels[u.plan] || u.plan}
                      </span>
                      {u.subscription?.period && (
                        <span className="text-[10px] text-gray-600 ml-1">
                          ({u.subscription.period === 'annual' ? 'Anual' : u.subscription.period === 'semiannual' ? '6M' : 'Mes'})
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${statusColors[u.subscriptionStatus] || statusColors.expired}`}>
                        {statusLabels[u.subscriptionStatus] || u.subscriptionStatus}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-sm font-bold ${u.daysLeft <= 5 ? 'text-red-400' : u.daysLeft <= 10 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {u.daysLeft}d
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-400">
                      {u._count?.conversations || 0}
                    </td>
                    <td className="px-5 py-4 text-xs text-gray-500">
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="px-5 py-4">
                      {editingUser === u.id ? (
                        <div className="flex items-center gap-2">
                          <select value={editPlan} onChange={e => setEditPlan(e.target.value)}
                            className="bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-xs text-white">
                            <option value="trial">Trial</option>
                            <option value="starter">Starter</option>
                            <option value="business">Business</option>
                          </select>
                          <input type="number" value={editDays} onChange={e => setEditDays(Number(e.target.value))}
                            className="w-16 bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-xs text-white"
                            placeholder="Días" />
                          <button onClick={() => handleExtend(u.id)} disabled={actionLoading === u.id}
                            className="p-1.5 bg-emerald-500/20 rounded-lg text-emerald-400 hover:bg-emerald-500/30 transition">
                            {actionLoading === u.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => setEditingUser(null)}
                            className="p-1.5 bg-red-500/20 rounded-lg text-red-400 hover:bg-red-500/30 transition">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingUser(u.id); setEditPlan(u.plan); setEditDays(30); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/10 transition">
                          <Edit3 className="w-3.5 h-3.5" /> Editar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredUsers.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>No se encontraron usuarios</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payments Tab */}
      {tab === 'payments' && (
        <div className="space-y-4">
          {payments.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <CreditCard className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-semibold">No hay pagos registrados</p>
              <p className="text-sm mt-1">Los pagos aparecerán aquí cuando los usuarios adquieran un plan</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Usuario</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Plan</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Monto USD</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Monto COP</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Método</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Estado</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.03] transition">
                      <td className="px-5 py-4">
                        <div className="text-sm font-medium text-white">{p.user?.name || 'Sin nombre'}</div>
                        <div className="text-xs text-gray-500">{p.user?.email}</div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-xs font-bold">{p.plan === 'business' ? '🏢 Business' : '🚀 Starter'}</span>
                        <span className="text-[10px] text-gray-500 ml-1">
                          ({p.period === 'annual' ? 'Anual' : p.period === 'semiannual' ? '6 Meses' : 'Mensual'})
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm font-semibold text-white">${p.amountUsd}</td>
                      <td className="px-5 py-4 text-sm text-emerald-400">{formatCOP(p.totalCop)}</td>
                      <td className="px-5 py-4 text-xs text-gray-400">{p.method || p.wompiPaymentMethod || '—'}</td>
                      <td className="px-5 py-4">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${
                          p.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' :
                          p.status === 'pending' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {p.status === 'approved' ? '✅ Aprobado' : p.status === 'pending' ? '⏳ Pendiente' : '❌ ' + p.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-500">{formatDate(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Revenue Summary */}
          {payments.filter(p => p.status === 'approved').length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <div className="bg-emerald-500/10 rounded-2xl p-5 border border-emerald-500/20">
                <p className="text-xs text-gray-500 mb-1">Total Recaudado (COP)</p>
                <p className="text-2xl font-black text-emerald-400">{formatCOP(totalRevenue)}</p>
              </div>
              <div className="bg-green-500/10 rounded-2xl p-5 border border-green-500/20">
                <p className="text-xs text-gray-500 mb-1">Total Recaudado (USD)</p>
                <p className="text-2xl font-black text-green-400">${totalRevenueUsd.toLocaleString()}</p>
              </div>
              <div className="bg-blue-500/10 rounded-2xl p-5 border border-blue-500/20">
                <p className="text-xs text-gray-500 mb-1">Pagos Aprobados</p>
                <p className="text-2xl font-black text-blue-400">{payments.filter(p => p.status === 'approved').length}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

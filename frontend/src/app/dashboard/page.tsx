'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { 
  Smartphone, MessageSquare, CheckCircle, XCircle, AlertCircle,
  Users, Calendar, Clock, Activity, BarChart3, ArrowUpRight, Zap
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ===== GRÁFICO LINEAL SVG PURO =====
function LineChart({ data, labels }: { data: number[]; labels: string[] }) {
  const width = 500;
  const height = 160;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVal = Math.max(...data, 1);
  const points = data.map((v, i) => ({
    x: padding.left + (i / Math.max(data.length - 1, 1)) * chartW,
    y: padding.top + chartH - (v / maxVal) * chartH,
    val: v
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = `${pathD} L ${points[points.length - 1]?.x || 0} ${padding.top + chartH} L ${points[0]?.x || 0} ${padding.top + chartH} Z`;

  // Líneas horizontales de guía
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(pct => ({
    y: padding.top + chartH - pct * chartH,
    label: Math.round(pct * maxVal)
  }));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="strokeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#06d6a0" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={padding.left} y1={g.y} x2={width - padding.right} y2={g.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <text x={padding.left - 8} y={g.y + 4} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="10">{g.label}</text>
        </g>
      ))}

      {/* Area fill */}
      {points.length > 1 && <path d={areaD} fill="url(#lineGrad)" />}

      {/* Line */}
      {points.length > 1 && (
        <path d={pathD} fill="none" stroke="url(#strokeGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      )}

      {/* Dots + Labels */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={p.val > 0 ? 4 : 2.5} fill={p.val > 0 ? '#10b981' : 'rgba(255,255,255,0.15)'} stroke={p.val > 0 ? '#064e3b' : 'none'} strokeWidth="1.5" />
          {p.val > 0 && (
            <text x={p.x} y={p.y - 10} textAnchor="middle" fill="#10b981" fontSize="11" fontWeight="600">{p.val}</text>
          )}
          <text x={p.x} y={height - 6} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10">{labels[i]}</text>
        </g>
      ))}
    </svg>
  );
}

// ===== EMBUDO DE CLIENTES POTENCIALES =====
function FunnelChart({ data }: { data: Array<{ stage: string; count: number }> }) {
  const stages: Record<string, { label: string; color: string }> = {
    new: { label: 'Nuevos', color: '#3b82f6' },
    interested: { label: 'Interesados', color: '#06b6d4' },
    quoting: { label: 'Cotización', color: '#eab308' },
    negotiating: { label: 'Negociando', color: '#f97316' },
    pending_confirm: { label: 'Por confirmar', color: '#a855f7' },
    converted: { label: 'Convertidos', color: '#10b981' },
    follow_up: { label: 'Seguimiento', color: '#ec4899' },
    lost: { label: 'Perdidos', color: '#ef4444' },
  };

  const sorted = data
    .filter(d => d.count > 0)
    .sort((a, b) => b.count - a.count);

  const maxCount = Math.max(...sorted.map(d => d.count), 1);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
        <Users className="w-10 h-10 opacity-30 mb-3" />
        <p className="text-sm">Sin datos de embudo</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {sorted.map((d, i) => {
        const info = stages[d.stage] || { label: d.stage, color: '#6b7280' };
        const pct = (d.count / maxCount) * 100;
        return (
          <div key={d.stage} className="group">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[var(--text-secondary)]">{info.label}</span>
              <span className="text-xs font-semibold" style={{ color: info.color }}>{d.count}</span>
            </div>
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <div 
                className="h-full rounded-full transition-all duration-700 ease-out group-hover:opacity-80"
                style={{ width: `${Math.max(pct, 4)}%`, backgroundColor: info.color, opacity: 0.8 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== DASHBOARD PRINCIPAL =====
export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [dashboard, setDashboard] = useState<any>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      // Cargar user + whatsapp primero (rápidos), dashboard en paralelo
      const [userRes, whatsappRes, dashRes] = await Promise.all([
        fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/whatsapp/status`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null),
        fetch(`${API_URL}/api/conversations/dashboard`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null)
      ]);

      if (userRes.ok) setUser((await userRes.json()).user);
      if (whatsappRes?.ok) setWhatsappStatus(await whatsappRes.json());
      if (dashRes?.ok) setDashboard(await dashRes.json());
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'Hace un momento';
    if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Hace ${Math.floor(diff / 3600)}h`;
    return `Hace ${Math.floor(diff / 86400)}d`;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <img src="/elisa.png" alt="Elisa" className="w-16 h-16 rounded-xl animate-pulse" />
        <div className="loading-spinner" />
      </div>
    );
  }

  const d = dashboard || {};
  const weeklyActivity = d.weeklyActivity || [0,0,0,0,0,0,0];
  const dayLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const funnelData = d.funnelData || d.stageStats || [];
  const recentActivity = d.recentActivity || [];

  // 🔒 BLOQUEO POR SUSCRIPCIÓN EXPIRADA
  const isBlocked = user?.isBlocked || user?.subscriptionStatus === 'expired';
  const isTrial = user?.plan === 'trial';
  const daysRemaining = user?.daysRemaining || 0;

  if (isBlocked) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <img src="/elisa.png" alt="Elisa IA" className="w-24 h-24 rounded-3xl mx-auto mb-8 opacity-50" />
        <h1 className="text-3xl font-bold text-white mb-4">Tu período de prueba ha terminado</h1>
        <p className="text-[var(--text-muted)] text-lg mb-8">
          Para seguir usando Elisa IA, elige un plan. Tus datos, configuraciones y conversaciones están guardados y listos.
        </p>
        <div className="flex justify-center gap-4 mb-6">
          <a href="/subscription" className="px-8 py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-bold rounded-2xl text-lg hover:shadow-lg hover:shadow-emerald-500/30 transition-all hover:scale-105">
            🚀 Ver Planes y Precios
          </a>
        </div>
        <p className="text-gray-600 text-sm">Desde USD$30/mes · Pagos seguros con Wompi · Cancela cuando quieras</p>
      </div>
    );
  }

  const statCards = [
    { title: 'MENSAJES TOTALES', value: d.totalMessages || 0, sub: d.todayMessages > 0 ? `${d.todayMessages} hoy` : null, icon: MessageSquare, color: 'emerald' },
    { title: 'CONVERSACIONES', value: d.totalConversations || 0, sub: d.convertedCount > 0 ? `${d.convertedCount} convertidos` : null, icon: Users, color: 'blue' },
    { title: 'CLIENTES CRM', value: d.totalClients || 0, sub: d.conversionRate > 0 ? `${d.conversionRate}% conversión` : null, icon: Clock, color: 'purple' },
    { title: 'CITAS/PEDIDOS', value: d.totalAppointments || 0, sub: d.pendingAppointments > 0 ? `${d.pendingAppointments} pendientes` : null, icon: Calendar, color: 'orange' }
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Trial Banner */}
      {isTrial && daysRemaining > 0 && daysRemaining <= 20 && (
        <a href="/subscription" className={`flex items-center justify-between p-4 rounded-2xl border transition-all hover:scale-[1.01] ${
          daysRemaining <= 5 ? 'bg-red-500/10 border-red-500/30' : daysRemaining <= 10 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/30'
        }`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{daysRemaining <= 5 ? '⚠️' : '⏰'}</span>
            <div>
              <span className={`font-bold text-sm ${daysRemaining <= 5 ? 'text-red-400' : daysRemaining <= 10 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {daysRemaining <= 5 ? `¡Solo ${daysRemaining} días restantes!` : `Te quedan ${daysRemaining} días de prueba gratuita`}
              </span>
              <p className="text-gray-500 text-xs">Elige tu plan y no pierdas tu configuración</p>
            </div>
          </div>
          <span className="text-xs bg-white/10 px-3 py-1.5 rounded-full text-white font-semibold">Ver Planes →</span>
        </a>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/elisa.png" alt="Elisa IA" className="w-14 h-14 rounded-2xl shadow-lg hidden md:block" />
          <div>
            <h1 className="text-3xl font-bold text-white">
              ¡Hola, {user?.name?.split(' ')[0] || 'Usuario'}! 👋
            </h1>
            <p className="text-[var(--text-muted)] mt-1">
              {whatsappStatus?.connected 
                ? `Tu chatbot está activo • +${whatsappStatus.phone || ''}` 
                : 'Conecta WhatsApp para activar Elisa'}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Link href="/conversaciones" className="btn-secondary"><MessageSquare className="w-4 h-4" />Ver Chats</Link>
          <Link href="/crm" className="btn-primary"><Users className="w-4 h-4" />Abrir CRM</Link>
        </div>
      </div>

      {/* Banner de conexión */}
      {!whatsappStatus?.connected && (
        <div className="card p-5 border-yellow-500/30">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-yellow-500/20 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-yellow-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white">Completa la configuración</h3>
              <p className="text-[var(--text-muted)]">Conecta WhatsApp para que Elisa comience a responder.</p>
            </div>
            <Link href="/whatsapp" className="btn-primary"><Smartphone className="w-4 h-4" />Conectar WhatsApp</Link>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, i) => (
          <div key={stat.title} className="stat-card">
            <div className="flex items-start justify-between mb-3">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                stat.color === 'emerald' ? 'bg-emerald-500/20' :
                stat.color === 'blue' ? 'bg-blue-500/20' :
                stat.color === 'purple' ? 'bg-purple-500/20' : 'bg-orange-500/20'
              }`}>
                <stat.icon className={`w-5 h-5 ${
                  stat.color === 'emerald' ? 'text-emerald-400' :
                  stat.color === 'blue' ? 'text-blue-400' :
                  stat.color === 'purple' ? 'text-purple-400' : 'text-orange-400'
                }`} />
              </div>
              {stat.sub && (
                <span className="text-[10px] text-[var(--text-muted)] bg-white/5 px-2 py-0.5 rounded-full">{stat.sub}</span>
              )}
            </div>
            <div className="stat-value">{typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}</div>
            <div className="stat-label">{stat.title}</div>
          </div>
        ))}
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Gráfico Lineal - Actividad Semanal */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white">Actividad Semanal</h3>
              <p className="text-sm text-[var(--text-muted)]">{d.weekMessages || 0} mensajes esta semana</p>
            </div>
            <Link href="/conversaciones" className="btn-secondary text-sm py-2">
              <BarChart3 className="w-4 h-4" />Ver Chats
            </Link>
          </div>
          <div className="h-44">
            <LineChart data={weeklyActivity} labels={dayLabels} />
          </div>
        </div>

        {/* Embudo de Clientes Potenciales */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Embudo de Ventas</h3>
            <Link href="/conversaciones" className="text-[var(--accent-primary)]">
              <ArrowUpRight className="w-5 h-5" />
            </Link>
          </div>
          <FunnelChart data={funnelData} />
        </div>
      </div>

      {/* Actividad + Accesos rápidos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Actividad Reciente */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Actividad Reciente</h3>
            <Activity className="w-5 h-5 text-[var(--accent-primary)]" />
          </div>
          {recentActivity.length > 0 ? (
            <div className="space-y-3">
              {recentActivity.map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 transition-colors">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    a.type === 'message' ? 'bg-blue-500/20' : a.type === 'appointment' ? 'bg-purple-500/20' : 'bg-emerald-500/20'
                  }`}>
                    {a.type === 'message' && <MessageSquare className="w-4 h-4 text-blue-400" />}
                    {a.type === 'appointment' && <Calendar className="w-4 h-4 text-purple-400" />}
                    {a.type === 'sale' && <Zap className="w-4 h-4 text-emerald-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{a.user}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{a.action}</p>
                  </div>
                  <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{timeAgo(a.time)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-[var(--text-muted)]">
              <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Sin actividad reciente</p>
            </div>
          )}
        </div>

        {/* Accesos Rápidos */}
        <div className="space-y-4">
          <Link href="/whatsapp" className="card glass-hover group block">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${whatsappStatus?.connected ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
                <Smartphone className={`w-5 h-5 ${whatsappStatus?.connected ? 'text-emerald-400' : 'text-red-400'}`} />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-white">WhatsApp</h4>
                <p className="text-xs text-[var(--text-muted)]">
                  {whatsappStatus?.connected ? `+${whatsappStatus.phone || ''}` : 'Desconectado'}
                </p>
              </div>
              <div className={`badge text-[10px] ${whatsappStatus?.connected ? 'badge-success' : 'badge-danger'}`}>
                {whatsappStatus?.connected ? <><CheckCircle className="w-3 h-3" />ON</> : <><XCircle className="w-3 h-3" />OFF</>}
              </div>
            </div>
          </Link>

          <Link href="/crm" className="card glass-hover group block">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-400" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-white">CRM</h4>
                <p className="text-xs text-[var(--text-muted)]">{d.totalClients || 0} clientes</p>
              </div>
              <ArrowUpRight className="w-4 h-4 text-[var(--text-muted)]" />
            </div>
          </Link>

          <Link href="/agenda" className="card glass-hover group block">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-purple-400" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-white">Agenda</h4>
                <p className="text-xs text-[var(--text-muted)]">{d.pendingAppointments || 0} pendientes</p>
              </div>
              <ArrowUpRight className="w-4 h-4 text-[var(--text-muted)]" />
            </div>
          </Link>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center py-6">
        <div className="flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-white/5 border border-white/10">
          <img src="/elisa.png" alt="Elisa IA" className="w-7 h-7 rounded-lg" />
          <span className="text-xs text-[var(--text-muted)]">
            Potenciado por <span className="text-white font-semibold">Elisa IA</span>
          </span>
        </div>
      </div>
    </div>
  );
}

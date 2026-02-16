'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Smartphone, MessageSquare, CheckCircle, XCircle, AlertCircle,
  Users, Calendar, Clock, Activity, BarChart3, ArrowUpRight, Zap,
  TrendingUp, TrendingDown, Phone, Bot, Target, Star,
  Pause, ArrowRight
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ===== SVG LINE CHART =====
function LineChart({ data, labels, color = '#10b981', height: h = 160 }: { data: number[]; labels: string[]; color?: string; height?: number }) {
  const width = 560, height = h;
  const pad = { top: 24, right: 16, bottom: 28, left: 44 };
  const cW = width - pad.left - pad.right, cH = height - pad.top - pad.bottom;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => ({ x: pad.left + (i / Math.max(data.length - 1, 1)) * cW, y: pad.top + cH - (v / max) * cH, val: v }));
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = `${pathD} L ${pts[pts.length - 1]?.x || 0} ${pad.top + cH} L ${pts[0]?.x || 0} ${pad.top + cH} Z`;
  const gridY = [0, 0.25, 0.5, 0.75, 1].map(p => ({ y: pad.top + cH - p * cH, label: Math.round(p * max) }));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={`grad-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" /><stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {gridY.map((g, i) => (<g key={i}><line x1={pad.left} y1={g.y} x2={width - pad.right} y2={g.y} stroke="rgba(255,255,255,0.05)" /><text x={pad.left - 8} y={g.y + 4} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="9">{g.label}</text></g>))}
      {pts.length > 1 && <path d={areaD} fill={`url(#grad-${color.replace('#','')})`} />}
      {pts.length > 1 && <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      {pts.map((p, i) => (<g key={i}><circle cx={p.x} cy={p.y} r={p.val > 0 ? 3.5 : 2} fill={p.val > 0 ? color : 'rgba(255,255,255,0.1)'} stroke={p.val > 0 ? '#0a0a0a' : 'none'} strokeWidth="1.5" />{p.val > 0 && <text x={p.x} y={p.y - 9} textAnchor="middle" fill={color} fontSize="10" fontWeight="600">{p.val}</text>}{labels[i] && <text x={p.x} y={height - 5} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9">{labels[i]}</text>}</g>))}
    </svg>
  );
}

// ===== FUNNEL =====
function FunnelChart({ data }: { data: Array<{ stage: string; count: number }> }) {
  const stages: Record<string, { label: string; color: string; priority: number }> = {
    saludo: { label: 'Saludo', color: '#6b7280', priority: 0 }, new: { label: 'Nuevo', color: '#6b7280', priority: 1 },
    interested: { label: 'Interesado', color: '#3b82f6', priority: 2 }, interesado: { label: 'Interesado', color: '#3b82f6', priority: 2 },
    descubrimiento: { label: 'Descubrimiento', color: '#06b6d4', priority: 3 }, demo: { label: 'Demo', color: '#8b5cf6', priority: 4 },
    quoting: { label: 'Cotización', color: '#eab308', priority: 5 }, cotización: { label: 'Cotización', color: '#eab308', priority: 5 }, cotizacion: { label: 'Cotización', color: '#eab308', priority: 5 },
    pendiente_decision: { label: 'Pend. Decisión', color: '#f97316', priority: 6 }, trial_activo: { label: 'Trial Activo', color: '#a855f7', priority: 7 },
    negotiating: { label: 'Negociando', color: '#f97316', priority: 8 },
    converted: { label: 'Convertido', color: '#10b981', priority: 9 }, convertido: { label: 'Convertido', color: '#10b981', priority: 9 },
    lost: { label: 'Perdido', color: '#ef4444', priority: 10 }, perdido: { label: 'Perdido', color: '#ef4444', priority: 10 },
  };
  const sorted = data.filter(d => d.count > 0).sort((a, b) => (stages[a.stage]?.priority ?? 50) - (stages[b.stage]?.priority ?? 50));
  const maxC = Math.max(...sorted.map(d => d.count), 1);
  const total = sorted.reduce((s, d) => s + d.count, 0);
  if (!sorted.length) return <div className="text-center py-8 text-[var(--text-muted)] text-sm">Sin datos</div>;
  return (
    <div className="space-y-2">
      {sorted.map(d => {
        const info = stages[d.stage] || { label: d.stage, color: '#6b7280' };
        return (
          <div key={d.stage}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs text-[var(--text-secondary)]">{info.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--text-muted)]">{((d.count / total) * 100).toFixed(0)}%</span>
                <span className="text-xs font-bold" style={{ color: info.color }}>{d.count}</span>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max((d.count / maxC) * 100, 3)}%`, backgroundColor: info.color, opacity: 0.85 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== GROWTH BADGE =====
function GrowthBadge({ value, suffix = '%' }: { value: string | number; suffix?: string }) {
  const n = Number(value); if (n === 0) return null;
  const up = n > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${up ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{up ? '+' : ''}{value}{suffix}
    </span>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const colors: Record<string, string> = { interesado: '#3b82f6', interested: '#3b82f6', demo: '#8b5cf6', cotización: '#eab308', cotizacion: '#eab308', quoting: '#eab308', trial_activo: '#a855f7', converted: '#10b981', convertido: '#10b981', perdido: '#ef4444', lost: '#ef4444', saludo: '#6b7280', new: '#6b7280', descubrimiento: '#06b6d4', pendiente_decision: '#f97316' };
  const c = colors[stage] || '#6b7280';
  return <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium" style={{ background: `${c}25`, color: c }}>{stage?.replace(/_/g, ' ')}</span>;
}

// ===== MAIN =====
export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [d, setD] = useState<any>({});
  const [wa, setWa] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'week' | 'month'>('week');

  const getLineId = () => typeof window !== 'undefined' ? localStorage.getItem('selectedLineId') || '' : '';

  useEffect(() => {
    try {
      const cd = localStorage.getItem('bizonne_dashboard_cache');
      const cu = localStorage.getItem('bizonne_user_cache');
      const cw = localStorage.getItem('bizonne_wa_cache');
      if (cd) { setD(JSON.parse(cd)); setLoading(false); }
      if (cu) setUser(JSON.parse(cu));
      if (cw) setWa(JSON.parse(cw));
    } catch {}
    fetchData();
    const iv = setInterval(fetchData, 30000);
    const onLine = () => fetchData();
    window.addEventListener('lineChanged', onLine);
    return () => { clearInterval(iv); window.removeEventListener('lineChanged', onLine); };
  }, []);

  useEffect(() => { fetchData(); }, [period]);

  const fetchData = async () => {
    const token = localStorage.getItem('token'); if (!token) return;
    try {
      const lineId = getLineId();
      const [userRes, waRes, dashRes] = await Promise.all([
        fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/whatsapp/status?lineId=${lineId}`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null),
        fetch(`${API_URL}/api/conversations/dashboard?lineId=${lineId}&period=${period}`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null)
      ]);
      if (userRes.ok) { const ud = await userRes.json(); setUser(ud.user); try { localStorage.setItem('bizonne_user_cache', JSON.stringify(ud.user)); } catch {} }
      if (waRes?.ok) { const wd = await waRes.json(); setWa(wd); try { localStorage.setItem('bizonne_wa_cache', JSON.stringify(wd)); } catch {} }
      if (dashRes?.ok) { const dd = await dashRes.json(); setD(dd); try { localStorage.setItem('bizonne_dashboard_cache', JSON.stringify(dd)); } catch {} }
    } catch {} finally { setLoading(false); }
  };

  const timeAgo = (s: string) => { const diff = Math.floor((Date.now() - new Date(s).getTime()) / 1000); if (diff < 60) return 'Ahora'; if (diff < 3600) return `${Math.floor(diff / 60)}m`; if (diff < 86400) return `${Math.floor(diff / 3600)}h`; return `${Math.floor(diff / 86400)}d`; };

  // Line-aware phone display
  const selectedLineId = getLineId();
  const selectedLine = (d.lines || []).find((l: any) => l.id === selectedLineId);
  const displayPhone = selectedLine?.phone || wa?.phone || '';

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <img src="/bizonne.png" alt="Bizonne" className="w-16 h-16 rounded-xl animate-pulse" /><div className="loading-spinner" />
    </div>
  );

  const isBlocked = user?.isBlocked || user?.subscriptionStatus === 'expired';
  const isTrial = user?.plan === 'trial';
  const daysRemaining = user?.daysRemaining || 0;

  if (isBlocked) return (
    <div className="max-w-2xl mx-auto py-20 text-center">
      <img src="/bizonne.png" alt="Bizonne" className="w-24 h-24 rounded-3xl mx-auto mb-8 opacity-50" />
      <h1 className="text-3xl font-bold text-white mb-4">Tu período de prueba ha terminado</h1>
      <p className="text-[var(--text-muted)] text-lg mb-8">Elige un plan para seguir usando Bizonne.</p>
      <a href="/subscription" className="px-8 py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-bold rounded-2xl text-lg hover:shadow-lg transition-all hover:scale-105 inline-block">🚀 Ver Planes</a>
    </div>
  );

  const weeklyActivity = d.weeklyActivity || [0,0,0,0,0,0,0];
  const monthlyActivity = d.monthlyActivity || [];
  const dayLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const funnelData = d.funnelData || d.stageStats || [];
  const recentActivity = d.recentActivity || [];
  const topLeads = d.topLeads || [];
  const lines = d.lines || [];

  const chartData = period === 'week' ? weeklyActivity : monthlyActivity.map((m: any) => m.count);
  const chartLabels = period === 'week' ? dayLabels : monthlyActivity.map((m: any) => m.day);
  const chartMsgs = period === 'week' ? (d.weekMessages || 0) : (d.monthMessages || 0);

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Trial Banner */}
      {isTrial && daysRemaining > 0 && daysRemaining <= 20 && (
        <a href="/subscription" className={`flex items-center justify-between p-4 rounded-2xl border transition-all hover:scale-[1.01] ${daysRemaining <= 5 ? 'bg-red-500/10 border-red-500/30' : daysRemaining <= 10 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{daysRemaining <= 5 ? '⚠️' : '⏰'}</span>
            <div>
              <span className={`font-bold text-sm ${daysRemaining <= 5 ? 'text-red-400' : daysRemaining <= 10 ? 'text-amber-400' : 'text-emerald-400'}`}>{daysRemaining <= 5 ? `¡Solo ${daysRemaining} días!` : `${daysRemaining} días de prueba`}</span>
              <p className="text-gray-500 text-xs">Elige tu plan</p>
            </div>
          </div>
          <span className="text-xs bg-white/10 px-3 py-1.5 rounded-full text-white font-semibold">Ver Planes →</span>
        </a>
      )}

      {/* Header - FIX: muestra el teléfono de la línea seleccionada */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/bizonne.png" alt="Bizonne" className="w-14 h-14 rounded-2xl shadow-lg hidden md:block" />
          <div>
            <h1 className="text-3xl font-bold text-white">¡Hola, {user?.name?.split(' ')[0] || 'Usuario'}! 👋</h1>
            <p className="text-[var(--text-muted)] mt-0.5">
              {wa?.connected
                ? <>Chatbot activo • <span className="text-emerald-400 font-medium">+{displayPhone}</span>{selectedLine ? <> • {selectedLine.label}</> : ''}</>
                : 'Conecta WhatsApp para activar el asistente'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/conversaciones" className="btn-secondary text-sm"><MessageSquare className="w-4 h-4" />Ver Chats</Link>
          <Link href="/crm" className="btn-primary text-sm"><Users className="w-4 h-4" />Abrir CRM</Link>
        </div>
      </div>

      {/* Connection Alert */}
      {!wa?.connected && (
        <div className="card p-4 border-yellow-500/30 flex flex-col md:flex-row md:items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-yellow-500/20 flex items-center justify-center flex-shrink-0"><AlertCircle className="w-5 h-5 text-yellow-400" /></div>
          <div className="flex-1"><h3 className="font-semibold text-white">Conecta WhatsApp</h3><p className="text-sm text-[var(--text-muted)]">El asistente necesita WhatsApp conectado.</p></div>
          <Link href="/whatsapp" className="btn-primary text-sm"><Smartphone className="w-4 h-4" />Conectar</Link>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="flex items-start justify-between mb-2">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center"><MessageSquare className="w-5 h-5 text-emerald-400" /></div>
            <GrowthBadge value={d.msgGrowth || 0} suffix="% hoy" />
          </div>
          <div className="stat-value">{(d.totalMessages || 0).toLocaleString()}</div>
          <div className="stat-label flex items-center justify-between"><span>MENSAJES TOTALES</span><span className="text-emerald-400 font-medium">{d.todayMessages || 0} hoy</span></div>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-2">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center"><Users className="w-5 h-5 text-blue-400" /></div>
            {(d.todayConversations || 0) > 0 && <span className="text-[10px] bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded-md font-semibold">+{d.todayConversations} hoy</span>}
          </div>
          <div className="stat-value">{d.totalConversations || 0}</div>
          <div className="stat-label flex items-center justify-between"><span>CONVERSACIONES</span><span className="text-blue-400 font-medium">{d.weekConversations || 0} sem</span></div>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-2">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center"><Target className="w-5 h-5 text-purple-400" /></div>
            <span className="text-[10px] bg-purple-500/15 text-purple-400 px-1.5 py-0.5 rounded-md font-semibold">{d.conversionRate || 0}%</span>
          </div>
          <div className="stat-value">{d.convertedCount || 0}</div>
          <div className="stat-label flex items-center justify-between"><span>CONVERTIDOS</span><span className="text-purple-400 font-medium">{d.convertedThisMonth || 0} mes</span></div>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-2">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center"><Calendar className="w-5 h-5 text-orange-400" /></div>
            {(d.pendingAppointments || 0) > 0 && <span className="text-[10px] bg-orange-500/15 text-orange-400 px-1.5 py-0.5 rounded-md font-semibold">{d.pendingAppointments} pend.</span>}
          </div>
          <div className="stat-value">{d.totalAppointments || 0}</div>
          <div className="stat-label flex items-center justify-between"><span>CITAS / PEDIDOS</span><span className="text-orange-400 font-medium">{d.totalClients || 0} clientes</span></div>
        </div>
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="card p-3 text-center">
          <p className="text-lg font-bold text-white">{(d.monthMessages || 0).toLocaleString()}</p>
          <p className="text-[10px] text-[var(--text-muted)]">MSG ESTE MES</p>
          <GrowthBadge value={d.monthGrowth || 0} />
        </div>
        <div className="card p-3 text-center">
          <p className="text-lg font-bold text-white">{(d.weekMessages || 0).toLocaleString()}</p>
          <p className="text-[10px] text-[var(--text-muted)]">MSG SEMANA</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-lg font-bold text-white">{d.avgMsgsPerConv || '0'}</p>
          <p className="text-[10px] text-[var(--text-muted)]">PROM MSG/CONV</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-lg font-bold text-yellow-400">{d.aiPausedCount || 0}</p>
          <p className="text-[10px] text-[var(--text-muted)]">IA PAUSADA</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-lg font-bold text-white">{d.activeClients || 0}</p>
          <p className="text-[10px] text-[var(--text-muted)]">CLIENTES ACT.</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-lg font-bold text-white">{d.monthConversations || 0}</p>
          <p className="text-[10px] text-[var(--text-muted)]">CONV ESTE MES</p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white">Actividad {period === 'week' ? 'Semanal' : 'Mensual'}</h3>
              <p className="text-sm text-[var(--text-muted)]">{chartMsgs.toLocaleString()} mensajes</p>
            </div>
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
              <button onClick={() => setPeriod('week')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${period === 'week' ? 'bg-emerald-500/20 text-emerald-400' : 'text-[var(--text-muted)] hover:text-white'}`}>Semana</button>
              <button onClick={() => setPeriod('month')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${period === 'month' ? 'bg-emerald-500/20 text-emerald-400' : 'text-[var(--text-muted)] hover:text-white'}`}>Mes</button>
            </div>
          </div>
          <div className="h-48"><LineChart data={chartData} labels={chartLabels} color="#10b981" height={192} /></div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Pipeline de Ventas</h3>
            <Link href="/crm" className="text-[var(--accent-primary)] hover:opacity-80"><ArrowUpRight className="w-5 h-5" /></Link>
          </div>
          <FunnelChart data={funnelData} />
          <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">Total pipeline</span>
            <span className="text-sm font-bold text-white">{funnelData.reduce((s: number, f: any) => s + f.count, 0)}</span>
          </div>
        </div>
      </div>

      {/* Bottom: Activity + Leads + Connections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Activity */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">Actividad Reciente</h3>
            <Activity className="w-4 h-4 text-[var(--accent-primary)]" />
          </div>
          {recentActivity.length > 0 ? (
            <div className="space-y-1 max-h-[320px] overflow-y-auto">
              {recentActivity.map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 transition-colors">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${a.type === 'message' ? 'bg-blue-500/15' : a.type === 'appointment' ? 'bg-purple-500/15' : 'bg-emerald-500/15'}`}>
                    {a.type === 'message' && <MessageSquare className="w-3.5 h-3.5 text-blue-400" />}
                    {a.type === 'appointment' && <Calendar className="w-3.5 h-3.5 text-purple-400" />}
                    {a.type === 'sale' && <Zap className="w-3.5 h-3.5 text-emerald-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-medium text-white truncate">{a.user}</p>
                      {a.stage && <StageBadge stage={a.stage} />}
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)] truncate">{a.action}</p>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)]">{timeAgo(a.time)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-[var(--text-muted)]"><Activity className="w-8 h-8 mx-auto mb-2 opacity-20" /><p className="text-xs">Sin actividad</p></div>
          )}
        </div>

        {/* Top Leads */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">Leads Destacados</h3>
            <Star className="w-4 h-4 text-yellow-400" />
          </div>
          {topLeads.length > 0 ? (
            <div className="space-y-1.5">
              {topLeads.map((lead: any, i: number) => (
                <Link href="/crm" key={i} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 transition-colors group">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-white">{(lead.name || '?')[0].toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-medium text-white truncate">{lead.name || 'Desconocido'}</p>
                      <StageBadge stage={lead.stage} />
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">{lead.messages} msgs • {timeAgo(lead.lastActive)}</p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-[var(--text-muted)]"><Target className="w-8 h-8 mx-auto mb-2 opacity-20" /><p className="text-xs">Sin leads activos</p></div>
          )}
        </div>

        {/* Connections */}
        <div className="space-y-3">
          {lines.length > 0 && lines.map((line: any) => (
            <div key={line.id} className="card p-3">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${line.status === 'connected' ? 'bg-emerald-500/15' : 'bg-red-500/15'}`}>
                  <Phone className={`w-4 h-4 ${line.status === 'connected' ? 'text-emerald-400' : 'text-red-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{line.label}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">{line.phone ? `+${line.phone}` : 'Sin número'}</p>
                </div>
                <div className={`w-2 h-2 rounded-full ${line.status === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
              </div>
            </div>
          ))}

          <Link href="/crm" className="card p-3 glass-hover group block">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center"><Users className="w-4 h-4 text-blue-400" /></div>
              <div className="flex-1"><p className="text-sm font-medium text-white">CRM Pipeline</p><p className="text-[10px] text-[var(--text-muted)]">{d.totalClients || 0} clientes</p></div>
              <ArrowUpRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-white transition-colors" />
            </div>
          </Link>

          <Link href="/agenda" className="card p-3 glass-hover group block">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-purple-500/15 flex items-center justify-center"><Calendar className="w-4 h-4 text-purple-400" /></div>
              <div className="flex-1"><p className="text-sm font-medium text-white">Agenda</p><p className="text-[10px] text-[var(--text-muted)]">{d.pendingAppointments || 0} pendientes</p></div>
              <ArrowUpRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-white transition-colors" />
            </div>
          </Link>

          <Link href="/asistentes" className="card p-3 glass-hover group block">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-cyan-500/15 flex items-center justify-center"><Bot className="w-4 h-4 text-cyan-400" /></div>
              <div className="flex-1"><p className="text-sm font-medium text-white">Asistente IA</p><p className="text-[10px] text-[var(--text-muted)]">{d.aiPausedCount || 0} conv. pausadas</p></div>
              <ArrowUpRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-white transition-colors" />
            </div>
          </Link>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center py-4">
        <div className="flex items-center gap-3 px-5 py-2 rounded-2xl bg-white/5 border border-white/10">
          <img src="/bizonne.png" alt="Bizonne" className="w-6 h-6 rounded-lg" />
          <span className="text-xs text-[var(--text-muted)]">Powered by <span className="text-white font-semibold">Bizonne</span></span>
        </div>
      </div>
    </div>
  );
}

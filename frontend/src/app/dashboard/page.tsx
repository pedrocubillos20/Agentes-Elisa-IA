'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  MessageSquare, Users, Calendar, Clock, Activity, TrendingUp, TrendingDown,
  Phone, Target, AlertTriangle, ArrowUpRight,
  ChevronDown, X, Filter, PieChart,
  CheckCircle, Pause, Eye
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ===== DONUT CHART (SVG) =====
function DonutChart({ segments, size = 120, thickness = 14, centerLabel, centerValue }: {
  segments: { value: number; color: string; label: string }[];
  size?: number; thickness?: number; centerLabel?: string; centerValue?: string;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  let cumulative = 0;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={thickness} />
        {segments.filter(s => s.value > 0).map((seg, i) => {
          const pct = total > 0 ? seg.value / total : 0;
          const strokeDash = pct * c;
          const strokeOffset = -(cumulative / total) * c;
          cumulative += seg.value;
          return (
            <circle key={i} cx={size/2} cy={size/2} r={r} fill="none"
              stroke={seg.color} strokeWidth={thickness}
              strokeDasharray={`${strokeDash} ${c - strokeDash}`}
              strokeDashoffset={strokeOffset}
              strokeLinecap="round"
              transform={`rotate(-90 ${size/2} ${size/2})`}
              style={{ transition: 'all 0.8s cubic-bezier(.4,0,.2,1)' }}
            />
          );
        })}
      </svg>
      {centerValue && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-white leading-none">{centerValue}</span>
          {centerLabel && <span className="text-[9px] text-[var(--text-muted)] mt-0.5">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}

// ===== DUAL LINE CHART =====
function DualLineChart({ data, height: h = 200 }: { data: Array<{ day: string; msgs: number; convs: number }>; height?: number }) {
  if (!data.length) return <div className="flex items-center justify-center h-40 text-[var(--text-muted)] text-sm">Sin datos para este período</div>;
  
  const width = 720;
  const pad = { top: 20, right: 16, bottom: 30, left: 44 };
  const cW = width - pad.left - pad.right;
  const cH = h - pad.top - pad.bottom;
  const maxM = Math.max(...data.map(d => d.msgs), 1);
  const maxC = Math.max(...data.map(d => d.convs), 1);
  const max = Math.max(maxM, maxC);

  const toPath = (vals: number[]) => {
    const pts = vals.map((v, i) => ({
      x: pad.left + (i / Math.max(vals.length - 1, 1)) * cW,
      y: pad.top + cH - (v / max) * cH
    }));
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  };

  const msgPath = toPath(data.map(d => d.msgs));
  const convPath = toPath(data.map(d => d.convs));
  const areaPath = `${msgPath} L ${pad.left + cW} ${pad.top + cH} L ${pad.left} ${pad.top + cH} Z`;
  const gridY = [0, 0.25, 0.5, 0.75, 1].map(p => ({ y: pad.top + cH - p * cH, label: Math.round(p * max) }));
  const step = Math.max(1, Math.floor(data.length / 8));

  return (
    <svg viewBox={`0 0 ${width} ${h}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" /><stop offset="100%" stopColor="#10b981" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {gridY.map((g, i) => (
        <g key={i}><line x1={pad.left} y1={g.y} x2={width - pad.right} y2={g.y} stroke="rgba(255,255,255,0.04)" /><text x={pad.left - 8} y={g.y + 3} textAnchor="end" fill="rgba(255,255,255,0.2)" fontSize="9">{g.label}</text></g>
      ))}
      <path d={areaPath} fill="url(#areaGrad)" />
      <path d={msgPath} fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d={convPath} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 3" />
      {data.map((d, i) => {
        if (i % step !== 0 && i !== data.length - 1) return null;
        const x = pad.left + (i / Math.max(data.length - 1, 1)) * cW;
        const label = d.day.length > 5 ? d.day.substring(5) : d.day;
        return <text key={i} x={x} y={h - 6} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="9">{label}</text>;
      })}
    </svg>
  );
}

// ===== FUNNEL =====
function FunnelChart({ data }: { data: Array<{ stage: string; count: number }> }) {
  const stages: Record<string, { label: string; color: string; p: number }> = {
    saludo: { label: 'Saludo', color: '#6b7280', p: 0 }, new: { label: 'Nuevo', color: '#6b7280', p: 1 },
    interested: { label: 'Interesado', color: '#3b82f6', p: 2 }, interesado: { label: 'Interesado', color: '#3b82f6', p: 2 },
    descubrimiento: { label: 'Descubrimiento', color: '#06b6d4', p: 3 }, demo: { label: 'Demo', color: '#8b5cf6', p: 4 },
    quoting: { label: 'Cotización', color: '#eab308', p: 5 }, cotización: { label: 'Cotización', color: '#eab308', p: 5 }, cotizacion: { label: 'Cotización', color: '#eab308', p: 5 },
    pendiente_decision: { label: 'Pend. Decisión', color: '#f97316', p: 6 }, trial_activo: { label: 'Trial', color: '#a855f7', p: 7 },
    negotiating: { label: 'Negociando', color: '#f97316', p: 8 },
    converted: { label: 'Convertido', color: '#10b981', p: 9 }, convertido: { label: 'Convertido', color: '#10b981', p: 9 },
    lost: { label: 'Perdido', color: '#ef4444', p: 10 }, perdido: { label: 'Perdido', color: '#ef4444', p: 10 },
  };
  // Also handle custom stages
  const sorted = data.filter(d => d.count > 0).sort((a, b) => (stages[a.stage]?.p ?? 50) - (stages[b.stage]?.p ?? 50));
  const maxC = Math.max(...sorted.map(d => d.count), 1);
  const total = sorted.reduce((s, d) => s + d.count, 0);
  if (!sorted.length) return <div className="text-center py-6 text-[var(--text-muted)] text-sm">Sin datos</div>;
  return (
    <div className="space-y-1.5">
      {sorted.map(d => {
        const info = stages[d.stage] || { label: d.stage?.replace(/_/g, ' '), color: '#6b7280' };
        return (
          <div key={d.stage}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[11px] text-[var(--text-secondary)]">{info.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--text-muted)]">{total > 0 ? ((d.count / total) * 100).toFixed(0) : 0}%</span>
                <span className="text-xs font-bold" style={{ color: info.color }}>{d.count}</span>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max((d.count / maxC) * 100, 3)}%`, backgroundColor: info.color, opacity: 0.8 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== GROWTH BADGE =====
function GrowthBadge({ value }: { value: string | number }) {
  const n = Number(value); if (!n || isNaN(n)) return null;
  const up = n > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${up ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{up ? '+' : ''}{value}%
    </span>
  );
}

// ===== MAIN DASHBOARD =====
export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [d, setD] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('7d');
  const [showFilters, setShowFilters] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const getLineId = () => typeof window !== 'undefined' ? localStorage.getItem('selectedLineId') || '' : '';

  useEffect(() => {
    try {
      const cd = localStorage.getItem('bizonne_dashboard_cache');
      const cu = localStorage.getItem('bizonne_user_cache');
      if (cd) { setD(JSON.parse(cd)); setLoading(false); }
      if (cu) setUser(JSON.parse(cu));
    } catch {}
    fetchData();
    const iv = setInterval(fetchData, 30000);
    const onLine = () => fetchData();
    window.addEventListener('lineChanged', onLine);
    return () => { clearInterval(iv); window.removeEventListener('lineChanged', onLine); };
  }, []);

  useEffect(() => { fetchData(); }, [period, customFrom, customTo]);

  const fetchData = async () => {
    const token = localStorage.getItem('token'); if (!token) return;
    try {
      const lineId = getLineId();
      let url = `${API_URL}/api/conversations/dashboard?lineId=${lineId}&period=${period}`;
      if (period === 'custom' && customFrom && customTo) url += `&dateFrom=${customFrom}&dateTo=${customTo}`;
      
      const [userRes, dashRes] = await Promise.all([
        fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(url, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null)
      ]);
      if (userRes.ok) { const ud = await userRes.json(); setUser(ud.user); try { localStorage.setItem('bizonne_user_cache', JSON.stringify(ud.user)); } catch {} }
      if (dashRes?.ok) { const dd = await dashRes.json(); setD(dd); try { localStorage.setItem('bizonne_dashboard_cache', JSON.stringify(dd)); } catch {} }
    } catch {} finally { setLoading(false); }
  };

  const setPeriodQuick = (p: string) => { setCustomFrom(''); setCustomTo(''); setPeriod(p); setShowFilters(false); };
  const setMonthRange = (monthIdx: number) => {
    const y = new Date().getFullYear();
    const lastDay = new Date(y, monthIdx + 1, 0).getDate();
    setCustomFrom(`${y}-${String(monthIdx + 1).padStart(2, '0')}-01`);
    setCustomTo(`${y}-${String(monthIdx + 1).padStart(2, '0')}-${lastDay}`);
    setPeriod('custom'); setShowFilters(false);
  };
  const setQuarterRange = (q: number) => {
    const y = new Date().getFullYear();
    const lastDays = [31, 30, 30, 31];
    setCustomFrom(`${y}-${String(q * 3 + 1).padStart(2, '0')}-01`);
    setCustomTo(`${y}-${String(q * 3 + 3).padStart(2, '0')}-${lastDays[q]}`);
    setPeriod('custom'); setShowFilters(false);
  };

  const selectedLine = (d.lines || []).find((l: any) => l.id === getLineId());
  const displayPhone = selectedLine?.phone || '';
  const timeAgo = (s: string) => { const diff = Math.floor((Date.now() - new Date(s).getTime()) / 1000); if (diff < 60) return 'Ahora'; if (diff < 3600) return `${Math.floor(diff / 60)}m`; if (diff < 86400) return `${Math.floor(diff / 3600)}h`; return `${Math.floor(diff / 86400)}d`; };
  const periodLabels: Record<string, string> = { '24h': '24 horas', '7d': '7 días', '30d': '30 días', '90d': '90 días', quarter: 'Trimestre', year: 'Año', custom: 'Personalizado' };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="loading-spinner w-8 h-8" /></div>;

  const isBlocked = user?.isBlocked || user?.subscriptionStatus === 'expired';
  const isTrial = user?.plan === 'trial';
  const daysRemaining = user?.daysRemaining || 0;
  if (isBlocked) return (
    <div className="max-w-2xl mx-auto py-20 text-center">
      <h1 className="text-3xl font-bold text-white mb-4">Tu período de prueba ha terminado</h1>
      <p className="text-[var(--text-muted)] text-lg mb-8">Elige un plan para seguir usando la plataforma.</p>
      <a href="/subscription" className="px-8 py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-bold rounded-2xl text-lg hover:shadow-lg transition-all inline-block">🚀 Ver Planes</a>
    </div>
  );

  const chartData = d.chartData || [];
  const funnelData = d.funnelData || [];
  const recentActivity = d.recentActivity || [];
  const topLeads = d.topLeads || [];
  const dist = d.stageDistribution || { resolved: 0, active: 0, pending: 0, atRisk: 0, total: 0 };
  const wStats = d.whatsappStats || { sent: 0, received: 0, total: 0 };

  return (
    <div className="max-w-[1400px] mx-auto space-y-4">
      {/* ===== HEADER ===== */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Visión general del sistema{displayPhone ? ` · ${selectedLine?.label || ''} · +${displayPhone}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/conversaciones" className="btn-secondary py-2 px-4 text-sm flex items-center gap-2"><MessageSquare className="w-4 h-4" />Ver Chats</Link>
          <Link href="/crm" className="btn-primary py-2 px-4 text-sm flex items-center gap-2"><Users className="w-4 h-4" />Abrir CRM</Link>
          
          {/* ===== PERIOD FILTER ===== */}
          <div className="relative">
            <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-2 py-2 px-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm text-white hover:bg-white/5 transition-all">
              <Filter className="w-4 h-4 text-[var(--accent-primary)]" />
              {periodLabels[period] || period}
              <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            </button>
            
            {showFilters && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowFilters(false)} />
                <div className="absolute right-0 top-12 z-50 w-[340px] bg-[#1a1a2e] border border-[var(--border-primary)] rounded-2xl shadow-2xl shadow-black/50 p-5 space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-[var(--accent-primary)]/15 flex items-center justify-center"><Filter className="w-4 h-4 text-[var(--accent-primary)]" /></div>
                      <div><p className="text-sm font-semibold text-white">Filtros Temporales</p><p className="text-[10px] text-[var(--text-muted)]">Seleccione el período de análisis</p></div>
                    </div>
                    <button onClick={() => setShowFilters(false)} className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all"><X className="w-3.5 h-3.5 text-[var(--text-muted)]" /></button>
                  </div>

                  {/* Quick */}
                  <div>
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1">⚡ Filtros Rápidos</p>
                    <div className="flex gap-1.5">
                      {['24h', '7d', '30d', '90d'].map(p => (
                        <button key={p} onClick={() => setPeriodQuick(p)}
                          className={`flex-1 py-2 text-xs rounded-lg border transition-all font-medium ${period === p ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)] text-black font-bold' : 'bg-white/5 border-white/10 text-[var(--text-muted)] hover:text-white hover:border-white/20'}`}>
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quarter */}
                  <div>
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1">📊 Por Trimestre</p>
                    <div className="flex gap-1.5">
                      {['Q1 (Ene-Mar)', 'Q2 (Abr-Jun)', 'Q3 (Jul-Sep)', 'Q4 (Oct-Dic)'].map((q, i) => (
                        <button key={q} onClick={() => setQuarterRange(i)}
                          className="flex-1 py-2 text-[10px] rounded-lg bg-white/5 border border-white/10 text-[var(--text-muted)] hover:text-white hover:border-[var(--accent-primary)]/50 transition-all">{q}</button>
                      ))}
                    </div>
                  </div>

                  {/* Month */}
                  <div>
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1">📅 Por Mes</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'].map((m, i) => (
                        <button key={m} onClick={() => setMonthRange(i)}
                          className="py-2 text-[10px] rounded-lg bg-white/5 border border-white/10 text-[var(--text-muted)] hover:text-white hover:border-[var(--accent-primary)]/50 transition-all">{m}</button>
                      ))}
                    </div>
                  </div>

                  {/* Custom */}
                  <div>
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1">📆 Período Personalizado</p>
                    <div className="flex gap-2 items-center">
                      <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-lg py-2 px-2.5 text-xs text-white focus:border-[var(--accent-primary)] outline-none transition-all" />
                      <span className="text-[var(--text-muted)] text-xs">a</span>
                      <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-lg py-2 px-2.5 text-xs text-white focus:border-[var(--accent-primary)] outline-none transition-all" />
                    </div>
                    <button onClick={() => { if (customFrom && customTo) { setPeriod('custom'); setShowFilters(false); } }} disabled={!customFrom || !customTo}
                      className="w-full mt-3 py-2.5 text-xs font-bold rounded-xl bg-[var(--accent-primary)] text-black disabled:opacity-30 hover:opacity-90 transition-all flex items-center justify-center gap-2">
                      Aplicar Filtros
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Trial */}
      {isTrial && daysRemaining > 0 && daysRemaining <= 20 && (
        <a href="/subscription" className={`flex items-center justify-between p-3 rounded-xl border transition-all hover:scale-[1.005] ${daysRemaining <= 5 ? 'bg-red-500/10 border-red-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
          <span className="text-sm text-white">🕐 Te quedan <strong>{daysRemaining} días</strong> de prueba</span>
          <span className="text-xs text-[var(--accent-primary)] font-bold">Ver Planes →</span>
        </a>
      )}

      {/* ===== ROW 1: TOP 4 CARDS ===== */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        
        {/* 1. Distribución de Etapas (Donut) */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <PieChart className="w-4 h-4 text-emerald-400" />
            <div><p className="text-xs font-semibold text-white">Distribución</p><p className="text-[10px] text-[var(--text-muted)]">Estado de conversaciones</p></div>
          </div>
          <div className="flex items-center gap-3">
            <DonutChart size={100} thickness={12}
              centerValue={`${d.resolutionRate || 0}%`} centerLabel="Resueltas"
              segments={[
                { value: dist.resolved || 0, color: '#10b981', label: 'Resueltas' },
                { value: dist.active || 0, color: '#3b82f6', label: 'Activas' },
                { value: dist.pending || 0, color: '#eab308', label: 'Pendientes' },
                { value: dist.atRisk || 0, color: '#ef4444', label: 'En Riesgo' },
              ]}
            />
            <div className="flex-1 space-y-1">
              {[
                { label: 'Resueltas', color: '#10b981', val: dist.resolved },
                { label: 'Activas', color: '#3b82f6', val: dist.active },
                { label: 'Pendientes', color: '#eab308', val: dist.pending },
                { label: 'En Riesgo', color: '#ef4444', val: dist.atRisk },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} /><span className="text-[var(--text-secondary)]">{s.label}</span></div>
                  <span className="text-white font-medium">{s.val || 0} <span className="text-[var(--text-muted)]">({d.totalConversations > 0 ? (((s.val || 0) / d.totalConversations) * 100).toFixed(0) : 0}%)</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 2. Conversaciones en Riesgo */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <div><p className="text-xs font-semibold text-white">Conv. en Riesgo</p><p className="text-[10px] text-[var(--text-muted)]">Sin respuesta +48h</p></div>
          </div>
          <div className="flex items-center gap-3">
            <DonutChart size={90} thickness={10}
              centerValue={`${d.totalConversations > 0 ? (((d.atRiskConvs || 0) / d.totalConversations) * 100).toFixed(0) : 0}%`}
              centerLabel=""
              segments={[
                { value: d.atRiskConvs || 0, color: '#f59e0b', label: 'Riesgo' },
                { value: Math.max((d.totalConversations || 0) - (d.atRiskConvs || 0), 0), color: 'rgba(255,255,255,0.06)', label: 'OK' },
              ]}
            />
            <div className="flex-1 space-y-2">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5">
                <p className="text-2xl font-bold text-amber-400">{d.atRiskConvs || 0}</p>
                <p className="text-[10px] text-amber-400/70">En riesgo</p>
              </div>
              {d.oldestWait && d.oldestWait !== '0h' && (
                <div className="bg-[var(--bg-tertiary)] rounded-xl px-3 py-2">
                  <p className="text-sm font-bold text-white">{d.oldestWait}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Más antigua</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 3. WhatsApp Stats */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-green-400" /><div><p className="text-xs font-semibold text-white">WhatsApp</p><p className="text-[10px] text-[var(--text-muted)]">Mensajes en período</p></div></div>
            <GrowthBadge value={d.msgGrowth || 0} />
          </div>
          <p className="text-3xl font-bold text-white mb-2.5">{(d.rangeMessages || 0).toLocaleString()}</p>
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-[10px] mb-0.5"><span className="text-[var(--text-muted)]">Enviados</span><span className="text-white">{(wStats.sent || 0).toLocaleString()}</span></div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden"><div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${wStats.total > 0 ? (wStats.sent / wStats.total * 100) : 0}%` }} /></div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] mb-0.5"><span className="text-[var(--text-muted)]">Recibidos</span><span className="text-white">{(wStats.received || 0).toLocaleString()}</span></div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden"><div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${wStats.total > 0 ? (wStats.received / wStats.total * 100) : 0}%` }} /></div>
            </div>
          </div>
        </div>

        {/* 4. Tasa de Resolución */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-cyan-400" />
            <div><p className="text-xs font-semibold text-white">Tasa de Resolución</p><p className="text-[10px] text-[var(--text-muted)]">{d.convertedTotal || 0} convertidos</p></div>
          </div>
          <div className="flex items-center gap-3">
            <DonutChart size={90} thickness={10}
              centerValue={`${d.resolutionRate || 0}%`} centerLabel="Resueltas"
              segments={[
                { value: d.convertedTotal || 0, color: '#10b981', label: 'Convertidos' },
                { value: Math.max((d.totalConversations || 0) - (d.convertedTotal || 0) - (dist.atRisk || 0), 0), color: '#3b82f6', label: 'En proceso' },
                { value: dist.atRisk || 0, color: '#ef4444', label: 'Pendientes' },
              ]}
            />
            <div className="flex-1 space-y-1 text-[11px]">
              {[
                { label: 'Convertidos', color: '#10b981', val: d.convertedTotal || 0 },
                { label: 'En proceso', color: '#3b82f6', val: Math.max((d.totalConversations || 0) - (d.convertedTotal || 0) - (dist.atRisk || 0), 0) },
                { label: 'Pendientes', color: '#ef4444', val: dist.atRisk || 0 },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} /><span className="text-[var(--text-secondary)]">{s.label}</span></div>
                  <span className="text-white font-medium">{s.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ===== ROW 2: 6 QUICK STATS ===== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'MENSAJES HOY', value: d.todayMessages || 0, sub: `${d.yesterdayMessages || 0} ayer`, icon: MessageSquare, color: 'text-emerald-400', growth: d.todayGrowth },
          { label: 'NUEVAS CONV.', value: d.rangeNewConvs || 0, sub: `${d.prevRangeNewConvs || 0} anterior`, icon: Users, color: 'text-blue-400', growth: d.convGrowth },
          { label: 'CONVERTIDOS', value: d.rangeConvertedConvs || 0, sub: `${d.convertedTotal || 0} total`, icon: CheckCircle, color: 'text-green-400' },
          { label: 'IA PAUSADA', value: d.aiPausedCount || 0, sub: 'intervención humana', icon: Pause, color: 'text-yellow-400' },
          { label: 'PROM MSG/CONV', value: d.avgMsgsPerConv || '0', sub: 'promedio general', icon: Activity, color: 'text-purple-400' },
          { label: 'CITAS / PEDIDOS', value: d.totalAppointments || 0, sub: `${d.pendingAppointments || 0} pendientes`, icon: Calendar, color: 'text-cyan-400' },
        ].map((m, i) => (
          <div key={i} className="card p-3 hover:border-[var(--accent-primary)]/30 transition-all group">
            <div className="flex items-center justify-between mb-1">
              <m.icon className={`w-3.5 h-3.5 ${m.color} opacity-70 group-hover:opacity-100 transition-opacity`} />
              {m.growth && <GrowthBadge value={m.growth} />}
            </div>
            <p className="text-xl font-bold text-white">{typeof m.value === 'number' ? m.value.toLocaleString() : m.value}</p>
            <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5">{m.label}</p>
            {m.sub && <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{m.sub}</p>}
          </div>
        ))}
      </div>

      {/* ===== ROW 3: CHART + PIPELINE ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Flow Chart */}
        <div className="lg:col-span-2 card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Flujo de Conversas x Conversión</h3>
              <p className="text-[10px] text-[var(--text-muted)]">
                {(d.rangeMessages || 0).toLocaleString()} mensajes · {d.rangeNewConvs || 0} nuevas
              </p>
            </div>
            <div className="flex items-center gap-4 text-[10px]">
              <div className="flex items-center gap-1.5"><div className="w-5 h-[2px] bg-emerald-500 rounded" /><span className="text-[var(--text-muted)]">Mensajes</span></div>
              <div className="flex items-center gap-1.5"><div className="w-5 h-[2px] rounded" style={{ backgroundImage: 'repeating-linear-gradient(90deg, #8b5cf6 0, #8b5cf6 3px, transparent 3px, transparent 6px)' }} /><span className="text-[var(--text-muted)]">Conversaciones</span></div>
            </div>
          </div>
          <div style={{ height: 210 }}>
            <DualLineChart data={chartData} height={210} />
          </div>
          {/* Bottom totals */}
          <div className="flex items-center justify-center gap-8 mt-2 pt-2 border-t border-[var(--border-primary)]">
            <span className="text-[10px] text-emerald-400">{(d.rangeMessages || 0).toLocaleString()} mensajes</span>
            <span className="text-[10px] text-[var(--text-muted)]">|</span>
            <span className="text-[10px] text-purple-400">{d.rangeNewConvs || 0} nuevas conv.</span>
            <span className="text-[10px] text-[var(--text-muted)]">|</span>
            <span className="text-[10px] text-[var(--text-muted)]">{d.resolutionRate || 0}% resolución</span>
          </div>
        </div>

        {/* Pipeline */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Pipeline de Ventas</h3>
            <Link href="/crm" className="text-[var(--accent-primary)] hover:opacity-80 transition-opacity"><ArrowUpRight className="w-4 h-4" /></Link>
          </div>
          <div className="max-h-[240px] overflow-y-auto pr-1 custom-scrollbar">
            <FunnelChart data={funnelData} />
          </div>
        </div>
      </div>

      {/* ===== ROW 4: ACTIVITY + LEADS + CONNECTIONS ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Recent Activity */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Eye className="w-4 h-4 text-blue-400" />Actividad Reciente</h3>
          <div className="space-y-0.5 max-h-[250px] overflow-y-auto pr-1">
            {recentActivity.slice(0, 8).map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-2.5 py-2 border-b border-white/5 last:border-0">
                <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center text-[10px] text-blue-400 font-bold flex-shrink-0">{a.user?.[0]?.toUpperCase() || '?'}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-white font-medium truncate">{a.user}</p>
                  <p className="text-[10px] text-[var(--text-muted)] truncate">{a.action}</p>
                </div>
                <span className="text-[9px] text-[var(--text-muted)] flex-shrink-0 mt-0.5">{timeAgo(a.time)}</span>
              </div>
            ))}
            {!recentActivity.length && <p className="text-center text-[var(--text-muted)] text-sm py-8">Sin actividad reciente</p>}
          </div>
        </div>

        {/* Top Leads */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" />Leads Destacados</h3>
          <div className="space-y-0.5 max-h-[250px] overflow-y-auto pr-1">
            {topLeads.map((l: any, i: number) => (
              <div key={i} className="flex items-center gap-2.5 py-2 border-b border-white/5 last:border-0">
                <div className="w-7 h-7 rounded-full bg-[var(--accent-primary)]/10 flex items-center justify-center text-[10px] text-[var(--accent-primary)] font-bold flex-shrink-0">{l.name?.[0]?.toUpperCase() || '?'}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-white font-medium truncate">{l.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-[var(--text-muted)] capitalize">{l.stage?.replace(/_/g, ' ')}</span>
                    <span className="text-[9px] text-[var(--text-muted)]">{l.messages} msgs</span>
                  </div>
                </div>
                <span className="text-[9px] text-[var(--text-muted)]">{timeAgo(l.lastActive)}</span>
              </div>
            ))}
            {!topLeads.length && <p className="text-center text-[var(--text-muted)] text-sm py-8">Sin leads activos</p>}
          </div>
        </div>

        {/* Connections + Quick Stats */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Phone className="w-4 h-4 text-green-400" />Conexiones WhatsApp</h3>
          <div className="space-y-2">
            {(d.lines || []).map((line: any) => (
              <div key={line.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="relative">
                  <Phone className="w-4 h-4 text-green-400" />
                  <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#1a1a2e] ${line.status === 'connected' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-white font-medium truncate">{line.label || line.sessionName}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">{line.phone ? `+${line.phone}` : ''}</p>
                </div>
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${line.status === 'connected' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                  {line.status === 'connected' ? '● Online' : '● Offline'}
                </span>
              </div>
            ))}
            {!(d.lines || []).length && <p className="text-center text-[var(--text-muted)] text-xs py-4">Sin líneas configuradas</p>}
          </div>
          {/* Bottom stats */}
          <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-2 gap-2">
            <div className="text-center p-2.5 rounded-xl bg-white/[0.03]">
              <p className="text-lg font-bold text-white">{d.totalClients || 0}</p>
              <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">Clientes Total</p>
            </div>
            <div className="text-center p-2.5 rounded-xl bg-white/[0.03]">
              <p className="text-lg font-bold text-emerald-400">{d.activeClients || 0}</p>
              <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">Activos</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

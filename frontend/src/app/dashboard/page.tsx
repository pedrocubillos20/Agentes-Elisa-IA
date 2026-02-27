'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { 
  MessageSquare, Users, TrendingUp, TrendingDown, Target, AlertTriangle,
  ArrowUpRight, ChevronDown, X, Filter, CheckCircle, Zap, Phone,
  BarChart3, Timer, ShieldCheck, Bot, Activity, Clock, UserCheck
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ═══════════════════════════════════════════════════════════════
// 📊 CHART COMPONENTS — Mobile-optimized
// ═══════════════════════════════════════════════════════════════

function DonutChart({ segments, size = 120, thickness = 16, centerValue, centerLabel, centerSub }: {
  segments: { value: number; color: string; label: string }[];
  size?: number; thickness?: number; centerValue?: string; centerLabel?: string; centerSub?: string;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  let cumulative = 0;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={thickness} />
        {segments.filter(s => s.value > 0).map((seg, i) => {
          const pct = total > 0 ? seg.value / total : 0;
          const dash = pct * c;
          const offset = total > 0 ? -(cumulative / total) * c : 0;
          cumulative += seg.value;
          return <circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={seg.color} strokeWidth={thickness}
            strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={offset} strokeLinecap="round"
            transform={`rotate(-90 ${size/2} ${size/2})`} style={{ transition: 'all 0.8s cubic-bezier(.4,0,.2,1)' }} />;
        })}
      </svg>
      {centerValue && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base md:text-lg font-bold text-white leading-none">{centerValue}</span>
          {centerLabel && <span className="text-[8px] md:text-[9px] text-[var(--text-muted)] mt-0.5">{centerLabel}</span>}
          {centerSub && <span className="text-[7px] md:text-[8px] text-[var(--text-muted)]">{centerSub}</span>}
        </div>
      )}
    </div>
  );
}

function GaugeChart({ value, max = 100, color = '#10b981', size = 100, label }: {
  value: number; max?: number; color?: string; size?: number; label?: string;
}) {
  const r = (size - 12) / 2;
  const c = Math.PI * r;
  const pct = Math.min(value / max, 1);
  return (
    <div className="relative flex flex-col items-center" style={{ width: size, height: size / 2 + 20 }}>
      <svg width={size} height={size / 2 + 4} viewBox={`0 0 ${size} ${size / 2 + 4}`}>
        <path d={`M 6 ${size/2} A ${r} ${r} 0 0 1 ${size-6} ${size/2}`} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" strokeLinecap="round" />
        <path d={`M 6 ${size/2} A ${r} ${r} 0 0 1 ${size-6} ${size/2}`} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${pct * c} ${c}`} style={{ transition: 'stroke-dasharray 1s ease' }} />
      </svg>
      <div className="absolute bottom-0 flex flex-col items-center">
        <span className="text-lg md:text-xl font-bold text-white">{value}%</span>
        {label && <span className="text-[8px] md:text-[9px] text-[var(--text-muted)]">{label}</span>}
      </div>
    </div>
  );
}

function BarChart({ data, height = 140, barColor = '#10b981', showLabels = true }: {
  data: Array<{ label: string; value: number; color?: string }>; height?: number; barColor?: string; showLabels?: boolean;
}) {
  const maxV = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex items-end gap-[2px] md:gap-[3px] justify-between" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-col items-center flex-1 min-w-0 group relative">
          <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
            {d.value}
          </div>
          <div className="w-full rounded-t-sm transition-all duration-500 hover:opacity-80" style={{
            height: `${Math.max((d.value / maxV) * (height - 20), 2)}px`,
            backgroundColor: d.color || barColor,
            opacity: 0.85
          }} />
          {showLabels && <span className="text-[7px] md:text-[8px] text-[var(--text-muted)] mt-1 truncate w-full text-center">{d.label}</span>}
        </div>
      ))}
    </div>
  );
}

function HBarChart({ data }: { data: Array<{ label: string; value: number; color: string; pct: string }> }) {
  const maxV = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i}>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] md:text-[11px] text-[var(--text-secondary)] truncate mr-2">{d.label}</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[9px] md:text-[10px] text-[var(--text-muted)]">{d.pct}%</span>
              <span className="text-xs font-bold" style={{ color: d.color }}>{d.value}</span>
            </div>
          </div>
          <div className="h-1.5 md:h-2 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max((d.value / maxV) * 100, 3)}%`, backgroundColor: d.color, opacity: 0.8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AreaChart({ data, height: h = 180 }: { data: Array<{ day: string; msgs: number; convs: number }>; height?: number }) {
  if (!data.length) return <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Sin datos</div>;
  const w = 700; const pad = { top: 16, right: 12, bottom: 28, left: 40 };
  const iw = w - pad.left - pad.right; const ih = h - pad.top - pad.bottom;
  const maxY = Math.max(...data.map(d => Math.max(d.msgs, d.convs)), 1);
  const toX = (i: number) => pad.left + (i / Math.max(data.length - 1, 1)) * iw;
  const toY = (v: number) => pad.top + ih - (v / maxY) * ih;
  const msgPts = data.map((d, i) => `${toX(i)},${toY(d.msgs)}`).join(' ');
  const convPts = data.map((d, i) => `${toX(i)},${toY(d.convs)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity="0.25"/><stop offset="100%" stopColor="#10b981" stopOpacity="0"/></linearGradient>
        <linearGradient id="areaP" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.15"/><stop offset="100%" stopColor="#8b5cf6" stopOpacity="0"/></linearGradient>
      </defs>
      {[0,1,2,3,4].map(i => { const y = pad.top+(ih/4)*i; return <g key={i}><line x1={pad.left} y1={y} x2={w-pad.right} y2={y} stroke="rgba(255,255,255,0.04)"/><text x={pad.left-6} y={y+3} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="8">{Math.round(maxY-(maxY/4)*i)}</text></g>; })}
      {data.filter((_,i) => i % Math.max(1,Math.floor(data.length/6))===0).map(d => <text key={d.day} x={toX(data.indexOf(d))} y={h-4} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="8">{new Date(d.day).toLocaleDateString('es',{day:'2-digit',month:'short'})}</text>)}
      <polygon points={`${pad.left},${pad.top+ih} ${msgPts} ${toX(data.length-1)},${pad.top+ih}`} fill="url(#areaG)"/>
      <polygon points={`${pad.left},${pad.top+ih} ${convPts} ${toX(data.length-1)},${pad.top+ih}`} fill="url(#areaP)"/>
      <polyline points={msgPts} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round"/>
      <polyline points={convPts} fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="5,3" strokeLinejoin="round"/>
      {data.map((d,i) => d.msgs > 0 ? <circle key={i} cx={toX(i)} cy={toY(d.msgs)} r="2" fill="#10b981" opacity="0.6"/> : null)}
    </svg>
  );
}

function Spark({ data, color = '#10b981', w = 72, h = 28 }: { data: number[]; color?: string; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i/(data.length-1))*w},${h-(v/max)*(h-3)}`).join(' ');
  return <svg width={w} height={h} className="opacity-50 hidden sm:block"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

// ═══════════════════════════════════════════════════════════════
// 🧩 UI COMPONENTS
// ═══════════════════════════════════════════════════════════════

function Growth({ value }: { value: string | number }) {
  const n = Number(value); if (!n || isNaN(n)) return null;
  const up = n > 0;
  return <span className={`inline-flex items-center gap-0.5 text-[9px] md:text-[10px] font-semibold px-1 md:px-1.5 py-0.5 rounded-md ${up ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>{up ? <TrendingUp className="w-2.5 h-2.5 md:w-3 md:h-3"/> : <TrendingDown className="w-2.5 h-2.5 md:w-3 md:h-3"/>}{up?'+':''}{value}%</span>;
}

function KPI({ icon: Icon, label, value, sub, growth, color = 'text-emerald-400', spark }: {
  icon: any; label: string; value: string | number; sub?: string; growth?: string | number; color?: string; spark?: number[];
}) {
  return (
    <div className="card p-2.5 md:p-3.5 flex flex-col justify-between min-h-[80px] md:min-h-[96px]">
      <div className="flex items-center justify-between mb-1 md:mb-1.5">
        <div className="flex items-center gap-1 md:gap-1.5"><Icon className={`w-3 h-3 md:w-3.5 md:h-3.5 ${color}`}/><span className="text-[9px] md:text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium truncate">{label}</span></div>
        {growth && <Growth value={growth}/>}
      </div>
      <div className="flex items-end justify-between">
        <div><p className="text-xl md:text-2xl font-bold text-white leading-none">{value}</p>{sub && <p className="text-[9px] md:text-[10px] text-[var(--text-muted)] mt-0.5">{sub}</p>}</div>
        {spark && spark.length > 2 && <Spark data={spark} color={color.includes('emerald')?'#10b981':color.includes('blue')?'#3b82f6':color.includes('amber')?'#f59e0b':color.includes('purple')?'#8b5cf6':color.includes('cyan')?'#06b6d4':'#10b981'}/>}
      </div>
    </div>
  );
}

function Metric({ label, value, icon, color = 'text-emerald-400' }: { label: string; value: string | number; icon?: string; color?: string }) {
  return (
    <div className="flex items-center justify-between py-1 md:py-1.5 border-b border-white/5 last:border-0">
      <span className="text-[10px] md:text-[11px] text-[var(--text-muted)]">{icon && <span className="mr-1">{icon}</span>}{label}</span>
      <span className={`text-xs md:text-sm font-bold ${color}`}>{value}</span>
    </div>
  );
}

// Stage config
const STAGES: Record<string, { label: string; color: string; order: number }> = {
  new: { label: 'Nuevo', color: '#6b7280', order: 0 }, saludo: { label: 'Saludo', color: '#94a3b8', order: 1 },
  interested: { label: 'Interesado', color: '#3b82f6', order: 2 }, interesado: { label: 'Interesado', color: '#3b82f6', order: 2 },
  descubrimiento: { label: 'Descubrimiento', color: '#06b6d4', order: 3 }, demo: { label: 'Demo', color: '#8b5cf6', order: 4 },
  cotización: { label: 'Cotización', color: '#eab308', order: 5 }, cotizacion: { label: 'Cotización', color: '#eab308', order: 5 }, quoting: { label: 'Cotización', color: '#eab308', order: 5 },
  pendiente_decision: { label: 'Decisión', color: '#f97316', order: 6 }, negotiating: { label: 'Negociando', color: '#f97316', order: 7 },
  converted: { label: 'Convertido', color: '#10b981', order: 9 }, convertido: { label: 'Convertido', color: '#10b981', order: 9 }, confirmado: { label: 'Confirmado', color: '#10b981', order: 9 },
  lost: { label: 'Perdido', color: '#ef4444', order: 10 }, perdido: { label: 'Perdido', color: '#ef4444', order: 10 },
};

// ═══════════════════════════════════════════════════════════════
// 🏠 MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [d, setD] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('7d');
  const [showFilters, setShowFilters] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const periodRef = useRef(period); const cfRef = useRef(customFrom); const ctRef = useRef(customTo);
  useEffect(() => { periodRef.current = period; }, [period]);
  useEffect(() => { cfRef.current = customFrom; }, [customFrom]);
  useEffect(() => { ctRef.current = customTo; }, [customTo]);

  const getLineId = () => typeof window !== 'undefined' ? localStorage.getItem('selectedLineId') || '' : '';

  const fetchData = async () => {
    const token = localStorage.getItem('token'); if (!token) return;
    try {
      const lineId = getLineId();
      let url = `${API_URL}/api/conversations/dashboard?lineId=${lineId}&period=${periodRef.current}`;
      if (periodRef.current === 'custom' && cfRef.current && ctRef.current) url += `&dateFrom=${cfRef.current}&dateTo=${ctRef.current}`;
      const [uRes, dRes] = await Promise.all([
        fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(url, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null)
      ]);
      if (uRes.ok) { const u = await uRes.json(); setUser(u.user); try{localStorage.setItem('bizonne_user_cache',JSON.stringify(u.user))}catch{} }
      if (dRes?.ok) { const dd = await dRes.json(); setD(dd); try{localStorage.setItem('bizonne_dashboard_cache',JSON.stringify(dd))}catch{} }
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    try { const c=localStorage.getItem('bizonne_dashboard_cache'); const u=localStorage.getItem('bizonne_user_cache'); if(c){setD(JSON.parse(c));setLoading(false);} if(u)setUser(JSON.parse(u)); } catch{}
    fetchData();
    const iv = setInterval(fetchData, 30000);
    const onLine = () => fetchData();
    window.addEventListener('lineChanged', onLine);
    return () => { clearInterval(iv); window.removeEventListener('lineChanged', onLine); };
  }, []);

  useEffect(() => { fetchData(); }, [period, customFrom, customTo]);

  const setPeriodQ = (p: string) => { setCustomFrom(''); setCustomTo(''); setPeriod(p); setShowFilters(false); };
  const setMonth = (m: number) => { const y=new Date().getFullYear(); setCustomFrom(`${y}-${String(m+1).padStart(2,'0')}-01`); setCustomTo(`${y}-${String(m+1).padStart(2,'0')}-${new Date(y,m+1,0).getDate()}`); setPeriod('custom'); setShowFilters(false); };

  const line = (d.lines||[]).find((l:any)=>l.id===getLineId());
  const tAgo = (s:string) => { const df=Math.floor((Date.now()-new Date(s).getTime())/1000); if(df<60)return'Ahora'; if(df<3600)return`${Math.floor(df/60)}m`; if(df<86400)return`${Math.floor(df/3600)}h`; return`${Math.floor(df/86400)}d`; };
  const pLabels: Record<string,string> = {'24h':'24h','7d':'7 días','30d':'30 días','90d':'90 días',year:'Año',custom:'Custom'};

  if (loading) return <div className="flex items-center justify-center h-64"><div className="loading-spinner w-8 h-8"/></div>;

  if (user?.isBlocked || user?.subscriptionStatus === 'expired') return (
    <div className="max-w-2xl mx-auto py-20 text-center px-4">
      <h1 className="text-2xl md:text-3xl font-bold text-white mb-4">Tu período de prueba ha terminado</h1>
      <p className="text-[var(--text-muted)] text-base md:text-lg mb-8">Elige un plan para seguir usando la plataforma.</p>
      <a href="/subscription" className="px-6 md:px-8 py-3 md:py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-bold rounded-2xl text-base md:text-lg inline-block">🚀 Ver Planes</a>
    </div>
  );

  const isTrial = user?.plan === 'trial';
  const daysLeft = user?.daysRemaining || 0;
  const chart = d.chartData || [];
  const funnel = d.funnelData || [];
  const recent = d.recentActivity || [];
  const leads = d.topLeads || [];
  const dist = d.stageDistribution || {};
  const ws = d.whatsappStats || {};
  const hourly = d.hourlyData || [];
  const sparkM = chart.map((c:any) => c.msgs);
  const sparkC = chart.map((c:any) => c.convs);

  const pipelineData = funnel
    .filter((f:any) => f.count > 0)
    .sort((a:any,b:any) => (STAGES[a.stage]?.order??50)-(STAGES[b.stage]?.order??50))
    .map((f:any) => {
      const s = STAGES[f.stage] || { label: f.stage?.replace(/_/g,' '), color: '#6b7280' };
      const pct = (dist.total||0) > 0 ? ((f.count/dist.total)*100).toFixed(0) : '0';
      return { label: s.label, value: f.count, color: s.color, pct };
    });

  const hourlyBars = hourly.map((h:any) => ({
    label: `${h.hour}h`,
    value: h.count,
    color: h.hour >= 8 && h.hour <= 20 ? '#10b981' : '#3b82f6'
  }));

  const distSegments = [
    { value: dist.resolved || 0, color: '#10b981', label: 'Convertidos' },
    { value: dist.active || 0, color: '#3b82f6', label: 'Activos' },
    { value: dist.pending || 0, color: '#eab308', label: 'Pendientes' },
    { value: dist.atRisk || 0, color: '#ef4444', label: 'En Riesgo' },
    { value: dist.lost || 0, color: '#6b7280', label: 'Perdidos' },
  ];

  const aiSegments = [
    { value: d.aiResolvedCount || 0, color: '#10b981', label: 'IA Resolvió' },
    { value: d.aiPausedCount || 0, color: '#f59e0b', label: 'Transferido' },
    { value: Math.max((d.totalConversations||0)-(d.aiResolvedCount||0)-(d.aiPausedCount||0), 0), color: '#3b82f6', label: 'En proceso' },
  ];

  const whatsappSegments = [
    { value: ws.sent || 0, color: '#10b981', label: 'Enviados' },
    { value: ws.received || 0, color: '#3b82f6', label: 'Recibidos' },
  ];

  return (
    <div className="max-w-[1440px] mx-auto space-y-3 pb-6">

      {/* ══════ HEADER ══════ */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-base md:text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-[9px] md:text-xs text-[var(--text-muted)] truncate">{line ? `${line.label||''} · +${line.phone}` : 'Todas las líneas'}</p>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
          <Link href="/conversaciones" className="btn-secondary py-1.5 md:py-2 px-2 md:px-3 text-[10px] md:text-xs flex items-center gap-1"><MessageSquare className="w-3 h-3 md:w-3.5 md:h-3.5"/>
            <span className="hidden sm:inline">Chats</span>
          </Link>
          <Link href="/crm" className="btn-primary py-1.5 md:py-2 px-2 md:px-3 text-[10px] md:text-xs flex items-center gap-1"><Users className="w-3 h-3 md:w-3.5 md:h-3.5"/>
            <span className="hidden sm:inline">CRM</span>
          </Link>
          <div className="relative">
            <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-1 md:gap-1.5 py-1.5 md:py-2 px-2 md:px-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[10px] md:text-xs text-white hover:bg-white/5">
              <Filter className="w-3 h-3 md:w-3.5 md:h-3.5 text-[var(--accent-primary)]"/><span className="hidden xs:inline">{pLabels[period]||period}</span><ChevronDown className="w-2.5 h-2.5 md:w-3 md:h-3 text-[var(--text-muted)]"/>
            </button>
            {showFilters && (<>
              <div className="fixed inset-0 z-40" onClick={() => setShowFilters(false)}/>
              <div className="absolute right-0 top-10 md:top-11 z-50 w-[260px] md:w-[300px] bg-[#1a1a2e] border border-[var(--border-primary)] rounded-2xl shadow-2xl shadow-black/50 p-3 md:p-4 space-y-2.5 md:space-y-3">
                <div className="flex items-center justify-between"><span className="text-xs md:text-sm font-semibold text-white">Período</span><button onClick={() => setShowFilters(false)} className="p-1 hover:bg-white/10 rounded-full"><X className="w-3.5 h-3.5"/></button></div>
                <div className="flex gap-1 md:gap-1.5">{['24h','7d','30d','90d'].map(p => <button key={p} onClick={() => setPeriodQ(p)} className={`flex-1 py-1.5 text-[10px] md:text-xs rounded-lg border ${period===p?'bg-[var(--accent-primary)] border-[var(--accent-primary)] text-black font-bold':'bg-white/5 border-white/10 text-[var(--text-muted)] hover:text-white'}`}>{p}</button>)}</div>
                <div className="grid grid-cols-6 gap-1">{['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'].map((m,i) => <button key={m} onClick={() => setMonth(i)} className="py-1 text-[8px] md:text-[9px] rounded bg-white/5 border border-white/10 text-[var(--text-muted)] hover:text-white">{m}</button>)}</div>
                <div className="flex gap-2 items-center">
                  <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-lg py-1.5 px-2 text-[10px] md:text-xs text-white outline-none"/>
                  <span className="text-[var(--text-muted)] text-xs">→</span>
                  <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-lg py-1.5 px-2 text-[10px] md:text-xs text-white outline-none"/>
                </div>
                <button onClick={() => {if(customFrom&&customTo){setPeriod('custom');setShowFilters(false);}}} disabled={!customFrom||!customTo} className="w-full py-2 text-xs font-bold rounded-xl bg-[var(--accent-primary)] text-black disabled:opacity-30">Aplicar</button>
              </div>
            </>)}
          </div>
        </div>
      </div>

      {isTrial && daysLeft > 0 && daysLeft <= 20 && (
        <a href="/subscription" className={`flex items-center justify-between p-2.5 md:p-3 rounded-xl border ${daysLeft<=5?'bg-red-500/10 border-red-500/30':'bg-emerald-500/10 border-emerald-500/30'}`}>
          <span className="text-xs md:text-sm text-white">🕐 <strong>{daysLeft} días</strong> restantes</span>
          <span className="text-[10px] md:text-xs text-[var(--accent-primary)] font-bold">Ver Planes →</span>
        </a>
      )}

      {/* ══════ ROW 1: 6 KPI CARDS ══════ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
        <KPI icon={MessageSquare} label="Mensajes" value={d.rangeMessages||0} sub={`${d.todayMessages||0} hoy`} growth={d.msgGrowth} color="text-emerald-400" spark={sparkM}/>
        <KPI icon={Users} label="Nuevos Leads" value={d.rangeNewConvs||0} sub={`${d.totalConversations||0} total`} growth={d.convGrowth} color="text-blue-400" spark={sparkC}/>
        <KPI icon={Target} label="Convertidos" value={d.rangeConvertedConvs||0} sub={`${d.conversionRate||0}% tasa`} growth={d.convertedGrowth} color="text-emerald-400"/>
        <KPI icon={Timer} label="FRT Prom." value={d.avgFRT?`${d.avgFRT}m`:'—'} sub="1era respuesta" color="text-amber-400"/>
        <KPI icon={UserCheck} label="Contacto" value={`${d.contactRate||0}%`} sub="Contactados" color="text-cyan-400"/>
        <KPI icon={Bot} label="IA Autónoma" value={`${d.aiAutoRate||0}%`} sub={`${d.aiPausedCount||0} transfer.`} color="text-purple-400"/>
      </div>

      {/* ══════ ROW 2: 3 GAUGE/DONUT CARDS ══════ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
        {/* SLA + Efficiency */}
        <div className="card p-3 md:p-4">
          <div className="flex items-center gap-2 mb-2"><ShieldCheck className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-400"/><span className="text-[11px] md:text-xs font-semibold text-white">SLA & Eficiencia</span></div>
          <div className="flex items-center justify-around mb-2">
            <GaugeChart value={d.slaCompliance||0} color={d.slaCompliance>=80?'#10b981':d.slaCompliance>=50?'#f59e0b':'#ef4444'} size={90} label="SLA < 5min"/>
            <GaugeChart value={Number(d.conversionRate)||0} color="#8b5cf6" size={90} label="Conversión"/>
          </div>
          <Metric label="Ciclo de Venta" value={d.avgCycleTime?`${d.avgCycleTime} días`:'—'} icon="📅" color="text-blue-400"/>
          <Metric label="Msgs/Conv" value={d.avgMsgsPerConv||0} icon="💬" color="text-cyan-400"/>
          <Metric label="Mayor espera" value={d.oldestWait||'0h'} icon="🔴" color="text-red-400"/>
        </div>

        {/* AI Performance */}
        <div className="card p-3 md:p-4">
          <div className="flex items-center gap-2 mb-2"><Bot className="w-3.5 h-3.5 md:w-4 md:h-4 text-purple-400"/><span className="text-[11px] md:text-xs font-semibold text-white">Rendimiento IA</span></div>
          <div className="flex items-center gap-3 mb-2">
            <DonutChart segments={aiSegments} size={90} thickness={12} centerValue={`${d.aiAutoRate||0}%`} centerLabel="Autónoma"/>
            <div className="flex-1 space-y-1.5">
              {aiSegments.map(s => (
                <div key={s.label} className="flex items-center justify-between text-[10px] md:text-[11px]">
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{backgroundColor:s.color}}/><span className="text-[var(--text-muted)]">{s.label}</span></div>
                  <span className="text-white font-medium">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
          <Metric label="Transferencia" value={`${d.aiTransferRate||0}%`} icon="🔄" color="text-amber-400"/>
          <Metric label="Resolución IA" value={`${d.aiResolvedRate||0}%`} icon="🤖" color="text-emerald-400"/>
          <Metric label="Abandono" value={`${d.abandonmentRate||0}%`} icon="🚪" color="text-red-400"/>
        </div>

        {/* WhatsApp */}
        <div className="card p-3 md:p-4">
          <div className="flex items-center gap-2 mb-2"><Activity className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-400"/><span className="text-[11px] md:text-xs font-semibold text-white">WhatsApp</span></div>
          <div className="flex items-center gap-3 mb-2">
            <DonutChart segments={whatsappSegments} size={90} thickness={12} centerValue={String(ws.total||0)} centerLabel="Total"/>
            <div className="flex-1 space-y-1.5">
              {whatsappSegments.map(s => (
                <div key={s.label} className="flex items-center justify-between text-[10px] md:text-[11px]">
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{backgroundColor:s.color}}/><span className="text-[var(--text-muted)]">{s.label}</span></div>
                  <span className="text-white font-medium">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
          <Metric label="Ratio Env/Rec" value={ws.received>0?(ws.sent/ws.received).toFixed(1):'—'} icon="⚖️" color="text-purple-400"/>
          <Metric label="En Riesgo (+48h)" value={d.atRiskConvs||0} icon="⚠️" color={d.atRiskConvs>10?'text-red-400':'text-amber-400'}/>
          <Metric label="IA Pausada" value={d.aiPausedCount||0} icon="⏸️" color="text-amber-400"/>
          <Metric label="Citas Pend." value={d.pendingAppointments||0} icon="📋" color="text-blue-400"/>
        </div>
      </div>

      {/* ══════ ROW 3: AREA CHART + HOURLY BAR ══════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 md:gap-3">
        <div className="card p-3 md:p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2"><BarChart3 className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-400"/><span className="text-[11px] md:text-xs font-semibold text-white">Flujo de Actividad</span></div>
            <div className="flex items-center gap-2 md:gap-3 text-[9px] md:text-[10px] text-[var(--text-muted)]">
              <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-emerald-400 rounded"/>Msgs</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0 border-t border-dashed border-purple-400"/>Convs</span>
            </div>
          </div>
          <AreaChart data={chart} height={160}/>
        </div>
        <div className="card p-3 md:p-4">
          <div className="flex items-center gap-2 mb-2"><Clock className="w-3.5 h-3.5 md:w-4 md:h-4 text-cyan-400"/><span className="text-[11px] md:text-xs font-semibold text-white">Actividad por Hora</span></div>
          <BarChart data={hourlyBars} height={120}  barColor="#10b981" showLabels={true}/>
          <div className="flex items-center justify-between mt-2 text-[8px] md:text-[9px] text-[var(--text-muted)]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/80"/>8-20h</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500/80"/>Noche</span>
          </div>
        </div>
      </div>

      {/* ══════ ROW 4: PIPELINE + DISTRIBUTION + CONVERSION ══════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
        <div className="card p-3 md:p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Target className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-400"/><span className="text-[11px] md:text-xs font-semibold text-white">Pipeline</span></div>
            <Link href="/crm" className="text-[9px] md:text-[10px] text-[var(--accent-primary)] hover:underline flex items-center gap-0.5">CRM<ArrowUpRight className="w-3 h-3"/></Link>
          </div>
          <HBarChart data={pipelineData}/>
        </div>

        <div className="card p-3 md:p-4">
          <div className="flex items-center gap-2 mb-3"><CheckCircle className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-400"/><span className="text-[11px] md:text-xs font-semibold text-white">Distribución</span></div>
          <div className="flex items-center gap-3">
            <DonutChart segments={distSegments} size={100} thickness={12} centerValue={String(dist.total||0)} centerLabel="Total"/>
            <div className="flex-1 space-y-1.5">
              {distSegments.map(s => {
                const pct = (dist.total||0)>0?((s.value/dist.total)*100).toFixed(0):'0';
                return (
                  <div key={s.label} className="flex items-center justify-between text-[10px] md:text-[11px]">
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{backgroundColor:s.color}}/><span className="text-[var(--text-muted)]">{s.label}</span></div>
                    <span className="text-white font-medium">{s.value} <span className="text-[var(--text-muted)] text-[8px] md:text-[9px]">({pct}%)</span></span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card p-3 md:p-4 sm:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-2 mb-3"><BarChart3 className="w-3.5 h-3.5 md:w-4 md:h-4 text-purple-400"/><span className="text-[11px] md:text-xs font-semibold text-white">Conversión por Etapa</span></div>
          {pipelineData.length > 0 ? (
            <BarChart data={pipelineData.map((p: any) => ({...p, label: p.label.substring(0,6)}))} height={130} showLabels={true}/>
          ) : <div className="text-center py-8 text-[var(--text-muted)] text-xs">Sin datos</div>}
        </div>
      </div>

      {/* ══════ ROW 5: RECENT + TOP LEADS ══════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
        <div className="card p-3 md:p-4">
          <div className="flex items-center gap-2 mb-3"><Zap className="w-3.5 h-3.5 md:w-4 md:h-4 text-amber-400"/><span className="text-[11px] md:text-xs font-semibold text-white">Actividad Reciente</span></div>
          <div className="space-y-0.5 max-h-[200px] md:max-h-[220px] overflow-y-auto">
            {recent.length===0 && <p className="text-[var(--text-muted)] text-xs py-4 text-center">Sin actividad</p>}
            {recent.slice(0,8).map((a:any,i:number) => (
              <div key={i} className="flex items-start gap-2 py-1.5 border-b border-white/5 last:border-0">
                <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-[var(--accent-primary)]/15 flex items-center justify-center flex-shrink-0 mt-0.5"><span className="text-[8px] md:text-[9px] font-bold text-[var(--accent-primary)]">{(a.user||'?')[0]}</span></div>
                <div className="flex-1 min-w-0"><p className="text-[10px] md:text-[11px] text-white font-medium truncate">{a.user}</p><p className="text-[9px] md:text-[10px] text-[var(--text-muted)] truncate">{a.action}</p></div>
                <div className="flex flex-col items-end flex-shrink-0">
                  <span className="text-[8px] md:text-[9px] text-[var(--text-muted)]">{tAgo(a.time)}</span>
                  {a.stage && <span className="text-[7px] md:text-[8px] px-1 md:px-1.5 py-0.5 rounded-full mt-0.5" style={{backgroundColor:(STAGES[a.stage]?.color||'#6b7280')+'20',color:STAGES[a.stage]?.color||'#6b7280'}}>{STAGES[a.stage]?.label||a.stage}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-3 md:p-4">
          <div className="flex items-center gap-2 mb-3"><TrendingUp className="w-3.5 h-3.5 md:w-4 md:h-4 text-blue-400"/><span className="text-[11px] md:text-xs font-semibold text-white">Top Leads Activos</span></div>
          <div className="space-y-0.5 max-h-[200px] md:max-h-[220px] overflow-y-auto">
            {leads.length===0 && <p className="text-[var(--text-muted)] text-xs py-4 text-center">Sin leads</p>}
            {leads.map((l:any,i:number) => (
              <div key={l.id||i} className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0">
                <div className="w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{backgroundColor:(STAGES[l.stage]?.color||'#6b7280')+'20'}}>
                  <span className="text-[9px] md:text-[10px] font-bold" style={{color:STAGES[l.stage]?.color||'#6b7280'}}>{i+1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] md:text-[11px] text-white font-medium truncate">{l.name}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] md:text-[10px] text-[var(--text-muted)]">{l.messages} msgs</span>
                    <span className="text-[8px] md:text-[9px] px-1 md:px-1.5 py-0.5 rounded-full" style={{backgroundColor:(STAGES[l.stage]?.color||'#6b7280')+'20',color:STAGES[l.stage]?.color||'#6b7280'}}>{STAGES[l.stage]?.label||l.stage}</span>
                  </div>
                </div>
                <span className="text-[8px] md:text-[9px] text-[var(--text-muted)] flex-shrink-0">{tAgo(l.lastActive)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center py-2 md:py-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10">
          <img src="/bizonne.png" alt="" className="w-4 h-4 md:w-5 md:h-5 rounded-lg"/>
          <span className="text-[8px] md:text-[9px] text-[var(--text-muted)]">Powered by <span className="text-white font-semibold">Bizonne</span></span>
        </div>
      </div>
    </div>
  );
}

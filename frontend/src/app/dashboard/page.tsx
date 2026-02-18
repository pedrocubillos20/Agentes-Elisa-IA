'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { 
  MessageSquare, Users, Clock, Activity, TrendingUp, TrendingDown,
  Target, AlertTriangle, ArrowUpRight, ChevronDown, X, Filter,
  CheckCircle, Pause, Zap, Phone, BarChart3, Timer, ShieldCheck, Bot
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ===== SPARKLINE =====
function Sparkline({ data, color = '#10b981', height = 32 }: { data: number[]; color?: string; height?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const w = 80;
  const pts = data.map((v, i) => `${(i / Math.max(data.length - 1, 1)) * w},${height - (v / max) * (height - 4)}`).join(' ');
  return (
    <svg width={w} height={height} className="opacity-60">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ===== AREA CHART =====
function AreaChart({ data, height: h = 200 }: { data: Array<{ day: string; msgs: number; convs: number }>; height?: number }) {
  if (!data.length) return <div className="flex items-center justify-center h-40 text-[var(--text-muted)] text-sm">Sin datos</div>;
  const w = 720; const pad = { top: 20, right: 16, bottom: 30, left: 44 };
  const iw = w - pad.left - pad.right; const ih = h - pad.top - pad.bottom;
  const maxY = Math.max(...data.map(d => Math.max(d.msgs, d.convs)), 1);
  const gridLines = 4;
  const toX = (i: number) => pad.left + (i / Math.max(data.length - 1, 1)) * iw;
  const toY = (v: number) => pad.top + ih - (v / maxY) * ih;
  const msgPts = data.map((d, i) => `${toX(i)},${toY(d.msgs)}`).join(' ');
  const convPts = data.map((d, i) => `${toX(i)},${toY(d.convs)}`).join(' ');
  const msgArea = `${pad.left},${pad.top + ih} ${msgPts} ${toX(data.length - 1)},${pad.top + ih}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
      <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity="0.2"/><stop offset="100%" stopColor="#10b981" stopOpacity="0"/></linearGradient></defs>
      {Array.from({length: gridLines + 1}).map((_, i) => {
        const y = pad.top + (ih / gridLines) * i;
        return (<g key={i}><line x1={pad.left} y1={y} x2={w-pad.right} y2={y} stroke="rgba(255,255,255,0.05)"/><text x={pad.left-8} y={y+3} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="9">{Math.round(maxY - (maxY/gridLines)*i)}</text></g>);
      })}
      {data.filter((_,i) => i % Math.max(1, Math.floor(data.length/6)) === 0).map((d,i) => (
        <text key={i} x={toX(data.indexOf(d))} y={h-6} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9">{new Date(d.day).toLocaleDateString('es',{month:'2-digit',day:'2-digit'})}</text>
      ))}
      <polygon points={msgArea} fill="url(#mg)"/>
      <polyline points={msgPts} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round"/>
      <polyline points={convPts} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeDasharray="6,3" strokeLinejoin="round"/>
    </svg>
  );
}

// ===== PIPELINE FUNNEL =====
function PipelineFunnel({ data }: { data: Array<{ stage: string; count: number }> }) {
  const cfg: Record<string,{label:string;color:string;order:number}> = {
    new:{label:'Nuevo',color:'#6b7280',order:0}, saludo:{label:'Saludo',color:'#6b7280',order:1},
    interested:{label:'Interesado',color:'#3b82f6',order:2}, interesado:{label:'Interesado',color:'#3b82f6',order:2},
    cotización:{label:'Cotización',color:'#eab308',order:5}, cotizacion:{label:'Cotización',color:'#eab308',order:5}, quoting:{label:'Cotización',color:'#eab308',order:5},
    converted:{label:'Convertido',color:'#10b981',order:9}, convertido:{label:'Convertido',color:'#10b981',order:9}, confirmado:{label:'Confirmado',color:'#10b981',order:9},
    lost:{label:'Perdido',color:'#ef4444',order:10}, perdido:{label:'Perdido',color:'#ef4444',order:10},
  };
  const sorted = data.filter(d => d.count > 0).sort((a,b) => (cfg[a.stage]?.order ?? 50)-(cfg[b.stage]?.order ?? 50));
  const maxC = Math.max(...sorted.map(d => d.count),1);
  const total = sorted.reduce((s,d) => s + d.count,0);
  if (!sorted.length) return <div className="text-center py-4 text-[var(--text-muted)] text-sm">Sin datos</div>;
  return (
    <div className="space-y-1.5">
      {sorted.map(d => {
        const info = cfg[d.stage] || {label: d.stage?.replace(/_/g,' '), color:'#6b7280'};
        return (
          <div key={d.stage}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[11px] text-[var(--text-secondary)] capitalize">{info.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--text-muted)]">{total > 0 ? ((d.count/total)*100).toFixed(0) : 0}%</span>
                <span className="text-xs font-bold" style={{color:info.color}}>{d.count}</span>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{width:`${Math.max((d.count/maxC)*100,3)}%`,backgroundColor:info.color,opacity:0.8}}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== GROWTH BADGE =====
function Growth({value}:{value:string|number}) {
  const n = Number(value); if(!n||isNaN(n)) return null;
  const up = n > 0;
  return <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${up?'bg-emerald-500/15 text-emerald-400':'bg-red-500/15 text-red-400'}`}>{up?<TrendingUp className="w-3 h-3"/>:<TrendingDown className="w-3 h-3"/>}{up?'+':''}{value}%</span>;
}

// ===== KPI CARD =====
function KPI({icon:Icon,label,value,sub,growth,color='text-white',spark}:{icon:any;label:string;value:string|number;sub?:string;growth?:string|number;color?:string;spark?:number[]}) {
  return (
    <div className="card p-4 flex flex-col justify-between min-h-[100px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2"><Icon className={`w-4 h-4 ${color}`}/><span className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide">{label}</span></div>
        {growth && <Growth value={growth}/>}
      </div>
      <div className="flex items-end justify-between">
        <div><p className="text-2xl font-bold text-white leading-none">{value}</p>{sub && <p className="text-[10px] text-[var(--text-muted)] mt-1">{sub}</p>}</div>
        {spark && spark.length > 1 && <Sparkline data={spark} color={color.includes('emerald')?'#10b981':color.includes('blue')?'#3b82f6':color.includes('amber')?'#f59e0b':color.includes('purple')?'#8b5cf6':'#10b981'}/>}
      </div>
    </div>
  );
}

// ===== METRIC ROW =====
function MetricRow({label,value,icon,color='text-emerald-400'}:{label:string;value:string|number;icon?:string;color?:string}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-xs text-[var(--text-muted)]">{icon && <span className="mr-1">{icon}</span>}{label}</span>
      <span className={`text-sm font-bold ${color}`}>{value}</span>
    </div>
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

  const periodRef = useRef(period);
  const customFromRef = useRef(customFrom);
  const customToRef = useRef(customTo);
  useEffect(() => { periodRef.current = period; }, [period]);
  useEffect(() => { customFromRef.current = customFrom; }, [customFrom]);
  useEffect(() => { customToRef.current = customTo; }, [customTo]);

  const getLineId = () => typeof window !== 'undefined' ? localStorage.getItem('selectedLineId') || '' : '';

  const fetchData = async () => {
    const token = localStorage.getItem('token'); if (!token) return;
    try {
      const lineId = getLineId();
      let url = `${API_URL}/api/conversations/dashboard?lineId=${lineId}&period=${periodRef.current}`;
      if (periodRef.current === 'custom' && customFromRef.current && customToRef.current) url += `&dateFrom=${customFromRef.current}&dateTo=${customToRef.current}`;
      const [userRes, dashRes] = await Promise.all([
        fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(url, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null)
      ]);
      if (userRes.ok) { const ud = await userRes.json(); setUser(ud.user); try { localStorage.setItem('bizonne_user_cache', JSON.stringify(ud.user)); } catch {} }
      if (dashRes?.ok) { const dd = await dashRes.json(); setD(dd); try { localStorage.setItem('bizonne_dashboard_cache', JSON.stringify(dd)); } catch {} }
    } catch {} finally { setLoading(false); }
  };

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

  const setPeriodQuick = (p: string) => { setCustomFrom(''); setCustomTo(''); setPeriod(p); setShowFilters(false); };
  const setMonthRange = (m: number) => {
    const y = new Date().getFullYear();
    setCustomFrom(`${y}-${String(m+1).padStart(2,'0')}-01`);
    setCustomTo(`${y}-${String(m+1).padStart(2,'0')}-${new Date(y,m+1,0).getDate()}`);
    setPeriod('custom'); setShowFilters(false);
  };

  const selectedLine = (d.lines||[]).find((l:any)=>l.id===getLineId());
  const timeAgo = (s:string) => { const diff = Math.floor((Date.now()-new Date(s).getTime())/1000); if(diff<60) return 'Ahora'; if(diff<3600) return `${Math.floor(diff/60)}m`; if(diff<86400) return `${Math.floor(diff/3600)}h`; return `${Math.floor(diff/86400)}d`; };
  const periodLabels: Record<string,string> = {'24h':'24h','7d':'7 días','30d':'30 días','90d':'90 días',year:'Año',custom:'Custom'};

  if (loading) return <div className="flex items-center justify-center h-64"><div className="loading-spinner w-8 h-8"/></div>;

  const isBlocked = user?.isBlocked || user?.subscriptionStatus === 'expired';
  const isTrial = user?.plan === 'trial';
  const daysRemaining = user?.daysRemaining || 0;
  if (isBlocked) return (
    <div className="max-w-2xl mx-auto py-20 text-center">
      <h1 className="text-3xl font-bold text-white mb-4">Tu período de prueba ha terminado</h1>
      <p className="text-[var(--text-muted)] text-lg mb-8">Elige un plan para seguir usando la plataforma.</p>
      <a href="/subscription" className="px-8 py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-bold rounded-2xl text-lg inline-block">🚀 Ver Planes</a>
    </div>
  );

  const chartData = d.chartData || [];
  const funnelData = d.funnelData || [];
  const recentActivity = d.recentActivity || [];
  const dist = d.stageDistribution || {};
  const wStats = d.whatsappStats || {};
  const sparkMsgs = chartData.map((c:any) => c.msgs);
  const sparkConvs = chartData.map((c:any) => c.convs);

  return (
    <div className="max-w-[1400px] mx-auto space-y-4">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-xs text-[var(--text-muted)]">{selectedLine ? `${selectedLine.label||''} · +${selectedLine.phone}` : 'Todas las líneas'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/conversaciones" className="btn-secondary py-2 px-3 text-xs flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5"/>Chats</Link>
          <Link href="/crm" className="btn-primary py-2 px-3 text-xs flex items-center gap-1.5"><Users className="w-3.5 h-3.5"/>CRM</Link>
          <div className="relative">
            <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-1.5 py-2 px-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-xs text-white hover:bg-white/5">
              <Filter className="w-3.5 h-3.5 text-[var(--accent-primary)]"/>{periodLabels[period]||period}<ChevronDown className="w-3 h-3 text-[var(--text-muted)]"/>
            </button>
            {showFilters && (<>
              <div className="fixed inset-0 z-40" onClick={() => setShowFilters(false)}/>
              <div className="absolute right-0 top-11 z-50 w-[320px] bg-[#1a1a2e] border border-[var(--border-primary)] rounded-2xl shadow-2xl shadow-black/50 p-4 space-y-4">
                <div className="flex items-center justify-between"><span className="text-sm font-semibold text-white">Período</span><button onClick={() => setShowFilters(false)} className="p-1 hover:bg-white/10 rounded-full"><X className="w-3.5 h-3.5"/></button></div>
                <div className="flex gap-1.5">
                  {['24h','7d','30d','90d'].map(p => (
                    <button key={p} onClick={() => setPeriodQuick(p)} className={`flex-1 py-2 text-xs rounded-lg border transition-all ${period===p?'bg-[var(--accent-primary)] border-[var(--accent-primary)] text-black font-bold':'bg-white/5 border-white/10 text-[var(--text-muted)] hover:text-white'}`}>{p}</button>
                  ))}
                </div>
                <div className="grid grid-cols-6 gap-1">
                  {['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'].map((m,i) => (
                    <button key={m} onClick={() => setMonthRange(i)} className="py-1.5 text-[10px] rounded-lg bg-white/5 border border-white/10 text-[var(--text-muted)] hover:text-white hover:border-[var(--accent-primary)]/50 transition-all">{m}</button>
                  ))}
                </div>
                <div>
                  <div className="flex gap-2 items-center">
                    <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-lg py-1.5 px-2 text-xs text-white outline-none"/>
                    <span className="text-[var(--text-muted)] text-xs">→</span>
                    <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-lg py-1.5 px-2 text-xs text-white outline-none"/>
                  </div>
                  <button onClick={() => {if(customFrom&&customTo){setPeriod('custom');setShowFilters(false);}}} disabled={!customFrom||!customTo} className="w-full mt-2 py-2 text-xs font-bold rounded-xl bg-[var(--accent-primary)] text-black disabled:opacity-30">Aplicar</button>
                </div>
              </div>
            </>)}
          </div>
        </div>
      </div>

      {isTrial && daysRemaining > 0 && daysRemaining <= 20 && (
        <a href="/subscription" className={`flex items-center justify-between p-3 rounded-xl border ${daysRemaining<=5?'bg-red-500/10 border-red-500/30':'bg-emerald-500/10 border-emerald-500/30'}`}>
          <span className="text-sm text-white">🕐 Te quedan <strong>{daysRemaining} días</strong> de prueba</span>
          <span className="text-xs text-[var(--accent-primary)] font-bold">Ver Planes →</span>
        </a>
      )}

      {/* ROW 1: 6 KPI CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI icon={MessageSquare} label="Mensajes" value={d.rangeMessages||0} sub={`${d.todayMessages||0} hoy`} growth={d.msgGrowth} color="text-emerald-400" spark={sparkMsgs}/>
        <KPI icon={Users} label="Nuevos Leads" value={d.rangeNewConvs||0} sub={`${d.totalConversations||0} total`} growth={d.convGrowth} color="text-blue-400" spark={sparkConvs}/>
        <KPI icon={Target} label="Convertidos" value={d.rangeConvertedConvs||0} sub={`${d.conversionRate||0}% tasa`} growth={d.convertedGrowth} color="text-emerald-400"/>
        <KPI icon={Timer} label="FRT Promedio" value={d.avgFRT ? `${d.avgFRT}m` : '—'} sub="Primera respuesta" color="text-amber-400"/>
        <KPI icon={Phone} label="Contacto" value={`${d.contactRate||0}%`} sub="Leads contactados" color="text-cyan-400"/>
        <KPI icon={Bot} label="IA Auto" value={`${d.aiAutoRate||0}%`} sub={`${d.aiPausedCount||0} pausas`} color="text-purple-400"/>
      </div>

      {/* ROW 2: 3 METRIC CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3"><ShieldCheck className="w-4 h-4 text-emerald-400"/><span className="text-xs font-semibold text-white">Eficiencia</span></div>
          <MetricRow label="SLA (< 5 min)" value={`${d.slaCompliance||0}%`} icon="⏱️" color={d.slaCompliance>=80?'text-emerald-400':d.slaCompliance>=50?'text-amber-400':'text-red-400'}/>
          <MetricRow label="Ciclo de Venta" value={d.avgCycleTime?`${d.avgCycleTime}d`:'—'} icon="📅" color="text-blue-400"/>
          <MetricRow label="Msgs/Conv" value={d.avgMsgsPerConv||0} icon="💬" color="text-cyan-400"/>
          <MetricRow label="Mayor espera" value={d.oldestWait||'0h'} icon="🔴" color="text-red-400"/>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-emerald-400"/><span className="text-xs font-semibold text-white">WhatsApp</span></div>
          <MetricRow label="Enviados" value={wStats.sent||0} icon="📤" color="text-emerald-400"/>
          <MetricRow label="Recibidos" value={wStats.received||0} icon="📥" color="text-blue-400"/>
          <MetricRow label="Total período" value={wStats.total||0} icon="📊" color="text-white"/>
          <MetricRow label="Ratio Env/Rec" value={wStats.received>0?(wStats.sent/wStats.received).toFixed(1):'—'} icon="⚖️" color="text-purple-400"/>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3"><AlertTriangle className="w-4 h-4 text-amber-400"/><span className="text-xs font-semibold text-white">Atención</span></div>
          <MetricRow label="En Riesgo (+48h)" value={d.atRiskConvs||0} icon="⚠️" color={d.atRiskConvs>10?'text-red-400':'text-amber-400'}/>
          <MetricRow label="IA Pausada" value={d.aiPausedCount||0} icon="⏸️" color="text-amber-400"/>
          <MetricRow label="Citas Pendientes" value={d.pendingAppointments||0} icon="📋" color="text-blue-400"/>
          <MetricRow label="Total Citas" value={d.totalAppointments||0} icon="📅" color="text-white"/>
        </div>
      </div>

      {/* ROW 3: CHART + PIPELINE */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="card p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-emerald-400"/><span className="text-xs font-semibold text-white">Actividad</span></div>
            <div className="flex items-center gap-4 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-emerald-400 rounded"/>Mensajes</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0 border-t-2 border-dashed border-purple-400"/>Conversaciones</span>
            </div>
          </div>
          <AreaChart data={chartData} height={200}/>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Target className="w-4 h-4 text-emerald-400"/><span className="text-xs font-semibold text-white">Pipeline</span></div>
            <Link href="/crm" className="text-[10px] text-[var(--accent-primary)] hover:underline flex items-center gap-0.5">CRM <ArrowUpRight className="w-3 h-3"/></Link>
          </div>
          <PipelineFunnel data={funnelData}/>
        </div>
      </div>

      {/* ROW 4: DISTRIBUTION + RECENT + TOP LEADS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3"><CheckCircle className="w-4 h-4 text-emerald-400"/><span className="text-xs font-semibold text-white">Distribución</span></div>
          {[{label:'Convertidos',val:dist.resolved||0,color:'#10b981'},{label:'Activos',val:dist.active||0,color:'#3b82f6'},{label:'Pendientes',val:dist.pending||0,color:'#eab308'},{label:'En Riesgo',val:dist.atRisk||0,color:'#ef4444'},{label:'Perdidos',val:dist.lost||0,color:'#6b7280'}].map(s => {
            const pct = (dist.total||0)>0?((s.val/dist.total)*100).toFixed(0):'0';
            return (<div key={s.label} className="mb-2">
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{backgroundColor:s.color}}/><span className="text-[var(--text-secondary)]">{s.label}</span></div>
                <span className="text-white font-medium">{s.val} <span className="text-[var(--text-muted)]">({pct}%)</span></span>
              </div>
              <div className="h-1 rounded-full bg-white/5 overflow-hidden"><div className="h-full rounded-full transition-all duration-700" style={{width:`${Math.max(Number(pct),2)}%`,backgroundColor:s.color,opacity:0.7}}/></div>
            </div>);
          })}
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3"><Zap className="w-4 h-4 text-amber-400"/><span className="text-xs font-semibold text-white">Actividad Reciente</span></div>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {recentActivity.length===0 && <p className="text-[var(--text-muted)] text-xs py-4 text-center">Sin actividad</p>}
            {recentActivity.slice(0,6).map((a:any,i:number) => (
              <div key={i} className="flex items-start gap-2 py-1.5 border-b border-white/5 last:border-0">
                <div className="w-6 h-6 rounded-full bg-[var(--accent-primary)]/15 flex items-center justify-center flex-shrink-0 mt-0.5"><span className="text-[9px] font-bold text-[var(--accent-primary)]">{(a.user||'?')[0]}</span></div>
                <div className="flex-1 min-w-0"><p className="text-[11px] text-white font-medium truncate">{a.user}</p><p className="text-[10px] text-[var(--text-muted)] truncate">{a.action}</p></div>
                <span className="text-[9px] text-[var(--text-muted)] flex-shrink-0">{timeAgo(a.time)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3"><TrendingUp className="w-4 h-4 text-blue-400"/><span className="text-xs font-semibold text-white">Top Leads</span></div>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {(d.topLeads||[]).length===0 && <p className="text-[var(--text-muted)] text-xs py-4 text-center">Sin leads</p>}
            {(d.topLeads||[]).map((l:any,i:number) => (
              <div key={l.id||i} className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0">
                <div className="w-6 h-6 rounded-full bg-blue-500/15 flex items-center justify-center flex-shrink-0"><span className="text-[9px] font-bold text-blue-400">{i+1}</span></div>
                <div className="flex-1 min-w-0"><p className="text-[11px] text-white font-medium truncate">{l.name}</p><p className="text-[10px] text-[var(--text-muted)]">{l.messages} msgs · {l.stage?.replace(/_/g,' ')}</p></div>
                <span className="text-[9px] text-[var(--text-muted)]">{timeAgo(l.lastActive)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center py-4">
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10">
          <img src="/bizonne.png" alt="Bizonne" className="w-6 h-6 rounded-lg"/>
          <span className="text-[10px] text-[var(--text-muted)]">Powered by <span className="text-white font-semibold">Bizonne</span></span>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Sparkles, Upload, FileText, ArrowLeft, RefreshCw, AlertTriangle,
  Wand2, Zap, Lock, ShoppingCart, Check, ChevronRight, Brain,
  CheckCircle, Loader2, Eye
} from 'lucide-react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const MODULES_DEF = [
  { key: 'modIdentidad',       emoji: '👤', label: 'identidad.md',            color: 'blue',    desc: 'Quién es el agente, personalidad y tono' },
  { key: 'modReglas',          emoji: '📋', label: 'reglas.md',                color: 'emerald', desc: 'Horarios, pagos, políticas del negocio' },
  { key: 'modProductos',       emoji: '🛍️', label: 'servicios.json',           color: 'amber',   desc: 'Catálogo completo con precios exactos' },
  { key: 'modAgenda',          emoji: '🗓️', label: 'agenda.json',              color: 'cyan',    desc: 'Disponibilidad, duración, tipos de cita' },
  { key: 'modFlujo',           emoji: '🔄', label: 'flujos.md',                color: 'purple',  desc: 'Conversación paso a paso hasta el cierre' },
  { key: 'modAcciones',        emoji: '⚡', label: 'acciones.json',            color: 'orange',  desc: 'MEMORY_JSON, etapas pipeline, acciones' },
  { key: 'modAdmin',           emoji: '🔧', label: 'admin.md',                 color: 'rose',    desc: 'Alertas, transferencias, análisis' },
  { key: 'modZonas',           emoji: '📍', label: 'zonas.json',               color: 'indigo',  desc: 'Zonas de cobertura y costos de envío' },
  { key: 'modMemoriaCliente',  emoji: '🧠', label: 'memoria_cliente.json',     color: 'sky',     desc: 'Estructura del MEMORY_JSON persistente' },
  { key: 'modMetricas',        emoji: '📊', label: 'metricas.md',              color: 'pink',    desc: 'KPIs, objetivos y alertas del negocio' },
  { key: 'modDetector',        emoji: '🎯', label: 'detector_intenciones.md',  color: 'fuchsia', desc: 'Intenciones reconocibles y respuestas rápidas' },
];

const AGENTS_DEF = [
  { key: 'agenteCliente', emoji: '🤖', label: 'Agente Cliente', color: 'violet', desc: 'Ventas, consultas y conversación con clientes' },
  { key: 'agenteAdmin',   emoji: '🔐', label: 'Agente Admin',   color: 'teal',   desc: 'Métricas, alertas y análisis para el dueño' },
];

const GENERATION_STEPS = [
  'Leyendo el PDF…',
  'Analizando tipo de negocio…',
  'Generando Módulo de Identidad…',
  'Generando Reglas y Políticas…',
  'Construyendo Catálogo de Productos…',
  'Configurando Agenda y Horarios…',
  'Diseñando Flujo Conversacional…',
  'Programando Acciones y Pipeline…',
  'Configurando Agentes IA…',
  'Ensamblando base de conocimiento…',
];

export default function AiConfigPage() {
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [assistant, setAssistant] = useState<any>(null);
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [generating, setGenerating] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [modules, setModules] = useState<Record<string, string>>({});
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');
  const [userPlan, setUserPlan] = useState('');
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(4200);
  const [stats, setStats] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const getToken = () => localStorage.getItem('token') || '';
  const getLineId = () => localStorage.getItem('selectedLineId') || '';

  useEffect(() => {
    checkAccess();
    fetchAssistant();
    fetchExchangeRate();
  }, []);

  const checkAccess = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/ai-config/status`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      const data = await res.json();
      setHasAccess(data.hasAccess || false);
      setUserPlan(data.plan || '');
    } catch {} finally { setLoading(false); }
  };

  const fetchAssistant = async () => {
    try {
      const lineId = getLineId();
      const url = lineId ? `${API_URL}/api/assistants?lineId=${lineId}` : `${API_URL}/api/assistants`;
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${getToken()}` } });
      if (res.ok) {
        const data = await res.json();
        const a = data.assistant || null;
        setAssistant(a);
        if (a?.name) setBusinessName(a.name);
      }
    } catch {}
  };

  const fetchExchangeRate = async () => {
    try {
      const res = await fetch(`${API_URL}/api/subscription/exchange-rate`);
      if (res.ok) { const d = await res.json(); if (d.rate) setExchangeRate(d.rate); }
    } catch {}
  };

  const handlePurchase = async () => {
    setPurchaseLoading(true); setError('');
    try {
      const res = await fetch(`${API_URL}/api/subscription/pay`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'ai_config', period: 'one_time' })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error al procesar pago'); return; }
      if (data.publicKey && data.amountInCents) {
        const checkout = new (window as any).WidgetCheckout({
          currency: 'COP', amountInCents: data.amountInCents,
          reference: data.reference, publicKey: data.publicKey,
          signature: { integrity: data.signature },
          redirectUrl: `${window.location.origin}/ai-config?payment=pending`,
          customerData: { email: data.customerEmail, fullName: data.customerName }
        });
        checkout.open((result: any) => {
          if (result?.transaction?.status === 'APPROVED') setHasAccess(true);
        });
      }
    } catch (e: any) { setError(e.message); }
    finally { setPurchaseLoading(false); }
  };

  const handleGenerate = async () => {
    if (!pdfFile && !businessName) { setError('Sube un PDF o escribe el nombre de tu negocio'); return; }
    setGenerating(true); setError(''); setModules({}); setApplied(false); setStats(null); setStepIdx(0);

    const interval = setInterval(() => setStepIdx(i => Math.min(i + 1, GENERATION_STEPS.length - 1)), 4000);

    try {
      const formData = new FormData();
      formData.append('lineId', getLineId());
      if (businessName) formData.append('businessName', businessName);
      if (businessType) formData.append('businessType', businessType);
      if (pdfFile) formData.append('pdf', pdfFile);

      const res = await fetch(`${API_URL}/api/ai-config/generate-modules`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error al generar'); return; }
      setModules(data.modules || {});
      setStats(data.stats || null);
      if (data.assistantId) setAssistant((prev: any) => ({ ...(prev || {}), id: data.assistantId }));
    } catch (e: any) { setError(e.message); }
    finally { clearInterval(interval); setGenerating(false); }
  };

  const handleApply = async () => {
    if (!Object.keys(modules).length) return;
    setApplying(true); setError('');
    try {
      const res = await fetch(`${API_URL}/api/ai-config/apply-modules`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistantId: assistant?.id || '', lineId: getLineId(), modules, businessName })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error al aplicar'); return; }
      setApplied(true);
      if (data.assistantId) setAssistant((prev: any) => ({ ...(prev || {}), id: data.assistantId }));
    } catch (e: any) { setError(e.message); }
    finally { setApplying(false); }
  };

  const hasModules = Object.keys(modules).length >= 9;
  const formatCOP = (n: number) => n.toLocaleString('es-CO');

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="loading-spinner w-8 h-8" />
    </div>
  );

  // ── PAYWALL ──────────────────────────────────────────────────────
  if (!hasAccess) return (
    <div className="max-w-2xl mx-auto p-6">
      <Link href="/asistentes" className="text-sm text-[var(--text-muted)] hover:text-white flex items-center gap-1 mb-6">
        <ArrowLeft className="w-4 h-4" /> Volver a Asistentes
      </Link>
      <div className="card-dark rounded-2xl overflow-hidden">
        <div className="p-8 bg-gradient-to-br from-violet-600/20 to-pink-600/20 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center mb-4">
            <Wand2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Configuración IA</h1>
          <p className="text-[var(--text-muted)] mt-2 max-w-md mx-auto">
            Sube el PDF de tu negocio y la IA genera los <strong className="text-white">7 módulos especializados</strong> + 2 agentes listos para vender
          </p>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {['🧠 11 módulos especializados','🤖 2 agentes: Cliente + Admin','📍 Zonas y cobertura','🎯 Detector de intenciones','🧠 Memoria cliente estructurada','📊 Métricas y KPIs','🔄 Flujo conversacional completo','♻️ Regenera ilimitado'].map((f, i) => (
              <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-white/3 text-xs text-white/70">{f}</div>
            ))}
          </div>
          <div className="text-center p-4 rounded-xl bg-white/3">
            <div className="text-3xl font-black text-violet-400">$20 USD</div>
            <div className="text-sm text-gray-500">≈ {formatCOP(Math.round(20 * exchangeRate))} COP · Pago único</div>
          </div>
          {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20"><p className="text-xs text-red-300">{error}</p></div>}
          {userPlan === 'trial' ? (
            <div className="text-center">
              <p className="text-sm text-orange-300 mb-3">⚡ Necesitas un plan activo para comprar</p>
              <Link href="/subscription" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-orange-600 text-white font-bold hover:bg-orange-700">
                <Zap className="w-4 h-4" /> Ver Planes
              </Link>
            </div>
          ) : (
            <button onClick={handlePurchase} disabled={purchaseLoading}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-700 hover:to-pink-700 text-white font-bold text-sm flex items-center justify-center gap-2">
              {purchaseLoading ? <><RefreshCw className="w-4 h-4 animate-spin" /> Procesando…</> : <><ShoppingCart className="w-4 h-4" /> Comprar — $20 USD</>}
            </button>
          )}
        </div>
      </div>
      <script src="https://checkout.wompi.co/widget.js" async />
    </div>
  );

  // ── MAIN ──────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Wand2 className="w-6 h-6 text-violet-400" /> Configuración IA
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">Sube el PDF de tu negocio → 11 módulos + 2 agentes generados automáticamente</p>
        </div>
        <Link href="/asistentes" className="text-sm text-[var(--text-muted)] hover:text-white flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Ir a Asistentes
        </Link>
      </div>

      {/* Arquitectura 3 ramas */}
      <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-[#060b18] p-5">
        <div className="absolute inset-0" style={{backgroundImage:'radial-gradient(ellipse at 50% 100%, rgba(99,102,241,0.06) 0%, transparent 70%)'}}/> 
        <div className="relative">
          {/* Orquestador */}
          <div className="flex justify-center mb-4">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500/15 border border-violet-500/25 text-violet-200 text-xs font-bold">
              <Brain className="w-3.5 h-3.5" /> ORQUESTADOR
            </div>
          </div>
          {/* 3 columnas */}
          <div className="grid grid-cols-3 gap-3">
            {/* AGENTE_CLIENTE */}
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
              <div className="flex items-center gap-1.5 mb-2.5">
                <span className="text-sm">🤖</span>
                <span className="text-[11px] font-bold text-blue-300">AGENTE_CLIENTE</span>
                {modules['agenteCliente'] && <span className="ml-auto text-[9px] text-emerald-400">✓</span>}
              </div>
              <div className="space-y-1">
                {['ventas','reservas','agenda'].map(s => (
                  <div key={s} className="flex items-center gap-1.5 text-[10px] text-white/35">
                    <div className="w-1 h-1 rounded-full bg-blue-500/50 flex-shrink-0" />{s}
                  </div>
                ))}
              </div>
            </div>
            {/* AGENTE_ADMIN */}
            <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-3">
              <div className="flex items-center gap-1.5 mb-2.5">
                <span className="text-sm">🔐</span>
                <span className="text-[11px] font-bold text-teal-300">AGENTE_ADMIN</span>
                {modules['agenteAdmin'] && <span className="ml-auto text-[9px] text-emerald-400">✓</span>}
              </div>
              <div className="space-y-1">
                {['análisis','métricas','campañas'].map(s => (
                  <div key={s} className="flex items-center gap-1.5 text-[10px] text-white/35">
                    <div className="w-1 h-1 rounded-full bg-teal-500/50 flex-shrink-0" />{s}
                  </div>
                ))}
              </div>
            </div>
            {/* CONFIG NEGOCIO */}
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
              <div className="flex items-center gap-1.5 mb-2.5">
                <span className="text-sm">⚙️</span>
                <span className="text-[11px] font-bold text-violet-300">CONFIG NEGOCIO</span>
              </div>
              <div className="space-y-0.5">
                {MODULES_DEF.map((m, i) => (
                  <div key={m.key} className="flex items-center gap-1.5 text-[10px] text-white/35">
                    <div className={`w-1 h-1 rounded-full flex-shrink-0 ${modules[m.key] ? 'bg-emerald-400' : 'bg-white/15'}`} />
                    <span className="text-white/20">{i+1}</span> {m.emoji} {m.label}
                    {modules[m.key] && <span className="ml-auto text-[8px] text-emerald-400">✓</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Upload form */}
      <div className="card-dark rounded-2xl p-5 space-y-4">

        {/* Assistant badge */}
        <div className="p-3 rounded-xl bg-white/3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center flex-shrink-0">
            <Wand2 className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">{assistant?.name || 'Nuevo Asistente'}</p>
            <p className="text-[10px] text-[var(--text-muted)]">{assistant ? 'Se actualizarán los 7 módulos del asistente' : 'Se creará el asistente con 7 módulos + 2 agentes'}</p>
          </div>
          {assistant && <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">Conectado</span>}
        </div>

        {/* Fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-white mb-1.5">Nombre del negocio</label>
            <input type="text" value={businessName} onChange={e => setBusinessName(e.target.value)}
              placeholder="Ej: The Four Hoodies"
              className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-white mb-1.5">Tipo de negocio</label>
            <input type="text" value={businessType} onChange={e => setBusinessType(e.target.value)}
              placeholder="Ej: Tienda de ropa online"
              className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500" />
          </div>
        </div>

        {/* PDF drop */}
        <div>
          <label className="block text-xs font-semibold text-white mb-1.5">
            📄 PDF con info del negocio
            <span className="ml-2 text-[var(--text-muted)] font-normal">— precios, productos, horarios, políticas, flujo</span>
          </label>
          <div onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${pdfFile ? 'border-violet-500/50 bg-violet-500/5' : 'border-white/10 hover:border-violet-500/30 hover:bg-white/2'}`}>
            <input ref={fileRef} type="file" accept=".pdf" className="hidden"
              onChange={e => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]); }} />
            {pdfFile ? (
              <div className="flex items-center justify-center gap-3">
                <FileText className="w-8 h-8 text-violet-400" />
                <div className="text-left">
                  <p className="text-sm font-semibold text-white">{pdfFile.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{(pdfFile.size / 1024).toFixed(0)} KB</p>
                </div>
                <button onClick={e => { e.stopPropagation(); setPdfFile(null); }} className="text-xs text-red-400 hover:text-red-300 ml-2">✕</button>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 text-gray-500 mx-auto mb-2" />
                <p className="text-sm text-[var(--text-muted)]">Click para subir PDF — portafolio, catálogo, info de negocio</p>
                <p className="text-[10px] text-gray-600 mt-1">Máx 15MB · Opcional — también puedes generar solo con el nombre</p>
              </>
            )}
          </div>
        </div>

        {/* Module grid preview */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {[...MODULES_DEF, ...AGENTS_DEF].map(m => (
            <div key={m.key} className={`flex flex-col items-center p-2.5 rounded-xl text-center transition-all ${modules[m.key] ? `bg-emerald-500/10 border border-emerald-500/20` : 'bg-white/3 border border-transparent'}`}>
              <span className="text-lg mb-0.5">{m.emoji}</span>
              <span className={`text-[9px] font-bold ${modules[m.key] ? 'text-emerald-300' : 'text-white/40'}`}>{m.label}</span>
              {modules[m.key] && <span className="text-[8px] text-emerald-400 mt-0.5">✓</span>}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        {/* Generate CTA */}
        <button onClick={handleGenerate} disabled={generating || (!pdfFile && !businessName)}
          className="w-full py-4 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-700 hover:to-pink-700 disabled:opacity-30 text-white font-bold flex items-center justify-center gap-2">
          {generating
            ? <><Loader2 className="w-5 h-5 animate-spin" />{GENERATION_STEPS[stepIdx]}</>
            : <><Sparkles className="w-5 h-5" /> Generar 11 Módulos con IA</>}
        </button>

        {generating && (
          <div className="space-y-2">
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-violet-500 to-pink-500 rounded-full transition-all duration-1000"
                style={{ width: `${((stepIdx + 1) / GENERATION_STEPS.length) * 100}%` }} />
            </div>
            <p className="text-center text-[10px] text-[var(--text-muted)]">Usando GPT-4o — 30–60 segundos para máxima calidad</p>
          </div>
        )}
      </div>

      {/* ── MÓDULOS GENERADOS ── */}
      {hasModules && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                Base de conocimiento generada
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Revisa y edita cada módulo · haz clic para expandir
                {stats && <span className="ml-2 text-violet-400">· {stats.tokensUsed?.toLocaleString()} tokens GPT-4o</span>}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={handleGenerate} disabled={generating}
                className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[var(--text-muted)] text-sm hover:bg-white/10 flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Regenerar
              </button>
              <button onClick={handleApply} disabled={applying || applied}
                className={`px-5 py-2 rounded-xl font-bold text-sm flex items-center gap-1.5 ${applied ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 text-white'}`}>
                {applying ? <><Loader2 className="w-4 h-4 animate-spin" /> Aplicando…</>
                  : applied ? <><Check className="w-4 h-4" /> Aplicado</>
                  : <><Zap className="w-4 h-4" /> Aplicar al Asistente</>}
              </button>
            </div>
          </div>

          {/* Módulos */}
          <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest px-1">🧩 7 Módulos de Configuración</p>
          {MODULES_DEF.map((mod, idx) => {
            const val = modules[mod.key] || '';
            const isOpen = activePreview === mod.key;
            return (
              <div key={mod.key} className={`rounded-2xl border overflow-hidden transition-all ${isOpen ? 'border-white/15 shadow-lg' : 'border-white/8 hover:border-white/12'}`}>
                <button className="w-full flex items-center gap-3 p-4 text-left" onClick={() => setActivePreview(isOpen ? null : mod.key)}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 bg-white/5`}>{mod.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white">Módulo {idx + 1} — {mod.label}</span>
                      {val && <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">✓ {val.split('\n').length} líneas</span>}
                    </div>
                    <p className="text-xs text-white/40 mt-0.5 truncate">
                      {val ? (val.split('\n').find(l => l.trim() && !l.startsWith('#')) || mod.desc) : mod.desc}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] text-white/25 hidden sm:block">{val.length} chars</span>
                    <ChevronRight className={`w-4 h-4 text-white/30 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-white/5 bg-black/20">
                    <textarea value={val}
                      onChange={e => setModules(prev => ({ ...prev, [mod.key]: e.target.value }))}
                      className="w-full min-h-[320px] p-4 bg-transparent text-white/85 text-xs font-mono resize-none focus:outline-none leading-relaxed"
                      placeholder={`Contenido del módulo ${mod.label}…`} />
                  </div>
                )}
              </div>
            );
          })}

          {/* Agentes */}
          <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest px-1 pt-2">🧠 2 Agentes IA</p>
          {AGENTS_DEF.map(agent => {
            const val = modules[agent.key] || '';
            const isOpen = activePreview === agent.key;
            return (
              <div key={agent.key} className={`rounded-2xl border overflow-hidden transition-all ${isOpen ? 'border-white/15 shadow-lg' : 'border-white/8 hover:border-white/12'}`}>
                <button className="w-full flex items-center gap-3 p-4 text-left" onClick={() => setActivePreview(isOpen ? null : agent.key)}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 bg-white/5">{agent.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{agent.label}</span>
                      {val && <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">✓ Configurado</span>}
                    </div>
                    <p className="text-xs text-white/40 mt-0.5">{agent.desc}</p>
                  </div>
                  <ChevronRight className={`w-4 h-4 text-white/30 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                </button>
                {isOpen && (
                  <div className="border-t border-white/5 bg-black/20">
                    <textarea value={val}
                      onChange={e => setModules(prev => ({ ...prev, [agent.key]: e.target.value }))}
                      className="w-full min-h-[220px] p-4 bg-transparent text-white/85 text-xs font-mono resize-none focus:outline-none leading-relaxed"
                      placeholder={`Instrucciones del ${agent.label}…`} />
                  </div>
                )}
              </div>
            );
          })}

          {/* Apply CTA */}
          {!applied ? (
            <div className="flex gap-3 pt-2">
              <button onClick={handleApply} disabled={applying}
                className="flex-1 py-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 text-white font-bold flex items-center justify-center gap-2">
                {applying
                  ? <><Loader2 className="w-5 h-5 animate-spin" /> Aplicando los {Object.keys(modules).length} módulos…</>
                  : <><Zap className="w-5 h-5" /> Aplicar al Asistente — {Object.keys(modules).length} módulos</>}
              </button>
              <button onClick={handleGenerate} disabled={generating}
                className="px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-[var(--text-muted)] hover:bg-white/10 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Regenerar
              </button>
            </div>
          ) : (
            <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center mx-auto">
                <CheckCircle className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <p className="text-base font-bold text-emerald-300">✅ Base de conocimiento modular aplicada</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">11 módulos + 2 agentes guardados — el asistente ya está activo</p>
              </div>
              <Link href="/asistentes"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold">
                <Eye className="w-4 h-4" /> Ver y editar módulos en el Asistente →
              </Link>
            </div>
          )}
        </div>
      )}

      <script src="https://checkout.wompi.co/widget.js" async />
    </div>
  );
}

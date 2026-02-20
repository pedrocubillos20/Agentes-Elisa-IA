'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Sparkles, Upload, FileText, Code, Eye, Check, ArrowLeft,
  RefreshCw, AlertTriangle, Wand2, Copy, Zap, Lock, ShoppingCart
} from 'lucide-react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function AiConfigPage() {
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [assistant, setAssistant] = useState<any>(null);
  const [format, setFormat] = useState<'markdown' | 'json'>('markdown');
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState('');
  const [stats, setStats] = useState<any>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');
  const [userPlan, setUserPlan] = useState('');
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(4200);
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
          currency: 'COP',
          amountInCents: data.amountInCents,
          reference: data.reference,
          publicKey: data.publicKey,
          signature: { integrity: data.signature },
          redirectUrl: `${window.location.origin}/ai-config?payment=pending`,
          customerData: { email: data.customerEmail, fullName: data.customerName }
        });
        checkout.open((result: any) => {
          if (result?.transaction?.status === 'APPROVED') {
            setHasAccess(true);
          }
        });
      }
    } catch (e: any) { setError(e.message); }
    finally { setPurchaseLoading(false); }
  };

  const handleGenerate = async () => {
    if (!businessName && !pdfFile) { setError('Sube un PDF o escribe el nombre de tu negocio'); return; }
    setGenerating(true); setError(''); setGenerated(''); setApplied(false);
    try {
      const formData = new FormData();
      formData.append('assistantId', assistant?.id || '');
      formData.append('format', format);
      formData.append('lineId', getLineId());
      if (businessName) formData.append('businessName', businessName);
      if (businessType) formData.append('businessType', businessType);
      if (pdfFile) formData.append('pdf', pdfFile);
      const res = await fetch(`${API_URL}/api/ai-config/generate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error al generar'); return; }
      setGenerated(data.content || '');
      setStats(data.stats || null);
      if (data.assistantId) setAssistant((prev: any) => ({ ...(prev || {}), id: data.assistantId }));
    } catch (e: any) { setError(e.message); }
    finally { setGenerating(false); }
  };

  const handleApply = async () => {
    if (!generated) return;
    setApplying(true);
    try {
      const res = await fetch(`${API_URL}/api/ai-config/apply`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistantId: assistant?.id || '', lineId: getLineId(), content: generated, businessName })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error al aplicar'); return; }
      setApplied(true);
      if (data.assistantId) setAssistant((prev: any) => ({ ...(prev || {}), id: data.assistantId }));
    } catch (e: any) { setError(e.message); }
    finally { setApplying(false); }
  };

  const copyToClipboard = () => { navigator.clipboard.writeText(generated); };
  const formatCOP = (n: number) => n.toLocaleString('es-CO');

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><div className="loading-spinner w-8 h-8" /></div>;

  if (!hasAccess) return (
    <div className="max-w-2xl mx-auto p-6">
      <Link href="/asistentes" className="text-sm text-[var(--text-muted)] hover:text-white flex items-center gap-1 mb-6"><ArrowLeft className="w-4 h-4" /> Volver a Asistentes</Link>
      <div className="card-dark rounded-2xl overflow-hidden">
        <div className="p-8 bg-gradient-to-br from-violet-600/20 to-pink-600/20 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center mb-4"><Wand2 className="w-8 h-8 text-white" /></div>
          <h1 className="text-2xl font-bold text-white">Configuración IA</h1>
          <p className="text-[var(--text-muted)] mt-2 max-w-md mx-auto">Sube un PDF con la info de tu negocio y la IA creará automáticamente tu base de conocimiento completa</p>
        </div>
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {['📄 Lee tu PDF completo', '🤖 Genera MD o JSON', '📋 Crea etapas pipeline', '🎬 Integra triggers multimedia', '❓ Genera FAQ completo', '💬 Flujo conversacional', '⚡ Aplica con 1 click', '♻️ Regenera ilimitado'].map((f, i) => (
              <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-white/3"><span className="text-xs">{f}</span></div>
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
              <Link href="/subscription" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-orange-600 text-white font-bold hover:bg-orange-700"><Zap className="w-4 h-4" /> Ver Planes</Link>
            </div>
          ) : (
            <button onClick={handlePurchase} disabled={purchaseLoading} className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-700 hover:to-pink-700 text-white font-bold text-sm flex items-center justify-center gap-2">
              {purchaseLoading ? <><RefreshCw className="w-4 h-4 animate-spin" /> Procesando...</> : <><ShoppingCart className="w-4 h-4" /> Comprar — $20 USD</>}
            </button>
          )}
        </div>
      </div>
      <script src="https://checkout.wompi.co/widget.js" async />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Wand2 className="w-6 h-6 text-violet-400" /> Configuración IA</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Sube un PDF y la IA crea tu base de conocimiento</p>
        </div>
        <Link href="/asistentes" className="text-sm text-[var(--text-muted)] hover:text-white flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Ir a Asistentes</Link>
      </div>

      <div className="card-dark rounded-2xl p-5 space-y-5">
        <div className="p-3 rounded-xl bg-white/3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center"><Wand2 className="w-5 h-5 text-white" /></div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">{assistant?.name || 'Nuevo Asistente'}</p>
            <p className="text-[10px] text-[var(--text-muted)]">{assistant ? 'Se actualizará la base de conocimiento' : 'Se creará un asistente nuevo automáticamente'}</p>
          </div>
          {assistant && <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">Conectado</span>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-white mb-2">Nombre del negocio</label>
            <input type="text" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Ej: The Four Hoodies" className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-white mb-2">Tipo de negocio</label>
            <input type="text" value={businessType} onChange={e => setBusinessType(e.target.value)} placeholder="Ej: Tienda de ropa online" className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-white mb-2">📄 Sube el PDF con la info de tu negocio</label>
          <div onClick={() => fileRef.current?.click()} className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${pdfFile ? 'border-violet-500/50 bg-violet-500/5' : 'border-white/10 hover:border-white/20 bg-white/2'}`}>
            <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={e => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]); }} />
            {pdfFile ? (
              <div className="flex items-center justify-center gap-3">
                <FileText className="w-8 h-8 text-violet-400" />
                <div className="text-left">
                  <p className="text-sm font-semibold text-white">{pdfFile.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{(pdfFile.size / 1024).toFixed(0)} KB</p>
                </div>
                <button onClick={e => { e.stopPropagation(); setPdfFile(null); }} className="text-xs text-red-400 hover:text-red-300 ml-2">✕ Quitar</button>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 text-gray-500 mx-auto mb-2" />
                <p className="text-sm text-[var(--text-muted)]">Click para subir PDF (catálogo, info de negocio, productos)</p>
                <p className="text-[10px] text-gray-600 mt-1">Máximo 15MB · También puedes generar solo con el nombre</p>
              </>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-white mb-2">Formato de salida</label>
          <div className="flex gap-3">
            <button onClick={() => setFormat('markdown')} className={`flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 ${format === 'markdown' ? 'bg-violet-600 text-white' : 'bg-white/5 text-[var(--text-muted)]'}`}><FileText className="w-4 h-4" /> Markdown</button>
            <button onClick={() => setFormat('json')} className={`flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 ${format === 'json' ? 'bg-violet-600 text-white' : 'bg-white/5 text-[var(--text-muted)]'}`}><Code className="w-4 h-4" /> JSON</button>
          </div>
        </div>

        {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-red-400 mt-0.5" /><p className="text-xs text-red-300">{error}</p></div>}

        <button onClick={handleGenerate} disabled={generating || (!pdfFile && !businessName)} className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-700 hover:to-pink-700 disabled:opacity-30 text-white font-bold text-sm flex items-center justify-center gap-2">
          {generating ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generando con IA... (30-60 seg)</> : <><Sparkles className="w-4 h-4" /> Generar Base de Conocimiento</>}
        </button>
      </div>

      {generated && (
        <div className="card-dark rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Eye className="w-5 h-5 text-emerald-400" /> Vista Previa</h3>
            <div className="flex items-center gap-2">
              {stats && <span className="text-[10px] text-[var(--text-muted)]">{stats.outputChars.toLocaleString()} chars · {stats.mediaItemsDetected} multimedia</span>}
              <button onClick={copyToClipboard} className="px-3 py-1.5 rounded-lg bg-white/5 text-xs text-[var(--text-muted)] hover:bg-white/10 flex items-center gap-1"><Copy className="w-3 h-3" /> Copiar</button>
            </div>
          </div>
          <div className="max-h-[500px] overflow-y-auto rounded-xl bg-black/30 border border-white/5 p-4">
            <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">{generated}</pre>
          </div>
          <div className="flex gap-3">
            <button onClick={handleApply} disabled={applying || applied} className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 ${applied ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}>
              {applying ? <><RefreshCw className="w-4 h-4 animate-spin" /> Aplicando...</> : applied ? <><Check className="w-4 h-4" /> ✅ Aplicado</> : <><Zap className="w-4 h-4" /> Aplicar al Asistente</>}
            </button>
            <button onClick={handleGenerate} disabled={generating} className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-[var(--text-muted)] text-sm hover:bg-white/10 flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Regenerar</button>
          </div>
          {applied && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
              <p className="text-sm text-emerald-400 font-semibold">✅ Base de conocimiento guardada</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Etapas del pipeline configuradas automáticamente</p>
              <Link href="/asistentes" className="inline-block mt-2 text-xs text-emerald-400 underline">Ver mi asistente →</Link>
            </div>
          )}
        </div>
      )}
      <script src="https://checkout.wompi.co/widget.js" async />
    </div>
  );
}

'use client';
import React from 'react';

import { useState, useEffect, useRef } from 'react';
import { 
  Bot, Save, Play, Pause, Upload, Image, Video, Music, FileText, 
  Sparkles, Brain, MessageSquare, Settings, Trash2, Plus, X, 
  ChevronDown, ChevronUp, Volume2, Key, RefreshCw, CheckCircle,
  AlertCircle, Eye, Code, FileJson, Mic, Zap, TrendingUp, Loader2, Check, XCircle, Wand2,
  Package, Calendar, GitBranch, Shield, ChevronRight
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ═══════════════════════════════════════════════════════
// 🔀 FLUJO IA — Editor visual bidireccional
// Lee módulos → genera pasos editables → guarda de vuelta
// Genérico para cualquier negocio en el Sistema Modular IA
// ═══════════════════════════════════════════════════════

type FlowStep = {
  id: string;
  num: string;
  titulo: string;
  descripcion: string;
  color: string;
  tipo: 'accion' | 'dato' | 'cierre' | 'decision' | 'alerta';
  botones?: string[];
  regla?: string;
};

type FlowDecision = {
  id: string;
  pregunta: string;
  despues_del_paso: string;
  opciones: { label: string; va_a_paso: string; color: string }[];
};

type FlowData = {
  negocio: string;
  objetivo: string;
  pasos: FlowStep[];
  decisiones: FlowDecision[];
  alertas: { texto: string }[];
  rutas_especiales: { emoji: string; nombre: string; desc: string }[];
  multimedia?: { tipo: string; nombre: string; keywords: string; descripcion: string }[];
};

const STEP_COLORS = [
  { color: '#10b981', label: 'Verde — Acción', border: 'border-emerald-500', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  { color: '#3b82f6', label: 'Azul — Dato', border: 'border-blue-500', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  { color: '#ef4444', label: 'Rojo — Cierre/Pago', border: 'border-red-500', bg: 'bg-red-500/10', text: 'text-red-400' },
  { color: '#7c3aed', label: 'Violeta — Decisión', border: 'border-violet-500', bg: 'bg-violet-500/10', text: 'text-violet-400' },
  { color: '#f59e0b', label: 'Amarillo — Alerta', border: 'border-amber-500', bg: 'bg-amber-500/10', text: 'text-amber-400' },
];

function getStyle(color: string) {
  return STEP_COLORS.find(c => c.color === color) || STEP_COLORS[0];
}

function FlowTab({ modOrquestador, modFlujo, modReglas, modIdentidad, modAcciones, modMemoria, agenteCliente, modBotones, onUpdateModFlujo }: {
  modOrquestador?: string; modFlujo?: string; modReglas?: string; modIdentidad?: string;
  modAcciones?: string; modMemoria?: string; agenteCliente?: string; modBotones?: string;
  onUpdateModFlujo?: (val: string) => void;
}) {
  const [flowData, setFlowData] = useState<FlowData | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [editingStep, setEditingStep] = useState<FlowStep | null>(null);
  const [editingAlert, setEditingAlert] = useState<string | null>(null);
  const [addingStep, setAddingStep] = useState(false);
  const [lastSaved, setLastSaved] = useState('');

  const hasKnowledge = !!(modFlujo || modOrquestador || agenteCliente || modReglas);

  // ── Analizar módulos con Claude y generar flujo estructurado ──
  const analyzeAndGenerate = async () => {
    setAnalyzing(true);
    setMsg('');
    try {
      const token = localStorage.getItem('token');
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const res = await fetch(`${API_URL}/api/assistants/generate-flow`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      const parsed: FlowData = data.flow;
      setFlowData(parsed);
    } catch (e: any) {
      setMsg(e.message || 'Error al analizar. Verifica que tienes módulos y API Key configurados.');
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Guardar flujo de vuelta al módulo 06_flujos ──
  const saveFlowToModule = () => {
    if (!flowData || !onUpdateModFlujo) return;
    setSaving(true);
    try {
      // Serializar el flowData como markdown estructurado para modFlujo
      const lines: string[] = [];
      lines.push(`# FLUJO DE CONVERSACIÓN — ${flowData.negocio}`);
      lines.push(`## Objetivo: ${flowData.objetivo}`);
      lines.push('');
      flowData.pasos.forEach(p => {
        lines.push(`## PASO ${p.num} — ${p.titulo}`);
        lines.push(p.descripcion);
        if (p.botones && p.botones.length > 0) {
          lines.push(`⚡ BOTONES: [${p.botones.join(' | ')}]`);
        }
        if (p.regla) lines.push(`⚠️ REGLA: ${p.regla}`);
        lines.push('');
      });
      if (flowData.alertas?.length) {
        lines.push('## REGLAS CRÍTICAS');
        flowData.alertas.forEach(a => lines.push(`🚨 ${a.texto}`));
        lines.push('');
      }
      if (flowData.rutas_especiales?.length) {
        lines.push('## RUTAS ESPECIALES');
        flowData.rutas_especiales.forEach(r => lines.push(`${r.emoji} ${r.nombre}: ${r.desc}`));
      }
      const markdown = lines.join('\n');
      onUpdateModFlujo(markdown);
      setLastSaved(new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }));
      setMsg('✅ Flujo guardado en el módulo 06_flujos. Haz clic en "Guardar Todo" para persistir.');
      setTimeout(() => setMsg(''), 4000);
    } finally {
      setSaving(false);
    }
  };

  // ── Editar paso ──
  const updateStep = (updated: FlowStep) => {
    if (!flowData) return;
    setFlowData({ ...flowData, pasos: flowData.pasos.map(p => p.id === updated.id ? updated : p) });
    setEditingStep(null);
  };

  const deleteStep = (id: string) => {
    if (!flowData) return;
    setFlowData({ ...flowData, pasos: flowData.pasos.filter(p => p.id !== id) });
  };

  const addStep = (step: Omit<FlowStep, 'id'>) => {
    if (!flowData) return;
    const newId = `p${Date.now()}`;
    const newNum = String(flowData.pasos.length + 1);
    setFlowData({ ...flowData, pasos: [...flowData.pasos, { ...step, id: newId, num: step.num || newNum }] });
    setAddingStep(false);
  };

  const moveStep = (id: string, dir: 'up' | 'down') => {
    if (!flowData) return;
    const idx = flowData.pasos.findIndex(p => p.id === id);
    if (dir === 'up' && idx === 0) return;
    if (dir === 'down' && idx === flowData.pasos.length - 1) return;
    const newPasos = [...flowData.pasos];
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    [newPasos[idx], newPasos[swap]] = [newPasos[swap], newPasos[idx]];
    // Renumber
    newPasos.forEach((p, i) => { p.num = String(i + 1); });
    setFlowData({ ...flowData, pasos: newPasos });
  };

  const updateAlert = (idx: number, texto: string) => {
    if (!flowData) return;
    const newAlerts = [...flowData.alertas];
    newAlerts[idx] = { texto };
    setFlowData({ ...flowData, alertas: newAlerts });
    setEditingAlert(null);
  };

  const deleteAlert = (idx: number) => {
    if (!flowData) return;
    setFlowData({ ...flowData, alertas: flowData.alertas.filter((_, i) => i !== idx) });
  };

  const addAlert = () => {
    if (!flowData) return;
    setFlowData({ ...flowData, alertas: [...(flowData.alertas || []), { texto: 'Nueva regla crítica' }] });
  };

  return (
    <div className="space-y-4">
      {/* Header toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <GitBranch className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">
              {flowData ? flowData.negocio : 'Editor de Flujo IA'}
            </h2>
            <p className="text-xs text-white/35">
              {flowData ? flowData.objetivo : 'Visualiza y edita el flujo de tu asistente'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lastSaved && <span className="text-[10px] text-white/30">Guardado {lastSaved}</span>}
          {flowData && onUpdateModFlujo && (
            <button onClick={saveFlowToModule} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 transition-all">
              <Check className="w-3.5 h-3.5" />
              {saving ? 'Guardando...' : 'Guardar en módulo'}
            </button>
          )}
          <button onClick={analyzeAndGenerate} disabled={analyzing || !hasKnowledge}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-xs font-semibold hover:from-violet-700 hover:to-indigo-700 disabled:opacity-50 transition-all">
            {analyzing
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Analizando...</>
              : <><Sparkles className="w-3.5 h-3.5" />{flowData ? 'Re-analizar' : 'Generar desde módulos'}</>}
          </button>
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div className={`p-3 rounded-xl text-xs font-medium ${msg.startsWith('✅') ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border border-red-500/30 text-red-300'}`}>
          {msg}
        </div>
      )}

      {/* Empty — no knowledge */}
      {!hasKnowledge && !analyzing && (
        <div className="card p-10 text-center space-y-3">
          <GitBranch className="w-10 h-10 text-violet-400/50 mx-auto" />
          <h3 className="text-sm font-semibold text-white">Configura la Base IA primero</h3>
          <p className="text-xs text-white/40 max-w-xs mx-auto">
            Agrega contenido a los módulos en la pestaña "Base IA" para generar el diagrama del flujo.
          </p>
        </div>
      )}

      {/* Loading */}
      {analyzing && (
        <div className="card p-8 text-center space-y-4">
          <Loader2 className="w-8 h-8 text-violet-400 animate-spin mx-auto" />
          <p className="text-sm text-white/60">Analizando tu base de conocimiento...</p>
          <p className="text-xs text-white/30">La IA está leyendo tus módulos y construyendo el flujo</p>
        </div>
      )}

      {/* Prompt to generate */}
      {hasKnowledge && !flowData && !analyzing && (
        <div className="card p-10 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 flex items-center justify-center mx-auto">
            <GitBranch className="w-8 h-8 text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Módulos detectados</h3>
            <p className="text-xs text-white/40 max-w-sm mx-auto">
              Haz clic en "Generar desde módulos" y la IA analizará tu base de conocimiento para crear el diagrama de flujo editable.
            </p>
          </div>
          <button onClick={analyzeAndGenerate}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold hover:opacity-90 transition-all">
            <Sparkles className="w-4 h-4" />Generar Flujo IA
          </button>
        </div>
      )}

      {/* ══ EDITOR VISUAL ══ */}
      {flowData && !analyzing && (
        <div className="space-y-4">

          {/* Info negocio editable */}
          <div className="card p-4 flex items-center gap-3">
            <Brain className="w-5 h-5 text-violet-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <input
                value={flowData.negocio}
                onChange={e => setFlowData({ ...flowData, negocio: e.target.value })}
                className="w-full bg-transparent text-sm font-bold text-white focus:outline-none border-b border-transparent hover:border-white/20 focus:border-violet-500 transition-colors"
                placeholder="Nombre del negocio"
              />
              <input
                value={flowData.objetivo}
                onChange={e => setFlowData({ ...flowData, objetivo: e.target.value })}
                className="w-full bg-transparent text-xs text-white/40 focus:outline-none border-b border-transparent hover:border-white/20 focus:border-violet-500 transition-colors mt-0.5"
                placeholder="Objetivo del asistente"
              />
            </div>
          </div>

          {/* Leyenda */}
          <div className="flex flex-wrap gap-3 px-1">
            {STEP_COLORS.map(c => (
              <div key={c.color} className="flex items-center gap-1.5 text-[10px] text-white/40">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                {c.label.split(' — ')[1]}
              </div>
            ))}
          </div>

          {/* Pasos */}
          <div className="card p-5 space-y-0">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Pasos del flujo</span>
              <button onClick={() => setAddingStep(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs transition-all">
                <Plus className="w-3.5 h-3.5" />Agregar paso
              </button>
            </div>

            {/* Add step form */}
            {addingStep && (
              <StepForm
                onSave={addStep}
                onCancel={() => setAddingStep(false)}
                isNew
              />
            )}

            {flowData.pasos.map((paso, i) => {
              const s = getStyle(paso.color);
              const isEditing = editingStep?.id === paso.id;
              // Find decision after this step
              const decision = flowData.decisiones?.find(d => d.despues_del_paso === paso.num);

              return (
                <div key={paso.id}>
                  {isEditing ? (
                    <StepForm
                      initial={editingStep!}
                      onSave={updateStep}
                      onCancel={() => setEditingStep(null)}
                    />
                  ) : (
                    <div className={`group flex gap-3 p-3.5 rounded-xl border ${s.border} ${s.bg} mb-1 hover:brightness-110 transition-all`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 ${s.text} bg-white/5`}>
                        {paso.num}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center flex-wrap gap-2">
                          <span className={`text-sm font-semibold ${s.text}`}>{paso.titulo}</span>
                          {paso.botones && paso.botones.length > 0 && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300">
                              🔘 {paso.botones.slice(0,2).join(' · ')}{paso.botones.length > 2 ? `+${paso.botones.length-2}` : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-white/50 mt-0.5">{paso.descripcion}</p>
                        {paso.regla && (
                          <p className="text-[10px] text-amber-400/70 mt-1">⚠️ {paso.regla}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button onClick={() => moveStep(paso.id, 'up')} disabled={i === 0}
                          className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white disabled:opacity-20 transition-all" title="Subir">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => moveStep(paso.id, 'down')} disabled={i === flowData.pasos.length - 1}
                          className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white disabled:opacity-20 transition-all" title="Bajar">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingStep(paso)}
                          className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white transition-all" title="Editar">
                          <Wand2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteStep(paso.id)}
                          className="p-1 rounded hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-all" title="Eliminar">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Decision diamond */}
                  {decision && !isEditing && (
                    <div className="ml-4 my-2 pl-4 border-l-2 border-violet-500/30 flex items-start gap-2">
                      <div className="w-4 h-4 mt-1 bg-violet-500/20 border border-violet-500/40 rotate-45 flex-shrink-0" />
                      <div>
                        <p className="text-[11px] text-violet-400 font-medium">{decision.pregunta}</p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {decision.opciones.map((op, j) => {
                            const os = getStyle(op.color);
                            return (
                              <span key={j} className={`text-[10px] px-2 py-0.5 rounded-lg border ${os.border} ${os.bg} ${os.text}`}>
                                {op.label}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Connector */}
                  {i < flowData.pasos.length - 1 && !isEditing && (
                    <div className="ml-7 w-px h-3 bg-white/10 my-0.5" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Alertas / Reglas críticas */}
          <div className="card p-4 border border-amber-500/20 bg-amber-500/5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-semibold text-amber-300">Reglas críticas del agente</span>
              </div>
              <button onClick={addAlert}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs transition-all">
                <Plus className="w-3 h-3" />Agregar
              </button>
            </div>
            {(flowData.alertas || []).map((a, i) => (
              <div key={i} className="flex items-start gap-2 group">
                <span className="text-amber-400 text-xs mt-0.5 flex-shrink-0">⚠️</span>
                {editingAlert === `alert-${i}` ? (
                  <div className="flex-1 flex gap-2">
                    <input
                      defaultValue={a.texto}
                      autoFocus
                      className="flex-1 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1 text-xs text-amber-200 focus:outline-none focus:border-amber-500"
                      onKeyDown={e => {
                        if (e.key === 'Enter') updateAlert(i, (e.target as HTMLInputElement).value);
                        if (e.key === 'Escape') setEditingAlert(null);
                      }}
                    />
                    <button onClick={() => setEditingAlert(null)} className="text-white/40 hover:text-white text-xs">✕</button>
                  </div>
                ) : (
                  <>
                    <p className="flex-1 text-xs text-amber-200/70 leading-relaxed">{a.texto}</p>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setEditingAlert(`alert-${i}`)} className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white"><Wand2 className="w-3 h-3" /></button>
                      <button onClick={() => deleteAlert(i)} className="p-1 hover:bg-red-500/20 rounded text-white/40 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Rutas especiales */}
          {flowData.rutas_especiales && flowData.rutas_especiales.length > 0 && (
            <div className="card p-4 space-y-3">
              <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Rutas especiales</span>
              <div className="grid grid-cols-2 gap-2">
                {flowData.rutas_especiales.map((r, i) => (
                  <div key={i} className="p-3 rounded-xl border border-white/8 bg-white/3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base">{r.emoji}</span>
                      <span className="text-xs font-semibold text-white">{r.nombre}</span>
                    </div>
                    <p className="text-[11px] text-white/40">{r.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Multimedia */}
          {flowData.multimedia && flowData.multimedia.length > 0 && (
            <div className="card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-base">🖼️</span>
                <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Multimedia configurada ({flowData.multimedia.length} elementos)</span>
              </div>
              <div className="space-y-2">
                {flowData.multimedia.map((m, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-white/8 bg-white/3">
                    <span className="text-lg flex-shrink-0">
                      {m.tipo === 'catalogo' ? '📂' : m.tipo === 'video' ? '🎥' : m.tipo === 'audio' ? '🎵' : '🖼️'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white">{m.nombre}</p>
                      <p className="text-[10px] text-white/40 mt-0.5">{m.descripcion}</p>
                      {m.keywords && (
                        <p className="text-[10px] text-violet-400/70 mt-1">
                          🔑 <span className="font-mono">{m.keywords}</span>
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/30 capitalize flex-shrink-0">{m.tipo}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save reminder */}
          {onUpdateModFlujo && (
            <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-center gap-3">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <p className="text-xs text-emerald-300/80">
                Edita los pasos y haz clic en <strong>"Guardar en módulo"</strong> para actualizar el módulo 06_flujos, luego en <strong>"Guardar Todo"</strong> para persistir.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Editor de paso (form) ──
function StepForm({ initial, onSave, onCancel, isNew }: {
  initial?: FlowStep;
  onSave: (step: any) => void;
  onCancel: () => void;
  isNew?: boolean;
}) {
  const [form, setForm] = useState<Partial<FlowStep>>(initial || {
    num: '', titulo: '', descripcion: '', color: '#10b981', tipo: 'accion', botones: [], regla: ''
  });
  const [botonesText, setBotonesText] = useState((initial?.botones || []).join(', '));

  const handleSave = () => {
    if (!form.titulo?.trim()) return;
    const botones = botonesText.split(',').map(b => b.trim()).filter(Boolean);
    onSave({ ...form, botones, id: initial?.id || `p${Date.now()}` });
  };

  const s = getStyle(form.color || '#10b981');

  return (
    <div className={`p-4 rounded-xl border-2 ${s.border} ${s.bg} mb-2 space-y-3`}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-white/40 uppercase tracking-wider">Número</label>
          <input value={form.num || ''} onChange={e => setForm({ ...form, num: e.target.value })}
            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
            placeholder="1, 2, 3A..." />
        </div>
        <div>
          <label className="text-[10px] text-white/40 uppercase tracking-wider">Color / Tipo</label>
          <select value={form.color || '#10b981'} onChange={e => setForm({ ...form, color: e.target.value })}
            className="w-full mt-1 bg-[var(--bg-secondary)] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500">
            {STEP_COLORS.map(c => (
              <option key={c.color} value={c.color}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="text-[10px] text-white/40 uppercase tracking-wider">Título del paso</label>
        <input value={form.titulo || ''} onChange={e => setForm({ ...form, titulo: e.target.value })}
          className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
          placeholder="Ej: Saludo y equipo" autoFocus />
      </div>
      <div>
        <label className="text-[10px] text-white/40 uppercase tracking-wider">Descripción</label>
        <textarea value={form.descripcion || ''} onChange={e => setForm({ ...form, descripcion: e.target.value })}
          className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500 resize-none"
          placeholder="Qué hace la IA en este paso" rows={2} />
      </div>
      <div>
        <label className="text-[10px] text-white/40 uppercase tracking-wider">Botones interactivos (separados por coma)</label>
        <input value={botonesText} onChange={e => setBotonesText(e.target.value)}
          className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
          placeholder="Opción A, Opción B, Opción C" />
      </div>
      <div>
        <label className="text-[10px] text-white/40 uppercase tracking-wider">Regla crítica (opcional)</label>
        <input value={form.regla || ''} onChange={e => setForm({ ...form, regla: e.target.value })}
          className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
          placeholder="Ej: NUNCA preguntar talla aquí" />
      </div>
      <div className="flex gap-2">
        <button onClick={handleSave}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-all">
          <Check className="w-3.5 h-3.5" />{isNew ? 'Agregar paso' : 'Guardar cambios'}
        </button>
        <button onClick={onCancel}
          className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs transition-all">
          Cancelar
        </button>
      </div>
    </div>
  );
}


export default function AsistentesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'modules' | 'media' | 'learning' | 'voice' | 'flow'>('modules');
  const [activeModule, setActiveModule] = useState<string>('identidad');
  const [viewMode, setViewMode] = useState<'markdown' | 'json'>('markdown');
  const [message, setMessage] = useState({ type: '', text: '' });

  // Context (legacy)
  const [context, setContext] = useState('');
  const [assistantName, setAssistantName] = useState('Asistente Principal');
  const [aiProvider, setAiProvider] = useState<'openai'|'groq'>('openai');
  const [aiModel, setAiModel] = useState('gpt-4o-mini');
  const [knowledgeItems, setKnowledgeItems] = useState<any[]>([]);

  // 🧩 MÓDULOS v2
  const [modOrquestador, setModOrquestador] = useState('');
  const [modIdentidad, setModIdentidad] = useState('');
  const [modReglas, setModReglas] = useState('');
  const [modProductos, setModProductos] = useState('');
  const [modAgenda, setModAgenda] = useState('');
  const [modFlujo, setModFlujo] = useState('');
  const [modAcciones, setModAcciones] = useState('');
  const [modAdmin, setModAdmin] = useState('');
  const [agenteCliente, setAgenteCliente] = useState('');
  const [agenteAdmin, setAgenteAdmin] = useState('');
  const [modZonas, setModZonas] = useState('');
  const [modMemoriaCliente, setModMemoriaCliente] = useState('');
  const [modMetricas, setModMetricas] = useState('');
  const [modDetector, setModDetector] = useState('');
  const [modTriggers, setModTriggers] = useState('');
  const [modCatalogo, setModCatalogo] = useState('');
  const [modNlu, setModNlu] = useState('');
  const [modOfertas, setModOfertas] = useState('');
  const [modBotones, setModBotones] = useState('');

  // Media
  const [mediaItems, setMediaItems] = useState<any[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [storageInfo, setStorageInfo] = useState<any>(null);

  // Voice
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [elevenLabsVoices, setElevenLabsVoices] = useState<any[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  // 📍 Cobertura de domicilio
  const [coverageLat, setCoverageLat] = useState('');
  const [coverageLon, setCoverageLon] = useState('');
  const [coverageRadiusKm, setCoverageRadiusKm] = useState('');
  const [coverageSaved, setCoverageSaved] = useState(false);
  const [savingCoverage, setSavingCoverage] = useState(false);

  // Learning
  const [learningHistory, setLearningHistory] = useState<any[]>([]);
  const [autoLearn, setAutoLearn] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [hasAiConfig, setHasAiConfig] = useState<boolean | null>(null);

  // === WORKSPACE: leer línea seleccionada ===
  const getLineId = () => localStorage.getItem('selectedLineId') || '';

  useEffect(() => {
    fetchAssistant();
    fetchStorage();
    fetchAiConfigStatus();
    const onLineChanged = () => { setLoading(true); fetchAssistant(); };
    window.addEventListener('lineChanged', onLineChanged);
    return () => window.removeEventListener('lineChanged', onLineChanged);
  }, []);

  const fetchAiConfigStatus = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/ai-config/status`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) { const d = await res.json(); setHasAiConfig(d.hasAccess || false); }
    } catch {}
  };

  const fetchStorage = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/media/storage`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setStorageInfo(await res.json());
    } catch {}
  };

  const fetchAssistant = async () => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    try {
      const res = await fetch(`${API_URL}/api/assistants?lineId=${getLineId()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const active = data.assistant || data.assistants?.find((a: any) => a.isActive) || data.assistants?.[0];
        
        if (active) {
          // Cargar datos del asistente existente
          setAssistantName(active.name || 'Asistente Principal');
      if (active.aiProvider) { setAiProvider(active.aiProvider as 'openai'|'groq'); }
      if (active.model) { setAiModel(active.model); }
          setContext(active.context || '');
          setKnowledgeItems(
            Array.isArray(active.knowledgeItems) ? active.knowledgeItems : 
            typeof active.knowledgeItems === 'string' ? JSON.parse(active.knowledgeItems || '[]') : []
          );
          setMediaItems(
            Array.isArray(active.mediaItems) ? active.mediaItems :
            typeof active.mediaItems === 'string' ? JSON.parse(active.mediaItems || '[]') : []
          );
          // 🧩 Cargar módulos v2
          setModOrquestador((active as any).modOrquestador || '');
          setModIdentidad(active.modIdentidad || '');
          setModReglas(active.modReglas || '');
          setModProductos(active.modProductos || '');
          setModAgenda(active.modAgenda || '');
          setModFlujo(active.modFlujo || '');
          setModAcciones(active.modAcciones || '');
          setModAdmin(active.modAdmin || '');
          setAgenteCliente((active as any).agenteCliente || '');
          setAgenteAdmin((active as any).agenteAdmin || '');
          setModZonas((active as any).modZonas || '');
          setModMemoriaCliente((active as any).modMemoriaCliente || '');
          setModMetricas((active as any).modMetricas || '');
          setModDetector((active as any).modDetector || '');
          setModTriggers((active as any).modTriggers || '');
          setModCatalogo((active as any).modCatalogo || '');
          setModNlu((active as any).modNlu || '');
          setModOfertas((active as any).modOfertas || '');
          setModBotones((active as any).modBotones || '');
          setElevenLabsKey(active.elevenLabsKey || '');
          setSelectedVoice(active.selectedVoice || '');
          setVoiceEnabled(active.voiceEnabled || false);
          setCoverageLat(active.coverageLat?.toString() || '');
          setCoverageLon(active.coverageLon?.toString() || '');
          setCoverageRadiusKm(active.coverageRadiusKm?.toString() || '');
          setAutoLearn(active.autoLearn !== false);
          setLearningHistory(
            Array.isArray(active.learningHistory) ? active.learningHistory :
            typeof active.learningHistory === 'string' ? JSON.parse(active.learningHistory || '[]') : []
          );
        } else {
          // ✅ Línea nueva sin asistente: limpiar TODO
          setContext('');
          setModIdentidad(''); setModReglas(''); setModProductos('');
          setModAgenda(''); setModFlujo(''); setModAcciones(''); setModAdmin('');
          setModOrquestador('');
          setAgenteCliente(''); setAgenteAdmin('');
          setModZonas(''); setModMemoriaCliente(''); setModMetricas(''); setModDetector('');
          setModTriggers(''); setModCatalogo(''); setModNlu(''); setModOfertas('');
          setKnowledgeItems([]);
          setMediaItems([]);
          setElevenLabsKey('');
          setSelectedVoice('');
          setVoiceEnabled(false);
          setCoverageLat('');
          setCoverageLon('');
          setCoverageRadiusKm('');
          setAutoLearn(true);
          setLearningHistory([]);
        }
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage({ type: '', text: '' });
    const token = localStorage.getItem('token');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const res = await fetch(`${API_URL}/api/assistants`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          name: assistantName,
          context,
          modIdentidad, modReglas, modProductos,
          modAgenda, modFlujo, modAcciones, modAdmin,
          agenteCliente, agenteAdmin,
          modOrquestador,
          modZonas, modMemoriaCliente, modMetricas, modDetector,
          modTriggers, modCatalogo, modNlu, modOfertas, modBotones,
          knowledgeItems,
          mediaItems,
          elevenLabsKey,
          selectedVoice,
          voiceEnabled,
          coverageLat: coverageLat ? parseFloat(coverageLat) : null,
          coverageLon: coverageLon ? parseFloat(coverageLon) : null,
          coverageRadiusKm: coverageRadiusKm ? parseFloat(coverageRadiusKm) : null,
          aiProvider,
          model: aiModel,
          autoLearn,
          learningHistory,
          isActive: true,
          lineId: getLineId()
        })
      });

      clearTimeout(timeout);

      if (res.ok) {
        setMessage({ type: 'success', text: '¡Configuración guardada correctamente!' });
        fetchStorage(); // Actualizar info de storage
      } else {
        const data = await res.json().catch(() => ({}));
        setMessage({ type: 'error', text: data.error || `Error al guardar (${res.status})` });
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setMessage({ type: 'error', text: 'Tiempo agotado. Intenta de nuevo.' });
      } else {
        setMessage({ type: 'error', text: 'Error de conexión. Verifica tu internet e intenta de nuevo.' });
      }
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ type: '', text: '' }), 8000);
    }
  };

  // ===== MULTIMEDIA =====
  // ===== MULTIMEDIA: Upload via API (compresión en backend) =====
  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Límites por tipo
    const maxSize = type === 'video' ? 15 * 1024 * 1024 : 5 * 1024 * 1024;
    const maxLabel = type === 'video' ? '15MB' : '5MB';
    if (file.size > maxSize) {
      setMessage({ type: 'error', text: `Archivo muy grande (máx ${maxLabel})` });
      return;
    }

    setUploadingMedia(true);
    setMessage({ type: '', text: '' });

    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('files', file);
      formData.append('category', 'assistant');

      const res = await fetch(`${API_URL}/api/media/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.storage?.fileTooLarge) {
          setMessage({ type: 'error', text: `Sin espacio. ${data.error}` });
        } else {
          setMessage({ type: 'error', text: data.error || 'Error al subir archivo' });
        }
        return;
      }

      const data = await res.json();
      const uploaded = data.files[0];

      const newMedia = {
        id: Date.now().toString(),
        name: file.name,
        type,
        url: uploaded.url,
        key: uploaded.key,
        trigger: '',
        caption: '',
        size: uploaded.fileSize
      };
      setMediaItems(prev => [...prev, newMedia]);

      const savedPct = uploaded.savedPercent > 0 ? ` (comprimido ${uploaded.savedPercent}%)` : '';
      const typeLabel = type === 'image' ? 'Imagen' : type === 'video' ? 'Video' : 'Audio';
      setMessage({ type: 'success', text: `${typeLabel} "${file.name}" subido${savedPct}. Define un trigger y guarda.` });
      fetchStorage(); // Actualizar barra de storage
    } catch (error: any) {
      setMessage({ type: 'error', text: 'Error de conexión al subir archivo' });
    } finally {
      setUploadingMedia(false);
      e.target.value = '';
    }
  };

  // 📏 Storage info from backend (real)
  const storageUsedMB = storageInfo ? parseFloat(storageInfo.usedMB) : 0;
  const storageLimitMB = storageInfo ? parseFloat(storageInfo.limitMB) : 250;
  const storagePercent = storageInfo ? storageInfo.percent : 0;

  // 📂 CATÁLOGO: Crear nuevo catálogo vacío
  const createCatalog = () => {
    const newCatalog = {
      id: Date.now().toString(),
      name: 'Nuevo Catálogo',
      type: 'catalog',
      trigger: '',
      caption: '',
      images: [] as { id: string; name: string; url: string; size: number }[]
    };
    setMediaItems(prev => [...prev, newCatalog]);
    setMessage({ type: 'success', text: 'Catálogo creado. Agrega imágenes, define trigger y guarda.' });
  };

  // 📂 CATÁLOGO: Agregar imagen(es) via API upload
  const addImageToCatalog = async (catalogIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const catalog = mediaItems[catalogIndex];
    if (!catalog || catalog.type !== 'catalog') return;

    const currentImages = catalog.images || [];
    const remaining = 10 - currentImages.length;
    
    if (remaining <= 0) {
      setMessage({ type: 'error', text: 'Máximo 10 imágenes por catálogo' });
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remaining);
    setUploadingMedia(true);
    let processed = 0;

    try {
      const token = localStorage.getItem('token');

      for (const file of filesToProcess) {
        if (file.size > 5 * 1024 * 1024) {
          setMessage({ type: 'error', text: `"${file.name}" es muy grande (máx 5MB)` });
          continue;
        }

        const formData = new FormData();
        formData.append('files', file);
        formData.append('category', 'assistant');

        const res = await fetch(`${API_URL}/api/media/upload`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setMessage({ type: 'error', text: data.error || `Error subiendo ${file.name}` });
          continue;
        }

        const data = await res.json();
        const uploaded = data.files[0];

        processed++;
        setMediaItems(prev => prev.map((item, i) => {
          if (i !== catalogIndex) return item;
          const imgs = [...(item.images || []), {
            id: `${Date.now()}-${processed}`,
            name: file.name,
            url: uploaded.url,
            key: uploaded.key,
            size: uploaded.fileSize
          }];
          return { ...item, images: imgs };
        }));
      }

      if (processed > 0) {
        setMessage({ type: 'success', text: `${processed} imagen(es) subida(s) y comprimida(s) al catálogo` });
        fetchStorage();
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error de conexión al subir imágenes' });
    } finally {
      setUploadingMedia(false);
      e.target.value = '';
    }
  };

  // 📂 CATÁLOGO: Eliminar imagen del catálogo
  const removeImageFromCatalog = async (catalogIndex: number, imageId: string) => {
    const catalog = mediaItems[catalogIndex];
    const image = catalog?.images?.find((img: any) => img.id === imageId);
    const token = localStorage.getItem('token');

    // Eliminar del backend si tiene key
    if (image?.key && token) {
      try {
        const storageRes = await fetch(`${API_URL}/api/media/files`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (storageRes.ok) {
          const { files } = await storageRes.json();
          const mediaFile = files.find((f: any) => f.key === image.key);
          if (mediaFile) {
            await fetch(`${API_URL}/api/media/${mediaFile.id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` }
            });
          }
        }
      } catch (e) { console.error('Error eliminando imagen:', e); }
    }

    setMediaItems(prev => prev.map((item, i) => {
      if (i !== catalogIndex) return item;
      return { ...item, images: (item.images || []).filter((img: any) => img.id !== imageId) };
    }));
    fetchStorage();
  };

  const updateMediaItem = (index: number, field: string, value: string) => {
    setMediaItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const removeMedia = async (index: number) => {
    const item = mediaItems[index];
    const token = localStorage.getItem('token');

    // Si tiene key, eliminar del backend (R2 + MediaFile)
    if (item?.key && token) {
      try {
        // Buscar el MediaFile por key para obtener su ID
        const storageRes = await fetch(`${API_URL}/api/media/files`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (storageRes.ok) {
          const { files } = await storageRes.json();
          const mediaFile = files.find((f: any) => f.key === item.key);
          if (mediaFile) {
            await fetch(`${API_URL}/api/media/${mediaFile.id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` }
            });
          }
        }
      } catch (e) { console.error('Error eliminando archivo:', e); }
    }

    setMediaItems(prev => prev.filter((_, i) => i !== index));
    fetchStorage();
  };

  // ===== AUTO-APRENDIZAJE =====
  const analyzeConversations = async () => {
    setAnalyzing(true);
    setMessage({ type: '', text: '' });
    const token = localStorage.getItem('token');

    try {
      const res = await fetch(`${API_URL}/api/assistants/learn`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });

      if (res.ok) {
        const data = await res.json();
        if (data.suggestions?.length > 0) {
          setLearningHistory(prev => [...data.suggestions, ...prev].slice(0, 50));
          setMessage({ type: 'success', text: `✨ ${data.suggestions.length} sugerencias generadas del análisis` });
        } else {
          setMessage({ type: 'success', text: 'Análisis completado. No se encontraron sugerencias nuevas.' });
        }
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error || 'Error al analizar' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error de conexión' });
    } finally {
      setAnalyzing(false);
    }
  };

  const applySuggestion = async (item: any) => {
    setApplyingId(item.id);
    const token = localStorage.getItem('token');

    try {
      const res = await fetch(`${API_URL}/api/assistants/learn/apply`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: item.id, suggestion: item.suggestion })
      });

      if (res.ok) {
        // Actualizar contexto local
        setContext(prev => prev + '\n\n' + item.suggestion);
        // Marcar como aplicada
        setLearningHistory(prev => prev.map(h => h.id === item.id ? { ...h, applied: true } : h));
        setMessage({ type: 'success', text: '✅ Sugerencia aplicada al contexto' });
      } else {
        setMessage({ type: 'error', text: 'Error al aplicar' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Error de conexión' });
    } finally {
      setApplyingId(null);
    }
  };

  const dismissSuggestion = async (item: any) => {
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/assistants/learn/dismiss`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: item.id })
      });
      setLearningHistory(prev => prev.map(h => h.id === item.id ? { ...h, dismissed: true } : h));
    } catch {}
  };

  // ===== ELEVENLABS =====
  const testElevenLabs = async () => {
    if (!elevenLabsKey) return;
    setTestingVoice(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/assistants/elevenlabs/voices`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: elevenLabsKey })
      });
      if (res.ok) {
        const data = await res.json();
        setElevenLabsVoices(data.voices || []);
        setMessage({ type: 'success', text: `¡Conectado! ${data.voices?.length || 0} voces disponibles` });
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage({ type: 'error', text: err.error || 'API Key de ElevenLabs inválida' });
      }
    } catch { setMessage({ type: 'error', text: 'Error de conexión con ElevenLabs' }); }
    finally { setTestingVoice(false); }
  };

  const previewVoice = async (voiceId: string) => {
    if (!elevenLabsKey || !voiceId) return;
    setTestingVoice(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/assistants/elevenlabs/preview`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: elevenLabsKey, voiceId })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.audio) {
        const audio = new Audio(data.audio);
        audio.play();
        setMessage({ type: 'success', text: `🔊 Reproduciendo (modelo: ${data.model || 'default'})` });
      } else {
        setMessage({ type: 'error', text: data.error || `Error preview (${res.status})` });
      }
    } catch (e: any) { setMessage({ type: 'error', text: 'Error de conexión: ' + e.message }); }
    finally { setTestingVoice(false); }
  };

  // ===== KNOWLEDGE =====
  // 📍 Guardar solo cobertura
  const handleSaveCoverage = async () => {
    setSavingCoverage(true);
    setCoverageSaved(false);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/assistants`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: assistantName,
          context,
          modIdentidad, modReglas, modProductos,
          modAgenda, modFlujo, modAcciones, modAdmin,
          agenteCliente, agenteAdmin,
          modOrquestador,
          modZonas, modMemoriaCliente, modMetricas, modDetector,
          modTriggers, modCatalogo, modNlu, modOfertas, modBotones,
          knowledgeItems,
          mediaItems,
          elevenLabsKey,
          selectedVoice,
          voiceEnabled,
          coverageLat: coverageLat ? parseFloat(coverageLat) : null,
          coverageLon: coverageLon ? parseFloat(coverageLon) : null,
          coverageRadiusKm: coverageRadiusKm ? parseFloat(coverageRadiusKm) : null,
          aiProvider,
          model: aiModel,
          autoLearn,
          learningHistory,
          isActive: true,
          lineId: getLineId()
        })
      });
      if (res.ok) {
        setCoverageSaved(true);
        setTimeout(() => setCoverageSaved(false), 4000);
      } else {
        alert('Error al guardar cobertura. Intenta de nuevo.');
      }
    } catch { alert('Error de conexión'); }
    finally { setSavingCoverage(false); }
  };

  const addKnowledgeItem = () => {
    setKnowledgeItems(prev => [...prev, { id: Date.now().toString(), title: '', content: '', triggers: '' }]);
  };
  const updateKnowledgeItem = (index: number, field: string, value: any) => {
    setKnowledgeItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };
  const removeKnowledgeItem = (index: number) => {
    setKnowledgeItems(prev => prev.filter((_, i) => i !== index));
  };

  const markdownTemplate = `# 🤖 [NOMBRE DEL ASISTENTE]\n\n---\n\n## 🎭 IDENTIDAD\n\nSoy el asistente virtual de **[NOMBRE DEL NEGOCIO]**\n[Descripción breve: qué hace el negocio, ciudad] 📍\n\n---\n\n## 💬 PERSONALIDAD Y TONO\n\n- Tono: [profesional / cercano / formal / dinámico]\n- Idioma: español colombiano, natural como WhatsApp\n- Emojis: usarlos con moderación para ser más cercano\n- Mensajes cortos: máximo 4-5 líneas por mensaje\n- NUNCA enviar un bloque largo de texto\n\n---\n\n## 🚫 ANTI-REPETICIÓN (OBLIGATORIO)\n\n- NUNCA repitas un mensaje ya enviado\n- Si ya mostraste opciones → NO las repitas, pregunta directo\n- Si ya saludaste → NO saludes de nuevo\n- Si ya pediste un dato → NO lo pidas otra vez\n- Cada respuesta debe AVANZAR la conversación\n\n---\n\n## 📋 SERVICIOS / PRODUCTOS\n\n### [Servicio o Producto 1]\n- **Descripción:** [Qué incluye]\n- **Precio:** $[precio]\n- **Duración:** [si aplica]\n- **Requisitos:** [si aplica]\n\n### [Servicio o Producto 2]\n- **Descripción:** [Qué incluye]\n- **Precio:** $[precio]\n\n*(Agrega todos los servicios o productos que ofreces)*\n\n---\n\n## 📋 ETAPAS DEL PIPELINE\n\n*(Estas deben coincidir EXACTAMENTE con las etapas configuradas en tu pipeline)*\n\n1. [Etapa 1 — ej: Nuevo Contacto]\n2. [Etapa 2 — ej: Consultando Servicio]\n3. [Etapa 3 — ej: Eligiendo Fecha]\n4. [Etapa 4 — ej: Confirmado]\n5. [Etapa 5 — ej: Atendido]\n6. [Etapa 6 — ej: Perdido]\n\n---\n\n## 🔄 FLUJO DE ATENCIÓN PASO A PASO\n\n### PASO 1 → Saludo (etapa: [Etapa 1])\nSaluda con el nombre del negocio y pregunta el nombre del cliente.\n\n> ¡Hola! 👋 Bienvenido/a a *[Nombre del negocio]*\n> ¿Cuál es tu nombre?\n\n### PASO 2 → Identificar necesidad (etapa: [Etapa 2])\nMuestra las opciones de servicio disponibles.\n\n> ¡Hola [Nombre]! ¿En qué te puedo ayudar? 😊\n>\n> 1️⃣ [Servicio 1]\n> 2️⃣ [Servicio 2]\n> 3️⃣ [Servicio 3]\n> 4️⃣ Hablar con un asesor\n\n### PASO 3 → Recoger datos necesarios (etapa: [Etapa 3])\n*(Lista los datos OBLIGATORIOS antes de continuar)*\n- Pedir uno por uno:\n  1. [Dato 1 — ej: Nombre completo]\n  2. [Dato 2 — ej: Teléfono]\n  3. [Dato 3 — ej: Dirección / Placa / Cédula]\n\n❌ NO agendar ni cotizar sin estos datos\n\n### PASO 4 → Fecha y hora (si aplica)\nEl sistema inyecta disponibilidad real. Reformularla bonito al cliente.\nNUNCA copies el bloque técnico del sistema al cliente.\n✅ Solo ofrece horarios marcados como libres.\n\n### PASO 5 → Resumen antes de confirmar (etapa: Confirmando)\n\n> 📋 *Resumen:*\n>\n> 👤 [Nombre del cliente]\n> 🔧 [Servicio elegido]\n> 📅 [Fecha y hora — si aplica]\n> 💰 [Precio]\n> [Otros datos relevantes]\n>\n> ¿Todo correcto? *SÍ* para confirmar o *NO* para corregir 😊\n\n### PASO 6 → Confirmado (etapa: [Etapa confirmada])\nCuando el cliente dice SÍ → accion: **"crear_cita"** o **"crear_pedido"** o **"crear_reserva"** según el negocio.\n\n> ✅ *¡[Cita/Pedido/Reserva] confirmada exitosamente!*\n> [Mensaje de cierre con instrucciones, dirección, o próximos pasos]\n\n---\n\n## 🔄 MODIFICAR / REAGENDAR / CANCELAR\n\n### Reagendar:\nConfirmar → mostrar disponibilidad → accion: **"actualizar_cita"** o **"actualizar_reserva"**\n\n### Cancelar:\nConfirmar primero → accion: **"cancelar_cita"** o **"cancelar_reserva"** o **"cancelar_pedido"**\n\n---\n\n## 📍 INFORMACIÓN DEL NEGOCIO\n\n**Dirección:** [Dirección completa]\n**WhatsApp:** [Número]\n**Web/Instagram:** [Link si aplica]\n\n| Día | Horario |\n|-----|---------|\n| Lunes - Viernes | [Horario] |\n| Sábados | [Horario] |\n| Domingos | [Horario o CERRADO] |\n\n---\n\n## 💰 MÉTODOS DE PAGO\n\n✅ [Método 1] | ✅ [Método 2] | ✅ [Método 3]\n[Condiciones especiales si aplica]\n\n---\n\n## ❓ PREGUNTAS FRECUENTES\n\n| Pregunta | Respuesta |\n|----------|-----------|\n| [Pregunta 1] | [Respuesta 1] |\n| [Pregunta 2] | [Respuesta 2] |\n| [Pregunta 3] | [Respuesta 3] |\n\n---\n\n## 🧠 CAMPOS DE MEMORIA (MEMORY_JSON)\n\nEl sistema guarda automáticamente estos datos del cliente:\n\n- **nombre** → Nombre del cliente\n- **telefono** → Teléfono\n- **producto_servicio** → Servicio o producto elegido\n- **detalles_producto** → Especificaciones (talla, color, modelo, etc.)\n- **cantidad** → Cantidad de unidades\n- **precio** → Precio unitario\n- **total** → Total a pagar\n- **ciudad** → Ciudad del cliente\n- **direccion** → Dirección de entrega o del cliente\n- **metodo_pago** → Método de pago elegido\n- **notas** → Datos extra (cédula, placa, observaciones)\n- **etapa_actual** → Etapa actual del pipeline (EXACTA)\n- **accion** → Acción a ejecutar (ver tabla abajo)\n- **fecha_cita / hora_cita** → Para citas (YYYY-MM-DD / HH:MM)\n- **tipo_cita** → Tipo de cita o servicio\n- **fecha_reserva / hora_reserva** → Para reservas\n- **tipo_reserva / num_personas** → Para reservas\n- **fecha_entrega** → Para pedidos\n\n### TABLA DE ACCIONES\n\n| Situación | accion | Cuándo usarla |\n|-----------|--------|---------------|\n| Cliente confirma **cita** | \`crear_cita\` | Cuando dice SÍ al resumen |\n| Cliente confirma **pedido/compra** | \`crear_pedido\` | Cuando confirma compra con datos completos |\n| Cliente confirma **reserva** | \`crear_reserva\` | Cuando confirma reserva (mesa, espacio, turno) |\n| Quiere **cambiar** fecha/hora | \`actualizar_cita\` o \`actualizar_reserva\` | Reagendando |\n| Quiere **cancelar** | \`cancelar_cita\` / \`cancelar_reserva\` / \`cancelar_pedido\` | Después de confirmar cancelación |\n| Ya está creado | *(vacío)* | NO repetir crear si ya dice "creada" en memoria |\n\n⚠️ NUNCA pongas \`crear_*\` si la memoria ya muestra que está creado\n⚠️ Siempre incluye fecha y hora al crear o actualizar\n⚠️ Actualiza \`etapa_actual\` en CADA respuesta con la etapa correcta\n\n---\n\n## ⚠️ REGLAS CRÍTICAS\n\n### ❌ NUNCA:\n- Inventar precios, horarios o disponibilidad\n- Confirmar sin tener todos los datos obligatorios\n- Copiar el bloque técnico de disponibilidad al cliente\n- Agendar en días cerrados (verifica el horario configurado)\n- Repetir \`crear_*\` si ya está creado en memoria\n- Enviar mensajes de más de 5 líneas\n\n### ✅ SIEMPRE:\n- Reformular disponibilidad de forma bonita y clara\n- Seguir el flujo paso a paso en orden\n- Pedir datos ANTES de mostrar disponibilidad\n- Confirmar antes de cancelar o reagendar\n- Actualizar \`etapa_actual\` en cada respuesta\n- Incluir el bloque \`<<MEMORY_JSON>>...<<END_MEMORY>>\` al final\n`;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const pendingSuggestions = learningHistory.filter(h => !h.applied && !h.dismissed);
  const appliedSuggestions = learningHistory.filter(h => h.applied);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <img src="/bizonne.png" alt="Bizonne" className="w-16 h-16 rounded-xl animate-pulse" />
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/bizonne.png" alt="Bizonne" className="w-14 h-14 rounded-xl shadow-lg" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">Asistente IA</h1>
            <p className="text-[var(--text-muted)]">Configura tu asistente IA</p>
          </div>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <div className="loading-spinner w-4 h-4" /> : <Save className="w-4 h-4" />}
          Guardar Todo
        </button>
      </div>

      {/* Message */}
      {message.text && (
        <div className={`p-4 rounded-xl flex items-center gap-3 animate-fade-in ${
          message.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' : 
          'bg-red-500/10 border border-red-500/30 text-red-400'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
          <span className="flex-1">{message.text}</span>
          <button onClick={() => setMessage({ type: '', text: '' })}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 p-1.5 bg-[var(--bg-tertiary)] rounded-xl overflow-x-auto">
        {[
          { id: 'modules', label: 'Base IA', icon: Brain },
          { id: 'media', label: 'Multimedia', icon: Image, badge: mediaItems.length || undefined },
          { id: 'learning', label: 'Auto-Aprendizaje', icon: TrendingUp, badge: pendingSuggestions.length || undefined },
          { id: 'voice', label: 'Voz (ElevenLabs)', icon: Volume2 },
          { id: 'flow', label: 'Flujo IA', icon: GitBranch },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-5 py-3 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === tab.id ? 'bg-[var(--accent-primary)] text-white shadow-lg' : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'
            }`}>
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.badge && tab.badge > 0 && (
              <span className="w-5 h-5 rounded-full bg-white/20 text-[10px] flex items-center justify-center font-bold">{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ==================== CONTEXT TAB ==================== */}
      {activeTab === 'modules' && (
        <div className="space-y-5">

          {/* ══ ORQUESTADOR ══ */}
          <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-[#060b18] p-5">
            <div className="absolute inset-0" style={{backgroundImage:'radial-gradient(ellipse at 50% 100%, rgba(99,102,241,0.07) 0%, transparent 70%)'}}/>
            <div className="relative">

              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
                    <Brain className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white">Sistema Modular IA</h2>
                    <p className="text-xs text-white/35">Orquestador · 2 Agentes · 15 Módulos</p>
                  </div>
                </div>
                <a href="/ai-config" className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-500/12 text-violet-300 border border-violet-500/20 hover:bg-violet-500/20 transition-all flex items-center gap-1.5">
                  <Wand2 className="w-3 h-3" />{hasAiConfig ? 'Generar con IA' : '🔒 Config IA'}
                </a>
              </div>

              {/* 3 columnas */}
              <div className="grid grid-cols-3 gap-3">

                {/* AGENTE_CLIENTE */}
                <div className={`relative rounded-xl border p-4 cursor-pointer transition-all ${activeModule === 'agenteCliente' ? 'border-blue-500/40 bg-blue-500/8 shadow-lg shadow-blue-500/10' : 'border-white/8 bg-white/2 hover:border-blue-500/25 hover:bg-white/4'}`}
                  onClick={() => setActiveModule('agenteCliente')}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/25 flex items-center justify-center text-sm">🤖</div>
                    <div>
                      <div className="text-sm font-bold text-blue-300">AGENTE_CLIENTE</div>
                      {agenteCliente && <div className="text-[9px] text-emerald-400">✓ configurado</div>}
                    </div>
                  </div>
                  <div className="space-y-1 pl-1">
                    {['ventas','reservas','agenda'].map(s => (
                      <div key={s} className="flex items-center gap-1.5 text-xs text-white/50">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500/60"/>
                        {s}
                      </div>
                    ))}
                  </div>
                  {agenteCliente && <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-emerald-400"/>}
                </div>

                {/* AGENTE_ADMIN */}
                <div className={`relative rounded-xl border p-4 cursor-pointer transition-all ${activeModule === 'agenteAdmin' ? 'border-teal-500/40 bg-teal-500/8 shadow-lg shadow-teal-500/10' : 'border-white/8 bg-white/2 hover:border-teal-500/25 hover:bg-white/4'}`}
                  onClick={() => setActiveModule('agenteAdmin')}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-lg bg-teal-500/15 border border-teal-500/25 flex items-center justify-center text-sm">🔐</div>
                    <div>
                      <div className="text-sm font-bold text-teal-300">AGENTE_ADMIN</div>
                      {agenteAdmin && <div className="text-[9px] text-emerald-400">✓ configurado</div>}
                    </div>
                  </div>
                  <div className="space-y-1 pl-1">
                    {['análisis','métricas','campañas'].map(s => (
                      <div key={s} className="flex items-center gap-1.5 text-xs text-white/50">
                        <div className="w-1.5 h-1.5 rounded-full bg-teal-500/60"/>
                        {s}
                      </div>
                    ))}
                  </div>
                  {agenteAdmin && <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-emerald-400"/>}
                </div>

                {/* CONFIG NEGOCIO — 11 módulos */}
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/4 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center text-sm">⚙️</div>
                    <div className="text-sm font-bold text-violet-300">CONFIG NEGOCIO</div>
                  </div>
                  <div className="space-y-0.5">
                    {[
                      {id:'orquestador',    emoji:'⚙️', label:'00_orquestador.md',        val:modOrquestador},
                      {id:'identidad',      emoji:'👤', label:'identidad.md',            val:modIdentidad},
                      {id:'reglas',         emoji:'📋', label:'reglas.md',                val:modReglas},
                      {id:'productos',      emoji:'🛍️', label:'productos.json',           val:modProductos},
                      {id:'agenda',         emoji:'🗓️', label:'agenda.json',              val:modAgenda},
                      {id:'flujo',          emoji:'🔄', label:'flujos.md',                val:modFlujo},
                      {id:'acciones',       emoji:'⚡', label:'acciones.json',            val:modAcciones},
                      {id:'admin',          emoji:'🔧', label:'admin.md',                 val:modAdmin},
                      {id:'zonas',          emoji:'📍', label:'zonas.json',               val:modZonas},
                      {id:'memoriacliente', emoji:'🧠', label:'memoria.json',             val:modMemoriaCliente},
                      {id:'metricas',       emoji:'📊', label:'metricas.md',              val:modMetricas},
                      {id:'detector',       emoji:'🎯', label:'intenciones.md',           val:modDetector},
                      {id:'triggers',       emoji:'📲', label:'triggers_multimedia.md',   val:modTriggers},
                      {id:'catalogo',       emoji:'🗂️', label:'contexto_catalogo.json',   val:modCatalogo},
                      {id:'nlu',            emoji:'🔤', label:'nlu_map.json',             val:modNlu},
                      {id:'ofertas',        emoji:'💡', label:'motor_ofertas.json',        val:modOfertas},
                      {id:'botones',        emoji:'🔘', label:'16_botones.json',            val:modBotones},
                    ].map((m, i) => (
                      <button key={m.id} onClick={() => setActiveModule(m.id)}
                        className={`w-full flex items-center gap-1.5 text-xs py-1 rounded transition-colors text-left ${activeModule === m.id ? 'text-violet-200 font-medium' : 'text-white/55 hover:text-white/75'}`}>
                        <div className={`w-1 h-1 rounded-full flex-shrink-0 ${m.val ? 'bg-emerald-400' : 'bg-white/15'}`}/>
                        <span className="text-white/30 w-4 flex-shrink-0 text-[10px] font-mono">{String(i+1).padStart(2,'0')}</span>
                        <span>{m.emoji} {m.label}</span>
                        {m.val && <span className="ml-auto text-emerald-400 text-[10px]">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Legacy banner */}
              {context && !modIdentidad && !modReglas && !modFlujo && !agenteCliente && (
                <div className="mt-4 p-3 rounded-lg bg-amber-500/8 border border-amber-500/20 flex items-center gap-2">
                  <span className="text-amber-400 text-xs">⚠️</span>
                  <p className="text-xs text-amber-300/80">Tienes una base de conocimiento antigua (formato único). <strong className="text-amber-300">Migra</strong> copiando el contenido en los módulos o usa <a href="/ai-config" className="underline">Config IA</a> para regenerarla.</p>
                </div>
              )}
            </div>
          </div>

          {/* ══ EDITORES ══ */}

          {/* Orquestador */}
          {activeModule === 'orquestador' && (
            <div className="card p-0 overflow-hidden">
              <div className="p-4 border-b border-white/5 bg-violet-500/5 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center text-lg flex-shrink-0">⚙️</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-violet-200 text-sm">Módulo 00 — Orquestador</h3>
                      <span className="text-[9px] font-mono text-white/25 bg-white/5 px-1.5 py-0.5 rounded">00_orquestador.md</span>
                    </div>
                    <p className="text-xs text-white/40 mt-0.5">Lógica central: qué agente activar, cuándo, con qué módulos y bajo qué condiciones.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] text-white/30 bg-white/5 px-2 py-1 rounded-full">{modOrquestador.length} chars</span>
                  <button onClick={() => setModOrquestador('# ORQUESTADOR\n\n## Rol del sistema\nEres el orquestador central. Antes de responder, determina:\n1. ¿Es un cliente o el admin del negocio?\n2. ¿Qué módulo es el más relevante para esta consulta?\n3. ¿Qué agente debe tomar el control?\n\n## Reglas de enrutamiento\n\n### → AGENTE_CLIENTE si:\n- El mensaje viene de un número desconocido\n- El cliente saluda, pregunta por productos, precios o quiere comprar\n- Es una consulta de seguimiento de pedido\n\n### → AGENTE_ADMIN si:\n- El mensaje incluye la palabra clave secreta: [ADMIN_KEY]\n- O el número está marcado como admin en el sistema\n\n## Módulos a consultar según la situación\n\n| Situación | Módulos prioritarios |\n|-----------|---------------------|\n| Cliente nuevo | 01, 11, 05 |\n| Cliente cotizando | 03, 13, 15 |\n| Cliente eligiendo color | 12, 13 |\n| Cliente con datos completos | 06, 09 |\n| Cliente inactivo +3h | 04 (recuperación) |\n| Reclamo o problema | 07 |\n| Admin pidiendo métricas | 10 |\n\n## Prioridad de módulos en el prompt\n```\n00 Orquestador (este archivo)\n→ Agente activo (cliente o admin)\n→ 11 Intenciones (detección)\n→ 14 NLU Map (entender al cliente)\n→ 05 Flujo (conversación)\n→ 03 Productos + 13 Catálogo (precios y stock)\n→ 12 Triggers (multimedia)\n→ 15 Ofertas (descuentos)\n→ 06 Acciones (pipeline + MEMORY_JSON)\n→ 09 Memoria (estructura del JSON)\n```\n\n## Condiciones de escalamiento\n- Si el cliente insiste en hablar con humano → `accion: transferir_agente`\n- Si no reconoces la intención después del Módulo 14 → pedir aclaración, NO inventar\n- Si el Módulo 13 dice que el color está agotado → NO confirmar disponibilidad')} className="px-2 py-1 rounded-lg text-[10px] bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70 transition-all flex items-center gap-1">
                    <Sparkles className="w-3 h-3"/>Plantilla
                  </button>
                </div>
              </div>
              <textarea
                value={modOrquestador}
                onChange={e => setModOrquestador(e.target.value)}
                placeholder="# ORQUESTADOR&#10;&#10;Define la lógica central: qué agente activar, cuándo, con qué módulos y bajo qué condiciones..."
                className="w-full min-h-[420px] p-5 bg-[var(--bg-primary)] text-white/90 text-sm resize-none focus:outline-none leading-relaxed font-mono"
              />
            </div>
          )}

          {/* Agente Cliente */}
          {activeModule === 'agenteCliente' && (
            <div className="card p-0 overflow-hidden">
              <div className="p-4 border-b border-white/5 bg-blue-500/5 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center text-lg">🤖</div>
                  <div>
                    <h3 className="font-semibold text-blue-200 text-sm">AGENTE_CLIENTE</h3>
                    <p className="text-xs text-white/40 mt-0.5">Instrucciones de rol — ventas, reservas, agenda con clientes</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white/30 bg-white/5 px-2 py-1 rounded-full">{agenteCliente.length} chars</span>
                  <button onClick={() => setAgenteCliente('Eres el agente de ventas de **[NEGOCIO]** por WhatsApp.\n\n## Objetivo\nConvertir cada consulta en una venta o reserva confirmada.\n\n## Comportamiento\n- Sigue el flujo del Módulo 05 en orden estricto\n- Actualiza etapa_actual en CADA mensaje\n- Incluye MEMORY_JSON al final de CADA respuesta\n- Máximo 4 líneas por mensaje\n- Tono cercano, natural, colombiano')} className="px-2 py-1 rounded-lg text-[10px] bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70 flex items-center gap-1">
                    <Sparkles className="w-3 h-3"/>Plantilla
                  </button>
                </div>
              </div>
              <textarea value={agenteCliente} onChange={e => setAgenteCliente(e.target.value)}
                placeholder="Eres el agente de ventas de [NEGOCIO] por WhatsApp. Tu objetivo: convertir consultas en ventas confirmadas..."
                className="w-full min-h-[300px] p-5 bg-[var(--bg-primary)] text-white/90 text-sm resize-none focus:outline-none leading-relaxed font-mono"/>
            </div>
          )}

          {/* Agente Admin */}
          {activeModule === 'agenteAdmin' && (
            <div className="card p-0 overflow-hidden">
              <div className="p-4 border-b border-white/5 bg-teal-500/5 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/25 flex items-center justify-center text-lg">🔐</div>
                  <div>
                    <h3 className="font-semibold text-teal-200 text-sm">AGENTE_ADMIN</h3>
                    <p className="text-xs text-white/40 mt-0.5">Análisis del negocio, métricas y campañas para el dueño</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white/30 bg-white/5 px-2 py-1 rounded-full">{agenteAdmin.length} chars</span>
                  <button onClick={() => setAgenteAdmin('Eres el analista de negocio de **[NEGOCIO]**. Solo respondes al dueño/admin.\n\n## Funciones\n- Análisis de conversaciones y métricas\n- Identificar patrones de ventas\n- Sugerir campañas y mejoras\n- Alertas cuando hay reclamos o problemas\n\n## Reglas\n- NUNCA compartes información confidencial con clientes\n- Solo el dueño tiene acceso a este agente')} className="px-2 py-1 rounded-lg text-[10px] bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70 flex items-center gap-1">
                    <Sparkles className="w-3 h-3"/>Plantilla
                  </button>
                </div>
              </div>
              <textarea value={agenteAdmin} onChange={e => setAgenteAdmin(e.target.value)}
                placeholder="Eres el analista de negocio de [NEGOCIO]. Solo respondes al dueño..."
                className="w-full min-h-[300px] p-5 bg-[var(--bg-primary)] text-white/90 text-sm resize-none focus:outline-none leading-relaxed font-mono"/>
            </div>
          )}

          {/* 11 módulos de configuración */}
          {[
            {
              id:'identidad', num:'01', emoji:'👤', label:'Identidad del Agente', file:'01_identidad.md', color:'blue',
              desc:'Nombre, personalidad, tono y restricciones de comportamiento.',
              placeholder:'Eres **[Nombre]**, asistente de **[NEGOCIO]**\n\n- Tono: cercano, colombiano, directo\n- Nunca confirmes ser IA\n- Máximo 4 líneas por mensaje\n- Máximo 2 emojis por mensaje',
              val: modIdentidad, set: setModIdentidad
            },
            {
              id:'reglas', num:'02', emoji:'📋', label:'Reglas de Negocio', file:'02_reglas.md', color:'emerald',
              desc:'Políticas, horarios, métodos de pago y condiciones del servicio.',
              placeholder:'## Horarios\nLunes-Viernes: 8am - 6pm\nSábados: 9am - 2pm\n\n## Métodos de pago\nNequi, Bancolombia, Efectivo\n\n## Políticas\n- Envíos gratis desde $150.000\n- Devoluciones en 3 días hábiles',
              val: modReglas, set: setModReglas
            },
            {
              id:'productos', num:'03', emoji:'🛍️', label:'Servicios / Productos', file:'03_servicios.json', color:'amber',
              desc:'Catálogo completo con precios, variantes y disponibilidad.',
              placeholder:'## Hoodie Clásico\n- Precio: $85.000\n- Tallas: S, M, L, XL, XXL\n- Colores: Negro, Blanco, Gris\n\n## Hoodie Premium\n- Precio: $120.000\n- Personalización DTF incluida',
              val: modProductos, set: setModProductos
            },
            {
              id:'agenda', num:'04', emoji:'🗓️', label:'Agenda y Horarios', file:'04_agenda.json', color:'cyan',
              desc:'Disponibilidad, tipos de cita, duración y reglas de reserva.',
              placeholder:'## Días disponibles\nLunes a Viernes: 8:00 - 17:00\n\n## Servicios\n- Consulta inicial: 30 min\n- Servicio completo: 1 hora\n\n## Reglas\n- Reservar con mínimo 24h de anticipación\n- Cancelar con mínimo 2h de anticipación',
              val: modAgenda, set: setModAgenda
            },
            {
              id:'flujo', num:'05', emoji:'🔄', label:'Flujos de Conversación', file:'05_flujos.md', color:'purple',
              desc:'Paso a paso desde el primer mensaje hasta el cierre.',
              placeholder:'### PASO 1 → Saludo\nEl bot: "¡Hola! 👋 Soy [Nombre] de [NEGOCIO]\n¿Cómo te llamas?"\n\n### PASO 2 → Identificar necesidad\n### PASO 3 → Recoger datos del cliente\n### PASO 4 → Resumen + confirmar\n### PASO 5 → Confirmación final + acción',
              val: modFlujo, set: setModFlujo
            },
            {
              id:'acciones', num:'06', emoji:'⚡', label:'Acciones y Pipeline', file:'06_acciones.json', color:'orange',
              desc:'MEMORY_JSON, tabla de acciones y etapas del pipeline CRM.',
              placeholder:'## Etapas del pipeline\n- Nuevo contacto\n- Consultando\n- Confirmando pedido\n- Pedido creado\n- Entregado\n- Perdido\n\n## Acciones disponibles\n- crear_pedido: cuando confirma con datos completos\n- cancelar_pedido: cuando quiere cancelar\n- actualizar_pedido: para modificar',
              val: modAcciones, set: setModAcciones
            },
            {
              id:'admin', num:'07', emoji:'🔧', label:'Admin y Configuración', file:'07_admin.md', color:'rose',
              desc:'Alertas, transferencias a asesor y configuración avanzada.',
              placeholder:'## Transferencias\n- Transferir si cliente insiste en hablar con persona\n- Transferir si hay reclamo mayor de $200.000\n\n## Alertas\n- Avisar si menciona devolución o reclamo\n- Avisar si pregunta algo no cubierto\n\n## Notas\n- Horario especial: dic 24-31',
              val: modAdmin, set: setModAdmin
            },
            {
              id:'zonas', num:'08', emoji:'📍', label:'Zonas y Cobertura', file:'08_zonas.json', color:'indigo',
              desc:'Zonas de entrega, costos de envío y tiempos por ciudad.',
              placeholder:'## Zonas de cobertura\n\n### Bogotá (envío gratis desde $150.000)\n- Usaquén, Chapinero, Santa Fe\n- Tiempo: 1-2 días hábiles\n\n### Medellín\n- Costo fijo: $8.000\n- Tiempo: 2-3 días hábiles\n\n### Nacional (Servientrega)\n- Costo: $12.000 - $18.000\n- Tiempo: 3-5 días hábiles',
              val: modZonas, set: setModZonas
            },
            {
              id:'memoriacliente', num:'09', emoji:'🧠', label:'Memoria Cliente', file:'09_memoria_cliente.json', color:'sky',
              desc:'Estructura del MEMORY_JSON y campos persistentes por cliente.',
              placeholder:'## Campos de memoria persistente\n\n### Datos básicos\n- nombre: nombre completo del cliente\n- telefono: número de WhatsApp\n- ciudad: ciudad de residencia\n\n### Datos del pedido\n- producto_servicio: qué eligió\n- talla / color / variante\n- precio, cantidad, total\n- direccion, barrio\n- metodo_pago\n\n### Estado de conversación\n- etapa_actual: etapa en el pipeline\n- accion: acción a ejecutar\n- pedidos_anteriores: historial',
              val: modMemoriaCliente, set: setModMemoriaCliente
            },
            {
              id:'metricas', num:'10', emoji:'📊', label:'Métricas y KPIs', file:'10_metricas.md', color:'pink',
              desc:'KPIs del negocio, objetivos de conversión y métricas a rastrear.',
              placeholder:'## KPIs principales\n- Tasa de conversión objetivo: 30%\n- Tiempo promedio de cierre: < 15 minutos\n- Ticket promedio: $120.000\n\n## Métricas a rastrear\n- Leads nuevos por semana\n- Productos más consultados\n- Preguntas sin respuesta (gaps)\n- Hora pico de conversaciones\n\n## Alertas de negocio\n- Avisar si hay 3+ reclamos en 1 semana\n- Avisar si tasa conversión baja de 15%',
              val: modMetricas, set: setModMetricas
            },
            {
              id:'detector', num:'11', emoji:'🎯', label:'Detector de Intenciones', file:'11_intenciones.md', color:'fuchsia',
              desc:'Intenciones reconocibles, entidades y respuestas rápidas.',
              placeholder:'## Intenciones principales\n\n### COMPRAR / PEDIR\nPalabras clave: quiero, cuánto vale, precio, comprar, pedir, encargar\nAcción: iniciar flujo de venta\n\n### CONSULTAR ESTADO\nPalabras clave: mi pedido, llegó, cuando llega, estado\nAcción: consultar pedido por teléfono\n\n### CANCELAR\nPalabras clave: cancelar, no quiero, me arrepentí\nAcción: confirmar cancelación → accion:cancelar_pedido\n\n### HABLAR CON HUMANO\nPalabras clave: asesor, persona, humano, encargado\nAcción: transferir a agente humano',
              val: modDetector, set: setModDetector
            },
            {
              id:'triggers', num:'12', emoji:'📲', label:'Triggers Multimedia', file:'12_triggers_multimedia.md', color:'cyan',
              desc:'Frases exactas que activan fotos, catálogos, QR y recursos automáticos.',
              placeholder:'## Triggers de catálogo (nivel 1 — varios recursos)\n\n### Catálogo completo por equipo\n| Equipo | Frase exacta | Qué envía |\n|--------|-------------|-----------|\n| Colombia | colores colombia | Todos los colores Colombia |\n\n## Triggers de color individual (nivel 2)\n\n### Colombia\n- Marfil: colombia marfil\n- Blanco: colombia blanco\n\n## Triggers de recursos\n| Recurso | Frase exacta |\n|---------|-------------|\n| Guía de tallas | guia de tallas |\n| QR Pago | transferencia, qr, bancolombia, nequi |\n\n## Reglas\n- NUNCA escribir el nombre del archivo (.jpg, .png)\n- Escribir la frase INTEGRADA naturalmente en el mensaje\n- Si el trigger tiene coma, escribir AMBAS palabras clave',
              val: modTriggers, set: setModTriggers
            },
            {
              id:'catalogo', num:'13', emoji:'🗂️', label:'Contexto Catálogo', file:'13_contexto_catalogo.json', color:'amber',
              desc:'Disponibilidad en tiempo real, stock, novedades y productos destacados.',
              placeholder:'## Estado del catálogo\n\n### Disponibilidad\n| Equipo | Colores activos | Colores agotados | Nota |\n|--------|----------------|-----------------|------|\n| Colombia | Marfil, Blanco, Negro | — | Marfil es el más pedido |\n| Millonarios | Azul, Gris, Blanco, Negro | — | Azul tiene 2 diseños |\n\n## Novedades y lanzamientos\n[productos nuevos o ediciones limitadas]\n\n## Productos destacados esta semana\n[para mencionar proactivamente]\n\n## Restricciones temporales\n[colores o tallas con stock limitado — actualizar semanalmente]',
              val: modCatalogo, set: setModCatalogo
            },
            {
              id:'nlu', num:'14', emoji:'🔤', label:'NLU Map', file:'14_nlu_map.json', color:'violet',
              desc:'Sinónimos, variaciones locales y entidades para entender cualquier forma de escribir.',
              placeholder:'## Mapa de entidades\n\n### Equipos — sinónimos aceptados\n```json\n{\n  "Millonarios": ["millos", "embajadores", "el azul"],\n  "Nacional": ["verdolaga", "el verde", "atletico"],\n  "Santa Fe": ["cardenales", "el rojo", "santafe"],\n  "Real Madrid": ["madrid", "merengues", "real"],\n  "Colombia": ["tricolor", "cafeteros", "selección"]\n}\n```\n\n### Tallas — sinónimos\n```json\n{\n  "XS": ["extrapequeña", "xs"],\n  "S": ["pequeña", "chica"],\n  "M": ["mediana", "media"],\n  "L": ["grande", "l"],\n  "XL": ["extra grande", "xl"],\n  "2XL": ["xxl", "doble xl", "doble extra"]\n}\n```\n\n### Calidades — sinónimos\n```json\n{\n  "Premium": ["300 gramos", "el grueso", "el bueno", "300g"],\n  "Monaco": ["260 gramos", "el delgado", "el liviano", "260g"]\n}\n```\n\n### Intenciones coloquiales\n```json\n{\n  "comprar": ["le meto", "me lo llevo", "dale", "va", "listo", "sí"],\n  "cancelar": ["no va", "déjelo así", "no gracias"],\n  "pedir_descuento": ["no le puede bajar", "rebájame", "sale en algo menos"]\n}\n```',
              val: modNlu, set: setModNlu
            },
            {
              id:'ofertas', num:'15', emoji:'💡', label:'Motor de Ofertas', file:'15_motor_ofertas.json', color:'green',
              desc:'Reglas de descuentos automáticos, promociones activas y lógica de Order Bumps.',
              placeholder:'## Reglas de descuento\n\n### Order Bump 1 — 2do artículo\n- Descuento: 15% sobre precio base del 2do\n- Cuándo ofrecer: después del resumen del 1er artículo, siempre\n- Cómo ofrecer: [ver plantilla Módulo 05]\n\n### Order Bump 2 — 3er artículo\n- Descuento: 20% sobre precio base del 3er\n- Cuándo ofrecer: después de confirmar el 2do artículo\n\n### Descuento especial — 10%\n- Condición: SOLO si el cliente lo pide explícitamente\n- Aplicar sobre: total final (incluyendo envío)\n- NUNCA ofrecer proactivamente\n\n## Promociones activas\n[actualizar con campañas vigentes]\n\nEjemplo:\n```\nPromoción: 3x2 en Monaco niño\nVigencia: hasta [fecha]\nCondición: comprar 3 buzos Monaco niño → el más barato es gratis\n```\n\n## Temporadas especiales\n[Día del padre, Navidad, rebajas — definir lógica por fecha]\n\n## Reglas anti-descuento\n- El 1er artículo NUNCA tiene descuento automático\n- No acumular Order Bump + 10% sin validar el total\n- Tarjeta de crédito: siempre añadir 5% antes de mostrar total',
              val: modOfertas, set: setModOfertas
            },
            {
              id:'botones', num:'16', emoji:'🔘', label:'Botones Interactivos', file:'16_botones.json', color:'pink',
              desc:'Mapa de botones y listas interactivas por paso del flujo. El backend los envía automáticamente.',
              placeholder:'{\n  "DESCRIPCION": "Botones interactivos por paso del flujo de ventas",\n  "pasos": {\n    "SALUDO_INICIAL": {\n      "tipo": "button",\n      "interactive_json": {\n        "type": "button",\n        "body": "¡Hola! ¿En qué te puedo ayudar? 👇",\n        "buttons": ["Ver catálogo 👕", "Ver precios 💰", "Hablar con asesor"]\n      }\n    }\n  }\n}',
              val: modBotones, set: setModBotones
            },
          ].filter(m => m.id === activeModule).map(mod => (
            <div key={mod.id} className="card p-0 overflow-hidden">
              <div className={`p-4 border-b border-white/5 bg-${mod.color}-500/5 flex items-start justify-between gap-3`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl bg-${mod.color}-500/15 border border-${mod.color}-500/25 flex items-center justify-center text-lg flex-shrink-0`}>{mod.emoji}</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className={`font-semibold text-${mod.color}-200 text-sm`}>Módulo {mod.num} — {mod.label}</h3>
                      <span className="text-[9px] font-mono text-white/25 bg-white/5 px-1.5 py-0.5 rounded">{mod.file}</span>
                    </div>
                    <p className="text-xs text-white/40 mt-0.5">{mod.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] text-white/30 bg-white/5 px-2 py-1 rounded-full">{mod.val.length} chars</span>
                  <button onClick={() => mod.set(mod.placeholder)} className="px-2 py-1 rounded-lg text-[10px] bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70 transition-all flex items-center gap-1">
                    <Sparkles className="w-3 h-3"/>Plantilla
                  </button>
                </div>
              </div>
              <textarea
                value={mod.val}
                onChange={e => mod.set(e.target.value)}
                placeholder={mod.placeholder}
                className="w-full min-h-[380px] p-5 bg-[var(--bg-primary)] text-white/90 text-sm resize-none focus:outline-none leading-relaxed font-mono"
              />
            </div>
          ))}

          {/* 📍 Cobertura de Domicilio */}
          {/* 📍 Cobertura de Domicilio */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex-1">
                <h3 className="font-semibold text-white flex items-center gap-2">
                  📍 Cobertura de Domicilio
                  <span className="text-xs font-normal text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full">Opcional</span>
                  {coverageSaved && (
                    <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full animate-pulse">
                      ✅ Guardado
                    </span>
                  )}
                </h3>
                <p className="text-sm text-[var(--text-muted)] mt-0.5">
                  Si tu negocio tiene servicio a domicilio, configura el radio de cobertura. La IA detectará automáticamente si el cliente está dentro del área cuando comparta su ubicación por WhatsApp.
                </p>
              </div>
              <button
                onClick={handleSaveCoverage}
                disabled={savingCoverage || (!coverageLat && !coverageLon && !coverageRadiusKm)}
                className="ml-4 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: coverageSaved ? 'rgba(16,185,129,0.2)' : 'var(--accent)', color: coverageSaved ? '#10b981' : 'white', border: coverageSaved ? '1px solid rgba(16,185,129,0.4)' : 'none' }}
              >
                {savingCoverage ? '⏳ Guardando...' : coverageSaved ? '✅ Guardado' : '💾 Guardar Cobertura'}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Latitud del negocio</label>
                <input
                  type="number" step="0.0001"
                  value={coverageLat}
                  onChange={(e) => setCoverageLat(e.target.value)}
                  placeholder="ej: 4.6189"
                  className="input w-full text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Longitud del negocio</label>
                <input
                  type="number" step="0.0001"
                  value={coverageLon}
                  onChange={(e) => setCoverageLon(e.target.value)}
                  placeholder="ej: -74.1289"
                  className="input w-full text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Radio de cobertura (km)</label>
                <input
                  type="number" step="0.5" min="0.5" max="50"
                  value={coverageRadiusKm}
                  onChange={(e) => setCoverageRadiusKm(e.target.value)}
                  placeholder="ej: 3"
                  className="input w-full text-sm"
                />
              </div>
            </div>
            {(coverageLat || coverageLon || coverageRadiusKm) && (
              <div className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400 flex items-start gap-2">
                <span>✅</span>
                <span>
                  Cobertura activa — Radio de <strong>{coverageRadiusKm || '?'} km</strong> desde ({coverageLat || '?'}, {coverageLon || '?'}).
                  Cuando un cliente comparta su ubicación por WhatsApp, el sistema calculará automáticamente si está dentro del área.
                  {' '}<a href={"https://maps.google.com/?q=" + coverageLat + "," + coverageLon} target="_blank" rel="noreferrer" className="underline hover:text-emerald-300">Ver en Google Maps ↗</a>
                </span>
              </div>
            )}
            {!coverageLat && !coverageLon && (
              <p className="text-xs text-[var(--text-muted)] mt-3 flex items-center gap-1.5">
                <span>💡</span> Para obtener las coordenadas: abre Google Maps, haz clic derecho en la ubicación del negocio y copia las coordenadas.
              </p>
            )}
          </div>

          {/* Knowledge Items */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-white">Respuestas Rápidas</h3>
                <p className="text-sm text-[var(--text-muted)]">Respuestas específicas para palabras clave</p>
              </div>
              <button onClick={addKnowledgeItem} className="btn-secondary text-sm py-2"><Plus className="w-4 h-4" />Agregar</button>
            </div>
            <div className="space-y-4">
              {knowledgeItems.map((item, index) => (
                <div key={item.id} className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input type="text" value={item.title} onChange={(e) => updateKnowledgeItem(index, 'title', e.target.value)} placeholder="Título (ej: Horarios)" className="input text-sm" />
                        <input type="text" value={item.triggers || ''} onChange={(e) => updateKnowledgeItem(index, 'triggers', e.target.value)} placeholder="Palabras clave: horario, abren..." className="input text-sm" />
                      </div>
                      <textarea value={item.content} onChange={(e) => updateKnowledgeItem(index, 'content', e.target.value)} placeholder="Respuesta..." className="input min-h-[80px] text-sm" />
                    </div>
                    <button onClick={() => removeKnowledgeItem(index)} className="btn-icon text-red-400 hover:bg-red-500/20"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
              {knowledgeItems.length === 0 && (
                <div className="text-center py-8 text-[var(--text-muted)] border-2 border-dashed border-[var(--border-primary)] rounded-xl">
                  <Brain className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">Sin respuestas rápidas</p>
                  <p className="text-sm">Agrega respuestas para palabras clave específicas</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== MEDIA TAB ==================== */}
      {activeTab === 'media' && (
        <div className="space-y-6">
          <div className="card">
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-white mb-2">Biblioteca Multimedia</h3>
              <p className="text-[var(--text-muted)]">Sube archivos que el asistente enviará automáticamente cuando detecte el trigger en la conversación.</p>
              {/* 📏 Storage indicator — from backend */}
              {(mediaItems.length > 0 || storageInfo) && (
                <div className="mt-3 p-2.5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-[var(--text-muted)]">
                      {mediaItems.length} archivo{mediaItems.length !== 1 ? 's' : ''} · {storageUsedMB.toFixed(1)}MB / {storageLimitMB}MB
                    </span>
                    <span className={`text-xs font-medium ${storagePercent > 80 ? 'text-red-400' : storagePercent > 50 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {storagePercent > 90 ? '🚨 Casi lleno' : storagePercent > 80 ? '⚠️ Poco espacio' : storagePercent > 50 ? '⚡ Moderado' : '✓ OK'}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${storagePercent > 80 ? 'bg-red-500' : storagePercent > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(storagePercent, 100)}%` }} />
                  </div>
                </div>
              )}
              {uploadingMedia && (
                <div className="mt-2 flex items-center gap-2 text-xs text-blue-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Subiendo y comprimiendo...
                </div>
              )}
            </div>

            {/* Upload Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <label className="card glass-hover cursor-pointer text-center py-8 border-2 border-dashed border-[var(--border-primary)] hover:border-blue-500/50">
                <input type="file" accept="image/*" className="hidden" onChange={(e) => handleMediaUpload(e, 'image')} />
                <div className="w-16 h-16 rounded-2xl bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
                  <Image className="w-8 h-8 text-blue-400" />
                </div>
                <h4 className="font-semibold text-white mb-1">Imágenes</h4>
                <p className="text-xs text-[var(--text-muted)]">Catálogo, productos, local</p>
                <p className="text-xs text-blue-400 mt-2">Máx 5MB</p>
              </label>

              {/* 📂 CATÁLOGO: Múltiples imágenes por trigger */}
              <div onClick={createCatalog} className="card glass-hover cursor-pointer text-center py-8 border-2 border-dashed border-[var(--border-primary)] hover:border-emerald-500/50">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-8 h-8 text-emerald-400" />
                </div>
                <h4 className="font-semibold text-white mb-1">Catálogo</h4>
                <p className="text-xs text-[var(--text-muted)]">Hasta 10 imágenes</p>
                <p className="text-xs text-emerald-400 mt-2">Envío múltiple</p>
              </div>

              <label className="card glass-hover cursor-pointer text-center py-8 border-2 border-dashed border-[var(--border-primary)] hover:border-purple-500/50">
                <input type="file" accept="video/*" className="hidden" onChange={(e) => handleMediaUpload(e, 'video')} />
                <div className="w-16 h-16 rounded-2xl bg-purple-500/20 flex items-center justify-center mx-auto mb-4">
                  <Video className="w-8 h-8 text-purple-400" />
                </div>
                <h4 className="font-semibold text-white mb-1">Videos</h4>
                <p className="text-xs text-[var(--text-muted)]">Tutoriales, demos, tours</p>
                <p className="text-xs text-purple-400 mt-2">Máx 15MB</p>
              </label>

              <label className="card glass-hover cursor-pointer text-center py-8 border-2 border-dashed border-[var(--border-primary)] hover:border-orange-500/50">
                <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleMediaUpload(e, 'audio')} />
                <div className="w-16 h-16 rounded-2xl bg-orange-500/20 flex items-center justify-center mx-auto mb-4">
                  <Music className="w-8 h-8 text-orange-400" />
                </div>
                <h4 className="font-semibold text-white mb-1">Audios</h4>
                <p className="text-xs text-[var(--text-muted)]">Mensajes de voz</p>
                <p className="text-xs text-orange-400 mt-2">Máx 5MB</p>
              </label>
            </div>

            {/* 🛒 Order Bump: Productos del catálogo */}
            <div className="p-3 rounded-xl border border-emerald-500/15 bg-emerald-500/5 mb-4">
              <div className="flex items-center gap-3">
                <span className="text-lg">📦</span>
                <div className="flex-1">
                  <p className="text-xs text-gray-400">¿Necesitas más productos en tu catálogo? Amplía tu límite.</p>
                </div>
                <a href="/subscription#addons" className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all whitespace-nowrap">
                  +10 Productos — $20 USD
                </a>
              </div>
            </div>

            {/* Media Grid */}
            {mediaItems.length > 0 ? (
              <div className="space-y-4">
                {mediaItems.map((item, index) => (
                  <div key={item.id} className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                    {item.type === 'catalog' ? (
                      /* ===== 📂 CATÁLOGO: Múltiples imágenes ===== */
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                              <FileText className="w-4 h-4 text-emerald-400" />
                            </div>
                            <input type="text" value={item.name || ''} 
                              onChange={(e) => updateMediaItem(index, 'name', e.target.value)}
                              className="bg-transparent border-none text-white font-medium text-sm focus:outline-none" 
                              placeholder="Nombre del catálogo" />
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                              catálogo · {(item.images || []).length}/10 imgs
                            </span>
                          </div>
                          <button onClick={() => removeMedia(index)} className="btn-icon text-red-400 hover:bg-red-500/20">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Imágenes del catálogo */}
                        <div className="flex flex-wrap gap-2">
                          {(item.images || []).map((img: any) => (
                            <div key={img.id} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-[var(--border-primary)]">
                              <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                              <button onClick={() => removeImageFromCatalog(index, img.id)}
                                className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <X className="w-3 h-3 text-white" />
                              </button>
                              <p className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] text-white text-center py-0.5 truncate px-1">{img.name}</p>
                            </div>
                          ))}
                          {(item.images || []).length < 10 && (
                            <label className="w-20 h-20 rounded-lg border-2 border-dashed border-[var(--border-primary)] hover:border-emerald-500/50 flex flex-col items-center justify-center cursor-pointer transition-all">
                              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addImageToCatalog(index, e)} />
                              <Plus className="w-5 h-5 text-[var(--text-muted)]" />
                              <span className="text-[8px] text-[var(--text-muted)] mt-0.5">Agregar</span>
                            </label>
                          )}
                        </div>

                        {/* Trigger + Caption */}
                        <input type="text" placeholder="🔑 Triggers: catalogo, colores, productos (separados por coma)"
                          value={item.trigger || ''} onChange={(e) => updateMediaItem(index, 'trigger', e.target.value)}
                          className="input text-sm w-full" />
                        <input type="text" placeholder="💬 Caption opcional (texto que acompaña las imágenes)"
                          value={item.caption || ''} onChange={(e) => updateMediaItem(index, 'caption', e.target.value)}
                          className="input text-sm w-full" />
                        {!item.trigger && (
                          <p className="text-xs text-yellow-400 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />Define un trigger para activar el envío automático
                          </p>
                        )}
                        {(item.images || []).length === 0 && (
                          <p className="text-xs text-yellow-400 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />Agrega al menos una imagen al catálogo
                          </p>
                        )}
                      </div>
                    ) : (
                      /* ===== ARCHIVO INDIVIDUAL (imagen, video, audio) ===== */
                      <div className="flex items-start gap-4">
                        {/* Preview */}
                        <div className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-[var(--bg-primary)] flex items-center justify-center">
                          {item.type === 'image' && item.url ? (
                            <img src={item.url} alt={item.name} className="w-full h-full object-cover" />
                          ) : item.type === 'video' ? (
                            <Video className="w-8 h-8 text-purple-400" />
                          ) : (
                            <Music className="w-8 h-8 text-orange-400" />
                          )}
                        </div>

                        {/* Info + Trigger */}
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white">{item.name}</span>
                            <span className="text-[10px] text-[var(--text-muted)] bg-white/5 px-2 py-0.5 rounded">{formatSize(item.size || 0)}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded ${
                              item.type === 'image' ? 'bg-blue-500/20 text-blue-400' :
                              item.type === 'video' ? 'bg-purple-500/20 text-purple-400' : 'bg-orange-500/20 text-orange-400'
                            }`}>{item.type}</span>
                          </div>
                          <input type="text" placeholder="🔑 Triggers: catalogo, menu, productos (separados por coma)"
                            value={item.trigger || ''} onChange={(e) => updateMediaItem(index, 'trigger', e.target.value)}
                            className="input text-sm w-full" />
                          <input type="text" placeholder="💬 Caption opcional (texto que acompaña al archivo)"
                            value={item.caption || ''} onChange={(e) => updateMediaItem(index, 'caption', e.target.value)}
                            className="input text-sm w-full" />
                          {!item.trigger && (
                            <p className="text-xs text-yellow-400 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />Define un trigger para activar el envío automático
                            </p>
                          )}
                        </div>

                        {/* Delete */}
                        <button onClick={() => removeMedia(index)} className="btn-icon text-red-400 hover:bg-red-500/20 flex-shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-[var(--text-muted)] border-2 border-dashed border-[var(--border-primary)] rounded-xl">
                <Image className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Sin archivos multimedia</p>
                <p className="text-sm">Sube archivos para que el asistente los envíe automáticamente</p>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="card bg-blue-500/5 border-blue-500/20">
            <h4 className="font-semibold text-blue-400 mb-3 flex items-center gap-2"><Zap className="w-4 h-4" />Cómo funciona</h4>
            <ul className="text-sm text-[var(--text-muted)] space-y-2">
              <li>• <strong className="text-white">Trigger:</strong> Palabra clave que activa el envío del archivo</li>
              <li>• Si el cliente dice "envíame el catálogo" y tienes una imagen con trigger "catalogo", se enviará automáticamente</li>
              <li>• Múltiples triggers separados por coma: "menu, carta, precios"</li>
              <li>• <strong className="text-white">Caption:</strong> Texto opcional que acompaña al archivo</li>
              <li>• <strong className="text-emerald-400">Catálogo:</strong> Agrupa hasta 10 imágenes con un solo trigger. Se envían todas en secuencia cuando el cliente activa la palabra clave</li>
              <li>• La IA responderá primero con texto, y luego enviará el archivo o catálogo</li>
              <li>• <strong className="text-yellow-400">Importante:</strong> Haz clic en "Guardar Todo" después de agregar/editar archivos</li>
            </ul>
          </div>
        </div>
      )}

      {/* ==================== LEARNING TAB ==================== */}
      {activeTab === 'learning' && (
        <div className="space-y-6">
          {/* Header */}
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--accent-primary)] to-teal-400 flex items-center justify-center">
                  <Brain className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">Auto-Aprendizaje</h3>
                  <p className="text-[var(--text-muted)]">El asistente analiza conversaciones reales y sugiere mejoras</p>
                </div>
              </div>
              <button onClick={() => setAutoLearn(!autoLearn)}
                className={`relative w-16 h-8 rounded-full transition-all ${autoLearn ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-tertiary)]'}`}>
                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all ${autoLearn ? 'left-9' : 'left-1'}`} />
              </button>
            </div>
          </div>

          {/* How it works */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card text-center">
              <div className="w-14 h-14 rounded-xl bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-7 h-7 text-blue-400" />
              </div>
              <h4 className="font-semibold text-white mb-2">1. Analiza</h4>
              <p className="text-sm text-[var(--text-muted)]">Revisa las últimas 20 conversaciones reales</p>
            </div>
            <div className="card text-center">
              <div className="w-14 h-14 rounded-xl bg-purple-500/20 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-7 h-7 text-purple-400" />
              </div>
              <h4 className="font-semibold text-white mb-2">2. Sugiere</h4>
              <p className="text-sm text-[var(--text-muted)]">OpenAI genera mejoras concretas al contexto</p>
            </div>
            <div className="card text-center">
              <div className="w-14 h-14 rounded-xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                <TrendingUp className="w-7 h-7 text-emerald-400" />
              </div>
              <h4 className="font-semibold text-white mb-2">3. Aplica</h4>
              <p className="text-sm text-[var(--text-muted)]">Tú decides qué mejoras agregar al contexto</p>
            </div>
          </div>

          {/* Analyze Button */}
          <div className="card text-center">
            <button onClick={analyzeConversations} disabled={analyzing} className="btn-primary px-8 py-3 text-base">
              {analyzing ? (
                <><Loader2 className="w-5 h-5 animate-spin" />Analizando conversaciones...</>
              ) : (
                <><Brain className="w-5 h-5" />Analizar Conversaciones Ahora</>
              )}
            </button>
            <p className="text-xs text-[var(--text-muted)] mt-3">Usa tu API Key de OpenAI para analizar patrones y generar sugerencias</p>
          </div>

          {/* Pending Suggestions */}
          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              Sugerencias Pendientes
              {pendingSuggestions.length > 0 && (
                <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded-full">{pendingSuggestions.length}</span>
              )}
            </h3>
            
            {pendingSuggestions.length > 0 ? (
              <div className="space-y-3">
                {pendingSuggestions.map((item) => (
                  <div key={item.id} className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                    <div className="flex items-start gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">Pendiente</span>
                          <span className="text-xs text-[var(--text-muted)] bg-white/5 px-2 py-0.5 rounded">{item.type?.replace('_', ' ')}</span>
                        </div>
                        <p className="text-sm font-medium text-white mb-1">{item.title}</p>
                        <p className="text-sm text-emerald-400 bg-emerald-500/5 p-3 rounded-lg border border-emerald-500/20 mb-2 font-mono text-xs whitespace-pre-wrap">{item.suggestion}</p>
                        <p className="text-xs text-[var(--text-muted)]">💡 {item.reason}</p>
                      </div>
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <button onClick={() => applySuggestion(item)} disabled={applyingId === item.id}
                          className="btn-primary text-xs py-2 px-3">
                          {applyingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Aplicar
                        </button>
                        <button onClick={() => dismissSuggestion(item)} className="btn-secondary text-xs py-2 px-3">
                          <X className="w-3 h-3" />Descartar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-[var(--text-muted)] border-2 border-dashed border-[var(--border-primary)] rounded-xl">
                <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Sin sugerencias pendientes</p>
                <p className="text-sm">Haz clic en "Analizar Conversaciones" para generar sugerencias</p>
              </div>
            )}
          </div>

          {/* Applied History */}
          {appliedSuggestions.length > 0 && (
            <div className="card">
              <h3 className="text-lg font-semibold text-white mb-4">Historial Aplicado</h3>
              <div className="space-y-2">
                {appliedSuggestions.slice(0, 10).map((item) => (
                  <div key={item.id} className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 flex items-center gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{item.title}</p>
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">{item.appliedAt ? new Date(item.appliedAt).toLocaleDateString() : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== VOICE TAB ==================== */}
      {activeTab === 'voice' && (
        <div className="space-y-6">
          <div className="card">
            
            {/* ===== SELECTOR DE PROVEEDOR DE IA ===== */}
            <div className="mb-8 p-6 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-blue-600 flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">Proveedor de IA</h3>
                  <p className="text-sm text-[var(--text-muted)]">Elige con qué inteligencia artificial responderá este asistente</p>
                </div>
              </div>

              {/* Cards de selección */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                {/* OpenAI */}
                <div
                  onClick={() => { setAiProvider('openai'); setAiModel('gpt-4o-mini'); }}
                  className={`cursor-pointer rounded-xl p-4 border-2 transition-all ${aiProvider === 'openai' ? 'border-green-500 bg-green-500/10' : 'border-[var(--border-primary)] hover:border-green-500/50'}`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center text-sm font-bold text-green-400">AI</div>
                    <span className="font-semibold text-white">OpenAI</span>
                    {aiProvider === 'openai' && <span className="ml-auto text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">Activo</span>}
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">GPT-4o, GPT-4 Turbo, GPT-3.5 — Poderoso y versátil</p>
                </div>

                {/* Groq */}
                <div
                  onClick={() => { setAiProvider('groq'); setAiModel('llama-3.3-70b-versatile'); }}
                  className={`cursor-pointer rounded-xl p-4 border-2 transition-all ${aiProvider === 'groq' ? 'border-purple-500 bg-purple-500/10' : 'border-[var(--border-primary)] hover:border-purple-500/50'}`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-sm font-bold text-purple-400">⚡</div>
                    <span className="font-semibold text-white">Groq</span>
                    <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">10x rápido</span>
                    {aiProvider === 'groq' && <span className="ml-auto text-xs bg-purple-500/30 text-purple-300 px-2 py-0.5 rounded-full">Activo</span>}
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">Llama 3.3, Mixtral, Gemma — Ultrarrápido y económico</p>
                </div>
              </div>

              {/* Selector de modelo */}
              <div>
                <label className="input-label">Modelo específico</label>
                <select
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  className="input w-full"
                >
                  {aiProvider === 'openai' ? (
                    <>
                      <option value="gpt-4o-mini">GPT-4o Mini — Rápido y económico (recomendado)</option>
                      <option value="gpt-4o">GPT-4o — El más inteligente de OpenAI</option>
                      <option value="gpt-4-turbo-preview">GPT-4 Turbo — Potente y versátil</option>
                      <option value="gpt-3.5-turbo">GPT-3.5 Turbo — Más económico</option>
                    </>
                  ) : (
                    <>
                      <option value="llama-3.3-70b-versatile">Llama 3.3 70B — Ultra rápido, mejor calidad (recomendado)</option>
                      <option value="llama-3.1-8b-instant">Llama 3.1 8B — El más rápido, ideal para soporte</option>
                      <option value="mixtral-8x7b-32768">Mixtral 8x7B — Excelente en español</option>
                      <option value="gemma2-9b-it">Gemma 2 9B — Preciso y eficiente</option>
                      <option value="llama-3.1-70b-versatile">Llama 3.1 70B — Gran razonamiento</option>
                    </>
                  )}
                </select>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {aiProvider === 'groq'
                    ? '⚡ Groq usa hardware LPU especializado — respuestas en ~200ms vs ~2s de OpenAI'
                    : '🧠 OpenAI ofrece los modelos más avanzados del mercado'}
                </p>
              </div>
            </div>

<div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <Mic className="w-8 h-8 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">ElevenLabs Text-to-Speech</h3>
                <p className="text-[var(--text-muted)]">El asistente responde con notas de voz de IA</p>
              </div>
            </div>

            <div className="space-y-4">
              {/* API Key */}
              <div>
                <label className="input-label">Tu API Key de ElevenLabs</label>
                <input type="password" value={elevenLabsKey} onChange={(e) => setElevenLabsKey(e.target.value)}
                  placeholder="sk_..." className="input w-full font-mono" />
              </div>

              {/* Voice ID - MANUAL (principal) */}
              <div>
                <label className="input-label">Voice ID</label>
                <div className="flex gap-3">
                  <input type="text" value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)}
                    placeholder="Pega tu Voice ID... (ej: EXAVITQu4vr4xnSDxMaL)" className="input flex-1 font-mono text-sm" />
                  {selectedVoice && elevenLabsKey && (
                    <button onClick={() => previewVoice(selectedVoice)} disabled={testingVoice} className="btn-secondary"
                      title="Escuchar vista previa">
                      {testingVoice ? <div className="loading-spinner w-4 h-4" /> : <Play className="w-4 h-4" />}
                      Probar
                    </button>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Ve a <a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">ElevenLabs → Voices</a> → 
                  clic en la voz → "Copy Voice ID"
                </p>
              </div>

              {/* O cargar voces automáticamente */}
              <div className="border-t border-[var(--border-primary)] pt-4">
                <button onClick={testElevenLabs} disabled={!elevenLabsKey || testingVoice} className="btn-secondary w-full">
                  {testingVoice ? <div className="loading-spinner w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                  O cargar mis voces automáticamente
                </button>
              </div>

              {elevenLabsVoices.length > 0 && (
                <div>
                  <label className="input-label">Selecciona de tus voces</label>
                  <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} className="input w-full">
                    <option value="">-- Selecciona una voz --</option>
                    {elevenLabsVoices.map((voice) => (
                      <option key={voice.voice_id} value={voice.voice_id}>
                        {voice.name} {voice.labels?.accent ? `(${voice.labels.accent})` : ''} {voice.labels?.gender ? `- ${voice.labels.gender}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Toggle activar */}
              {selectedVoice && elevenLabsKey && (
                <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                  <div>
                    <h4 className="font-medium text-white">Activar respuestas de voz</h4>
                    <p className="text-sm text-[var(--text-muted)]">La IA decidirá cuándo responder con voz según el contexto</p>
                  </div>
                  <button onClick={() => setVoiceEnabled(!voiceEnabled)}
                    className={`relative w-16 h-8 rounded-full transition-all ${voiceEnabled ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-primary)]'}`}>
                    <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all ${voiceEnabled ? 'left-9' : 'left-1'}`} />
                  </button>
                </div>
              )}

              {voiceEnabled && selectedVoice && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <h4 className="font-medium text-emerald-400 mb-2">🔊 Voz IA Activa</h4>
                  <p className="text-sm text-[var(--text-muted)] mb-3">
                    Controla cuándo la IA responde con voz desde tu contexto:
                  </p>
                  <div className="space-y-2 text-xs text-[var(--text-muted)] bg-black/20 rounded-lg p-3 font-mono">
                    <p className="text-emerald-400">// Ejemplo en tu contexto:</p>
                    <p>- Saluda siempre con nota de voz</p>
                    <p>- Usa voz al confirmar pedidos</p>
                    <p>- NO uses voz para datos técnicos o links</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card bg-purple-500/5 border-purple-500/20">
            <h4 className="font-semibold text-purple-400 mb-3 flex items-center gap-2"><Key className="w-4 h-4" />Cómo configurar</h4>
            <ol className="text-sm text-[var(--text-muted)] space-y-2">
              <li>1. Ve a <a href="https://elevenlabs.io/app/developers/api-keys" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">elevenlabs.io → API Keys</a> y copia tu clave</li>
              <li>2. Ve a <a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">elevenlabs.io → Voices</a> y copia el Voice ID</li>
              <li>3. Pégalos arriba, activa el toggle y dale "Guardar Todo"</li>
              <li>4. Plan gratis: 10,000 caracteres/mes (~10 min de audio)</li>
            </ol>
          </div>
        </div>
      )}

      {/* ==================== FLUJO IA TAB ==================== */}
      {activeTab === 'flow' && (
        <FlowTab
          modOrquestador={modOrquestador}
          modFlujo={modFlujo}
          modReglas={modReglas}
          modIdentidad={modIdentidad}
          modAcciones={modAcciones}
          modMemoria={modMemoriaCliente}
          agenteCliente={agenteCliente}
          modBotones={modBotones}
          onUpdateModFlujo={setModFlujo}
        />
      )}
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

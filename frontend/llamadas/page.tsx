'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Phone, PhoneCall, PhoneOff, PhoneMissed, PhoneOutgoing, PhoneIncoming,
  Settings, History, BarChart3, Play, Pause, Volume2, Mic, MicOff,
  Search, Filter, ChevronDown, ChevronRight, X, Check, Loader,
  Zap, Clock, DollarSign, TrendingUp, User, Users, Calendar,
  MessageSquare, FileText, Download, RefreshCw, AlertCircle, CheckCircle,
  Radio, Headphones, Bot, Sparkles, Globe, Shield
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ============================================
// TIPOS
// ============================================
interface CallConfig {
  id: string;
  isActive: boolean;
  retellAgentId: string | null;
  retellPhoneNumber: string | null;
  voiceId: string;
  voiceProvider: string;
  voiceModel: string;
  voiceSpeed: number;
  voiceTemperature: number;
  agentName: string;
  agentLanguage: string;
  agentGreeting: string;
  agentPrompt: string;
  enableAutoReminders: boolean;
  reminderHoursBefore: number;
  maxCallDuration: number;
  enableBackchannel: boolean;
  minutesUsed: number;
  minutesLimit: number;
  hasRetellKey: boolean;
}

interface Voice {
  voice_id: string;
  voice_name: string;
  provider: string;
  gender: string;
  accent: string;
  age: string;
  preview_audio_url: string | null;
}

interface Call {
  id: string;
  direction: string;
  fromNumber: string;
  toNumber: string;
  toName: string | null;
  status: string;
  duration: number | null;
  costUsd: number | null;
  transcript: string | null;
  summary: string | null;
  sentiment: string | null;
  recordingUrl: string | null;
  callType: string;
  endReason: string | null;
  createdAt: string;
}

interface Stats {
  totalCalls: number;
  monthCalls: number;
  completedCalls: number;
  totalMinutes: number;
  minutesUsed: number;
  isActive: boolean;
  phoneNumber: string | null;
}

// ============================================
// HELPERS
// ============================================
const apiFetch = async (path: string, opts: any = {}) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error de servidor' }));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json();
};

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  initiated: { label: 'Iniciando', color: 'text-yellow-400 bg-yellow-500/20', icon: Loader },
  in_progress: { label: 'En curso', color: 'text-blue-400 bg-blue-500/20', icon: PhoneCall },
  completed: { label: 'Completada', color: 'text-emerald-400 bg-emerald-500/20', icon: CheckCircle },
  failed: { label: 'Fallida', color: 'text-red-400 bg-red-500/20', icon: PhoneMissed },
  no_answer: { label: 'Sin respuesta', color: 'text-gray-400 bg-gray-500/20', icon: PhoneOff },
};

const CALL_TYPE_MAP: Record<string, { label: string; icon: string }> = {
  manual: { label: 'Manual', icon: '📞' },
  reminder: { label: 'Recordatorio', icon: '⏰' },
  auto_reminder: { label: 'Auto-recordatorio', icon: '🤖' },
  inbound: { label: 'Entrante', icon: '📲' },
};

const SENTIMENT_MAP: Record<string, { label: string; color: string }> = {
  positive: { label: 'Positivo', color: 'text-emerald-400' },
  neutral: { label: 'Neutral', color: 'text-gray-400' },
  negative: { label: 'Negativo', color: 'text-red-400' },
};

const PROVIDER_COLORS: Record<string, string> = {
  elevenlabs: 'from-violet-500/30 to-purple-600/20 border-violet-500/30',
  openai: 'from-emerald-500/30 to-green-600/20 border-emerald-500/30',
  deepgram: 'from-blue-500/30 to-cyan-600/20 border-blue-500/30',
  cartesia: 'from-orange-500/30 to-amber-600/20 border-orange-500/30',
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'Ahora';
  if (diff < 3600000) return `Hace ${Math.floor(diff / 60000)} min`;
  if (diff < 86400000) return `Hace ${Math.floor(diff / 3600000)}h`;
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ============================================
// COMPONENTE PRINCIPAL
// ============================================
export default function LlamadasPage() {
  const [tab, setTab] = useState<'dashboard' | 'history' | 'config'>('dashboard');
  const [config, setConfig] = useState<CallConfig | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [totalCalls, setTotalCalls] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [cfgData, voicesData, statsData, histData] = await Promise.all([
        apiFetch('/api/calls/config'),
        apiFetch('/api/calls/voices'),
        apiFetch('/api/calls/stats').catch(() => null),
        apiFetch('/api/calls/history?limit=10').catch(() => ({ calls: [], total: 0 })),
      ]);
      setConfig(cfgData);
      setVoices(voicesData);
      if (statsData) setStats(statsData);
      setCalls(histData.calls || []);
      setTotalCalls(histData.total || 0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const showMsg = (msg: string, type: 'error' | 'success') => {
    if (type === 'error') { setError(msg); setTimeout(() => setError(''), 5000); }
    else { setSuccess(msg); setTimeout(() => setSuccess(''), 4000); }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader className="w-8 h-8 text-violet-400 animate-spin" />
          <p className="text-gray-400">Cargando llamadas IA...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#0a0a0f]/90 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/30 to-purple-600/20 flex items-center justify-center">
                <Phone className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Llamadas IA</h1>
                <p className="text-xs text-gray-500">Retell AI · Voz inteligente</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {config?.isActive && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs text-emerald-400 font-medium">{config.retellPhoneNumber || 'Activa'}</span>
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            {[
              { id: 'dashboard', label: 'Panel', icon: BarChart3 },
              { id: 'history', label: 'Historial', icon: History },
              { id: 'config', label: 'Configuración', icon: Settings },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === t.id ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="max-w-6xl mx-auto px-4 mt-3">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError('')} className="ml-auto"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}
      {success && (
        <div className="max-w-6xl mx-auto px-4 mt-3">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{success}</span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {!config?.isActive ? (
          <ActivationPanel
            config={config}
            voices={voices}
            activating={activating}
            onActivate={async () => {
              setActivating(true);
              try {
                const result = await apiFetch('/api/calls/activate', { method: 'POST' });
                setConfig(result.config);
                showMsg(`Línea activada: ${result.phone || 'Lista'}`, 'success');
                loadAll();
              } catch (e: any) {
                showMsg(e.message, 'error');
              } finally {
                setActivating(false);
              }
            }}
            onUpdateConfig={async (data: any) => {
              try {
                const updated = await apiFetch('/api/calls/config', { method: 'PUT', body: JSON.stringify(data) });
                setConfig(updated);
              } catch (e: any) {
                showMsg(e.message, 'error');
              }
            }}
          />
        ) : tab === 'dashboard' ? (
          <DashboardTab
            config={config}
            stats={stats}
            calls={calls}
            onCall={async (toNumber: string, toName?: string) => {
              try {
                await apiFetch('/api/calls/call', { method: 'POST', body: JSON.stringify({ toNumber, toName }) });
                showMsg(`Llamando a ${toName || toNumber}...`, 'success');
                setTimeout(loadAll, 2000);
              } catch (e: any) {
                showMsg(e.message, 'error');
              }
            }}
          />
        ) : tab === 'history' ? (
          <HistoryTab calls={calls} total={totalCalls} onRefresh={loadAll} />
        ) : (
          <ConfigTab
            config={config}
            voices={voices}
            onSave={async (data: any) => {
              try {
                const updated = await apiFetch('/api/calls/config', { method: 'PUT', body: JSON.stringify(data) });
                setConfig(updated);
                showMsg('Configuración guardada', 'success');
              } catch (e: any) {
                showMsg(e.message, 'error');
              }
            }}
            onDeactivate={async () => {
              if (!confirm('¿Desactivar línea IA? Se eliminará el número y agente.')) return;
              try {
                await apiFetch('/api/calls/deactivate', { method: 'POST' });
                showMsg('Línea desactivada', 'success');
                loadAll();
              } catch (e: any) {
                showMsg(e.message, 'error');
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

// ============================================
// PANEL DE ACTIVACIÓN
// ============================================
function ActivationPanel({ config, voices, activating, onActivate, onUpdateConfig }: {
  config: CallConfig | null;
  voices: Voice[];
  activating: boolean;
  onActivate: () => void;
  onUpdateConfig: (data: any) => void;
}) {
  const [selectedVoice, setSelectedVoice] = useState(config?.voiceId || '11labs-Adrian');
  const [playingPreview, setPlayingPreview] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const groupedVoices = voices.reduce((acc: Record<string, Voice[]>, v) => {
    (acc[v.provider] = acc[v.provider] || []).push(v);
    return acc;
  }, {});

  const playPreview = (url: string | null, voiceId: string) => {
    if (!url) return;
    if (playingPreview === voiceId) {
      audioRef.current?.pause();
      setPlayingPreview(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play();
    setPlayingPreview(voiceId);
    audio.onended = () => setPlayingPreview(null);
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-8">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500/30 to-purple-600/20 flex items-center justify-center mx-auto mb-4 border border-violet-500/20">
          <Phone className="w-10 h-10 text-violet-400" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Activa tu Línea IA</h2>
        <p className="text-gray-400 max-w-md mx-auto">
          Tu asistente IA atenderá y realizará llamadas telefónicas automáticamente.
          Selecciona una voz y activa en un click.
        </p>
      </div>

      {/* Features */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { icon: Zap, label: 'Latencia ~600ms', desc: 'Respuestas naturales', color: 'text-yellow-400' },
          { icon: Globe, label: 'Número dedicado', desc: 'Se asigna automáticamente', color: 'text-blue-400' },
          { icon: Bot, label: 'IA conversacional', desc: 'Usa contexto de tu negocio', color: 'text-violet-400' },
        ].map((f, i) => (
          <div key={i} className="p-3 rounded-xl bg-white/[0.02] border border-white/5 text-center">
            <f.icon className={`w-6 h-6 ${f.color} mx-auto mb-2`} />
            <p className="text-sm font-medium">{f.label}</p>
            <p className="text-xs text-gray-500">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Voice Selector */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Headphones className="w-4 h-4 text-violet-400" />
          Selecciona una voz
        </h3>
        
        {Object.entries(groupedVoices).map(([provider, provVoices]) => (
          <div key={provider} className="mb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              {provider === 'elevenlabs' && <span className="w-2 h-2 rounded-full bg-violet-400" />}
              {provider === 'openai' && <span className="w-2 h-2 rounded-full bg-emerald-400" />}
              {provider === 'deepgram' && <span className="w-2 h-2 rounded-full bg-blue-400" />}
              {provider}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {provVoices.map(v => (
                <button
                  key={v.voice_id}
                  onClick={() => {
                    setSelectedVoice(v.voice_id);
                    onUpdateConfig({ voiceId: v.voice_id, voiceProvider: v.provider });
                  }}
                  className={`relative p-3 rounded-xl border text-left transition-all ${
                    selectedVoice === v.voice_id
                      ? `bg-gradient-to-br ${PROVIDER_COLORS[v.provider] || 'from-gray-500/30 to-gray-600/20 border-gray-500/30'} ring-1 ring-violet-400/50`
                      : 'bg-white/[0.02] border-white/5 hover:border-white/10 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{v.voice_name}</span>
                    {v.preview_audio_url && (
                      <button
                        onClick={(e) => { e.stopPropagation(); playPreview(v.preview_audio_url, v.voice_id); }}
                        className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20"
                      >
                        {playingPreview === v.voice_id ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500">{v.gender === 'male' ? '♂' : '♀'} {v.gender === 'male' ? 'Masculina' : 'Femenina'}</span>
                    <span className="text-[10px] text-gray-600">·</span>
                    <span className="text-[10px] text-gray-500">{v.accent}</span>
                  </div>
                  {selectedVoice === v.voice_id && (
                    <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-violet-500 flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Activate Button */}
      <button
        onClick={onActivate}
        disabled={activating || !config?.hasRetellKey}
        className="w-full py-4 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-semibold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-lg shadow-violet-500/20"
      >
        {activating ? (
          <>
            <Loader className="w-5 h-5 animate-spin" />
            Activando línea...
          </>
        ) : (
          <>
            <Zap className="w-5 h-5" />
            Activar Línea IA
          </>
        )}
      </button>

      {!config?.hasRetellKey && (
        <p className="text-center text-xs text-red-400/70 mt-3">
          ⚠️ Retell API key no configurada en el servidor. Contacta al administrador.
        </p>
      )}

      <p className="text-center text-xs text-gray-600 mt-3">
        Se asignará un número telefónico US automáticamente · ~$0.15/min
      </p>
    </div>
  );
}

// ============================================
// TAB: DASHBOARD
// ============================================
function DashboardTab({ config, stats, calls, onCall }: {
  config: CallConfig;
  stats: Stats | null;
  calls: Call[];
  onCall: (num: string, name?: string) => void;
}) {
  const [phoneInput, setPhoneInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [calling, setCalling] = useState(false);

  const handleCall = async () => {
    if (!phoneInput.trim()) return;
    setCalling(true);
    await onCall(phoneInput.trim(), nameInput.trim() || undefined);
    setCalling(false);
    setPhoneInput('');
    setNameInput('');
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Llamadas este mes', value: stats?.monthCalls || 0, icon: PhoneCall, color: 'text-violet-400', bg: 'from-violet-500/20' },
          { label: 'Completadas', value: stats?.completedCalls || 0, icon: CheckCircle, color: 'text-emerald-400', bg: 'from-emerald-500/20' },
          { label: 'Minutos usados', value: `${stats?.totalMinutes || 0}`, icon: Clock, color: 'text-blue-400', bg: 'from-blue-500/20' },
          { label: 'Tu número', value: config.retellPhoneNumber || 'N/A', icon: Phone, color: 'text-amber-400', bg: 'from-amber-500/20', small: true },
        ].map((s, i) => (
          <div key={i} className={`p-4 rounded-xl bg-gradient-to-br ${s.bg} to-transparent border border-white/5`}>
            <div className="flex items-center gap-2 mb-2">
              <s.icon className={`w-4 h-4 ${s.color}`} />
              <span className="text-xs text-gray-500">{s.label}</span>
            </div>
            <p className={`${(s as any).small ? 'text-sm' : 'text-2xl'} font-bold`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Quick Call */}
      <div className="p-5 rounded-xl bg-white/[0.02] border border-white/5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <PhoneOutgoing className="w-4 h-4 text-violet-400" />
          Llamada rápida
        </h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Nombre (opcional)"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-violet-500/50 placeholder-gray-600"
          />
          <input
            type="tel"
            placeholder="Número: 3001234567"
            value={phoneInput}
            onChange={e => setPhoneInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCall()}
            className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-violet-500/50 placeholder-gray-600"
          />
          <button
            onClick={handleCall}
            disabled={!phoneInput.trim() || calling}
            className="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-all disabled:opacity-50 flex items-center gap-2 shrink-0"
          >
            {calling ? <Loader className="w-4 h-4 animate-spin" /> : <PhoneOutgoing className="w-4 h-4" />}
            Llamar
          </button>
        </div>
      </div>

      {/* Recent Calls */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <History className="w-4 h-4 text-gray-400" />
          Llamadas recientes
        </h3>
        {calls.length === 0 ? (
          <div className="text-center py-12 text-gray-600">
            <Phone className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No hay llamadas aún</p>
            <p className="text-xs mt-1">Haz tu primera llamada desde el panel de arriba</p>
          </div>
        ) : (
          <div className="space-y-2">
            {calls.slice(0, 5).map(call => (
              <CallCard key={call.id} call={call} compact />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// TAB: HISTORIAL
// ============================================
function HistoryTab({ calls, total, onRefresh }: { calls: Call[]; total: number; onRefresh: () => void }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [allCalls, setAllCalls] = useState<Call[]>(calls);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setAllCalls(calls); }, [calls]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/calls/history?page=${page + 1}&limit=20&search=${search}`);
      setAllCalls(prev => [...prev, ...data.calls]);
      setPage(p => p + 1);
    } catch {}
    setLoading(false);
  };

  const searchCalls = async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/calls/history?search=${encodeURIComponent(search)}&limit=30`);
      setAllCalls(data.calls);
    } catch {}
    setLoading(false);
  };

  return (
    <div>
      {/* Search */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Buscar por nombre, número o transcripción..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchCalls()}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-violet-500/50 placeholder-gray-600"
          />
        </div>
        <button onClick={onRefresh} className="px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all">
          <RefreshCw className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      <p className="text-xs text-gray-500 mb-3">{total} llamadas en total</p>

      {allCalls.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No hay llamadas registradas</p>
        </div>
      ) : (
        <div className="space-y-2">
          {allCalls.map(call => (
            <CallCard
              key={call.id}
              call={call}
              expanded={expanded === call.id}
              onToggle={() => setExpanded(expanded === call.id ? null : call.id)}
            />
          ))}
          {allCalls.length < total && (
            <button
              onClick={loadMore}
              disabled={loading}
              className="w-full py-3 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-gray-400 transition-all"
            >
              {loading ? 'Cargando...' : `Cargar más (${allCalls.length}/${total})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// CALL CARD
// ============================================
function CallCard({ call, compact, expanded, onToggle }: {
  call: Call;
  compact?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const st = STATUS_MAP[call.status] || STATUS_MAP.initiated;
  const ct = CALL_TYPE_MAP[call.callType] || CALL_TYPE_MAP.manual;

  return (
    <div className={`rounded-xl bg-white/[0.02] border border-white/5 overflow-hidden transition-all ${expanded ? 'ring-1 ring-violet-500/30' : ''}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/[0.02] transition-all"
      >
        {/* Direction Icon */}
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${st.color.split(' ')[1]}`}>
          {call.direction === 'inbound' ? <PhoneIncoming className="w-4 h-4" /> : <PhoneOutgoing className="w-4 h-4" />}
        </div>
        
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{call.toName || call.toNumber}</span>
            <span className="text-[10px] text-gray-600">{ct.icon}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{call.toNumber}</span>
            <span>·</span>
            <span>{formatDate(call.createdAt)}</span>
            {call.duration && (
              <>
                <span>·</span>
                <span>{formatDuration(call.duration)}</span>
              </>
            )}
          </div>
        </div>
        
        {/* Status Badge */}
        <div className={`px-2 py-1 rounded-md text-[10px] font-medium ${st.color} shrink-0`}>
          {st.label}
        </div>

        {!compact && <ChevronDown className={`w-4 h-4 text-gray-600 transition-transform ${expanded ? 'rotate-180' : ''}`} />}
      </button>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
          {/* Sentiment */}
          {call.sentiment && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">Sentimiento:</span>
              <span className={SENTIMENT_MAP[call.sentiment]?.color || 'text-gray-400'}>
                {SENTIMENT_MAP[call.sentiment]?.label || call.sentiment}
              </span>
            </div>
          )}
          
          {/* Summary */}
          {call.summary && (
            <div>
              <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Resumen IA</p>
              <p className="text-sm text-gray-300 bg-white/[0.03] rounded-lg p-3">{call.summary}</p>
            </div>
          )}
          
          {/* Transcript */}
          {call.transcript && (
            <div>
              <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Transcripción</p>
              <div className="text-xs text-gray-400 bg-white/[0.03] rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                {call.transcript}
              </div>
            </div>
          )}
          
          {/* Recording */}
          {call.recordingUrl && (
            <div>
              <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Volume2 className="w-3 h-3" /> Grabación</p>
              <audio controls src={call.recordingUrl} className="w-full h-8" />
            </div>
          )}
          
          {/* Meta */}
          <div className="flex items-center gap-4 text-[10px] text-gray-600 pt-2">
            {call.duration && <span>Duración: {formatDuration(call.duration)}</span>}
            {call.costUsd && <span>Costo: ${call.costUsd.toFixed(3)} USD</span>}
            {call.endReason && <span>Fin: {call.endReason}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// TAB: CONFIGURACIÓN
// ============================================
function ConfigTab({ config, voices, onSave, onDeactivate }: {
  config: CallConfig;
  voices: Voice[];
  onSave: (data: any) => void;
  onDeactivate: () => void;
}) {
  const [form, setForm] = useState({
    agentName: config.agentName,
    agentGreeting: config.agentGreeting || '',
    agentPrompt: config.agentPrompt || '',
    voiceId: config.voiceId,
    voiceSpeed: config.voiceSpeed,
    voiceTemperature: config.voiceTemperature,
    enableAutoReminders: config.enableAutoReminders,
    reminderHoursBefore: config.reminderHoursBefore,
    enableBackchannel: config.enableBackchannel,
  });
  const [saving, setSaving] = useState(false);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSave = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  const selectedVoice = voices.find(v => v.voice_id === form.voiceId);

  return (
    <div className="max-w-2xl space-y-6">
      {/* Agent Config */}
      <Section title="Agente de Voz" icon={Bot} description="Configura la personalidad de tu asistente telefónico">
        <div className="space-y-4">
          <Field label="Nombre del agente">
            <input
              type="text"
              value={form.agentName}
              onChange={e => setForm(f => ({ ...f, agentName: e.target.value }))}
              className="input-field"
              placeholder="Ej: María, Carlos, Asistente..."
            />
          </Field>
          <Field label="Saludo inicial">
            <textarea
              value={form.agentGreeting}
              onChange={e => setForm(f => ({ ...f, agentGreeting: e.target.value }))}
              className="input-field min-h-[80px] resize-y"
              placeholder="Hola, gracias por comunicarse con [tu negocio]. ¿En qué puedo ayudarle?"
            />
          </Field>
          <Field label="Instrucciones adicionales" hint="Contexto extra para las llamadas (se suma al de tu asistente WhatsApp)">
            <textarea
              value={form.agentPrompt}
              onChange={e => setForm(f => ({ ...f, agentPrompt: e.target.value }))}
              className="input-field min-h-[100px] resize-y"
              placeholder="Ej: Ofrece siempre la promo del mes. No des descuentos. Agenda citas solo de lunes a viernes..."
            />
          </Field>
        </div>
      </Section>

      {/* Voice Config */}
      <Section title="Voz" icon={Headphones} description="Selecciona y ajusta la voz de tu agente">
        <div className="space-y-4">
          <Field label={`Voz actual: ${selectedVoice?.voice_name || form.voiceId}`}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
              {voices.map(v => (
                <button
                  key={v.voice_id}
                  onClick={() => setForm(f => ({ ...f, voiceId: v.voice_id }))}
                  className={`p-2.5 rounded-lg border text-left text-xs transition-all ${
                    form.voiceId === v.voice_id
                      ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                      : 'bg-white/[0.02] border-white/5 hover:border-white/10 text-gray-400'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{v.voice_name}</span>
                    {v.preview_audio_url && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (playingVoice === v.voice_id) {
                            audioRef.current?.pause();
                            setPlayingVoice(null);
                          } else {
                            if (audioRef.current) audioRef.current.pause();
                            const a = new Audio(v.preview_audio_url!);
                            audioRef.current = a;
                            a.play();
                            setPlayingVoice(v.voice_id);
                            a.onended = () => setPlayingVoice(null);
                          }
                        }}
                        className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center"
                      >
                        {playingVoice === v.voice_id ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                      </button>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-600">{v.gender === 'male' ? '♂' : '♀'} {v.provider}</span>
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={`Velocidad: ${form.voiceSpeed.toFixed(1)}x`}>
              <input
                type="range"
                min="0.5" max="2" step="0.1"
                value={form.voiceSpeed}
                onChange={e => setForm(f => ({ ...f, voiceSpeed: parseFloat(e.target.value) }))}
                className="w-full accent-violet-500"
              />
            </Field>
            <Field label={`Variación: ${form.voiceTemperature.toFixed(1)}`}>
              <input
                type="range"
                min="0" max="2" step="0.1"
                value={form.voiceTemperature}
                onChange={e => setForm(f => ({ ...f, voiceTemperature: parseFloat(e.target.value) }))}
                className="w-full accent-violet-500"
              />
            </Field>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enableBackchannel}
              onChange={e => setForm(f => ({ ...f, enableBackchannel: e.target.checked }))}
              className="w-4 h-4 rounded accent-violet-500"
            />
            <div>
              <p className="text-sm">Backchannel</p>
              <p className="text-xs text-gray-500">El agente dice &quot;ajá&quot;, &quot;claro&quot; mientras escucha (más natural)</p>
            </div>
          </label>
        </div>
      </Section>

      {/* Reminders */}
      <Section title="Auto-recordatorios" icon={Calendar} description="Llamar automáticamente para recordar citas">
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enableAutoReminders}
              onChange={e => setForm(f => ({ ...f, enableAutoReminders: e.target.checked }))}
              className="w-4 h-4 rounded accent-violet-500"
            />
            <div>
              <p className="text-sm">Activar auto-recordatorios</p>
              <p className="text-xs text-gray-500">Llama a clientes antes de su cita</p>
            </div>
          </label>
          {form.enableAutoReminders && (
            <Field label="Horas antes de la cita">
              <select
                value={form.reminderHoursBefore}
                onChange={e => setForm(f => ({ ...f, reminderHoursBefore: parseInt(e.target.value) }))}
                className="input-field"
              >
                <option value={1}>1 hora antes</option>
                <option value={2}>2 horas antes</option>
                <option value={4}>4 horas antes</option>
                <option value={12}>12 horas antes</option>
                <option value={24}>24 horas antes (1 día)</option>
                <option value={48}>48 horas antes (2 días)</option>
              </select>
            </Field>
          )}
        </div>
      </Section>

      {/* Info */}
      <Section title="Información" icon={Shield}>
        <div className="space-y-2 text-xs text-gray-500">
          <p><strong className="text-gray-400">Número:</strong> {config.retellPhoneNumber || 'No asignado'}</p>
          <p><strong className="text-gray-400">Agent ID:</strong> {config.retellAgentId || 'N/A'}</p>
          <p><strong className="text-gray-400">Voz:</strong> {config.voiceId} ({config.voiceProvider})</p>
          <p><strong className="text-gray-400">Minutos usados:</strong> {config.minutesUsed.toFixed(1)} min</p>
        </div>
      </Section>

      {/* Actions */}
      <div className="flex gap-3 pt-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Guardar configuración
        </button>
        <button
          onClick={onDeactivate}
          className="px-6 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 font-medium text-sm transition-all"
        >
          Desactivar
        </button>
      </div>
    </div>
  );
}

// ============================================
// UI COMPONENTS
// ============================================
function Section({ title, icon: Icon, description, children }: {
  title: string;
  icon: any;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-5 rounded-xl bg-white/[0.02] border border-white/5">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {description && <p className="text-xs text-gray-500 mb-4">{description}</p>}
      {!description && <div className="mb-4" />}
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-gray-600 mt-1">{hint}</p>}
      <style jsx global>{`
        .input-field {
          width: 100%;
          padding: 0.625rem 0.875rem;
          border-radius: 0.5rem;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          font-size: 0.875rem;
          color: white;
          outline: none;
          transition: border-color 0.2s;
        }
        .input-field:focus {
          border-color: rgba(139,92,246,0.5);
        }
        .input-field::placeholder {
          color: rgba(255,255,255,0.15);
        }
      `}</style>
    </div>
  );
}

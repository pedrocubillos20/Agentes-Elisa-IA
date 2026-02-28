'use client';
import { useState, useEffect, useCallback } from 'react';
import { 
  Phone, PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneOff,
  Settings, Play, Pause, Mic, Volume2, Clock, Users, Calendar,
  CheckCircle, AlertCircle, X, RefreshCw, Trash2, ChevronDown, ChevronRight,
  Zap, Bot, Globe, MessageSquare, ArrowRight, ExternalLink, Search,
  BarChart3, Timer, AudioLines, Save
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface CallConfig {
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;
  elevenLabsAgentId: string;
  elevenLabsApiKey: string;
  voiceId: string;
  voiceName: string;
  systemPrompt: string;
  firstMessage: string;
  language: string;
  callsEnabled: boolean;
  autoCallReminders: boolean;
  autoCallFollowup: boolean;
  autoCallReactivation: boolean;
  reminderHoursBefore: number;
}

interface Call {
  id: string;
  direction: string;
  type: string;
  phoneNumber: string;
  clientName?: string;
  status: string;
  duration: number;
  transcript?: string;
  summary?: string;
  recordingUrl?: string;
  error?: string;
  createdAt: string;
  answeredAt?: string;
  endedAt?: string;
}

interface Voice {
  voice_id: string;
  name: string;
  category: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

export default function LlamadasPage() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'config'>('dashboard');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string }>({ type: '', text: '' });
  
  // Config
  const [config, setConfig] = useState<CallConfig>({
    twilioAccountSid: '', twilioAuthToken: '', twilioPhoneNumber: '',
    elevenLabsAgentId: '', elevenLabsApiKey: '',
    voiceId: '', voiceName: '',
    systemPrompt: '', firstMessage: '', language: 'es',
    callsEnabled: false, autoCallReminders: false, autoCallFollowup: false,
    autoCallReactivation: false, reminderHoursBefore: 24
  });
  
  // Stats
  const [stats, setStats] = useState({ totalCalls: 0, todayCalls: 0, totalMinutes: 0 });
  
  // History
  const [calls, setCalls] = useState<Call[]>([]);
  const [callsTotal, setCallsTotal] = useState(0);
  const [callsPage, setCallsPage] = useState(1);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  
  // New call
  const [callNumber, setCallNumber] = useState('');
  const [callName, setCallName] = useState('');
  const [calling, setCalling] = useState(false);
  
  // Voices
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [playingPreview, setPlayingPreview] = useState<string | null>(null);
  
  // Agent
  const [creatingAgent, setCreatingAgent] = useState(false);
  
  const headers = useCallback(() => ({
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json'
  }), []);

  // Load config + stats
  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/calls/config`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        if (data.config) setConfig(prev => ({ ...prev, ...data.config }));
        if (data.stats) setStats(data.stats);
      }
    } catch {} finally { setLoading(false); }
  }, [headers]);

  // Load call history
  const loadHistory = useCallback(async (page = 1) => {
    try {
      const res = await fetch(`${API_URL}/api/calls/history?page=${page}&limit=15`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setCalls(data.calls || []);
        setCallsTotal(data.total || 0);
        setCallsPage(page);
      }
    } catch {}
  }, [headers]);

  useEffect(() => { loadConfig(); loadHistory(); }, [loadConfig, loadHistory]);

  // Save config
  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/calls/config`, {
        method: 'POST', headers: headers(), body: JSON.stringify(config)
      });
      if (res.ok) {
        setMessage({ type: 'success', text: '✅ Configuración guardada' });
        loadConfig();
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage({ type: 'error', text: err.error || 'Error guardando' });
      }
    } catch { setMessage({ type: 'error', text: 'Error de conexión' }); }
    finally { setSaving(false); setTimeout(() => setMessage({ type: '', text: '' }), 4000); }
  };

  // Load voices
  const handleLoadVoices = async () => {
    setLoadingVoices(true);
    try {
      const apiKey = config.elevenLabsApiKey;
      if (!apiKey || apiKey.startsWith('••')) {
        setMessage({ type: 'error', text: 'Ingresa tu API Key de ElevenLabs primero' }); return;
      }
      const res = await fetch(`${API_URL}/api/calls/voices?apiKey=${encodeURIComponent(apiKey)}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setVoices(data.voices || []);
        setMessage({ type: 'success', text: `${data.voices?.length || 0} voces cargadas` });
      } else {
        setMessage({ type: 'error', text: 'Error cargando voces. Verifica tu API Key' });
      }
    } catch { setMessage({ type: 'error', text: 'Error de conexión' }); }
    finally { setLoadingVoices(false); setTimeout(() => setMessage({ type: '', text: '' }), 4000); }
  };

  // Preview voice
  const handlePreviewVoice = (url: string, voiceId: string) => {
    if (playingPreview === voiceId) { setPlayingPreview(null); return; }
    const audio = new Audio(url);
    audio.play();
    setPlayingPreview(voiceId);
    audio.onended = () => setPlayingPreview(null);
  };

  // Create agent
  const handleCreateAgent = async () => {
    setCreatingAgent(true);
    try {
      const res = await fetch(`${API_URL}/api/calls/create-agent`, { method: 'POST', headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setConfig(prev => ({ ...prev, elevenLabsAgentId: data.agentId }));
        setMessage({ type: 'success', text: `✅ Agente creado: ${data.agentId}` });
        loadConfig();
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage({ type: 'error', text: err.error || 'Error creando agente' });
      }
    } catch { setMessage({ type: 'error', text: 'Error de conexión' }); }
    finally { setCreatingAgent(false); setTimeout(() => setMessage({ type: '', text: '' }), 5000); }
  };

  // Make call
  const handleCall = async () => {
    if (!callNumber) return;
    setCalling(true);
    try {
      const res = await fetch(`${API_URL}/api/calls/call`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ to: callNumber, clientName: callName || null, type: 'manual' })
      });
      if (res.ok) {
        setMessage({ type: 'success', text: `📞 Llamada iniciada a ${callNumber}` });
        setCallNumber(''); setCallName('');
        setTimeout(() => loadHistory(), 2000);
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage({ type: 'error', text: err.error || 'Error iniciando llamada' });
      }
    } catch { setMessage({ type: 'error', text: 'Error de conexión' }); }
    finally { setCalling(false); setTimeout(() => setMessage({ type: '', text: '' }), 4000); }
  };

  // Delete call
  const handleDeleteCall = async (id: string) => {
    try {
      await fetch(`${API_URL}/api/calls/${id}`, { method: 'DELETE', headers: headers() });
      setCalls(prev => prev.filter(c => c.id !== id));
      setCallsTotal(prev => prev - 1);
    } catch {}
  };

  // Helpers
  const formatDuration = (secs: number) => {
    if (!secs || secs <= 0) return '0:00';
    const m = Math.floor(secs / 60); const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const statusColor = (s: string) => {
    const map: Record<string, string> = {
      completed: 'text-emerald-400 bg-emerald-500/10', in_progress: 'text-cyan-400 bg-cyan-500/10',
      ringing: 'text-yellow-400 bg-yellow-500/10', failed: 'text-red-400 bg-red-500/10',
      initiating: 'text-gray-400 bg-gray-500/10'
    };
    return map[s] || 'text-gray-400 bg-gray-500/10';
  };

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      completed: 'Completada', in_progress: 'En curso', ringing: 'Sonando',
      failed: 'Fallida', initiating: 'Iniciando'
    };
    return map[s] || s;
  };

  const typeIcon = (type: string, direction: string) => {
    if (direction === 'inbound') return <PhoneIncoming className="w-4 h-4 text-cyan-400" />;
    if (type === 'reminder') return <Calendar className="w-4 h-4 text-amber-400" />;
    if (type === 'followup') return <MessageSquare className="w-4 h-4 text-purple-400" />;
    return <PhoneOutgoing className="w-4 h-4 text-emerald-400" />;
  };

  const isConfigured = !!(config.twilioAccountSid && config.twilioPhoneNumber && config.elevenLabsApiKey && config.elevenLabsAgentId);

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
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shadow-lg shadow-orange-500/20">
            <Phone className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Llamadas IA</h1>
            <p className="text-[var(--text-muted)]">Twilio + ElevenLabs Conversational AI</p>
          </div>
        </div>
        {isConfigured && config.callsEnabled && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm text-emerald-400 font-medium">Sistema Activo</span>
          </div>
        )}
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
          { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
          { id: 'history', label: 'Historial', icon: Clock },
          { id: 'config', label: 'Configuración', icon: Settings },
        ].map((tab) => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id as any); if (tab.id === 'history') loadHistory(); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === tab.id ? 'bg-[var(--accent-primary)] text-white shadow-lg' : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'
            }`}>
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ============ DASHBOARD ============ */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: 'Total Llamadas', value: stats.totalCalls, icon: Phone, color: 'from-orange-500/20 to-orange-600/10 text-orange-400', border: 'border-orange-500/20' },
              { label: 'Hoy', value: stats.todayCalls, icon: Zap, color: 'from-cyan-500/20 to-cyan-600/10 text-cyan-400', border: 'border-cyan-500/20' },
              { label: 'Minutos Totales', value: stats.totalMinutes, icon: Timer, color: 'from-emerald-500/20 to-emerald-600/10 text-emerald-400', border: 'border-emerald-500/20' },
            ].map((stat) => (
              <div key={stat.label} className={`card border ${stat.border}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--text-muted)]">{stat.label}</p>
                    <p className="text-3xl font-bold text-white mt-1">{stat.value}</p>
                  </div>
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                    <stat.icon className="w-6 h-6" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Quick Call + Status */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Quick Call */}
            <div className="card">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <PhoneCall className="w-5 h-5 text-orange-400" /> Llamada Rápida
              </h3>
              {!isConfigured ? (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
                  <p className="font-medium mb-1">⚠️ Configuración incompleta</p>
                  <p className="text-amber-400/70">Ve a la pestaña Configuración para conectar Twilio y ElevenLabs</p>
                </div>
              ) : !config.callsEnabled ? (
                <div className="p-4 rounded-xl bg-gray-500/10 border border-gray-500/20 text-sm text-gray-300">
                  <p>Las llamadas están deshabilitadas. Actívalas en Configuración.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="input-label">Nombre (opcional)</label>
                    <input type="text" value={callName} onChange={e => setCallName(e.target.value)}
                      placeholder="Juan Pérez" className="input w-full" />
                  </div>
                  <div>
                    <label className="input-label">Número de teléfono</label>
                    <input type="tel" value={callNumber} onChange={e => setCallNumber(e.target.value)}
                      placeholder="+573001234567" className="input w-full font-mono" 
                      onKeyDown={e => e.key === 'Enter' && handleCall()} />
                  </div>
                  <button onClick={handleCall} disabled={!callNumber || calling}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold 
                    hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20">
                    {calling ? <div className="loading-spinner w-5 h-5" /> : <PhoneCall className="w-5 h-5" />}
                    {calling ? 'Llamando...' : 'Iniciar Llamada'}
                  </button>
                </div>
              )}
            </div>

            {/* System Status */}
            <div className="card">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Bot className="w-5 h-5 text-violet-400" /> Estado del Sistema
              </h3>
              <div className="space-y-3">
                {[
                  { label: 'Twilio', ok: !!(config.twilioAccountSid && config.twilioPhoneNumber), detail: config.twilioPhoneNumber || 'No configurado' },
                  { label: 'ElevenLabs API', ok: !!config.elevenLabsApiKey, detail: config.elevenLabsApiKey ? 'Conectado' : 'No configurado' },
                  { label: 'Agente de Voz', ok: !!config.elevenLabsAgentId, detail: config.elevenLabsAgentId ? `ID: ${config.elevenLabsAgentId.slice(0, 12)}...` : 'No creado' },
                  { label: 'Voz Seleccionada', ok: !!config.voiceId, detail: config.voiceName || config.voiceId || 'No seleccionada' },
                  { label: 'Llamadas Habilitadas', ok: config.callsEnabled, detail: config.callsEnabled ? 'Activas' : 'Desactivadas' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-tertiary)]">
                    <div className={`w-2.5 h-2.5 rounded-full ${item.ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">{item.label}</p>
                      <p className="text-xs text-[var(--text-muted)] truncate">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Auto features */}
              <div className="mt-4 pt-4 border-t border-[var(--border-primary)]">
                <p className="text-sm font-medium text-white mb-2">🤖 Automatizaciones</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Recordatorios', on: config.autoCallReminders },
                    { label: 'Seguimiento', on: config.autoCallFollowup },
                    { label: 'Reactivación', on: config.autoCallReactivation },
                  ].map(a => (
                    <span key={a.label} className={`px-3 py-1 rounded-full text-xs font-medium ${a.on ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-500/10 text-gray-500'}`}>
                      {a.on ? '✓' : '○'} {a.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Recent calls */}
          {calls.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Llamadas Recientes</h3>
                <button onClick={() => setActiveTab('history')} className="text-sm text-[var(--accent-primary)] hover:underline flex items-center gap-1">
                  Ver todo <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="space-y-2">
                {calls.slice(0, 5).map(call => (
                  <div key={call.id} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] transition-colors">
                    {typeIcon(call.type, call.direction)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {call.clientName || call.phoneNumber}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">{formatDate(call.createdAt)}</p>
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">{formatDuration(call.duration)}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(call.status)}`}>
                      {statusLabel(call.status)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============ HISTORY ============ */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">{callsTotal} llamadas</h3>
            <button onClick={() => loadHistory(callsPage)} className="btn-secondary text-sm">
              <RefreshCw className="w-4 h-4" /> Actualizar
            </button>
          </div>

          {calls.length === 0 ? (
            <div className="card text-center py-12">
              <PhoneOff className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3" />
              <p className="text-[var(--text-muted)]">No hay llamadas aún</p>
            </div>
          ) : (
            <div className="space-y-2">
              {calls.map(call => (
                <div key={call.id} className="card p-0 overflow-hidden">
                  <button onClick={() => setExpandedCall(expandedCall === call.id ? null : call.id)}
                    className="w-full flex items-center gap-3 p-4 hover:bg-[var(--bg-card-hover)] transition-colors text-left">
                    {typeIcon(call.type, call.direction)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white">{call.clientName || call.phoneNumber}</p>
                        {call.clientName && <span className="text-xs text-[var(--text-muted)] font-mono">{call.phoneNumber}</span>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] mt-0.5">
                        <span>{formatDate(call.createdAt)}</span>
                        <span>{call.direction === 'inbound' ? '📥 Entrante' : '📤 Saliente'}</span>
                        <span className="capitalize">{call.type}</span>
                      </div>
                    </div>
                    <span className="text-sm text-[var(--text-muted)] font-mono">{formatDuration(call.duration)}</span>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColor(call.status)}`}>
                      {statusLabel(call.status)}
                    </span>
                    {expandedCall === call.id ? <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" /> : <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />}
                  </button>

                  {expandedCall === call.id && (
                    <div className="px-4 pb-4 border-t border-[var(--border-primary)] pt-3 space-y-3 animate-fade-in">
                      {call.error && (
                        <div className="p-3 rounded-lg bg-red-500/10 text-sm text-red-400">
                          Error: {call.error}
                        </div>
                      )}
                      {call.transcript && (
                        <div>
                          <p className="text-xs font-medium text-[var(--text-muted)] mb-1">📝 Transcripción</p>
                          <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)] max-h-48 overflow-y-auto">
                            {(() => {
                              try {
                                const t = JSON.parse(call.transcript);
                                if (Array.isArray(t)) return t.map((msg: any, i: number) => (
                                  <p key={i} className={`mb-1 ${msg.role === 'agent' ? 'text-emerald-400' : 'text-white'}`}>
                                    <span className="font-medium">{msg.role === 'agent' ? '🤖' : '👤'}</span> {msg.message || msg.text || msg.content}
                                  </p>
                                ));
                                return call.transcript;
                              } catch { return call.transcript; }
                            })()}
                          </div>
                        </div>
                      )}
                      {call.recordingUrl && (
                        <div>
                          <p className="text-xs font-medium text-[var(--text-muted)] mb-1">🎙️ Grabación</p>
                          <audio controls className="w-full" src={call.recordingUrl} />
                        </div>
                      )}
                      <div className="flex justify-end">
                        <button onClick={() => handleDeleteCall(call.id)} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                          <Trash2 className="w-3 h-3" /> Eliminar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {callsTotal > 15 && (
            <div className="flex justify-center gap-2">
              {Array.from({ length: Math.ceil(callsTotal / 15) }, (_, i) => (
                <button key={i} onClick={() => loadHistory(i + 1)}
                  className={`px-3 py-1.5 rounded-lg text-sm ${callsPage === i + 1 ? 'bg-[var(--accent-primary)] text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-white'}`}>
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============ CONFIG ============ */}
      {activeTab === 'config' && (
        <div className="space-y-6">
          {/* STEP 1: Twilio */}
          <div className="card">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-pink-500 flex items-center justify-center text-xl font-bold text-white">1</div>
              <div>
                <h3 className="text-lg font-semibold text-white">Twilio — Telefonía</h3>
                <p className="text-sm text-[var(--text-muted)]">Números telefónicos para hacer y recibir llamadas</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Account SID</label>
                  <input type="text" value={config.twilioAccountSid} onChange={e => setConfig(p => ({ ...p, twilioAccountSid: e.target.value }))}
                    placeholder="ACxxxxxxxxxxxxxxxx" className="input w-full font-mono text-sm" />
                </div>
                <div>
                  <label className="input-label">Auth Token</label>
                  <input type="password" value={config.twilioAuthToken} onChange={e => setConfig(p => ({ ...p, twilioAuthToken: e.target.value }))}
                    placeholder="Token secreto" className="input w-full font-mono text-sm" />
                </div>
              </div>
              <div>
                <label className="input-label">Número Twilio (E.164)</label>
                <input type="tel" value={config.twilioPhoneNumber} onChange={e => setConfig(p => ({ ...p, twilioPhoneNumber: e.target.value }))}
                  placeholder="+15551234567" className="input w-full font-mono" />
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Compra un número en <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" className="text-red-400 hover:underline">Twilio Console</a>
                </p>
              </div>
            </div>
          </div>

          {/* STEP 2: ElevenLabs */}
          <div className="card">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center text-xl font-bold text-white">2</div>
              <div>
                <h3 className="text-lg font-semibold text-white">ElevenLabs — Voz IA</h3>
                <p className="text-sm text-[var(--text-muted)]">Voces ultrarrealistas + clonación de voz</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="input-label">API Key de ElevenLabs</label>
                <input type="password" value={config.elevenLabsApiKey} onChange={e => setConfig(p => ({ ...p, elevenLabsApiKey: e.target.value }))}
                  placeholder="xi-xxxxxxxx" className="input w-full font-mono text-sm" />
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Obtén tu key en <a href="https://elevenlabs.io/app/developers/api-keys" target="_blank" className="text-violet-400 hover:underline">ElevenLabs → API Keys</a>
                </p>
              </div>

              {/* Voice Selection */}
              <div className="border-t border-[var(--border-primary)] pt-4">
                <div className="flex items-center justify-between mb-3">
                  <label className="input-label mb-0">Voz para las llamadas</label>
                  <button onClick={handleLoadVoices} disabled={loadingVoices || !config.elevenLabsApiKey || config.elevenLabsApiKey.startsWith('••')}
                    className="btn-secondary text-xs">
                    {loadingVoices ? <div className="loading-spinner w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
                    Cargar Voces
                  </button>
                </div>
                
                {/* Manual Voice ID */}
                <div className="flex gap-3">
                  <input type="text" value={config.voiceId} onChange={e => setConfig(p => ({ ...p, voiceId: e.target.value }))}
                    placeholder="Voice ID (ej: EXAVITQu4vr4xnSDxMaL)" className="input flex-1 font-mono text-sm" />
                  <input type="text" value={config.voiceName} onChange={e => setConfig(p => ({ ...p, voiceName: e.target.value }))}
                    placeholder="Nombre (ej: María)" className="input w-40" />
                </div>

                {/* Voice List */}
                {voices.length > 0 && (
                  <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-[var(--border-primary)]">
                    {voices.map(v => (
                      <button key={v.voice_id} onClick={() => setConfig(p => ({ ...p, voiceId: v.voice_id, voiceName: v.name }))}
                        className={`w-full flex items-center gap-3 p-3 text-left hover:bg-[var(--bg-tertiary)] transition-colors border-b border-[var(--border-primary)] last:border-0 ${
                          config.voiceId === v.voice_id ? 'bg-violet-500/10' : ''
                        }`}>
                        <Volume2 className={`w-4 h-4 flex-shrink-0 ${config.voiceId === v.voice_id ? 'text-violet-400' : 'text-[var(--text-muted)]'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white">{v.name}</p>
                          <p className="text-xs text-[var(--text-muted)]">
                            {v.category} {v.labels?.accent && `· ${v.labels.accent}`} {v.labels?.gender && `· ${v.labels.gender}`}
                          </p>
                        </div>
                        {v.preview_url && (
                          <button onClick={(e) => { e.stopPropagation(); handlePreviewVoice(v.preview_url!, v.voice_id); }}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                            {playingPreview === v.voice_id ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                          </button>
                        )}
                        {config.voiceId === v.voice_id && <CheckCircle className="w-4 h-4 text-violet-400" />}
                      </button>
                    ))}
                  </div>
                )}

                <p className="text-xs text-[var(--text-muted)] mt-2">
                  💡 Para <strong>clonar tu propia voz</strong>, ve a <a href="https://elevenlabs.io/app/voice-lab" target="_blank" className="text-violet-400 hover:underline">ElevenLabs → Voice Lab</a> → "Add Voice" → "Instant Voice Cloning". Sube un audio de 1-5 min hablando en español y copia el Voice ID.
                </p>
              </div>
            </div>
          </div>

          {/* STEP 3: Agent */}
          <div className="card">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-xl font-bold text-white">3</div>
              <div>
                <h3 className="text-lg font-semibold text-white">Agente de Voz</h3>
                <p className="text-sm text-[var(--text-muted)]">Personalidad y comportamiento del asistente telefónico</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="input-label">Mensaje Inicial</label>
                <input type="text" value={config.firstMessage} onChange={e => setConfig(p => ({ ...p, firstMessage: e.target.value }))}
                  placeholder="¡Hola! Soy el asistente virtual de tu negocio. ¿En qué puedo ayudarte?" className="input w-full" />
              </div>
              <div>
                <label className="input-label">Instrucciones del Agente</label>
                <textarea value={config.systemPrompt} onChange={e => setConfig(p => ({ ...p, systemPrompt: e.target.value }))}
                  placeholder="Eres un asistente telefónico amable y profesional. Tu objetivo es..."
                  rows={5} className="input w-full resize-y" />
                <p className="text-xs text-[var(--text-muted)] mt-1">Déjalo vacío para usar la personalidad de tu Asistente IA de WhatsApp</p>
              </div>
              <div>
                <label className="input-label">Idioma</label>
                <select value={config.language} onChange={e => setConfig(p => ({ ...p, language: e.target.value }))} className="input w-full">
                  <option value="es">🇪🇸 Español</option>
                  <option value="en">🇺🇸 English</option>
                  <option value="pt">🇧🇷 Português</option>
                  <option value="fr">🇫🇷 Français</option>
                </select>
              </div>

              {/* Agent ID */}
              {config.elevenLabsAgentId ? (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-400">Agente Creado</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] font-mono">{config.elevenLabsAgentId}</p>
                </div>
              ) : (
                <button onClick={handleCreateAgent} disabled={creatingAgent || !config.elevenLabsApiKey || config.elevenLabsApiKey.startsWith('••')}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold 
                  hover:from-cyan-600 hover:to-blue-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {creatingAgent ? <div className="loading-spinner w-5 h-5" /> : <Bot className="w-5 h-5" />}
                  {creatingAgent ? 'Creando agente...' : 'Crear Agente de Voz'}
                </button>
              )}
            </div>
          </div>

          {/* STEP 4: Enable + Automations */}
          <div className="card">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center text-xl font-bold text-white">4</div>
              <div>
                <h3 className="text-lg font-semibold text-white">Activar y Automatizar</h3>
                <p className="text-sm text-[var(--text-muted)]">Habilita llamadas y configura automatizaciones</p>
              </div>
            </div>
            <div className="space-y-4">
              {/* Main toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                <div>
                  <h4 className="font-medium text-white">Habilitar Llamadas IA</h4>
                  <p className="text-sm text-[var(--text-muted)]">Permite hacer y recibir llamadas con el agente de voz</p>
                </div>
                <button onClick={() => setConfig(p => ({ ...p, callsEnabled: !p.callsEnabled }))}
                  className={`relative w-16 h-8 rounded-full transition-all ${config.callsEnabled ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-primary)]'}`}>
                  <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all ${config.callsEnabled ? 'left-9' : 'left-1'}`} />
                </button>
              </div>

              {/* Auto reminders */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-amber-400" />
                  <div>
                    <h4 className="text-sm font-medium text-white">Recordatorio de Citas</h4>
                    <p className="text-xs text-[var(--text-muted)]">Llama automáticamente antes de cada cita</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <select value={config.reminderHoursBefore} onChange={e => setConfig(p => ({ ...p, reminderHoursBefore: parseInt(e.target.value) }))}
                    className="input text-xs w-20" disabled={!config.autoCallReminders}>
                    <option value="1">1h</option><option value="2">2h</option>
                    <option value="12">12h</option><option value="24">24h</option><option value="48">48h</option>
                  </select>
                  <button onClick={() => setConfig(p => ({ ...p, autoCallReminders: !p.autoCallReminders }))}
                    className={`relative w-12 h-6 rounded-full transition-all ${config.autoCallReminders ? 'bg-amber-500' : 'bg-[var(--bg-primary)]'}`}>
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${config.autoCallReminders ? 'left-6' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>

              {/* Auto followup */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-purple-400" />
                  <div>
                    <h4 className="text-sm font-medium text-white">Seguimiento Post-Venta</h4>
                    <p className="text-xs text-[var(--text-muted)]">Llama 24h después de una cita completada</p>
                  </div>
                </div>
                <button onClick={() => setConfig(p => ({ ...p, autoCallFollowup: !p.autoCallFollowup }))}
                  className={`relative w-12 h-6 rounded-full transition-all ${config.autoCallFollowup ? 'bg-purple-500' : 'bg-[var(--bg-primary)]'}`}>
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${config.autoCallFollowup ? 'left-6' : 'left-0.5'}`} />
                </button>
              </div>

              {/* Auto reactivation */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-3">
                  <Users className="w-5 h-5 text-cyan-400" />
                  <div>
                    <h4 className="text-sm font-medium text-white">Reactivación de Clientes</h4>
                    <p className="text-xs text-[var(--text-muted)]">Llama clientes inactivos (+30 días)</p>
                  </div>
                </div>
                <button onClick={() => setConfig(p => ({ ...p, autoCallReactivation: !p.autoCallReactivation }))}
                  className={`relative w-12 h-6 rounded-full transition-all ${config.autoCallReactivation ? 'bg-cyan-500' : 'bg-[var(--bg-primary)]'}`}>
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${config.autoCallReactivation ? 'left-6' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <button onClick={handleSaveConfig} disabled={saving}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold text-lg
            hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50 flex items-center justify-center gap-3 shadow-lg shadow-orange-500/20">
            {saving ? <div className="loading-spinner w-5 h-5" /> : <Save className="w-5 h-5" />}
            {saving ? 'Guardando...' : 'Guardar Configuración'}
          </button>

          {/* How it works */}
          <div className="card bg-orange-500/5 border-orange-500/20">
            <h4 className="font-semibold text-orange-400 mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4" /> ¿Cómo funciona?
            </h4>
            <div className="text-sm text-[var(--text-muted)] space-y-3">
              <div className="flex gap-3">
                <span className="text-orange-400 font-bold">1.</span>
                <p><strong className="text-white">Twilio</strong> proporciona el número de teléfono real para llamar y recibir llamadas</p>
              </div>
              <div className="flex gap-3">
                <span className="text-orange-400 font-bold">2.</span>
                <p><strong className="text-white">ElevenLabs</strong> proporciona la voz IA ultrarrealista y la conversación inteligente</p>
              </div>
              <div className="flex gap-3">
                <span className="text-orange-400 font-bold">3.</span>
                <p>Cuando se inicia una llamada, Twilio marca el número y conecta el audio a ElevenLabs vía WebSocket</p>
              </div>
              <div className="flex gap-3">
                <span className="text-orange-400 font-bold">4.</span>
                <p>El agente IA conversa naturalmente usando tu voz clonada y la personalidad de tu asistente</p>
              </div>
              <div className="mt-3 p-3 rounded-lg bg-black/20">
                <p className="text-xs">
                  💰 <strong className="text-white">Costo estimado:</strong> ~$0.09/min (Twilio ~$0.01 + ElevenLabs ~$0.08) = ~$0.27 USD por llamada de 3 min (~$1,100 COP)
                </p>
              </div>
            </div>
          </div>
        </div>
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

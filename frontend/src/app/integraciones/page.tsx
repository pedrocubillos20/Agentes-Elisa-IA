'use client';

import { useState, useEffect } from 'react';
import {
  Link2, Unlink, RefreshCw, ArrowRight, ArrowLeft, Key, Globe,
  CheckCircle, Settings, Zap, Users, Calendar, MessageSquare,
  GitBranch, Clock, AlertTriangle, ChevronDown, ExternalLink, Eye, EyeOff, Copy, HelpCircle,
  Plus, Trash2, Power, Shield, Code, Send, Bell, ShoppingCart, UserPlus
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// Available webhook events
const WEBHOOK_EVENTS = [
  { id: 'message.received', label: 'Mensaje recibido', icon: MessageSquare, desc: 'Cuando llega un mensaje de WhatsApp' },
  { id: 'message.sent', label: 'Mensaje enviado', icon: Send, desc: 'Cuando la IA o agente envía un mensaje' },
  { id: 'lead.new', label: 'Nuevo lead', icon: UserPlus, desc: 'Cuando se crea un nuevo contacto' },
  { id: 'lead.stage_changed', label: 'Cambio de etapa', icon: GitBranch, desc: 'Cuando un lead cambia de etapa en el CRM' },
  { id: 'appointment.created', label: 'Cita creada', icon: Calendar, desc: 'Cuando se agenda una nueva cita' },
  { id: 'appointment.updated', label: 'Cita actualizada', icon: Calendar, desc: 'Cuando se modifica una cita' },
  { id: 'order.created', label: 'Pedido creado', icon: ShoppingCart, desc: 'Cuando se registra un nuevo pedido' },
  { id: 'conversation.ai_paused', label: 'IA pausada', icon: Power, desc: 'Cuando se pausa la IA en una conversación' },
];

export default function IntegracionesPage() {
  const [ghl, setGhl] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState('');
  const [syncResult, setSyncResult] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [showStageMapping, setShowStageMapping] = useState(false);
  const [stageMapping, setStageMapping] = useState<Record<string, string>>({});
  const [disconnecting, setDisconnecting] = useState(false);

  // API Key connection form (GHL)
  const [connectTab, setConnectTab] = useState<'apikey' | 'oauth'>('apikey');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [locationIdInput, setLocationIdInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // === API Keys state ===
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<any>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showKeysSection, setShowKeysSection] = useState(true);

  // === Webhooks state ===
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loadingWebhooks, setLoadingWebhooks] = useState(false);
  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [webhookForm, setWebhookForm] = useState({ name: '', url: '', events: [] as string[] });
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [webhookError, setWebhookError] = useState('');
  const [showWebhooksSection, setShowWebhooksSection] = useState(true);
  const [copiedSecret, setCopiedSecret] = useState('');
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [expandedWebhook, setExpandedWebhook] = useState<string | null>(null);

  const getToken = () => localStorage.getItem('token') || '';
  const headers = () => ({ 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'ghl_connected') window.history.replaceState({}, '', '/integraciones');
    if (params.get('error')) { setConnectError(`Error OAuth: ${params.get('error')}`); window.history.replaceState({}, '', '/integraciones'); }
  }, []);

  useEffect(() => { fetchStatus(); fetchApiKeys(); fetchWebhooks(); }, []);

  // ========== GHL Functions ==========
  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/ghl/status`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
      const data = await res.json();
      setGhl(data);
      if (data.pipelineStages) setStageMapping(data.pipelineStages);
    } catch {} finally { setLoading(false); }
  };

  const connectWithApiKey = async () => {
    if (!apiKeyInput.trim() || !locationIdInput.trim()) { setConnectError('Ambos campos son obligatorios'); return; }
    setConnecting(true); setConnectError('');
    try {
      const res = await fetch(`${API_URL}/api/ghl/connect-apikey`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ apiKey: apiKeyInput.trim(), locationId: locationIdInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setConnectError(data.error || 'Error de conexión'); return; }
      setApiKeyInput(''); setLocationIdInput('');
      fetchStatus();
    } catch (e: any) { setConnectError(e.message); } finally { setConnecting(false); }
  };

  const connectWithOAuth = async () => {
    try {
      const res = await fetch(`${API_URL}/api/ghl/auth`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setConnectError(data.error || 'OAuth no disponible');
    } catch (e: any) { setConnectError(e.message); }
  };

  const disconnectGHL = async () => {
    setDisconnecting(true);
    try { await fetch(`${API_URL}/api/ghl/disconnect`, { method: 'DELETE', headers: headers() }); setGhl({ connected: false, oauthAvailable: ghl?.oauthAvailable }); } catch {} finally { setDisconnecting(false); }
  };

  const updateSettings = async (updates: any) => {
    try { await fetch(`${API_URL}/api/ghl/settings`, { method: 'PUT', headers: headers(), body: JSON.stringify(updates) }); setGhl({ ...ghl, ...updates }); } catch {}
  };

  const syncData = async (direction: 'push' | 'pull') => {
    setSyncing(direction); setSyncResult(null);
    try {
      const res = await fetch(`${API_URL}/api/ghl/sync/${direction}`, { method: 'POST', headers: headers() });
      const data = await res.json();
      setSyncResult(data.results || data); fetchStatus();
    } catch {} finally { setSyncing(''); }
  };

  const fetchLogs = async () => {
    try { const res = await fetch(`${API_URL}/api/ghl/logs`, { headers: { 'Authorization': `Bearer ${getToken()}` } }); const data = await res.json(); setLogs(Array.isArray(data) ? data : []); } catch {}
  };

  const saveStageMapping = async () => { await updateSettings({ pipelineStages: stageMapping }); setShowStageMapping(false); };

  // ========== API Keys Functions ==========
  const fetchApiKeys = async () => {
    setLoadingKeys(true);
    try {
      const res = await fetch(`${API_URL}/api/integrations/keys`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
      const data = await res.json();
      setApiKeys(data.keys || []);
    } catch {} finally { setLoadingKeys(false); }
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const res = await fetch(`${API_URL}/api/integrations/keys`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Error'); return; }
      setNewKeyResult(data);
      setNewKeyName('');
      fetchApiKeys();
    } catch {} finally { setCreatingKey(false); }
  };

  const deleteApiKey = async (id: string) => {
    if (!confirm('¿Eliminar esta API Key? Cualquier integración que la use dejará de funcionar.')) return;
    try {
      await fetch(`${API_URL}/api/integrations/keys/${id}`, { method: 'DELETE', headers: headers() });
      fetchApiKeys();
    } catch {}
  };

  const toggleApiKey = async (id: string, isActive: boolean) => {
    try {
      await fetch(`${API_URL}/api/integrations/keys/${id}`, {
        method: 'PATCH', headers: headers(),
        body: JSON.stringify({ isActive: !isActive }),
      });
      fetchApiKeys();
    } catch {}
  };

  const copyToClipboard = (text: string, type: 'key' | 'secret', id?: string) => {
    navigator.clipboard.writeText(text);
    if (type === 'key') { setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }
    if (type === 'secret' && id) { setCopiedSecret(id); setTimeout(() => setCopiedSecret(''), 2000); }
  };

  // ========== Webhooks Functions ==========
  const fetchWebhooks = async () => {
    setLoadingWebhooks(true);
    try {
      const res = await fetch(`${API_URL}/api/integrations/webhooks`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
      const data = await res.json();
      setWebhooks(data.webhooks || []);
    } catch {} finally { setLoadingWebhooks(false); }
  };

  const createWebhook = async () => {
    if (!webhookForm.name.trim() || !webhookForm.url.trim()) { setWebhookError('Nombre y URL son requeridos'); return; }
    if (webhookForm.events.length === 0) { setWebhookError('Selecciona al menos un evento'); return; }
    try { new URL(webhookForm.url); } catch { setWebhookError('URL inválida. Debe comenzar con https://'); return; }
    setCreatingWebhook(true); setWebhookError('');
    try {
      const res = await fetch(`${API_URL}/api/integrations/webhooks`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify(webhookForm),
      });
      const data = await res.json();
      if (!res.ok) { setWebhookError(data.error || 'Error'); return; }
      setWebhookForm({ name: '', url: '', events: [] });
      setShowWebhookForm(false);
      fetchWebhooks();
    } catch {} finally { setCreatingWebhook(false); }
  };

  const deleteWebhook = async (id: string) => {
    if (!confirm('¿Eliminar este webhook?')) return;
    try {
      await fetch(`${API_URL}/api/integrations/webhooks/${id}`, { method: 'DELETE', headers: headers() });
      fetchWebhooks();
    } catch {}
  };

  const toggleWebhook = async (id: string, isActive: boolean) => {
    try {
      await fetch(`${API_URL}/api/integrations/webhooks/${id}`, {
        method: 'PUT', headers: headers(),
        body: JSON.stringify({ isActive: !isActive }),
      });
      fetchWebhooks();
    } catch {}
  };

  const toggleWebhookEvent = (eventId: string) => {
    setWebhookForm(prev => ({
      ...prev,
      events: prev.events.includes(eventId)
        ? prev.events.filter(e => e !== eventId)
        : [...prev.events, eventId]
    }));
  };

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><div className="loading-spinner w-8 h-8" /></div>;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Zap className="w-6 h-6 text-orange-400" /> Integraciones</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">Conecta tu CRM con servicios externos</p>
      </div>

      {/* ============================================================ */}
      {/* GoHighLevel Card */}
      {/* ============================================================ */}
      <div className="card-dark rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center font-bold text-white text-lg shadow-lg">GHL</div>
            <div>
              <h2 className="text-lg font-bold text-white">GoHighLevel</h2>
              <p className="text-xs text-[var(--text-muted)]">Sincronización bidireccional CRM</p>
            </div>
          </div>
          {ghl?.connected && (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-semibold">
                <CheckCircle className="w-3.5 h-3.5" /> Conectado ({ghl.authMethod === 'oauth' ? 'OAuth' : 'API Key'})
              </span>
              <button onClick={disconnectGHL} disabled={disconnecting} className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20 transition-colors flex items-center gap-1">
                <Unlink className="w-3 h-3" /> {disconnecting ? '...' : 'Desconectar'}
              </button>
            </div>
          )}
        </div>

        {ghl?.connected ? (
          <div className="p-5 space-y-5">
            <div className="flex items-center gap-4 p-3 rounded-xl bg-white/3">
              <div className="flex-1"><p className="text-xs text-[var(--text-muted)]">Ubicación GHL</p><p className="text-sm font-semibold text-white">{ghl.locationName || ghl.locationId}</p></div>
              <div className="flex-1"><p className="text-xs text-[var(--text-muted)]">Última sync</p><p className="text-sm text-white">{ghl.lastSyncAt ? new Date(ghl.lastSyncAt).toLocaleString() : 'Nunca'}</p></div>
              <div className="flex-1"><p className="text-xs text-[var(--text-muted)]">Total sincronizado</p><p className="text-sm font-semibold text-emerald-400">{ghl.totalSynced || 0}</p></div>
            </div>

            {ghl.lastError && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-red-400 mt-0.5" /><p className="text-xs text-red-300">{ghl.lastError}</p></div>}

            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'syncContacts', icon: Users, label: 'Contactos', desc: 'WhatsApp → GHL Contacts' },
                { key: 'syncPipeline', icon: GitBranch, label: 'Pipeline', desc: 'Etapas ↔ Opportunities' },
                { key: 'syncCalendar', icon: Calendar, label: 'Calendario', desc: 'Agenda ↔ Calendar' },
                { key: 'syncConversations', icon: MessageSquare, label: 'Conversaciones', desc: 'Log bidireccional' },
              ].map(item => (
                <div key={item.key} className={`p-3 rounded-xl border transition-colors cursor-pointer ${ghl[item.key] ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-white/2 border-white/5'}`}
                  onClick={() => updateSettings({ [item.key]: !ghl[item.key] })}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <item.icon className={`w-4 h-4 ${ghl[item.key] ? 'text-emerald-400' : 'text-gray-500'}`} />
                      <span className="text-sm font-semibold text-white">{item.label}</span>
                    </div>
                    <div className={`w-8 h-5 rounded-full transition-colors ${ghl[item.key] ? 'bg-emerald-500' : 'bg-gray-600'} flex items-center px-0.5`}>
                      <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${ghl[item.key] ? 'translate-x-3' : 'translate-x-0'}`} />
                    </div>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)]">{item.desc}</p>
                </div>
              ))}
            </div>

            {ghl.syncPipeline && ghl.pipelines?.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white flex items-center gap-2"><GitBranch className="w-4 h-4 text-blue-400" /> Pipeline</span>
                  <button onClick={() => setShowStageMapping(!showStageMapping)} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"><Settings className="w-3 h-3" /> Mapear etapas <ChevronDown className={`w-3 h-3 transition-transform ${showStageMapping ? 'rotate-180' : ''}`} /></button>
                </div>
                <select value={ghl.pipelineId || ''} onChange={e => updateSettings({ pipelineId: e.target.value })} className="w-full p-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm">
                  <option value="">Seleccionar Pipeline</option>
                  {ghl.pipelines?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {showStageMapping && ghl.pipelineId && (
                  <div className="p-3 rounded-xl bg-white/3 border border-white/5 space-y-2">
                    <p className="text-xs text-[var(--text-muted)] mb-2">Bizonne → GoHighLevel:</p>
                    {['new', 'Interesado', 'En Cotización', 'Cotizado', 'Realizó Pedido', 'Pendiente Pago', 'Confirmado', 'Despachado', 'Entregado', 'Perdido'].map(stage => (
                      <div key={stage} className="flex items-center gap-2">
                        <span className="w-32 text-xs text-white truncate">{stage}</span>
                        <ArrowRight className="w-3 h-3 text-gray-500" />
                        <select value={stageMapping[stage] || ''} onChange={e => setStageMapping({ ...stageMapping, [stage]: e.target.value })} className="flex-1 p-1.5 rounded bg-white/5 border border-white/10 text-white text-xs">
                          <option value="">— Sin mapear —</option>
                          {ghl.pipelines?.find((p: any) => p.id === ghl.pipelineId)?.stages?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                    ))}
                    <button onClick={saveStageMapping} className="btn-primary w-full py-2 text-xs mt-2">Guardar mapeo</button>
                  </div>
                )}
              </div>
            )}

            {ghl.syncCalendar && ghl.calendars?.length > 0 && (
              <div className="space-y-2">
                <span className="text-sm font-semibold text-white flex items-center gap-2"><Calendar className="w-4 h-4 text-purple-400" /> Calendario</span>
                <select value={ghl.calendarId || ''} onChange={e => updateSettings({ calendarId: e.target.value })} className="w-full p-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm">
                  <option value="">Seleccionar calendario</option>
                  {ghl.calendars?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => syncData('push')} disabled={!!syncing} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition-colors flex items-center justify-center gap-2">
                {syncing === 'push' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                {syncing === 'push' ? 'Sincronizando...' : 'Enviar a GHL →'}
              </button>
              <button onClick={() => syncData('pull')} disabled={!!syncing} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 transition-colors flex items-center justify-center gap-2">
                {syncing === 'pull' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowLeft className="w-4 h-4" />}
                {syncing === 'pull' ? 'Sincronizando...' : '← Traer de GHL'}
              </button>
            </div>

            {syncResult && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <p className="text-xs font-semibold text-emerald-400 mb-1">✅ Sincronización completada</p>
                <div className="flex gap-4 text-xs text-white">
                  <span>👥 {syncResult.contacts || 0} contactos</span>
                  <span>📊 {syncResult.opportunities || 0} oportunidades</span>
                  <span>📅 {syncResult.appointments || 0} citas</span>
                </div>
                {syncResult.errors?.length > 0 && <p className="text-[10px] text-red-400 mt-1">{syncResult.errors.length} errores</p>}
              </div>
            )}

            <button onClick={() => { setShowLogs(!showLogs); if (!showLogs) fetchLogs(); }} className="text-xs text-[var(--text-muted)] hover:text-white flex items-center gap-1">
              <Clock className="w-3 h-3" /> {showLogs ? 'Ocultar' : 'Ver'} historial
            </button>
            {showLogs && logs.length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1 p-2 rounded-xl bg-white/2">
                {logs.map(log => (
                  <div key={log.id} className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] py-1 border-b border-white/3">
                    <span className={log.direction === 'to_ghl' ? 'text-blue-400' : 'text-purple-400'}>{log.direction === 'to_ghl' ? '→ GHL' : '← GHL'}</span>
                    <span className="text-white">{log.action}</span><span>{log.entityType}</span>
                    <span className="ml-auto">{new Date(log.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-6">
            <div className="grid grid-cols-2 gap-3 max-w-lg mx-auto mb-6">
              {[
                { icon: Users, text: 'Contactos WhatsApp → GHL' },
                { icon: GitBranch, text: 'Pipeline ↔ Etapas CRM' },
                { icon: Calendar, text: 'Agenda ↔ Calendario GHL' },
                { icon: MessageSquare, text: 'Conversaciones bidireccional' },
              ].map((f, i) => (
                <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-white/3">
                  <f.icon className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <span className="text-xs text-white">{f.text}</span>
                </div>
              ))}
            </div>

            <div className="max-w-lg mx-auto">
              <div className="flex rounded-xl bg-white/5 p-1 mb-4">
                <button onClick={() => setConnectTab('apikey')} className={`flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${connectTab === 'apikey' ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-white'}`}>
                  <Key className="w-4 h-4" /> API Key
                </button>
                <button onClick={() => setConnectTab('oauth')} className={`flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${connectTab === 'oauth' ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-white'}`}>
                  <Globe className="w-4 h-4" /> OAuth
                </button>
              </div>

              {connectTab === 'apikey' ? (
                <div className="space-y-4">
                  <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-blue-400">🔑 Conexión con API Key</p>
                      <button onClick={() => setShowHelp(!showHelp)} className="text-xs text-blue-400/60 hover:text-blue-400 flex items-center gap-1">
                        <HelpCircle className="w-3 h-3" /> ¿Cómo obtener?
                      </button>
                    </div>
                    {showHelp && (
                      <div className="text-xs text-[var(--text-muted)] space-y-1 mb-3 p-2 rounded-lg bg-white/3">
                        <p className="font-semibold text-white">Para obtener tu API Key de GHL:</p>
                        <p>1. Inicia sesión en <a href="https://app.gohighlevel.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">app.gohighlevel.com</a></p>
                        <p>2. Ve a <strong>Settings → Business Profile</strong></p>
                        <p>3. En la sección <strong>&quot;API Key&quot;</strong>, genera o copia tu key</p>
                        <p>4. El <strong>Location ID</strong> está en la URL: <code className="text-blue-400">app.gohighlevel.com/v2/location/<strong>TU_LOCATION_ID</strong>/...</code></p>
                        <p>5. O ve a Settings → Business Profile → Company ID / Location ID</p>
                      </div>
                    )}
                    <p className="text-[10px] text-[var(--text-muted)]">Ingresa tu API Key y Location ID de GoHighLevel. Cada usuario conecta su propia cuenta.</p>
                  </div>

                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">API Key de GoHighLevel</label>
                    <div className="relative">
                      <input type={showApiKey ? 'text' : 'password'} value={apiKeyInput} onChange={e => setApiKeyInput(e.target.value)}
                        placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6..." className="w-full p-3 pr-10 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none" />
                      <button onClick={() => setShowApiKey(!showApiKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                        {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Location ID</label>
                    <input type="text" value={locationIdInput} onChange={e => setLocationIdInput(e.target.value)}
                      placeholder="abc123DEFghiJKL" className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none" />
                  </div>

                  {connectError && <p className="text-xs text-red-400 bg-red-500/10 p-2 rounded-lg">{connectError}</p>}

                  <button onClick={connectWithApiKey} disabled={connecting || !apiKeyInput.trim() || !locationIdInput.trim()}
                    className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/30 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
                    {connecting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                    {connecting ? 'Verificando conexión...' : 'Conectar GoHighLevel'}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/10">
                    <p className="text-xs font-semibold text-purple-400 mb-1">🔗 Conexión con OAuth</p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {ghl?.oauthAvailable
                        ? 'Haz clic en conectar y autoriza a Bizonne en tu cuenta de GoHighLevel. Es más fácil y no necesitas buscar tu API Key.'
                        : 'OAuth no está disponible en este momento. Usa la conexión por API Key.'}
                    </p>
                  </div>

                  {connectError && <p className="text-xs text-red-400 bg-red-500/10 p-2 rounded-lg">{connectError}</p>}

                  <button onClick={connectWithOAuth} disabled={!ghl?.oauthAvailable}
                    className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/20 disabled:text-purple-400/50 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
                    <ExternalLink className="w-4 h-4" />
                    {ghl?.oauthAvailable ? 'Conectar con OAuth' : 'OAuth no disponible — usa API Key'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* API Keys Section */}
      {/* ============================================================ */}
      <div className="card-dark rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-white/5 cursor-pointer" onClick={() => setShowKeysSection(!showKeysSection)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
                <Key className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">API Keys</h2>
                <p className="text-xs text-[var(--text-muted)]">Conecta sistemas externos a tu CRM</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {apiKeys.length > 0 && (
                <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 font-semibold">
                  {apiKeys.filter(k => k.isActive).length} activa{apiKeys.filter(k => k.isActive).length !== 1 ? 's' : ''}
                </span>
              )}
              <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${showKeysSection ? 'rotate-180' : ''}`} />
            </div>
          </div>
        </div>

        {showKeysSection && (
          <div className="p-5 space-y-4">
            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/10">
              <p className="text-xs text-[var(--text-muted)]">
                <span className="text-amber-400 font-semibold">🔑 Tu API Key</span> te permite conectar herramientas externas (Zapier, Make, n8n, apps propias) para leer y escribir datos de tu CRM.
              </p>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                Base URL: <code className="text-amber-400 bg-white/5 px-1.5 py-0.5 rounded">{API_URL}/api/v1/</code>
              </p>
            </div>

            {newKeyResult && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <p className="text-sm font-semibold text-emerald-400">API Key creada: {newKeyResult.name}</p>
                </div>
                <p className="text-[10px] text-amber-400 font-semibold">⚠️ Copia esta key ahora. No se mostrará de nuevo.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2.5 rounded-lg bg-black/30 text-amber-300 text-xs font-mono break-all">{newKeyResult.key}</code>
                  <button onClick={() => copyToClipboard(newKeyResult.key, 'key')}
                    className={`px-3 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors ${copiedKey ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'}`}>
                    {copiedKey ? <><CheckCircle className="w-3.5 h-3.5" /> Copiada</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
                  </button>
                </div>
                <button onClick={() => setNewKeyResult(null)} className="text-[10px] text-gray-500 hover:text-white">Cerrar</button>
              </div>
            )}

            <div className="flex gap-2">
              <input type="text" value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                placeholder="Nombre de la key (ej: Mi App, Zapier, Make...)"
                className="flex-1 p-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                onKeyDown={e => e.key === 'Enter' && createApiKey()} />
              <button onClick={createApiKey} disabled={creatingKey || !newKeyName.trim()}
                className="px-4 py-2.5 rounded-xl bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-30 text-sm font-semibold transition-colors flex items-center gap-1.5">
                {creatingKey ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Crear Key
              </button>
            </div>

            {loadingKeys ? (
              <div className="flex justify-center py-8"><div className="loading-spinner w-6 h-6" /></div>
            ) : apiKeys.length === 0 ? (
              <div className="text-center py-8">
                <Key className="w-10 h-10 text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No tienes API Keys</p>
                <p className="text-xs text-gray-600 mt-1">Crea una para conectar herramientas externas</p>
              </div>
            ) : (
              <div className="space-y-2">
                {apiKeys.map(key => (
                  <div key={key.id} className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${key.isActive ? 'bg-white/3 border-white/10' : 'bg-white/1 border-white/5 opacity-60'}`}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`w-2 h-2 rounded-full ${key.isActive ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{key.name}</p>
                        <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
                          <span className="font-mono text-amber-400/70">{key.prefix}...</span>
                          <span>Creada: {new Date(key.createdAt).toLocaleDateString()}</span>
                          {key.lastUsedAt && <span>Último uso: {new Date(key.lastUsedAt).toLocaleDateString()}</span>}
                          {key.totalCalls > 0 && <span>{key.totalCalls} llamadas</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => toggleApiKey(key.id, key.isActive)} title={key.isActive ? 'Desactivar' : 'Activar'}
                        className={`p-2 rounded-lg transition-colors ${key.isActive ? 'hover:bg-amber-500/10 text-amber-400' : 'hover:bg-emerald-500/10 text-gray-500'}`}>
                        <Power className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteApiKey(key.id)} title="Eliminar"
                        className="p-2 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {apiKeys.length > 0 && (
              <details className="group">
                <summary className="text-xs text-[var(--text-muted)] hover:text-white cursor-pointer flex items-center gap-1">
                  <Code className="w-3 h-3" /> Referencia rápida de la API
                </summary>
                <div className="mt-3 p-3 rounded-xl bg-black/30 border border-white/5 space-y-2 text-[10px] font-mono">
                  <p className="text-gray-400"># Header de autenticación:</p>
                  <p className="text-amber-300">X-API-Key: bz_tu_api_key_aqui</p>
                  <div className="border-t border-white/5 my-2" />
                  <p className="text-gray-400"># Endpoints disponibles:</p>
                  <p className="text-cyan-300">GET  /api/v1/stats <span className="text-gray-500">→ Estadísticas generales</span></p>
                  <p className="text-cyan-300">GET  /api/v1/clients <span className="text-gray-500">→ Listar clientes</span></p>
                  <p className="text-cyan-300">GET  /api/v1/conversations <span className="text-gray-500">→ Conversaciones</span></p>
                  <p className="text-cyan-300">GET  /api/v1/crm/pipeline <span className="text-gray-500">→ Pipeline CRM</span></p>
                  <p className="text-cyan-300">GET  /api/v1/appointments <span className="text-gray-500">→ Citas</span></p>
                  <p className="text-cyan-300">GET  /api/v1/products <span className="text-gray-500">→ Productos</span></p>
                  <p className="text-emerald-300">POST /api/v1/send-message <span className="text-gray-500">→ Enviar mensaje</span></p>
                  <p className="text-amber-300">POST /api/v1/conversations/:id/stage <span className="text-gray-500">→ Cambiar etapa</span></p>
                  <p className="text-amber-300">POST /api/v1/conversations/:id/pause-ai <span className="text-gray-500">→ Pausar IA</span></p>
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* Webhooks Section */}
      {/* ============================================================ */}
      <div className="card-dark rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-white/5 cursor-pointer" onClick={() => setShowWebhooksSection(!showWebhooksSection)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-lg">
                <Bell className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Webhooks</h2>
                <p className="text-xs text-[var(--text-muted)]">Recibe eventos en tiempo real en tu servidor</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {webhooks.length > 0 && (
                <span className="text-xs px-2.5 py-1 rounded-full bg-violet-500/15 text-violet-400 font-semibold">
                  {webhooks.filter(w => w.isActive).length} activo{webhooks.filter(w => w.isActive).length !== 1 ? 's' : ''}
                </span>
              )}
              <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${showWebhooksSection ? 'rotate-180' : ''}`} />
            </div>
          </div>
        </div>

        {showWebhooksSection && (
          <div className="p-5 space-y-4">
            <div className="p-3 rounded-xl bg-violet-500/5 border border-violet-500/10">
              <p className="text-xs text-[var(--text-muted)]">
                <span className="text-violet-400 font-semibold">🔔 Webhooks</span> envían notificaciones HTTP POST a tu URL cada vez que ocurre un evento (nuevo mensaje, lead, cita, etc). Ideal para automatizar flujos con Zapier, Make, n8n o tu propio backend.
              </p>
            </div>

            {!showWebhookForm ? (
              <button onClick={() => setShowWebhookForm(true)}
                className="w-full py-3 rounded-xl border-2 border-dashed border-violet-500/20 text-violet-400 hover:border-violet-500/40 hover:bg-violet-500/5 text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                <Plus className="w-4 h-4" /> Agregar Webhook
              </button>
            ) : (
              <div className="p-4 rounded-xl bg-violet-500/5 border border-violet-500/20 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-violet-400">Nuevo Webhook</p>
                  <button onClick={() => { setShowWebhookForm(false); setWebhookError(''); }} className="text-gray-500 hover:text-white text-lg">✕</button>
                </div>

                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Nombre</label>
                  <input type="text" value={webhookForm.name} onChange={e => setWebhookForm({ ...webhookForm, name: e.target.value })}
                    placeholder="Ej: Zapier Leads, Mi Backend, n8n Flow..."
                    className="w-full p-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500 focus:border-violet-500 outline-none" />
                </div>

                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">URL del endpoint</label>
                  <input type="url" value={webhookForm.url} onChange={e => setWebhookForm({ ...webhookForm, url: e.target.value })}
                    placeholder="https://hooks.zapier.com/hooks/catch/..."
                    className="w-full p-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500 focus:border-violet-500 outline-none" />
                </div>

                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-2">Eventos a escuchar</label>
                  <div className="grid grid-cols-2 gap-2">
                    {WEBHOOK_EVENTS.map(evt => (
                      <button key={evt.id} onClick={() => toggleWebhookEvent(evt.id)}
                        className={`flex items-center gap-2 p-2.5 rounded-lg text-left transition-all ${
                          webhookForm.events.includes(evt.id)
                            ? 'bg-violet-500/15 border border-violet-500/30 text-white'
                            : 'bg-white/3 border border-white/5 text-gray-400 hover:border-white/10 hover:text-white'
                        }`}>
                        <evt.icon className={`w-3.5 h-3.5 flex-shrink-0 ${webhookForm.events.includes(evt.id) ? 'text-violet-400' : 'text-gray-500'}`} />
                        <div>
                          <p className="text-xs font-semibold">{evt.label}</p>
                          <p className="text-[9px] text-[var(--text-muted)]">{evt.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {webhookError && <p className="text-xs text-red-400 bg-red-500/10 p-2 rounded-lg">{webhookError}</p>}

                <button onClick={createWebhook} disabled={creatingWebhook}
                  className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:bg-violet-600/30 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
                  {creatingWebhook ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                  {creatingWebhook ? 'Creando...' : 'Crear Webhook'}
                </button>
              </div>
            )}

            {loadingWebhooks ? (
              <div className="flex justify-center py-8"><div className="loading-spinner w-6 h-6" /></div>
            ) : webhooks.length === 0 && !showWebhookForm ? (
              <div className="text-center py-8">
                <Bell className="w-10 h-10 text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No tienes webhooks configurados</p>
                <p className="text-xs text-gray-600 mt-1">Agrega uno para recibir eventos en tiempo real</p>
              </div>
            ) : (
              <div className="space-y-2">
                {webhooks.map(wh => (
                  <div key={wh.id} className={`rounded-xl border transition-colors ${wh.isActive ? 'bg-white/3 border-white/10' : 'bg-white/1 border-white/5 opacity-60'}`}>
                    <div className="flex items-center justify-between p-3 cursor-pointer" onClick={() => setExpandedWebhook(expandedWebhook === wh.id ? null : wh.id)}>
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${wh.isActive ? 'bg-violet-400' : 'bg-gray-600'}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{wh.name}</p>
                          <p className="text-[10px] text-[var(--text-muted)] truncate font-mono">{wh.url}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {wh.lastStatus > 0 && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${wh.lastStatus < 300 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                            {wh.lastStatus}
                          </span>
                        )}
                        <span className="text-[10px] text-gray-500">{wh.events?.length || 0} eventos</span>
                        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${expandedWebhook === wh.id ? 'rotate-180' : ''}`} />
                      </div>
                    </div>

                    {expandedWebhook === wh.id && (
                      <div className="px-3 pb-3 space-y-3 border-t border-white/5 pt-3">
                        <div className="flex flex-wrap gap-1.5">
                          {(wh.events || []).map((evt: string) => {
                            const evtInfo = WEBHOOK_EVENTS.find(e => e.id === evt);
                            return (
                              <span key={evt} className="text-[10px] px-2 py-1 rounded-full bg-violet-500/10 text-violet-300 font-medium">
                                {evtInfo?.label || evt}
                              </span>
                            );
                          })}
                        </div>

                        <div className="flex gap-4 text-[10px] text-[var(--text-muted)]">
                          <span>📤 {wh.totalSent || 0} enviados</span>
                          {wh.totalFailed > 0 && <span className="text-red-400">❌ {wh.totalFailed} fallidos</span>}
                          <span>Creado: {new Date(wh.createdAt).toLocaleDateString()}</span>
                        </div>

                        {wh.lastError && (
                          <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[10px] text-red-300 truncate">
                            ⚠️ {wh.lastError}
                          </div>
                        )}

                        <div className="flex items-center gap-2 p-2 rounded-lg bg-black/20">
                          <Shield className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
                          <span className="text-[10px] text-[var(--text-muted)]">Secret:</span>
                          <code className="text-[10px] text-violet-300 font-mono flex-1 truncate">
                            {showSecrets[wh.id] ? wh.secret : '••••••••••••••••••••'}
                          </code>
                          <button onClick={(e) => { e.stopPropagation(); setShowSecrets({ ...showSecrets, [wh.id]: !showSecrets[wh.id] }); }}
                            className="text-gray-500 hover:text-white p-1">
                            {showSecrets[wh.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                          {wh.secret && (
                            <button onClick={(e) => { e.stopPropagation(); copyToClipboard(wh.secret, 'secret', wh.id); }}
                              className={`p-1 transition-colors ${copiedSecret === wh.id ? 'text-emerald-400' : 'text-gray-500 hover:text-white'}`}>
                              {copiedSecret === wh.id ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            </button>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <button onClick={(e) => { e.stopPropagation(); toggleWebhook(wh.id, wh.isActive); }}
                            className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                              wh.isActive ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                            }`}>
                            <Power className="w-3.5 h-3.5" />
                            {wh.isActive ? 'Desactivar' : 'Activar'}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); deleteWebhook(wh.id); }}
                            className="px-4 py-2 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors flex items-center gap-1.5">
                            <Trash2 className="w-3.5 h-3.5" /> Eliminar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {webhooks.length > 0 && (
              <details className="group">
                <summary className="text-xs text-[var(--text-muted)] hover:text-white cursor-pointer flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Verificación de firma (HMAC)
                </summary>
                <div className="mt-3 p-3 rounded-xl bg-black/30 border border-white/5 space-y-2 text-[10px] font-mono">
                  <p className="text-gray-400"># Cada webhook incluye estos headers:</p>
                  <p className="text-violet-300">X-Bizonne-Signature: <span className="text-gray-500">hmac_sha256(payload, secret)</span></p>
                  <p className="text-violet-300">X-Bizonne-Event: <span className="text-gray-500">message.received</span></p>
                  <p className="text-violet-300">X-Bizonne-Webhook-Id: <span className="text-gray-500">webhook_id</span></p>
                  <div className="border-t border-white/5 my-2" />
                  <p className="text-gray-400"># Payload de ejemplo:</p>
                  <pre className="text-cyan-300 whitespace-pre-wrap">{`{
  "event": "message.received",
  "timestamp": "2026-02-26T...",
  "data": {
    "phone": "573001234567",
    "message": "Hola, quiero...",
    "conversationId": "..."
  }
}`}</pre>
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

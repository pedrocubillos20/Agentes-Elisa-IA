'use client';

import { useState, useEffect } from 'react';
import {
  Link2, Unlink, RefreshCw, ArrowRight, ArrowLeft, Key, Globe,
  CheckCircle, Settings, Zap, Users, Calendar, MessageSquare,
  GitBranch, Clock, AlertTriangle, ChevronDown, ExternalLink, Eye, EyeOff, Copy, HelpCircle
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

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

  // API Key connection form
  const [connectTab, setConnectTab] = useState<'apikey' | 'oauth'>('apikey');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [locationIdInput, setLocationIdInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const getToken = () => localStorage.getItem('token') || '';
  const headers = () => ({ 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'ghl_connected') window.history.replaceState({}, '', '/integraciones');
    if (params.get('error')) { setConnectError(`Error OAuth: ${params.get('error')}`); window.history.replaceState({}, '', '/integraciones'); }
  }, []);

  useEffect(() => { fetchStatus(); }, []);

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

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><div className="loading-spinner w-8 h-8" /></div>;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Zap className="w-6 h-6 text-orange-400" /> Integraciones</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">Conecta tu CRM con servicios externos</p>
      </div>

      {/* GoHighLevel Card */}
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
          /* ===== CONNECTED STATE ===== */
          <div className="p-5 space-y-5">
            <div className="flex items-center gap-4 p-3 rounded-xl bg-white/3">
              <div className="flex-1"><p className="text-xs text-[var(--text-muted)]">Ubicación GHL</p><p className="text-sm font-semibold text-white">{ghl.locationName || ghl.locationId}</p></div>
              <div className="flex-1"><p className="text-xs text-[var(--text-muted)]">Última sync</p><p className="text-sm text-white">{ghl.lastSyncAt ? new Date(ghl.lastSyncAt).toLocaleString() : 'Nunca'}</p></div>
              <div className="flex-1"><p className="text-xs text-[var(--text-muted)]">Total sincronizado</p><p className="text-sm font-semibold text-emerald-400">{ghl.totalSynced || 0}</p></div>
            </div>

            {ghl.lastError && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-red-400 mt-0.5" /><p className="text-xs text-red-300">{ghl.lastError}</p></div>}

            {/* Sync Toggles */}
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

            {/* Pipeline Mapping */}
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

            {/* Calendar */}
            {ghl.syncCalendar && ghl.calendars?.length > 0 && (
              <div className="space-y-2">
                <span className="text-sm font-semibold text-white flex items-center gap-2"><Calendar className="w-4 h-4 text-purple-400" /> Calendario</span>
                <select value={ghl.calendarId || ''} onChange={e => updateSettings({ calendarId: e.target.value })} className="w-full p-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm">
                  <option value="">Seleccionar calendario</option>
                  {ghl.calendars?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            {/* Sync Actions */}
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
          /* ===== NOT CONNECTED STATE ===== */
          <div className="p-6">
            {/* Features grid */}
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

            {/* Connection Tabs */}
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
                        <p>3. En la sección <strong>"API Key"</strong>, genera o copia tu key</p>
                        <p>4. El <strong>Location ID</strong> está en la URL: <code className="text-blue-400">app.gohighlevel.com/v2/location/<strong>TU_LOCATION_ID</strong>/...</code></p>
                        <p>5. O ve a Settings → Business Profile → Company ID / Location ID</p>
                      </div>
                    )}
                    <p className="text-[10px] text-[var(--text-muted)]">
                      Ingresa tu API Key y Location ID de GoHighLevel. Cada usuario conecta su propia cuenta.
                    </p>
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
    </div>
  );
}

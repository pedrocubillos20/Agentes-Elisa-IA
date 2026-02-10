'use client';
import { useState, useEffect } from 'react';
import {
  Key, Webhook, Plus, Trash2, Copy, Check, Eye, EyeOff,
  ToggleLeft, ToggleRight, Send, ChevronDown, ChevronRight,
  AlertCircle, CheckCircle, XCircle, Clock, ExternalLink,
  Code, Zap, RefreshCw, BarChart3, Shield, FileText, Info
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const AVAILABLE_EVENTS = [
  { value: 'message.received', label: 'Mensaje recibido', desc: 'Cuando un cliente envía un mensaje' },
  { value: 'message.sent', label: 'Mensaje enviado', desc: 'Cuando el bot/agente envía un mensaje' },
  { value: 'conversation.created', label: 'Conversación creada', desc: 'Nuevo contacto escribe por primera vez' },
  { value: 'conversation.stage_changed', label: 'Etapa cambiada', desc: 'Cambio de etapa en el pipeline CRM' },
  { value: 'client.created', label: 'Cliente creado', desc: 'Se crea un nuevo cliente en el CRM' },
  { value: 'appointment.created', label: 'Cita creada', desc: 'Se agenda una nueva cita' },
  { value: 'appointment.updated', label: 'Cita actualizada', desc: 'Se actualiza estado de una cita' },
];

export default function IntegracionesPage() {
  const [tab, setTab] = useState<'keys' | 'webhooks' | 'docs'>('keys');
  const [keys, setKeys] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ type: '', text: '' });

  // API Key form
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState('');
  const [copiedKey, setCopiedKey] = useState('');

  // Webhook form
  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [webhookForm, setWebhookForm] = useState({ name: '', url: '', events: [] as string[] });
  const [editingWebhook, setEditingWebhook] = useState<string | null>(null);
  const [expandedWebhook, setExpandedWebhook] = useState<string | null>(null);
  const [webhookLogs, setWebhookLogs] = useState<any[]>([]);
  const [testingWebhook, setTestingWebhook] = useState('');

  const headers = () => ({ 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' });

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    try {
      const [keysRes, webhooksRes] = await Promise.all([
        fetch(`${API_URL}/api/integrations/keys`, { headers: headers() }),
        fetch(`${API_URL}/api/integrations/webhooks`, { headers: headers() })
      ]);
      if (keysRes.ok) setKeys((await keysRes.json()).keys || []);
      if (webhooksRes.ok) setWebhooks((await webhooksRes.json()).webhooks || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // === API KEYS ===
  const createKey = async () => {
    try {
      const res = await fetch(`${API_URL}/api/integrations/keys`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ name: newKeyName || 'Mi API Key' })
      });
      const data = await res.json();
      if (res.ok) {
        setCreatedKey(data.key);
        setNewKeyName('');
        fetchAll();
        setMsg({ type: 'success', text: '🔑 API Key creada. Cópiala ahora, no se mostrará de nuevo.' });
      } else {
        setMsg({ type: 'error', text: data.error });
      }
    } catch (e) { setMsg({ type: 'error', text: 'Error de conexión' }); }
  };

  const deleteKey = async (id: string) => {
    if (!confirm('¿Eliminar esta API Key? Las integraciones que la usen dejarán de funcionar.')) return;
    await fetch(`${API_URL}/api/integrations/keys/${id}`, { method: 'DELETE', headers: headers() });
    fetchAll();
  };

  const toggleKey = async (id: string, isActive: boolean) => {
    await fetch(`${API_URL}/api/integrations/keys/${id}`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ isActive: !isActive })
    });
    fetchAll();
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(''), 2000);
  };

  // === WEBHOOKS ===
  const saveWebhook = async () => {
    if (!webhookForm.name || !webhookForm.url) {
      setMsg({ type: 'error', text: 'Nombre y URL son requeridos' }); return;
    }
    try {
      const method = editingWebhook ? 'PUT' : 'POST';
      const url = editingWebhook
        ? `${API_URL}/api/integrations/webhooks/${editingWebhook}`
        : `${API_URL}/api/integrations/webhooks`;

      const res = await fetch(url, { method, headers: headers(), body: JSON.stringify(webhookForm) });
      if (res.ok) {
        setShowWebhookForm(false);
        setEditingWebhook(null);
        setWebhookForm({ name: '', url: '', events: [] });
        fetchAll();
        setMsg({ type: 'success', text: editingWebhook ? 'Webhook actualizado' : 'Webhook creado' });
      } else {
        setMsg({ type: 'error', text: (await res.json()).error });
      }
    } catch (e) { setMsg({ type: 'error', text: 'Error de conexión' }); }
  };

  const deleteWebhook = async (id: string) => {
    if (!confirm('¿Eliminar este webhook?')) return;
    await fetch(`${API_URL}/api/integrations/webhooks/${id}`, { method: 'DELETE', headers: headers() });
    fetchAll();
  };

  const toggleWebhook = async (id: string, isActive: boolean) => {
    await fetch(`${API_URL}/api/integrations/webhooks/${id}`, {
      method: 'PUT', headers: headers(),
      body: JSON.stringify({ isActive: !isActive })
    });
    fetchAll();
  };

  const testWebhook = async (id: string) => {
    setTestingWebhook(id);
    try {
      const res = await fetch(`${API_URL}/api/integrations/webhooks/${id}/test`, { method: 'POST', headers: headers() });
      const data = await res.json();
      setMsg({ type: data.success ? 'success' : 'error', text: data.success ? `✅ Test exitoso (${data.statusCode} en ${data.duration}ms)` : `❌ Falló: ${data.error || `Status ${data.statusCode}`}` });
      fetchAll();
    } catch (e) { setMsg({ type: 'error', text: 'Error al probar webhook' }); }
    finally { setTestingWebhook(''); }
  };

  const fetchLogs = async (webhookId: string) => {
    if (expandedWebhook === webhookId) { setExpandedWebhook(null); return; }
    try {
      const res = await fetch(`${API_URL}/api/integrations/webhooks/${webhookId}/logs`, { headers: headers() });
      if (res.ok) setWebhookLogs((await res.json()).logs || []);
    } catch (e) {}
    setExpandedWebhook(webhookId);
  };

  const toggleEvent = (event: string) => {
    setWebhookForm(f => ({
      ...f,
      events: f.events.includes(event) ? f.events.filter(e => e !== event) : [...f.events, event]
    }));
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="loading-spinner" />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center">
            <Code className="w-7 h-7 text-violet-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">API & Integraciones</h1>
            <p className="text-[var(--text-muted)] mt-1">Conecta Bizonne con tus plataformas externas</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-white/5 p-1 rounded-xl">
        {[
          { id: 'keys', label: 'API Keys', icon: Key },
          { id: 'webhooks', label: 'Webhooks', icon: Webhook },
          { id: 'docs', label: 'Documentación', icon: FileText },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-all ${
              tab === t.id ? 'bg-[var(--accent-primary)] text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* Message */}
      {msg.text && (
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${
          msg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-red-500/10 border-red-500/20 text-red-300'
        }`}>
          {msg.type === 'success' ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
          <span className="text-sm flex-1">{msg.text}</span>
          <button onClick={() => setMsg({ type: '', text: '' })} className="text-gray-500 hover:text-white">✕</button>
        </div>
      )}

      {/* ===== API KEYS TAB ===== */}
      {tab === 'keys' && (
        <div className="space-y-4">
          {/* Crear nueva key */}
          <div className="card p-5">
            <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
              <Key className="w-5 h-5 text-amber-400" /> Crear API Key
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Las API Keys te permiten autenticarte contra la API de Bizonne desde cualquier plataforma externa.
            </p>
            <div className="flex gap-3">
              <input
                type="text" placeholder="Nombre (ej: Zapier, Make, Mi App)"
                value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                className="input flex-1" />
              <button onClick={createKey} className="btn-primary whitespace-nowrap">
                <Plus className="w-4 h-4" /> Generar Key
              </button>
            </div>

            {/* Mostrar key recién creada */}
            {createdKey && (
              <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                <p className="text-xs font-bold text-amber-400 mb-2">⚠️ Copia tu API Key ahora — no se mostrará de nuevo:</p>
                <div className="flex items-center gap-2 bg-black/40 p-3 rounded-lg font-mono text-sm text-white break-all">
                  <span className="flex-1">{createdKey}</span>
                  <button onClick={() => copyToClipboard(createdKey, 'new')}
                    className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition flex-shrink-0">
                    {copiedKey === 'new' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button onClick={() => setCreatedKey('')} className="text-xs text-gray-500 mt-2 hover:text-white">Cerrar</button>
              </div>
            )}
          </div>

          {/* Lista de keys */}
          {keys.length === 0 ? (
            <div className="card p-10 text-center">
              <Key className="w-12 h-12 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500">No tienes API Keys. Crea una para empezar a integrar.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {keys.map(k => (
                <div key={k.id} className={`card p-4 transition-all ${k.isActive ? '' : 'opacity-50'}`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${k.isActive ? 'bg-amber-500/20' : 'bg-gray-500/20'}`}>
                      <Key className={`w-5 h-5 ${k.isActive ? 'text-amber-400' : 'text-gray-500'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{k.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${k.isActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                          {k.isActive ? 'Activa' : 'Desactivada'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="font-mono text-xs text-gray-500">{k.prefix}••••••••</span>
                        <span className="text-[10px] text-gray-600">{k.totalCalls} llamadas</span>
                        {k.lastUsedAt && <span className="text-[10px] text-gray-600">Último uso: {new Date(k.lastUsedAt).toLocaleDateString()}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleKey(k.id, k.isActive)} className="p-2 rounded-lg hover:bg-white/10 transition"
                        title={k.isActive ? 'Desactivar' : 'Activar'}>
                        {k.isActive ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5 text-gray-500" />}
                      </button>
                      <button onClick={() => deleteKey(k.id)} className="p-2 rounded-lg hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== WEBHOOKS TAB ===== */}
      {tab === 'webhooks' && (
        <div className="space-y-4">
          {/* Crear/Editar webhook */}
          {!showWebhookForm ? (
            <button onClick={() => { setShowWebhookForm(true); setEditingWebhook(null); setWebhookForm({ name: '', url: '', events: [] }); }}
              className="btn-primary">
              <Plus className="w-4 h-4" /> Nuevo Webhook
            </button>
          ) : (
            <div className="card p-5 space-y-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Webhook className="w-5 h-5 text-blue-400" /> {editingWebhook ? 'Editar' : 'Nuevo'} Webhook
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Nombre</label>
                  <input type="text" placeholder="Mi webhook" value={webhookForm.name}
                    onChange={e => setWebhookForm(f => ({ ...f, name: e.target.value }))} className="input w-full" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">URL del Webhook</label>
                  <input type="url" placeholder="https://tu-servidor.com/webhook" value={webhookForm.url}
                    onChange={e => setWebhookForm(f => ({ ...f, url: e.target.value }))} className="input w-full" />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-2 block">Eventos a recibir:</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {AVAILABLE_EVENTS.map(ev => (
                    <button key={ev.value} onClick={() => toggleEvent(ev.value)}
                      className={`flex items-start gap-3 p-3 rounded-xl text-left transition-all ${
                        webhookForm.events.includes(ev.value)
                          ? 'bg-blue-500/15 border border-blue-500/30'
                          : 'bg-white/5 border border-white/5 hover:border-white/10'
                      }`}>
                      <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        webhookForm.events.includes(ev.value) ? 'bg-blue-500 text-white' : 'bg-white/10'
                      }`}>
                        {webhookForm.events.includes(ev.value) && <Check className="w-3 h-3" />}
                      </div>
                      <div>
                        <span className="text-sm font-medium text-white">{ev.label}</span>
                        <p className="text-[11px] text-gray-500">{ev.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={saveWebhook} className="btn-primary">
                  <Check className="w-4 h-4" /> Guardar Webhook
                </button>
                <button onClick={() => { setShowWebhookForm(false); setEditingWebhook(null); }} className="btn-secondary">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Lista de webhooks */}
          {webhooks.length === 0 && !showWebhookForm ? (
            <div className="card p-10 text-center">
              <Webhook className="w-12 h-12 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500">No tienes webhooks configurados. Crea uno para recibir eventos en tiempo real.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {webhooks.map(w => (
                <div key={w.id} className={`card transition-all ${w.isActive ? '' : 'opacity-50'}`}>
                  <div className="p-4">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        w.lastStatus && w.lastStatus >= 200 && w.lastStatus < 300 ? 'bg-emerald-500/20' :
                        w.lastStatus ? 'bg-red-500/20' : 'bg-blue-500/20'
                      }`}>
                        {w.lastStatus && w.lastStatus >= 200 && w.lastStatus < 300 ? (
                          <CheckCircle className="w-5 h-5 text-emerald-400" />
                        ) : w.lastStatus ? (
                          <XCircle className="w-5 h-5 text-red-400" />
                        ) : (
                          <Webhook className="w-5 h-5 text-blue-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-white">{w.name}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${w.isActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                            {w.isActive ? 'Activo' : 'Inactivo'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{w.url}</p>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          {(w.events || []).map((e: string) => (
                            <span key={e} className="text-[10px] bg-white/5 text-gray-400 px-2 py-0.5 rounded-full">{e}</span>
                          ))}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-600">
                          <span>Enviados: {w.totalSent}</span>
                          {w.totalFailed > 0 && <span className="text-red-400">Fallidos: {w.totalFailed}</span>}
                          {w.lastStatus && <span>Último: {w.lastStatus}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => testWebhook(w.id)} disabled={testingWebhook === w.id}
                          className="p-2 rounded-lg hover:bg-white/10 transition text-gray-500 hover:text-amber-400" title="Enviar test">
                          {testingWebhook === w.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                        <button onClick={() => fetchLogs(w.id)}
                          className="p-2 rounded-lg hover:bg-white/10 transition text-gray-500 hover:text-blue-400" title="Ver logs">
                          <BarChart3 className="w-4 h-4" />
                        </button>
                        <button onClick={() => {
                          setEditingWebhook(w.id);
                          setWebhookForm({ name: w.name, url: w.url, events: w.events || [] });
                          setShowWebhookForm(true);
                        }} className="p-2 rounded-lg hover:bg-white/10 transition text-gray-500 hover:text-white" title="Editar">
                          <FileText className="w-4 h-4" />
                        </button>
                        <button onClick={() => toggleWebhook(w.id, w.isActive)} className="p-2 rounded-lg hover:bg-white/10 transition">
                          {w.isActive ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5 text-gray-500" />}
                        </button>
                        <button onClick={() => deleteWebhook(w.id)} className="p-2 rounded-lg hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Logs expandibles */}
                  {expandedWebhook === w.id && (
                    <div className="border-t border-white/5 p-4 max-h-80 overflow-y-auto">
                      <h4 className="text-xs font-bold text-gray-400 mb-3">Últimas entregas</h4>
                      {webhookLogs.length === 0 ? (
                        <p className="text-xs text-gray-600 text-center py-4">Sin logs aún</p>
                      ) : (
                        <div className="space-y-2">
                          {webhookLogs.slice(0, 20).map(log => (
                            <div key={log.id} className={`flex items-center gap-3 p-2.5 rounded-lg text-xs ${
                              log.success ? 'bg-emerald-500/5' : 'bg-red-500/5'
                            }`}>
                              {log.success ? (
                                <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                              ) : (
                                <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                              )}
                              <span className="font-mono text-gray-400">{log.event}</span>
                              <span className={`px-1.5 py-0.5 rounded ${
                                log.statusCode >= 200 && log.statusCode < 300 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                              }`}>{log.statusCode}</span>
                              <span className="text-gray-600">{log.duration}ms</span>
                              <span className="text-gray-600 ml-auto">{new Date(log.createdAt).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Secret info */}
          <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <Shield className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-gray-300">
              <strong>Seguridad:</strong> Cada webhook tiene un <code className="text-blue-300">secret</code> para verificar la autenticidad. El payload se firma con HMAC SHA256 y se envía en el header <code className="text-blue-300">X-Bizonne-Signature</code>.
            </div>
          </div>
        </div>
      )}

      {/* ===== DOCS TAB ===== */}
      {tab === 'docs' && (
        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Code className="w-5 h-5 text-violet-400" /> API REST de Bizonne
            </h3>
            <p className="text-sm text-gray-400 mb-6">
              Usa tu API Key para acceder a tus datos de Bizonne desde cualquier plataforma. La autenticación se hace vía el header <code className="bg-white/10 px-1.5 py-0.5 rounded text-violet-300">X-Api-Key</code>.
            </p>

            <div className="bg-black/40 rounded-xl border border-white/10 p-4 mb-6">
              <p className="text-xs text-gray-500 mb-2">Base URL:</p>
              <code className="text-emerald-300 text-sm">{API_URL}/api/v1</code>
            </div>

            {/* Endpoints */}
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Endpoints disponibles</h4>

              {[
                { method: 'GET', path: '/v1/conversations', desc: 'Listar conversaciones', params: 'stage, limit, offset, lineId' },
                { method: 'GET', path: '/v1/conversations/:id/messages', desc: 'Mensajes de una conversación', params: 'limit, offset' },
                { method: 'GET', path: '/v1/crm/pipeline', desc: 'Pipeline con estadísticas por etapa', params: 'stage, lineId' },
                { method: 'GET', path: '/v1/clients', desc: 'Listar clientes CRM', params: 'status, limit, offset' },
                { method: 'GET', path: '/v1/appointments', desc: 'Listar citas/agenda', params: 'status, from, to' },
                { method: 'GET', path: '/v1/products', desc: 'Listar productos', params: '' },
                { method: 'GET', path: '/v1/stats', desc: 'Estadísticas generales', params: '' },
                { method: 'POST', path: '/v1/send-message', desc: 'Enviar mensaje por WhatsApp', params: 'phone, message, lineId' },
                { method: 'POST', path: '/v1/conversations/:id/stage', desc: 'Cambiar etapa del pipeline', params: 'stage' },
                { method: 'POST', path: '/v1/conversations/:id/pause-ai', desc: 'Pausar/reactivar IA', params: 'paused (boolean)' },
              ].map((ep, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
                  <span className={`text-[10px] font-black px-2 py-1 rounded ${
                    ep.method === 'GET' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                  }`}>{ep.method}</span>
                  <div className="flex-1 min-w-0">
                    <code className="text-sm text-white">{ep.path}</code>
                    <p className="text-xs text-gray-500 mt-0.5">{ep.desc}</p>
                    {ep.params && <p className="text-[10px] text-gray-600 mt-0.5">Params: {ep.params}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Ejemplo de uso */}
          <div className="card p-6">
            <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" /> Ejemplo de uso
            </h4>

            <div className="bg-black/40 rounded-xl border border-white/10 p-4 font-mono text-sm text-gray-300 whitespace-pre overflow-x-auto">
{`# Obtener conversaciones
curl -H "X-Api-Key: bz_tu_api_key" \\
  "${API_URL}/api/v1/conversations?stage=Interesado&limit=10"

# Enviar mensaje
curl -X POST \\
  -H "X-Api-Key: bz_tu_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{"phone":"573001234567","message":"Hola!"}' \\
  "${API_URL}/api/v1/send-message"

# Estadísticas
curl -H "X-Api-Key: bz_tu_api_key" \\
  "${API_URL}/api/v1/stats"`}
            </div>
          </div>

          {/* Webhook payload example */}
          <div className="card p-6">
            <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Webhook className="w-5 h-5 text-blue-400" /> Payload de Webhooks
            </h4>
            <p className="text-sm text-gray-400 mb-4">Cada webhook envía un POST con esta estructura:</p>

            <div className="bg-black/40 rounded-xl border border-white/10 p-4 font-mono text-sm text-gray-300 whitespace-pre overflow-x-auto">
{`// Headers:
// X-Bizonne-Signature: hmac_sha256_signature
// X-Bizonne-Event: message.received
// Content-Type: application/json

{
  "event": "message.received",
  "timestamp": "2026-02-10T15:30:00.000Z",
  "data": {
    "conversationId": "clx...",
    "phone": "573001234567",
    "name": "Juan Pérez",
    "message": "Hola, quiero cotizar",
    "stage": "Interesado",
    "lineId": "clx..."
  }
}`}
            </div>

            <div className="mt-4 p-4 bg-violet-500/10 border border-violet-500/20 rounded-xl">
              <p className="text-xs font-bold text-violet-400 mb-1">Verificar firma:</p>
              <div className="font-mono text-xs text-gray-300 whitespace-pre overflow-x-auto">
{`const crypto = require('crypto');
const signature = req.headers['x-bizonne-signature'];
const expected = crypto
  .createHmac('sha256', 'tu_webhook_secret')
  .update(JSON.stringify(req.body))
  .digest('hex');
const isValid = signature === expected;`}
              </div>
            </div>
          </div>

          {/* Eventos disponibles */}
          <div className="card p-6">
            <h4 className="text-lg font-bold text-white mb-4">Eventos disponibles</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {AVAILABLE_EVENTS.map(ev => (
                <div key={ev.value} className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                  <code className="text-xs text-blue-300">{ev.value}</code>
                  <p className="text-xs text-gray-500 mt-1">{ev.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

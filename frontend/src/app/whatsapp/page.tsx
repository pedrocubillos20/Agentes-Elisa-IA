'use client';

import { useState, useEffect } from 'react';
import { 
  Smartphone, CheckCircle, XCircle, RefreshCw, Wifi, WifiOff, QrCode,
  Plus, Trash2, Edit2, X, Crown, Lock, Users, Bot, Phone, Signal, Cloud, Copy, ExternalLink
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function WhatsAppPage() {
  const [user, setUser] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [assistants, setAssistants] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // QR + Connect state per line
  const [connectingLineId, setConnectingLineId] = useState<string | null>(null);
  const [qrData, setQrData] = useState<Record<string, string>>({});
  const [qrLoading, setQrLoading] = useState<Record<string, boolean>>({});
  const [qrError, setQrError] = useState<Record<string, string>>({});  // error por línea
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagResult, setDiagResult] = useState<any>(null);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingLine, setEditingLine] = useState<any>(null);
  const [lineForm, setLineForm] = useState({ label: '', assignedTo: '', assistantId: '', connectionType: 'waha', cloudPhoneNumberId: '', cloudBusinessId: '', cloudAccessToken: '', cloudAppId: '' });
  const [cloudSetupInfo, setCloudSetupInfo] = useState<any>(null);
  const [savingLine, setSavingLine] = useState(false);

  // Plan limits (including purchased addons)
  const plan = user?.plan || 'trial';
  const features = user?.planFeatures || {};
  const planBaseLimits: Record<string, number> = { trial: 1, starter: 2, business: 5 };
  const maxLines = user?.effectiveLimits?.maxLines || planBaseLimits[plan] || 1;
  const isBusiness = plan === 'business';
  const canAddMore = lines.length < maxLines;
  const extraLinesPurchased = user?.effectiveLimits?.extraLinesPurchased || 0;

  useEffect(() => {
    // ⚡ INSTANT LOAD
    try {
      const cu = localStorage.getItem('bizonne_user_cache');
      if (cu) setUser(JSON.parse(cu));
      const cl = localStorage.getItem('bizonne_wa_lines');
      if (cl) { setLines(JSON.parse(cl)); setLoading(false); }
    } catch {}

    loadAll();
    const interval = setInterval(refreshLines, 15000); // Era 8s → ahora 15s
    return () => clearInterval(interval);
  }, []);

  const getToken = () => localStorage.getItem('token') || '';
  const headers = () => ({ 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' });

  const loadAll = async () => {
    try {
      // ⚡ User from cache (layout already fetches it)
      try { const cu = localStorage.getItem('bizonne_user_cache'); if (cu) setUser(JSON.parse(cu)); } catch {}

      const [linesRes, assistRes, teamRes] = await Promise.all([
        fetch(`${API_URL}/api/whatsapp/lines`, { headers: headers() }),
        fetch(`${API_URL}/api/assistants`, { headers: headers() }),
        fetch(`${API_URL}/api/team`, { headers: headers() }).catch(() => null),
      ]);

      if (linesRes.ok) {
        const data = await linesRes.json();
        setLines(data.lines || []);
        try { localStorage.setItem('bizonne_wa_lines', JSON.stringify(data.lines || [])); } catch {}
      }
      if (assistRes.ok) {
        const data = await assistRes.json();
        if (data.assistant) setAssistants([data.assistant]);
        else if (data.assistants) setAssistants(data.assistants);
      }
      if (teamRes?.ok) {
        const data = await teamRes.json();
        setTeamMembers(data.members || []);
      }
      // Refresh user from API in background
      const userRes = await fetch(`${API_URL}/api/auth/me`, { headers: headers() }).catch(() => null);
      if (userRes?.ok) { const u = (await userRes.json()).user; setUser(u); try { localStorage.setItem('bizonne_user_cache', JSON.stringify(u)); } catch {} }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const refreshLines = async () => {
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/lines`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setLines(data.lines || []);
      }
    } catch {}
  };

  // ===== CRUD Lines =====
  const handleSaveLine = async () => {
    setSavingLine(true);
    try {
      const url = editingLine 
        ? `${API_URL}/api/whatsapp/lines/${editingLine.id}`
        : `${API_URL}/api/whatsapp/lines`;
      const method = editingLine ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: headers(), body: JSON.stringify(lineForm) });
      if (res.ok) {
        const data = await res.json();
        if (data.webhookUrl && data.webhookVerifyToken) {
          setCloudSetupInfo({ webhookUrl: data.webhookUrl, webhookVerifyToken: data.webhookVerifyToken, instructions: data.instructions });
        } else {
          setShowModal(false); resetForm();
        }
        await loadAll();
      } else {
        const err = await res.json();
        alert(err.error || 'Error al guardar');
      }
    } catch (e) { console.error(e); }
    finally { setSavingLine(false); }
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!confirm('¿Eliminar esta línea? Se desconectará y se perderá la configuración.')) return;
    try {
      await fetch(`${API_URL}/api/whatsapp/lines/${lineId}`, { method: 'DELETE', headers: headers() });
      await loadAll();
    } catch (e) { console.error(e); }
  };

  const resetForm = () => {
    setLineForm({ label: '', assignedTo: '', assistantId: '', connectionType: 'waha', cloudPhoneNumberId: '', cloudBusinessId: '', cloudAccessToken: '', cloudAppId: '' });
    setEditingLine(null);
    setCloudSetupInfo(null);
  };

  const openEditLine = (line: any) => {
    setEditingLine(line);
    setLineForm({
      label: line.label || '', assignedTo: line.assignedTo || '', assistantId: line.assistantId || '',
      connectionType: line.connectionType || 'waha',
      cloudPhoneNumberId: line.cloudPhoneNumberId || '', cloudBusinessId: line.cloudBusinessId || '',
      cloudAccessToken: line.cloudAccessToken || '', cloudAppId: line.cloudAppId || ''
    });
    setCloudSetupInfo(null);
    setShowModal(true);
  };

  // ===== Connect / Disconnect / QR =====
  const connectLine = async (lineId: string) => {
    setConnectingLineId(lineId);
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/lines/${lineId}/connect`, {
        method: 'POST', headers: headers()
      });

      if (!res.ok) {
        // 🔧 FIX: Mostrar el error real de WAHA al usuario
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        const errMsg = errData.error || `Error ${res.status}`;
        console.error('WAHA connect error:', errData);
        alert(`❌ Error al conectar:\n\n${errMsg}\n\nVerifica que WAHA esté activo y accesible desde el servidor backend.`);
        return;
      }

      // ✅ Conexión iniciada — esperar y buscar QR
      const FIRST_WAIT = 12000;
      const POLL_INTERVAL = 3000;
      const MAX_DURATION = 90000;

      setTimeout(() => {
        let elapsed = FIRST_WAIT;
        // Primer intento inmediato tras FIRST_WAIT
        getQR(lineId);
        const qrInterval = setInterval(async () => {
          const got = await getQR(lineId);
          elapsed += POLL_INTERVAL;
          if (got || elapsed >= MAX_DURATION) {
            clearInterval(qrInterval);
            if (!got && elapsed >= MAX_DURATION) {
              console.warn('QR timeout: WAHA no generó QR en 90s');
            }
          }
        }, POLL_INTERVAL);
      }, FIRST_WAIT);

    } catch (e: any) {
      console.error('Connect error:', e);
      alert(`❌ Error de red al conectar: ${e.message}\n\nVerifica tu conexión a internet.`);
    } finally {
      setConnectingLineId(null);
    }
  };

  // Diagnóstico WAHA — verifica conectividad entre backend y WAHA
  const runDiagnostic = async () => {
    setDiagRunning(true);
    setDiagResult(null);
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/waha-diagnostic`, { headers: headers() });
      const data = await res.json();
      setDiagResult(data);
    } catch (e: any) {
      setDiagResult({ wahaReachable: false, diagnosis: `❌ Error de red: ${e.message}` });
    } finally {
      setDiagRunning(false);
    }
  };

  const disconnectLine = async (lineId: string) => {
    if (!confirm('¿Desconectar esta línea de WhatsApp?')) return;
    try {
      await fetch(`${API_URL}/api/whatsapp/lines/${lineId}/disconnect`, {
        method: 'POST', headers: headers()
      });
      setQrData(prev => { const n = {...prev}; delete n[lineId]; return n; });
      await refreshLines();
    } catch (e) { console.error(e); }
  };

  const getQR = async (lineId: string): Promise<boolean> => {
    setQrLoading(prev => ({...prev, [lineId]: true}));
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/lines/${lineId}/qr`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        if (data.qr) {
          setQrData(prev => ({...prev, [lineId]: data.qr}));
          setQrLoading(prev => ({...prev, [lineId]: false}));
          return true;
        }
      }
    } catch {}
    setQrLoading(prev => ({...prev, [lineId]: false}));
    return false;
  };

  // ===== Status helpers =====
  const statusBadge = (status: string) => {
    if (status === 'connected') return <span className="badge badge-success"><CheckCircle className="w-3 h-3" />Conectado</span>;
    if (status === 'connecting' || status === 'qr') return <span className="badge badge-warning"><RefreshCw className="w-3 h-3 animate-spin" />Conectando</span>;
    return <span className="badge badge-danger"><XCircle className="w-3 h-3" />Desconectado</span>;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <img src="/bizonne.png" alt="Bizonne" className="w-16 h-16 rounded-xl animate-pulse" />
        <div className="loading-spinner" />
      </div>
    );
  }

  const connectedLines = lines.filter(l => l.status === 'connected');

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/bizonne.png" alt="Bizonne" className="w-14 h-14 rounded-xl" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">WhatsApp</h1>
            <p className="text-[var(--text-muted)]">
              Gestiona tus líneas de WhatsApp • {connectedLines.length} conectada{connectedLines.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--text-muted)]">
            {lines.length}/{maxLines} líneas
          </span>
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            disabled={!canAddMore}
            className={`btn-primary ${!canAddMore ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {canAddMore ? <Plus className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            Nueva Línea
          </button>
        </div>
      </div>

      {/* Plan limit banner */}
      {!canAddMore && (
        <div className="card p-5 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Crown className="w-6 h-6 text-amber-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-white font-semibold">Límite de líneas alcanzado</h3>
              <p className="text-sm text-gray-400">
                Tu plan permite hasta {maxLines} línea{maxLines !== 1 ? 's' : ''}{extraLinesPurchased > 0 ? ` (${extraLinesPurchased} extra)` : ''}.
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <a href="/subscription#addons" className="btn-primary text-sm">
                📱 Comprar línea extra — $39 USD
              </a>
              {!isBusiness && (
                <a href="/subscription" className="btn-secondary text-sm">
                  <Crown className="w-4 h-4" /> Upgrade
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 🛒 Order Bump: Línea Adicional (siempre visible) */}
      {canAddMore && lines.length > 0 && (
        <div className="card p-4 border-cyan-500/20 bg-cyan-500/5">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📱</span>
            <div className="flex-1">
              <h4 className="text-sm font-bold text-white">¿Necesitas más líneas de WhatsApp?</h4>
              <p className="text-xs text-gray-400">
                {lines.length}/{maxLines} líneas usadas · Agrega una línea adicional con su propio asistente IA
              </p>
            </div>
            <a href="/subscription#addons" className="px-4 py-2 rounded-lg text-xs font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 transition-all whitespace-nowrap">
              +1 Línea — $39 USD
            </a>
          </div>
        </div>
      )}

      {/* Lines Grid */}
      {lines.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
            <Smartphone className="w-10 h-10 text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">No tienes líneas de WhatsApp</h2>
          <p className="text-gray-400 mb-6">Crea tu primera línea para conectar WhatsApp con Bizonne</p>
          <button onClick={() => { resetForm(); setLineForm({...lineForm, label: 'Principal'}); setShowModal(true); }} className="btn-primary mx-auto">
            <Plus className="w-4 h-4" /> Crear Primera Línea
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {lines.map((line) => {
            const isConnected = line.status === 'connected';
            const isConnecting = connectingLineId === line.id;
            const lineQR = qrData[line.id];
            const lineQRLoading = qrLoading[line.id];
            const lineAssistant = assistants.find(a => a.id === line.assistantId);

            return (
              <div key={line.id} className={`card border ${isConnected ? 'border-emerald-500/30' : 'border-[var(--border-primary)]'}`}>
                {/* Line Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isConnected ? 'bg-emerald-500/20' : 'bg-gray-500/20'}`}>
                      {line.connectionType === 'cloud_api' 
                        ? <Cloud className={`w-6 h-6 ${isConnected ? 'text-blue-400' : 'text-gray-500'}`} />
                        : isConnected ? <Wifi className="w-6 h-6 text-emerald-400" /> : <WifiOff className="w-6 h-6 text-gray-500" />
                      }
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-white">{line.label}</h3>
                        {line.isDefault && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold">PRINCIPAL</span>}
                        {line.connectionType === 'cloud_api' && <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full font-bold flex items-center gap-1"><Cloud className="w-3 h-3" />CLOUD API</span>}
                      </div>
                      {line.phone ? (
                        <p className="text-sm text-emerald-400 flex items-center gap-1">
                          <Phone className="w-3 h-3" /> +{line.phone}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-500">Sin número vinculado</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(line.status)}
                    <div className="flex gap-1">
                      <button onClick={() => openEditLine(line)} className="btn-icon"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => handleDeleteLine(line.id)} className="btn-icon text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>

                {/* Assigned Info */}
                <div className="flex gap-4 mb-4 text-sm">
                  <div className="flex items-center gap-1.5 text-gray-400">
                    <Bot className="w-4 h-4" />
                    <span>{lineAssistant?.name || 'Sin asistente'}</span>
                  </div>
                  {line.assignedName && (
                    <div className="flex items-center gap-1.5 text-gray-400">
                      <Users className="w-4 h-4" />
                      <span>{line.assignedName}</span>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                {isConnected ? (
                  <div className="flex gap-2">
                    <div className={`flex-1 flex items-center gap-2 p-3 rounded-xl ${line.connectionType === 'cloud_api' ? 'bg-blue-500/10 text-blue-400' : 'bg-emerald-500/10 text-emerald-400'} text-sm`}>
                      {line.connectionType === 'cloud_api' ? <Cloud className="w-4 h-4" /> : <Signal className="w-4 h-4" />}
                      {line.connectionType === 'cloud_api' ? 'Cloud API activa — API oficial Meta' : 'Línea activa y respondiendo'}
                    </div>
                    {line.connectionType !== 'cloud_api' && (
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          try {
                            const r = await fetch(`${API_URL}/api/whatsapp/lines/${line.id}/fix-webhook`, { method: 'POST', headers: headers() });
                            const d = await r.json();
                            alert(d.success ? `✅ Webhook registrado correctamente.
Sesión: ${d.sessionName}
Estado WAHA: ${d.wahaStatus}` : `❌ Error: ${JSON.stringify(d)}`);
                          } catch(e: any) { alert('Error: ' + e.message); }
                        }} className="btn-secondary text-sm">
                          🔔 Reparar webhook
                        </button>
                        <button onClick={async () => {
                          try {
                            const r = await fetch(`${API_URL}/api/whatsapp/waha-session-info/${line.id}`, { headers: headers() });
                            const d = await r.json();
                            const msg = [
                              `🔍 DIAGNÓSTICO COMPLETO`,
                              ``,
                              `Sesión WAHA: ${d.sessionName}`,
                              `Estado: ${d.wahaStatus}`,
                              `Teléfono: ${d.phone}`,
                              `Motor: ${d.engineInfo}`,
                              ``,
                              `── WEBHOOK ──`,
                              `URL configurada: ${d.webhookUrl}`,
                              `URL esperada: ${d.expectedUrl}`,
                              `¿Coinciden?: ${d.webhookOk ? '✅ SÍ' : '❌ NO → presiona Reparar webhook'}`,
                              `Eventos: ${(d.webhookEvents||[]).join(', ') || 'NINGUNO'}`,
                              `¿Tiene evento message?: ${d.webhookTieneMessageEvent ? '✅ SÍ' : '❌ NO → presiona Reparar webhook'}`,
                            ].join('\n');
                            alert(msg);
                          } catch(e: any) { alert('Error: ' + e.message); }
                        }} className="btn-secondary text-sm">
                          🔍 Diagnóstico
                        </button>
                        <button onClick={() => disconnectLine(line.id)} className="btn-danger text-sm">
                          <XCircle className="w-4 h-4" /> Desconectar
                        </button>
                      </div>
                    )}
                  </div>
                ) : line.connectionType === 'cloud_api' ? (
                  <div className="p-3 rounded-xl bg-red-500/10 text-red-400 text-sm flex items-center gap-2">
                    <XCircle className="w-4 h-4" />
                    Cloud API desconectada — verifica tu token en la configuración
                  </div>
                ) : (
                  <div>
                    {/* Diagnóstico WAHA */}
                    {diagResult && (
                      <div className={`mb-3 p-3 rounded-xl text-xs ${diagResult.wahaReachable ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
                        <p className="font-semibold">{diagResult.diagnosis}</p>
                        {!diagResult.wahaReachable && (
                          <div className="mt-1.5 text-[var(--text-muted)]">
                            <p>URL WAHA: <span className="font-mono text-red-300">{diagResult.wahaUrl}</span></p>
                            {diagResult.wahaError && <p>Error: {diagResult.wahaError}</p>}
                            <p className="mt-1">💡 Verifica que el servidor WAHA esté activo y accesible desde el backend de Railway.</p>
                          </div>
                        )}
                        {diagResult.wahaReachable && (
                          <p className="text-[var(--text-muted)] mt-1">Sesiones en WAHA: {diagResult.sessionsCount} · Latencia: {diagResult.latencyMs}ms</p>
                        )}
                      </div>
                    )}

                    {/* QR Section */}
                    {lineQR ? (
                      <div className="text-center">
                        <div className="inline-block p-4 bg-white rounded-xl mb-3">
                          <img 
                            src={lineQR.startsWith('data:') ? lineQR : `data:image/png;base64,${lineQR}`}
                            alt="QR Code" className="w-48 h-48" 
                          />
                        </div>
                        <p className="text-sm text-gray-400 mb-3">Escanea con WhatsApp → Dispositivos vinculados</p>
                        <div className="flex justify-center gap-2">
                          <button onClick={() => getQR(line.id)} disabled={lineQRLoading} className="btn-secondary text-sm">
                            <RefreshCw className={`w-4 h-4 ${lineQRLoading ? 'animate-spin' : ''}`} /> Actualizar QR
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <button 
                          onClick={() => connectLine(line.id)} 
                          disabled={isConnecting}
                          className="btn-primary w-full"
                        >
                          {isConnecting ? <div className="loading-spinner w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
                          {isConnecting ? 'Conectando...' : 'Conectar WhatsApp'}
                        </button>
                        {/* Botón diagnóstico — aparece si hay problemas */}
                        <button
                          onClick={runDiagnostic}
                          disabled={diagRunning}
                          className="w-full text-xs py-1.5 px-3 rounded-lg border border-[var(--border-primary)] text-[var(--text-muted)] hover:text-white hover:border-amber-500/50 transition-all flex items-center justify-center gap-1.5"
                        >
                          {diagRunning
                            ? <><RefreshCw className="w-3 h-3 animate-spin" /> Verificando WAHA...</>
                            : <><span>🔍</span> Verificar conexión con WAHA</>
                          }
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Features */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="card text-center">
          <div className="w-14 h-14 rounded-xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <img src="/bizonne.png" alt="Bizonne" className="w-8 h-8 rounded-lg" />
          </div>
          <h3 className="font-semibold text-white mb-2">IA Integrada</h3>
          <p className="text-sm text-[var(--text-muted)]">Tu asistente IA responde automáticamente a tus clientes 24/7</p>
        </div>
        <div className="card text-center">
          <div className="w-14 h-14 rounded-xl bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
            <Cloud className="w-7 h-7 text-blue-400" />
          </div>
          <h3 className="font-semibold text-white mb-2">Cloud API</h3>
          <p className="text-sm text-[var(--text-muted)]">Conecta la API oficial de Meta para mayor estabilidad</p>
        </div>
        <div className="card text-center">
          <div className="w-14 h-14 rounded-xl bg-purple-500/20 flex items-center justify-center mx-auto mb-4">
            <Phone className="w-7 h-7 text-purple-400" />
          </div>
          <h3 className="font-semibold text-white mb-2">Multi-Línea</h3>
          <p className="text-sm text-[var(--text-muted)]">
            {`Hasta ${maxLines} línea${maxLines !== 1 ? 's' : ''} en tu plan`}
          </p>
        </div>
        <div className="card text-center">
          <div className="w-14 h-14 rounded-xl bg-orange-500/20 flex items-center justify-center mx-auto mb-4">
            <Bot className="w-7 h-7 text-orange-400" />
          </div>
          <h3 className="font-semibold text-white mb-2">Asistente por Línea</h3>
          <p className="text-sm text-[var(--text-muted)]">Cada línea puede tener su propio asistente IA</p>
        </div>
      </div>

      {/* Modal: Create/Edit Line */}
      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); setCloudSetupInfo(null); }}>
          <div className="modal-content max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">
                {editingLine ? 'Editar' : 'Nueva'} Línea de WhatsApp
              </h3>
              <button onClick={() => { setShowModal(false); setCloudSetupInfo(null); }} className="btn-icon"><X className="w-5 h-5" /></button>
            </div>

            {/* Cloud Setup Info (shown after creating a Cloud API line) */}
            {cloudSetupInfo ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30">
                  <h4 className="text-blue-400 font-semibold mb-3 flex items-center gap-2"><Cloud className="w-5 h-5" /> ¡Línea Cloud API creada!</h4>
                  <p className="text-sm text-gray-300 mb-4">{cloudSetupInfo.instructions}</p>
                  
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Webhook URL</label>
                      <div className="flex gap-2">
                        <input type="text" readOnly value={cloudSetupInfo.webhookUrl} className="input flex-1 text-sm font-mono" />
                        <button onClick={() => { navigator.clipboard.writeText(cloudSetupInfo.webhookUrl); }} className="btn-secondary text-sm"><Copy className="w-4 h-4" /></button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Verify Token</label>
                      <div className="flex gap-2">
                        <input type="text" readOnly value={cloudSetupInfo.webhookVerifyToken} className="input flex-1 text-sm font-mono" />
                        <button onClick={() => { navigator.clipboard.writeText(cloudSetupInfo.webhookVerifyToken); }} className="btn-secondary text-sm"><Copy className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-4 p-3 rounded-lg bg-gray-800/50 text-xs text-gray-400 space-y-1">
                    <p>📌 <strong className="text-gray-300">Suscríbete a estos eventos:</strong> messages</p>
                    <p>📌 Asegúrate de que tu app de Meta esté en modo <strong className="text-gray-300">Live</strong></p>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener" className="btn-secondary flex-1 text-sm justify-center">
                    <ExternalLink className="w-4 h-4" /> Ir a Meta Developers
                  </a>
                  <button onClick={() => { setShowModal(false); resetForm(); }} className="btn-primary flex-1 text-sm">
                    ✅ Listo, ya configuré
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Connection Type Selector */}
                {!editingLine && (
                  <div>
                    <label className="input-label">Tipo de conexión</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setLineForm({...lineForm, connectionType: 'waha'})}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${lineForm.connectionType === 'waha' ? 'border-emerald-500 bg-emerald-500/10' : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <QrCode className={`w-5 h-5 ${lineForm.connectionType === 'waha' ? 'text-emerald-400' : 'text-gray-500'}`} />
                          <span className={`font-semibold ${lineForm.connectionType === 'waha' ? 'text-white' : 'text-gray-400'}`}>QR Code</span>
                        </div>
                        <p className="text-xs text-gray-500">Escanea con tu celular. Gratis, usa tu número personal.</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setLineForm({...lineForm, connectionType: 'cloud_api'})}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${lineForm.connectionType === 'cloud_api' ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Cloud className={`w-5 h-5 ${lineForm.connectionType === 'cloud_api' ? 'text-blue-400' : 'text-gray-500'}`} />
                          <span className={`font-semibold ${lineForm.connectionType === 'cloud_api' ? 'text-white' : 'text-gray-400'}`}>Cloud API</span>
                        </div>
                        <p className="text-xs text-gray-500">API oficial de Meta. Números verificados, sin riesgo de ban.</p>
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="input-label">Nombre de la línea *</label>
                  <input 
                    type="text" value={lineForm.label}
                    onChange={e => setLineForm({...lineForm, label: e.target.value})}
                    className="input" placeholder="Ej: Ventas, Soporte, Personal"
                  />
                </div>

                {/* Cloud API Fields */}
                {lineForm.connectionType === 'cloud_api' && (
                  <div className="space-y-3 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
                    <h4 className="text-sm font-semibold text-blue-400 flex items-center gap-2"><Cloud className="w-4 h-4" /> Configuración Cloud API</h4>
                    <div>
                      <label className="input-label">Phone Number ID *</label>
                      <input type="text" value={lineForm.cloudPhoneNumberId}
                        onChange={e => setLineForm({...lineForm, cloudPhoneNumberId: e.target.value})}
                        className="input font-mono text-sm" placeholder="Ej: 123456789012345"
                      />
                    </div>
                    <div>
                      <label className="input-label">Access Token permanente *</label>
                      <input type="password" value={lineForm.cloudAccessToken}
                        onChange={e => setLineForm({...lineForm, cloudAccessToken: e.target.value})}
                        className="input font-mono text-sm" placeholder="Ej: EAAxxxxxxxx..."
                      />
                    </div>
                    <div>
                      <label className="input-label">WhatsApp Business Account ID (WABA ID) <span className="text-gray-600">(opcional — se auto-detecta)</span></label>
                      <div className="flex gap-2">
                        <input type="text" value={lineForm.cloudBusinessId}
                          onChange={e => setLineForm({...lineForm, cloudBusinessId: e.target.value})}
                          className="input font-mono text-sm flex-1" placeholder="Auto-detectado al guardar"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (!editingLine) { alert('Guarda la línea primero para poder diagnosticar'); return; }
                            const token = localStorage.getItem('token');
                            const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
                            try {
                              const r = await fetch(`${API_URL}/api/whatsapp/diagnose-cloud?lineId=${editingLine.id}`, {
                                headers: { 'Authorization': `Bearer ${token}` }
                              });
                              const d = await r.json();
                              const wabaFound = d.waba_id_autofix || d.waba_id_saved;
                              const tmpl = d.templates_test;
                              const templatesOk = tmpl && !tmpl.error && tmpl.count > 0;
                              let msg = `📋 Diagnóstico Cloud API\n\n`;
                              msg += `Phone Number ID: ${d.phone_number_id_saved}\n`;
                              msg += `WABA ID guardado: ${d.waba_id_saved || 'ninguno'}\n`;
                              if (d.waba_id_autofix) msg += `✅ WABA ID auto-detectado: ${d.waba_id_autofix}\n`;
                              // Solo mostrar error de lookup si las plantillas NO funcionan (es informativo, no crítico)
                              if (d.phone_number_lookup?.error && !templatesOk) {
                                msg += `⚠️ Error lookup: ${d.phone_number_lookup.error}\n`;
                              } else if (d.phone_number_lookup?.error && templatesOk) {
                                msg += `ℹ️ Nota: El campo whatsapp_business_account no está disponible con este token, pero las plantillas funcionan correctamente usando el WABA ID guardado.\n`;
                              }
                              if (tmpl) {
                                msg += `\nPlantillas:\n`;
                                if (tmpl.error) msg += `❌ Error: ${tmpl.error}\n`;
                                else msg += `✅ ${tmpl.count} plantillas encontradas\n`;
                                if (tmpl.first_template) msg += `Primera: ${tmpl.first_template}\n`;
                              }
                              if (d.autofix_applied) {
                                msg += `\n✅ WABA ID actualizado automáticamente`;
                                setLineForm(f => ({ ...f, cloudBusinessId: d.waba_id_autofix }));
                              }
                              if (templatesOk) {
                                msg += `\n\n✅ Todo listo — tu Cloud API está funcionando correctamente.`;
                              }
                              alert(msg);
                            } catch(e: any) { alert('Error: ' + e.message); }
                          }}
                          className="px-3 py-2 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 text-xs hover:bg-violet-600/30 transition-all whitespace-nowrap"
                        >
                          🔍 Diagnosticar
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-500 mt-1">Se detecta automáticamente desde el Phone Number ID. Usa "Diagnosticar" si las plantillas no cargan.</p>
                    </div>
                    <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener"
                      className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> ¿Cómo obtener estos datos?
                    </a>
                  </div>
                )}

                <div>
                  <label className="input-label">Asistente IA asignado</label>
                  <select 
                    value={lineForm.assistantId}
                    onChange={e => setLineForm({...lineForm, assistantId: e.target.value})}
                    className="input"
                  >
                    <option value="">— Usar asistente activo por defecto —</option>
                    {assistants.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Cada línea puede responder con un asistente diferente</p>
                </div>

                {teamMembers.length > 0 && (
                  <div>
                    <label className="input-label">Asignada a miembro del equipo</label>
                    <select
                      value={lineForm.assignedTo}
                      onChange={e => setLineForm({...lineForm, assignedTo: e.target.value})}
                      className="input"
                    >
                      <option value="">— Sin asignar (admin) —</option>
                      {teamMembers.map((m: any) => (
                        <option key={m.id} value={m.id}>{m.name || m.email} ({m.role})</option>
                      ))}
                    </select>
                  </div>
                )}

                <button 
                  onClick={handleSaveLine}
                  disabled={!lineForm.label.trim() || savingLine || (lineForm.connectionType === 'cloud_api' && (!lineForm.cloudPhoneNumberId || !lineForm.cloudAccessToken))}
                  className="btn-primary w-full"
                >
                  {savingLine ? <div className="loading-spinner w-4 h-4" /> : lineForm.connectionType === 'cloud_api' ? <Cloud className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
                  {savingLine ? 'Verificando...' : editingLine ? 'Actualizar' : lineForm.connectionType === 'cloud_api' ? 'Conectar Cloud API' : 'Crear Línea'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-center py-4">
        <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
          <img src="/bizonne.png" alt="Bizonne" className="w-5 h-5 rounded" />
          WhatsApp powered by Bizonne
        </div>
      </div>
    </div>
  );
}

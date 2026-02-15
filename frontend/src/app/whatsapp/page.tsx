'use client';

import { useState, useEffect } from 'react';
import { 
  Smartphone, CheckCircle, XCircle, RefreshCw, Wifi, WifiOff, QrCode,
  Plus, Trash2, Edit2, X, Crown, Lock, Users, Bot, Phone, Signal
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

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingLine, setEditingLine] = useState<any>(null);
  const [lineForm, setLineForm] = useState({ label: '', assignedTo: '', assistantId: '' });

  // Plan limits (including purchased addons)
  const plan = user?.plan || 'trial';
  const features = user?.planFeatures || {};
  const maxLines = user?.effectiveLimits?.maxLines || { trial: 1, starter: 2, business: 5 }[plan] || 1;
  const isBusiness = plan === 'business';
  const canAddMore = lines.length < maxLines;
  const extraLinesPurchased = user?.effectiveLimits?.extraLinesPurchased || 0;

  useEffect(() => {
    loadAll();
    const interval = setInterval(refreshLines, 8000);
    return () => clearInterval(interval);
  }, []);

  const getToken = () => localStorage.getItem('token') || '';
  const headers = () => ({ 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' });

  const loadAll = async () => {
    try {
      const [userRes, linesRes, assistRes, teamRes] = await Promise.all([
        fetch(`${API_URL}/api/auth/me`, { headers: headers() }),
        fetch(`${API_URL}/api/whatsapp/lines`, { headers: headers() }),
        fetch(`${API_URL}/api/assistants`, { headers: headers() }),
        fetch(`${API_URL}/api/team`, { headers: headers() }).catch(() => null),
      ]);

      if (userRes.ok) setUser((await userRes.json()).user);
      if (linesRes.ok) {
        const data = await linesRes.json();
        setLines(data.lines || []);
      }
      if (assistRes.ok) {
        const data = await assistRes.json();
        // Handle both single and array
        if (data.assistant) setAssistants([data.assistant]);
        else if (data.assistants) setAssistants(data.assistants);
      }
      if (teamRes?.ok) {
        const data = await teamRes.json();
        setTeamMembers(data.members || []);
      }
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
    try {
      const url = editingLine 
        ? `${API_URL}/api/whatsapp/lines/${editingLine.id}`
        : `${API_URL}/api/whatsapp/lines`;
      const method = editingLine ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method, headers: headers(),
        body: JSON.stringify(lineForm)
      });

      if (res.ok) {
        await loadAll();
        setShowModal(false);
        resetForm();
      } else {
        const err = await res.json();
        alert(err.error || 'Error al guardar');
      }
    } catch (e) { console.error(e); }
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!confirm('¿Eliminar esta línea? Se desconectará y se perderá la configuración.')) return;
    try {
      await fetch(`${API_URL}/api/whatsapp/lines/${lineId}`, { method: 'DELETE', headers: headers() });
      await loadAll();
    } catch (e) { console.error(e); }
  };

  const resetForm = () => {
    setLineForm({ label: '', assignedTo: '', assistantId: '' });
    setEditingLine(null);
  };

  const openEditLine = (line: any) => {
    setEditingLine(line);
    setLineForm({
      label: line.label || '',
      assignedTo: line.assignedTo || '',
      assistantId: line.assistantId || ''
    });
    setShowModal(true);
  };

  // ===== Connect / Disconnect / QR =====
  const connectLine = async (lineId: string) => {
    setConnectingLineId(lineId);
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/lines/${lineId}/connect`, {
        method: 'POST', headers: headers()
      });
      if (res.ok) {
        // Wait for QR
        setTimeout(() => getQR(lineId), 3000);
        const qrInterval = setInterval(async () => {
          const got = await getQR(lineId);
          if (got) clearInterval(qrInterval);
        }, 2500);
        setTimeout(() => clearInterval(qrInterval), 30000);
      }
    } catch (e) { console.error(e); }
    finally { setConnectingLineId(null); }
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
            <h1 className="text-3xl font-bold text-white">WhatsApp</h1>
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
              <a href="/subscription" className="btn-primary text-sm">
                📱 Comprar línea extra — $10 USD
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
                      {isConnected ? <Wifi className="w-6 h-6 text-emerald-400" /> : <WifiOff className="w-6 h-6 text-gray-500" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-white">{line.label}</h3>
                        {line.isDefault && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold">PRINCIPAL</span>}
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
                    <div className="flex-1 flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 text-emerald-400 text-sm">
                      <Signal className="w-4 h-4" />
                      Línea activa y respondiendo
                    </div>
                    <button onClick={() => disconnectLine(line.id)} className="btn-danger text-sm">
                      <XCircle className="w-4 h-4" /> Desconectar
                    </button>
                  </div>
                ) : (
                  <div>
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
                      <button 
                        onClick={() => connectLine(line.id)} 
                        disabled={isConnecting}
                        className="btn-primary w-full"
                      >
                        {isConnecting ? <div className="loading-spinner w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
                        {isConnecting ? 'Conectando...' : 'Conectar WhatsApp'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card text-center">
          <div className="w-14 h-14 rounded-xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <img src="/bizonne.png" alt="Bizonne" className="w-8 h-8 rounded-lg" />
          </div>
          <h3 className="font-semibold text-white mb-2">IA Integrada</h3>
          <p className="text-sm text-[var(--text-muted)]">Elisa responde automáticamente a tus clientes 24/7</p>
        </div>
        <div className="card text-center">
          <div className="w-14 h-14 rounded-xl bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
            <Phone className="w-7 h-7 text-blue-400" />
          </div>
          <h3 className="font-semibold text-white mb-2">Multi-Línea</h3>
          <p className="text-sm text-[var(--text-muted)]">
            {`Hasta ${maxLines} línea${maxLines !== 1 ? 's' : ''} en tu plan`}
          </p>
        </div>
        <div className="card text-center">
          <div className="w-14 h-14 rounded-xl bg-purple-500/20 flex items-center justify-center mx-auto mb-4">
            <Bot className="w-7 h-7 text-purple-400" />
          </div>
          <h3 className="font-semibold text-white mb-2">Asistente por Línea</h3>
          <p className="text-sm text-[var(--text-muted)]">Cada línea puede tener su propio asistente IA</p>
        </div>
      </div>

      {/* Modal: Create/Edit Line */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">
                {editingLine ? 'Editar' : 'Nueva'} Línea de WhatsApp
              </h3>
              <button onClick={() => setShowModal(false)} className="btn-icon"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="input-label">Nombre de la línea *</label>
                <input 
                  type="text" value={lineForm.label}
                  onChange={e => setLineForm({...lineForm, label: e.target.value})}
                  className="input" placeholder="Ej: Ventas, Soporte, Personal"
                />
              </div>

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
                disabled={!lineForm.label.trim()}
                className="btn-primary w-full"
              >
                {editingLine ? 'Actualizar' : 'Crear'} Línea
              </button>
            </div>
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

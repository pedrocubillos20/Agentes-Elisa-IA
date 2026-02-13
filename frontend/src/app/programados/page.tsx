'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Clock, Plus, Trash2, Edit2, X, Send, Users, User, 
  LayoutGrid, Calendar, Repeat, ChevronDown, Image, Mic, Paperclip,
  CheckCircle, AlertCircle, Loader, FileText, MessageSquare
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const RECURRENCE_OPTIONS = [
  { id: 'once', label: 'Una vez', icon: '📅' },
  { id: 'daily', label: 'Diario', icon: '🔄' },
  { id: 'weekly', label: 'Semanal', icon: '📆' },
  { id: 'monthly', label: 'Mensual', icon: '🗓️' },
];

const DAYS_OF_WEEK = [
  { id: 0, short: 'Dom', label: 'Domingo' },
  { id: 1, short: 'Lun', label: 'Lunes' },
  { id: 2, short: 'Mar', label: 'Martes' },
  { id: 3, short: 'Mié', label: 'Miércoles' },
  { id: 4, short: 'Jue', label: 'Jueves' },
  { id: 5, short: 'Vie', label: 'Viernes' },
  { id: 6, short: 'Sáb', label: 'Sábado' },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string; icon: any }> = {
  pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Pendiente', icon: Clock },
  sent: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Enviado', icon: CheckCircle },
  failed: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Fallido', icon: AlertCircle },
  cancelled: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Cancelado', icon: X },
};

const TARGET_TYPES = [
  { id: 'contact', label: 'Contacto', icon: User, desc: 'Enviar a un número' },
  { id: 'group', label: 'Grupo', icon: Users, desc: 'Enviar a un grupo de WhatsApp' },
  { id: 'stage', label: 'Etapa del embudo', icon: LayoutGrid, desc: 'Enviar a todos en una etapa' },
];

export default function ProgramadosPage() {
  const [scheduled, setScheduled] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [filter, setFilter] = useState<string>('all');

  // Form state
  const [targetType, setTargetType] = useState('contact');
  const [targetId, setTargetId] = useState('');
  const [targetName, setTargetName] = useState('');
  const [message, setMessage] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [recurrence, setRecurrence] = useState('once');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceEnd, setRecurrenceEnd] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dropdowns
  const [conversations, setConversations] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const getLineId = () => localStorage.getItem('selectedLineId') || '';

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    const token = localStorage.getItem('token');
    const lineId = getLineId();
    try {
      const [schedRes, convRes, groupRes, stageRes] = await Promise.all([
        fetch(`${API_URL}/api/scheduled?lineId=${lineId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/conversations?lineId=${lineId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/conversations/groups?lineId=${lineId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/stages?lineId=${lineId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
      ]);
      if (schedRes.ok) setScheduled((await schedRes.json()).scheduled || []);
      if (convRes.ok) setConversations((await convRes.json()).conversations || []);
      if (groupRes.ok) setGroups((await groupRes.json()).groups || []);
      if (stageRes.ok) { const d = await stageRes.json(); if (d.stages?.length) setStages(d.stages); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const resetForm = () => {
    setTargetType('contact');
    setTargetId('');
    setTargetName('');
    setMessage('');
    setScheduledDate('');
    setScheduledTime('');
    setRecurrence('once');
    setRecurrenceDays([]);
    setRecurrenceEnd('');
    setMediaFile(null);
    setMediaPreview(null);
    setEditing(null);
  };

  const openCreate = () => {
    resetForm();
    // Default: mañana a las 9am
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setScheduledDate(tomorrow.toISOString().split('T')[0]);
    setScheduledTime('09:00');
    setShowModal(true);
  };

  const openEdit = (item: any) => {
    setEditing(item);
    setTargetType(item.targetType || 'contact');
    setTargetId(item.targetId || '');
    setTargetName(item.targetName || '');
    setMessage(item.message || '');
    const dt = new Date(item.scheduledAt);
    setScheduledDate(dt.toISOString().split('T')[0]);
    setScheduledTime(dt.toTimeString().slice(0, 5));
    setRecurrence(item.recurrence || 'once');
    setRecurrenceDays(item.recurrenceDays || []);
    setRecurrenceEnd(item.recurrenceEnd ? new Date(item.recurrenceEnd).toISOString().split('T')[0] : '');
    setMediaFile(null);
    setMediaPreview(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!targetId || !scheduledDate || !scheduledTime || (!message && !mediaFile)) return;
    setSaving(true);
    const token = localStorage.getItem('token');

    let mediaUrl: string | null = null;
    let mediaType: string | null = null;
    if (mediaFile) {
      mediaUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(mediaFile);
      });
      if (mediaFile.type.startsWith('image/')) mediaType = 'image';
      else if (mediaFile.type.startsWith('audio/')) mediaType = 'audio';
      else if (mediaFile.type.startsWith('video/')) mediaType = 'video';
      else mediaType = 'document';
    }

    const scheduledAt = new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString();

    const body = {
      whatsappLineId: getLineId() || undefined,
      targetType,
      targetId,
      targetName: targetName || undefined,
      message: message || undefined,
      ...(mediaUrl && { mediaUrl, mediaType }),
      scheduledAt,
      recurrence,
      recurrenceDays: recurrence === 'weekly' ? recurrenceDays : undefined,
      recurrenceTime: scheduledTime,
      recurrenceEnd: recurrenceEnd ? new Date(`${recurrenceEnd}T23:59:59`).toISOString() : undefined,
    };

    try {
      const url = editing 
        ? `${API_URL}/api/scheduled/${editing.id}` 
        : `${API_URL}/api/scheduled`;
      
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        setShowModal(false);
        resetForm();
        fetchAll();
      } else {
        const err = await res.json();
        alert(`Error: ${err.error || 'Error al guardar'}`);
      }
    } catch (e) { alert('Error de conexión'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este mensaje programado?')) return;
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/scheduled/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fetchAll();
    } catch {}
  };

  const handleCancel = async (id: string) => {
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/scheduled/${id}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' })
      });
      fetchAll();
    } catch {}
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMediaFile(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setMediaPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setMediaPreview(null);
    }
  };

  const toggleDay = (dayId: number) => {
    setRecurrenceDays(prev => 
      prev.includes(dayId) ? prev.filter(d => d !== dayId) : [...prev, dayId]
    );
  };

  const getTargetIcon = (type: string) => {
    const t = TARGET_TYPES.find(tt => tt.id === type);
    return t ? t.icon : User;
  };

  const filteredScheduled = scheduled.filter(s => 
    filter === 'all' || s.status === filter
  );

  const stats = {
    pending: scheduled.filter(s => s.status === 'pending').length,
    sent: scheduled.filter(s => s.status === 'sent').length,
    failed: scheduled.filter(s => s.status === 'failed').length,
  };

  if (loading) {
    return (
      <div className="h-[calc(100vh-120px)] flex items-center justify-center">
        <div className="loading-spinner w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Clock className="w-7 h-7 text-[var(--accent-primary)]" />
          <div>
            <h1 className="text-2xl font-bold text-white">Mensajes Programados</h1>
            <p className="text-sm text-[var(--text-muted)]">Programa envíos automáticos a contactos, grupos o etapas</p>
          </div>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2 px-4 py-2">
          <Plus className="w-4 h-4" /> Programar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3 flex items-center gap-3 cursor-pointer hover:border-yellow-500/50 transition-all" onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')}>
          <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
            <Clock className="w-5 h-5 text-yellow-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{stats.pending}</p>
            <p className="text-xs text-[var(--text-muted)]">Pendientes</p>
          </div>
        </div>
        <div className="card p-3 flex items-center gap-3 cursor-pointer hover:border-emerald-500/50 transition-all" onClick={() => setFilter(filter === 'sent' ? 'all' : 'sent')}>
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <CheckCircle className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{stats.sent}</p>
            <p className="text-xs text-[var(--text-muted)]">Enviados</p>
          </div>
        </div>
        <div className="card p-3 flex items-center gap-3 cursor-pointer hover:border-red-500/50 transition-all" onClick={() => setFilter(filter === 'failed' ? 'all' : 'failed')}>
          <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
            <AlertCircle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{stats.failed}</p>
            <p className="text-xs text-[var(--text-muted)]">Fallidos</p>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {[
          { id: 'all', label: 'Todos' },
          { id: 'pending', label: 'Pendientes' },
          { id: 'sent', label: 'Enviados' },
          { id: 'failed', label: 'Fallidos' },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} className={`px-3 py-1.5 rounded-lg text-xs transition-all ${filter === f.id ? 'bg-[var(--accent-primary)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-white'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-3">
        {filteredScheduled.map(item => {
          const status = STATUS_STYLES[item.status] || STATUS_STYLES.pending;
          const StatusIcon = status.icon;
          const TargetIcon = getTargetIcon(item.targetType);
          const dt = new Date(item.scheduledAt);
          const isRecurring = item.recurrence !== 'once';
          
          return (
            <div key={item.id} className="card p-4 hover:border-[var(--accent-primary)]/30 transition-all">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-lg ${status.bg} flex items-center justify-center flex-shrink-0`}>
                    <StatusIcon className={`w-5 h-5 ${status.text}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Target info */}
                    <div className="flex items-center gap-2 mb-1">
                      <TargetIcon className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                      <span className="text-sm font-medium text-white truncate">
                        {item.targetName || item.targetId}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] ${status.bg} ${status.text}`}>
                        {status.label}
                      </span>
                      {isRecurring && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-500/20 text-blue-400 flex items-center gap-0.5">
                          <Repeat className="w-2.5 h-2.5" />
                          {RECURRENCE_OPTIONS.find(r => r.id === item.recurrence)?.label}
                        </span>
                      )}
                    </div>

                    {/* Message preview */}
                    <p className="text-xs text-[var(--text-muted)] truncate mb-1.5">
                      {item.mediaUrl && '📎 '}{item.message || '[Solo media]'}
                    </p>

                    {/* Date/time */}
                    <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {dt.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {dt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {item.sendCount > 0 && (
                        <span>Enviado {item.sendCount}x</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {item.status === 'pending' && (
                    <>
                      <button onClick={() => openEdit(item)} className="p-1.5 hover:bg-white/10 rounded-lg" title="Editar">
                        <Edit2 className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                      </button>
                      <button onClick={() => handleCancel(item.id)} className="p-1.5 hover:bg-yellow-500/10 rounded-lg" title="Cancelar">
                        <X className="w-3.5 h-3.5 text-yellow-400" />
                      </button>
                    </>
                  )}
                  <button onClick={() => handleDelete(item.id)} className="p-1.5 hover:bg-red-500/10 rounded-lg" title="Eliminar">
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {filteredScheduled.length === 0 && (
          <div className="card p-12 text-center">
            <Clock className="w-12 h-12 mx-auto mb-3 text-[var(--text-muted)] opacity-30" />
            <p className="text-[var(--text-muted)]">
              {filter === 'all' ? 'No hay mensajes programados' : `No hay mensajes ${filter === 'pending' ? 'pendientes' : filter === 'sent' ? 'enviados' : 'fallidos'}`}
            </p>
            <button onClick={openCreate} className="btn-primary mt-4 inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> Programar primer mensaje
            </button>
          </div>
        )}
      </div>

      {/* ====================================================
          📅 MODAL: Crear/Editar Mensaje Programado
          ==================================================== */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => !saving && setShowModal(false)}>
          <div className="bg-[var(--bg-secondary)] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
              <h3 className="font-bold text-white text-lg">
                {editing ? 'Editar Programado' : 'Nuevo Mensaje Programado'}
              </h3>
              <button onClick={() => !saving && setShowModal(false)} className="p-1 hover:bg-white/10 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Tipo de destinatario */}
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-2 block">Enviar a</label>
                <div className="grid grid-cols-3 gap-2">
                  {TARGET_TYPES.map(t => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        onClick={() => { setTargetType(t.id); setTargetId(''); setTargetName(''); }}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          targetType === t.id 
                            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10' 
                            : 'border-[var(--border-primary)] hover:border-white/20'
                        }`}
                      >
                        <Icon className={`w-5 h-5 mx-auto mb-1 ${targetType === t.id ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'}`} />
                        <p className="text-xs text-white">{t.label}</p>
                        <p className="text-[9px] text-[var(--text-muted)]">{t.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selector de destinatario */}
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1.5 block">
                  {targetType === 'contact' ? 'Contacto' : targetType === 'group' ? 'Grupo' : 'Etapa'}
                </label>
                
                {targetType === 'contact' && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={targetId}
                      onChange={(e) => setTargetId(e.target.value)}
                      placeholder="Número: 573001234567"
                      className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
                    />
                    {conversations.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          const conv = conversations.find(c => c.recipientId === e.target.value);
                          if (conv) { setTargetId(conv.recipientId); setTargetName(conv.recipientName || conv.recipientId); }
                        }}
                        className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)]"
                      >
                        <option value="">O selecciona un contacto existente...</option>
                        {conversations.filter(c => !c.isGroup).map(c => (
                          <option key={c.id} value={c.recipientId}>
                            {c.recipientName || c.recipientId}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {targetType === 'group' && (
                  <select
                    value={targetId}
                    onChange={(e) => {
                      const g = groups.find(gr => gr.recipientId === e.target.value);
                      setTargetId(e.target.value);
                      if (g) setTargetName(g.groupName || g.recipientName || e.target.value);
                    }}
                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)]"
                  >
                    <option value="">Selecciona un grupo...</option>
                    {groups.map(g => (
                      <option key={g.id} value={g.recipientId}>
                        {g.groupName || g.recipientName || g.recipientId}
                      </option>
                    ))}
                  </select>
                )}

                {targetType === 'stage' && (
                  <select
                    value={targetId}
                    onChange={(e) => {
                      setTargetId(e.target.value);
                      const s = stages.find(st => st.id === e.target.value);
                      setTargetName(s?.label || e.target.value);
                    }}
                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)]"
                  >
                    <option value="">Selecciona una etapa...</option>
                    {stages.map(s => {
                      const count = conversations.filter(c => c.stage === s.id).length;
                      return (
                        <option key={s.id} value={s.id}>
                          {s.label} ({count} contactos)
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>

              {/* Mensaje */}
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1.5 block">Mensaje</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Escribe tu mensaje..."
                  className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg p-3 text-sm text-white placeholder-[var(--text-muted)] min-h-[80px] resize-none focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>

              {/* Media */}
              <div>
                <input ref={fileInputRef} type="file" accept="image/*,audio/*,video/*,application/pdf,.doc,.docx" onChange={handleFileSelect} className="hidden" />
                {mediaFile ? (
                  <div className="flex items-center gap-2 p-2 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-primary)]">
                    {mediaPreview ? <img src={mediaPreview} alt="" className="w-10 h-10 rounded object-cover" /> : (
                      <div className="w-10 h-10 rounded bg-[var(--accent-primary)]/20 flex items-center justify-center">
                        <FileText className="w-4 h-4 text-[var(--accent-primary)]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white truncate">{mediaFile.name}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">{(mediaFile.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <button onClick={() => { setMediaFile(null); setMediaPreview(null); }} className="p-1 hover:bg-white/10 rounded">
                      <X className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => { if (fileInputRef.current) { fileInputRef.current.accept = 'image/*'; fileInputRef.current.click(); } }} className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg text-xs text-[var(--text-muted)] hover:text-white transition-all border border-[var(--border-primary)]">
                      <Image className="w-3.5 h-3.5" /> Imagen
                    </button>
                    <button onClick={() => { if (fileInputRef.current) { fileInputRef.current.accept = 'audio/*'; fileInputRef.current.click(); } }} className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg text-xs text-[var(--text-muted)] hover:text-white transition-all border border-[var(--border-primary)]">
                      <Mic className="w-3.5 h-3.5" /> Audio
                    </button>
                    <button onClick={() => { if (fileInputRef.current) { fileInputRef.current.accept = '*/*'; fileInputRef.current.click(); } }} className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg text-xs text-[var(--text-muted)] hover:text-white transition-all border border-[var(--border-primary)]">
                      <Paperclip className="w-3.5 h-3.5" /> Archivo
                    </button>
                  </div>
                )}
              </div>

              {/* Fecha y hora */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-1.5 block">Fecha</label>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-1.5 block">Hora</label>
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)]"
                  />
                </div>
              </div>

              {/* Recurrencia */}
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-2 block">Repetir</label>
                <div className="grid grid-cols-4 gap-2">
                  {RECURRENCE_OPTIONS.map(r => (
                    <button
                      key={r.id}
                      onClick={() => setRecurrence(r.id)}
                      className={`p-2 rounded-lg border text-center transition-all ${
                        recurrence === r.id 
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10' 
                          : 'border-[var(--border-primary)] hover:border-white/20'
                      }`}
                    >
                      <span className="text-lg">{r.icon}</span>
                      <p className="text-[10px] text-white mt-0.5">{r.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Días de la semana (para semanal) */}
              {recurrence === 'weekly' && (
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-2 block">Días</label>
                  <div className="flex gap-1.5">
                    {DAYS_OF_WEEK.map(d => (
                      <button
                        key={d.id}
                        onClick={() => toggleDay(d.id)}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                          recurrenceDays.includes(d.id)
                            ? 'bg-[var(--accent-primary)] text-white'
                            : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-white border border-[var(--border-primary)]'
                        }`}
                      >
                        {d.short}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Fecha de fin de recurrencia */}
              {recurrence !== 'once' && (
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-1.5 block">Repetir hasta (opcional)</label>
                  <input
                    type="date"
                    value={recurrenceEnd}
                    onChange={(e) => setRecurrenceEnd(e.target.value)}
                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)]"
                  />
                  {!recurrenceEnd && <p className="text-[10px] text-yellow-400 mt-1">Sin fecha fin = se repite indefinidamente</p>}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-[var(--border-primary)] flex gap-2">
              <button onClick={() => !saving && setShowModal(false)} className="btn-secondary flex-1 py-2" disabled={saving}>
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !targetId || !scheduledDate || !scheduledTime || (!message && !mediaFile)}
                className="btn-primary flex-1 py-2 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {editing ? 'Guardar cambios' : 'Programar envío'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

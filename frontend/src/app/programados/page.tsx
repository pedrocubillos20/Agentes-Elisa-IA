'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  Clock, Plus, Trash2, Edit2, X, Send, Users, User,
  LayoutGrid, Calendar, Repeat, ChevronDown, Image, Mic, Paperclip,
  CheckCircle, AlertCircle, Loader, FileText, MessageSquare,
  Upload, Download, Sheet, Eye, EyeOff, BarChart3, ChevronUp,
  ArrowUpFromLine, Info, RefreshCw,
} from 'lucide-react';
import ModalProgramado from './ModalProgramado';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const RECURRENCE_OPTIONS = [
  { id: 'once',    label: 'Una vez',  icon: '📅' },
  { id: 'daily',   label: 'Diario',   icon: '🔄' },
  { id: 'weekly',  label: 'Semanal',  icon: '📆' },
  { id: 'monthly', label: 'Mensual',  icon: '🗓️' },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string; icon: any }> = {
  pending:   { bg: 'bg-yellow-500/20',  text: 'text-yellow-400',  label: 'Pendiente', icon: Clock },
  sent:      { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Enviado',   icon: CheckCircle },
  failed:    { bg: 'bg-red-500/20',     text: 'text-red-400',     label: 'Fallido',   icon: AlertCircle },
  cancelled: { bg: 'bg-gray-500/20',    text: 'text-gray-400',    label: 'Cancelado', icon: X },
};

const PHONE_COLS = ['telefono','phone','celular','movil','whatsapp','numero','tel','mobile','number'];
const NAME_COLS  = ['nombre','name','cliente','contacto','apellido','fullname','full_name','nombres'];

const isValidPhone = (p: string): boolean => {
  const c = String(p || '').replace(/\D/g, '');
  return c.length >= 7 && c.length <= 15;
};

const normalizePhone = (p: string): string => String(p || '').replace(/\D/g, '');

const parseRow = (row: any): { phone: string; name: string; valid: boolean; raw: string } => {
  const keys = Object.keys(row).map((k) => k.toLowerCase().trim());
  let phone = '';
  let name = '';

  for (const col of PHONE_COLS) {
    const key = keys.find((k) => k.includes(col) || col.includes(k));
    if (key) { phone = String(row[Object.keys(row)[keys.indexOf(key)]] || '').trim(); break; }
  }
  for (const col of NAME_COLS) {
    const key = keys.find((k) => k.includes(col) || col.includes(k));
    if (key) { name = String(row[Object.keys(row)[keys.indexOf(key)]] || '').trim(); break; }
  }

  if (!phone) {
    for (const val of Object.values(row)) {
      const s = String(val || '').replace(/\D/g, '');
      if (s.length >= 7 && s.length <= 15) { phone = String(val); break; }
    }
  }

  const normalized = normalizePhone(phone);
  return { phone: normalized, name, valid: isValidPhone(normalized), raw: phone };
};

export default function ProgramadosPage() {
  const [scheduled, setScheduled]   = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [editing, setEditing]       = useState<any>(null);
  const [filter, setFilter]         = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [targetType, setTargetType]       = useState('contact');
  const [targetId, setTargetId]           = useState('');
  const [targetName, setTargetName]       = useState('');
  const [message, setMessage]             = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [recurrence, setRecurrence]       = useState('once');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceEnd, setRecurrenceEnd]   = useState('');
  const [mediaFile, setMediaFile]         = useState<File | null>(null);
  const [mediaPreview, setMediaPreview]   = useState<string | null>(null);

  // Excel bulk
  const [excelContacts, setExcelContacts]       = useState<any[]>([]);
  const [excelFileName, setExcelFileName]       = useState('');
  const [excelParsing, setExcelParsing]         = useState(false);
  const [showExcelPreview, setShowExcelPreview] = useState(true);
  const [isDragging, setIsDragging]             = useState(false);

  // CRM data
  const [conversations, setConversations] = useState<any[]>([]);
  const [groups, setGroups]               = useState<any[]>([]);
  const [stages, setStages]               = useState<any[]>([]);
  const [clients, setClients]             = useState<any[]>([]);
  const [clientFilter, setClientFilter]   = useState('all');
  const [saving, setSaving]               = useState(false);

  // Templates
  const [useTemplate, setUseTemplate]           = useState(false);
  const [templates, setTemplates]               = useState<any[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [templateVars, setTemplateVars]         = useState<string[]>([]);
  const [templateSearch, setTemplateSearch]     = useState('');
  const [showTemplateList, setShowTemplateList] = useState(false);

  const getLineId = () => (typeof window !== 'undefined' ? localStorage.getItem('selectedLineId') : '') || '';
  const getToken  = () => (typeof window !== 'undefined' ? localStorage.getItem('token') : '') || '';
  const authHeader = () => ({ Authorization: 'Bearer ' + getToken() });

  useEffect(() => { fetchAll(); }, []);

  const fetchTemplates = async () => {
    setTemplatesLoading(true);
    try {
      let lineId = getLineId();

      // Si no hay lineId, buscar la línea Cloud API directamente
      if (!lineId) {
        const linesRes = await fetch(API_URL + '/api/whatsapp/lines', { headers: authHeader() });
        if (linesRes.ok) {
          const linesData = await linesRes.json();
          const cloudLine = (linesData.lines || []).find((l: any) => l.connectionType === 'cloud_api');
          if (cloudLine) lineId = cloudLine.id;
        }
      }

      if (!lineId) { setTemplates([]); return; }

      // Auto-detectar WABA ID
      await fetch(API_URL + '/api/whatsapp/waba-id?lineId=' + lineId, { headers: authHeader() }).catch(() => {});

      const res = await fetch(API_URL + '/api/whatsapp/templates?lineId=' + lineId, { headers: authHeader() });
      if (res.ok) {
        const data = await res.json();
        // Si la línea seleccionada no es Cloud API, buscar automáticamente la que sí lo es
        if (data.reason === 'not_cloud_api' || data.reason === 'missing_token') {
          const linesRes = await fetch(API_URL + '/api/whatsapp/lines', { headers: authHeader() });
          if (linesRes.ok) {
            const linesData = await linesRes.json();
            const cloudLine = (linesData.lines || []).find((l: any) => l.connectionType === 'cloud_api');
            if (cloudLine) {
              await fetch(API_URL + '/api/whatsapp/waba-id?lineId=' + cloudLine.id, { headers: authHeader() }).catch(() => {});
              const res2 = await fetch(API_URL + '/api/whatsapp/templates?lineId=' + cloudLine.id, { headers: authHeader() });
              if (res2.ok) {
                const data2 = await res2.json();
                setTemplates(data2.templates || []);
                return;
              }
            }
          }
        }
        setTemplates(data.templates || []);
      }
    } catch (e) {
      console.error('fetchTemplates error:', e);
    } finally {
      setTemplatesLoading(false);
    }
  };

  const selectTemplate = (tpl: any) => {
    setSelectedTemplate(tpl);
    setShowTemplateList(false);
    const body = tpl.components?.find((c: any) => c.type === 'BODY')?.text || '';
    const varCount = (body.match(/\{\{\d+\}\}/g) || []).length;
    setTemplateVars(Array(varCount).fill(''));
  };

  const fetchAll = async () => {
    const token  = getToken();
    const lineId = getLineId();
    const h = { Authorization: 'Bearer ' + token };
    try {
      const [schedRes, convRes, groupRes, stageRes, clientsRes] = await Promise.all([
        fetch(API_URL + '/api/scheduled?lineId=' + lineId,             { headers: h }),
        fetch(API_URL + '/api/conversations?lineId=' + lineId,          { headers: h }),
        fetch(API_URL + '/api/conversations/groups?lineId=' + lineId,   { headers: h }),
        fetch(API_URL + '/api/stages?lineId=' + lineId,                 { headers: h }),
        fetch(API_URL + '/api/clients?lineId=' + lineId,                { headers: h }),
      ]);
      if (schedRes.ok)   setScheduled((await schedRes.json()).scheduled || []);
      if (convRes.ok)    setConversations((await convRes.json()).conversations || []);
      if (groupRes.ok)   setGroups((await groupRes.json()).groups || []);
      if (stageRes.ok)   { const d = await stageRes.json(); if (d.stages?.length) setStages(d.stages); }
      if (clientsRes.ok) setClients((await clientsRes.json()).clients || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const parseExcel = useCallback((file: File) => {
    setExcelParsing(true);
    setExcelFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data  = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb    = XLSX.read(data, { type: 'array' });
        const ws    = wb.Sheets[wb.SheetNames[0]];
        const rows  = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const parsed = rows.map(parseRow).filter((r) => r.phone.length > 0);
        const seen   = new Set<string>();
        const dedup  = parsed.filter((r) => {
          if (seen.has(r.phone)) return false;
          seen.add(r.phone);
          return true;
        });
        setExcelContacts(dedup);
        setTargetId('bulk_excel');
        setTargetName(dedup.filter((r) => r.valid).length + ' contactos importados');
      } catch (err) {
        alert('Error leyendo el archivo. Asegúrate de que sea un .xlsx o .csv válido.');
        console.error(err);
      } finally {
        setExcelParsing(false);
      }
    };
    reader.onerror = () => { alert('Error al leer el archivo.'); setExcelParsing(false); };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleExcelFile = (file: File) => {
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) { alert('Solo se aceptan archivos .xlsx, .xls o .csv'); return; }
    parseExcel(file);
  };

  const handleExcelInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleExcelFile(f);
    e.target.value = '';
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleExcelFile(f);
  };
  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['nombre', 'telefono'],
      ['Juan Pérez', '573001234567'],
      ['María García', '573109876543'],
      ['Carlos López', '573208765432'],
    ]);
    ws['!cols'] = [{ wch: 25 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contactos');
    XLSX.writeFile(wb, 'plantilla_envio_masivo.xlsx');
  };

  const resetForm = () => {
    setTargetType('contact'); setTargetId(''); setTargetName(''); setMessage('');
    setScheduledDate(''); setScheduledTime(''); setRecurrence('once');
    setRecurrenceDays([]); setRecurrenceEnd('');
    setMediaFile(null); setMediaPreview(null); setEditing(null);
    setExcelContacts([]); setExcelFileName(''); setClientFilter('all');
    setShowExcelPreview(true);
    setUseTemplate(false); setSelectedTemplate(null); setTemplateVars([]);
    setTemplateSearch(''); setShowTemplateList(false); setTemplates([]);
  };

  const openCreate = () => {
    resetForm();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setScheduledDate(tomorrow.toISOString().split('T')[0]);
    setScheduledTime('09:00');
    setShowModal(true);
  };

  const openEdit = (item: any) => {
    setEditing(item); setTargetType(item.targetType || 'contact');
    setTargetId(item.targetId || ''); setTargetName(item.targetName || '');
    setMessage(item.message || '');
    const dt = new Date(item.scheduledAt);
    setScheduledDate(dt.toISOString().split('T')[0]);
    setScheduledTime(dt.toTimeString().slice(0, 5));
    setRecurrence(item.recurrence || 'once'); setRecurrenceDays(item.recurrenceDays || []);
    setRecurrenceEnd(item.recurrenceEnd ? new Date(item.recurrenceEnd).toISOString().split('T')[0] : '');
    setMediaFile(null); setMediaPreview(null);
    if (item.targetType === 'bulk_excel' && item.bulkRecipients) {
      setExcelContacts(item.bulkRecipients);
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    const validTargetId = targetType === 'bulk_excel' ? 'bulk_excel' : targetId;
    if (!validTargetId || !scheduledDate || !scheduledTime) return;
    if (!message && !mediaFile) return;
    const validContacts = excelContacts.filter((c) => c.valid);
    if (targetType === 'bulk_excel' && validContacts.length === 0) return;

    setSaving(true);
    const token = getToken();

    let mediaUrl: string | null = null;
    let mediaType: string | null = null;
    if (mediaFile) {
      mediaUrl = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload  = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(mediaFile);
      });
      if      (mediaFile.type.startsWith('image/')) mediaType = 'image';
      else if (mediaFile.type.startsWith('audio/')) mediaType = 'audio';
      else if (mediaFile.type.startsWith('video/')) mediaType = 'video';
      else mediaType = 'document';
    }

    const scheduledAt = new Date(scheduledDate + 'T' + scheduledTime + ':00').toISOString();
    const lineId = getLineId();

    const body: any = {
      whatsappLineId: lineId || undefined,
      targetType,
      targetId: validTargetId,
      targetName: targetType === 'bulk_excel'
        ? ('📊 ' + validContacts.length + ' contactos Excel' + (excelFileName ? ' · ' + excelFileName : ''))
        : (targetName || undefined),
      message: message || undefined,
      ...(mediaUrl && { mediaUrl, mediaType }),
      scheduledAt,
      recurrence,
      recurrenceDays: recurrence === 'weekly' ? recurrenceDays : undefined,
      recurrenceTime: scheduledTime,
      recurrenceEnd:  recurrenceEnd ? new Date(recurrenceEnd + 'T23:59:59').toISOString() : undefined,
      ...(targetType === 'bulk_excel' && {
        bulkRecipients: validContacts.map((c) => ({ phone: c.phone, name: c.name || '' })),
      }),
      ...(useTemplate && selectedTemplate && {
        templateName:      selectedTemplate.name,
        templateLanguage:  selectedTemplate.language || 'es',
        templateVariables: templateVars,
      }),
    };

    try {
      const url = editing
        ? API_URL + '/api/scheduled/' + editing.id
        : API_URL + '/api/scheduled';
      const res = await fetch(url, {
        method:  editing ? 'PUT' : 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (res.ok) { setShowModal(false); resetForm(); fetchAll(); }
      else { const err = await res.json(); alert('Error: ' + (err.error || 'Error al guardar')); }
    } catch {
      alert('Error de conexión');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este mensaje programado?')) return;
    await fetch(API_URL + '/api/scheduled/' + id, { method: 'DELETE', headers: authHeader() });
    fetchAll();
  };

  const handleCancel = async (id: string) => {
    await fetch(API_URL + '/api/scheduled/' + id, {
      method: 'PUT',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    fetchAll();
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

  const filteredScheduled = scheduled.filter((s) => filter === 'all' || s.status === filter);
  const stats = {
    pending: scheduled.filter((s) => s.status === 'pending').length,
    sent:    scheduled.filter((s) => s.status === 'sent').length,
    failed:  scheduled.filter((s) => s.status === 'failed').length,
  };
  const excelValid   = excelContacts.filter((c) => c.valid).length;
  const excelInvalid = excelContacts.filter((c) => !c.valid).length;

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
            <h1 className="text-3xl font-bold text-white">Mensajes Programados</h1>
            <p className="text-sm text-[var(--text-muted)]">Programa envíos individuales, por etapa o masivos desde Excel</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} className="p-2 hover:bg-white/10 rounded-lg" title="Actualizar">
            <RefreshCw className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
          <button onClick={openCreate} className="btn-primary flex items-center gap-2 px-4 py-2">
            <Plus className="w-4 h-4" /> Programar
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { key: 'pending', label: 'Pendientes', icon: Clock,       color: 'yellow'  },
          { key: 'sent',    label: 'Enviados',   icon: CheckCircle, color: 'emerald' },
          { key: 'failed',  label: 'Fallidos',   icon: AlertCircle, color: 'red'     },
        ].map(({ key, label, icon: Icon, color }) => (
          <div
            key={key}
            onClick={() => setFilter((f) => f === key ? 'all' : key)}
            className={'card p-4 flex items-center gap-3 cursor-pointer transition-all hover:border-' + color + '-500/50'}
          >
            <div className={'w-10 h-10 rounded-xl bg-' + color + '-500/20 flex items-center justify-center'}>
              <Icon className={'w-5 h-5 text-' + color + '-400'} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats[key as keyof typeof stats]}</p>
              <p className="text-xs text-[var(--text-muted)]">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'pending', 'sent', 'failed'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={'px-3 py-1.5 rounded-lg text-sm font-medium transition-all ' + (filter === f ? 'bg-[var(--accent-primary)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-white')}
          >
            {f === 'all' ? 'Todos' : f === 'pending' ? 'Pendientes' : f === 'sent' ? 'Enviados' : 'Fallidos'}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-2">
        {filteredScheduled.map((item) => {
          const status     = STATUS_STYLES[item.status] || STATUS_STYLES.pending;
          const StatusIcon = status.icon;
          const dt         = new Date(item.scheduledAt);
          const isBulk     = item.targetType === 'bulk_excel';
          const expanded   = expandedId === item.id;

          return (
            <div key={item.id} className="card hover:border-[var(--accent-primary)]/30 transition-all overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={'w-9 h-9 rounded-lg ' + status.bg + ' flex items-center justify-center flex-shrink-0 mt-0.5'}>
                      <StatusIcon className={'w-4 h-4 ' + status.text} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-sm font-semibold text-white truncate max-w-xs">{item.targetName || item.targetId}</span>
                        <span className={'px-1.5 py-0.5 rounded text-xs font-medium ' + status.bg + ' ' + status.text}>{status.label}</span>
                        {item.recurrence !== 'once' && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">
                            🔄 {RECURRENCE_OPTIONS.find((r) => r.id === item.recurrence)?.label}
                          </span>
                        )}
                        {isBulk && <span className="px-1.5 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400">📊 Excel masivo</span>}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] truncate mb-1">
                        {item.mediaUrl && '📎 '}{item.message || '[Solo media]'}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                        <span>📅 {dt.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })} {dt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
                        {item.sendCount > 0 && <span>· Enviado {item.sendCount}x</span>}
                        {isBulk && item.bulkTotal > 0 && <span className="text-emerald-400">· ✓{item.bulkSent}/{item.bulkTotal} enviados</span>}
                        {isBulk && item.bulkFailed > 0 && <span className="text-red-400">· ✗{item.bulkFailed} fallidos</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isBulk && item.bulkTotal > 0 && (
                      <button onClick={() => setExpandedId(expanded ? null : item.id)} className="p-1.5 hover:bg-white/10 rounded-lg">
                        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-[var(--text-muted)]" /> : <BarChart3 className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
                      </button>
                    )}
                    {item.status === 'pending' && (
                      <>
                        <button onClick={() => openEdit(item)} className="p-1.5 hover:bg-white/10 rounded-lg"><Edit2 className="w-3.5 h-3.5 text-[var(--text-muted)]" /></button>
                        <button onClick={() => handleCancel(item.id)} className="p-1.5 hover:bg-yellow-500/10 rounded-lg"><X className="w-3.5 h-3.5 text-yellow-400" /></button>
                      </>
                    )}
                    <button onClick={() => handleDelete(item.id)} className="p-1.5 hover:bg-red-500/10 rounded-lg"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                  </div>
                </div>
              </div>

              {expanded && isBulk && (
                <div className="border-t border-[var(--border-primary)] p-4 bg-[var(--bg-tertiary)]">
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="p-2 rounded-lg bg-[var(--bg-secondary)] text-center">
                      <p className="text-lg font-bold text-white">{item.bulkTotal}</p>
                      <p className="text-xs text-[var(--text-muted)]">Total</p>
                    </div>
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-center">
                      <p className="text-lg font-bold text-emerald-400">{item.bulkSent}</p>
                      <p className="text-xs text-[var(--text-muted)]">Enviados</p>
                    </div>
                    <div className="p-2 rounded-lg bg-red-500/10 text-center">
                      <p className="text-lg font-bold text-red-400">{item.bulkFailed}</p>
                      <p className="text-xs text-[var(--text-muted)]">Fallidos</p>
                    </div>
                  </div>
                  {item.bulkTotal > 0 && (
                    <div className="w-full h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: ((item.bulkSent / item.bulkTotal) * 100) + '%' }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filteredScheduled.length === 0 && (
          <div className="card p-12 text-center">
            <Clock className="w-12 h-12 mx-auto mb-3 text-[var(--text-muted)] opacity-30" />
            <p className="text-sm text-[var(--text-muted)]">No hay mensajes {filter !== 'all' ? filter : 'programados'}</p>
            <button onClick={openCreate} className="btn-primary mt-4 inline-flex items-center gap-2 text-sm">
              <Plus className="w-4 h-4" /> Programar primer mensaje
            </button>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <ModalProgramado
          editing={editing}
          saving={saving}
          targetType={targetType}
          targetId={targetId}
          targetName={targetName}
          message={message}
          scheduledDate={scheduledDate}
          scheduledTime={scheduledTime}
          recurrence={recurrence}
          recurrenceDays={recurrenceDays}
          recurrenceEnd={recurrenceEnd}
          mediaFile={mediaFile}
          mediaPreview={mediaPreview}
          excelContacts={excelContacts}
          excelFileName={excelFileName}
          excelParsing={excelParsing}
          showExcelPreview={showExcelPreview}
          isDragging={isDragging}
          excelValid={excelValid}
          excelInvalid={excelInvalid}
          conversations={conversations}
          groups={groups}
          stages={stages}
          clients={clients}
          clientFilter={clientFilter}
          useTemplate={useTemplate}
          templates={templates}
          templatesLoading={templatesLoading}
          selectedTemplate={selectedTemplate}
          templateVars={templateVars}
          templateSearch={templateSearch}
          showTemplateList={showTemplateList}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
          setTargetType={setTargetType}
          setTargetId={setTargetId}
          setTargetName={setTargetName}
          setMessage={setMessage}
          setScheduledDate={setScheduledDate}
          setScheduledTime={setScheduledTime}
          setRecurrence={setRecurrence}
          setRecurrenceDays={setRecurrenceDays}
          setRecurrenceEnd={setRecurrenceEnd}
          setMediaFile={setMediaFile}
          setMediaPreview={setMediaPreview}
          setExcelContacts={setExcelContacts}
          setExcelFileName={setExcelFileName}
          setShowExcelPreview={setShowExcelPreview}
          setIsDragging={setIsDragging}
          setClientFilter={setClientFilter}
          setUseTemplate={setUseTemplate}
          setSelectedTemplate={setSelectedTemplate}
          setTemplateVars={setTemplateVars}
          setTemplateSearch={setTemplateSearch}
          setShowTemplateList={setShowTemplateList}
          fetchTemplates={fetchTemplates}
          selectTemplate={selectTemplate}
          handleExcelInput={handleExcelInput}
          handleDrop={handleDrop}
          handleDragOver={handleDragOver}
          handleDragLeave={handleDragLeave}
          handleFileSelect={handleFileSelect}
          downloadTemplate={downloadTemplate}
        />
      )}
    </div>
  );
}

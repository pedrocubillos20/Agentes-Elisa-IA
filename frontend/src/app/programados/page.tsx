'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { 
  Clock, Plus, Trash2, Edit2, X, Send, Users, User, 
  LayoutGrid, Calendar, Repeat, ChevronDown, Image, Mic, Paperclip,
  CheckCircle, AlertCircle, Loader, FileText, MessageSquare,
  Upload, Download, Sheet, Eye, EyeOff, BarChart3, ChevronUp,
  ArrowUpFromLine, Info, RefreshCw, Zap, ChevronRight
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
  pending:  { bg: 'bg-yellow-500/20',  text: 'text-yellow-400',  label: 'Pendiente', icon: Clock },
  sent:     { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Enviado',   icon: CheckCircle },
  failed:   { bg: 'bg-red-500/20',     text: 'text-red-400',     label: 'Fallido',   icon: AlertCircle },
  cancelled:{ bg: 'bg-gray-500/20',    text: 'text-gray-400',    label: 'Cancelado', icon: X },
};

const TARGET_TYPES = [
  { id: 'contact',    label: 'Contacto',      icon: User,             desc: 'Un número específico' },
  { id: 'group',      label: 'Grupo',          icon: Users,            desc: 'Grupo de WhatsApp' },
  { id: 'stage',      label: 'Etapa embudo',   icon: LayoutGrid,       desc: 'Todos en una etapa' },
  { id: 'clients',    label: 'Clientes CRM',   icon: MessageSquare,    desc: 'Contactos del CRM' },
  { id: 'bulk_excel', label: 'Importar Excel', icon: ArrowUpFromLine,  desc: 'Subir lista .xlsx' },
];

const PHONE_COLS    = ['telefono','phone','celular','movil','whatsapp','numero','tel','mobile','number'];
const NAME_COLS     = ['nombre','name','cliente','contacto','apellido','fullname','full_name','nombres'];

const isValidPhone = (p: string): boolean => {
  const c = String(p || '').replace(/\D/g,'');
  return c.length >= 7 && c.length <= 15;
};

const normalizePhone = (p: string): string => String(p || '').replace(/\D/g,'');

const parseRow = (row: any): { phone: string; name: string; valid: boolean; raw: string } => {
  const keys = Object.keys(row).map(k => k.toLowerCase().trim());
  let phone = '';
  let name  = '';
  for (const col of PHONE_COLS) {
    const key = keys.find(k => k.includes(col) || col.includes(k));
    if (key) { phone = String(row[Object.keys(row)[keys.indexOf(key)]] || '').trim(); break; }
  }
  for (const col of NAME_COLS) {
    const key = keys.find(k => k.includes(col) || col.includes(k));
    if (key) { name = String(row[Object.keys(row)[keys.indexOf(key)]] || '').trim(); break; }
  }
  if (!phone) {
    for (const val of Object.values(row)) {
      const s = String(val || '').replace(/\D/g,'');
      if (s.length >= 7 && s.length <= 15) { phone = String(val); break; }
    }
  }
  const normalized = normalizePhone(phone);
  return { phone: normalized, name, valid: isValidPhone(normalized), raw: phone };
};

// ── TEMPLATE PREVIEW ────────────────────────────────────────────
const TemplatePreview = ({ template, variables }: { template: any; variables: string[] }) => {
  if (!template) return null;

  const renderBody = () => {
    let text = template.components?.find((c: any) => c.type === 'BODY')?.text || '';
    variables.forEach((v, i) => {
      text = text.replace(`{{${i + 1}}}`, v ? `*${v}*` : `{{${i + 1}}}`);
    });
    return text;
  };

  const header = template.components?.find((c: any) => c.type === 'HEADER');
  const footer = template.components?.find((c: any) => c.type === 'FOOTER');
  const buttons = template.components?.find((c: any) => c.type === 'BUTTONS');

  return (
    <div className="rounded-xl overflow-hidden border border-[var(--border-primary)] bg-[#0b141a]">
      {/* WhatsApp-style chat bubble */}
      <div className="p-3 bg-[#1a272f]">
        <p className="text-xs text-[var(--text-muted)] mb-2 flex items-center gap-1">
          <Eye className="w-3 h-3" /> Vista previa
        </p>
        <div className="bg-[#202c33] rounded-xl p-3 max-w-[85%] ml-auto relative">
          {/* Tail */}
          <div className="absolute right-[-6px] top-3 w-0 h-0 border-l-[6px] border-l-[#202c33] border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent" />
          
          {header && (
            <div className="mb-2">
              {header.format === 'TEXT' && <p className="font-bold text-white text-sm">{header.text}</p>}
              {header.format === 'IMAGE' && <div className="w-full h-20 bg-white/10 rounded-lg flex items-center justify-center mb-1"><Image className="w-6 h-6 text-gray-400" /></div>}
              {header.format === 'VIDEO' && <div className="w-full h-20 bg-white/10 rounded-lg flex items-center justify-center mb-1"><span className="text-2xl">▶️</span></div>}
              {header.format === 'DOCUMENT' && <div className="w-full h-12 bg-white/10 rounded-lg flex items-center gap-2 px-3 mb-1"><FileText className="w-4 h-4 text-gray-400" /><span className="text-xs text-gray-400">Documento</span></div>}
            </div>
          )}
          
          <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{renderBody()}</p>
          
          {footer && <p className="text-xs text-gray-400 mt-2">{footer.text}</p>}
          
          <p className="text-[10px] text-gray-500 text-right mt-1">12:00 ✓✓</p>
        </div>
        
        {buttons?.buttons && (
          <div className="mt-1 space-y-1 max-w-[85%] ml-auto">
            {buttons.buttons.map((btn: any, i: number) => (
              <div key={i} className="bg-[#202c33] rounded-lg py-2 px-3 text-center border-t border-white/10">
                <span className="text-[#53bdeb] text-sm font-medium">
                  {btn.type === 'URL' ? '🔗 ' : btn.type === 'PHONE_NUMBER' ? '📞 ' : ''}
                  {btn.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default function ProgramadosPage() {
  const [scheduled, setScheduled]     = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const [editing, setEditing]         = useState<any>(null);
  const [filter, setFilter]           = useState<string>('all');
  const [expandedId, setExpandedId]   = useState<string | null>(null);

  // Form
  const [targetType, setTargetType]   = useState('contact');
  const [targetId, setTargetId]       = useState('');
  const [targetName, setTargetName]   = useState('');
  const [message, setMessage]         = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [recurrence, setRecurrence]   = useState('once');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceEnd, setRecurrenceEnd]   = useState('');
  const [mediaFile, setMediaFile]     = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  // Excel bulk
  const [excelContacts, setExcelContacts] = useState<any[]>([]);
  const [excelFileName, setExcelFileName] = useState('');
  const [excelParsing, setExcelParsing]   = useState(false);
  const [showExcelPreview, setShowExcelPreview] = useState(true);
  const [isDragging, setIsDragging]       = useState(false);

  // CRM data
  const [conversations, setConversations] = useState<any[]>([]);
  const [groups, setGroups]               = useState<any[]>([]);
  const [stages, setStages]               = useState<any[]>([]);
  const [clients, setClients]             = useState<any[]>([]);
  const [clientFilter, setClientFilter]   = useState('all');
  const [saving, setSaving]               = useState(false);

  // ── PLANTILLAS FACEBOOK ──────────────────────────────────────
  const [useTemplate, setUseTemplate]           = useState(false);
  const [templates, setTemplates]               = useState<any[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [templateVariables, setTemplateVariables] = useState<string[]>([]);
  const [templateSearch, setTemplateSearch]     = useState('');
  const [showTemplateList, setShowTemplateList] = useState(false);

  const getLineId = () => (typeof window !== 'undefined' ? localStorage.getItem('selectedLineId') : '') || '';
  const headers   = () => ({ Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('token') : ''}` });

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    const lineId = getLineId();
    try {
      const [schedRes, convRes, groupRes, stageRes, clientsRes] = await Promise.all([
        fetch(`${API_URL}/api/scheduled?lineId=${lineId}`,           { headers: headers() }),
        fetch(`${API_URL}/api/conversations?lineId=${lineId}`,        { headers: headers() }),
        fetch(`${API_URL}/api/conversations/groups?lineId=${lineId}`, { headers: headers() }),
        fetch(`${API_URL}/api/stages?lineId=${lineId}`,               { headers: headers() }),
        fetch(`${API_URL}/api/clients?lineId=${lineId}`,              { headers: headers() }),
      ]);
      if (schedRes.ok)   setScheduled((await schedRes.json()).scheduled || []);
      if (convRes.ok)    setConversations((await convRes.json()).conversations || []);
      if (groupRes.ok)   setGroups((await groupRes.json()).groups || []);
      if (stageRes.ok)   { const d = await stageRes.json(); if (d.stages?.length) setStages(d.stages); }
      if (clientsRes.ok) setClients((await clientsRes.json()).clients || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // ── CARGAR PLANTILLAS DE FACEBOOK ──────────────────────────
  const fetchTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const lineId = getLineId();
      const res = await fetch(`${API_URL}/api/whatsapp/cloud-templates?lineId=${lineId}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        // Solo mostrar plantillas APPROVED
        const approved = (data.templates || data.data || []).filter((t: any) =>
          t.status === 'APPROVED' || t.status === 'approved'
        );
        setTemplates(approved);
      }
    } catch (e) { console.error('Error cargando plantillas:', e); }
    finally { setTemplatesLoading(false); }
  };

  const selectTemplate = (tpl: any) => {
    setSelectedTemplate(tpl);
    setShowTemplateList(false);
    // Contar variables {{1}}, {{2}}, etc. en el body
    const body = tpl.components?.find((c: any) => c.type === 'BODY')?.text || '';
    const varCount = (body.match(/\{\{\d+\}\}/g) || []).length;
    setTemplateVariables(Array(varCount).fill(''));
  };

  // ── EXCEL ───────────────────────────────────────────────────
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
        const parsed = rows.map(parseRow).filter(r => r.phone.length > 0);
        const seen  = new Set<string>();
        const dedup = parsed.filter(r => { if (seen.has(r.phone)) return false; seen.add(r.phone); return true; });
        setExcelContacts(dedup);
        setTargetId('bulk_excel');
        setTargetName(`${dedup.filter(r=>r.valid).length} contactos importados`);
      } catch (err) {
        alert('Error leyendo el archivo.');
        console.error(err);
      } finally { setExcelParsing(false); }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleExcelFile = (file: File) => {
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) { alert('Solo .xlsx, .xls o .csv'); return; }
    parseExcel(file);
  };
  const handleExcelInput = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) handleExcelFile(f); e.target.value = ''; };
  const handleDrop       = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleExcelFile(f); };
  const handleDragOver   = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave  = (e: React.DragEvent) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([['nombre','telefono'],['Juan Pérez','573001234567'],['María García','573109876543']]);
    ws['!cols'] = [{ wch: 25 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contactos');
    XLSX.writeFile(wb, 'plantilla_envio_masivo.xlsx');
  };

  // ── RESET ───────────────────────────────────────────────────
  const resetForm = () => {
    setTargetType('contact'); setTargetId(''); setTargetName(''); setMessage('');
    setScheduledDate(''); setScheduledTime(''); setRecurrence('once');
    setRecurrenceDays([]); setRecurrenceEnd('');
    setMediaFile(null); setMediaPreview(null); setEditing(null);
    setExcelContacts([]); setExcelFileName(''); setClientFilter('all');
    setShowExcelPreview(true); setUseTemplate(false); setSelectedTemplate(null);
    setTemplateVariables([]); setTemplateSearch(''); setShowTemplateList(false);
  };

  const openCreate = () => {
    resetForm();
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
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
    if (item.targetType === 'bulk_excel' && item.bulkRecipients) setExcelContacts(item.bulkRecipients);
    // Restore template if was template message
    if (item.templateName) {
      setUseTemplate(true);
      setSelectedTemplate({ name: item.templateName, components: [] });
      setTemplateVariables(item.templateVariables || []);
    }
    setShowModal(true);
  };

  // ── SAVE ────────────────────────────────────────────────────
  const handleSave = async () => {
    const validTargetId = targetType === 'bulk_excel' ? 'bulk_excel' : targetId;
    if (!validTargetId || !scheduledDate || !scheduledTime) return;
    if (!useTemplate && !message && !mediaFile) return;
    if (useTemplate && !selectedTemplate) return;
    if (targetType === 'bulk_excel' && excelContacts.filter(c=>c.valid).length === 0) return;

    setSaving(true);
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';

    let mediaUrl: string | null = null;
    let mediaType: string | null = null;
    if (mediaFile && !useTemplate) {
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

    const scheduledAt = new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString();
    const validContacts = excelContacts.filter(c => c.valid);

    const body: any = {
      whatsappLineId: getLineId() || undefined,
      targetType,
      targetId:   validTargetId,
      targetName: targetType === 'bulk_excel'
        ? `📊 ${validContacts.length} contactos${excelFileName ? ` · ${excelFileName}` : ''}`
        : (targetName || undefined),
      message:    useTemplate ? undefined : (message || undefined),
      ...(mediaUrl && { mediaUrl, mediaType }),
      scheduledAt, recurrence,
      recurrenceDays: recurrence === 'weekly' ? recurrenceDays : undefined,
      recurrenceTime: scheduledTime,
      recurrenceEnd:  recurrenceEnd ? new Date(`${recurrenceEnd}T23:59:59`).toISOString() : undefined,
      ...(targetType === 'bulk_excel' && {
        bulkRecipients: validContacts.map(c => ({ phone: c.phone, name: c.name || '' })),
      }),
      // Template fields
      ...(useTemplate && selectedTemplate && {
        templateName: selectedTemplate.name,
        templateLanguage: selectedTemplate.language || 'es',
        templateVariables: templateVariables,
        message: `[Plantilla: ${selectedTemplate.name}]`, // fallback display
      }),
    };

    try {
      const url = editing ? `${API_URL}/api/scheduled/${editing.id}` : `${API_URL}/api/scheduled`;
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) { setShowModal(false); resetForm(); fetchAll(); }
      else        { const err = await res.json(); alert(`Error: ${err.error || 'Error al guardar'}`); }
    } catch { alert('Error de conexión'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este mensaje programado?')) return;
    await fetch(`${API_URL}/api/scheduled/${id}`, { method: 'DELETE', headers: headers() });
    fetchAll();
  };

  const handleCancel = async (id: string) => {
    await fetch(`${API_URL}/api/scheduled/${id}`, {
      method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    fetchAll();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setMediaFile(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setMediaPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else setMediaPreview(null);
  };

  const toggleDay = (dayId: number) =>
    setRecurrenceDays(prev => prev.includes(dayId) ? prev.filter(d => d !== dayId) : [...prev, dayId]);

  const filteredScheduled = scheduled.filter(s => filter === 'all' || s.status === filter);
  const filteredTemplates = templates.filter(t =>
    !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase())
  );

  const stats = {
    pending: scheduled.filter(s => s.status === 'pending').length,
    sent:    scheduled.filter(s => s.status === 'sent').length,
    failed:  scheduled.filter(s => s.status === 'failed').length,
  };

  const excelValid   = excelContacts.filter(c => c.valid).length;
  const excelInvalid = excelContacts.filter(c => !c.valid).length;

  const canSave = !saving &&
    scheduledDate && scheduledTime &&
    (targetType === 'bulk_excel' ? excelValid > 0 : !!targetId) &&
    (useTemplate ? !!selectedTemplate : (!!(message || mediaFile)));

  if (loading) return (
    <div className="h-[calc(100vh-120px)] flex items-center justify-center">
      <div className="loading-spinner w-8 h-8" />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-4">

      {/* ── HEADER ─── */}
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

      {/* ── STATS ─── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { key: 'pending', label: 'Pendientes', icon: Clock,         color: 'yellow' },
          { key: 'sent',    label: 'Enviados',   icon: CheckCircle,   color: 'emerald' },
          { key: 'failed',  label: 'Fallidos',   icon: AlertCircle,   color: 'red' },
        ].map(({ key, label, icon: Icon, color }) => (
          <div key={key} onClick={() => setFilter(f => f === key ? 'all' : key)}
            className={`card p-4 flex items-center gap-3 cursor-pointer transition-all hover:border-${color}-500/50`}>
            <div className={`w-10 h-10 rounded-xl bg-${color}-500/20 flex items-center justify-center`}>
              <Icon className={`w-5 h-5 text-${color}-400`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats[key as keyof typeof stats]}</p>
              <p className="text-xs text-[var(--text-muted)]">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── FILTER TABS ─── */}
      <div className="flex gap-2 flex-wrap">
        {['all','pending','sent','failed'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === f ? 'bg-[var(--accent-primary)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-white'}`}>
            { f === 'all' ? 'Todos' : f === 'pending' ? 'Pendientes' : f === 'sent' ? 'Enviados' : 'Fallidos' }
          </button>
        ))}
      </div>

      {/* ── LIST ─── */}
      <div className="space-y-2">
        {filteredScheduled.map(item => {
          const status     = STATUS_STYLES[item.status] || STATUS_STYLES.pending;
          const StatusIcon = status.icon;
          const dt         = new Date(item.scheduledAt);
          const isBulk     = item.targetType === 'bulk_excel';
          const isTemplate = !!item.templateName;
          const expanded   = expandedId === item.id;

          return (
            <div key={item.id} className="card hover:border-[var(--accent-primary)]/30 transition-all overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={`w-9 h-9 rounded-lg ${status.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <StatusIcon className={`w-4 h-4 ${status.text}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-sm font-semibold text-white truncate max-w-xs">{item.targetName || item.targetId}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${status.bg} ${status.text}`}>{status.label}</span>
                        {item.recurrence !== 'once' && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">
                            🔄 {RECURRENCE_OPTIONS.find(r=>r.id===item.recurrence)?.label}
                          </span>
                        )}
                        {isBulk && <span className="px-1.5 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400">📊 Excel masivo</span>}
                        {isTemplate && <span className="px-1.5 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">⚡ Plantilla</span>}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] truncate mb-1">
                        {isTemplate ? `📋 ${item.templateName}` : `${item.mediaUrl ? '📎 ' : ''}${item.message || '[Solo media]'}`}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                        <span>📅 {dt.toLocaleDateString('es-CO',{weekday:'short',day:'numeric',month:'short'})} {dt.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}</span>
                        {item.sendCount > 0 && <span>· Enviado {item.sendCount}x</span>}
                        {isBulk && item.bulkTotal > 0 && <span className="text-emerald-400">· ✓{item.bulkSent}/{item.bulkTotal}</span>}
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
                    <div className="p-2 rounded-lg bg-[var(--bg-secondary)] text-center"><p className="text-lg font-bold text-white">{item.bulkTotal}</p><p className="text-xs text-[var(--text-muted)]">Total</p></div>
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-center"><p className="text-lg font-bold text-emerald-400">{item.bulkSent}</p><p className="text-xs text-[var(--text-muted)]">Enviados</p></div>
                    <div className="p-2 rounded-lg bg-red-500/10 text-center"><p className="text-lg font-bold text-red-400">{item.bulkFailed}</p><p className="text-xs text-[var(--text-muted)]">Fallidos</p></div>
                  </div>
                  {item.bulkTotal > 0 && <div className="w-full h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(item.bulkSent/item.bulkTotal)*100}%` }} /></div>}
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

      {/* ════════════════════════ MODAL ════════════════════════ */}
      {showModal && createPortal(
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(8px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'1rem' }}
          onClick={() => !saving && setShowModal(false)}>
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col"
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-primary)] flex-shrink-0">
              <h3 className="font-bold text-white text-lg">{editing ? 'Editar Programado' : 'Nuevo Mensaje Programado'}</h3>
              <button onClick={() => !saving && setShowModal(false)} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
            </div>

            {/* Body scroll */}
            <div className="overflow-y-auto flex-1 p-4 space-y-4">

              {/* ── Tipo de destinatario ── */}
              <div>
                <label className="text-sm font-semibold text-[var(--text-muted)] mb-2 block">Enviar a</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {TARGET_TYPES.map(t => {
                    const Icon = t.icon;
                    const active = targetType === t.id;
                    return (
                      <button key={t.id} onClick={() => { setTargetType(t.id); setTargetId(''); setTargetName(''); setExcelContacts([]); setExcelFileName(''); }}
                        className={`p-2 rounded-xl border text-center transition-all ${active ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10' : 'border-[var(--border-primary)] hover:border-white/20'}`}>
                        <Icon className={`w-4 h-4 mx-auto mb-0.5 ${active ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'}`} />
                        <p className="text-[10px] font-medium text-white leading-tight">{t.label}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Contacto ── */}
              {targetType === 'contact' && (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-[var(--text-muted)] block">Contacto</label>
                  <input type="text" value={targetId} onChange={e => setTargetId(e.target.value)} placeholder="Ej: 573001234567"
                    className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--accent-primary)] transition-colors" />
                  {conversations.length > 0 && (
                    <select value="" onChange={e => { const c = conversations.find(c=>c.recipientId===e.target.value); if(c){setTargetId(c.recipientId);setTargetName(c.recipientName||c.recipientId);} }}
                      className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)] [color-scheme:dark]">
                      <option value="">O selecciona uno existente...</option>
                      {conversations.filter(c=>!c.isGroup).map(c=>(
                        <option key={c.id} value={c.recipientId}>{c.recipientName||c.recipientId}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {targetType === 'group' && (
                <div>
                  <label className="text-sm font-semibold text-[var(--text-muted)] mb-1 block">Grupo</label>
                  <select value={targetId} onChange={e=>{const g=groups.find(gr=>gr.recipientId===e.target.value);setTargetId(e.target.value);if(g)setTargetName(g.groupName||g.recipientName||e.target.value);}}
                    className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)] [color-scheme:dark]">
                    <option value="">Selecciona un grupo...</option>
                    {groups.map(g=><option key={g.id} value={g.recipientId}>{g.groupName||g.recipientName||g.recipientId}</option>)}
                  </select>
                </div>
              )}

              {targetType === 'stage' && (
                <div>
                  <label className="text-sm font-semibold text-[var(--text-muted)] mb-1 block">Etapa del embudo</label>
                  <select value={targetId} onChange={e=>{setTargetId(e.target.value);const s=stages.find(st=>st.id===e.target.value);setTargetName(s?.label||e.target.value);}}
                    className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)] [color-scheme:dark]">
                    <option value="">Selecciona una etapa...</option>
                    {stages.map(s=><option key={s.id} value={s.id}>{s.label} ({conversations.filter(c=>c.stage===s.id).length} contactos)</option>)}
                  </select>
                </div>
              )}

              {targetType === 'clients' && (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-[var(--text-muted)] block">Clientes CRM</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[{id:'all',label:'Todos'},{id:'active',label:'✅ Activos'},{id:'lead',label:'🔵 Leads'},{id:'vip',label:'⭐ VIP'}].map(f=>(
                      <button key={f.id} onClick={()=>{setClientFilter(f.id);setTargetId(`clients:${f.id}`);setTargetName(`Clientes: ${f.label}`);}}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${clientFilter===f.id?'bg-[var(--accent-primary)]/20 border-[var(--accent-primary)]/50 text-white':'bg-white/5 border-white/10 text-[var(--text-muted)] hover:text-white'}`}>
                        {f.label} ({clients.filter(c=>f.id==='all'?true:c.status===f.id).length})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {targetType === 'bulk_excel' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-[var(--text-muted)]">Importar desde Excel</label>
                    <button onClick={downloadTemplate} className="flex items-center gap-1 text-sm text-[var(--accent-primary)] hover:underline">
                      <Download className="w-3 h-3" /> Plantilla
                    </button>
                  </div>
                  {excelContacts.length === 0 ? (
                    <div onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
                      onClick={() => excelInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${isDragging ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5' : 'border-[var(--border-primary)] hover:border-[var(--accent-primary)]/50'}`}>
                      {excelParsing
                        ? <div className="flex flex-col items-center gap-2"><Loader className="w-8 h-8 text-[var(--accent-primary)] animate-spin" /><p className="text-sm text-[var(--text-muted)]">Procesando...</p></div>
                        : <div className="flex flex-col items-center gap-2">
                            <ArrowUpFromLine className="w-8 h-8 text-green-400" />
                            <p className="text-sm font-semibold text-white">Arrastra tu Excel aquí</p>
                            <p className="text-xs text-[var(--text-muted)]">.xlsx .xls .csv</p>
                          </div>
                      }
                      <input ref={excelInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelInput} className="hidden" />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                        <div className="flex items-center gap-4">
                          <div className="text-center"><p className="text-lg font-bold text-white">{excelContacts.length}</p><p className="text-xs text-[var(--text-muted)]">Total</p></div>
                          <div className="text-center"><p className="text-lg font-bold text-emerald-400">{excelValid}</p><p className="text-xs text-[var(--text-muted)]">Válidos</p></div>
                          {excelInvalid > 0 && <div className="text-center"><p className="text-lg font-bold text-amber-400">{excelInvalid}</p><p className="text-xs text-[var(--text-muted)]">Inválidos</p></div>}
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => setShowExcelPreview(p => !p)} className="p-1.5 hover:bg-white/10 rounded-lg">
                            {showExcelPreview ? <EyeOff className="w-3.5 h-3.5 text-[var(--text-muted)]" /> : <Eye className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
                          </button>
                          <button onClick={() => { setExcelContacts([]); setExcelFileName(''); }} className="p-1.5 hover:bg-red-500/10 rounded-lg">
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </button>
                        </div>
                      </div>
                      {showExcelPreview && (
                        <div className="rounded-xl border border-[var(--border-primary)] overflow-hidden">
                          <div className="max-h-32 overflow-y-auto divide-y divide-[var(--border-primary)]">
                            {excelContacts.slice(0,30).map((c,i) => (
                              <div key={i} className="grid grid-cols-[auto_1fr_1fr] text-xs px-3 py-1.5 gap-3 items-center">
                                <span className="text-[var(--text-muted)]">{i+1}</span>
                                <span className="text-white truncate">{c.name || <span className="text-gray-500 italic">Sin nombre</span>}</span>
                                <span className={`font-mono ${c.valid ? 'text-emerald-400' : 'text-amber-400'}`}>{c.phone} {!c.valid && '⚠️'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ══════════════════════════════════════════════════════
                  ⚡ TIPO DE CONTENIDO: Mensaje libre vs Plantilla
                  ══════════════════════════════════════════════════════ */}
              <div>
                <label className="text-sm font-semibold text-[var(--text-muted)] mb-2 block">Tipo de contenido</label>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setUseTemplate(false)}
                    className={`p-3 rounded-xl border text-left transition-all ${!useTemplate ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10' : 'border-[var(--border-primary)] hover:border-white/20'}`}>
                    <MessageSquare className={`w-4 h-4 mb-1 ${!useTemplate ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'}`} />
                    <p className="text-xs font-semibold text-white">Mensaje libre</p>
                    <p className="text-[10px] text-[var(--text-muted)]">Texto + imagen personalizada</p>
                  </button>
                  <button onClick={() => { setUseTemplate(true); if (templates.length === 0) fetchTemplates(); }}
                    className={`p-3 rounded-xl border text-left transition-all ${useTemplate ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10' : 'border-[var(--border-primary)] hover:border-white/20'}`}>
                    <Zap className={`w-4 h-4 mb-1 ${useTemplate ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'}`} />
                    <p className="text-xs font-semibold text-white">Plantilla aprobada</p>
                    <p className="text-[10px] text-[var(--text-muted)]">Facebook Business + botones</p>
                  </button>
                </div>
              </div>

              {/* ── MENSAJE LIBRE ── */}
              {!useTemplate && (
                <>
                  <div>
                    <label className="text-sm font-semibold text-[var(--text-muted)] mb-1.5 block">Mensaje</label>
                    <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Escribe tu mensaje..."
                      className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--accent-primary)] transition-colors min-h-[80px] resize-none" />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--text-muted)] mb-1.5 block">Adjunto (opcional)</label>
                    <input ref={fileInputRef} type="file" accept="image/*,audio/*,video/*,application/pdf" onChange={handleFileSelect} className="hidden" />
                    {mediaFile ? (
                      <div className="flex items-center gap-3 p-2.5 bg-[var(--bg-tertiary)] rounded-xl border border-[var(--border-primary)]">
                        {mediaPreview ? <img src={mediaPreview} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <FileText className="w-8 h-8 text-[var(--accent-primary)]" />}
                        <div className="flex-1 min-w-0"><p className="text-xs text-white truncate">{mediaFile.name}</p><p className="text-xs text-[var(--text-muted)]">{(mediaFile.size/1024).toFixed(0)} KB</p></div>
                        <button onClick={() => { setMediaFile(null); setMediaPreview(null); }} className="p-1 hover:bg-white/10 rounded"><X className="w-4 h-4 text-red-400" /></button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        {[{label:'Imagen',icon:Image,accept:'image/*'},{label:'Audio',icon:Mic,accept:'audio/*'},{label:'Archivo',icon:Paperclip,accept:'*/*'}].map(({label,icon:Icon,accept}) => (
                          <button key={label} onClick={() => { if(fileInputRef.current){fileInputRef.current.accept=accept;fileInputRef.current.click();} }}
                            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--bg-tertiary)] rounded-lg text-sm text-[var(--text-muted)] hover:text-white border border-[var(--border-primary)] transition-all">
                            <Icon className="w-3.5 h-3.5" /> {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ══ PLANTILLAS FACEBOOK ══════════════════════════════ */}
              {useTemplate && (
                <div className="space-y-3">

                  {/* Selector de plantilla */}
                  <div>
                    <label className="text-sm font-semibold text-[var(--text-muted)] mb-1.5 block">Plantilla aprobada</label>
                    
                    {templatesLoading ? (
                      <div className="flex items-center gap-2 p-3 bg-[var(--bg-tertiary)] rounded-xl border border-[var(--border-primary)]">
                        <Loader className="w-4 h-4 animate-spin text-[var(--accent-primary)]" />
                        <span className="text-sm text-[var(--text-muted)]">Cargando plantillas...</span>
                      </div>
                    ) : templates.length === 0 ? (
                      <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-center">
                        <p className="text-sm text-amber-300 font-medium mb-1">No hay plantillas aprobadas</p>
                        <p className="text-xs text-[var(--text-muted)]">Esta función requiere una línea con Cloud API de Meta activa y plantillas aprobadas en Facebook Business.</p>
                        <button onClick={fetchTemplates} className="mt-2 text-xs text-[var(--accent-primary)] hover:underline flex items-center gap-1 mx-auto">
                          <RefreshCw className="w-3 h-3" /> Recargar plantillas
                        </button>
                      </div>
                    ) : (
                      <div className="relative">
                        {/* Trigger button */}
                        <button onClick={() => setShowTemplateList(!showTemplateList)}
                          className="w-full flex items-center justify-between p-3 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-xl hover:border-[var(--accent-primary)]/50 transition-all">
                          {selectedTemplate ? (
                            <div className="text-left">
                              <p className="text-sm font-semibold text-white">{selectedTemplate.name}</p>
                              <p className="text-xs text-[var(--text-muted)]">{selectedTemplate.category} · {selectedTemplate.language}</p>
                            </div>
                          ) : (
                            <span className="text-sm text-[var(--text-muted)]">Selecciona una plantilla...</span>
                          )}
                          <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${showTemplateList ? 'rotate-180' : ''}`} />
                        </button>

                        {/* Dropdown */}
                        {showTemplateList && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl overflow-hidden z-10 shadow-xl">
                            {/* Search */}
                            <div className="p-2 border-b border-[var(--border-primary)]">
                              <input
                                type="text" value={templateSearch} onChange={e => setTemplateSearch(e.target.value)}
                                placeholder="Buscar plantilla..." autoFocus
                                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--accent-primary)]"
                              />
                            </div>
                            {/* List */}
                            <div className="max-h-48 overflow-y-auto">
                              {filteredTemplates.length === 0 ? (
                                <p className="text-sm text-[var(--text-muted)] text-center py-4">Sin resultados</p>
                              ) : filteredTemplates.map(tpl => (
                                <button key={tpl.id || tpl.name} onClick={() => selectTemplate(tpl)}
                                  className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-all text-left border-b border-[var(--border-primary)] last:border-0">
                                  <div>
                                    <p className="text-sm font-medium text-white">{tpl.name}</p>
                                    <p className="text-xs text-[var(--text-muted)]">{tpl.category} · {tpl.language}</p>
                                    {tpl.components?.find((c: any) => c.type === 'BUTTONS')?.buttons?.length > 0 && (
                                      <span className="text-[10px] text-blue-400 font-medium">
                                        🔘 {tpl.components.find((c: any) => c.type === 'BUTTONS').buttons.length} botón(es)
                                      </span>
                                    )}
                                  </div>
                                  <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Variables de la plantilla */}
                  {selectedTemplate && templateVariables.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-[var(--text-muted)] block">
                        Variables de la plantilla
                      </label>
                      <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl mb-2">
                        <p className="text-xs text-blue-300 flex items-start gap-1.5">
                          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                          Ingresa el valor para cada variable. Si usas Excel, puedes poner <code className="bg-blue-900/40 px-1 rounded">{'{{nombre}}'}</code> para usar el nombre de cada contacto.
                        </p>
                      </div>
                      {templateVariables.map((v, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs font-mono bg-[var(--bg-tertiary)] border border-[var(--border-primary)] px-2 py-1.5 rounded-lg text-[var(--accent-primary)] flex-shrink-0">
                            {`{{${i + 1}}}`}
                          </span>
                          <input
                            type="text" value={v}
                            onChange={e => { const vars = [...templateVariables]; vars[i] = e.target.value; setTemplateVariables(vars); }}
                            placeholder={`Variable ${i + 1} (ej: nombre del cliente)`}
                            className="flex-1 bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--accent-primary)] transition-colors"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Preview de la plantilla */}
                  {selectedTemplate && selectedTemplate.components?.length > 0 && (
                    <TemplatePreview template={selectedTemplate} variables={templateVariables} />
                  )}

                  {selectedTemplate && (!selectedTemplate.components || selectedTemplate.components.length === 0) && (
                    <div className="p-3 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-xl">
                      <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5" />
                        Plantilla seleccionada: <strong className="text-white">{selectedTemplate.name}</strong>. La vista previa no está disponible para esta plantilla.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ── FECHA Y HORA ── */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-semibold text-[var(--text-muted)] mb-1.5 block">Fecha</label>
                  <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)}
                    className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)] [color-scheme:dark]" />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--text-muted)] mb-1.5 block">Hora</label>
                  <input type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)}
                    className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)] [color-scheme:dark]" />
                </div>
              </div>

              {targetType === 'bulk_excel' && excelValid > 0 && (
                <div className="p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                  <p className="text-sm font-semibold text-white mb-2">⏱️ Estimación de envío</p>
                  <div className="space-y-1 text-xs text-[var(--text-muted)]">
                    <p>• Delay entre mensajes: 8–18 segundos</p>
                    <p>• Pausa cada 10 mensajes: 30–60 segundos</p>
                    <p>• Tiempo estimado: <span className="text-white font-medium">~{Math.ceil((excelValid*13+Math.floor(excelValid/10)*45)/60)} min</span></p>
                    {useTemplate && <p className="text-blue-400">⚡ Las plantillas tienen mayor tasa de entrega</p>}
                  </div>
                </div>
              )}

              {/* ── RECURRENCIA ── */}
              <div>
                <label className="text-sm font-semibold text-[var(--text-muted)] mb-2 block">Repetir</label>
                <div className="grid grid-cols-4 gap-2">
                  {RECURRENCE_OPTIONS.map(r => (
                    <button key={r.id} onClick={() => setRecurrence(r.id)}
                      className={`p-2 rounded-xl border text-center transition-all ${recurrence===r.id?'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10':'border-[var(--border-primary)] hover:border-white/20'}`}>
                      <span className="text-base">{r.icon}</span>
                      <p className="text-xs font-medium text-white mt-0.5">{r.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              {recurrence === 'weekly' && (
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-1.5 block">Días de la semana</label>
                  <div className="flex gap-1">
                    {DAYS_OF_WEEK.map(d => (
                      <button key={d.id} onClick={() => toggleDay(d.id)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${recurrenceDays.includes(d.id)?'bg-[var(--accent-primary)] text-white':'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border border-[var(--border-primary)]'}`}>
                        {d.short}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {recurrence !== 'once' && (
                <div>
                  <label className="text-sm font-semibold text-[var(--text-muted)] mb-1.5 block">Repetir hasta (opcional)</label>
                  <input type="date" value={recurrenceEnd} onChange={e => setRecurrenceEnd(e.target.value)}
                    className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)] [color-scheme:dark]" />
                  {!recurrenceEnd && <p className="text-xs text-amber-400 mt-1">Sin fecha fin = se repite indefinidamente</p>}
                </div>
              )}

            </div>

            {/* Footer */}
            <div className="p-4 border-t border-[var(--border-primary)] flex gap-2 flex-shrink-0">
              <button onClick={() => !saving && setShowModal(false)} className="btn-secondary flex-1 py-2.5" disabled={saving}>
                Cancelar
              </button>
              <button onClick={handleSave} disabled={!canSave}
                className="btn-primary flex-1 py-2.5 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <Loader className="w-4 h-4 animate-spin" /> : useTemplate ? <Zap className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                {saving ? 'Guardando...' : editing ? 'Guardar cambios' : (
                  targetType === 'bulk_excel' && excelValid > 0
                    ? `Programar a ${excelValid} contactos${useTemplate ? ' · plantilla' : ''}`
                    : useTemplate ? 'Programar plantilla' : 'Programar envío'
                )}
              </button>
            </div>

          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

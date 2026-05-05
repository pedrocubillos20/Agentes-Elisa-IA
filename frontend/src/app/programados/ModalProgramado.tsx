'use client';

import { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Send, Loader, Info, Download, Upload, FileText, Trash2,
  Eye, EyeOff, ArrowUpFromLine, Image, Mic, Paperclip,
  User, Users, LayoutGrid, MessageSquare, CheckCircle,
} from 'lucide-react';

const TARGET_TYPES = [
  { id: 'contact',    label: 'Contacto',      icon: User,             desc: 'Un número específico' },
  { id: 'group',      label: 'Grupo',          icon: Users,            desc: 'Grupo de WhatsApp' },
  { id: 'stage',      label: 'Etapa embudo',   icon: LayoutGrid,       desc: 'Todos en una etapa' },
  { id: 'clients',    label: 'Clientes CRM',   icon: MessageSquare,    desc: 'Contactos del CRM' },
  { id: 'bulk_excel', label: 'Importar Excel', icon: ArrowUpFromLine,  desc: 'Subir lista .xlsx' },
];

const RECURRENCE_OPTIONS = [
  { id: 'once',    label: 'Una vez',  icon: '📅' },
  { id: 'daily',   label: 'Diario',   icon: '🔄' },
  { id: 'weekly',  label: 'Semanal',  icon: '📆' },
  { id: 'monthly', label: 'Mensual',  icon: '🗓️' },
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

interface ModalProgramadoProps {
  editing: any;
  saving: boolean;
  targetType: string;
  targetId: string;
  targetName: string;
  message: string;
  scheduledDate: string;
  scheduledTime: string;
  recurrence: string;
  recurrenceDays: number[];
  recurrenceEnd: string;
  mediaFile: File | null;
  mediaPreview: string | null;
  excelContacts: any[];
  excelFileName: string;
  excelParsing: boolean;
  showExcelPreview: boolean;
  isDragging: boolean;
  excelValid: number;
  excelInvalid: number;
  conversations: any[];
  groups: any[];
  stages: any[];
  clients: any[];
  clientFilter: string;
  useTemplate: boolean;
  templates: any[];
  templatesLoading: boolean;
  selectedTemplate: any;
  templateVars: string[];
  templateSearch: string;
  showTemplateList: boolean;
  // setters
  onClose: () => void;
  onSave: () => void;
  setTargetType: (v: string) => void;
  setTargetId: (v: string) => void;
  setTargetName: (v: string) => void;
  setMessage: (v: string) => void;
  setScheduledDate: (v: string) => void;
  setScheduledTime: (v: string) => void;
  setRecurrence: (v: string) => void;
  setRecurrenceDays: (fn: any) => void;
  setRecurrenceEnd: (v: string) => void;
  setMediaFile: (v: File | null) => void;
  setMediaPreview: (v: string | null) => void;
  setExcelContacts: (v: any[]) => void;
  setExcelFileName: (v: string) => void;
  setShowExcelPreview: (fn: any) => void;
  setIsDragging: (v: boolean) => void;
  setClientFilter: (v: string) => void;
  setUseTemplate: (v: boolean) => void;
  setSelectedTemplate: (v: any) => void;
  setTemplateVars: (v: string[]) => void;
  setTemplateSearch: (v: string) => void;
  setShowTemplateList: (v: boolean) => void;
  fetchTemplates: () => void;
  selectTemplate: (tpl: any) => void;
  handleExcelInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  downloadTemplate: () => void;
}

export default function ModalProgramado(props: ModalProgramadoProps) {
  const {
    editing, saving, targetType, targetId, targetName, message,
    scheduledDate, scheduledTime, recurrence, recurrenceDays, recurrenceEnd,
    mediaFile, mediaPreview, excelContacts, excelFileName, excelParsing,
    showExcelPreview, isDragging, excelValid, excelInvalid,
    conversations, groups, stages, clients, clientFilter,
    useTemplate, templates, templatesLoading, selectedTemplate,
    templateVars, templateSearch, showTemplateList,
    onClose, onSave,
    setTargetType, setTargetId, setTargetName, setMessage,
    setScheduledDate, setScheduledTime, setRecurrence,
    setRecurrenceDays, setRecurrenceEnd, setMediaFile, setMediaPreview,
    setExcelContacts, setExcelFileName, setShowExcelPreview, setIsDragging,
    setClientFilter, setUseTemplate, setSelectedTemplate, setTemplateVars,
    setTemplateSearch, setShowTemplateList,
    fetchTemplates, selectTemplate,
    handleExcelInput, handleDrop, handleDragOver, handleDragLeave,
    handleFileSelect, downloadTemplate,
  } = props;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  const toggleDay = (dayId: number) => {
    setRecurrenceDays((prev: number[]) => {
      if (prev.includes(dayId)) return prev.filter((d: number) => d !== dayId);
      return [...prev, dayId];
    });
  };

  const isSaveDisabled = saving
    || (!message && !mediaFile)
    || !scheduledDate
    || !scheduledTime
    || (targetType !== 'bulk_excel' && !targetId)
    || (targetType === 'bulk_excel' && excelValid === 0);

  const saveBtnLabel = saving
    ? 'Guardando...'
    : editing
    ? 'Guardar cambios'
    : targetType === 'bulk_excel' && excelValid > 0
    ? ('Programar a ' + excelValid + ' contactos')
    : 'Programar envío';

  const bodyPreview = selectedTemplate
    ? (selectedTemplate.components?.find((c: any) => c.type === 'BODY')?.text?.replace(
        /\{\{(\d+)\}\}/g,
        (m: string, n: string) => {
          const val = templateVars[parseInt(n) - 1];
          return val ? ('*' + val + '*') : m;
        }
      ) || '')
    : '';

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const modalContent = (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}
      onClick={() => { if (!saving) onClose(); }}
    >
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl w-full max-w-lg max-h-[92vh] sm:max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-primary)] flex-shrink-0">
          <h3 className="font-bold text-white text-lg">
            {editing ? 'Editar Programado' : 'Nuevo Mensaje Programado'}
          </h3>
          <button onClick={() => { if (!saving) onClose(); }} className="p-1 hover:bg-white/10 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-4">

          {/* Tipo de destinatario */}
          <div>
            <label className="text-sm font-semibold text-[var(--text-muted)] mb-2 block">Enviar a</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {TARGET_TYPES.map((t) => {
                const Icon = t.icon;
                const active = targetType === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setTargetType(t.id); setTargetId(''); setTargetName(''); setExcelContacts([]); setExcelFileName(''); }}
                    className={'p-2 sm:p-2.5 rounded-xl border text-center transition-all ' + (active ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10' : 'border-[var(--border-primary)] hover:border-white/20')}
                  >
                    <Icon className={'w-4 h-4 sm:w-5 sm:h-5 mx-auto mb-0.5 sm:mb-1 ' + (active ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]')} />
                    <p className="text-[10px] sm:text-xs font-medium text-white leading-tight">{t.label}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contacto */}
          {targetType === 'contact' && (
            <div className="space-y-2">
              <label className="text-sm font-semibold text-[var(--text-muted)] mb-1 block">Contacto</label>
              <input
                type="text"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder="Ej: 573001234567"
                className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--accent-primary)] transition-colors"
              />
              {conversations.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    const c = conversations.find((c: any) => c.recipientId === e.target.value);
                    if (c) { setTargetId(c.recipientId); setTargetName(c.recipientName || c.recipientId); }
                  }}
                  className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)] transition-colors"
                >
                  <option value="">O selecciona uno existente...</option>
                  {conversations.filter((c: any) => !c.isGroup).map((c: any) => (
                    <option key={c.id} value={c.recipientId}>{c.recipientName || c.recipientId}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Grupo */}
          {targetType === 'group' && (
            <div>
              <label className="text-sm font-semibold text-[var(--text-muted)] mb-1 block">Grupo</label>
              <select
                value={targetId}
                onChange={(e) => {
                  const g = groups.find((gr: any) => gr.recipientId === e.target.value);
                  setTargetId(e.target.value);
                  if (g) setTargetName(g.groupName || g.recipientName || e.target.value);
                }}
                className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)] transition-colors"
              >
                <option value="">Selecciona un grupo...</option>
                {groups.map((g: any) => (
                  <option key={g.id} value={g.recipientId}>{g.groupName || g.recipientName || g.recipientId}</option>
                ))}
              </select>
            </div>
          )}

          {/* Etapa embudo */}
          {targetType === 'stage' && (
            <div>
              <label className="text-sm font-semibold text-[var(--text-muted)] mb-1 block">Etapa del embudo</label>
              <select
                value={targetId}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  const s = stages.find((st: any) => st.id === e.target.value);
                  setTargetName(s?.label || e.target.value);
                }}
                className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)] transition-colors"
              >
                <option value="">Selecciona una etapa...</option>
                {stages.map((s: any) => {
                  const count = conversations.filter((c: any) => c.stage === s.id).length;
                  return <option key={s.id} value={s.id}>{s.label} ({count} contactos)</option>;
                })}
              </select>
            </div>
          )}

          {/* Clientes CRM */}
          {targetType === 'clients' && (
            <div className="space-y-2">
              <label className="text-sm font-semibold text-[var(--text-muted)] mb-1 block">Clientes CRM</label>
              <div className="flex flex-wrap gap-1.5">
                {[{id:'all',label:'Todos'},{id:'active',label:'✅ Activos'},{id:'lead',label:'🔵 Leads'},{id:'vip',label:'⭐ VIP'}].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => { setClientFilter(f.id); setTargetId('clients:' + f.id); setTargetName('Clientes: ' + f.label); }}
                    className={'px-3 py-1.5 rounded-lg text-sm border transition-all ' + (clientFilter === f.id ? 'bg-[var(--accent-primary)]/20 border-[var(--accent-primary)]/50 text-white' : 'bg-white/5 border-white/10 text-[var(--text-muted)] hover:text-white')}
                  >
                    {f.label} ({clients.filter((c: any) => f.id === 'all' ? true : c.status === f.id).length})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Excel Import */}
          {targetType === 'bulk_excel' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-[var(--text-muted)]">Importar desde Excel</label>
                <button onClick={downloadTemplate} className="flex items-center gap-1 text-sm text-[var(--accent-primary)] hover:underline">
                  <Download className="w-3 h-3" /> Descargar plantilla
                </button>
              </div>

              {excelContacts.length === 0 && (
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => excelInputRef.current?.click()}
                  className={'border-2 border-dashed rounded-xl p-4 sm:p-6 text-center cursor-pointer transition-all ' + (isDragging ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5' : 'border-[var(--border-primary)] hover:border-[var(--accent-primary)]/50')}
                >
                  {excelParsing ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="loading-spinner w-8 h-8" />
                      <p className="text-sm text-[var(--text-muted)]">Procesando archivo...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                        <ArrowUpFromLine className="w-6 h-6 text-green-400" />
                      </div>
                      <div>
                        <p className="text-base font-semibold text-white">Arrastra tu Excel aquí</p>
                        <p className="text-sm text-[var(--text-muted)] mt-1">o haz clic para seleccionar · .xlsx .xls .csv</p>
                      </div>
                      <div className="mt-1 p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-left">
                        <p className="text-xs text-blue-400 font-medium mb-1">Columnas reconocidas automáticamente:</p>
                        <p className="text-xs text-[var(--text-muted)]"><span className="text-white">Teléfono:</span> telefono, phone, celular, movil...</p>
                        <p className="text-xs text-[var(--text-muted)]"><span className="text-white">Nombre:</span> nombre, name, cliente...</p>
                      </div>
                    </div>
                  )}
                  <input ref={excelInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelInput} className="hidden" />
                </div>
              )}

              {excelContacts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                    <div className="flex items-center gap-3">
                      <div className="text-center">
                        <p className="text-lg font-bold text-white">{excelContacts.length}</p>
                        <p className="text-xs text-[var(--text-muted)]">Total</p>
                      </div>
                      <div className="w-px h-8 bg-[var(--border-primary)]" />
                      <div className="text-center">
                        <p className="text-lg font-bold text-emerald-400">{excelValid}</p>
                        <p className="text-xs text-[var(--text-muted)]">Válidos</p>
                      </div>
                      {excelInvalid > 0 && (
                        <>
                          <div className="w-px h-8 bg-[var(--border-primary)]" />
                          <div className="text-center">
                            <p className="text-lg font-bold text-amber-400">{excelInvalid}</p>
                            <p className="text-xs text-[var(--text-muted)]">Inválidos</p>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setShowExcelPreview((p: boolean) => !p)} className="p-1.5 hover:bg-white/10 rounded-lg">
                        {showExcelPreview ? <EyeOff className="w-3.5 h-3.5 text-[var(--text-muted)]" /> : <Eye className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
                      </button>
                      <button onClick={() => { setExcelContacts([]); setExcelFileName(''); if (excelInputRef.current) excelInputRef.current.value = ''; }} className="p-1.5 hover:bg-red-500/10 rounded-lg">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </div>

                  {excelFileName && (
                    <p className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                      <FileText className="w-3 h-3" /> {excelFileName}
                    </p>
                  )}

                  <div className="w-full h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: (excelContacts.length > 0 ? (excelValid / excelContacts.length) * 100 : 0) + '%' }} />
                  </div>

                  {showExcelPreview && (
                    <div className="rounded-xl border border-[var(--border-primary)] overflow-hidden">
                      <div className="grid grid-cols-[auto_1fr_1fr] text-xs font-semibold text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-3 py-2 gap-3">
                        <span>#</span><span>Nombre</span><span>Teléfono</span>
                      </div>
                      <div className="max-h-40 overflow-y-auto divide-y divide-[var(--border-primary)]">
                        {excelContacts.slice(0, 50).map((c: any, i: number) => (
                          <div key={i} className={'grid grid-cols-[auto_1fr_1fr] text-xs px-3 py-1.5 gap-3 items-center ' + (c.valid ? '' : 'bg-amber-500/5')}>
                            <span className="text-[var(--text-muted)]">{i + 1}</span>
                            <span className="text-white truncate">{c.name || <span className="text-[var(--text-muted)] italic">Sin nombre</span>}</span>
                            <span className={'font-mono ' + (c.valid ? 'text-emerald-400' : 'text-amber-400')}>
                              {c.phone || c.raw} {!c.valid && '⚠️'}
                            </span>
                          </div>
                        ))}
                        {excelContacts.length > 50 && (
                          <div className="px-3 py-2 text-xs text-[var(--text-muted)] text-center">
                            ... y {excelContacts.length - 50} contactos más
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {excelInvalid > 0 && (
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <Info className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-300">
                        {excelInvalid} contacto{excelInvalid > 1 ? 's' : ''} con número inválido serán ignorados. Solo se enviarán los {excelValid} válidos.
                      </p>
                    </div>
                  )}

                  <button
                    onClick={() => { setExcelContacts([]); setExcelFileName(''); if (excelInputRef.current) excelInputRef.current.value = ''; }}
                    className="text-xs text-[var(--accent-primary)] hover:underline flex items-center gap-1"
                  >
                    <Upload className="w-3 h-3" /> Cambiar archivo
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tipo de contenido */}
          <div>
            <div className="mb-3">
              <label className="text-sm font-semibold text-[var(--text-muted)] mb-2 block">Tipo de contenido</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setUseTemplate(false)}
                  className={'p-3 rounded-xl border text-left transition-all ' + (!useTemplate ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10' : 'border-[var(--border-primary)] hover:border-white/20')}
                >
                  <span className="text-sm">💬</span>
                  <p className="text-xs font-semibold text-white mt-1">Mensaje libre</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Texto + imagen personalizada</p>
                </button>
                <button
                  onClick={() => { setUseTemplate(true); if (templates.length === 0) fetchTemplates(); }}
                  className={'p-3 rounded-xl border text-left transition-all ' + (useTemplate ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10' : 'border-[var(--border-primary)] hover:border-white/20')}
                >
                  <span className="text-sm">⚡</span>
                  <p className="text-xs font-semibold text-white mt-1">Plantilla aprobada</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Facebook Business + botones</p>
                </button>
              </div>
            </div>

            {/* Plantillas */}
            {useTemplate && (
              <div className="space-y-3 mb-3">
                {templatesLoading ? (
                  <div className="flex items-center gap-2 p-3 bg-[var(--bg-tertiary)] rounded-xl border border-[var(--border-primary)]">
                    <div className="loading-spinner w-4 h-4" />
                    <span className="text-sm text-[var(--text-muted)]">Cargando plantillas...</span>
                  </div>
                ) : templates.length === 0 ? (
                  <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                    <p className="text-sm text-amber-300 font-medium mb-1">No hay plantillas aprobadas</p>
                    <p className="text-xs text-[var(--text-muted)]">Verifica que tu línea Cloud API (The Four) tenga el WABA ID configurado y plantillas con estado <strong>APPROVED</strong> en Meta Business Manager.</p>
                    <p className="text-xs text-amber-400 mt-1">💡 El WABA ID lo encuentras en Meta Business → Configuración → Cuentas de WhatsApp</p>
                    <button onClick={fetchTemplates} className="mt-2 text-xs text-[var(--accent-primary)] hover:underline">↻ Recargar</button>
                  </div>
                ) : (
                  <div>
                    <label className="text-sm font-semibold text-[var(--text-muted)] mb-1.5 block">Plantilla aprobada</label>
                    <div className="relative">
                      <button
                        onClick={() => setShowTemplateList(!showTemplateList)}
                        className="w-full flex items-center justify-between p-3 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-xl hover:border-[var(--accent-primary)]/50 transition-all"
                      >
                        {selectedTemplate ? (
                          <div className="text-left">
                            <p className="text-sm font-semibold text-white">{selectedTemplate.name}</p>
                            <p className="text-xs text-[var(--text-muted)]">{selectedTemplate.category} · {selectedTemplate.language}</p>
                          </div>
                        ) : <span className="text-sm text-[var(--text-muted)]">Selecciona una plantilla...</span>}
                        <span className="text-[var(--text-muted)]">{showTemplateList ? '▲' : '▼'}</span>
                      </button>
                      {showTemplateList && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl overflow-hidden z-20 shadow-xl">
                          <div className="p-2 border-b border-[var(--border-primary)]">
                            <input
                              type="text"
                              value={templateSearch}
                              onChange={(e) => setTemplateSearch(e.target.value)}
                              placeholder="Buscar plantilla..."
                              autoFocus
                              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--accent-primary)]"
                            />
                          </div>
                          <div className="max-h-44 overflow-y-auto">
                            {templates
                              .filter((t: any) => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase()))
                              .map((tpl: any) => (
                                <button
                                  key={tpl.id || tpl.name}
                                  onClick={() => selectTemplate(tpl)}
                                  className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-all text-left border-b border-[var(--border-primary)] last:border-0"
                                >
                                  <div>
                                    <p className="text-sm font-medium text-white">{tpl.name}</p>
                                    <p className="text-xs text-[var(--text-muted)]">{tpl.category} · {tpl.language}</p>
                                  </div>
                                  <span className="text-[var(--text-muted)] text-xs">›</span>
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {selectedTemplate && (
                      <div className="mt-3 rounded-xl overflow-hidden border border-[var(--border-primary)] bg-[#0b141a]">
                        <div className="p-3 bg-[#1a272f]">
                          <p className="text-xs text-[var(--text-muted)] mb-2">👁️ Vista previa</p>
                          <div className="bg-[#202c33] rounded-xl p-3 max-w-[90%] ml-auto">
                            {selectedTemplate.components?.find((c: any) => c.type === 'HEADER')?.format === 'TEXT' && (
                              <p className="font-bold text-white text-sm mb-1">{selectedTemplate.components.find((c: any) => c.type === 'HEADER').text}</p>
                            )}
                            {selectedTemplate.components?.find((c: any) => c.type === 'HEADER')?.format === 'IMAGE' && (
                              <div className="w-full h-16 bg-white/10 rounded-lg flex items-center justify-center mb-1"><span>🖼️</span></div>
                            )}
                            {selectedTemplate.components?.find((c: any) => c.type === 'HEADER')?.format === 'VIDEO' && (
                              <div className="w-full h-16 bg-white/10 rounded-lg flex items-center justify-center mb-1"><span>▶️</span></div>
                            )}
                            <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">{bodyPreview}</p>
                            {selectedTemplate.components?.find((c: any) => c.type === 'FOOTER') && (
                              <p className="text-xs text-gray-400 mt-1">{selectedTemplate.components.find((c: any) => c.type === 'FOOTER').text}</p>
                            )}
                            <p className="text-[10px] text-gray-500 text-right mt-1">✓✓</p>
                          </div>
                          {selectedTemplate.components?.find((c: any) => c.type === 'BUTTONS')?.buttons?.map((btn: any, i: number) => (
                            <div key={i} className="mt-1 bg-[#202c33] rounded-lg py-2 px-3 text-center max-w-[90%] ml-auto">
                              <span className="text-[#53bdeb] text-sm">{btn.type === 'URL' ? '🔗 ' : btn.type === 'PHONE_NUMBER' ? '📞 ' : ''}{btn.text}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedTemplate && templateVars.length > 0 && (
                      <div className="space-y-2 mt-2">
                        <label className="text-sm font-semibold text-[var(--text-muted)] block">Variables de la plantilla</label>
                        <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                          <p className="text-xs text-blue-300">ℹ️ Para envíos masivos usa {'{{nombre}}'} para personalizar.</p>
                        </div>
                        {templateVars.map((v: string, i: number) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-xs font-mono bg-[var(--bg-tertiary)] border border-[var(--border-primary)] px-2 py-1.5 rounded-lg text-[var(--accent-primary)] flex-shrink-0">{('{{' + (i + 1) + '}}')}</span>
                            <input
                              type="text"
                              value={v}
                              onChange={(e) => {
                                const v2 = [...templateVars];
                                v2[i] = e.target.value;
                                setTemplateVars(v2);
                              }}
                              placeholder={'Variable ' + (i + 1)}
                              className="flex-1 bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--accent-primary)]"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Mensaje libre */}
            {!useTemplate && (
              <div>
                <label className="text-sm font-semibold text-[var(--text-muted)] mb-1.5 block">Mensaje</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Escribe tu mensaje..."
                  className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--accent-primary)] transition-colors min-h-[80px] resize-none"
                />
                {targetType === 'bulk_excel' && (
                  <p className="text-xs text-[var(--text-muted)] mt-1 flex items-center gap-1">
                    <Info className="w-3 h-3" /> Puedes personalizar con variables si tu lista incluye nombres
                  </p>
                )}
              </div>
            )}

            {/* Media */}
            {!useTemplate && (
              <div>
                <label className="text-sm font-semibold text-[var(--text-muted)] mb-1.5 block">Adjunto (opcional)</label>
                <input ref={fileInputRef} type="file" accept="image/*,audio/*,video/*,application/pdf,.doc,.docx" onChange={handleFileSelect} className="hidden" />
                {mediaFile ? (
                  <div className="flex items-center gap-3 p-2.5 bg-[var(--bg-tertiary)] rounded-xl border border-[var(--border-primary)]">
                    {mediaPreview
                      ? <img src={mediaPreview} alt="" className="w-10 h-10 rounded-lg object-cover" />
                      : <div className="w-10 h-10 rounded-lg bg-[var(--accent-primary)]/20 flex items-center justify-center"><FileText className="w-5 h-5 text-[var(--accent-primary)]" /></div>
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white truncate">{mediaFile.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{(mediaFile.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <button onClick={() => { setMediaFile(null); setMediaPreview(null); }} className="p-1 hover:bg-white/10 rounded">
                      <X className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {([{label:'Imagen',icon:Image,accept:'image/*'},{label:'Audio',icon:Mic,accept:'audio/*'},{label:'Archivo',icon:Paperclip,accept:'*/*'}] as any[]).map(({label, icon: Icon, accept}) => (
                      <button
                        key={label}
                        onClick={() => { if (fileInputRef.current) { fileInputRef.current.accept = accept; fileInputRef.current.click(); } }}
                        className="flex items-center gap-1.5 px-3 py-2 bg-[var(--bg-tertiary)] rounded-lg text-sm text-[var(--text-muted)] hover:text-white border border-[var(--border-primary)] transition-all"
                      >
                        <Icon className="w-3.5 h-3.5" /> {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fecha y Hora */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold text-[var(--text-muted)] mb-1.5 block">Fecha</label>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)] transition-colors" style={{colorScheme:'dark'}} />
            </div>
            <div>
              <label className="text-sm font-semibold text-[var(--text-muted)] mb-1.5 block">Hora</label>
              <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)] transition-colors" style={{colorScheme:'dark'}} />
            </div>
          </div>

          {/* Info anti-bloqueo */}
          {targetType === 'bulk_excel' && excelValid > 0 && (
            <div className="p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
              <p className="text-sm font-semibold text-white mb-2">⏱️ Estimación de envío</p>
              <div className="space-y-1 text-xs text-[var(--text-muted)]">
                <p>• Delay entre mensajes: 8–18 segundos (anti-bloqueo)</p>
                <p>• Pausa cada 10 mensajes: 30–60 segundos</p>
                <p>• Tiempo estimado total: <span className="text-white font-medium">~{Math.ceil((excelValid * 13 + Math.floor(excelValid / 10) * 45) / 60)} minutos</span></p>
                <p className="text-emerald-400">✓ Variación de texto automática para evitar spam</p>
              </div>
            </div>
          )}

          {/* Recurrencia */}
          <div>
            <label className="text-sm font-semibold text-[var(--text-muted)] mb-2 block">Repetir</label>
            <div className="grid grid-cols-4 gap-2">
              {RECURRENCE_OPTIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRecurrence(r.id)}
                  className={'p-2 rounded-xl border text-center transition-all ' + (recurrence === r.id ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10' : 'border-[var(--border-primary)] hover:border-white/20')}
                >
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
                {DAYS_OF_WEEK.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => toggleDay(d.id)}
                    className={'flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ' + (recurrenceDays.includes(d.id) ? 'bg-[var(--accent-primary)] text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border border-[var(--border-primary)]')}
                  >
                    {d.short}
                  </button>
                ))}
              </div>
            </div>
          )}

          {recurrence !== 'once' && (
            <div>
              <label className="text-sm font-semibold text-[var(--text-muted)] mb-1.5 block">Repetir hasta (opcional)</label>
              <input type="date" value={recurrenceEnd} onChange={(e) => setRecurrenceEnd(e.target.value)} className="w-full bg-[#1a1a2e] border border-[var(--border-primary)] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)] transition-colors" style={{colorScheme:'dark'}} />
              {!recurrenceEnd && <p className="text-xs text-amber-400 mt-1">Sin fecha fin = se repite indefinidamente</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border-primary)] flex gap-2 flex-shrink-0">
          <button onClick={() => { if (!saving) onClose(); }} className="btn-secondary flex-1 py-2.5 text-base" disabled={saving}>
            Cancelar
          </button>
          <button onClick={onSave} disabled={isSaveDisabled} className="btn-primary flex-1 py-2.5 text-base disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {saveBtnLabel}
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}

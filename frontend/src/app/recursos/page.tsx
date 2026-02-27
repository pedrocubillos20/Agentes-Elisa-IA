'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  Calendar, Clock, Plus, Trash2, Edit3, Save, X, CheckCircle,
  XCircle, Users, Settings, ChevronLeft, ChevronRight, Loader2,
  AlertTriangle, RefreshCw, LayoutGrid, Armchair, Car, Scissors,
  UtensilsCrossed, Building, Dumbbell, Briefcase, Heart, Wrench
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════
interface Resource {
  id: string; name: string; type: string; capacity: number;
  isActive: boolean; order: number; notes: string | null;
}

interface DaySchedule {
  id?: string; dayOfWeek: number; isOpen: boolean;
  startTime: string; endTime: string; slotDuration: number;
  breakStart: string | null; breakEnd: string | null;
}

interface SlotInfo {
  time: string; totalCapacity: number; occupied: number;
  free: number; available: boolean;
  resources?: { id: string; name: string; available: boolean; occupant: any }[];
}

interface AvailabilityData {
  date: string; dayName: string; isOpen: boolean;
  schedule: { start: string; end: string; slotDuration: number };
  resources: { id: string; name: string; type: string }[];
  totalSlots: number; availableSlots: number; occupiedSlots: number;
  slots: SlotInfo[];
}

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const RESOURCE_TYPES: Record<string, { label: string; icon: any; examples: string }> = {
  module: { label: 'Módulo / Puesto', icon: Wrench, examples: 'CDA, taller, inspección' },
  table: { label: 'Mesa', icon: UtensilsCrossed, examples: 'Restaurante, bar, café' },
  chair: { label: 'Silla / Estación', icon: Scissors, examples: 'Barbería, salón de belleza' },
  room: { label: 'Sala / Consultorio', icon: Building, examples: 'Clínica, consultorio, oficina' },
  vehicle: { label: 'Vehículo / Bahía', icon: Car, examples: 'CDA, lavadero, taller automotriz' },
  court: { label: 'Cancha / Espacio', icon: Dumbbell, examples: 'Gimnasio, club, canchas' },
  bed: { label: 'Cama / Camilla', icon: Heart, examples: 'Spa, masajes, estética' },
  office: { label: 'Oficina / Espacio', icon: Briefcase, examples: 'Coworking, asesorías' },
  generic: { label: 'Genérico', icon: LayoutGrid, examples: 'Cualquier tipo' },
};

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════
export default function RecursosPage() {
  const [tab, setTab] = useState<'resources' | 'schedule' | 'availability'>('availability');
  const [resources, setResources] = useState<Resource[]>([]);
  const [schedule, setSchedule] = useState<DaySchedule[]>([]);
  const [availability, setAvailability] = useState<AvailabilityData | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddResource, setShowAddResource] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [newResource, setNewResource] = useState({ name: '', type: 'generic', capacity: 1, notes: '' });
  const [error, setError] = useState('');

  const headers = useCallback(() => ({
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json'
  }), []);

  // ═══ LOAD DATA ═══
  const loadResources = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/resources`, { headers: headers() });
      if (res.ok) { const data = await res.json(); setResources(data.resources || []); }
    } catch (e) { console.error(e); }
  }, [headers]);

  const loadSchedule = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/resources/schedule`, { headers: headers() });
      if (res.ok) { const data = await res.json(); setSchedule(data.schedule || []); }
    } catch (e) { console.error(e); }
  }, [headers]);

  const loadAvailability = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/resources/availability?date=${selectedDate}`, { headers: headers() });
      if (res.ok) { const data = await res.json(); setAvailability(data); }
    } catch (e) { console.error(e); }
  }, [headers, selectedDate]);

  useEffect(() => {
    Promise.all([loadResources(), loadSchedule(), loadAvailability()]).finally(() => setLoading(false));
  }, [loadResources, loadSchedule, loadAvailability]);

  useEffect(() => { loadAvailability(); }, [selectedDate, loadAvailability]);

  // ═══ RESOURCE ACTIONS ═══
  const createResource = async () => {
    if (!newResource.name.trim()) return setError('Nombre requerido');
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/resources`, {
        method: 'POST', headers: headers(), body: JSON.stringify(newResource)
      });
      if (res.ok) {
        await loadResources(); await loadAvailability();
        setNewResource({ name: '', type: 'generic', capacity: 1, notes: '' });
        setShowAddResource(false); setError('');
      }
    } catch (e) { setError('Error creando recurso'); }
    setSaving(false);
  };

  const updateResource = async (resource: Resource) => {
    setSaving(true);
    try {
      await fetch(`${API_URL}/api/resources/${resource.id}`, {
        method: 'PUT', headers: headers(), body: JSON.stringify(resource)
      });
      await loadResources(); await loadAvailability();
      setEditingResource(null);
    } catch (e) { setError('Error actualizando'); }
    setSaving(false);
  };

  const deleteResource = async (id: string) => {
    if (!confirm('¿Eliminar este recurso?')) return;
    try {
      await fetch(`${API_URL}/api/resources/${id}`, { method: 'DELETE', headers: headers() });
      await loadResources(); await loadAvailability();
    } catch (e) { setError('Error eliminando'); }
  };

  const toggleResourceActive = async (resource: Resource) => {
    await updateResource({ ...resource, isActive: !resource.isActive });
  };

  // ═══ SCHEDULE ACTIONS ═══
  const saveSchedule = async () => {
    setSaving(true);
    try {
      await fetch(`${API_URL}/api/resources/schedule`, {
        method: 'PUT', headers: headers(), body: JSON.stringify({ schedule })
      });
      await loadAvailability();
    } catch (e) { setError('Error guardando horario'); }
    setSaving(false);
  };

  const updateDay = (dayOfWeek: number, field: string, value: any) => {
    setSchedule(prev => prev.map(d =>
      d.dayOfWeek === dayOfWeek ? { ...d, [field]: value } : d
    ));
  };

  // ═══ DATE NAVIGATION ═══
  const changeDate = (offset: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + offset);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* ═══ HEADER ═══ */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl flex items-center justify-center border border-purple-500/30">
              <Calendar className="w-5 h-5 text-purple-400" />
            </div>
            Recursos y Disponibilidad
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Configura módulos, mesas, sillas o puestos. La IA los usa para ofrecer horarios reales.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAddResource(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold rounded-xl text-sm hover:brightness-110 transition-all">
            <Plus className="w-4 h-4" /> Nuevo Recurso
          </button>
        </div>
      </div>

      {/* ═══ STATS ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
          <p className="text-2xl font-black text-white">{resources.filter(r => r.isActive).length}</p>
          <p className="text-xs text-purple-300">Recursos activos</p>
        </div>
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <p className="text-2xl font-black text-white">{availability?.availableSlots || 0}</p>
          <p className="text-xs text-emerald-300">Slots libres hoy</p>
        </div>
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <p className="text-2xl font-black text-white">{availability?.occupiedSlots || 0}</p>
          <p className="text-xs text-red-300">Slots ocupados</p>
        </div>
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
          <p className="text-2xl font-black text-white">{availability?.totalSlots || 0}</p>
          <p className="text-xs text-blue-300">Total slots/día</p>
        </div>
      </div>

      {/* ═══ TABS ═══ */}
      <div className="flex gap-2 border-b border-white/10 pb-0">
        {[
          { id: 'availability', label: '📊 Disponibilidad', icon: LayoutGrid },
          { id: 'resources', label: '🏪 Recursos', icon: Armchair },
          { id: 'schedule', label: '🕐 Horarios', icon: Clock },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-all ${
              tab === t.id 
                ? 'border-purple-400 text-purple-300 bg-purple-500/5' 
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* TAB: AVAILABILITY GRID */}
      {/* ═══════════════════════════════════════ */}
      {tab === 'availability' && (
        <div className="space-y-4">
          {/* Date picker */}
          <div className="flex items-center gap-3 justify-between">
            <button onClick={() => changeDate(-1)} className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition">
              <ChevronLeft className="w-5 h-5 text-gray-400" />
            </button>
            <div className="flex items-center gap-3">
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm" />
              <span className="text-lg font-bold text-white">{availability?.dayName || ''}</span>
              {availability && !availability.isOpen && (
                <span className="px-3 py-1 bg-red-500/20 text-red-300 rounded-full text-xs font-bold">CERRADO</span>
              )}
            </div>
            <button onClick={() => changeDate(1)} className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition">
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Quick date buttons */}
          <div className="flex gap-2 flex-wrap">
            {[0, 1, 2, 3, 4, 5, 6].map(offset => {
              const d = new Date(); d.setDate(d.getDate() + offset);
              const ds = d.toISOString().split('T')[0];
              const isSelected = ds === selectedDate;
              return (
                <button key={offset} onClick={() => setSelectedDate(ds)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    isSelected ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                  }`}>
                  {offset === 0 ? 'Hoy' : offset === 1 ? 'Mañana' : DAY_SHORT[d.getDay()]} {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* Availability grid */}
          {availability && availability.isOpen ? (
            <div className="rounded-2xl border border-white/10 overflow-hidden">
              {/* Header row with resource names */}
              {availability.resources.length > 0 && (
                <div className="grid gap-0 bg-white/5 border-b border-white/10"
                  style={{ gridTemplateColumns: `80px repeat(${availability.resources.length}, 1fr)` }}>
                  <div className="p-3 text-xs font-bold text-gray-500 border-r border-white/10">Hora</div>
                  {availability.resources.map(r => {
                    const TypeIcon = RESOURCE_TYPES[r.type]?.icon || LayoutGrid;
                    return (
                      <div key={r.id} className="p-3 text-center border-r border-white/5 last:border-r-0">
                        <TypeIcon className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                        <p className="text-xs font-bold text-white truncate">{r.name}</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Slot rows */}
              <div className="max-h-[500px] overflow-y-auto">
                {availability.slots.map((slot, idx) => (
                  <div key={slot.time}
                    className={`grid gap-0 border-b border-white/5 last:border-b-0 transition ${
                      slot.available ? 'hover:bg-emerald-500/5' : 'bg-red-500/5'
                    }`}
                    style={{ gridTemplateColumns: availability.resources.length > 0 
                      ? `80px repeat(${availability.resources.length}, 1fr)` 
                      : `80px 1fr` 
                    }}>
                    {/* Time */}
                    <div className="p-3 border-r border-white/10 flex items-center">
                      <span className="text-sm font-mono font-bold text-gray-300">{slot.time}</span>
                    </div>

                    {/* Per-resource cells */}
                    {availability.resources.length > 0 ? (
                      slot.resources?.map(r => (
                        <div key={r.id} className={`p-3 border-r border-white/5 last:border-r-0 flex items-center justify-center ${
                          r.available ? 'bg-emerald-500/5' : 'bg-red-500/10'
                        }`}>
                          {r.available ? (
                            <div className="flex items-center gap-1.5">
                              <CheckCircle className="w-4 h-4 text-emerald-400" />
                              <span className="text-xs text-emerald-300 font-medium">Libre</span>
                            </div>
                          ) : (
                            <div className="text-center">
                              <div className="flex items-center gap-1.5">
                                <XCircle className="w-4 h-4 text-red-400" />
                                <span className="text-xs text-red-300 font-medium">Ocupado</span>
                              </div>
                              {r.occupant && (
                                <p className="text-[10px] text-gray-500 mt-0.5 truncate max-w-[120px]">
                                  {r.occupant.name}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className={`p-3 flex items-center gap-2 ${slot.available ? 'bg-emerald-500/5' : 'bg-red-500/10'}`}>
                        {slot.available ? (
                          <>
                            <CheckCircle className="w-4 h-4 text-emerald-400" />
                            <span className="text-sm text-emerald-300">Disponible ({slot.free} libre{slot.free > 1 ? 's' : ''})</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-4 h-4 text-red-400" />
                            <span className="text-sm text-red-300">Lleno</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : availability && !availability.isOpen ? (
            <div className="text-center py-16">
              <XCircle className="w-16 h-16 text-red-400/30 mx-auto mb-4" />
              <p className="text-lg font-bold text-white">Cerrado este día</p>
              <p className="text-sm text-gray-500 mt-1">Configura los horarios en la pestaña "🕐 Horarios"</p>
            </div>
          ) : (
            <div className="text-center py-16">
              <AlertTriangle className="w-16 h-16 text-amber-400/30 mx-auto mb-4" />
              <p className="text-lg font-bold text-white">Configura horarios primero</p>
              <p className="text-sm text-gray-500 mt-1">Ve a la pestaña "🕐 Horarios" para definir tu horario de atención</p>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* TAB: RESOURCES */}
      {/* ═══════════════════════════════════════ */}
      {tab === 'resources' && (
        <div className="space-y-4">
          {/* Add Resource Form */}
          {showAddResource && (
            <div className="rounded-2xl border border-purple-500/30 bg-purple-500/5 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Nuevo Recurso</h3>
                <button onClick={() => setShowAddResource(false)}><X className="w-5 h-5 text-gray-500" /></button>
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Tipo de recurso</label>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                  {Object.entries(RESOURCE_TYPES).map(([key, val]) => {
                    const Icon = val.icon;
                    return (
                      <button key={key} onClick={() => setNewResource({ ...newResource, type: key })}
                        className={`p-3 rounded-xl border text-center transition ${
                          newResource.type === key
                            ? 'bg-purple-500/20 border-purple-500/50 text-purple-300'
                            : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                        }`}>
                        <Icon className="w-5 h-5 mx-auto mb-1" />
                        <p className="text-[10px] font-semibold">{val.label}</p>
                        <p className="text-[8px] text-gray-600 mt-0.5">{val.examples}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Nombre *</label>
                  <input value={newResource.name} onChange={(e) => setNewResource({ ...newResource, name: e.target.value })}
                    placeholder="Ej: Módulo 1, Mesa 3, Silla Ana"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Capacidad (personas)</label>
                  <input type="number" min={1} value={newResource.capacity}
                    onChange={(e) => setNewResource({ ...newResource, capacity: parseInt(e.target.value) || 1 })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Notas (opcional)</label>
                  <input value={newResource.notes} onChange={(e) => setNewResource({ ...newResource, notes: e.target.value })}
                    placeholder="Ej: Con aire acondicionado"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600" />
                </div>
              </div>

              <button onClick={createResource} disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold rounded-xl text-sm hover:brightness-110 transition-all disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Crear Recurso
              </button>
            </div>
          )}

          {/* Resources list */}
          {resources.length === 0 ? (
            <div className="text-center py-16">
              <Armchair className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <p className="text-lg font-bold text-white">No tienes recursos configurados</p>
              <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
                Agrega módulos, mesas, sillas, salas o puestos según tu negocio. 
                La IA los usará para ofrecer solo horarios realmente disponibles.
              </p>
              <button onClick={() => setShowAddResource(true)}
                className="mt-4 inline-flex items-center gap-2 px-6 py-3 bg-purple-500/20 border border-purple-500/30 text-purple-300 rounded-xl text-sm font-semibold hover:bg-purple-500/30 transition">
                <Plus className="w-4 h-4" /> Agregar primer recurso
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {resources.map(r => {
                const TypeIcon = RESOURCE_TYPES[r.type]?.icon || LayoutGrid;
                const typeLabel = RESOURCE_TYPES[r.type]?.label || 'Recurso';
                const isEditing = editingResource?.id === r.id;

                return (
                  <div key={r.id} className={`rounded-xl border p-4 transition ${
                    r.isActive ? 'bg-white/[0.04] border-white/10' : 'bg-white/[0.02] border-white/5 opacity-60'
                  }`}>
                    {isEditing ? (
                      <div className="space-y-3">
                        <input value={editingResource!.name} onChange={(e) => setEditingResource({ ...editingResource!, name: e.target.value })}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
                        <input type="number" min={1} value={editingResource!.capacity}
                          onChange={(e) => setEditingResource({ ...editingResource!, capacity: parseInt(e.target.value) || 1 })}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
                        <div className="flex gap-2">
                          <button onClick={() => updateResource(editingResource!)}
                            className="flex-1 flex items-center justify-center gap-1 py-2 bg-emerald-500/20 text-emerald-300 rounded-lg text-xs font-bold">
                            <Save className="w-3.5 h-3.5" /> Guardar
                          </button>
                          <button onClick={() => setEditingResource(null)}
                            className="flex-1 flex items-center justify-center gap-1 py-2 bg-white/5 text-gray-400 rounded-lg text-xs">
                            <X className="w-3.5 h-3.5" /> Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3 mb-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${r.isActive ? 'bg-purple-500/20' : 'bg-white/5'}`}>
                            <TypeIcon className={`w-5 h-5 ${r.isActive ? 'text-purple-400' : 'text-gray-600'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-white truncate">{r.name}</p>
                            <p className="text-[10px] text-gray-500">{typeLabel} · {r.capacity} persona{r.capacity > 1 ? 's' : ''}</p>
                          </div>
                          <div className={`w-2.5 h-2.5 rounded-full ${r.isActive ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                        </div>
                        {r.notes && <p className="text-xs text-gray-500 mb-3">{r.notes}</p>}
                        <div className="flex gap-2">
                          <button onClick={() => toggleResourceActive(r)}
                            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${
                              r.isActive ? 'bg-amber-500/10 text-amber-300 hover:bg-amber-500/20' : 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                            }`}>
                            {r.isActive ? 'Desactivar' : 'Activar'}
                          </button>
                          <button onClick={() => setEditingResource(r)}
                            className="p-2 rounded-lg bg-white/5 text-gray-400 hover:bg-white/10 transition">
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deleteResource(r.id)}
                            className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* TAB: SCHEDULE */}
      {/* ═══════════════════════════════════════ */}
      {tab === 'schedule' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white">Horario de Atención</h3>
              <p className="text-xs text-gray-500">Define qué días y horas está abierto tu negocio</p>
            </div>
            <button onClick={saveSchedule} disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-bold rounded-xl text-sm hover:brightness-110 transition disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Guardar Horarios
            </button>
          </div>

          <div className="space-y-3">
            {schedule.map(day => (
              <div key={day.dayOfWeek}
                className={`rounded-xl border p-4 transition ${
                  day.isOpen ? 'bg-white/[0.04] border-white/10' : 'bg-white/[0.02] border-white/5 opacity-60'
                }`}>
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  {/* Day name + toggle */}
                  <div className="flex items-center gap-3 min-w-[140px]">
                    <button onClick={() => updateDay(day.dayOfWeek, 'isOpen', !day.isOpen)}
                      className={`w-10 h-6 rounded-full transition-all flex items-center ${
                        day.isOpen ? 'bg-emerald-500 justify-end' : 'bg-gray-700 justify-start'
                      }`}>
                      <div className="w-5 h-5 bg-white rounded-full shadow mx-0.5" />
                    </button>
                    <span className={`text-sm font-bold ${day.isOpen ? 'text-white' : 'text-gray-600'}`}>
                      {DAY_NAMES[day.dayOfWeek]}
                    </span>
                  </div>

                  {day.isOpen && (
                    <div className="flex flex-wrap items-center gap-3 flex-1">
                      {/* Start/End time */}
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] text-gray-500">Abre</label>
                        <input type="time" value={day.startTime}
                          onChange={(e) => updateDay(day.dayOfWeek, 'startTime', e.target.value)}
                          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm" />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] text-gray-500">Cierra</label>
                        <input type="time" value={day.endTime}
                          onChange={(e) => updateDay(day.dayOfWeek, 'endTime', e.target.value)}
                          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm" />
                      </div>

                      {/* Slot duration */}
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] text-gray-500">Turno</label>
                        <select value={day.slotDuration}
                          onChange={(e) => updateDay(day.dayOfWeek, 'slotDuration', parseInt(e.target.value))}
                          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm">
                          <option value={15}>15 min</option>
                          <option value={20}>20 min</option>
                          <option value={30}>30 min</option>
                          <option value={45}>45 min</option>
                          <option value={60}>1 hora</option>
                          <option value={90}>1.5 horas</option>
                          <option value={120}>2 horas</option>
                        </select>
                      </div>

                      {/* Break */}
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] text-gray-500">Descanso</label>
                        <input type="time" value={day.breakStart || ''}
                          onChange={(e) => updateDay(day.dayOfWeek, 'breakStart', e.target.value || null)}
                          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs w-[90px]" />
                        <span className="text-gray-600">-</span>
                        <input type="time" value={day.breakEnd || ''}
                          onChange={(e) => updateDay(day.dayOfWeek, 'breakEnd', e.target.value || null)}
                          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs w-[90px]" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ INFO BOX ═══ */}
      <div className="rounded-2xl bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
            <Settings className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white mb-1">🤖 ¿Cómo funciona con la IA?</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              La IA consulta la disponibilidad <strong className="text-white">en tiempo real</strong> antes de ofrecer horarios. 
              Si tienes 3 módulos y 2 están ocupados a las 10:00, la IA solo ofrecerá el módulo libre. 
              Al confirmar una cita o reserva, el sistema asigna automáticamente un recurso disponible. 
              <strong className="text-blue-300"> Nunca más citas duplicadas ni horarios equivocados.</strong>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect, useRef } from 'react';
import { Calendar as CalendarIcon, Clock, Plus, ChevronLeft, ChevronRight, User, Phone, MapPin, Package, Check, X, Edit2, Trash2, Filter } from 'lucide-react';
import { SoundPicker, useNotifications, formatTime12h } from '../../components/NotificationSounds';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export default function AgendaPage() {
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [user, setUser] = useState<any>(null);

  // ── FILTRO MES ──────────────────────────────────────────────────────────────
  // null = todos los meses | { month: 0-11, year: YYYY }
  const [filterMonth, setFilterMonth] = useState<{ month: number; year: number } | null>(null);
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];
  // ───────────────────────────────────────────────────────────────────────────

  const [form, setForm] = useState({
    type: 'appointment', clientName: '', clientPhone: '', date: '', time: '', duration: '30',
    notes: '', address: '', products: '', total: '', personas: '2', tipoReserva: ''
  });

  const getLineId = () => localStorage.getItem('selectedLineId') || '';

  useEffect(() => {
    try {
      const cu = localStorage.getItem('bizonne_user_cache');
      if (cu) setUser(JSON.parse(cu));
      const ca = localStorage.getItem('bizonne_agenda_cache');
      if (ca) { setAppointments(JSON.parse(ca)); setLoading(false); }
    } catch {}

    fetchAll();
    const onLineChanged = () => { setLoading(true); fetchAll(); };
    window.addEventListener('lineChanged', onLineChanged);
    const pollInterval = setInterval(() => fetchAll(), 10000);
    return () => {
      window.removeEventListener('lineChanged', onLineChanged);
      clearInterval(pollInterval);
    };
  }, []);

  const fetchAll = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/appointments?lineId=${getLineId()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const appts = (await res.json()).appointments || [];
        setAppointments(appts);
        try { localStorage.setItem('bizonne_agenda_cache', JSON.stringify(appts.slice(0, 50))); } catch {}
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  // ── Appointments filtrados por mes seleccionado ──────────────────────────
  const filteredAppointments = filterMonth
    ? appointments.filter(a => {
        const d = new Date(a.date);
        return d.getMonth() === filterMonth.month && d.getFullYear() === filterMonth.year;
      })
    : appointments;
  // ────────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    const token = localStorage.getItem('token');
    const method = editingItem ? 'PUT' : 'POST';
    const url = editingItem ? `${API_URL}/api/appointments/${editingItem.id}` : `${API_URL}/api/appointments`;
    try {
      const body: any = {
        ...form,
        duration: parseInt(form.duration) || (form.type === 'reservation' ? 60 : 30),
        total: parseFloat(form.total) || null,
        products: form.products ? JSON.parse(`[${form.products}]`) : null,
        lineId: getLineId()
      };
      if (form.type === 'reservation' && !form.notes) {
        body.notes = `🏨 RESERVA\n━━━━━━━━━━━━━━━\n📋 Tipo: ${form.tipoReserva || 'Reserva'}\n👥 Personas: ${form.personas || '2'}\n${form.address ? `📍 Dirección: ${form.address}\n` : ''}━━━━━━━━━━━━━━━`;
      }
      const res = await fetch(url, {
        method,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) { fetchAll(); setShowModal(false); resetForm(); }
    } catch (error) { console.error('Error:', error); }
  };

  const handleStatusChange = async (id: string, status: string) => {
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/appointments/${id}/status`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      fetchAll();
    } catch (error) { console.error('Error:', error); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este registro?')) return;
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/appointments/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fetchAll();
    } catch (error) { console.error('Error:', error); }
  };

  const resetForm = () => {
    setForm({ type: 'appointment', clientName: '', clientPhone: '', date: '', time: '', duration: '30', notes: '', address: '', products: '', total: '', personas: '2', tipoReserva: '' });
    setEditingItem(null);
  };

  const openEdit = (apt: any) => {
    setEditingItem(apt);
    setForm({
      type: apt.type, clientName: apt.clientName, clientPhone: apt.clientPhone,
      date: apt.date?.split('T')[0] || '', time: apt.time, duration: apt.duration?.toString() || '30',
      notes: apt.notes || '', address: apt.address || '',
      products: apt.products ? JSON.stringify(apt.products).slice(1, -1) : '', total: apt.total?.toString() || '',
      personas: '2', tipoReserva: ''
    });
    setShowModal(true);
  };

  // Calendar helpers
  const getDaysInMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const getFirstDayOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();

  const getAppointmentsForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return appointments.filter(apt => apt.date?.split('T')[0] === dateStr);
  };

  const prevMonth = () => {
    const d = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1);
    setCurrentDate(d);
    setFilterMonth({ month: d.getMonth(), year: d.getFullYear() });
  };
  const nextMonth = () => {
    const d = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1);
    setCurrentDate(d);
    setFilterMonth({ month: d.getMonth(), year: d.getFullYear() });
  };

  const isToday = (date: Date) => date.toDateString() === new Date().toDateString();

  // ── Stats calculados sobre filteredAppointments ───────────────────────────
  const stats = {
    today: filteredAppointments.filter(a => a.date?.split('T')[0] === new Date().toISOString().split('T')[0]).length,
    pending: filteredAppointments.filter(a => a.status === 'pending').length,
    confirmed: filteredAppointments.filter(a => a.status === 'confirmed').length,
    completed: filteredAppointments.filter(a => a.status === 'completed').length,
    totalOrders: filteredAppointments.filter(a => a.type === 'order').reduce((sum, a) => sum + (a.total || 0), 0),
    reservations: filteredAppointments.filter(a => a.type === 'reservation').length,
    allTotal: filteredAppointments.reduce((sum, a) => sum + (a.total || 0), 0),
  };
  // ─────────────────────────────────────────────────────────────────────────

  // Selección rápida de mes
  const handleMonthSelect = (month: number, year: number) => {
    setFilterMonth({ month, year });
    const d = new Date(year, month);
    setCurrentDate(d);
  };

  const clearFilter = () => {
    setFilterMonth(null);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <img src="/bizonne.png" alt="Bizonne" className="w-16 h-16 rounded-xl animate-pulse" />
        <div className="loading-spinner" />
      </div>
    );
  }

  // Agenda disponible en Plan Starter y Business (corregido)

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(currentDate);
    const firstDay = getFirstDayOfMonth(currentDate);
    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="calendar-day other-month" />);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
      const dayAppointments = getAppointmentsForDate(date);
      const isSelected = selectedDate?.toDateString() === date.toDateString();
      days.push(
        <div
          key={day}
          onClick={() => setSelectedDate(date)}
          className={`calendar-day ${isToday(date) ? 'today' : ''} ${isSelected ? 'selected' : ''} ${dayAppointments.length > 0 ? 'has-events' : ''}`}
        >
          {day}
        </div>
      );
    }
    return days;
  };

  const selectedDateAppointments = selectedDate ? getAppointmentsForDate(selectedDate) : [];

  const filterLabel = filterMonth
    ? `${MONTHS_ES[filterMonth.month]} ${filterMonth.year}`
    : 'Todos los meses';

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/bizonne.png" alt="Bizonne" className="w-14 h-14 rounded-xl hidden md:block" />
          <div>
            <h1 className="text-3xl font-bold text-white">Agenda</h1>
            <p className="text-[var(--text-muted)]">Citas, pedidos y reservas</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SoundPicker compact />
          <button onClick={() => { resetForm(); setShowModal(true); }} className="btn-primary">
            <Plus className="w-4 h-4" />Nueva Cita/Pedido/Reserva
          </button>
        </div>
      </div>

      {/* ── FILTRO POR MES ─────────────────────────────────────────────────── */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm font-semibold">
            <Filter className="w-4 h-4 text-[var(--accent-primary)]" />
            Filtrar por mes:
          </div>

          {/* Selector de año */}
          <select
            value={filterMonth?.year ?? currentYear}
            onChange={(e) => {
              const y = Number(e.target.value);
              const m = filterMonth?.month ?? new Date().getMonth();
              handleMonthSelect(m, y);
            }}
            className="input !py-1.5 !px-3 w-28 text-sm"
          >
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          {/* Botones de meses */}
          <div className="flex flex-wrap gap-2">
            {MONTHS_ES.map((name, idx) => {
              const year = filterMonth?.year ?? currentYear;
              const isActive = filterMonth?.month === idx && filterMonth?.year === year;
              return (
                <button
                  key={idx}
                  onClick={() => isActive ? clearFilter() : handleMonthSelect(idx, year)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                    isActive
                      ? 'bg-[var(--accent-primary)] text-white border-[var(--accent-primary)]'
                      : 'border-[var(--border-primary)] text-[var(--text-muted)] hover:text-white hover:border-[var(--accent-primary)]'
                  }`}
                >
                  {name.slice(0, 3)}
                </button>
              );
            })}
          </div>

          {/* Botón limpiar */}
          {filterMonth && (
            <button
              onClick={clearFilter}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-all"
            >
              <X className="w-3 h-3" /> Todos
            </button>
          )}

          {/* Label activo */}
          <span className="ml-auto text-xs text-[var(--accent-primary)] font-semibold bg-[var(--accent-primary)]/10 px-3 py-1.5 rounded-lg">
            📅 {filterLabel}
          </span>
        </div>
      </div>
      {/* ──────────────────────────────────────────────────────────────────── */}

      {/* Stats — basados en filteredAppointments */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="stat-card">
          <div className="stat-value">{filterMonth ? filteredAppointments.length : stats.today}</div>
          <div className="stat-label">{filterMonth ? 'Total mes' : 'Hoy'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.pending}</div>
          <div className="stat-label">Pendientes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.confirmed}</div>
          <div className="stat-label">Confirmadas</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.reservations}</div>
          <div className="stat-label">Reservas</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-[var(--accent-primary)]">${stats.allTotal.toLocaleString()}</div>
          <div className="stat-label">Total Pedidos</div>
        </div>
      </div>

      {/* Fila extra de stats cuando hay filtro */}
      {filterMonth && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card p-4 flex flex-col items-center border border-emerald-500/20">
            <span className="text-2xl font-bold text-emerald-400">{stats.completed}</span>
            <span className="text-xs text-[var(--text-muted)] mt-1">Completadas</span>
          </div>
          <div className="card p-4 flex flex-col items-center border border-blue-500/20">
            <span className="text-2xl font-bold text-blue-400">{filteredAppointments.filter(a => a.type === 'order').length}</span>
            <span className="text-xs text-[var(--text-muted)] mt-1">Pedidos</span>
          </div>
          <div className="card p-4 flex flex-col items-center border border-[var(--accent-primary)]/20">
            <span className="text-2xl font-bold text-[var(--accent-primary)]">{filteredAppointments.filter(a => a.type === 'appointment').length}</span>
            <span className="text-xs text-[var(--text-muted)] mt-1">Citas</span>
          </div>
        </div>
      )}

      {/* View Toggle */}
      <div className="flex gap-2 p-1 bg-[var(--bg-tertiary)] rounded-xl w-fit">
        <button onClick={() => setView('calendar')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${view === 'calendar' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)] hover:text-white'}`}>
          <CalendarIcon className="w-4 h-4" />Calendario
        </button>
        <button onClick={() => setView('list')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${view === 'list' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)] hover:text-white'}`}>
          <Clock className="w-4 h-4" />Lista
        </button>
      </div>

      {view === 'calendar' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 card">
            <div className="flex items-center justify-between mb-6">
              <button onClick={prevMonth} className="btn-icon"><ChevronLeft className="w-5 h-5" /></button>
              <h3 className="text-lg font-semibold text-white">
                {currentDate.toLocaleDateString('es', { month: 'long', year: 'numeric' })}
              </h3>
              <button onClick={nextMonth} className="btn-icon"><ChevronRight className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-7 gap-2 mb-2">
              {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => (
                <div key={d} className="text-center text-xs font-semibold text-[var(--text-muted)] py-2">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">{renderCalendar()}</div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4">
              {selectedDate ? selectedDate.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Selecciona un día'}
            </h3>
            {selectedDate && selectedDateAppointments.length > 0 ? (
              <div className="space-y-3">
                {selectedDateAppointments.map((apt) => (
                  <div key={apt.id} className="p-4 rounded-xl bg-white/5 border border-[var(--border-primary)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`badge ${apt.type === 'order' ? 'badge-info' : apt.type === 'reservation' ? 'badge-warning' : 'badge-success'}`}>
                        {apt.type === 'order' ? 'Pedido' : apt.type === 'reservation' ? 'Reserva' : 'Cita'}
                      </span>
                      <span className="text-sm font-medium text-[var(--accent-primary)]">{formatTime12h(apt.time)}</span>
                    </div>
                    <h4 className="font-semibold text-white">{apt.clientName}</h4>
                    <p className="text-sm text-[var(--text-muted)]">{apt.clientPhone}</p>
                    {apt.total && <p className="text-sm font-semibold text-[var(--accent-primary)] mt-1">${apt.total.toLocaleString()}</p>}
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => handleStatusChange(apt.id, 'confirmed')} className="btn-icon text-emerald-400"><Check className="w-4 h-4" /></button>
                      <button onClick={() => openEdit(apt)} className="btn-icon"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(apt.id)} className="btn-icon text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-[var(--text-muted)]">
                <CalendarIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No hay eventos para este día</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Lista — usa filteredAppointments */
        <div className="space-y-4">
          {filteredAppointments.length > 0 ? (
            filteredAppointments.map((apt) => (
              <div key={apt.id} className="card flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex items-center gap-4 flex-1">
                  <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${apt.type === 'order' ? 'bg-blue-500/20' : apt.type === 'reservation' ? 'bg-amber-500/20' : 'bg-purple-500/20'}`}>
                    {apt.type === 'order' ? <Package className="w-7 h-7 text-blue-400" /> : apt.type === 'reservation' ? <User className="w-7 h-7 text-amber-400" /> : <CalendarIcon className="w-7 h-7 text-purple-400" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-white">{apt.clientName}</h4>
                      <span className={`badge ${apt.status === 'pending' ? 'badge-warning' : apt.status === 'confirmed' ? 'badge-success' : apt.status === 'completed' ? 'badge-info' : 'badge-danger'}`}>
                        {apt.status === 'pending' ? 'Pendiente' : apt.status === 'confirmed' ? 'Confirmada' : apt.status === 'completed' ? 'Completada' : 'Cancelada'}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--text-muted)]">{apt.clientPhone}</p>
                    <div className="flex items-center gap-4 mt-2 text-sm text-[var(--text-muted)]">
                      <span className="flex items-center gap-1">
                        <CalendarIcon className="w-4 h-4" />
                        {new Date(apt.date).toLocaleDateString('es')}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {formatTime12h(apt.time)}
                      </span>
                      {apt.total && <span className="text-[var(--accent-primary)] font-semibold">${apt.total.toLocaleString()}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  {apt.status === 'pending' && (
                    <button onClick={() => handleStatusChange(apt.id, 'confirmed')} className="btn-secondary text-sm py-2">
                      <Check className="w-4 h-4" />Confirmar
                    </button>
                  )}
                  {apt.status === 'confirmed' && (
                    <button onClick={() => handleStatusChange(apt.id, 'completed')} className="btn-primary text-sm py-2">
                      <Check className="w-4 h-4" />Completar
                    </button>
                  )}
                  <button onClick={() => openEdit(apt)} className="btn-icon"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(apt.id)} className="btn-icon text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))
          ) : (
            <div className="card text-center py-12 text-[var(--text-muted)]">
              <CalendarIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{filterMonth ? `No hay eventos en ${filterLabel}` : 'No hay eventos programados'}</p>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">{editingItem ? 'Editar' : 'Nueva'} Cita/Pedido/Reserva</h3>
              <button onClick={() => setShowModal(false)} className="btn-icon"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="flex gap-2 p-1 bg-[var(--bg-tertiary)] rounded-xl">
                <button onClick={() => setForm({...form, type: 'appointment'})}
                  className={`flex-1 py-2 rounded-lg font-medium transition-all ${form.type === 'appointment' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)]'}`}>
                  Cita
                </button>
                <button onClick={() => setForm({...form, type: 'order'})}
                  className={`flex-1 py-2 rounded-lg font-medium transition-all ${form.type === 'order' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)]'}`}>
                  Pedido
                </button>
                <button onClick={() => setForm({...form, type: 'reservation'})}
                  className={`flex-1 py-2 rounded-lg font-medium transition-all ${form.type === 'reservation' ? 'bg-amber-500 text-white' : 'text-[var(--text-muted)]'}`}>
                  Reserva
                </button>
              </div>
              <div>
                <label className="input-label">Nombre del Cliente *</label>
                <input type="text" value={form.clientName} onChange={(e) => setForm({...form, clientName: e.target.value})} className="input" placeholder="Nombre completo" />
              </div>
              <div>
                <label className="input-label">Teléfono *</label>
                <input type="text" value={form.clientPhone} onChange={(e) => setForm({...form, clientPhone: e.target.value})} className="input" placeholder="+57 300 123 4567" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Fecha *</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} className="input" />
                </div>
                <div>
                  <label className="input-label">Hora *</label>
                  <input type="time" value={form.time} onChange={(e) => setForm({...form, time: e.target.value})} className="input" />
                </div>
              </div>
              {form.type === 'appointment' ? (
                <div>
                  <label className="input-label">Duración (minutos)</label>
                  <select value={form.duration} onChange={(e) => setForm({...form, duration: e.target.value})} className="input">
                    <option value="15">15 minutos</option>
                    <option value="30">30 minutos</option>
                    <option value="45">45 minutos</option>
                    <option value="60">1 hora</option>
                    <option value="90">1.5 horas</option>
                    <option value="120">2 horas</option>
                  </select>
                </div>
              ) : form.type === 'reservation' ? (
                <>
                  <div>
                    <label className="input-label">Tipo de Reserva *</label>
                    <input type="text" value={form.tipoReserva} onChange={(e) => setForm({...form, tipoReserva: e.target.value})} className="input" placeholder="Mesa, habitación, cancha, sala, turno..." />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="input-label">Personas</label>
                      <input type="number" value={form.personas} onChange={(e) => setForm({...form, personas: e.target.value})} className="input" min="1" placeholder="2" />
                    </div>
                    <div>
                      <label className="input-label">Duración (min)</label>
                      <select value={form.duration} onChange={(e) => setForm({...form, duration: e.target.value})} className="input">
                        <option value="30">30 min</option>
                        <option value="60">1 hora</option>
                        <option value="90">1.5 horas</option>
                        <option value="120">2 horas</option>
                        <option value="180">3 horas</option>
                        <option value="240">4 horas</option>
                        <option value="1440">Día completo</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="input-label">Dirección / Ubicación</label>
                    <input type="text" value={form.address} onChange={(e) => setForm({...form, address: e.target.value})} className="input" placeholder="Dirección o nombre del lugar" />
                  </div>
                  <div>
                    <label className="input-label">Total (opcional)</label>
                    <input type="number" value={form.total} onChange={(e) => setForm({...form, total: e.target.value})} className="input" placeholder="0" />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="input-label">Dirección de entrega</label>
                    <input type="text" value={form.address} onChange={(e) => setForm({...form, address: e.target.value})} className="input" placeholder="Dirección completa" />
                  </div>
                  <div>
                    <label className="input-label">Total del Pedido</label>
                    <input type="number" value={form.total} onChange={(e) => setForm({...form, total: e.target.value})} className="input" placeholder="0" />
                  </div>
                </>
              )}
              <div>
                <label className="input-label">Notas</label>
                <textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} className="input min-h-[80px]" placeholder="Notas adicionales..." />
              </div>
              <button onClick={handleSave} className="btn-primary w-full">{editingItem ? 'Actualizar' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-center py-4">
        <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
          <img src="/bizonne.png" alt="Bizonne" className="w-5 h-5 rounded" />
          Agenda powered by Bizonne
        </div>
      </div>
    </div>
  );
}

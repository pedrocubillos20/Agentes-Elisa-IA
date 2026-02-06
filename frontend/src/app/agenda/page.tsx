'use client';

import { useState, useEffect } from 'react';
import { Calendar as CalendarIcon, Clock, Plus, ChevronLeft, ChevronRight, User, Phone, MapPin, Package, Check, X, Edit2, Trash2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function AgendaPage() {
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [user, setUser] = useState<any>(null);

  const [form, setForm] = useState({
    type: 'appointment', clientName: '', clientPhone: '', date: '', time: '', duration: '30',
    notes: '', address: '', products: '', total: ''
  });

  // === WORKSPACE: leer línea seleccionada ===
  const getLineId = () => localStorage.getItem('selectedLineId') || '';

  useEffect(() => {
    fetchAppointments();
    fetchUser();
    const onLineChanged = () => { setLoading(true); fetchAppointments(); };
    window.addEventListener('lineChanged', onLineChanged);
    return () => window.removeEventListener('lineChanged', onLineChanged);
  }, []);

  const fetchUser = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setUser((await res.json()).user);
    } catch {}
  };

  const fetchAppointments = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/appointments?lineId=${getLineId()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setAppointments((await res.json()).appointments || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    const token = localStorage.getItem('token');
    const method = editingItem ? 'PUT' : 'POST';
    const url = editingItem ? `${API_URL}/api/appointments/${editingItem.id}` : `${API_URL}/api/appointments`;

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          duration: parseInt(form.duration) || 30,
          total: parseFloat(form.total) || null,
          products: form.products ? JSON.parse(`[${form.products}]`) : null,
          lineId: getLineId()
        })
      });

      if (res.ok) {
        fetchAppointments();
        setShowModal(false);
        resetForm();
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/appointments/${id}/status`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      fetchAppointments();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta cita?')) return;
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/appointments/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fetchAppointments();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const resetForm = () => {
    setForm({ type: 'appointment', clientName: '', clientPhone: '', date: '', time: '', duration: '30', notes: '', address: '', products: '', total: '' });
    setEditingItem(null);
  };

  const openEdit = (apt: any) => {
    setEditingItem(apt);
    setForm({
      type: apt.type, clientName: apt.clientName, clientPhone: apt.clientPhone,
      date: apt.date?.split('T')[0] || '', time: apt.time, duration: apt.duration?.toString() || '30',
      notes: apt.notes || '', address: apt.address || '',
      products: apt.products ? JSON.stringify(apt.products).slice(1, -1) : '', total: apt.total?.toString() || ''
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

  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const stats = {
    today: appointments.filter(a => a.date?.split('T')[0] === new Date().toISOString().split('T')[0]).length,
    pending: appointments.filter(a => a.status === 'pending').length,
    confirmed: appointments.filter(a => a.status === 'confirmed').length,
    totalOrders: appointments.filter(a => a.type === 'order').reduce((sum, a) => sum + (a.total || 0), 0)
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <img src="/bizonne.png" alt="Bizonne" className="w-16 h-16 rounded-xl animate-pulse" />
        <div className="loading-spinner" />
      </div>
    );
  }

  // 🔒 BLOQUEO PLAN STARTER - Agenda solo disponible en Business
  if (user?.plan === 'starter') {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <div className="card p-10 border-purple-500/30">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-purple-500/20 flex items-center justify-center">
            <CalendarIcon className="w-10 h-10 text-purple-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">Agenda disponible en Plan Business</h2>
          <p className="text-[var(--text-muted)] mb-6">
            Organiza citas, pedidos y entregas con la agenda integrada.
            Incluye calendario visual, recordatorios y seguimiento de estados.
          </p>
          <div className="flex flex-col items-center gap-4">
            <a href="/subscription" className="px-8 py-3 bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-bold rounded-xl text-lg hover:shadow-lg hover:shadow-purple-500/30 transition-all hover:scale-105">
              🚀 Upgrade a Business — USD$50/mes
            </a>
            <p className="text-xs text-[var(--text-muted)]">CRM completo · Agenda integrada · Equipo multi-usuario</p>
          </div>
        </div>
      </div>
    );
  }

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(currentDate);
    const firstDay = getFirstDayOfMonth(currentDate);
    const days = [];

    // Empty cells
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="calendar-day other-month" />);
    }

    // Days
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

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/bizonne.png" alt="Bizonne" className="w-14 h-14 rounded-xl hidden md:block" />
          <div>
            <h1 className="text-3xl font-bold text-white">Agenda</h1>
            <p className="text-[var(--text-muted)]">Citas y pedidos programados</p>
          </div>
        </div>
        <button onClick={() => { resetForm(); setShowModal(true); }} className="btn-primary">
          <Plus className="w-4 h-4" />Nueva Cita/Pedido
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="stat-value">{stats.today}</div>
          <div className="stat-label">Hoy</div>
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
          <div className="stat-value">${stats.totalOrders.toLocaleString()}</div>
          <div className="stat-label">Total Pedidos</div>
        </div>
      </div>

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
          {/* Calendar */}
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

            <div className="grid grid-cols-7 gap-2">
              {renderCalendar()}
            </div>
          </div>

          {/* Selected Day Details */}
          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4">
              {selectedDate ? selectedDate.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Selecciona un día'}
            </h3>

            {selectedDate && selectedDateAppointments.length > 0 ? (
              <div className="space-y-3">
                {selectedDateAppointments.map((apt) => (
                  <div key={apt.id} className="p-4 rounded-xl bg-white/5 border border-[var(--border-primary)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`badge ${apt.type === 'order' ? 'badge-info' : 'badge-success'}`}>
                        {apt.type === 'order' ? 'Pedido' : 'Cita'}
                      </span>
                      <span className="text-sm font-medium text-[var(--accent-primary)]">{apt.time}</span>
                    </div>
                    <h4 className="font-semibold text-white">{apt.clientName}</h4>
                    <p className="text-sm text-[var(--text-muted)]">{apt.clientPhone}</p>
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => handleStatusChange(apt.id, 'confirmed')} className="btn-icon text-emerald-400">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => openEdit(apt)} className="btn-icon">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(apt.id)} className="btn-icon text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-[var(--text-muted)]">
                <CalendarIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No hay citas</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {appointments.length > 0 ? (
            appointments.map((apt) => (
              <div key={apt.id} className="card flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex items-center gap-4 flex-1">
                  <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${apt.type === 'order' ? 'bg-blue-500/20' : 'bg-purple-500/20'}`}>
                    {apt.type === 'order' ? <Package className="w-7 h-7 text-blue-400" /> : <CalendarIcon className="w-7 h-7 text-purple-400" />}
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
                        {apt.time}
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
              <p>No hay citas programadas</p>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">{editingItem ? 'Editar' : 'Nueva'} Cita/Pedido</h3>
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
              </div>

              <div>
                <label className="input-label">Nombre del Cliente *</label>
                <input type="text" value={form.clientName} onChange={(e) => setForm({...form, clientName: e.target.value})}
                  className="input" placeholder="Nombre completo" />
              </div>

              <div>
                <label className="input-label">Teléfono *</label>
                <input type="text" value={form.clientPhone} onChange={(e) => setForm({...form, clientPhone: e.target.value})}
                  className="input" placeholder="+57 300 123 4567" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Fecha *</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})}
                    className="input" />
                </div>
                <div>
                  <label className="input-label">Hora *</label>
                  <input type="time" value={form.time} onChange={(e) => setForm({...form, time: e.target.value})}
                    className="input" />
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
              ) : (
                <>
                  <div>
                    <label className="input-label">Dirección de entrega</label>
                    <input type="text" value={form.address} onChange={(e) => setForm({...form, address: e.target.value})}
                      className="input" placeholder="Dirección completa" />
                  </div>
                  <div>
                    <label className="input-label">Total del Pedido</label>
                    <input type="number" value={form.total} onChange={(e) => setForm({...form, total: e.target.value})}
                      className="input" placeholder="0" />
                  </div>
                </>
              )}

              <div>
                <label className="input-label">Notas</label>
                <textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})}
                  className="input min-h-[80px]" placeholder="Notas adicionales..." />
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

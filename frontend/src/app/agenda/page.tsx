'use client';

import { useState, useEffect } from 'react';
import { 
  Calendar,
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  User,
  Phone,
  MapPin,
  Package,
  DollarSign,
  Edit2,
  Trash2,
  X,
  Check,
  AlertCircle,
  Filter,
  List,
  Grid3X3,
  Bell,
  MessageSquare
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Appointment {
  id: string;
  type: 'appointment' | 'order';
  clientName: string;
  clientPhone: string;
  date: string;
  time: string;
  duration?: number;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  notes?: string;
  products?: { name: string; quantity: number; price: number }[];
  total?: number;
  address?: string;
}

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export default function AgendaPage() {
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'appointment' | 'order'>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  useEffect(() => {
    fetchAppointments();
  }, []);

  const fetchAppointments = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      // Simulated data - Replace with actual API calls
      setAppointments([
        {
          id: '1',
          type: 'appointment',
          clientName: 'María García',
          clientPhone: '+57 320 123 4567',
          date: '2026-01-29',
          time: '10:00',
          duration: 60,
          status: 'confirmed',
          notes: 'Asesoría de productos'
        },
        {
          id: '2',
          type: 'order',
          clientName: 'Carlos López',
          clientPhone: '+57 315 987 6543',
          date: '2026-01-29',
          time: '14:00',
          status: 'pending',
          address: 'Calle 123 #45-67, Medellín',
          products: [
            { name: 'Buzo Premium Marfil', quantity: 2, price: 85000 },
            { name: 'Camiseta Básica', quantity: 1, price: 45000 }
          ],
          total: 215000
        },
        {
          id: '3',
          type: 'appointment',
          clientName: 'Ana Martínez',
          clientPhone: '+57 310 456 7890',
          date: '2026-01-30',
          time: '16:00',
          duration: 30,
          status: 'pending',
          notes: 'Primera consulta'
        },
        {
          id: '4',
          type: 'order',
          clientName: 'Pedro Sánchez',
          clientPhone: '+57 312 111 2233',
          date: '2026-01-28',
          time: '11:00',
          status: 'completed',
          address: 'Carrera 7 #89-12, Bogotá',
          products: [
            { name: 'Buzo Premium Negro', quantity: 1, price: 85000 }
          ],
          total: 85000
        }
      ]);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calendar helpers
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = [];
    
    // Previous month days
    for (let i = 0; i < firstDay.getDay(); i++) {
      const prevDate = new Date(year, month, -i);
      days.unshift({ date: prevDate, isCurrentMonth: false });
    }
    
    // Current month days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }
    
    // Next month days
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }
    
    return days;
  };

  const getAppointmentsForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return appointments.filter(apt => apt.date === dateStr);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  const filteredAppointments = appointments.filter(apt => {
    const matchesType = filterType === 'all' || apt.type === filterType;
    const matchesStatus = filterStatus === 'all' || apt.status === filterStatus;
    return matchesType && matchesStatus;
  });

  const upcomingAppointments = filteredAppointments
    .filter(apt => new Date(apt.date) >= new Date(new Date().toDateString()))
    .sort((a, b) => new Date(a.date + ' ' + a.time).getTime() - new Date(b.date + ' ' + b.time).getTime());

  const openModal = (appointment?: Appointment) => {
    setSelectedAppointment(appointment || null);
    setShowModal(true);
  };

  const updateStatus = async (id: string, status: Appointment['status']) => {
    setAppointments(prev => 
      prev.map(apt => apt.id === id ? { ...apt, status } : apt)
    );
    // TODO: API call
  };

  const deleteAppointment = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar esta cita/pedido?')) return;
    setAppointments(prev => prev.filter(apt => apt.id !== id));
    // TODO: API call
  };

  const stats = {
    today: appointments.filter(a => a.date === new Date().toISOString().split('T')[0]).length,
    pending: appointments.filter(a => a.status === 'pending').length,
    confirmed: appointments.filter(a => a.status === 'confirmed').length,
    totalOrders: appointments.filter(a => a.type === 'order').reduce((sum, a) => sum + (a.total || 0), 0)
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="loading-spinner" />
      </div>
    );
  }

  const calendarDays = getDaysInMonth(currentDate);
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Calendar className="w-8 h-8 text-[var(--accent-primary)]" />
            Agenda
          </h1>
          <p className="text-[var(--text-muted)] mt-1">
            Gestiona citas y pedidos programados
          </p>
        </div>
        <button onClick={() => openModal()} className="btn-primary">
          <Plus className="w-4 h-4" />
          Nueva Cita/Pedido
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-blue-400" />
            </div>
            <div className="stat-value text-2xl">{stats.today}</div>
          </div>
          <div className="stat-label">Hoy</div>
        </div>
        
        <div className="stat-card">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center">
              <Clock className="w-5 h-5 text-yellow-400" />
            </div>
            <div className="stat-value text-2xl">{stats.pending}</div>
          </div>
          <div className="stat-label">Pendientes</div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Check className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="stat-value text-2xl">{stats.confirmed}</div>
          </div>
          <div className="stat-label">Confirmadas</div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-purple-400" />
            </div>
            <div className="stat-value text-2xl">${(stats.totalOrders / 1000).toFixed(0)}k</div>
          </div>
          <div className="stat-label">En Pedidos</div>
        </div>
      </div>

      {/* Filters & View Toggle */}
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setFilterType('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filterType === 'all' ? 'bg-white/10 text-white' : 'text-[var(--text-muted)] hover:text-white'
            }`}
          >
            Todos
          </button>
          <button
            onClick={() => setFilterType('appointment')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filterType === 'appointment' ? 'bg-white/10 text-white' : 'text-[var(--text-muted)] hover:text-white'
            }`}
          >
            Citas
          </button>
          <button
            onClick={() => setFilterType('order')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filterType === 'order' ? 'bg-white/10 text-white' : 'text-[var(--text-muted)] hover:text-white'
            }`}
          >
            Pedidos
          </button>
        </div>
        
        <div className="flex-1" />
        
        <div className="flex gap-2">
          <button
            onClick={() => setView('calendar')}
            className={`p-2 rounded-lg transition-all ${
              view === 'calendar' ? 'bg-[var(--accent-primary)] text-white' : 'bg-white/5 text-[var(--text-muted)] hover:text-white'
            }`}
          >
            <Grid3X3 className="w-5 h-5" />
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-2 rounded-lg transition-all ${
              view === 'list' ? 'bg-[var(--accent-primary)] text-white' : 'bg-white/5 text-[var(--text-muted)] hover:text-white'
            }`}
          >
            <List className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar / List View */}
        <div className="lg:col-span-2">
          {view === 'calendar' ? (
            <div className="card">
              {/* Calendar Header */}
              <div className="flex items-center justify-between mb-6">
                <button
                  onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))}
                  className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                >
                  <ChevronLeft className="w-5 h-5 text-[var(--text-muted)]" />
                </button>
                <h3 className="text-lg font-semibold text-white">
                  {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
                </h3>
                <button
                  onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))}
                  className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                >
                  <ChevronRight className="w-5 h-5 text-[var(--text-muted)]" />
                </button>
              </div>

              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-1">
                {/* Day Headers */}
                {DAYS.map(day => (
                  <div key={day} className="text-center text-xs font-medium text-[var(--text-muted)] py-2">
                    {day}
                  </div>
                ))}
                
                {/* Calendar Days */}
                {calendarDays.map(({ date, isCurrentMonth }, index) => {
                  const dateStr = date.toISOString().split('T')[0];
                  const dayAppointments = getAppointmentsForDate(date);
                  const isToday = dateStr === today;
                  const isSelected = selectedDate?.toISOString().split('T')[0] === dateStr;
                  
                  return (
                    <button
                      key={index}
                      onClick={() => setSelectedDate(date)}
                      className={`
                        relative p-2 min-h-[80px] rounded-lg text-left transition-all
                        ${isCurrentMonth ? '' : 'opacity-30'}
                        ${isToday ? 'ring-2 ring-[var(--accent-primary)]' : ''}
                        ${isSelected ? 'bg-[var(--accent-primary)]/20' : 'hover:bg-white/5'}
                      `}
                    >
                      <span className={`
                        text-sm font-medium
                        ${isToday ? 'text-[var(--accent-primary)]' : 'text-white'}
                      `}>
                        {date.getDate()}
                      </span>
                      
                      {dayAppointments.length > 0 && (
                        <div className="mt-1 space-y-1">
                          {dayAppointments.slice(0, 2).map((apt, i) => (
                            <div
                              key={i}
                              className={`
                                text-[10px] px-1.5 py-0.5 rounded truncate
                                ${apt.type === 'appointment' ? 'bg-blue-500/30 text-blue-300' : 'bg-purple-500/30 text-purple-300'}
                              `}
                            >
                              {apt.time}
                            </div>
                          ))}
                          {dayAppointments.length > 2 && (
                            <div className="text-[10px] text-[var(--text-muted)]">
                              +{dayAppointments.length - 2} más
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* List View */
            <div className="space-y-4">
              {upcomingAppointments.length === 0 ? (
                <div className="card text-center py-12">
                  <Calendar className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3" />
                  <p className="text-[var(--text-muted)]">No hay citas programadas</p>
                </div>
              ) : (
                upcomingAppointments.map(apt => (
                  <AppointmentCard
                    key={apt.id}
                    appointment={apt}
                    onEdit={() => openModal(apt)}
                    onDelete={() => deleteAppointment(apt.id)}
                    onUpdateStatus={updateStatus}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* Sidebar - Selected Day or Upcoming */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4">
              {selectedDate ? formatDate(selectedDate.toISOString().split('T')[0]) : 'Próximas citas'}
            </h3>
            
            <div className="space-y-3">
              {(selectedDate ? getAppointmentsForDate(selectedDate) : upcomingAppointments.slice(0, 5)).map(apt => (
                <div
                  key={apt.id}
                  className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
                  onClick={() => openModal(apt)}
                >
                  <div className="flex items-start gap-3">
                    <div className={`
                      w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
                      ${apt.type === 'appointment' ? 'bg-blue-500/20' : 'bg-purple-500/20'}
                    `}>
                      {apt.type === 'appointment' ? (
                        <User className="w-5 h-5 text-blue-400" />
                      ) : (
                        <Package className="w-5 h-5 text-purple-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white truncate">{apt.clientName}</p>
                      <p className="text-sm text-[var(--text-muted)]">
                        {apt.time} {apt.duration ? `(${apt.duration} min)` : ''}
                      </p>
                      {apt.total && (
                        <p className="text-sm font-medium text-[var(--accent-primary)]">
                          ${apt.total.toLocaleString()}
                        </p>
                      )}
                    </div>
                    <span className={`badge text-[10px] ${
                      apt.status === 'confirmed' ? 'badge-success' :
                      apt.status === 'pending' ? 'badge-warning' :
                      apt.status === 'completed' ? 'badge-info' : 'badge-danger'
                    }`}>
                      {apt.status === 'confirmed' ? 'Confirmada' :
                       apt.status === 'pending' ? 'Pendiente' :
                       apt.status === 'completed' ? 'Completada' : 'Cancelada'}
                    </span>
                  </div>
                </div>
              ))}
              
              {(selectedDate ? getAppointmentsForDate(selectedDate) : upcomingAppointments).length === 0 && (
                <p className="text-center text-[var(--text-muted)] py-4">
                  No hay citas para mostrar
                </p>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="card">
            <h4 className="font-semibold text-white mb-4">Acciones Rápidas</h4>
            <div className="space-y-2">
              <button className="w-full btn-secondary justify-start">
                <Bell className="w-4 h-4" />
                Enviar Recordatorios
              </button>
              <button className="w-full btn-secondary justify-start">
                <MessageSquare className="w-4 h-4" />
                Mensaje Masivo
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <AppointmentModal
          appointment={selectedAppointment}
          onClose={() => {
            setShowModal(false);
            setSelectedAppointment(null);
          }}
          onSave={(data) => {
            console.log('Saving:', data);
            setShowModal(false);
            setSelectedAppointment(null);
          }}
        />
      )}
    </div>
  );
}

// Appointment Card Component
function AppointmentCard({ 
  appointment, 
  onEdit, 
  onDelete, 
  onUpdateStatus 
}: { 
  appointment: Appointment;
  onEdit: () => void;
  onDelete: () => void;
  onUpdateStatus: (id: string, status: Appointment['status']) => void;
}) {
  return (
    <div className="card group">
      <div className="flex items-start gap-4">
        <div className={`
          w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0
          ${appointment.type === 'appointment' ? 'bg-blue-500/20' : 'bg-purple-500/20'}
        `}>
          {appointment.type === 'appointment' ? (
            <Calendar className="w-7 h-7 text-blue-400" />
          ) : (
            <Package className="w-7 h-7 text-purple-400" />
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-white">{appointment.clientName}</h3>
              <p className="text-sm text-[var(--text-muted)]">
                {new Date(appointment.date + 'T00:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' })} - {appointment.time}
              </p>
            </div>
            <span className={`badge ${
              appointment.status === 'confirmed' ? 'badge-success' :
              appointment.status === 'pending' ? 'badge-warning' :
              appointment.status === 'completed' ? 'badge-info' : 'badge-danger'
            }`}>
              {appointment.status === 'confirmed' ? 'Confirmada' :
               appointment.status === 'pending' ? 'Pendiente' :
               appointment.status === 'completed' ? 'Completada' : 'Cancelada'}
            </span>
          </div>
          
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-[var(--text-secondary)]">
            <span className="flex items-center gap-1">
              <Phone className="w-4 h-4" />
              {appointment.clientPhone}
            </span>
            {appointment.address && (
              <span className="flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                {appointment.address}
              </span>
            )}
            {appointment.duration && (
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {appointment.duration} min
              </span>
            )}
          </div>
          
          {appointment.products && (
            <div className="mt-3 p-3 rounded-lg bg-white/5">
              <p className="text-xs text-[var(--text-muted)] mb-2">Productos:</p>
              {appointment.products.map((product, i) => (
                <p key={i} className="text-sm text-white">
                  {product.quantity}x {product.name} - ${product.price.toLocaleString()}
                </p>
              ))}
              <p className="text-sm font-semibold text-[var(--accent-primary)] mt-2">
                Total: ${appointment.total?.toLocaleString()}
              </p>
            </div>
          )}
          
          {appointment.notes && (
            <p className="mt-3 text-sm text-[var(--text-muted)] italic">
              "{appointment.notes}"
            </p>
          )}
        </div>
      </div>
      
      {/* Actions */}
      <div className="mt-4 pt-4 border-t border-[var(--border-primary)] flex items-center justify-between">
        <div className="flex gap-2">
          {appointment.status === 'pending' && (
            <button
              onClick={() => onUpdateStatus(appointment.id, 'confirmed')}
              className="btn-primary text-sm py-2"
            >
              <Check className="w-4 h-4" />
              Confirmar
            </button>
          )}
          {appointment.status === 'confirmed' && (
            <button
              onClick={() => onUpdateStatus(appointment.id, 'completed')}
              className="btn-primary text-sm py-2"
            >
              <Check className="w-4 h-4" />
              Completar
            </button>
          )}
        </div>
        
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="p-2 hover:bg-white/10 rounded-lg">
            <Edit2 className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
          <button onClick={onDelete} className="p-2 hover:bg-red-500/10 rounded-lg">
            <Trash2 className="w-4 h-4 text-red-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Appointment Modal Component
function AppointmentModal({ 
  appointment, 
  onClose, 
  onSave 
}: { 
  appointment: Appointment | null;
  onClose: () => void;
  onSave: (data: any) => void;
}) {
  const [formData, setFormData] = useState({
    type: appointment?.type || 'appointment',
    clientName: appointment?.clientName || '',
    clientPhone: appointment?.clientPhone || '',
    date: appointment?.date || new Date().toISOString().split('T')[0],
    time: appointment?.time || '10:00',
    duration: appointment?.duration || 60,
    notes: appointment?.notes || '',
    address: appointment?.address || ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">
            {appointment ? 'Editar' : 'Nueva'} {formData.type === 'appointment' ? 'Cita' : 'Pedido'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg">
            <X className="w-5 h-5 text-[var(--text-muted)]" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type Toggle */}
          <div className="flex gap-2 p-1 bg-white/5 rounded-lg">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, type: 'appointment' })}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
                formData.type === 'appointment' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)]'
              }`}
            >
              Cita
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, type: 'order' })}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
                formData.type === 'order' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)]'
              }`}
            >
              Pedido
            </button>
          </div>
          
          <div>
            <label className="input-label">Cliente *</label>
            <input
              type="text"
              required
              value={formData.clientName}
              onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
              className="input"
              placeholder="Nombre del cliente"
            />
          </div>
          
          <div>
            <label className="input-label">Teléfono *</label>
            <input
              type="tel"
              required
              value={formData.clientPhone}
              onChange={(e) => setFormData({ ...formData, clientPhone: e.target.value })}
              className="input"
              placeholder="+57 300 000 0000"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="input-label">Fecha *</label>
              <input
                type="date"
                required
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="input-label">Hora *</label>
              <input
                type="time"
                required
                value={formData.time}
                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                className="input"
              />
            </div>
          </div>
          
          {formData.type === 'appointment' && (
            <div>
              <label className="input-label">Duración (minutos)</label>
              <input
                type="number"
                min="15"
                step="15"
                value={formData.duration}
                onChange={(e) => setFormData({ ...formData, duration: Number(e.target.value) })}
                className="input"
              />
            </div>
          )}
          
          {formData.type === 'order' && (
            <div>
              <label className="input-label">Dirección de entrega</label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="input"
                placeholder="Dirección completa"
              />
            </div>
          )}
          
          <div>
            <label className="input-label">Notas</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="input min-h-[80px]"
              placeholder="Notas adicionales..."
            />
          </div>
          
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Cancelar
            </button>
            <button type="submit" className="btn-primary flex-1">
              {appointment ? 'Guardar Cambios' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

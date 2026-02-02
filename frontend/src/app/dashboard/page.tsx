'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Smartphone, Bot, MessageSquare, CheckCircle, XCircle, AlertCircle,
  TrendingUp, TrendingDown, Users, Calendar, Clock, Activity, BarChart3,
  ArrowUpRight, Zap
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [dashboard, setDashboard] = useState<any>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    // Auto-refresh cada 30 segundos
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const [userRes, dashRes, whatsappRes] = await Promise.all([
        fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/conversations/dashboard`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null),
        fetch(`${API_URL}/api/whatsapp/status`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null)
      ]);

      if (userRes.ok) setUser((await userRes.json()).user);
      if (dashRes?.ok) setDashboard(await dashRes.json());
      if (whatsappRes?.ok) setWhatsappStatus(await whatsappRes.json());
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Formatear tiempo relativo
  const timeAgo = (dateStr: string) => {
    const now = new Date().getTime();
    const date = new Date(dateStr).getTime();
    const diff = Math.floor((now - date) / 1000);
    
    if (diff < 60) return 'Hace un momento';
    if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} hora${Math.floor(diff / 3600) > 1 ? 's' : ''}`;
    return `Hace ${Math.floor(diff / 86400)} día${Math.floor(diff / 86400) > 1 ? 's' : ''}`;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <img src="/elisa.png" alt="Elisa" className="w-16 h-16 rounded-xl animate-pulse" />
        <div className="loading-spinner" />
      </div>
    );
  }

  const totalMessages = dashboard?.totalMessages || 0;
  const totalConversations = dashboard?.totalConversations || 0;
  const totalAppointments = dashboard?.totalAppointments || 0;
  const pendingAppointments = dashboard?.pendingAppointments || 0;
  const todayMessages = dashboard?.todayMessages || 0;
  const totalClients = dashboard?.totalClients || 0;
  const conversionRate = dashboard?.conversionRate || '0';
  const weeklyActivity = dashboard?.weeklyActivity || [0, 0, 0, 0, 0, 0, 0];
  const recentActivity = dashboard?.recentActivity || [];

  const statCards = [
    { 
      title: 'Mensajes Totales', 
      value: totalMessages, 
      sub: todayMessages > 0 ? `${todayMessages} hoy` : 'Sin mensajes hoy',
      icon: MessageSquare, 
      color: 'emerald' 
    },
    { 
      title: 'Conversaciones', 
      value: totalConversations, 
      sub: `${dashboard?.convertedCount || 0} convertidos`,
      icon: Users, 
      color: 'blue' 
    },
    { 
      title: 'Clientes CRM', 
      value: totalClients, 
      sub: `${conversionRate}% conversión`,
      icon: Clock, 
      color: 'purple' 
    },
    { 
      title: 'Citas/Pedidos', 
      value: totalAppointments, 
      sub: pendingAppointments > 0 ? `${pendingAppointments} pendientes` : 'Sin pendientes',
      icon: Calendar, 
      color: 'orange' 
    }
  ];

  const maxChart = Math.max(...weeklyActivity, 1);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/elisa.png" alt="Elisa IA" className="w-16 h-16 rounded-2xl shadow-lg animate-float hidden md:block" />
          <div>
            <h1 className="text-3xl font-bold text-white">
              ¡Hola, {user?.name?.split(' ')[0] || 'Usuario'}! 👋
            </h1>
            <p className="text-[var(--text-muted)] mt-1">
              {whatsappStatus?.connected 
                ? `Tu chatbot está activo • +${whatsappStatus.phone || ''}` 
                : 'Conecta WhatsApp para activar Elisa'}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Link href="/conversaciones" className="btn-secondary">
            <MessageSquare className="w-4 h-4" />Ver Chats
          </Link>
          <Link href="/crm" className="btn-primary">
            <Users className="w-4 h-4" />Abrir CRM
          </Link>
        </div>
      </div>

      {/* Setup Banner */}
      {!whatsappStatus?.connected && (
        <div className="card p-6 border-yellow-500/30 animate-fade-in stagger-1">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-yellow-500/20 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-yellow-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white">Completa la configuración</h3>
              <p className="text-[var(--text-muted)]">Conecta WhatsApp para que Elisa comience a responder.</p>
            </div>
            <Link href="/whatsapp" className="btn-primary">
              <Smartphone className="w-4 h-4" />Conectar WhatsApp
            </Link>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, index) => (
          <div key={stat.title} className="stat-card animate-fade-in" style={{ animationDelay: `${(index + 1) * 100}ms` }}>
            <div className="flex items-start justify-between mb-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                stat.color === 'emerald' ? 'bg-emerald-500/20' :
                stat.color === 'blue' ? 'bg-blue-500/20' :
                stat.color === 'purple' ? 'bg-purple-500/20' : 'bg-orange-500/20'
              }`}>
                <stat.icon className={`w-6 h-6 ${
                  stat.color === 'emerald' ? 'text-emerald-400' :
                  stat.color === 'blue' ? 'text-blue-400' :
                  stat.color === 'purple' ? 'text-purple-400' : 'text-orange-400'
                }`} />
              </div>
              {stat.sub && (
                <span className="text-xs text-[var(--text-muted)] bg-white/5 px-2 py-1 rounded-full">
                  {stat.sub}
                </span>
              )}
            </div>
            <div className="stat-value">{typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}</div>
            <div className="stat-label">{stat.title}</div>
          </div>
        ))}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart - Actividad Semanal REAL */}
        <div className="lg:col-span-2 card animate-fade-in stagger-2">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-white">Actividad Semanal</h3>
              <p className="text-sm text-[var(--text-muted)]">{dashboard?.weekMessages || 0} mensajes esta semana</p>
            </div>
            <Link href="/conversaciones" className="btn-secondary text-sm py-2">
              <BarChart3 className="w-4 h-4" />Ver Chats
            </Link>
          </div>
          
          <div className="h-48 flex items-end justify-between gap-3 px-4">
            {weeklyActivity.map((value: number, index: number) => (
              <div key={index} className="flex-1 flex flex-col items-center gap-2">
                <span className="text-xs text-[var(--text-muted)]">{value}</span>
                <div 
                  className="w-full rounded-t-lg transition-all duration-500 hover:opacity-80"
                  style={{ 
                    height: `${Math.max((value / maxChart) * 100, 4)}%`,
                    background: value > 0 
                      ? 'linear-gradient(to top, var(--accent-primary), var(--accent-secondary))' 
                      : 'rgba(255,255,255,0.05)'
                  }} 
                />
                <span className="text-xs text-[var(--text-muted)]">
                  {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][index]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Activity Feed REAL */}
        <div className="card animate-fade-in stagger-3">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-white">Actividad Reciente</h3>
            <Activity className="w-5 h-5 text-[var(--accent-primary)]" />
          </div>
          
          <div className="space-y-4">
            {recentActivity.length > 0 ? recentActivity.map((activity: any, index: number) => (
              <div key={index} className="flex items-start gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  activity.type === 'message' ? 'bg-blue-500/20' :
                  activity.type === 'appointment' ? 'bg-purple-500/20' : 'bg-emerald-500/20'
                }`}>
                  {activity.type === 'message' && <MessageSquare className="w-5 h-5 text-blue-400" />}
                  {activity.type === 'appointment' && <Calendar className="w-5 h-5 text-purple-400" />}
                  {activity.type === 'sale' && <Zap className="w-5 h-5 text-emerald-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{activity.user}</p>
                  <p className="text-xs text-[var(--text-muted)] truncate">{activity.action}</p>
                </div>
                <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{timeAgo(activity.time)}</span>
              </div>
            )) : (
              <div className="text-center py-8 text-[var(--text-muted)]">
                <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Sin actividad reciente</p>
                <p className="text-xs mt-1">Los mensajes nuevos aparecerán aquí</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Access Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link href="/whatsapp" className="card glass-hover group animate-fade-in stagger-2">
          <div className="flex items-center justify-between mb-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${whatsappStatus?.connected ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
              <Smartphone className={`w-6 h-6 ${whatsappStatus?.connected ? 'text-emerald-400' : 'text-red-400'}`} />
            </div>
            <div className={`badge ${whatsappStatus?.connected ? 'badge-success' : 'badge-danger'}`}>
              {whatsappStatus?.connected ? <><CheckCircle className="w-3 h-3" />Conectado</> : <><XCircle className="w-3 h-3" />Desconectado</>}
            </div>
          </div>
          <h3 className="text-lg font-semibold text-white mb-1">WhatsApp</h3>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            {whatsappStatus?.connected ? `+${whatsappStatus.phone || 'Conectado'}` : 'Escanea QR para conectar'}
          </p>
          <div className="flex items-center gap-2 text-[var(--accent-primary)] text-sm font-medium group-hover:gap-3 transition-all">
            {whatsappStatus?.connected ? 'Ver estado' : 'Conectar'}<ArrowUpRight className="w-4 h-4" />
          </div>
        </Link>

        <Link href="/crm" className="card glass-hover group animate-fade-in stagger-3">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Users className="w-6 h-6 text-blue-400" />
            </div>
            {totalClients > 0 && (
              <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full font-medium">
                {totalClients} clientes
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-white mb-1">CRM</h3>
          <p className="text-sm text-[var(--text-muted)] mb-4">Gestiona clientes y productos</p>
          <div className="flex items-center gap-2 text-[var(--accent-primary)] text-sm font-medium group-hover:gap-3 transition-all">
            Abrir CRM<ArrowUpRight className="w-4 h-4" />
          </div>
        </Link>

        <Link href="/agenda" className="card glass-hover group animate-fade-in stagger-4">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <Calendar className="w-6 h-6 text-purple-400" />
            </div>
            {pendingAppointments > 0 && (
              <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-1 rounded-full font-medium">
                {pendingAppointments} pendientes
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-white mb-1">Agenda</h3>
          <p className="text-sm text-[var(--text-muted)] mb-4">Citas y pedidos programados</p>
          <div className="flex items-center gap-2 text-[var(--accent-primary)] text-sm font-medium group-hover:gap-3 transition-all">
            Ver agenda<ArrowUpRight className="w-4 h-4" />
          </div>
        </Link>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center py-8">
        <div className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white/5 border border-white/10">
          <img src="/elisa.png" alt="Elisa IA" className="w-8 h-8 rounded-lg" />
          <span className="text-sm text-[var(--text-muted)]">
            Potenciado por <span className="text-white font-semibold">Elisa IA</span>
          </span>
        </div>
      </div>
    </div>
  );
}

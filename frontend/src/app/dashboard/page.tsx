'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Smartphone, 
  Bot, 
  MessageSquare, 
  Settings,
  CheckCircle,
  XCircle,
  AlertCircle,
  ArrowRight,
  Zap
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const [userRes, statsRes, whatsappRes] = await Promise.all([
        fetch(`${API_URL}/api/auth/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_URL}/api/conversations/stats`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_URL}/api/whatsapp/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      if (userRes.ok) {
        const userData = await userRes.json();
        setUser(userData.user);
      }

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      if (whatsappRes.ok) {
        const whatsappData = await whatsappRes.json();
        setWhatsappStatus(whatsappData);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  const steps = [
    {
      title: 'Configura OpenAI',
      description: 'Conecta tu API Key de OpenAI',
      icon: Settings,
      completed: user?.apiKeyConnected,
      href: '/configuracion'
    },
    {
      title: 'Conecta WhatsApp',
      description: 'Escanea el QR con tu teléfono',
      icon: Smartphone,
      completed: whatsappStatus?.connected,
      href: '/whatsapp'
    },
    {
      title: 'Crea tu Asistente',
      description: 'Personaliza las respuestas de tu bot',
      icon: Bot,
      completed: false, // TODO: Check if has assistant
      href: '/asistentes'
    }
  ];

  const allStepsCompleted = steps.every(s => s.completed);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">
          ¡Bienvenido, {user?.name || 'Usuario'}! 👋
        </h1>
        <p className="text-slate-400 mt-2">
          {allStepsCompleted 
            ? 'Tu chatbot está activo y funcionando' 
            : 'Completa la configuración para activar tu chatbot'
          }
        </p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* WhatsApp Status */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <Smartphone className="w-8 h-8 text-emerald-400" />
            {whatsappStatus?.connected ? (
              <span className="badge-success">
                <CheckCircle className="w-4 h-4 mr-1" />
                Conectado
              </span>
            ) : (
              <span className="badge-danger">
                <XCircle className="w-4 h-4 mr-1" />
                Desconectado
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-white">WhatsApp</h3>
          <p className="text-slate-400 text-sm mt-1">
            {whatsappStatus?.connected 
              ? `Número: ${whatsappStatus.phone || 'Conectado'}` 
              : 'Escanea el QR para conectar'
            }
          </p>
          <Link 
            href="/whatsapp"
            className="mt-4 inline-flex items-center text-emerald-400 hover:text-emerald-300 text-sm font-medium"
          >
            {whatsappStatus?.connected ? 'Ver estado' : 'Conectar ahora'}
            <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        </div>

        {/* OpenAI Status */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <Zap className="w-8 h-8 text-yellow-400" />
            {user?.apiKeyConnected ? (
              <span className="badge-success">
                <CheckCircle className="w-4 h-4 mr-1" />
                Configurado
              </span>
            ) : (
              <span className="badge-warning">
                <AlertCircle className="w-4 h-4 mr-1" />
                Pendiente
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-white">OpenAI</h3>
          <p className="text-slate-400 text-sm mt-1">
            {user?.apiKeyConnected 
              ? 'API Key conectada' 
              : 'Configura tu API Key'
            }
          </p>
          <Link 
            href="/configuracion"
            className="mt-4 inline-flex items-center text-emerald-400 hover:text-emerald-300 text-sm font-medium"
          >
            {user?.apiKeyConnected ? 'Cambiar' : 'Configurar'}
            <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        </div>

        {/* Stats */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <MessageSquare className="w-8 h-8 text-blue-400" />
            <span className="text-2xl font-bold text-white">
              {stats?.totalMessages || 0}
            </span>
          </div>
          <h3 className="text-lg font-semibold text-white">Mensajes</h3>
          <p className="text-slate-400 text-sm mt-1">
            {stats?.totalConversations || 0} conversaciones
          </p>
          <Link 
            href="/conversaciones"
            className="mt-4 inline-flex items-center text-emerald-400 hover:text-emerald-300 text-sm font-medium"
          >
            Ver conversaciones
            <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        </div>
      </div>

      {/* Setup Steps */}
      {!allStepsCompleted && (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
          <h2 className="text-xl font-bold text-white mb-6">
            🚀 Completa la configuración
          </h2>
          <div className="space-y-4">
            {steps.map((step, index) => (
              <Link
                key={index}
                href={step.href}
                className={`
                  flex items-center gap-4 p-4 rounded-lg border transition-all duration-200
                  ${step.completed 
                    ? 'bg-emerald-500/10 border-emerald-500/30' 
                    : 'bg-slate-700/30 border-slate-600 hover:bg-slate-700/50'
                  }
                `}
              >
                <div className={`
                  w-12 h-12 rounded-xl flex items-center justify-center
                  ${step.completed ? 'bg-emerald-500/20' : 'bg-slate-600'}
                `}>
                  {step.completed ? (
                    <CheckCircle className="w-6 h-6 text-emerald-400" />
                  ) : (
                    <step.icon className="w-6 h-6 text-slate-300" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className={`font-semibold ${step.completed ? 'text-emerald-400' : 'text-white'}`}>
                    {step.title}
                  </h3>
                  <p className="text-slate-400 text-sm">{step.description}</p>
                </div>
                <ArrowRight className={`w-5 h-5 ${step.completed ? 'text-emerald-400' : 'text-slate-400'}`} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link
          href="/asistentes"
          className="bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 rounded-xl border border-emerald-500/30 p-6 hover:from-emerald-500/30 hover:to-emerald-600/20 transition-all duration-200"
        >
          <Bot className="w-10 h-10 text-emerald-400 mb-4" />
          <h3 className="text-lg font-semibold text-white">Crear Asistente</h3>
          <p className="text-slate-400 text-sm mt-2">
            Personaliza cómo responde tu chatbot a los clientes
          </p>
        </Link>

        <Link
          href="/conversaciones"
          className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-xl border border-blue-500/30 p-6 hover:from-blue-500/30 hover:to-blue-600/20 transition-all duration-200"
        >
          <MessageSquare className="w-10 h-10 text-blue-400 mb-4" />
          <h3 className="text-lg font-semibold text-white">Ver Conversaciones</h3>
          <p className="text-slate-400 text-sm mt-2">
            Revisa el historial de chats con tus clientes
          </p>
        </Link>
      </div>
    </div>
  );
}

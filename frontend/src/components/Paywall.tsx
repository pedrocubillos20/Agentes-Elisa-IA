'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Zap, CreditCard, MessageSquare, BarChart3, Calendar, Users, Bot, ArrowRight, Shield, Clock, Sparkles } from 'lucide-react';

interface PaywallProps {
  plan: string;
  daysExpired?: number;
}

export default function Paywall({ plan, daysExpired }: PaywallProps) {
  const router = useRouter();
  const [hoveredPlan, setHoveredPlan] = useState<string | null>(null);

  const isTrialExpired = plan === 'trial';

  const features = [
    { icon: Bot, label: 'Asistentes IA por WhatsApp', desc: 'Automatiza ventas 24/7' },
    { icon: MessageSquare, label: 'Conversaciones ilimitadas', desc: 'Gestiona todos tus chats' },
    { icon: BarChart3, label: 'CRM completo', desc: 'Pipeline de ventas inteligente' },
    { icon: Calendar, label: 'Agenda automática', desc: 'Citas desde WhatsApp' },
    { icon: Users, label: 'Equipo multi-agente', desc: 'Asigna chats a tu equipo' },
    { icon: Sparkles, label: 'Detección inteligente', desc: 'Etapas y pedidos automáticos' },
  ];

  const plans = [
    {
      id: 'starter',
      name: 'Starter',
      price: '$30',
      period: '/mes USD',
      color: 'blue',
      features: ['2 líneas WhatsApp', 'Asistente IA', 'CRM + Pipeline', 'Agenda automática'],
      popular: false,
    },
    {
      id: 'business',
      name: 'Business',
      price: '$50',
      period: '/mes USD',
      color: 'purple',
      features: ['5 líneas WhatsApp', 'Productos ilimitados', 'Equipo completo', 'Integraciones API'],
      popular: true,
    },
  ];

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-3xl">
        {/* Lock Icon + Header */}
        <div className="text-center mb-8">
          <div className="relative inline-flex">
            <div className="w-20 h-20 rounded-2xl bg-red-500/10 border-2 border-red-500/30 flex items-center justify-center mb-4 mx-auto animate-pulse">
              <Lock className="w-10 h-10 text-red-400" />
            </div>
            <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
              <span className="text-white text-xs font-bold">!</span>
            </div>
          </div>
          
          <h1 className="text-3xl font-bold text-white mb-2">
            {isTrialExpired ? 'Tu prueba gratuita ha terminado' : 'Tu suscripción ha expirado'}
          </h1>
          <p className="text-gray-400 text-lg max-w-lg mx-auto">
            {isTrialExpired 
              ? 'Los 7 días de prueba han finalizado. Elige un plan para seguir automatizando tu negocio con IA.'
              : 'Tu plan ha vencido. Renueva para recuperar el acceso a todas tus herramientas y conversaciones.'}
          </p>
        </div>

        {/* Blocked Services */}
        <div className="bg-[#1a1a2e]/80 border border-red-500/20 rounded-2xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-red-400" />
            <span className="text-red-400 text-sm font-semibold">Servicios bloqueados</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {features.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-gray-500 text-xs">
                <Lock className="w-3 h-3 text-red-400/50 flex-shrink-0" />
                <span>{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Plans */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {plans.map((p) => (
            <div
              key={p.id}
              onMouseEnter={() => setHoveredPlan(p.id)}
              onMouseLeave={() => setHoveredPlan(null)}
              className={`relative rounded-2xl border-2 p-5 transition-all duration-300 cursor-pointer ${
                p.popular
                  ? 'bg-purple-500/5 border-purple-500/40 hover:border-purple-400 hover:bg-purple-500/10'
                  : 'bg-[#1a1a2e]/60 border-gray-700/50 hover:border-blue-400 hover:bg-blue-500/5'
              }`}
              onClick={() => router.push('/subscription')}
            >
              {p.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-purple-500 rounded-full text-white text-[10px] font-bold uppercase tracking-wider">
                  Recomendado
                </div>
              )}
              
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-white">{p.name}</h3>
                <Zap className={`w-5 h-5 ${p.popular ? 'text-purple-400' : 'text-blue-400'}`} />
              </div>
              
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-bold text-white">{p.price}</span>
                <span className="text-gray-500 text-sm">{p.period}</span>
              </div>

              <ul className="space-y-2 mb-4">
                {p.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-gray-300">
                    <div className={`w-1.5 h-1.5 rounded-full ${p.popular ? 'bg-purple-400' : 'bg-blue-400'}`} />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={(e) => { e.stopPropagation(); router.push('/subscription'); }}
                className={`w-full py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all ${
                  p.popular
                    ? 'bg-purple-500 hover:bg-purple-400 text-white'
                    : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                Activar {p.name}
                <ArrowRight className={`w-4 h-4 transition-transform ${hoveredPlan === p.id ? 'translate-x-1' : ''}`} />
              </button>
            </div>
          ))}
        </div>

        {/* Info Footer */}
        <div className="text-center space-y-2">
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 max-w-md mx-auto">
            <p className="text-red-400 text-xs font-semibold flex items-center justify-center gap-2">
              ⚠️ Tu cuenta y todos tus datos serán eliminados en 5 días si no activas un plan
            </p>
            <p className="text-gray-500 text-[10px] mt-1">
              Por políticas de seguridad y base de datos, las cuentas inactivas se eliminan automáticamente.
            </p>
          </div>
          <p className="text-gray-600 text-[10px]">
            Ahorra hasta 31% con planes semestrales y anuales
          </p>
        </div>
      </div>
    </div>
  );
}

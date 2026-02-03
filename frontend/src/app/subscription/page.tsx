'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Crown, Check, X, Clock, CreditCard, Shield, Zap, ArrowLeft, AlertTriangle, Star, Sparkles, Building2, Rocket, ChevronDown } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://elisa-ia-agentes-production.up.railway.app';

const PLAN_FEATURES: Record<string, { included: string[]; excluded: string[] }> = {
  starter: {
    included: [
      'Asistente IA con WhatsApp',
      'Hasta 3 líneas de WhatsApp',
      'Respuestas automáticas 24/7',
      'Dashboard y métricas',
      'Base de conocimiento',
      'Multimedia (imágenes, videos)',
      'Pausa/Reactivación de IA',
      'Indicadores "escribiendo..."',
    ],
    excluded: ['CRM + Agenda', 'Equipo multi-usuario', 'Asignación de chats']
  },
  business: {
    included: [
      'Todo de Starter +',
      'Líneas de WhatsApp ilimitadas',
      'CRM completo con base de datos',
      'Agenda de citas integrada',
      'Equipo multi-usuario (roles)',
      'Asignación de chats a vendedores',
      'Dashboard para directivos',
      'Permisos personalizados por rol',
      'Auto-aprendizaje con sugerencias',
      'Productos y catálogo',
      'Soporte prioritario'
    ],
    excluded: []
  }
};

export default function SubscriptionPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [exchangeRate, setExchangeRate] = useState(4200);
  const [selectedPeriod, setSelectedPeriod] = useState<'monthly' | 'semiannual' | 'annual'>('monthly');
  const [loading, setLoading] = useState(true);
  const [paymentLoading, setPaymentLoading] = useState('');
  const [subStatus, setSubStatus] = useState<any>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/login'); return; }

    try {
      const [userRes, plansRes, statusRes] = await Promise.all([
        fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/api/subscription/plans`),
        fetch(`${API_URL}/api/subscription/status`, { headers: { Authorization: `Bearer ${token}` } })
      ]);

      if (userRes.ok) {
        const d = await userRes.json();
        setUser(d.user);
      }
      if (plansRes.ok) {
        const d = await plansRes.json();
        setPlans(d.plans);
        setExchangeRate(d.exchangeRate);
      }
      if (statusRes.ok) {
        const d = await statusRes.json();
        setSubStatus(d);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handlePayment = async (planId: string) => {
    const token = localStorage.getItem('token');
    setPaymentLoading(planId);

    try {
      const res = await fetch(`${API_URL}/api/subscription/create-payment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, period: selectedPeriod })
      });

      if (!res.ok) throw new Error('Error al crear pago');
      const data = await res.json();

      // Abrir widget de Wompi
      const checkout = new (window as any).WidgetCheckout({
        currency: 'COP',
        amountInCents: data.amountInCents,
        reference: data.reference,
        publicKey: data.publicKey,
        signature: { integrity: data.signature },
        redirectUrl: data.redirectUrl,
        customerData: {
          email: data.customerEmail,
          fullName: data.customerName
        }
      });

      checkout.open((result: any) => {
        const transaction = result.transaction;
        if (transaction?.status === 'APPROVED') {
          alert('✅ ¡Pago aprobado! Tu plan se activará en segundos.');
          setTimeout(() => loadData(), 3000);
        } else if (transaction?.status === 'DECLINED') {
          alert('❌ Pago rechazado. Intenta con otro método.');
        }
        setPaymentLoading('');
      });
    } catch (e) {
      console.error(e);
      alert('Error al procesar el pago');
      setPaymentLoading('');
    }
  };

  const formatCOP = (n: number) => '$' + n.toLocaleString('es-CO');

  if (loading) return (
    <div className="min-h-screen bg-[#06060b] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const isExpired = user?.subscriptionStatus === 'expired' || user?.isBlocked;
  const isTrial = user?.plan === 'trial';
  const hasActiveSub = subStatus?.subscription?.status === 'active';

  return (
    <div className="min-h-screen bg-[#06060b] text-white">
      {/* Wompi Widget Script */}
      <script src="https://checkout.wompi.co/widget.js" async />

      {/* Header */}
      <div className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => router.push('/dashboard')} className="flex items-center gap-2 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-4 h-4" /> Volver al Dashboard
          </button>
          <div className="flex items-center gap-3">
            <img src="/elisa.png" alt="Elisa" className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-lg">Elisa <span className="text-emerald-400 font-light">IA</span></span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-12">

        {/* Trial Banner / Status */}
        {isTrial && (
          <div className={`mb-10 p-6 rounded-2xl border ${isExpired ? 'bg-red-500/10 border-red-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
            <div className="flex items-center gap-4">
              {isExpired ? <AlertTriangle className="w-8 h-8 text-red-400" /> : <Clock className="w-8 h-8 text-amber-400" />}
              <div>
                <h3 className={`text-lg font-bold ${isExpired ? 'text-red-400' : 'text-amber-400'}`}>
                  {isExpired ? '⏰ Tu período de prueba ha terminado' : `⏰ Te quedan ${user?.daysRemaining || 0} días de prueba gratuita`}
                </h3>
                <p className="text-gray-400 text-sm mt-1">
                  {isExpired
                    ? 'Elige un plan para seguir usando Elisa IA. No perderás tus datos ni configuraciones.'
                    : 'Aprovecha y elige tu plan antes de que termine. No perderás nada al actualizar.'}
                </p>
              </div>
              {!isExpired && user?.daysRemaining > 0 && (
                <div className="ml-auto text-right">
                  <div className="text-3xl font-black text-amber-400">{user.daysRemaining}</div>
                  <div className="text-xs text-gray-500">días</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Active Subscription Info */}
        {hasActiveSub && (
          <div className="mb-10 p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30">
            <div className="flex items-center gap-4">
              <Shield className="w-8 h-8 text-emerald-400" />
              <div>
                <h3 className="text-lg font-bold text-emerald-400">
                  Plan {subStatus.subscription.plan === 'starter' ? 'Starter' : 'Business'} Activo
                </h3>
                <p className="text-gray-400 text-sm">
                  Válido hasta {new Date(subStatus.subscription.currentPeriodEnd).toLocaleDateString('es-CO')} · {subStatus.daysRemaining} días restantes
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Title */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-black mb-4">
            Elige tu plan de <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Elisa IA</span>
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Automatiza tu negocio por WhatsApp. Todos los planes incluyen actualizaciones gratuitas.
          </p>
        </div>

        {/* Period Selector */}
        <div className="flex justify-center mb-12">
          <div className="flex bg-white/5 rounded-2xl p-1.5 border border-white/10">
            {[
              { id: 'monthly' as const, label: 'Mensual' },
              { id: 'semiannual' as const, label: '6 Meses', badge: '17% OFF' },
              { id: 'annual' as const, label: 'Anual', badge: '30% OFF' }
            ].map(p => (
              <button key={p.id} onClick={() => setSelectedPeriod(p.id)}
                className={`relative px-6 py-3 rounded-xl font-semibold text-sm transition-all ${selectedPeriod === p.id ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30' : 'text-gray-400 hover:text-white'}`}>
                {p.label}
                {p.badge && selectedPeriod === p.id && (
                  <span className="absolute -top-2 -right-2 bg-amber-500 text-black text-[10px] font-black px-2 py-0.5 rounded-full">{p.badge}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Plan Cards */}
        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {plans.map(plan => {
            const price = plan.prices[selectedPeriod];
            const features = PLAN_FEATURES[plan.id as keyof typeof PLAN_FEATURES];
            const isBusiness = plan.id === 'business';
            const isCurrentPlan = subStatus?.subscription?.plan === plan.id;

            return (
              <div key={plan.id}
                className={`relative rounded-3xl p-8 border transition-all ${
                  isBusiness
                    ? 'bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 border-emerald-500/40 shadow-xl shadow-emerald-500/10'
                    : 'bg-white/5 border-white/10 hover:border-white/20'
                }`}>
                
                {isBusiness && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white text-xs font-black px-4 py-1.5 rounded-full flex items-center gap-1">
                      <Star className="w-3 h-3" /> MÁS POPULAR
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <div className="flex items-center gap-3 mb-2">
                    {isBusiness ? <Building2 className="w-6 h-6 text-emerald-400" /> : <Rocket className="w-6 h-6 text-indigo-400" />}
                    <h3 className="text-2xl font-black">{plan.name}</h3>
                  </div>
                  <p className="text-gray-500 text-sm">
                    {isBusiness ? 'Para negocios serios que quieren CRM, equipo y todas las herramientas' : 'Ideal para emprendedores que arrancan con WhatsApp'}
                  </p>
                </div>

                {/* Pricing */}
                <div className="mb-8">
                  <div className="flex items-baseline gap-2">
                    <span className="text-gray-500 text-lg">USD$</span>
                    <span className="text-5xl font-black">{price.usd}</span>
                  </div>
                  <div className="text-gray-500 text-sm mt-1">
                    {selectedPeriod === 'monthly' ? 'por mes' : selectedPeriod === 'semiannual' ? 'por 6 meses' : 'por año'}
                  </div>
                  <div className="mt-2 text-emerald-400 text-sm font-semibold">
                    ≈ {formatCOP(price.cop)} COP
                  </div>
                  {price.savedPercent && (
                    <div className="mt-1 text-amber-400 text-xs font-bold">
                      💰 Ahorras USD${price.savedUsd} ({price.savedPercent}% de descuento)
                    </div>
                  )}
                  <div className="mt-2 text-gray-600 text-xs">
                    💳 Con tarjeta: {formatCOP(price.copWithCard)} COP (+5% procesadora)
                  </div>
                </div>

                {/* Features */}
                <div className="space-y-3 mb-8">
                  {features.included.map((f, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-300 text-sm">{f}</span>
                    </div>
                  ))}
                  {features.excluded.map((f, i) => (
                    <div key={i} className="flex items-start gap-3 opacity-40">
                      <X className="w-5 h-5 text-gray-600 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-600 text-sm">{f}</span>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <button
                  onClick={() => handlePayment(plan.id)}
                  disabled={!!paymentLoading || isCurrentPlan}
                  className={`w-full py-4 rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-2 ${
                    isCurrentPlan
                      ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                      : isBusiness
                        ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:shadow-lg hover:shadow-emerald-500/30 hover:scale-[1.02]'
                        : 'bg-white/10 text-white border border-white/20 hover:bg-white/15 hover:scale-[1.02]'
                  }`}>
                  {paymentLoading === plan.id ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : isCurrentPlan ? (
                    <>Plan Actual</>
                  ) : (
                    <>{isBusiness ? <Sparkles className="w-5 h-5" /> : <CreditCard className="w-5 h-5" />} Comenzar {isTrial ? 'ahora' : ''}</>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Payment Methods Info */}
        <div className="mt-12 text-center">
          <p className="text-gray-500 text-sm mb-4">Métodos de pago aceptados vía Wompi</p>
          <div className="flex justify-center gap-6 items-center opacity-60">
            <span className="text-2xl">💳</span>
            <span className="text-sm text-gray-400">Visa / Mastercard</span>
            <span className="text-2xl">🏦</span>
            <span className="text-sm text-gray-400">PSE</span>
            <span className="text-2xl">📱</span>
            <span className="text-sm text-gray-400">Nequi</span>
            <span className="text-2xl">🏧</span>
            <span className="text-sm text-gray-400">Bancolombia</span>
          </div>
          <p className="text-gray-600 text-xs mt-4">
            ⚡ Cada usuario conecta su propia API Key de OpenAI. Tú controlas tu consumo.
          </p>
          <p className="text-gray-600 text-xs mt-1">
            Pagos procesados de forma segura por <strong>Wompi</strong> · Tasa de cambio: 1 USD ≈ {formatCOP(exchangeRate)} COP
          </p>
        </div>

        {/* Payment History */}
        {subStatus?.payments?.length > 0 && (
          <div className="mt-16 max-w-3xl mx-auto">
            <h3 className="text-xl font-bold mb-6">Historial de Pagos</h3>
            <div className="space-y-3">
              {subStatus.payments.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                  <div>
                    <span className="font-semibold">{p.plan === 'starter' ? 'Starter' : 'Business'}</span>
                    <span className="text-gray-500 text-sm ml-2">({p.period})</span>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-400 font-bold">{formatCOP(p.amountCop)}</div>
                    <div className="text-gray-500 text-xs">{new Date(p.date).toLocaleDateString('es-CO')}</div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${p.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {p.status === 'approved' ? '✓ Aprobado' : p.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

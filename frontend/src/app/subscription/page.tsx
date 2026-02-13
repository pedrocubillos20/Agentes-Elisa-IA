'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Crown, Check, X, Clock, CreditCard, Shield, Zap, ArrowLeft, AlertTriangle, Star, Sparkles, Building2, Rocket, ChevronDown, Tag, Percent, Gift, Info } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://elisa-ia-agentes-production.up.railway.app';

const PLAN_FEATURES: Record<string, { included: string[]; excluded: string[] }> = {
  starter: {
    included: [
      'Asistente IA con WhatsApp',
      '2 líneas de WhatsApp',
      'Conversaciones ilimitadas',
      'CRM + Pipeline de ventas',
      'Agenda automática',
      'Base de conocimiento',
      'Multimedia (imágenes, videos)',
      'Dashboard y métricas',
      'Hasta 10 productos de catálogo',
    ],
    excluded: ['Equipo multi-usuario', 'Asignación de chats', 'Integraciones API']
  },
  business: {
    included: [
      'Todo de Starter +',
      '5 líneas de WhatsApp',
      'Productos ilimitados',
      'Equipo completo (roles)',
      'Asignación de chats a vendedores',
      'Dashboard para directivos',
      'Permisos personalizados',
      'Integraciones API',
      'Soporte prioritario'
    ],
    excluded: []
  },
  implementation: {
    included: [
      'Implementación completa por expertos',
      '5 líneas de WhatsApp incluidas',
      'Configuración profesional de IA',
      'Base de conocimiento personalizada',
      'CRM + Pipeline configurado',
      'Agenda automática',
      'Equipo + asignación de chats',
      'Soporte prioritario por WhatsApp',
      '10 productos de catálogo incluidos',
      'Dashboard de métricas y resultados',
      'Pago único — Sin mensualidades',
    ],
    excluded: []
  }
};

export default function SubscriptionPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [exchangeRate, setExchangeRate] = useState(4200);
  const [exchangeSource, setExchangeSource] = useState('');
  const [exchangeDate, setExchangeDate] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState<'monthly' | 'semiannual' | 'annual'>('monthly');
  const [loading, setLoading] = useState(true);
  const [paymentLoading, setPaymentLoading] = useState('');
  const [subStatus, setSubStatus] = useState<any>(null);

  // Discount code state
  const [discountCode, setDiscountCode] = useState('');
  const [discountLoading, setDiscountLoading] = useState(false);
  const [discountResult, setDiscountResult] = useState<any>(null);
  const [discountError, setDiscountError] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState<any>(null);

  useEffect(() => {
    loadData();
    // Verificar si hay un pago pendiente al cargar (ej: retorno de Wompi redirect)
    checkPendingPayment();
  }, []);

  // Re-validate discount when plan/period changes
  useEffect(() => {
    if (appliedDiscount) {
      validateDiscount(appliedDiscount.code);
    }
  }, [selectedPeriod]);

  // Verificar pagos pendientes al cargar la página (retorno de Wompi)
  const checkPendingPayment = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    // Buscar la referencia más reciente en localStorage
    const lastRef = localStorage.getItem('lastPaymentReference');
    if (!lastRef) return;
    
    try {
      const res = await fetch(`${API_URL}/api/subscription/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reference: lastRef })
      });
      const data = await res.json();
      
      if (data.status === 'APPROVED' && data.activated) {
        localStorage.removeItem('lastPaymentReference');
        alert(`✅ ¡Tu plan ${data.plan} ha sido activado exitosamente!`);
        loadData();
      } else if (data.status === 'PENDING') {
        // Seguir esperando — no hacer nada
        console.log('⏳ Pago aún pendiente:', lastRef);
      } else if (data.status === 'DECLINED' || data.status === 'ERROR') {
        localStorage.removeItem('lastPaymentReference');
      }
    } catch (e) {
      console.error('Error verificando pago pendiente:', e);
    }
  };

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
        setExchangeSource(d.exchangeSource || '');
        setExchangeDate(d.exchangeDate || '');
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

  const validateDiscount = async (code: string, planId?: string) => {
    const token = localStorage.getItem('token');
    setDiscountLoading(true);
    setDiscountError('');
    setDiscountResult(null);

    try {
      const res = await fetch(`${API_URL}/api/subscription/validate-discount`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, plan: planId || '', period: selectedPeriod })
      });

      const data = await res.json();

      if (!res.ok || !data.valid) {
        setDiscountError(data.error || 'Código inválido');
        setAppliedDiscount(null);
        setDiscountResult(null);
      } else {
        setDiscountResult(data);
        setAppliedDiscount(data);
        setDiscountError('');
      }
    } catch (e) {
      setDiscountError('Error al validar código');
      setAppliedDiscount(null);
    }
    setDiscountLoading(false);
  };

  const handleApplyDiscount = () => {
    if (!discountCode.trim()) return;
    validateDiscount(discountCode.trim());
  };

  const handleRemoveDiscount = () => {
    setDiscountCode('');
    setDiscountResult(null);
    setAppliedDiscount(null);
    setDiscountError('');
  };

  const handlePayment = async (planId: string) => {
    const token = localStorage.getItem('token');
    setPaymentLoading(planId);

    try {
      const isImpl = planId === 'implementation';
      const res = await fetch(`${API_URL}/api/subscription/create-payment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          plan: planId, 
          period: isImpl ? 'one_time' : selectedPeriod,
          discountCode: appliedDiscount?.code || null,
          ...(isImpl && { addons: { extraLines: 0, extraProducts: 0 } })
        })
      });

      if (!res.ok) throw new Error('Error al crear pago');
      const data = await res.json();

      // Guardar referencia para verificar después
      localStorage.setItem('lastPaymentReference', data.reference);

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

      checkout.open(async (result: any) => {
        const transaction = result.transaction;
        console.log('💳 Wompi resultado:', transaction?.status, transaction?.id);
        
        if (transaction?.status === 'APPROVED') {
          // Verificar y activar inmediatamente
          try {
            const verifyRes = await fetch(`${API_URL}/api/subscription/verify-payment`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ reference: data.reference })
            });
            const verifyData = await verifyRes.json();
            if (verifyData.activated) {
              alert(`✅ ¡Pago aprobado! Tu plan ${verifyData.plan} está activo.`);
            } else {
              alert('✅ ¡Pago aprobado! Tu plan se activará en segundos.');
            }
          } catch (e) {
            alert('✅ ¡Pago aprobado! Tu plan se activará en segundos.');
          }
          handleRemoveDiscount();
          localStorage.removeItem('lastPaymentReference');
          setTimeout(() => loadData(), 2000);
        } else if (transaction?.status === 'PENDING') {
          // Nequi, PSE — pago pendiente, necesita polling
          alert('⏳ Pago pendiente. Si pagaste con Nequi, confirma en tu app. Verificaremos automáticamente...');
          // Polling cada 5 segundos, máximo 12 intentos (60 seg)
          let attempts = 0;
          const pollInterval = setInterval(async () => {
            attempts++;
            try {
              const verifyRes = await fetch(`${API_URL}/api/subscription/verify-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ reference: data.reference })
              });
              const verifyData = await verifyRes.json();
              
              if (verifyData.status === 'APPROVED' && verifyData.activated) {
                clearInterval(pollInterval);
                localStorage.removeItem('lastPaymentReference');
                alert(`✅ ¡Pago confirmado! Tu plan ${verifyData.plan} está activo.`);
                handleRemoveDiscount();
                loadData();
              } else if (verifyData.status === 'DECLINED' || verifyData.status === 'ERROR' || verifyData.status === 'VOIDED') {
                clearInterval(pollInterval);
                localStorage.removeItem('lastPaymentReference');
                alert('❌ Pago rechazado o cancelado. Intenta con otro método.');
              }
            } catch (e) {
              console.error('Error verificando pago:', e);
            }
            if (attempts >= 12) {
              clearInterval(pollInterval);
              loadData(); // Cargar estado final
            }
          }, 5000);
        } else if (transaction?.status === 'DECLINED') {
          alert('❌ Pago rechazado. Intenta con otro método.');
          localStorage.removeItem('lastPaymentReference');
        } else {
          // Widget cerrado sin resultado claro — verificar por si acaso
          setTimeout(async () => {
            try {
              const verifyRes = await fetch(`${API_URL}/api/subscription/verify-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ reference: data.reference })
              });
              const verifyData = await verifyRes.json();
              if (verifyData.status === 'APPROVED' && verifyData.activated) {
                alert(`✅ ¡Pago confirmado! Tu plan ${verifyData.plan} está activo.`);
                handleRemoveDiscount();
              }
              loadData();
            } catch (e) {
              loadData();
            }
          }, 3000);
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

  // Calculate discounted price for a plan
  const getDiscountedPrice = (planId: string, originalCop: number, copWithCard: number) => {
    if (!appliedDiscount || !appliedDiscount.valid) return null;
    
    // Check if discount applies to this plan
    if (appliedDiscount.applicablePlans?.length > 0 && !appliedDiscount.applicablePlans.includes(planId)) {
      return null;
    }
    if (appliedDiscount.applicablePeriods?.length > 0 && !appliedDiscount.applicablePeriods.includes(selectedPeriod)) {
      return null;
    }

    let discountAmount = 0;
    if (appliedDiscount.discountType === 'percent') {
      discountAmount = Math.round(originalCop * (appliedDiscount.discountValue / 100));
    } else if (appliedDiscount.discountType === 'fixed_usd') {
      discountAmount = Math.round(appliedDiscount.discountValue * exchangeRate);
    } else if (appliedDiscount.discountType === 'fixed_cop') {
      discountAmount = Math.round(appliedDiscount.discountValue);
    }

    discountAmount = Math.min(discountAmount, originalCop);
    const finalCop = originalCop - discountAmount;
    const finalWithCard = Math.round(finalCop * 1.05);

    return {
      discountAmount,
      finalCop,
      finalWithCard,
      savedPercent: Math.round((discountAmount / originalCop) * 100)
    };
  };

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
            <img src="/bizonne.png" alt="Bizonne" className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-lg">Bizonne <span className="text-emerald-400 font-light">IA</span></span>
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
                    ? 'Elige un plan para seguir usando Bizonne. No perderás tus datos ni configuraciones.'
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

        {hasActiveSub && (
          <div className="mb-10 p-6 rounded-2xl border bg-emerald-500/10 border-emerald-500/30">
            <div className="flex items-center gap-4">
              <Shield className="w-8 h-8 text-emerald-400" />
              <div>
                <h3 className="text-lg font-bold text-emerald-400">✅ Plan {subStatus.subscription.plan === 'business' ? 'Business' : 'Starter'} activo</h3>
                <p className="text-gray-400 text-sm mt-1">
                  Tu suscripción está activa hasta {new Date(subStatus.subscription.currentPeriodEnd).toLocaleDateString('es-CO')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Title */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-black mb-4">
            Elige tu plan de <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Bizonne</span>
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Automatiza tu negocio por WhatsApp. Todos los planes incluyen actualizaciones gratuitas.
          </p>
        </div>

        {/* Period Selector */}
        <div className="flex justify-center mb-8">
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

        {/* Discount Code Section */}
        <div className="max-w-lg mx-auto mb-10">
          <div className="bg-white/5 rounded-2xl border border-white/10 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Tag className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-semibold text-gray-300">¿Tienes un código de descuento?</span>
            </div>

            {appliedDiscount ? (
              // Discount applied - show badge
              <div className="flex items-center justify-between bg-purple-500/10 border border-purple-500/30 rounded-xl px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                    <Gift className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-purple-300">{appliedDiscount.code}</span>
                      <span className="text-[10px] bg-purple-500/30 text-purple-300 px-2 py-0.5 rounded-full font-bold">
                        {appliedDiscount.discountType === 'percent' ? `${appliedDiscount.discountValue}% OFF` : 
                         appliedDiscount.discountType === 'fixed_usd' ? `$${appliedDiscount.discountValue} USD OFF` :
                         `${formatCOP(appliedDiscount.discountValue)} OFF`}
                      </span>
                    </div>
                    {appliedDiscount.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{appliedDiscount.description}</p>
                    )}
                  </div>
                </div>
                <button onClick={handleRemoveDiscount} className="p-1.5 hover:bg-white/10 rounded-lg transition">
                  <X className="w-4 h-4 text-gray-500 hover:text-red-400" />
                </button>
              </div>
            ) : (
              // Input to enter code
              <div className="flex gap-2">
                <input
                  type="text"
                  value={discountCode}
                  onChange={e => { setDiscountCode(e.target.value.toUpperCase()); setDiscountError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleApplyDiscount()}
                  placeholder="Ej: BIENVENIDO20"
                  className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-600 focus:border-purple-500/50 focus:outline-none uppercase tracking-wider"
                />
                <button
                  onClick={handleApplyDiscount}
                  disabled={!discountCode.trim() || discountLoading}
                  className="px-5 py-3 bg-purple-500/20 border border-purple-500/30 text-purple-300 rounded-xl text-sm font-semibold hover:bg-purple-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {discountLoading ? (
                    <div className="w-4 h-4 border-2 border-purple-300/30 border-t-purple-300 rounded-full animate-spin" />
                  ) : (
                    <>
                      <Percent className="w-4 h-4" /> Aplicar
                    </>
                  )}
                </button>
              </div>
            )}

            {discountError && (
              <p className="text-red-400 text-xs mt-2 flex items-center gap-1">
                <X className="w-3 h-3" /> {discountError}
              </p>
            )}
          </div>
        </div>

        {/* Plan Cards */}
        <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {plans.filter(p => p.id !== 'implementation').map(plan => {
            const price = plan.prices[selectedPeriod];
            if (!price) return null;
            const features = PLAN_FEATURES[plan.id as keyof typeof PLAN_FEATURES];
            const isBusiness = plan.id === 'business';
            const isCurrentPlan = subStatus?.subscription?.plan === plan.id;
            const discount = getDiscountedPrice(plan.id, price.cop, price.copWithCard);

            return (
              <div key={plan.id}
                className={`relative rounded-3xl p-6 border transition-all ${
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

                <div className="mb-5">
                  <div className="flex items-center gap-3 mb-2">
                    {isBusiness ? <Building2 className="w-5 h-5 text-emerald-400" /> : <Rocket className="w-5 h-5 text-indigo-400" />}
                    <h3 className="text-xl font-black">{plan.name}</h3>
                  </div>
                  <p className="text-gray-500 text-xs">
                    {isBusiness ? 'Para negocios que necesitan CRM, equipo y todas las herramientas' : 'Ideal para emprendedores que arrancan con WhatsApp'}
                  </p>
                </div>

                {/* Pricing */}
                <div className="mb-6">
                  <div className="flex items-baseline gap-2">
                    <span className="text-gray-500 text-sm">USD$</span>
                    <span className="text-4xl font-black">{price.usd}</span>
                  </div>
                  <div className="text-gray-500 text-xs mt-1">
                    {selectedPeriod === 'monthly' ? 'por mes' : selectedPeriod === 'semiannual' ? 'por 6 meses' : 'por año'}
                  </div>

                  {discount ? (
                    <div className="mt-2 p-2 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 text-xs line-through">{formatCOP(price.cop)}</span>
                        <span className="text-purple-400 text-sm font-black">{formatCOP(discount.finalCop)} COP</span>
                      </div>
                      <div className="text-purple-300 text-[10px] mt-1">
                        💰 Ahorras {formatCOP(discount.discountAmount)} ({discount.savedPercent}% OFF)
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mt-1 text-emerald-400 text-xs font-semibold">≈ {formatCOP(price.cop)} COP</div>
                      {price.savedPercent && (
                        <div className="mt-1 text-amber-400 text-[10px] font-bold">💰 Ahorras {price.savedPercent}%</div>
                      )}
                      <div className="mt-1 text-gray-600 text-[10px]">💳 Con tarjeta: {formatCOP(price.copWithCard)} COP (+5%)</div>
                    </>
                  )}
                </div>

                {/* Features */}
                <div className="space-y-2 mb-6">
                  {features?.included.map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-300 text-xs">{f}</span>
                    </div>
                  ))}
                  {features?.excluded.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 opacity-40">
                      <X className="w-4 h-4 text-gray-600 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-600 text-xs">{f}</span>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <button
                  onClick={() => handlePayment(plan.id)}
                  disabled={!!paymentLoading || isCurrentPlan}
                  className={`w-full py-3 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
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
                    <><CreditCard className="w-4 h-4" /> {isBusiness ? 'Activar Business' : 'Activar Starter'}</>
                  )}
                </button>
              </div>
            );
          })}

          {/* ===== PLAN IMPLEMENTACIÓN ===== */}
          {(() => {
            const implPlan = plans.find(p => p.id === 'implementation');
            if (!implPlan) return null;
            const implFeatures = PLAN_FEATURES.implementation;
            const isCurrentImpl = subStatus?.subscription?.plan === 'implementation';
            const implPrice = implPlan.prices?.oneTime;
            if (!implPrice) return null;
            
            return (
              <div className="relative rounded-3xl p-6 border bg-gradient-to-br from-orange-500/10 to-amber-500/5 border-orange-500/40 shadow-xl shadow-orange-500/10">
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-black px-4 py-1.5 rounded-full flex items-center gap-1">
                    🛠️ SERVICIO COMPLETO
                  </span>
                </div>

                <div className="mb-5">
                  <div className="flex items-center gap-3 mb-2">
                    <Shield className="w-5 h-5 text-orange-400" />
                    <h3 className="text-xl font-black">{implPlan.name}</h3>
                  </div>
                  <p className="text-gray-500 text-xs">
                    Nosotros configuramos todo tu negocio. Tú solo vendes.
                  </p>
                </div>

                {/* Pricing */}
                <div className="mb-5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-gray-500 text-sm">USD$</span>
                    <span className="text-4xl font-black">{implPrice.usd}</span>
                  </div>
                  <div className="text-orange-400 text-xs font-bold mt-1">💎 Pago único — Sin mensualidades</div>
                  <div className="mt-1 text-gray-400 text-xs">≈ {formatCOP(implPrice.cop)} COP</div>
                  <div className="text-gray-600 text-[10px]">💳 Con tarjeta: {formatCOP(implPrice.copWithCard)} COP (+5%)</div>
                </div>

                {/* Add-ons */}
                {implPlan.addons && (
                  <div className="mb-5 p-3 bg-white/5 rounded-xl border border-white/10">
                    <div className="text-xs font-bold text-white mb-2 flex items-center gap-1">
                      <Zap className="w-3 h-3 text-orange-400" /> Servicios adicionales
                    </div>
                    <div className="space-y-1 text-[10px] text-gray-400">
                      <div className="flex justify-between">
                        <span>📱 Línea WhatsApp adicional</span>
                        <span className="text-orange-300 font-bold">${implPlan.addons.extraLine.usd} USD c/u</span>
                      </div>
                      <div className="flex justify-between">
                        <span>📦 +10 productos de catálogo</span>
                        <span className="text-orange-300 font-bold">${implPlan.addons.extraProducts.usd} USD</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Features */}
                <div className="space-y-2 mb-6">
                  {implFeatures.included.map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-300 text-xs">{f}</span>
                    </div>
                  ))}
                </div>

                {/* What we do for you */}
                <div className="mb-5 p-3 bg-orange-500/5 rounded-xl border border-orange-500/15">
                  <div className="text-xs font-bold text-orange-300 mb-2">🎯 Lo que hacemos por ti:</div>
                  <div className="space-y-1 text-[10px] text-gray-400">
                    <div>✓ Configuración completa del asistente IA</div>
                    <div>✓ Entrenamiento con tu base de conocimiento</div>
                    <div>✓ Integración y conexión de WhatsApp</div>
                    <div>✓ Diseño del pipeline de ventas (CRM)</div>
                    <div>✓ Carga de productos y catálogo</div>
                    <div>✓ Capacitación de uso de la plataforma</div>
                  </div>
                </div>

                <button
                  onClick={() => handlePayment('implementation')}
                  disabled={!!paymentLoading || isCurrentImpl}
                  className={`w-full py-3 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                    isCurrentImpl
                      ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:shadow-lg hover:shadow-orange-500/30 hover:scale-[1.02]'
                  }`}>
                  {paymentLoading === 'implementation' ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : isCurrentImpl ? (
                    <>Plan Actual</>
                  ) : (
                    <><Shield className="w-4 h-4" /> Contratar Implementación</>
                  )}
                </button>
              </div>
            );
          })()}
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
          <div className="flex items-center justify-center gap-1 mt-2">
            <p className="text-gray-600 text-xs">
              Pagos procesados de forma segura por <strong>Wompi</strong> · TRM: 1 USD ≈ {formatCOP(exchangeRate)} COP
            </p>
            {exchangeSource && (
              <div className="group relative">
                <Info className="w-3 h-3 text-gray-600 cursor-help" />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-800 text-gray-300 text-[10px] px-3 py-1.5 rounded-lg whitespace-nowrap border border-white/10 shadow-lg z-10">
                  Fuente: {exchangeSource}{exchangeDate ? ` · ${exchangeDate}` : ''}
                </div>
              </div>
            )}
          </div>
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
                    {p.discountCode && (
                      <span className="ml-2 text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full font-bold">
                        🏷️ {p.discountCode} {p.discountPercent ? `(-${p.discountPercent}%)` : ''}
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-400 font-bold">{formatCOP(p.amountCop)}</div>
                    {p.discountAmount && (
                      <div className="text-purple-400 text-[10px]">Ahorraste {formatCOP(p.discountAmount)}</div>
                    )}
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

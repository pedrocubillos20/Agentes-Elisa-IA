'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CreditCard, Shield, Check, ArrowRight, Zap, Building2, Mail, User, ChevronDown, Clock, Star } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const PLANS: Record<string, any> = {
  starter: {
    name: 'Bizonne Starter',
    icon: Zap,
    color: '#10b981',
    features: ['Asistente IA con WhatsApp', '2 líneas de WhatsApp', 'Conversaciones ilimitadas', 'CRM + Pipeline de ventas', 'Agenda automática', 'Base de conocimiento', 'Multimedia (imágenes, videos, audios, PDF)', 'Transcripción de audios con IA', 'Dashboard y métricas', 'Hasta 10 productos de catálogo']
  },
  business: {
    name: 'Bizonne Business',
    icon: Building2,
    color: '#3b82f6',
    popular: true,
    features: ['Todo de Starter +', '5 líneas de WhatsApp', 'Hasta 20 productos de catálogo', 'Equipo completo (roles)', 'Asignación de chats a vendedores', 'Dashboard para directivos', 'Estadísticas por sub-usuario', 'Permisos personalizados', 'Integraciones API', 'Soporte prioritario (6 meses)']
  }
};

export default function CheckoutPage() {
  const searchParams = useSearchParams();
  const planParam = searchParams.get('plan') || 'starter';
  const periodParam = searchParams.get('period') || 'monthly';

  const [plan, setPlan] = useState(planParam);
  const [period, setPeriod] = useState(periodParam);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [prices, setPrices] = useState<any>(null);
  const [trm, setTrm] = useState<any>(null);

  const planInfo = PLANS[plan] || PLANS.starter;
  const PlanIcon = planInfo.icon;

  useEffect(() => {
    fetchPrices();
  }, []);

  const fetchPrices = async () => {
    try {
      const res = await fetch(`${API_URL}/api/payments/plans`);
      const data = await res.json();
      setPrices(data.plans);
      if (data.trm) setTrm(data.trm);
    } catch { console.error('Error fetching prices'); }
  };

  const getPrice = () => {
    if (!prices) return { cop: 0, usd: 0, label: '', copWithCard: 0 };
    const p = prices.find((x: any) => x.id === plan);
    if (!p) return { cop: 0, usd: 0, label: '', copWithCard: 0 };
    const pr = p.periods.find((x: any) => x.period === period);
    return pr || { cop: 0, usd: 0, label: '', copWithCard: 0 };
  };

  const price = getPrice();

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { setError('Ingresa tu email'); return; }
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/api/payments/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, period, email: email.trim(), name: name.trim() })
      });
      const data = await res.json();

      if (res.ok && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        setError(data.error || 'Error al procesar');
      }
    } catch { setError('Error de conexión'); }
    finally { setLoading(false); }
  };

  const periodLabels: Record<string, string> = { monthly: 'Mensual', semiannual: '6 Meses', annual: 'Anual' };
  const periodSavings: Record<string, string> = { monthly: '', semiannual: 'Ahorra ~17%', annual: 'Ahorra ~30%' };

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0a0a1a 0%, #0f1b2d 50%, #0a0a1a 100%)' }}>
      {/* Header */}
      <div className="border-b" style={{ borderColor: '#1a2a3e' }}>
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/bizonne.png" alt="Bizonne" className="w-8 h-8 rounded-lg" />
            <span className="text-xl font-bold"><span style={{ color: '#00d4aa' }}>Bizonne</span><span className="text-white">CRM</span></span>
          </Link>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Shield className="w-4 h-4" style={{ color: '#10b981' }} />
            <span>Pago seguro con Wompi</span>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 md:py-12">
        <div className="grid md:grid-cols-2 gap-8 md:gap-12">
          
          {/* LEFT — Plan Details */}
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Finaliza tu compra</h1>
            <p className="text-gray-400 mb-8">Selecciona tu plan y período de facturación</p>

            {/* Plan Selector */}
            <div className="flex gap-3 mb-6">
              {Object.entries(PLANS).map(([id, info]) => (
                <button key={id} onClick={() => setPlan(id)}
                  className="flex-1 p-4 rounded-xl border-2 transition-all relative"
                  style={{
                    borderColor: plan === id ? info.color : '#2a2a3e',
                    background: plan === id ? `${info.color}10` : '#1a1a2e'
                  }}>
                  {info.popular && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: info.color, color: '#fff' }}>
                      POPULAR
                    </span>
                  )}
                  <info.icon className="w-5 h-5 mb-2" style={{ color: info.color }} />
                  <p className="font-semibold text-white text-sm">{info.name.replace('Bizonne ', '')}</p>
                </button>
              ))}
            </div>

            {/* Period Selector */}
            <div className="grid grid-cols-3 gap-2 mb-6">
              {['monthly', 'semiannual', 'annual'].map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className="p-3 rounded-xl border transition-all text-center"
                  style={{
                    borderColor: period === p ? '#00d4aa' : '#2a2a3e',
                    background: period === p ? '#00d4aa10' : '#1a1a2e'
                  }}>
                  <p className="text-sm font-medium" style={{ color: period === p ? '#00d4aa' : '#999' }}>{periodLabels[p]}</p>
                  {periodSavings[p] && (
                    <p className="text-[10px] mt-1" style={{ color: period === p ? '#10b981' : '#666' }}>{periodSavings[p]}</p>
                  )}
                </button>
              ))}
            </div>

            {/* Price */}
            <div className="p-6 rounded-2xl mb-6" style={{ background: '#1a1a2e', border: '1px solid #2a2a3e' }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${planInfo.color}20` }}>
                    <PlanIcon className="w-5 h-5" style={{ color: planInfo.color }} />
                  </div>
                  <div>
                    <p className="font-semibold text-white">{planInfo.name}</p>
                    <p className="text-xs text-gray-500">{periodLabels[period]}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold" style={{ color: '#00d4aa' }}>
                    ${price.cop?.toLocaleString('es-CO')}
                  </p>
                  <p className="text-xs text-gray-500">COP (≈ USD ${price.usd})</p>
                </div>
              </div>
              
              <div className="border-t pt-4 mt-4" style={{ borderColor: '#2a2a3e' }}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Total a pagar</span>
                  <span className="text-lg font-bold text-white">${price.cop?.toLocaleString('es-CO')} COP</span>
                </div>
                {price.copWithCard && price.copWithCard !== price.cop && (
                  <p className="text-[10px] text-gray-600 mt-1 text-right">💳 Con tarjeta: ${price.copWithCard?.toLocaleString('es-CO')} COP (+5%)</p>
                )}
                {trm && (
                  <p className="text-[10px] text-gray-600 mt-2 text-center">
                    Fuente: {trm.source} - {trm.date} · TRM: 1 USD ≈ ${trm.rate?.toLocaleString('es-CO')} COP
                  </p>
                )}
              </div>
            </div>

            {/* Features */}
            <div className="hidden md:block">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-3 font-semibold">Incluye:</p>
              <div className="grid grid-cols-1 gap-2">
                {planInfo.features.map((f: string, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <Check className="w-4 h-4 flex-shrink-0" style={{ color: planInfo.color }} />
                    <span className="text-sm text-gray-300">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT — Payment Form */}
          <div>
            <div className="rounded-2xl p-6 md:p-8 sticky top-8" style={{ background: '#1a1a2e', border: '1px solid #2a2a3e' }}>
              <h2 className="text-xl font-bold text-white mb-1">Información de pago</h2>
              <p className="text-gray-400 text-sm mb-6">Te enviaremos el acceso a tu email después del pago</p>

              <form onSubmit={handleCheckout} className="space-y-4">
                {error && (
                  <div className="p-3 rounded-xl text-sm" style={{ background: '#ef444420', border: '1px solid #ef444440', color: '#f87171' }}>
                    {error}
                  </div>
                )}

                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Nombre completo</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input type="text" value={name} onChange={e => setName(e.target.value)}
                      placeholder="Tu nombre" required
                      className="w-full pl-10 pr-4 py-3 rounded-xl text-white text-sm outline-none transition-all"
                      style={{ background: '#0f1b2d', border: '1px solid #2a2a3e' }} />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="tu@email.com" required
                      className="w-full pl-10 pr-4 py-3 rounded-xl text-white text-sm outline-none transition-all"
                      style={{ background: '#0f1b2d', border: '1px solid #2a2a3e' }} />
                  </div>
                  <p className="text-xs text-gray-600 mt-1">Recibirás el enlace de activación aquí</p>
                </div>

                <button type="submit" disabled={loading}
                  className="w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all"
                  style={{
                    background: loading ? '#333' : 'linear-gradient(135deg, #00d4aa, #10b981)',
                    color: loading ? '#888' : '#000',
                    opacity: loading ? 0.7 : 1
                  }}>
                  {loading ? (
                    <><Clock className="w-5 h-5 animate-spin" /> Procesando...</>
                  ) : (
                    <><CreditCard className="w-5 h-5" /> Pagar ${price.cop?.toLocaleString('es-CO')} COP</>
                  )}
                </button>
              </form>

              {/* Trust badges */}
              <div className="mt-6 pt-6 border-t" style={{ borderColor: '#2a2a3e' }}>
                <div className="flex items-center justify-center gap-4 flex-wrap">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Shield className="w-3.5 h-3.5" style={{ color: '#10b981' }} />
                    <span>Pago seguro SSL</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <CreditCard className="w-3.5 h-3.5" style={{ color: '#3b82f6' }} />
                    <span>Tarjeta • PSE • Nequi</span>
                  </div>
                </div>
                <div className="flex items-center justify-center mt-3">
                  <img src="https://cdn.wompi.co/widgets/assets/logos/full-colored.svg" alt="Wompi" className="h-5 opacity-50" />
                </div>
              </div>

              {/* Guarantee */}
              <div className="mt-4 p-3 rounded-xl text-center" style={{ background: '#10b98110', border: '1px solid #10b98130' }}>
                <p className="text-xs" style={{ color: '#10b981' }}>
                  🛡️ Garantía de 7 días — Si no estás satisfecho, te devolvemos tu dinero.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

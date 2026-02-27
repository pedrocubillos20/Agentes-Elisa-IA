'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CreditCard, Shield, Check, Zap, Building2, Mail, User, Clock } from 'lucide-react';

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

  // Force body to be scrollable on mount (fixes WebView/Facebook browser)
  useEffect(() => {
    document.documentElement.style.overflow = 'auto';
    document.documentElement.style.height = 'auto';
    document.body.style.overflow = 'auto';
    document.body.style.height = 'auto';
    document.body.style.position = 'static';
    // Hide the main app sidebar/layout
    const mainLayout = document.getElementById('app-layout');
    if (mainLayout) mainLayout.style.display = 'none';
    return () => {
      if (mainLayout) mainLayout.style.display = '';
      document.documentElement.style.overflow = '';
      document.documentElement.style.height = '';
      document.body.style.overflow = '';
      document.body.style.height = '';
      document.body.style.position = '';
    };
  }, []);

  useEffect(() => { fetchPrices(); }, []);

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

  // ═══════════════════════════════════════════
  // NO position:fixed — normal document flow
  // Scroll works on ALL browsers and WebViews
  // ═══════════════════════════════════════════
  return (
    <div style={{
      minHeight: '100vh',
      minHeight: '100dvh',
      background: 'linear-gradient(180deg, #0a0a1a 0%, #0f1b2d 100%)',
    }}>
      {/* ─── HEADER ─── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(10,10,26,0.97)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #1a2a3e',
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <img src="/bizonne.png" alt="Bizonne" style={{ width: 26, height: 26, borderRadius: 6 }} />
          <span style={{ fontSize: 16, fontWeight: 700 }}>
            <span style={{ color: '#00d4aa' }}>Bizonne</span>
            <span style={{ color: '#fff' }}>CRM</span>
          </span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#666' }}>
          <Shield style={{ width: 12, height: 12, color: '#10b981' }} />
          <span>Pago seguro con Wompi</span>
        </div>
      </div>

      {/* ─── BODY ─── */}
      <div style={{ maxWidth: 500, margin: '0 auto', padding: '20px 16px 80px' }}>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Finaliza tu compra</h1>
        <p style={{ color: '#777', fontSize: 13, margin: '0 0 20px' }}>Selecciona plan y período</p>

        {/* ─── PLAN SELECTOR ─── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {Object.entries(PLANS).map(([id, info]) => (
            <button key={id} onClick={() => setPlan(id)} style={{
              flex: 1, padding: '12px 10px', borderRadius: 10,
              border: `2px solid ${plan === id ? info.color : '#2a2a3e'}`,
              background: plan === id ? `${info.color}10` : '#1a1a2e',
              cursor: 'pointer', position: 'relative', textAlign: 'left',
            }}>
              {info.popular && (
                <span style={{
                  position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)',
                  fontSize: 8, fontWeight: 700, padding: '1px 6px', borderRadius: 99,
                  background: info.color, color: '#fff',
                }}>POPULAR</span>
              )}
              <info.icon style={{ width: 18, height: 18, color: info.color, marginBottom: 4 }} />
              <p style={{ fontWeight: 600, color: '#fff', fontSize: 13, margin: 0 }}>{info.name.replace('Bizonne ', '')}</p>
            </button>
          ))}
        </div>

        {/* ─── PERIOD ─── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {['monthly', 'semiannual', 'annual'].map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              flex: 1, padding: '8px 6px', borderRadius: 8, textAlign: 'center',
              border: `1.5px solid ${period === p ? '#00d4aa' : '#2a2a3e'}`,
              background: period === p ? '#00d4aa10' : '#1a1a2e', cursor: 'pointer',
            }}>
              <p style={{ fontSize: 12, fontWeight: 500, color: period === p ? '#00d4aa' : '#999', margin: 0 }}>{periodLabels[p]}</p>
              {periodSavings[p] && <p style={{ fontSize: 8, margin: '2px 0 0', color: period === p ? '#10b981' : '#555' }}>{periodSavings[p]}</p>}
            </button>
          ))}
        </div>

        {/* ─── PRICE ─── */}
        <div style={{ padding: 16, borderRadius: 14, background: '#1a1a2e', border: '1px solid #2a2a3e', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${planInfo.color}20` }}>
                <PlanIcon style={{ width: 18, height: 18, color: planInfo.color }} />
              </div>
              <div>
                <p style={{ fontWeight: 600, color: '#fff', fontSize: 13, margin: 0 }}>{planInfo.name}</p>
                <p style={{ fontSize: 10, color: '#888', margin: 0 }}>{periodLabels[period]}</p>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 20, fontWeight: 700, color: '#00d4aa', margin: 0 }}>${price.cop?.toLocaleString('es-CO')}</p>
              <p style={{ fontSize: 10, color: '#888', margin: 0 }}>COP (≈ USD ${price.usd})</p>
            </div>
          </div>
          <div style={{ borderTop: '1px solid #2a2a3e', paddingTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#aaa', fontSize: 12 }}>Total</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>${price.cop?.toLocaleString('es-CO')} COP</span>
            </div>
            {price.copWithCard > 0 && price.copWithCard !== price.cop && (
              <p style={{ fontSize: 9, color: '#666', margin: '4px 0 0', textAlign: 'right' }}>💳 Tarjeta: ${price.copWithCard?.toLocaleString('es-CO')} COP (+5%)</p>
            )}
            {trm && (
              <p style={{ fontSize: 8, color: '#555', margin: '6px 0 0', textAlign: 'center' }}>
                {trm.source} - {trm.date} · TRM: 1 USD ≈ ${trm.rate?.toLocaleString('es-CO')} COP
              </p>
            )}
          </div>
        </div>

        {/* ─── FORM ─── */}
        <div style={{ padding: '20px 16px', borderRadius: 14, background: '#1a1a2e', border: '1px solid #2a2a3e', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: '0 0 2px' }}>Información de pago</h2>
          <p style={{ color: '#777', fontSize: 12, margin: '0 0 16px' }}>Acceso enviado a tu email después del pago</p>

          <form onSubmit={handleCheckout}>
            {error && (
              <div style={{ padding: 10, borderRadius: 8, fontSize: 12, background: '#ef444420', border: '1px solid #ef444440', color: '#f87171', marginBottom: 12 }}>{error}</div>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#aaa', marginBottom: 4 }}>Nombre completo</label>
              <div style={{ position: 'relative' }}>
                <User style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: '#555' }} />
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Tu nombre" required
                  style={{ width: '100%', paddingLeft: 34, paddingRight: 12, paddingTop: 11, paddingBottom: 11, borderRadius: 8, color: '#fff', fontSize: 14, background: '#0f1b2d', border: '1px solid #2a2a3e', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#aaa', marginBottom: 4 }}>Email</label>
              <div style={{ position: 'relative' }}>
                <Mail style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: '#555' }} />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="tu@email.com" required
                  style={{ width: '100%', paddingLeft: 34, paddingRight: 12, paddingTop: 11, paddingBottom: 11, borderRadius: 8, color: '#fff', fontSize: 14, background: '#0f1b2d', border: '1px solid #2a2a3e', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <p style={{ fontSize: 10, color: '#555', margin: '3px 0 0' }}>Recibirás el enlace de activación aquí</p>
            </div>

            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '13px 14px', borderRadius: 10,
              fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              background: loading ? '#333' : 'linear-gradient(135deg, #00d4aa, #10b981)',
              color: loading ? '#888' : '#000', transition: 'all 0.2s',
            }}>
              {loading ? (
                <><Clock style={{ width: 16, height: 16 }} /> Procesando...</>
              ) : (
                <><CreditCard style={{ width: 16, height: 16 }} /> Pagar ${price.cop?.toLocaleString('es-CO')} COP</>
              )}
            </button>
          </form>

          {/* Trust */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #2a2a3e', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#777' }}>
              <Shield style={{ width: 12, height: 12, color: '#10b981' }} /> SSL seguro
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#777' }}>
              <CreditCard style={{ width: 12, height: 12, color: '#3b82f6' }} /> Tarjeta • PSE • Nequi
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
            <img src="https://cdn.wompi.co/widgets/assets/logos/full-colored.svg" alt="Wompi" style={{ height: 16, opacity: 0.4 }} />
          </div>
        </div>

        {/* ─── GUARANTEE ─── */}
        <div style={{ padding: 10, borderRadius: 10, textAlign: 'center', background: '#10b98110', border: '1px solid #10b98120', marginBottom: 16 }}>
          <p style={{ fontSize: 11, color: '#10b981', margin: 0 }}>🛡️ Garantía 7 días — No satisfecho, te devolvemos tu dinero.</p>
        </div>

        {/* ─── FEATURES ─── */}
        <div style={{ padding: 16, borderRadius: 14, background: '#1a1a2e', border: '1px solid #2a2a3e', marginBottom: 20 }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: '#777', margin: '0 0 10px', fontWeight: 600 }}>Incluye:</p>
          {planInfo.features.map((f: string, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Check style={{ width: 14, height: 14, flexShrink: 0, color: planInfo.color }} />
              <span style={{ fontSize: 12, color: '#ccc' }}>{f}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

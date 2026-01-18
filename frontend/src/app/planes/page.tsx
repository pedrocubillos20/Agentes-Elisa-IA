'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Planes() {
  const [tipo, setTipo] = useState<'mensual' | 'vitalicio'>('mensual')
  const [loading, setLoading] = useState<string | null>(null)
  const router = useRouter()
  const API_URL = process.env.NEXT_PUBLIC_API_URL

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) router.push('/')
  }, [router])

  const planesMensuales = [
    { id: 'EMPRENDEDORES_MONTHLY', name: 'Emprendedores', price: 180000, chatbots: 1, mensajes: '1,000', config: 'Nosotros configuramos', popular: false },
    { id: 'NEGOCIOS_MONTHLY', name: 'Negocios en Crecimiento', price: 360000, chatbots: 3, mensajes: '5,000', config: 'Nosotros configuramos', popular: true },
  ]

  const planesVitalicios = [
    { id: 'BUSINESS_LIFETIME', name: 'Business', price: 1440000, chatbots: 5, mensajes: '10,000', config: 'Tú configuras', popular: true },
    { id: 'MARCA_BLANCA_LIFETIME', name: 'Marca Blanca', subtitle: 'Revendedores', price: 2520000, chatbots: '∞', mensajes: '∞', config: 'Tú configuras', popular: false },
  ]

  const planes = tipo === 'mensual' ? planesMensuales : planesVitalicios

  const handleSelect = async (planId: string) => {
    setLoading(planId)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/payments/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ plan: planId })
      })
      const data = await res.json()
      if (data.paymentUrl) window.location.href = data.paymentUrl
      else alert(data.error || 'Error')
    } catch { alert('Error de conexión') }
    finally { setLoading(null) }
  }

  const formatPrice = (p: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(p)

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between h-16 items-center">
          <a href="/dashboard" className="flex items-center">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center mr-2">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <span className="text-xl font-bold text-gray-800">Elisa IA</span>
          </a>
          <a href="/dashboard" className="text-gray-600 hover:text-gray-800">← Volver</a>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto py-12 px-4">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Elige tu Plan</h1>
          <p className="text-xl text-gray-600 mb-8">Chatbots de WhatsApp con IA para tu negocio</p>

          <div className="inline-flex bg-gray-100 rounded-xl p-1">
            <button onClick={() => setTipo('mensual')} className={`px-6 py-3 rounded-lg font-semibold transition ${tipo === 'mensual' ? 'bg-white text-indigo-600 shadow' : 'text-gray-600'}`}>
              Mensual
            </button>
            <button onClick={() => setTipo('vitalicio')} className={`px-6 py-3 rounded-lg font-semibold transition ${tipo === 'vitalicio' ? 'bg-white text-indigo-600 shadow' : 'text-gray-600'}`}>
              Vitalicio
            </button>
          </div>

          {tipo === 'vitalicio' && <p className="mt-4 text-green-600 font-medium">💰 Paga una vez, usa para siempre</p>}
        </div>

        <div className={`grid gap-8 ${planes.length === 2 ? 'md:grid-cols-2 max-w-4xl mx-auto' : 'md:grid-cols-3'}`}>
          {planes.map((plan: any) => (
            <div key={plan.id} className={`bg-white rounded-2xl shadow-lg overflow-hidden ${plan.popular ? 'ring-2 ring-purple-500 scale-105' : ''}`}>
              {plan.popular && <div className="bg-purple-500 text-white text-center py-2 text-sm font-bold">⭐ MÁS POPULAR</div>}
              <div className="p-8">
                <h3 className="text-2xl font-bold text-gray-900">{plan.name}</h3>
                {plan.subtitle && <p className="text-gray-500 text-sm">{plan.subtitle}</p>}
                <div className="mt-4 mb-6">
                  <span className="text-4xl font-bold text-gray-900">{formatPrice(plan.price)}</span>
                  <span className="text-gray-500">/{tipo === 'mensual' ? 'mes' : 'único'}</span>
                </div>
                <ul className="space-y-3 mb-8">
                  <li className="flex items-center"><span className="text-green-500 mr-2">✓</span>{plan.chatbots} Chatbot(s)</li>
                  <li className="flex items-center"><span className="text-green-500 mr-2">✓</span>{plan.mensajes} mensajes/mes</li>
                  <li className="flex items-center"><span className="text-green-500 mr-2">✓</span>{plan.config}</li>
                  <li className="flex items-center"><span className="text-green-500 mr-2">✓</span>Soporte incluido</li>
                </ul>
                <button onClick={() => handleSelect(plan.id)} disabled={loading === plan.id}
                  className={`w-full py-4 rounded-xl font-bold text-lg transition disabled:opacity-50 ${plan.popular ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                  {loading === plan.id ? '⏳ Procesando...' : 'Seleccionar'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 bg-yellow-50 rounded-xl p-6 max-w-3xl mx-auto">
          <h3 className="font-bold text-yellow-800 mb-2">⚠️ Importante</h3>
          <p className="text-yellow-700">TODOS los planes requieren tu propia API Key de OpenAI. Tú eres responsable de tus créditos.</p>
        </div>
      </main>
    </div>
  )
}

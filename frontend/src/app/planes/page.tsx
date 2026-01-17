'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const PLANES_MENSUALES = [
  {
    id: 'STARTER_MONTHLY',
    nombre: 'Starter',
    precio: 180000,
    precioUSD: 45,
    descripcion: 'Ideal para emprendedores',
    caracteristicas: [
      '1 Asistente de IA',
      '1,000 mensajes/mes',
      'Widget para web',
      'Soporte por email',
      'Analíticas básicas',
    ],
    popular: false,
  },
  {
    id: 'PRO_MONTHLY',
    nombre: 'Pro',
    precio: 360000,
    precioUSD: 90,
    descripcion: 'Para negocios en crecimiento',
    caracteristicas: [
      '3 Asistentes de IA',
      '5,000 mensajes/mes',
      'Widget personalizable',
      'Integración WhatsApp',
      'Soporte prioritario',
      'Analíticas avanzadas',
    ],
    popular: true,
  },
  {
    id: 'BUSINESS_MONTHLY',
    nombre: 'Business',
    precio: 720000,
    precioUSD: 180,
    descripcion: 'Para empresas establecidas',
    caracteristicas: [
      '10 Asistentes de IA',
      '20,000 mensajes/mes',
      'Marca blanca',
      'API completa',
      'Integraciones ilimitadas',
      'Soporte 24/7',
      'Manager dedicado',
    ],
    popular: false,
  },
]

const PLANES_VITALICIOS = [
  {
    id: 'STARTER_LIFETIME',
    nombre: 'Starter Vitalicio',
    precio: 720000,
    precioUSD: 180,
    descripcion: 'Pago único, acceso permanente',
    caracteristicas: [
      '1 Asistente de IA',
      '2,000 mensajes/mes',
      'Widget para web',
      'Actualizaciones incluidas',
      'Sin pagos recurrentes',
    ],
    popular: false,
  },
  {
    id: 'PRO_LIFETIME',
    nombre: 'Pro Vitalicio',
    precio: 1440000,
    precioUSD: 360,
    descripcion: 'La mejor inversión',
    caracteristicas: [
      '5 Asistentes de IA',
      '10,000 mensajes/mes',
      'Todas las integraciones',
      'Soporte prioritario',
      'Actualizaciones de por vida',
    ],
    popular: true,
  },
  {
    id: 'AGENCY_LIFETIME',
    nombre: 'Agencia Vitalicio',
    precio: 2520000,
    precioUSD: 630,
    descripcion: 'Para agencias y revendedores',
    caracteristicas: [
      'Asistentes ilimitados',
      'Mensajes ilimitados',
      'Marca blanca completa',
      'Reventa autorizada',
      'API sin límites',
      'Soporte VIP',
    ],
    popular: false,
  },
]

export default function Planes() {
  const [tipoPlanes, setTipoPlanes] = useState<'mensual' | 'vitalicio'>('mensual')
  const [loading, setLoading] = useState<string | null>(null)
  const [user, setUser] = useState<any>(null)
  const router = useRouter()
  const API_URL = process.env.NEXT_PUBLIC_API_URL

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')
    
    if (!token) {
      router.push('/')
      return
    }

    if (userData) {
      setUser(JSON.parse(userData))
    }
  }, [router])

  const formatPrice = (precio: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(precio)
  }

  const handleSelectPlan = async (planId: string, precio: number) => {
    setLoading(planId)
    
    try {
      const token = localStorage.getItem('token')

      const response = await fetch(`${API_URL}/api/payments/create-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ plan: planId, amount: precio }),
      })

      const data = await response.json()

      if (data.paymentUrl) {
        window.location.href = data.paymentUrl
      } else if (data.reference) {
        alert('Pago iniciado. Referencia: ' + data.reference)
      } else {
        alert(data.error || 'Error al crear el pago')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error de conexión')
    } finally {
      setLoading(null)
    }
  }

  const planes = tipoPlanes === 'mensual' ? PLANES_MENSUALES : PLANES_VITALICIOS

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <a href="/dashboard" className="flex items-center">
                <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center mr-2">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <span className="text-xl font-bold text-gray-800">Elisa IA</span>
              </a>
            </div>
            <div className="flex items-center">
              <a href="/dashboard" className="text-gray-600 hover:text-gray-800 flex items-center">
                <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Volver
              </a>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Elige tu Plan Perfecto
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Potencia tu negocio con asistentes de IA inteligentes
          </p>

          {/* Toggle Mensual/Vitalicio */}
          <div className="inline-flex items-center bg-gray-200 rounded-full p-1">
            <button
              onClick={() => setTipoPlanes('mensual')}
              className={`px-6 py-2 rounded-full font-medium transition ${
                tipoPlanes === 'mensual'
                  ? 'bg-white text-indigo-600 shadow'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Mensual
            </button>
            <button
              onClick={() => setTipoPlanes('vitalicio')}
              className={`px-6 py-2 rounded-full font-medium transition ${
                tipoPlanes === 'vitalicio'
                  ? 'bg-white text-indigo-600 shadow'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Vitalicio 💎
            </button>
          </div>

          {tipoPlanes === 'vitalicio' && (
            <p className="mt-4 text-green-600 font-medium">
              ¡Pago único! Ahorra hasta 70% vs pago mensual
            </p>
          )}
        </div>

        {/* Planes Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {planes.map((plan) => (
            <div
              key={plan.id}
              className={`relative bg-white rounded-2xl shadow-lg overflow-hidden transition-transform hover:scale-105 ${
                plan.popular ? 'ring-2 ring-indigo-500' : ''
              }`}
            >
              {plan.popular && (
                <div className="absolute top-0 right-0 bg-indigo-500 text-white px-4 py-1 text-sm font-medium rounded-bl-lg">
                  Más Popular
                </div>
              )}

              <div className="p-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.nombre}</h3>
                <p className="text-gray-600 mb-6">{plan.descripcion}</p>

                <div className="mb-6">
                  <span className="text-4xl font-bold text-gray-900">
                    {formatPrice(plan.precio)}
                  </span>
                  <span className="text-gray-500">
                    {tipoPlanes === 'mensual' ? '/mes' : ' único'}
                  </span>
                  <p className="text-sm text-gray-400 mt-1">≈ ${plan.precioUSD} USD</p>
                </div>

                <ul className="space-y-3 mb-8">
                  {plan.caracteristicas.map((caracteristica, index) => (
                    <li key={index} className="flex items-center">
                      <svg
                        className="w-5 h-5 text-green-500 mr-3 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span className="text-gray-600">{caracteristica}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleSelectPlan(plan.id, plan.precio)}
                  disabled={loading === plan.id}
                  className={`w-full py-3 px-6 rounded-lg font-semibold transition ${
                    plan.popular
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {loading === plan.id ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Procesando...
                    </span>
                  ) : (
                    'Seleccionar Plan'
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* FAQ Section */}
        <div className="mt-16">
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-8">
            Preguntas Frecuentes
          </h2>
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-2">
                ¿Qué incluye el plan vitalicio?
              </h3>
              <p className="text-gray-600">
                Con el plan vitalicio pagas una sola vez y tienes acceso permanente a todas las funcionalidades del plan. Incluye actualizaciones futuras sin costo adicional.
              </p>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-2">
                ¿Puedo cambiar de plan después?
              </h3>
              <p className="text-gray-600">
                Sí, puedes actualizar tu plan en cualquier momento. Si tienes un plan mensual, puedes cambiarte a vitalicio pagando la diferencia.
              </p>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-2">
                ¿Qué métodos de pago aceptan?
              </h3>
              <p className="text-gray-600">
                Aceptamos tarjetas de crédito/débito, PSE, Nequi, Daviplata y otros métodos de pago colombianos a través de Wompi.
              </p>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-2">
                ¿Ofrecen reembolsos?
              </h3>
              <p className="text-gray-600">
                Sí, ofrecemos garantía de satisfacción de 7 días. Si no estás satisfecho, te devolvemos el 100% de tu dinero sin preguntas.
              </p>
            </div>
          </div>
        </div>

        {/* Trust Badges */}
        <div className="mt-16 text-center">
          <p className="text-gray-500 mb-6">Métodos de pago seguros</p>
          <div className="flex justify-center items-center space-x-8">
            <div className="text-gray-400">
              <svg className="h-8" viewBox="0 0 50 50" fill="currentColor">
                <text x="0" y="35" fontSize="12" fontWeight="bold">VISA</text>
              </svg>
            </div>
            <div className="text-gray-400">
              <svg className="h-8" viewBox="0 0 50 50" fill="currentColor">
                <text x="0" y="35" fontSize="10" fontWeight="bold">MasterCard</text>
              </svg>
            </div>
            <div className="text-gray-400">
              <svg className="h-8" viewBox="0 0 50 50" fill="currentColor">
                <text x="0" y="35" fontSize="12" fontWeight="bold">PSE</text>
              </svg>
            </div>
            <div className="text-gray-400">
              <svg className="h-8" viewBox="0 0 50 50" fill="currentColor">
                <text x="0" y="35" fontSize="10" fontWeight="bold">Nequi</text>
              </svg>
            </div>
          </div>
          <p className="mt-4 text-sm text-gray-400">
            🔒 Pagos procesados de forma segura por Wompi
          </p>
        </div>
      </main>
    </div>
  )
}

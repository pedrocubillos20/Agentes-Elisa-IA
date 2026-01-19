'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const PLANES = [
  {
    id: 'FREE',
    name: 'Prueba Gratis',
    description: 'Prueba el servicio por 5 días',
    price: 0,
    priceLabel: 'Gratis',
    period: '5 días',
    chatbots: 1,
    features: [
      '1 Chatbot de WhatsApp',
      '5 días de prueba',
      'Mensajes según tu API Key',
      '🧠 Configura tú mismo (JSON)',
      '📄 O envía PDF (nosotros configuramos)'
    ],
    notIncluded: [
      'Soporte dedicado'
    ],
    buttonText: 'Plan Actual',
    buttonDisabled: true,
    popular: false,
    color: 'gray',
    icon: '🎁'
  },
  {
    id: 'EMPRENDEDORES_MONTHLY',
    name: 'Emprendedores',
    description: 'Ideal para negocios pequeños',
    price: 100000,
    priceLabel: '$100.000',
    period: '/mes',
    chatbots: 1,
    features: [
      '1 Chatbot de WhatsApp',
      'Mensajes ilimitados (según tu API Key)',
      '✨ Nosotros configuramos tu negocio',
      'Soporte incluido',
      'Sube PDF con tu información'
    ],
    notIncluded: [],
    buttonText: 'Elegir Plan',
    buttonDisabled: false,
    popular: false,
    color: 'blue',
    icon: '🚀'
  },
  {
    id: 'NEGOCIOS_MONTHLY',
    name: 'Negocios en Crecimiento',
    description: 'Para negocios en expansión',
    price: 150000,
    priceLabel: '$150.000',
    period: '/mes',
    chatbots: 3,
    features: [
      '3 Chatbots de WhatsApp',
      'Mensajes ilimitados (según tu API Key)',
      '✨ Nosotros configuramos tus negocios',
      'Soporte prioritario',
      'Sube PDF con tu información'
    ],
    notIncluded: [],
    buttonText: 'Elegir Plan',
    buttonDisabled: false,
    popular: true,
    color: 'indigo',
    icon: '📈'
  },
  {
    id: 'BUSINESS_LIFETIME',
    name: 'Business',
    description: 'Pago único, acceso de por vida',
    price: 100000,
    priceLabel: '$100.000',
    period: 'único',
    chatbots: 5,
    features: [
      '5 Chatbots de WhatsApp',
      'Mensajes ilimitados (según tu API Key)',
      '🧠 Configura el contexto tú mismo (JSON)',
      'Soporte incluido',
      '⭐ Pago único - Sin mensualidades',
      'Actualizaciones de por vida'
    ],
    notIncluded: [],
    buttonText: 'Elegir Plan',
    buttonDisabled: false,
    popular: false,
    color: 'purple',
    icon: '💼'
  },
  {
    id: 'MARCA_BLANCA_LIFETIME',
    name: 'Marca Blanca',
    description: 'Revende con tu propia marca',
    price: 300000,
    priceLabel: '$300.000',
    period: 'único',
    chatbots: 999,
    features: [
      '♾️ Chatbots ILIMITADOS',
      'Mensajes ilimitados (según tu API Key)',
      '🧠 Configura el contexto tú mismo (JSON)',
      '🎨 Personaliza logo y marca',
      '🔗 Link de reventa exclusivo',
      'Soporte VIP',
      '⭐ Pago único - Sin mensualidades',
      'Actualizaciones de por vida'
    ],
    notIncluded: [],
    buttonText: 'Elegir Plan',
    buttonDisabled: false,
    popular: false,
    color: 'amber',
    icon: '👑'
  }
]

export default function Planes() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const router = useRouter()
  const API_URL = process.env.NEXT_PUBLIC_API_URL

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) setUser(JSON.parse(userData))
  }, [])

  const handleSelectPlan = async (planId: string) => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.push('/')
      return
    }

    // No hacer nada para el plan FREE
    if (planId === 'FREE') return

    setLoading(planId)
    try {
      const res = await fetch(`${API_URL}/api/payments/create-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ planId })
      })

      const data = await res.json()
      
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl
      } else {
        alert(data.error || 'Error al crear el pago')
      }
    } catch (error) {
      alert('Error al procesar el pago')
    } finally {
      setLoading(null)
    }
  }

  const getButtonStyle = (plan: any) => {
    if (plan.id === 'FREE' || (user?.plan === plan.id.split('_')[0])) {
      return 'bg-gray-200 text-gray-500 cursor-not-allowed'
    }
    
    const colors: Record<string, string> = {
      gray: 'bg-gray-600 hover:bg-gray-700 text-white',
      blue: 'bg-blue-600 hover:bg-blue-700 text-white',
      indigo: 'bg-indigo-600 hover:bg-indigo-700 text-white',
      purple: 'bg-purple-600 hover:bg-purple-700 text-white',
      amber: 'bg-amber-500 hover:bg-amber-600 text-white',
    }
    return colors[plan.color] || 'bg-indigo-600 hover:bg-indigo-700 text-white'
  }

  const isCurrentPlan = (planId: string) => {
    if (!user) return false
    return user.plan === planId.split('_')[0]
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between h-16 items-center">
          <a href="/dashboard" className="flex items-center">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center mr-2">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <span className="text-xl font-bold text-gray-800">Elisa IA</span>
          </a>
          <a href="/dashboard" className="text-gray-600 hover:text-gray-800">← Volver al Dashboard</a>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-12 px-4">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Elige tu Plan Perfecto
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Automatiza la atención al cliente de tu negocio con chatbots de WhatsApp potenciados por IA
          </p>
        </div>

        {/* Planes */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {PLANES.map((plan) => (
            <div 
              key={plan.id} 
              className={`bg-white rounded-2xl shadow-lg overflow-hidden flex flex-col transition-transform hover:scale-105 ${plan.popular ? 'ring-2 ring-indigo-500 relative' : ''}`}
            >
              {plan.popular && (
                <div className="absolute top-0 left-0 right-0 bg-indigo-500 text-white text-center text-sm py-1 font-medium">
                  ⭐ Más Popular
                </div>
              )}
              
              <div className={`p-6 ${plan.popular ? 'pt-10' : ''}`}>
                {/* Icon y Nombre */}
                <div className="text-center mb-4">
                  <span className="text-4xl">{plan.icon}</span>
                  <h3 className="text-xl font-bold text-gray-900 mt-2">{plan.name}</h3>
                  <p className="text-gray-500 text-sm">{plan.description}</p>
                </div>

                {/* Precio */}
                <div className="text-center mb-6">
                  <div className="flex items-baseline justify-center">
                    <span className="text-3xl font-bold text-gray-900">{plan.priceLabel}</span>
                    <span className="text-gray-500 ml-1">{plan.period}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {plan.chatbots === 999 ? 'Chatbots ilimitados' : `${plan.chatbots} chatbot${plan.chatbots > 1 ? 's' : ''}`}
                  </p>
                </div>

                {/* Features */}
                <ul className="space-y-3 mb-6">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start text-sm">
                      <span className="text-green-500 mr-2 flex-shrink-0">✓</span>
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                  {plan.notIncluded.map((feature, idx) => (
                    <li key={idx} className="flex items-start text-sm">
                      <span className="text-gray-300 mr-2 flex-shrink-0">✗</span>
                      <span className="text-gray-400">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Botón */}
              <div className="p-6 pt-0 mt-auto">
                <button
                  onClick={() => handleSelectPlan(plan.id)}
                  disabled={plan.id === 'FREE' || isCurrentPlan(plan.id) || loading === plan.id}
                  className={`w-full py-3 px-4 rounded-xl font-semibold transition-colors ${getButtonStyle(plan)} disabled:opacity-50`}
                >
                  {loading === plan.id ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Procesando...
                    </span>
                  ) : isCurrentPlan(plan.id) ? (
                    '✓ Plan Actual'
                  ) : (
                    plan.buttonText
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Comparativa */}
        <div className="mt-16 bg-white rounded-2xl shadow-lg p-8">
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-8">Comparativa de Planes</h2>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-4 px-4">Característica</th>
                  <th className="text-center py-4 px-2">Free</th>
                  <th className="text-center py-4 px-2">Emprendedores</th>
                  <th className="text-center py-4 px-2">Negocios</th>
                  <th className="text-center py-4 px-2">Business</th>
                  <th className="text-center py-4 px-2">Marca Blanca</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                <tr className="border-b">
                  <td className="py-4 px-4 font-medium">Chatbots</td>
                  <td className="text-center py-4 px-2">1</td>
                  <td className="text-center py-4 px-2">1</td>
                  <td className="text-center py-4 px-2">3</td>
                  <td className="text-center py-4 px-2">5</td>
                  <td className="text-center py-4 px-2">♾️ Ilimitados</td>
                </tr>
                <tr className="border-b">
                  <td className="py-4 px-4 font-medium">Duración</td>
                  <td className="text-center py-4 px-2">5 días</td>
                  <td className="text-center py-4 px-2">Mensual</td>
                  <td className="text-center py-4 px-2">Mensual</td>
                  <td className="text-center py-4 px-2">⭐ Vitalicio</td>
                  <td className="text-center py-4 px-2">⭐ Vitalicio</td>
                </tr>
                <tr className="border-b">
                  <td className="py-4 px-4 font-medium">Configuración</td>
                  <td className="text-center py-4 px-2">🧠 + 📄</td>
                  <td className="text-center py-4 px-2">✨ Nosotros</td>
                  <td className="text-center py-4 px-2">✨ Nosotros</td>
                  <td className="text-center py-4 px-2">🧠 Tú mismo</td>
                  <td className="text-center py-4 px-2">🧠 Tú mismo</td>
                </tr>
                <tr className="border-b">
                  <td className="py-4 px-4 font-medium">Soporte</td>
                  <td className="text-center py-4 px-2">❌</td>
                  <td className="text-center py-4 px-2">✅</td>
                  <td className="text-center py-4 px-2">✅ Prioritario</td>
                  <td className="text-center py-4 px-2">✅</td>
                  <td className="text-center py-4 px-2">✅ VIP</td>
                </tr>
                <tr className="border-b">
                  <td className="py-4 px-4 font-medium">Marca personalizada</td>
                  <td className="text-center py-4 px-2">❌</td>
                  <td className="text-center py-4 px-2">❌</td>
                  <td className="text-center py-4 px-2">❌</td>
                  <td className="text-center py-4 px-2">❌</td>
                  <td className="text-center py-4 px-2">✅</td>
                </tr>
                <tr>
                  <td className="py-4 px-4 font-medium">Reventa</td>
                  <td className="text-center py-4 px-2">❌</td>
                  <td className="text-center py-4 px-2">❌</td>
                  <td className="text-center py-4 px-2">❌</td>
                  <td className="text-center py-4 px-2">❌</td>
                  <td className="text-center py-4 px-2">✅</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-16">
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-8">Preguntas Frecuentes</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-2">¿Qué es el API Key de OpenAI?</h3>
              <p className="text-gray-600 text-sm">Es tu clave personal de OpenAI que permite que el chatbot use inteligencia artificial. Tú controlas los costos directamente con OpenAI.</p>
            </div>
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-2">¿Qué significa "nosotros configuramos"?</h3>
              <p className="text-gray-600 text-sm">En planes Emprendedores y Negocios, nos envías un PDF con la información de tu negocio y nuestro equipo configura el chatbot por ti.</p>
            </div>
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-2">¿Los planes vitalicios son de un solo pago?</h3>
              <p className="text-gray-600 text-sm">Sí, los planes Business y Marca Blanca son de un único pago. Tendrás acceso de por vida sin pagos mensuales.</p>
            </div>
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-2">¿Puedo revender el servicio?</h3>
              <p className="text-gray-600 text-sm">Solo con el plan Marca Blanca. Podrás personalizar la marca y obtener un link de reventa exclusivo.</p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-16 text-center">
          <p className="text-gray-600 mb-4">¿Tienes preguntas? Escríbenos</p>
          <a 
            href="https://wa.me/573001234567" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center px-6 py-3 bg-green-500 text-white rounded-xl font-semibold hover:bg-green-600 transition-colors"
          >
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Contactar por WhatsApp
          </a>
        </div>
      </main>
    </div>
  )
}

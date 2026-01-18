'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')
    if (!token) { router.push('/'); return }
    if (userData) setUser(JSON.parse(userData))
    setLoading(false)
  }, [router])

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    router.push('/')
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <svg className="animate-spin h-12 w-12 text-indigo-600" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Navbar */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center mr-2">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <span className="text-xl font-bold text-gray-800">Elisa IA</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-600">{user?.email}</span>
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${user?.plan === 'FREE' ? 'bg-gray-200 text-gray-700' : 'bg-indigo-100 text-indigo-700'}`}>
                {user?.plan || 'FREE'}
              </span>
              <button onClick={handleLogout} className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200">Salir</button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Banner */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 mb-8 text-white">
          <h1 className="text-2xl font-bold mb-2">¡Bienvenido{user?.firstName ? `, ${user.firstName}` : ''}! 👋</h1>
          <p className="text-indigo-100">Panel de control de tus chatbots de WhatsApp con IA</p>
        </div>

        {/* ALERTA API KEY */}
        {!user?.apiKeyConnected && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r-lg">
            <div className="flex items-center">
              <span className="text-3xl mr-4">🔑</span>
              <div className="flex-1">
                <h3 className="font-bold text-red-800 text-lg">⚠️ API Key de OpenAI NO configurada</h3>
                <p className="text-red-700">Tus chatbots NO funcionarán hasta que conectes tu API Key</p>
              </div>
              <a href="/configuracion" className="bg-red-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-red-700">
                Configurar Ahora
              </a>
            </div>
          </div>
        )}

        {/* Cards estado */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${user?.apiKeyConnected ? 'bg-green-100' : 'bg-red-100'}`}>
              <span className="text-2xl">🔑</span>
            </div>
            <h3 className="text-gray-500 text-sm">API Key OpenAI</h3>
            <p className={`text-lg font-bold ${user?.apiKeyConnected ? 'text-green-600' : 'text-red-600'}`}>
              {user?.apiKeyConnected ? 'Conectada ✓' : 'No configurada'}
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
              <span className="text-2xl">📊</span>
            </div>
            <h3 className="text-gray-500 text-sm">Plan Actual</h3>
            <p className="text-lg font-bold text-gray-800">{user?.plan || 'FREE'}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
              <span className="text-2xl">🤖</span>
            </div>
            <h3 className="text-gray-500 text-sm">Chatbots</h3>
            <p className="text-lg font-bold text-gray-800">0</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
              <span className="text-2xl">💬</span>
            </div>
            <h3 className="text-gray-500 text-sm">Mensajes</h3>
            <p className="text-lg font-bold text-gray-800">0</p>
          </div>
        </div>

        {/* Configuración Requerida */}
        <h2 className="text-xl font-bold text-gray-800 mb-4">⚙️ Configuración</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <a href="/configuracion" className={`bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition border-2 ${!user?.apiKeyConnected ? 'border-red-300' : 'border-green-300'}`}>
            <div className="flex items-center">
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center mr-4 ${!user?.apiKeyConnected ? 'bg-red-100' : 'bg-green-100'}`}>
                <span className="text-3xl">🔑</span>
              </div>
              <div>
                <h3 className="font-semibold text-gray-800 text-lg">API Key de OpenAI</h3>
                <p className={`text-sm ${!user?.apiKeyConnected ? 'text-red-600 font-bold' : 'text-green-600'}`}>
                  {!user?.apiKeyConnected ? '❌ REQUERIDO - Configurar' : '✅ Conectada'}
                </p>
              </div>
            </div>
          </a>

          <a href="/whatsapp" className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition border-2 border-yellow-300">
            <div className="flex items-center">
              <div className="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center mr-4">
                <span className="text-3xl">📱</span>
              </div>
              <div>
                <h3 className="font-semibold text-gray-800 text-lg">Conectar WhatsApp</h3>
                <p className="text-sm text-yellow-600">Escanea el QR para vincular</p>
              </div>
            </div>
          </a>
        </div>

        {/* Gestión */}
        <h2 className="text-xl font-bold text-gray-800 mb-4">📋 Gestión</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <a href="/asistentes" className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition">
            <div className="w-14 h-14 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
              <span className="text-3xl">🤖</span>
            </div>
            <h3 className="font-semibold text-gray-800 mb-2">Mis Chatbots</h3>
            <p className="text-gray-600 text-sm">Gestiona tus chatbots</p>
          </a>

          <a href="/negocio" className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition">
            <div className="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
              <span className="text-3xl">🏢</span>
            </div>
            <h3 className="font-semibold text-gray-800 mb-2">Mi Negocio</h3>
            <p className="text-gray-600 text-sm">Información del negocio</p>
          </a>

          <a href="/planes" className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition">
            <div className="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center mb-4">
              <span className="text-3xl">💳</span>
            </div>
            <h3 className="font-semibold text-gray-800 mb-2">Planes y Pagos</h3>
            <p className="text-gray-600 text-sm">Ver planes disponibles</p>
          </a>
        </div>
      </main>
    </div>
  )
}

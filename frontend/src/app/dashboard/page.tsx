'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [daysLeft, setDaysLeft] = useState<number | null>(null)
  const [stats, setStats] = useState<any>(null)
  const [configRequests, setConfigRequests] = useState<any[]>([])
  const [referralStats, setReferralStats] = useState<any>(null)
  const router = useRouter()
  const API_URL = process.env.NEXT_PUBLIC_API_URL

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')
    if (!token) { router.push('/'); return }
    if (userData) {
      const u = JSON.parse(userData)
      setUser(u)
      
      // Calcular días restantes del trial
      if (u.plan === 'FREE' && u.trialEndsAt) {
        const endDate = new Date(u.trialEndsAt)
        const today = new Date()
        const diffTime = endDate.getTime() - today.getTime()
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
        setDaysLeft(diffDays > 0 ? diffDays : 0)
      }
    }
    
    fetchUserProfile()
    fetchStats()
  }, [router])

  // Obtener perfil actualizado
  const fetchUserProfile = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        localStorage.setItem('user', JSON.stringify(data.user))
        
        // Recalcular días si es FREE
        if (data.user.plan === 'FREE' && data.user.trialEndsAt) {
          const endDate = new Date(data.user.trialEndsAt)
          const today = new Date()
          const diffTime = endDate.getTime() - today.getTime()
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
          setDaysLeft(diffDays > 0 ? diffDays : 0)
        }
        
        // Cargar solicitudes de configuración para planes gestionados
        if (['FREE', 'EMPRENDEDORES', 'NEGOCIOS'].includes(data.user.plan)) {
          fetchConfigRequests()
        }
        
        // Cargar estadísticas de referidos para Marca Blanca
        if (data.user.plan === 'MARCA_BLANCA') {
          fetchReferralStats()
        }
      }
    } catch (e) {
      console.error('Error fetching profile:', e)
    } finally {
      setLoading(false)
    }
  }

  // Obtener estadísticas
  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/assistants/plan-info`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch (e) {
      console.error('Error fetching stats:', e)
    }
  }

  // Obtener solicitudes de configuración
  const fetchConfigRequests = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/config/my-requests`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setConfigRequests(data.requests || [])
      }
    } catch (e) {
      console.error('Error fetching config requests:', e)
    }
  }

  // Obtener estadísticas de referidos
  const fetchReferralStats = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/payments/referral-stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setReferralStats(data)
      }
    } catch (e) {
      console.error('Error fetching referral stats:', e)
    }
  }

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

  const trialExpired = daysLeft !== null && daysLeft <= 0
  const plan = user?.plan || 'FREE'
  const isManagedPlan = ['EMPRENDEDORES', 'NEGOCIOS'].includes(plan)
  const isSelfConfigPlan = ['FREE', 'BUSINESS', 'MARCA_BLANCA'].includes(plan)
  const isMarcaBlanca = plan === 'MARCA_BLANCA'

  // Colores por plan
  const planColors: Record<string, string> = {
    FREE: 'bg-gray-200 text-gray-700',
    EMPRENDEDORES: 'bg-blue-100 text-blue-700',
    NEGOCIOS: 'bg-indigo-100 text-indigo-700',
    BUSINESS: 'bg-purple-100 text-purple-700',
    MARCA_BLANCA: 'bg-amber-100 text-amber-700'
  }

  const planEmojis: Record<string, string> = {
    FREE: '🎁',
    EMPRENDEDORES: '🚀',
    NEGOCIOS: '📈',
    BUSINESS: '💼',
    MARCA_BLANCA: '👑'
  }

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
              <span className="text-xl font-bold text-gray-800">
                {isMarcaBlanca && user?.customBrandName ? user.customBrandName : 'Elisa IA'}
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-600 hidden sm:block">{user?.email}</span>
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${planColors[plan]}`}>
                {planEmojis[plan]} {plan}
              </span>
              {user?.isAdmin && (
                <a href="/admin" className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-bold hover:bg-red-200">
                  🔐 Admin
                </a>
              )}
              <button onClick={handleLogout} className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200">Salir</button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Banner personalizado por plan */}
        <div className={`rounded-2xl p-6 mb-8 text-white ${
          plan === 'MARCA_BLANCA' ? 'bg-gradient-to-r from-amber-500 to-orange-500' :
          plan === 'BUSINESS' ? 'bg-gradient-to-r from-purple-600 to-pink-600' :
          plan === 'NEGOCIOS' ? 'bg-gradient-to-r from-indigo-600 to-blue-600' :
          plan === 'EMPRENDEDORES' ? 'bg-gradient-to-r from-blue-600 to-cyan-600' :
          'bg-gradient-to-r from-indigo-600 to-purple-600'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold mb-2">¡Bienvenido{user?.firstName ? `, ${user.firstName}` : ''}! {planEmojis[plan]}</h1>
              <p className="opacity-90">
                {plan === 'FREE' && 'Prueba gratuita de tus chatbots de WhatsApp con IA'}
                {plan === 'EMPRENDEDORES' && 'Tu chatbot está siendo configurado por nuestro equipo'}
                {plan === 'NEGOCIOS' && 'Gestiona múltiples chatbots para tu negocio'}
                {plan === 'BUSINESS' && 'Acceso completo a todas las funcionalidades'}
                {plan === 'MARCA_BLANCA' && 'Panel de revendedor - Chatbots ilimitados'}
              </p>
            </div>
            {stats && (
              <div className="text-right">
                <p className="text-sm opacity-75">Chatbots</p>
                <p className="text-3xl font-bold">{stats.chatbotsUsed}/{stats.chatbotsLimit === 999 ? '∞' : stats.chatbotsLimit}</p>
              </div>
            )}
          </div>
        </div>

        {/* ALERTAS */}
        
        {/* ALERTA TRIAL EXPIRADO */}
        {trialExpired && (
          <div className="bg-red-600 text-white p-6 mb-6 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <span className="text-4xl mr-4">⏰</span>
                <div>
                  <h3 className="font-bold text-xl">¡Tu prueba gratuita ha expirado!</h3>
                  <p>Actualiza a un plan para seguir usando tus chatbots</p>
                </div>
              </div>
              <a href="/planes" className="bg-white text-red-600 px-6 py-3 rounded-lg font-bold hover:bg-gray-100">
                Ver Planes
              </a>
            </div>
          </div>
        )}

        {/* ALERTA TRIAL ACTIVO */}
        {plan === 'FREE' && daysLeft !== null && daysLeft > 0 && (
          <div className={`p-4 mb-6 rounded-xl ${daysLeft <= 2 ? 'bg-orange-100 border-2 border-orange-400' : 'bg-blue-50 border border-blue-200'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <span className="text-3xl mr-3">⏳</span>
                <div>
                  <h3 className={`font-bold ${daysLeft <= 2 ? 'text-orange-800' : 'text-blue-800'}`}>
                    Prueba Gratuita: {daysLeft} día{daysLeft !== 1 ? 's' : ''} restante{daysLeft !== 1 ? 's' : ''}
                  </h3>
                  <p className={daysLeft <= 2 ? 'text-orange-700 text-sm' : 'text-blue-700 text-sm'}>
                    Actualiza antes de que expire para no perder acceso
                  </p>
                </div>
              </div>
              <a href="/planes" className={`px-4 py-2 rounded-lg font-medium ${daysLeft <= 2 ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white'}`}>
                Ver Planes
              </a>
            </div>
          </div>
        )}

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

        {/* ESTADO DE SOLICITUDES (Para planes EMPRENDEDORES y NEGOCIOS) */}
        {isManagedPlan && configRequests.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
            <h3 className="font-bold text-gray-800 mb-4">📋 Estado de Configuración</h3>
            <div className="space-y-3">
              {configRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-800">{req.businessName}</p>
                    <p className="text-sm text-gray-500">
                      Enviado: {new Date(req.createdAt).toLocaleDateString('es-CO')}
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    req.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                    req.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>
                    {req.status === 'COMPLETED' ? '✅ Completado' :
                     req.status === 'IN_PROGRESS' ? '🔄 En Proceso' :
                     '⏳ Pendiente'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SECCIÓN MARCA BLANCA - Branding y Referidos */}
        {isMarcaBlanca && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Branding */}
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-6 border border-amber-200">
              <div className="flex items-center mb-4">
                <span className="text-3xl mr-3">🎨</span>
                <h3 className="font-bold text-gray-800 text-lg">Tu Marca</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Nombre de Marca</p>
                  <p className="font-medium text-gray-800">{user?.customBrandName || 'No configurado'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Logo</p>
                  {user?.customLogo ? (
                    <img src={user.customLogo} alt="Logo" className="h-12 mt-1" />
                  ) : (
                    <p className="text-gray-400 text-sm">No configurado</p>
                  )}
                </div>
                <a href="/configuracion" className="inline-block mt-2 text-amber-600 hover:text-amber-700 font-medium text-sm">
                  Editar Branding →
                </a>
              </div>
            </div>

            {/* Referidos */}
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-6 border border-green-200">
              <div className="flex items-center mb-4">
                <span className="text-3xl mr-3">🔗</span>
                <h3 className="font-bold text-gray-800 text-lg">Sistema de Referidos</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Tu Código de Referido</p>
                  <p className="font-mono font-bold text-green-600 text-lg">{referralStats?.referralCode || user?.referralCode || 'Generar código'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Referidos Activos</p>
                  <p className="font-bold text-2xl text-gray-800">{referralStats?.referralCount || 0}</p>
                </div>
                {referralStats?.referralLink && (
                  <div>
                    <p className="text-sm text-gray-500">Tu Link de Referido</p>
                    <input 
                      type="text" 
                      readOnly 
                      value={referralStats.referralLink}
                      className="w-full px-3 py-2 bg-white border rounded text-sm mt-1"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                  </div>
                )}
              </div>
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
              <span className="text-2xl">{planEmojis[plan]}</span>
            </div>
            <h3 className="text-gray-500 text-sm">Plan Actual</h3>
            <p className="text-lg font-bold text-gray-800">{plan}</p>
            {daysLeft !== null && daysLeft > 0 && plan === 'FREE' && (
              <p className="text-xs text-orange-600">{daysLeft} días restantes</p>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${user?.whatsappConnected ? 'bg-green-100' : 'bg-yellow-100'}`}>
              <span className="text-2xl">📱</span>
            </div>
            <h3 className="text-gray-500 text-sm">WhatsApp</h3>
            <p className={`text-lg font-bold ${user?.whatsappConnected ? 'text-green-600' : 'text-yellow-600'}`}>
              {user?.whatsappConnected ? 'Conectado ✓' : 'No conectado'}
            </p>
            {user?.whatsappPhone && (
              <p className="text-xs text-gray-500">{user.whatsappPhone}</p>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
              <span className="text-2xl">🤖</span>
            </div>
            <h3 className="text-gray-500 text-sm">Chatbots</h3>
            <p className="text-lg font-bold text-gray-800">
              {stats?.chatbotsUsed || 0} / {stats?.chatbotsLimit === 999 ? '∞' : stats?.chatbotsLimit || 1}
            </p>
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

          <a href="/whatsapp" className={`bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition border-2 ${user?.whatsappConnected ? 'border-green-300' : 'border-yellow-300'}`}>
            <div className="flex items-center">
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center mr-4 ${user?.whatsappConnected ? 'bg-green-100' : 'bg-green-100'}`}>
                <span className="text-3xl">📱</span>
              </div>
              <div>
                <h3 className="font-semibold text-gray-800 text-lg">Conectar WhatsApp</h3>
                <p className={`text-sm ${user?.whatsappConnected ? 'text-green-600' : 'text-yellow-600'}`}>
                  {user?.whatsappConnected ? '✅ Conectado' : 'Escanea el QR para vincular'}
                </p>
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
            <p className="text-gray-600 text-sm">
              {isSelfConfigPlan ? 'Crea y configura tus chatbots' : 'Ver estado de configuración'}
            </p>
          </a>

          {/* Mostrar solo para planes que pueden editar */}
          {isSelfConfigPlan && (
            <a href="/negocio" className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition">
              <div className="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
                <span className="text-3xl">🏢</span>
              </div>
              <h3 className="font-semibold text-gray-800 mb-2">Mi Negocio</h3>
              <p className="text-gray-600 text-sm">Información del negocio</p>
            </a>
          )}

          <a href="/planes" className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition">
            <div className="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center mb-4">
              <span className="text-3xl">💳</span>
            </div>
            <h3 className="font-semibold text-gray-800 mb-2">
              {plan === 'FREE' ? 'Actualizar Plan' : 'Ver Planes'}
            </h3>
            <p className="text-gray-600 text-sm">
              {plan === 'FREE' ? 'Desbloquea más funciones' : 'Ver planes disponibles'}
            </p>
          </a>
        </div>

        {/* Guía de inicio rápido para usuarios nuevos */}
        {plan === 'FREE' && !user?.whatsappConnected && !user?.apiKeyConnected && (
          <div className="mt-8 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6 border border-indigo-200">
            <h3 className="font-bold text-indigo-800 text-lg mb-4">🚀 Guía de Inicio Rápido</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-start">
                <div className="w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold mr-3 flex-shrink-0">1</div>
                <div>
                  <p className="font-medium text-gray-800">Configura tu API Key</p>
                  <p className="text-sm text-gray-600">Conecta tu API Key de OpenAI</p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold mr-3 flex-shrink-0">2</div>
                <div>
                  <p className="font-medium text-gray-800">Conecta WhatsApp</p>
                  <p className="text-sm text-gray-600">Escanea el código QR</p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold mr-3 flex-shrink-0">3</div>
                <div>
                  <p className="font-medium text-gray-800">Crea tu Chatbot</p>
                  <p className="text-sm text-gray-600">Configura tu primer asistente</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

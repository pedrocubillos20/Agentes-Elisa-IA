'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const EJEMPLO_CONTEXTO = `{
  "negocio": {
    "nombre": "Mi Restaurante",
    "descripcion": "Restaurante de comida colombiana",
    "horario": "Lunes a Sábado 11am - 10pm",
    "direccion": "Calle 123 #45-67, Bogotá",
    "telefono": "+57 300 123 4567",
    "whatsapp": "+57 300 123 4567"
  },
  "productos": [
    {"nombre": "Bandeja Paisa", "precio": 35000, "descripcion": "Plato típico antioqueño"},
    {"nombre": "Ajiaco", "precio": 28000, "descripcion": "Sopa tradicional bogotana"}
  ],
  "servicios": ["Domicilios", "Reservaciones", "Eventos"],
  "preguntas_frecuentes": [
    {"pregunta": "¿Hacen domicilios?", "respuesta": "Sí, en un radio de 5km"},
    {"pregunta": "¿Aceptan tarjetas?", "respuesta": "Sí, todas las tarjetas y Nequi"}
  ],
  "instrucciones": "Sé amable y servicial. Siempre saluda. Da precios en pesos colombianos."
}`

export default function Asistentes() {
  const [asistentes, setAsistentes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showContextModal, setShowContextModal] = useState(false)
  const [showPdfModal, setShowPdfModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [planInfo, setPlanInfo] = useState<any>(null)
  const [selectedBot, setSelectedBot] = useState<any>(null)
  const [contexto, setContexto] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [notes, setNotes] = useState('')
  const [formData, setFormData] = useState({ name: '', tone: 'PROFESSIONAL' })
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null)
  const router = useRouter()
  const API_URL = process.env.NEXT_PUBLIC_API_URL

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')
    if (!token) { router.push('/'); return }
    if (userData) setUser(JSON.parse(userData))
    fetchAsistentes()
    fetchPlanInfo()
  }, [router])

  const fetchAsistentes = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/assistants`, { headers: { 'Authorization': `Bearer ${token}` } })
      const data = await res.json()
      setAsistentes(data.assistants || [])
      if (data.planInfo) setPlanInfo(data.planInfo)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const fetchPlanInfo = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/assistants/plan-info`, { headers: { 'Authorization': `Bearer ${token}` } })
      const data = await res.json()
      setPlanInfo(data)
      
      // Calcular días restantes de trial
      if (data.plan === 'FREE' && data.trialEndsAt) {
        const trialEnd = new Date(data.trialEndsAt)
        const now = new Date()
        const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        setTrialDaysLeft(daysLeft > 0 ? daysLeft : 0)
      }
    } catch (e) { console.error(e) }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) return
    setCreating(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/assistants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(formData)
      })
      const data = await res.json()
      if (res.ok) {
        setShowModal(false)
        setFormData({ name: '', tone: 'PROFESSIONAL' })
        fetchAsistentes()
        
        // Si el plan requiere PDF, abrir modal de PDF
        if (planInfo?.mustUploadPdf && data.assistant) {
          setSelectedBot(data.assistant)
          setBusinessName(data.assistant.name)
          setShowPdfModal(true)
        }
      } else alert(data.error || 'Error')
    } catch { alert('Error') }
    finally { setCreating(false) }
  }

  const handleToggle = async (id: string) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/assistants/${id}/toggle`, { 
        method: 'PATCH', 
        headers: { 'Authorization': `Bearer ${token}` } 
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Error')
      }
      fetchAsistentes()
    } catch (e) { console.error(e) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar chatbot?')) return
    try {
      const token = localStorage.getItem('token')
      await fetch(`${API_URL}/api/assistants/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } })
      fetchAsistentes()
    } catch (e) { console.error(e) }
  }

  const openContextModal = (bot: any) => {
    setSelectedBot(bot)
    setContexto(bot.contextJson || '')
    setJsonError('')
    setShowContextModal(true)
  }

  const openPdfModal = (bot: any) => {
    setSelectedBot(bot)
    setBusinessName(bot.name)
    setPdfFile(null)
    setNotes('')
    setShowPdfModal(true)
  }

  const validateJSON = (str: string): boolean => {
    if (!str.trim()) return true
    try { JSON.parse(str); return true } catch { return false }
  }

  const handleSaveContext = async () => {
    if (contexto && !validateJSON(contexto)) {
      setJsonError('JSON inválido. Revisa la sintaxis.')
      return
    }
    setSaving(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/assistants/${selectedBot.id}/context`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ contextJson: contexto })
      })
      if (res.ok) {
        alert('✅ Contexto guardado')
        setShowContextModal(false)
        fetchAsistentes()
      } else {
        const data = await res.json()
        alert(data.error || 'Error')
      }
    } catch { alert('Error') }
    finally { setSaving(false) }
  }

  const handleUploadPdf = async () => {
    if (!businessName.trim()) {
      alert('Por favor ingresa el nombre del negocio')
      return
    }
    
    setUploading(true)
    try {
      const token = localStorage.getItem('token')
      const formData = new FormData()
      formData.append('businessName', businessName)
      formData.append('notes', notes)
      if (selectedBot) formData.append('assistantId', selectedBot.id)
      if (pdfFile) formData.append('pdf', pdfFile)

      const res = await fetch(`${API_URL}/api/config/request`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      })

      if (res.ok) {
        alert('✅ Solicitud enviada exitosamente. Nuestro equipo configurará tu chatbot pronto.')
        setShowPdfModal(false)
        setPdfFile(null)
        setBusinessName('')
        setNotes('')
        fetchAsistentes()
      } else {
        const data = await res.json()
        alert(data.error || 'Error al enviar solicitud')
      }
    } catch { alert('Error') }
    finally { setUploading(false) }
  }

  const loadExample = () => {
    setContexto(EJEMPLO_CONTEXTO)
    setJsonError('')
  }

  const formatJSON = () => {
    try {
      const parsed = JSON.parse(contexto)
      setContexto(JSON.stringify(parsed, null, 2))
      setJsonError('')
    } catch { setJsonError('No se puede formatear: JSON inválido') }
  }

  const canEditContext = planInfo?.canEditContext || false
  const mustUploadPdf = planInfo?.mustUploadPdf || false

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

      <main className="max-w-7xl mx-auto py-8 px-4">
        {/* Alerta de Trial */}
        {planInfo?.plan === 'FREE' && trialDaysLeft !== null && (
          <div className={`border-l-4 p-4 mb-6 rounded-r-lg ${trialDaysLeft > 0 ? 'bg-blue-50 border-blue-500' : 'bg-red-50 border-red-500'}`}>
            <div className="flex items-center">
              <span className="text-2xl mr-3">{trialDaysLeft > 0 ? '⏳' : '⚠️'}</span>
              <div className="flex-1">
                <h3 className={`font-bold ${trialDaysLeft > 0 ? 'text-blue-800' : 'text-red-800'}`}>
                  {trialDaysLeft > 0 ? `Periodo de prueba: ${trialDaysLeft} días restantes` : 'Tu periodo de prueba ha expirado'}
                </h3>
                <p className={`text-sm ${trialDaysLeft > 0 ? 'text-blue-700' : 'text-red-700'}`}>
                  {trialDaysLeft > 0 
                    ? 'Actualiza tu plan para seguir usando el servicio sin interrupciones' 
                    : 'Actualiza tu plan para continuar usando los chatbots'}
                </p>
              </div>
              <a href="/planes" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                Ver Planes
              </a>
            </div>
          </div>
        )}

        {/* Alerta API Key */}
        {!user?.apiKeyConnected && (
          <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 mb-6 rounded-r-lg">
            <div className="flex items-center">
              <span className="text-2xl mr-3">⚠️</span>
              <div className="flex-1">
                <h3 className="font-bold text-yellow-800">API Key no configurada</h3>
                <p className="text-yellow-700 text-sm">Los chatbots no funcionarán sin API Key de OpenAI</p>
              </div>
              <a href="/configuracion" className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700">
                Configurar
              </a>
            </div>
          </div>
        )}

        {/* Info del Plan */}
        {planInfo && (
          <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-2xl">📊</span>
                <div>
                  <p className="text-sm text-gray-500">Tu Plan</p>
                  <p className="font-bold text-gray-900">{planInfo.plan}</p>
                </div>
                <div className="border-l pl-4">
                  <p className="text-sm text-gray-500">Chatbots</p>
                  <p className="font-bold text-gray-900">{planInfo.chatbotsUsed} / {planInfo.chatbotsLimit === 999 ? '∞' : planInfo.chatbotsLimit}</p>
                </div>
              </div>
              <a href="/planes" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
                Cambiar plan →
              </a>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center">
            <span className="text-3xl mr-3">🤖</span>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Mis Chatbots</h1>
              <p className="text-gray-600">Gestiona y configura tus chatbots de WhatsApp</p>
            </div>
          </div>
          <button 
            onClick={() => setShowModal(true)} 
            disabled={planInfo?.trialExpired}
            className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            + Crear Chatbot
          </button>
        </div>

        {/* Lista de Chatbots */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
            <p className="mt-4 text-gray-500">Cargando...</p>
          </div>
        ) : asistentes.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
            <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-4xl">🤖</span>
            </div>
            <h3 className="text-xl font-semibold mb-2">Sin chatbots</h3>
            <p className="text-gray-600 mb-6">Crea tu primer chatbot para empezar a automatizar tu negocio</p>
            <button 
              onClick={() => setShowModal(true)} 
              disabled={planInfo?.trialExpired}
              className="bg-indigo-600 text-white px-6 py-3 rounded-lg disabled:opacity-50"
            >
              + Crear Chatbot
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {asistentes.map((a) => (
              <div key={a.id} className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center">
                    <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mr-3">🤖</div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{a.name}</h3>
                      <span className={`text-xs px-2 py-1 rounded-full ${a.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {a.isActive ? '🟢 Activo' : '⚫ Inactivo'}
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Estado del contexto */}
                <div className={`text-xs px-2 py-1 rounded mb-4 inline-block ${a.contextJson ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {a.contextJson ? '✓ Contexto configurado' : '⚠ Pendiente de configuración'}
                </div>

                <div className="space-y-2">
                  {/* Botones según el plan */}
                  {/* Plan FREE: Ambas opciones */}
                  {planInfo?.plan === 'FREE' && (
                    <>
                      <button 
                        onClick={() => openContextModal(a)} 
                        className="w-full px-4 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700"
                      >
                        🧠 Configurar Contexto (JSON)
                      </button>
                      <button 
                        onClick={() => openPdfModal(a)} 
                        className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                      >
                        📄 Enviar PDF (Nosotros configuramos)
                      </button>
                    </>
                  )}
                  
                  {/* Plans BUSINESS y MARCA_BLANCA: Solo JSON */}
                  {(planInfo?.plan === 'BUSINESS' || planInfo?.plan === 'MARCA_BLANCA') && (
                    <button 
                      onClick={() => openContextModal(a)} 
                      className="w-full px-4 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700"
                    >
                      🧠 Configurar Contexto (JSON)
                    </button>
                  )}
                  
                  {/* Plans EMPRENDEDORES y NEGOCIOS: Solo PDF */}
                  {(planInfo?.plan === 'EMPRENDEDORES' || planInfo?.plan === 'NEGOCIOS') && (
                    <button 
                      onClick={() => openPdfModal(a)} 
                      className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                    >
                      📄 Enviar Información (PDF)
                    </button>
                  )}
                  
                  <div className="flex space-x-2">
                    <button 
                      onClick={() => handleToggle(a.id)} 
                      disabled={!a.contextJson}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${a.isActive ? 'bg-gray-100 text-gray-700' : 'bg-green-100 text-green-700'}`}
                    >
                      {a.isActive ? 'Desactivar' : 'Activar'}
                    </button>
                    <button onClick={() => handleDelete(a.id)} className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm">🗑️</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modal Crear Chatbot */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Crear Chatbot</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Chatbot *</label>
                <input 
                  type="text" 
                  value={formData.name} 
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" 
                  placeholder="Ej: Asistente de Mi Restaurante" 
                  required 
                />
                <p className="text-xs text-gray-500 mt-1">Este será el nombre de tu chatbot</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tono de comunicación</label>
                <select 
                  value={formData.tone} 
                  onChange={(e) => setFormData({ ...formData, tone: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="PROFESSIONAL">Profesional</option>
                  <option value="FRIENDLY">Amigable</option>
                  <option value="CASUAL">Casual</option>
                </select>
              </div>
              
              {/* Info según plan */}
              <div className={`p-4 rounded-lg ${canEditContext ? 'bg-purple-50' : 'bg-blue-50'}`}>
                <p className={`text-sm ${canEditContext ? 'text-purple-700' : 'text-blue-700'}`}>
                  {canEditContext 
                    ? '🧠 Después de crear el chatbot, podrás configurar el contexto con toda la información de tu negocio.'
                    : '📄 Después de crear el chatbot, podrás subir un PDF con la información de tu negocio y nuestro equipo lo configurará.'}
                </p>
              </div>

              <div className="flex space-x-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={creating || !formData.name.trim()} className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-lg disabled:opacity-50 hover:bg-indigo-700">
                  {creating ? 'Creando...' : 'Crear Chatbot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Configurar Contexto (Para FREE, BUSINESS y MARCA_BLANCA) */}
      {showContextModal && selectedBot && (planInfo?.plan === 'FREE' || planInfo?.plan === 'BUSINESS' || planInfo?.plan === 'MARCA_BLANCA') && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-6 border-b">
              <div>
                <h2 className="text-xl font-bold">🧠 Configurar Contexto</h2>
                <p className="text-gray-600 text-sm">Chatbot: {selectedBot.name}</p>
              </div>
              <button onClick={() => setShowContextModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            
            <div className="p-6 flex-1 overflow-y-auto">
              <p className="text-gray-600 mb-4">
                Define toda la información de tu negocio en formato JSON. La IA usará este contexto para responder a tus clientes. 
                <strong> No hay límite de escritura.</strong>
              </p>
              
              {/* Botones de acción */}
              <div className="flex flex-wrap gap-2 mb-4">
                <button onClick={loadExample} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm">
                  📋 Cargar Ejemplo
                </button>
                <button onClick={formatJSON} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm">
                  ✨ Formatear JSON
                </button>
                <button onClick={() => { setContexto(''); setJsonError('') }} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm">
                  🗑️ Limpiar
                </button>
                <div className="ml-auto">
                  <span className={`text-xs px-2 py-1 rounded ${validateJSON(contexto) ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {validateJSON(contexto) ? '✓ JSON Válido' : '✗ JSON Inválido'}
                  </span>
                </div>
              </div>

              {/* Editor */}
              <div className="bg-gray-900 rounded-xl overflow-hidden">
                <div className="bg-gray-800 text-gray-400 px-4 py-2 text-xs font-mono">contexto.json</div>
                <textarea
                  value={contexto}
                  onChange={(e) => { setContexto(e.target.value); setJsonError('') }}
                  className="w-full h-96 p-4 font-mono text-sm bg-gray-900 text-green-400 focus:outline-none resize-none"
                  placeholder='{\n  "negocio": {\n    "nombre": "Tu Negocio"\n  }\n}'
                  spellCheck={false}
                />
              </div>

              {jsonError && (
                <div className="mt-2 text-red-600 text-sm">❌ {jsonError}</div>
              )}

              {/* Guía rápida */}
              <div className="mt-4 bg-blue-50 rounded-lg p-4">
                <h4 className="font-bold text-blue-900 mb-2">📖 Estructura recomendada:</h4>
                <ul className="text-blue-800 text-sm space-y-1">
                  <li><strong>negocio:</strong> nombre, descripción, horario, dirección, teléfono, whatsapp</li>
                  <li><strong>productos:</strong> lista con nombre, precio, descripción de cada producto</li>
                  <li><strong>servicios:</strong> lista de servicios que ofreces</li>
                  <li><strong>preguntas_frecuentes:</strong> preguntas y respuestas comunes de tus clientes</li>
                  <li><strong>instrucciones:</strong> cómo debe comportarse el bot (tono, reglas, etc.)</li>
                </ul>
              </div>
            </div>

            <div className="p-6 border-t flex justify-end gap-3">
              <button onClick={() => setShowContextModal(false)} className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancelar
              </button>
              <button 
                onClick={handleSaveContext} 
                disabled={saving || (contexto && !validateJSON(contexto))}
                className="px-6 py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 disabled:opacity-50"
              >
                {saving ? '⏳ Guardando...' : '💾 Guardar Contexto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Subir PDF (Para FREE, EMPRENDEDORES y NEGOCIOS) */}
      {showPdfModal && selectedBot && (planInfo?.plan === 'FREE' || planInfo?.plan === 'EMPRENDEDORES' || planInfo?.plan === 'NEGOCIOS') && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-xl font-bold">📄 Enviar Información del Negocio</h2>
                <p className="text-gray-600 text-sm">Chatbot: {selectedBot.name}</p>
              </div>
              <button onClick={() => setShowPdfModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <div className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-blue-800 text-sm">
                  📋 Nuestro equipo configurará tu chatbot con la información que nos envíes. 
                  Puedes subir un PDF con todos los detalles de tu negocio.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Negocio *</label>
                <input 
                  type="text" 
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Ej: Restaurante La Esquina"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Archivo PDF (opcional)</label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
                  <input 
                    type="file" 
                    accept=".pdf"
                    onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="pdf-upload"
                  />
                  <label htmlFor="pdf-upload" className="cursor-pointer">
                    {pdfFile ? (
                      <div className="text-green-600">
                        <span className="text-3xl">✅</span>
                        <p className="mt-2 font-medium">{pdfFile.name}</p>
                        <p className="text-sm text-gray-500">{(pdfFile.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    ) : (
                      <div className="text-gray-500">
                        <span className="text-3xl">📁</span>
                        <p className="mt-2">Arrastra tu PDF aquí o haz clic para seleccionar</p>
                        <p className="text-xs mt-1">Máximo 10MB</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notas adicionales</label>
                <textarea 
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="Describe tu negocio, productos, servicios, preguntas frecuentes de tus clientes, etc."
                />
              </div>

              <div className="bg-yellow-50 p-4 rounded-lg">
                <p className="text-yellow-800 text-sm">
                  <strong>⚡ Incluye en tu información:</strong> nombre, descripción, horarios, productos con precios, 
                  servicios, formas de pago, preguntas frecuentes, y cualquier detalle que tu chatbot deba conocer.
                </p>
              </div>
            </div>

            <div className="flex space-x-3 pt-6">
              <button 
                type="button" 
                onClick={() => setShowPdfModal(false)} 
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button 
                onClick={handleUploadPdf}
                disabled={uploading || !businessName.trim()}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg disabled:opacity-50 hover:bg-blue-700"
              >
                {uploading ? '⏳ Enviando...' : '📤 Enviar Solicitud'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

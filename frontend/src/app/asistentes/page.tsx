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
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [selectedBot, setSelectedBot] = useState<any>(null)
  const [contexto, setContexto] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [formData, setFormData] = useState({ name: '', welcomeMessage: '¡Hola! ¿En qué puedo ayudarte?', tone: 'PROFESSIONAL' })
  const router = useRouter()
  const API_URL = process.env.NEXT_PUBLIC_API_URL

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')
    if (!token) { router.push('/'); return }
    if (userData) setUser(JSON.parse(userData))
    fetchAsistentes()
  }, [router])

  const fetchAsistentes = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/assistants`, { headers: { 'Authorization': `Bearer ${token}` } })
      const data = await res.json()
      setAsistentes(data.assistants || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
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
        setFormData({ name: '', welcomeMessage: '¡Hola! ¿En qué puedo ayudarte?', tone: 'PROFESSIONAL' })
        fetchAsistentes()
      } else alert(data.error || 'Error')
    } catch { alert('Error') }
    finally { setCreating(false) }
  }

  const handleToggle = async (id: string) => {
    try {
      const token = localStorage.getItem('token')
      await fetch(`${API_URL}/api/assistants/${id}/toggle`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` } })
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
        {!user?.apiKeyConnected && (
          <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 mb-6 rounded-r-lg">
            <div className="flex items-center">
              <span className="text-2xl mr-3">⚠️</span>
              <div className="flex-1">
                <h3 className="font-bold text-yellow-800">API Key no configurada</h3>
                <p className="text-yellow-700 text-sm">Los chatbots no funcionarán sin API Key</p>
              </div>
              <a href="/configuracion" className="bg-yellow-600 text-white px-4 py-2 rounded-lg">Configurar</a>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">🤖 Mis Chatbots</h1>
            <p className="text-gray-600">Gestiona y configura tus chatbots de WhatsApp</p>
          </div>
          <button onClick={() => setShowModal(true)} className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700">
            + Crear Chatbot
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <svg className="animate-spin h-12 w-12 text-indigo-600 mx-auto" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </div>
        ) : asistentes.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
            <span className="text-5xl mb-6 block">🤖</span>
            <h3 className="text-xl font-semibold mb-2">Sin chatbots</h3>
            <p className="text-gray-600 mb-6">Crea tu primer chatbot para empezar</p>
            <button onClick={() => setShowModal(true)} className="bg-indigo-600 text-white px-6 py-3 rounded-lg">+ Crear Chatbot</button>
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
                
                <p className="text-gray-600 text-sm mb-2 line-clamp-2">{a.welcomeMessage}</p>
                
                {/* Estado del contexto */}
                <div className={`text-xs px-2 py-1 rounded mb-4 inline-block ${a.contextJson ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {a.contextJson ? '✓ Contexto configurado' : '⚠ Sin contexto'}
                </div>

                <div className="space-y-2">
                  {/* Botón principal: Configurar Contexto */}
                  <button 
                    onClick={() => openContextModal(a)} 
                    className="w-full px-4 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700"
                  >
                    🧠 Configurar Contexto
                  </button>
                  
                  <div className="flex space-x-2">
                    <button onClick={() => handleToggle(a.id)} className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium ${a.isActive ? 'bg-gray-100 text-gray-700' : 'bg-green-100 text-green-700'}`}>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="Asistente de Ventas" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mensaje de Bienvenida</label>
                <textarea value={formData.welcomeMessage} onChange={(e) => setFormData({ ...formData, welcomeMessage: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg" rows={3} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tono</label>
                <select value={formData.tone} onChange={(e) => setFormData({ ...formData, tone: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg">
                  <option value="PROFESSIONAL">Profesional</option>
                  <option value="FRIENDLY">Amigable</option>
                  <option value="CASUAL">Casual</option>
                </select>
              </div>
              <div className="flex space-x-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-3 border border-gray-300 rounded-lg">Cancelar</button>
                <button type="submit" disabled={creating || !formData.name.trim()} className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-lg disabled:opacity-50">
                  {creating ? 'Creando...' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Configurar Contexto */}
      {showContextModal && selectedBot && (
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
                Define toda la información de tu negocio en formato JSON. La IA usará este contexto para responder.
              </p>
              
              {/* Botones de acción */}
              <div className="flex gap-2 mb-4">
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
                  className="w-full h-80 p-4 font-mono text-sm bg-gray-900 text-green-400 focus:outline-none resize-none"
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
                  <li><strong>negocio:</strong> nombre, descripción, horario, dirección, teléfono</li>
                  <li><strong>productos:</strong> lista con nombre, precio, descripción</li>
                  <li><strong>servicios:</strong> lista de servicios ofrecidos</li>
                  <li><strong>preguntas_frecuentes:</strong> preguntas y respuestas comunes</li>
                  <li><strong>instrucciones:</strong> cómo debe comportarse el bot</li>
                </ul>
              </div>
            </div>

            <div className="p-6 border-t flex justify-end gap-3">
              <button onClick={() => setShowContextModal(false)} className="px-6 py-3 border border-gray-300 rounded-lg">
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
    </div>
  )
}

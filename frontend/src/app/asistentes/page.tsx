'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Assistant {
  id: string
  name: string
  welcomeMessage: string
  tone: string
  status: string
  isActive: boolean
  publicApiKey: string
  createdAt: string
}

export default function Asistentes() {
  const [asistentes, setAsistentes] = useState<Assistant[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newAssistant, setNewAssistant] = useState({
    name: '',
    welcomeMessage: '¡Hola! ¿En qué puedo ayudarte hoy?',
    tone: 'PROFESSIONAL',
  })
  const router = useRouter()
  const API_URL = process.env.NEXT_PUBLIC_API_URL

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.push('/')
      return
    }
    fetchAsistentes()
  }, [router])

  const fetchAsistentes = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`${API_URL}/api/assistants`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await response.json()
      setAsistentes(data.assistants || [])
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateAssistant = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`${API_URL}/api/assistants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(newAssistant),
      })

      if (response.ok) {
        setShowModal(false)
        setNewAssistant({
          name: '',
          welcomeMessage: '¡Hola! ¿En qué puedo ayudarte hoy?',
          tone: 'PROFESSIONAL',
        })
        fetchAsistentes()
      } else {
        const data = await response.json()
        alert(data.error || 'Error al crear asistente')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error de conexión')
    } finally {
      setCreating(false)
    }
  }

  const toggleAssistant = async (id: string, currentStatus: boolean) => {
    try {
      const token = localStorage.getItem('token')
      await fetch(`${API_URL}/api/assistants/${id}/toggle`, {
        method: 'PATCH',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ isActive: !currentStatus })
      })
      fetchAsistentes()
    } catch (error) {
      console.error('Error:', error)
    }
  }

  const copyWidgetCode = (apiKey: string) => {
    const code = `<!-- Elisa IA Widget -->
<script>
  window.ElisaIA = { apiKey: '${apiKey}' };
</script>
<script src="https://agentes-elisa-ia.vercel.app/widget.js" async></script>`
    
    navigator.clipboard.writeText(code)
    alert('¡Código del widget copiado al portapapeles!')
  }

  const deleteAssistant = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este asistente?')) return

    try {
      const token = localStorage.getItem('token')
      await fetch(`${API_URL}/api/assistants/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      fetchAsistentes()
    } catch (error) {
      console.error('Error:', error)
    }
  }

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

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
          <div className="mb-4 sm:mb-0">
            <h1 className="text-3xl font-bold text-gray-900">Mis Asistentes</h1>
            <p className="text-gray-600 mt-1">Gestiona tus asistentes de IA</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition flex items-center"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Crear Asistente
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-12">
            <svg className="animate-spin h-12 w-12 text-indigo-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-500">Cargando asistentes...</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && asistentes.length === 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
            <div className="w-24 h-24 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-12 h-12 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No tienes asistentes aún</h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              Crea tu primer asistente de IA para empezar a automatizar tu atención al cliente
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition"
            >
              Crear mi primer asistente
            </button>
          </div>
        )}

        {/* Assistants Grid */}
        {!loading && asistentes.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {asistentes.map((asistente) => (
              <div key={asistente.id} className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{asistente.name}</h3>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-1 ${
                        asistente.isActive 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {asistente.isActive ? '● Activo' : '○ Inactivo'}
                      </span>
                    </div>
                    <button
                      onClick={() => toggleAssistant(asistente.id, asistente.isActive)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        asistente.isActive ? 'bg-indigo-600' : 'bg-gray-200'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow ${
                          asistente.isActive ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  <p className="text-gray-600 text-sm mb-4 line-clamp-2">
                    "{asistente.welcomeMessage}"
                  </p>

                  <div className="flex items-center text-sm text-gray-500 mb-4">
                    <span className="bg-gray-100 px-2 py-1 rounded text-xs capitalize">
                      {asistente.tone.toLowerCase()}
                    </span>
                    <span className="mx-2">•</span>
                    <span>{new Date(asistente.createdAt).toLocaleDateString('es-CO')}</span>
                  </div>

                  <div className="flex space-x-2">
                    <button
                      onClick={() => copyWidgetCode(asistente.publicApiKey)}
                      className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition flex items-center justify-center"
                    >
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Widget
                    </button>
                    <button
                      onClick={() => deleteAssistant(asistente.id)}
                      className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modal Crear Asistente */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">Crear Nuevo Asistente</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <form onSubmit={handleCreateAssistant} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre del Asistente *
                </label>
                <input
                  type="text"
                  value={newAssistant.name}
                  onChange={(e) => setNewAssistant({ ...newAssistant, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="Ej: Asistente de Ventas"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Mensaje de Bienvenida
                </label>
                <textarea
                  value={newAssistant.welcomeMessage}
                  onChange={(e) => setNewAssistant({ ...newAssistant, welcomeMessage: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  rows={3}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tono de Comunicación
                </label>
                <select
                  value={newAssistant.tone}
                  onChange={(e) => setNewAssistant({ ...newAssistant, tone: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="PROFESSIONAL">Profesional</option>
                  <option value="FRIENDLY">Amigable</option>
                  <option value="CASUAL">Casual</option>
                </select>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
                >
                  {creating ? 'Creando...' : 'Crear Asistente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

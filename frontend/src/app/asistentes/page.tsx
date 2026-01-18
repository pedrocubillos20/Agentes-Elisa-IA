'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Asistentes() {
  const [asistentes, setAsistentes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [user, setUser] = useState<any>(null)
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

  const copyCode = (apiKey: string) => {
    navigator.clipboard.writeText(`<script>\n  window.ElisaIA = { apiKey: '${apiKey}' };\n</script>\n<script src="https://agentes-elisa-ia.vercel.app/widget.js" async></script>`)
    alert('Código copiado!')
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
            <h1 className="text-3xl font-bold text-gray-900">Mis Chatbots</h1>
            <p className="text-gray-600">Gestiona tus chatbots de WhatsApp</p>
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
            <p className="text-gray-600 mb-6">Crea tu primer chatbot</p>
            <button onClick={() => setShowModal(true)} className="bg-indigo-600 text-white px-6 py-3 rounded-lg">+ Crear</button>
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
                <p className="text-gray-600 text-sm mb-4 line-clamp-2">{a.welcomeMessage}</p>
                <div className="flex space-x-2">
                  <button onClick={() => handleToggle(a.id)} className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium ${a.isActive ? 'bg-gray-100 text-gray-700' : 'bg-green-100 text-green-700'}`}>
                    {a.isActive ? 'Desactivar' : 'Activar'}
                  </button>
                  <button onClick={() => copyCode(a.publicApiKey)} className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm">📋</button>
                  <button onClick={() => handleDelete(a.id)} className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm">🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

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
    </div>
  )
}

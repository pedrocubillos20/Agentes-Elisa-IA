'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminPanel() {
  const [requests, setRequests] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('PENDING')
  const [selectedRequest, setSelectedRequest] = useState<any>(null)
  const [configJson, setConfigJson] = useState('')
  const [adminNotes, setAdminNotes] = useState('')
  const [saving, setSaving] = useState(false)
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
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)
      if (!parsedUser.isAdmin) {
        alert('No tienes permisos de administrador')
        router.push('/dashboard')
        return
      }
    }
    fetchRequests()
    fetchStats()
  }, [router, filter])

  const fetchRequests = async () => {
    try {
      const token = localStorage.getItem('token')
      const url = filter === 'ALL' 
        ? `${API_URL}/api/config/admin/all`
        : `${API_URL}/api/config/admin/all?status=${filter}`
      
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (res.status === 403) {
        alert('No tienes permisos de administrador')
        router.push('/dashboard')
        return
      }
      
      const data = await res.json()
      setRequests(data.requests || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/config/admin/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      setStats(data.stats)
    } catch (e) {
      console.error(e)
    }
  }

  const updateStatus = async (id: string, status: string) => {
    try {
      const token = localStorage.getItem('token')
      await fetch(`${API_URL}/api/config/admin/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status, adminNotes })
      })
      fetchRequests()
      fetchStats()
      if (selectedRequest?.id === id) {
        setSelectedRequest({ ...selectedRequest, status })
      }
    } catch (e) {
      alert('Error al actualizar estado')
    }
  }

  const saveConfig = async () => {
    if (!selectedRequest) return
    
    // Validar JSON
    if (configJson.trim()) {
      try {
        JSON.parse(configJson)
      } catch {
        alert('JSON inválido. Por favor revisa la sintaxis.')
        return
      }
    }
    
    setSaving(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/config/admin/${selectedRequest.id}/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          configJson,
          assistantId: selectedRequest.assistantId
        })
      })
      
      if (res.ok) {
        alert('✅ Configuración guardada y aplicada al chatbot')
        setSelectedRequest(null)
        setConfigJson('')
        fetchRequests()
        fetchStats()
      } else {
        const data = await res.json()
        alert(data.error || 'Error al guardar')
      }
    } catch (e) {
      alert('Error al guardar configuración')
    } finally {
      setSaving(false)
    }
  }

  const downloadPdf = async (id: string) => {
    const token = localStorage.getItem('token')
    window.open(`${API_URL}/api/config/admin/${id}/download-pdf?token=${token}`, '_blank')
  }

  const openRequestDetail = (request: any) => {
    setSelectedRequest(request)
    setConfigJson(request.configJson || '')
    setAdminNotes(request.adminNotes || '')
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      'PENDING': 'bg-yellow-100 text-yellow-800',
      'IN_PROGRESS': 'bg-blue-100 text-blue-800',
      'COMPLETED': 'bg-green-100 text-green-800',
    }
    const labels: Record<string, string> = {
      'PENDING': '⏳ Pendiente',
      'IN_PROGRESS': '🔄 En Proceso',
      'COMPLETED': '✅ Completado',
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100'}`}>
        {labels[status] || status}
      </span>
    )
  }

  if (!user?.isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Acceso Denegado</h1>
          <p className="text-gray-600 mb-4">No tienes permisos de administrador</p>
          <a href="/dashboard" className="text-indigo-600 hover:underline">Volver al Dashboard</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-indigo-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between h-16 items-center">
          <div className="flex items-center">
            <span className="text-xl font-bold">🔐 Panel de Administrador</span>
          </div>
          <a href="/dashboard" className="text-indigo-200 hover:text-white">← Volver al Dashboard</a>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-8 px-4">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex items-center">
                <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center mr-4">
                  <span className="text-2xl">⏳</span>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Pendientes</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.pending}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex items-center">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mr-4">
                  <span className="text-2xl">🔄</span>
                </div>
                <div>
                  <p className="text-sm text-gray-500">En Proceso</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.inProgress}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex items-center">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mr-4">
                  <span className="text-2xl">✅</span>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Completados</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.completed}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex items-center">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mr-4">
                  <span className="text-2xl">📊</span>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filtros */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
          <div className="flex items-center gap-2">
            <span className="text-gray-600 font-medium">Filtrar:</span>
            {['ALL', 'PENDING', 'IN_PROGRESS', 'COMPLETED'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === f 
                    ? 'bg-indigo-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {f === 'ALL' ? 'Todos' : f === 'PENDING' ? 'Pendientes' : f === 'IN_PROGRESS' ? 'En Proceso' : 'Completados'}
              </button>
            ))}
          </div>
        </div>

        {/* Lista de solicitudes */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="p-6 border-b">
            <h2 className="text-xl font-bold text-gray-900">📄 Solicitudes de Configuración</h2>
            <p className="text-gray-500 text-sm">Gestiona las solicitudes de configuración de clientes</p>
          </div>

          {loading ? (
            <div className="p-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-4 text-gray-500">Cargando...</p>
            </div>
          ) : requests.length === 0 ? (
            <div className="p-12 text-center">
              <span className="text-4xl">📭</span>
              <h3 className="mt-4 text-lg font-semibold text-gray-900">No hay solicitudes</h3>
              <p className="text-gray-500">No hay solicitudes con el filtro seleccionado</p>
            </div>
          ) : (
            <div className="divide-y">
              {requests.map((req) => (
                <div key={req.id} className="p-6 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-semibold text-gray-900">{req.businessName}</h3>
                        {getStatusBadge(req.status)}
                      </div>
                      <div className="text-sm text-gray-500 space-y-1">
                        <p>📧 {req.user?.email}</p>
                        <p>📱 {req.user?.phone || 'Sin teléfono'}</p>
                        <p>📅 {new Date(req.createdAt).toLocaleDateString('es-CO', { 
                          day: 'numeric', 
                          month: 'long', 
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}</p>
                        <p>💼 Plan: <span className="font-medium">{req.user?.plan}</span></p>
                      </div>
                      {req.notes && (
                        <div className="mt-2 p-2 bg-gray-50 rounded text-sm text-gray-700">
                          <strong>Notas del cliente:</strong> {req.notes}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {req.pdfUrl && (
                        <button
                          onClick={() => downloadPdf(req.id)}
                          className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200"
                        >
                          📥 Descargar PDF
                        </button>
                      )}
                      <button
                        onClick={() => openRequestDetail(req)}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
                      >
                        ⚙️ Configurar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Modal de configuración */}
      {selectedRequest && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-6 border-b">
              <div>
                <h2 className="text-xl font-bold">⚙️ Configurar Chatbot</h2>
                <p className="text-gray-500">{selectedRequest.businessName} - {selectedRequest.user?.email}</p>
              </div>
              <button 
                onClick={() => setSelectedRequest(null)} 
                className="text-gray-400 hover:text-gray-600 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto space-y-4">
              {/* Info del cliente */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold mb-2">📋 Información del Cliente</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <p><strong>Email:</strong> {selectedRequest.user?.email}</p>
                  <p><strong>Plan:</strong> {selectedRequest.user?.plan}</p>
                  <p><strong>Teléfono:</strong> {selectedRequest.user?.phone || 'N/A'}</p>
                  <p><strong>Fecha:</strong> {new Date(selectedRequest.createdAt).toLocaleDateString('es-CO')}</p>
                </div>
                {selectedRequest.notes && (
                  <div className="mt-2 p-2 bg-white rounded border">
                    <strong>Notas:</strong> {selectedRequest.notes}
                  </div>
                )}
              </div>

              {/* Estado */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Estado de la Solicitud</label>
                <div className="flex gap-2">
                  {['PENDING', 'IN_PROGRESS', 'COMPLETED'].map((status) => (
                    <button
                      key={status}
                      onClick={() => updateStatus(selectedRequest.id, status)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium ${
                        selectedRequest.status === status
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {status === 'PENDING' ? '⏳ Pendiente' : status === 'IN_PROGRESS' ? '🔄 En Proceso' : '✅ Completado'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notas del admin */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Notas Internas (Admin)</label>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  rows={2}
                  placeholder="Notas internas..."
                />
              </div>

              {/* Editor JSON */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  🧠 Configuración JSON (Contexto del Chatbot)
                </label>
                <div className="bg-gray-900 rounded-xl overflow-hidden">
                  <div className="bg-gray-800 text-gray-400 px-4 py-2 text-xs font-mono flex justify-between items-center">
                    <span>config.json</span>
                    <button
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(configJson)
                          setConfigJson(JSON.stringify(parsed, null, 2))
                        } catch {}
                      }}
                      className="text-blue-400 hover:text-blue-300"
                    >
                      Formatear
                    </button>
                  </div>
                  <textarea
                    value={configJson}
                    onChange={(e) => setConfigJson(e.target.value)}
                    className="w-full h-64 p-4 font-mono text-sm bg-gray-900 text-green-400 focus:outline-none resize-none"
                    placeholder='Escribe aquí el JSON de configuración basado en el PDF del cliente...'
                    spellCheck={false}
                  />
                </div>
              </div>
            </div>

            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={() => setSelectedRequest(null)}
                className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cerrar
              </button>
              <button
                onClick={saveConfig}
                disabled={saving || !configJson.trim()}
                className="px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? '⏳ Guardando...' : '💾 Guardar y Aplicar Configuración'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Negocio() {
  const [business, setBusiness] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    name: '', industry: '', description: '', contactEmail: '', contactPhone: '', address: '', businessHours: ''
  })
  const router = useRouter()
  const API_URL = process.env.NEXT_PUBLIC_API_URL

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { router.push('/'); return }
    fetchBusiness()
  }, [router])

  const fetchBusiness = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/business`, { headers: { 'Authorization': `Bearer ${token}` } })
      const data = await res.json()
      if (data.businesses?.length > 0) {
        const b = data.businesses[0]
        setBusiness(b)
        setFormData({
          name: b.name || '', industry: b.industry || '', description: b.description || '',
          contactEmail: b.contactEmail || '', contactPhone: b.contactPhone || '',
          address: b.address || '', businessHours: b.businessHours || ''
        })
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const token = localStorage.getItem('token')
      const method = business ? 'PUT' : 'POST'
      const url = business ? `${API_URL}/api/business/${business.id}` : `${API_URL}/api/business`
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(formData)
      })
      if (res.ok) {
        alert('Guardado!')
        fetchBusiness()
      } else alert('Error')
    } catch { alert('Error') }
    finally { setSaving(false) }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <svg className="animate-spin h-12 w-12 text-indigo-600" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
    </div>
  )

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

      <main className="max-w-3xl mx-auto py-8 px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">🏢 Mi Negocio</h1>
        <p className="text-gray-600 mb-8">Esta información la usará el chatbot para responder preguntas</p>

        <form onSubmit={handleSave} className="bg-white rounded-2xl shadow-sm p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Negocio *</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Industria</label>
              <input type="text" value={formData.industry} onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="Ej: Restaurante, Tienda" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
            <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg" rows={3} placeholder="¿Qué hace tu negocio?" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email de Contacto</label>
              <input type="email" value={formData.contactEmail} onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono de Contacto</label>
              <input type="tel" value={formData.contactPhone} onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
            <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Horario de Atención</label>
            <input type="text" value={formData.businessHours} onChange={(e) => setFormData({ ...formData, businessHours: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="Ej: Lunes a Viernes 9am - 6pm" />
          </div>

          <button type="submit" disabled={saving || !formData.name}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </form>

        <div className="mt-8 grid grid-cols-2 gap-4">
          <a href={`/productos${business ? `?businessId=${business.id}` : ''}`} className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition text-center">
            <span className="text-3xl mb-2 block">📦</span>
            <h3 className="font-semibold">Productos</h3>
            <p className="text-gray-500 text-sm">Gestiona tus productos</p>
          </a>
          <a href={`/faqs${business ? `?businessId=${business.id}` : ''}`} className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition text-center">
            <span className="text-3xl mb-2 block">❓</span>
            <h3 className="font-semibold">FAQs</h3>
            <p className="text-gray-500 text-sm">Preguntas frecuentes</p>
          </a>
        </div>
      </main>
    </div>
  )
}

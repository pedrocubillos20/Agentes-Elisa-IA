'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function FAQs() {
  const [faqs, setFaqs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [formData, setFormData] = useState({ question: '', answer: '', category: '' })
  const router = useRouter()
  const searchParams = useSearchParams()
  const API_URL = process.env.NEXT_PUBLIC_API_URL

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { router.push('/'); return }
    const bid = searchParams.get('businessId')
    if (bid) { setBusinessId(bid); fetchFaqs(bid) }
    else fetchBusiness()
  }, [router, searchParams])

  const fetchBusiness = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/business`, { headers: { 'Authorization': `Bearer ${token}` } })
      const data = await res.json()
      if (data.businesses?.[0]) { setBusinessId(data.businesses[0].id); fetchFaqs(data.businesses[0].id) }
      else setLoading(false)
    } catch { setLoading(false) }
  }

  const fetchFaqs = async (bid: string) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/business/${bid}/faqs`, { headers: { 'Authorization': `Bearer ${token}` } })
      const data = await res.json()
      setFaqs(data.faqs || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId) return
    setSaving(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/business/${businessId}/faqs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(formData)
      })
      if (res.ok) { setShowModal(false); setFormData({ question: '', answer: '', category: '' }); fetchFaqs(businessId) }
    } catch { alert('Error') }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!businessId || !confirm('¿Eliminar?')) return
    try {
      const token = localStorage.getItem('token')
      await fetch(`${API_URL}/api/business/${businessId}/faqs/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } })
      fetchFaqs(businessId)
    } catch (e) { console.error(e) }
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
          <a href="/negocio" className="text-gray-600 hover:text-gray-800">← Volver</a>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto py-8 px-4">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">❓ Preguntas Frecuentes</h1>
            <p className="text-gray-600">El chatbot usará estas respuestas</p>
          </div>
          <button onClick={() => setShowModal(true)} className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold">+ Agregar FAQ</button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <svg className="animate-spin h-12 w-12 text-indigo-600 mx-auto" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </div>
        ) : faqs.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
            <span className="text-5xl mb-4 block">❓</span>
            <h3 className="text-xl font-semibold mb-2">Sin FAQs</h3>
            <p className="text-gray-600 mb-6">Agrega preguntas frecuentes</p>
          </div>
        ) : (
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div key={faq.id} className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex justify-between">
                  <div>
                    <span className="bg-indigo-100 text-indigo-600 rounded-full w-6 h-6 inline-flex items-center justify-center text-sm font-bold mr-2">{i + 1}</span>
                    <span className="font-semibold">{faq.question}</span>
                    <p className="text-gray-600 mt-2 ml-8">{faq.answer}</p>
                  </div>
                  <button onClick={() => handleDelete(faq.id)} className="text-red-500 hover:text-red-700">🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6">
            <h2 className="text-xl font-bold mb-6">Nueva FAQ</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Pregunta *</label>
                <input type="text" value={formData.question} onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Respuesta *</label>
                <textarea value={formData.answer} onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg" rows={4} required />
              </div>
              <div className="flex space-x-3">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border rounded-lg">Cancelar</button>
                <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50">
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

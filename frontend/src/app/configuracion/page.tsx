'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Configuracion() {
  const [apiKey, setApiKey] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [maskedKey, setMaskedKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)
  const router = useRouter()
  const API_URL = process.env.NEXT_PUBLIC_API_URL

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { router.push('/'); return }
    checkStatus()
  }, [router])

  const checkStatus = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.user?.apiKeyConnected) {
        setIsConnected(true)
        setMaskedKey('sk-••••••••••••' + (data.user.apiKeyLast4 || '••••'))
      }
    } catch (e) { console.error(e) }
  }

  const handleTest = async () => {
    if (!apiKey.startsWith('sk-')) { alert('La API Key debe comenzar con "sk-"'); return }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })
      setTestResult(res.ok ? 'success' : 'error')
    } catch { setTestResult('error') }
    finally { setTesting(false) }
  }

  const handleSave = async () => {
    if (!apiKey.startsWith('sk-')) { alert('API Key inválida'); return }
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/auth/api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ apiKey })
      })
      if (res.ok) {
        alert('¡API Key guardada!')
        setIsConnected(true)
        setMaskedKey('sk-••••••••••••' + apiKey.slice(-4))
        setApiKey('')
        setTestResult(null)
        const userData = JSON.parse(localStorage.getItem('user') || '{}')
        userData.apiKeyConnected = true
        localStorage.setItem('user', JSON.stringify(userData))
      } else {
        const data = await res.json()
        alert(data.error || 'Error')
      }
    } catch { alert('Error de conexión') }
    finally { setLoading(false) }
  }

  const handleRemove = async () => {
    if (!confirm('¿Eliminar API Key? Los chatbots dejarán de funcionar.')) return
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      await fetch(`${API_URL}/api/auth/api-key`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      setIsConnected(false)
      setMaskedKey('')
      const userData = JSON.parse(localStorage.getItem('user') || '{}')
      userData.apiKeyConnected = false
      localStorage.setItem('user', JSON.stringify(userData))
    } catch { alert('Error') }
    finally { setLoading(false) }
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

      <main className="max-w-3xl mx-auto py-8 px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">🔑 Configurar API Key de OpenAI</h1>
        <p className="text-gray-600 mb-8">Conecta tu cuenta de OpenAI. Tú eres responsable de tus créditos.</p>

        {/* Estado */}
        <div className={`rounded-xl p-6 mb-8 ${isConnected ? 'bg-green-50 border-2 border-green-300' : 'bg-red-50 border-2 border-red-300'}`}>
          <div className="flex items-center">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mr-4 ${isConnected ? 'bg-green-100' : 'bg-red-100'}`}>
              {isConnected ? (
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>
            <div className="flex-1">
              <h3 className={`text-lg font-bold ${isConnected ? 'text-green-800' : 'text-red-800'}`}>
                {isConnected ? '✅ API Key Conectada' : '❌ NO Configurada'}
              </h3>
              {isConnected ? <p className="text-green-700 font-mono">{maskedKey}</p> : <p className="text-red-700">Los chatbots NO funcionarán</p>}
            </div>
            {isConnected && <button onClick={handleRemove} disabled={loading} className="text-red-600 hover:text-red-800">Eliminar</button>}
          </div>
        </div>

        {/* Formulario */}
        <div className="bg-white rounded-2xl shadow-sm p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-6">{isConnected ? '🔄 Cambiar' : '➕ Agregar'} API Key</h2>
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">API Key de OpenAI *</label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setTestResult(null) }}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
                placeholder="sk-proj-xxxxxxxxxxxxxxxx"
              />
            </div>

            {testResult && (
              <div className={`p-4 rounded-lg ${testResult === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {testResult === 'success' ? '✅ API Key válida' : '❌ API Key inválida o sin créditos'}
              </div>
            )}

            <div className="flex gap-4">
              <button onClick={handleTest} disabled={!apiKey || testing || !apiKey.startsWith('sk-')}
                className="flex-1 py-3 px-6 border-2 border-indigo-600 text-indigo-600 rounded-lg font-semibold hover:bg-indigo-50 disabled:opacity-50">
                {testing ? '⏳ Probando...' : '🧪 Probar'}
              </button>
              <button onClick={handleSave} disabled={!apiKey || loading || testResult !== 'success'}
                className="flex-1 py-3 px-6 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50">
                {loading ? '⏳ Guardando...' : '💾 Guardar'}
              </button>
            </div>
          </div>
        </div>

        {/* Instrucciones */}
        <div className="mt-8 bg-blue-50 rounded-xl p-6">
          <h3 className="font-bold text-blue-900 mb-4">📝 ¿Cómo obtener tu API Key?</h3>
          <ol className="space-y-2 text-blue-800">
            <li>1. Ve a <a href="https://platform.openai.com" target="_blank" className="underline font-medium">platform.openai.com</a></li>
            <li>2. Crea cuenta o inicia sesión</li>
            <li>3. Ve a <strong>API Keys</strong></li>
            <li>4. Clic en <strong>"Create new secret key"</strong></li>
            <li>5. <strong>¡Importante!</strong> Recarga créditos en <strong>Billing</strong></li>
          </ol>
        </div>

        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <h3 className="font-bold text-yellow-800 mb-2">⚠️ Importante</h3>
          <ul className="text-yellow-700 space-y-1 text-sm">
            <li>• Cada mensaje consume créditos de TU cuenta OpenAI</li>
            <li>• Tú eres responsable de mantener créditos</li>
            <li>• Sin créditos, los chatbots dejan de responder</li>
          </ul>
        </div>
      </main>
    </div>
  )
}

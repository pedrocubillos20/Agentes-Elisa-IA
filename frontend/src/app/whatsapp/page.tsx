'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

export default function WhatsApp() {
  const [status, setStatus] = useState<'disconnected' | 'waiting' | 'connected'>('disconnected')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [phoneNumber, setPhoneNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [timeLeft, setTimeLeft] = useState(120)
  const pollingRef = useRef<any>(null)
  const timerRef = useRef<any>(null)
  const router = useRouter()
  const API_URL = process.env.NEXT_PUBLIC_API_URL

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { router.push('/'); return }
    checkStatus()
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [router])

  const checkStatus = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/whatsapp/status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.connected) {
        setStatus('connected')
        setPhoneNumber(data.phoneNumber || '')
      }
    } catch (e) { console.error(e) }
  }

  const generateQR = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/whatsapp/generate-qr`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      
      if (data.qrCode) {
        setQrCode(data.qrCode)
        setStatus('waiting')
        setTimeLeft(120)
        startPolling()
        startTimer()
      } else {
        alert(data.error || 'Error al generar QR')
      }
    } catch (e) {
      alert('Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  const startPolling = () => {
    pollingRef.current = setInterval(async () => {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch(`${API_URL}/api/whatsapp/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const data = await res.json()
        
        if (data.connected) {
          setStatus('connected')
          setPhoneNumber(data.phoneNumber || '')
          setQrCode(null)
          clearInterval(pollingRef.current)
          clearInterval(timerRef.current)
          const user = JSON.parse(localStorage.getItem('user') || '{}')
          user.whatsappConnected = true
          localStorage.setItem('user', JSON.stringify(user))
        }
      } catch (e) { console.error(e) }
    }, 3000)
  }

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(pollingRef.current)
          clearInterval(timerRef.current)
          setStatus('disconnected')
          setQrCode(null)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const disconnect = async () => {
    if (!confirm('¿Desconectar WhatsApp?')) return
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      await fetch(`${API_URL}/api/whatsapp/disconnect`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      setStatus('disconnected')
      setPhoneNumber('')
      const user = JSON.parse(localStorage.getItem('user') || '{}')
      user.whatsappConnected = false
      localStorage.setItem('user', JSON.stringify(user))
    } catch (e) { alert('Error') }
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
        <h1 className="text-3xl font-bold text-gray-900 mb-2">📱 Conectar WhatsApp Business</h1>
        <p className="text-gray-600 mb-8">Vincula tu WhatsApp para que el chatbot responda automáticamente</p>

        {/* Estado */}
        <div className={`rounded-xl p-6 mb-8 ${
          status === 'connected' ? 'bg-green-50 border-2 border-green-400' : 
          status === 'waiting' ? 'bg-yellow-50 border-2 border-yellow-400' :
          'bg-gray-100 border-2 border-gray-300'
        }`}>
          <div className="flex items-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mr-4 ${
              status === 'connected' ? 'bg-green-500' : 
              status === 'waiting' ? 'bg-yellow-500' : 'bg-gray-400'
            }`}>
              <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </div>
            <div className="flex-1">
              <h3 className={`text-xl font-bold ${
                status === 'connected' ? 'text-green-800' : 
                status === 'waiting' ? 'text-yellow-800' : 'text-gray-700'
              }`}>
                {status === 'connected' ? '✅ WhatsApp Conectado' :
                 status === 'waiting' ? '⏳ Esperando escaneo...' : '❌ No Conectado'}
              </h3>
              {status === 'connected' && phoneNumber && <p className="text-green-700 text-lg">{phoneNumber}</p>}
              {status === 'waiting' && <p className="text-yellow-700">Escanea el QR con tu teléfono</p>}
              {status === 'disconnected' && <p className="text-gray-600">Conecta WhatsApp para activar el chatbot</p>}
            </div>
            {status === 'connected' && (
              <button onClick={disconnect} disabled={loading} className="bg-red-100 text-red-600 px-4 py-2 rounded-lg font-medium hover:bg-red-200">
                Desconectar
              </button>
            )}
          </div>
        </div>

        {/* QR */}
        {status !== 'connected' && (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            {qrCode ? (
              <>
                <h2 className="text-xl font-bold text-gray-900 mb-4">📷 Escanea este código QR</h2>
                <div className="inline-block p-4 bg-white border-4 border-green-500 rounded-2xl mb-4">
                  <img src={qrCode} alt="QR" className="w-64 h-64" />
                </div>
                <div className="flex items-center justify-center text-yellow-600 mb-2">
                  <svg className="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Esperando...
                </div>
                <p className="text-gray-500 text-sm">Expira en {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</p>
              </>
            ) : (
              <>
                <div className="w-32 h-32 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <span className="text-6xl">📱</span>
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Conecta tu WhatsApp Business</h2>
                <p className="text-gray-600 mb-6">Genera un código QR y escanéalo</p>
                <button onClick={generateQR} disabled={loading}
                  className="bg-green-600 text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-green-700 disabled:opacity-50">
                  {loading ? '⏳ Generando...' : '🔗 Generar Código QR'}
                </button>
              </>
            )}
          </div>
        )}

        {/* Instrucciones */}
        <div className="mt-8 bg-blue-50 rounded-xl p-6">
          <h3 className="font-bold text-blue-900 mb-4">📋 Cómo conectar</h3>
          <ol className="space-y-2 text-blue-800">
            <li>1. Haz clic en <strong>"Generar Código QR"</strong></li>
            <li>2. Abre <strong>WhatsApp Business</strong> en tu teléfono</li>
            <li>3. Ve a <strong>Menú (⋮) → Dispositivos vinculados</strong></li>
            <li>4. Toca <strong>"Vincular un dispositivo"</strong></li>
            <li>5. Escanea el código QR</li>
            <li>6. ¡Listo! Tu chatbot responderá automáticamente 🎉</li>
          </ol>
        </div>
      </main>
    </div>
  )
}

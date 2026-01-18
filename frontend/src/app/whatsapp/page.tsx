'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function WhatsApp() {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) router.push('/')
  }, [router])

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
        <p className="text-gray-600 mb-8">Escanea el código QR para vincular tu WhatsApp</p>

        <div className={`rounded-xl p-6 mb-8 ${status === 'connected' ? 'bg-green-50 border-2 border-green-300' : 'bg-gray-100 border-2 border-gray-300'}`}>
          <div className="flex items-center">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mr-4 ${status === 'connected' ? 'bg-green-500' : 'bg-gray-400'}`}>
              <span className="text-3xl">📱</span>
            </div>
            <div>
              <h3 className={`text-lg font-bold ${status === 'connected' ? 'text-green-800' : 'text-gray-700'}`}>
                {status === 'connected' ? '✅ WhatsApp Conectado' : '❌ No Conectado'}
              </h3>
              <p className={status === 'connected' ? 'text-green-700' : 'text-gray-600'}>
                {status === 'connected' ? 'Tu chatbot está recibiendo mensajes' : 'Conecta tu WhatsApp para activar el chatbot'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
          <div className="w-48 h-48 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="text-6xl">📱</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Próximamente</h2>
          <p className="text-gray-600 mb-6">La conexión con WhatsApp Business estará disponible pronto.</p>
          <p className="text-gray-500 text-sm">Por ahora, contacta al equipo de soporte para que te ayudemos a configurar tu WhatsApp.</p>
        </div>

        <div className="mt-8 bg-blue-50 rounded-xl p-6">
          <h3 className="font-bold text-blue-900 mb-4">📋 Cómo funciona</h3>
          <ol className="space-y-2 text-blue-800">
            <li>1. Necesitas WhatsApp Business instalado</li>
            <li>2. Generamos un código QR</li>
            <li>3. Lo escaneas con tu teléfono</li>
            <li>4. ¡Tu chatbot empieza a responder!</li>
          </ol>
        </div>
      </main>
    </div>
  )
}

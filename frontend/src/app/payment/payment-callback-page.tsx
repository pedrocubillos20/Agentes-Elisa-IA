'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function PaymentCallback() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'pending'>('loading')
  const [message, setMessage] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const checkPayment = async () => {
      const reference = searchParams.get('id') || searchParams.get('reference')
      
      if (!reference) {
        setStatus('error')
        setMessage('No se encontró referencia de pago')
        return
      }

      try {
        const token = localStorage.getItem('token')
        const API_URL = process.env.NEXT_PUBLIC_API_URL

        const response = await fetch(`${API_URL}/api/payments/verify/${reference}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })

        const data = await response.json()

        if (data.payment) {
          switch (data.payment.status) {
            case 'APPROVED':
              setStatus('success')
              setMessage('¡Pago exitoso! Tu plan ha sido actualizado.')
              // Actualizar usuario en localStorage
              const user = JSON.parse(localStorage.getItem('user') || '{}')
              user.plan = data.payment.plan
              user.subscriptionStatus = 'ACTIVE'
              localStorage.setItem('user', JSON.stringify(user))
              break
            case 'PENDING':
              setStatus('pending')
              setMessage('Tu pago está siendo procesado. Te notificaremos cuando esté listo.')
              break
            case 'DECLINED':
            case 'VOIDED':
            case 'ERROR':
              setStatus('error')
              setMessage('El pago no fue aprobado. Por favor, intenta de nuevo.')
              break
            default:
              setStatus('pending')
              setMessage('Verificando estado del pago...')
          }
        } else {
          setStatus('error')
          setMessage('No se pudo verificar el pago')
        }
      } catch (error) {
        console.error('Error:', error)
        setStatus('error')
        setMessage('Error al verificar el pago')
      }
    }

    checkPayment()
  }, [searchParams])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        {status === 'loading' && (
          <>
            <div className="w-16 h-16 mx-auto mb-6">
              <svg className="animate-spin h-16 w-16 text-indigo-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Verificando pago...</h1>
            <p className="text-gray-600">Por favor espera mientras confirmamos tu transacción</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-20 h-20 mx-auto mb-6 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">¡Pago Exitoso!</h1>
            <p className="text-gray-600 mb-6">{message}</p>
            <button
              onClick={() => router.push('/dashboard')}
              className="bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition"
            >
              Ir al Dashboard
            </button>
          </>
        )}

        {status === 'pending' && (
          <>
            <div className="w-20 h-20 mx-auto mb-6 bg-yellow-100 rounded-full flex items-center justify-center">
              <svg className="w-10 h-10 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Pago Pendiente</h1>
            <p className="text-gray-600 mb-6">{message}</p>
            <button
              onClick={() => router.push('/dashboard')}
              className="bg-gray-200 text-gray-800 px-8 py-3 rounded-lg font-semibold hover:bg-gray-300 transition"
            >
              Ir al Dashboard
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-20 h-20 mx-auto mb-6 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Error en el Pago</h1>
            <p className="text-gray-600 mb-6">{message}</p>
            <div className="space-y-3">
              <button
                onClick={() => router.push('/planes')}
                className="w-full bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition"
              >
                Intentar de Nuevo
              </button>
              <button
                onClick={() => router.push('/dashboard')}
                className="w-full bg-gray-200 text-gray-800 px-8 py-3 rounded-lg font-semibold hover:bg-gray-300 transition"
              >
                Ir al Dashboard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

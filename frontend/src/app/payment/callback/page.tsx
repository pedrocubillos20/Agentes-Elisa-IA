'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function PaymentCallback() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'pending'>('loading')
  const [message, setMessage] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const API_URL = process.env.NEXT_PUBLIC_API_URL

  useEffect(() => {
    const check = async () => {
      const ref = searchParams.get('id') || searchParams.get('reference')
      if (!ref) { setStatus('error'); setMessage('Sin referencia'); return }

      try {
        const token = localStorage.getItem('token')
        const res = await fetch(`${API_URL}/api/payments/verify/${ref}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const data = await res.json()

        if (data.payment) {
          switch (data.payment.status) {
            case 'APPROVED':
              setStatus('success')
              setMessage('¡Pago exitoso! Tu plan ha sido actualizado.')
              const user = JSON.parse(localStorage.getItem('user') || '{}')
              user.plan = data.payment.plan
              user.subscriptionStatus = 'ACTIVE'
              localStorage.setItem('user', JSON.stringify(user))
              break
            case 'PENDING':
              setStatus('pending')
              setMessage('Tu pago está siendo procesado.')
              break
            default:
              setStatus('error')
              setMessage('El pago no fue aprobado.')
          }
        } else {
          setStatus('error')
          setMessage('No se pudo verificar el pago')
        }
      } catch { setStatus('error'); setMessage('Error de conexión') }
    }
    check()
  }, [searchParams])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        {status === 'loading' && (
          <>
            <svg className="animate-spin h-16 w-16 text-indigo-600 mx-auto mb-6" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <h1 className="text-2xl font-bold mb-2">Verificando pago...</h1>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-2">¡Pago Exitoso!</h1>
            <p className="text-gray-600 mb-6">{message}</p>
            <button onClick={() => router.push('/dashboard')} className="bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold">
              Ir al Dashboard
            </button>
          </>
        )}
        {status === 'pending' && (
          <>
            <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-4xl">⏳</span>
            </div>
            <h1 className="text-2xl font-bold mb-2">Pago Pendiente</h1>
            <p className="text-gray-600 mb-6">{message}</p>
            <button onClick={() => router.push('/dashboard')} className="bg-gray-200 text-gray-800 px-8 py-3 rounded-lg font-semibold">
              Ir al Dashboard
            </button>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-4xl">❌</span>
            </div>
            <h1 className="text-2xl font-bold mb-2">Error</h1>
            <p className="text-gray-600 mb-6">{message}</p>
            <button onClick={() => router.push('/planes')} className="bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold">
              Intentar de Nuevo
            </button>
          </>
        )}
      </div>
    </div>
  )
}

'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, XCircle, Clock, Mail, ArrowRight } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function PaymentResultPage() {
  const searchParams = useSearchParams();
  const reference = searchParams.get('ref') || searchParams.get('id') || '';
  const [status, setStatus] = useState<string>('checking');
  const [data, setData] = useState<any>(null);
  const [retries, setRetries] = useState(0);

  useEffect(() => {
    if (!reference) { setStatus('error'); return; }
    checkPayment();
  }, [reference]);

  // Poll cada 3s si está pending
  useEffect(() => {
    if (status === 'pending' && retries < 20) {
      const timer = setTimeout(() => {
        setRetries(r => r + 1);
        checkPayment();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [status, retries]);

  const checkPayment = async () => {
    try {
      const res = await fetch(`${API_URL}/api/payments/check/${reference}`);
      const result = await res.json();
      setData(result);
      setStatus(result.status || 'error');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #0a0a1a 0%, #0f1b2d 50%, #0a0a1a 100%)' }}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">
            <span style={{ color: '#00d4aa' }}>Bizonne</span>
            <span className="text-white">CRM</span>
          </h1>
        </div>

        <div className="rounded-2xl p-8 text-center" style={{ background: '#1a1a2e', border: '1px solid #2a2a3e' }}>
          {/* CHECKING */}
          {status === 'checking' && (
            <>
              <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center animate-pulse" style={{ background: '#3b82f620' }}>
                <Clock className="w-8 h-8" style={{ color: '#3b82f6' }} />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Verificando pago...</h2>
              <p className="text-gray-400">Consultando el estado de tu transacción</p>
            </>
          )}

          {/* PENDING */}
          {status === 'pending' && (
            <>
              <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center animate-pulse" style={{ background: '#f59e0b20' }}>
                <Clock className="w-8 h-8" style={{ color: '#f59e0b' }} />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Procesando pago...</h2>
              <p className="text-gray-400 mb-4">Tu pago está siendo procesado. Esto puede tomar unos segundos.</p>
              <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#2a2a3e' }}>
                <div className="h-full rounded-full animate-pulse" style={{ background: '#f59e0b', width: `${Math.min(retries * 5, 95)}%`, transition: 'width 1s' }} />
              </div>
              <p className="text-xs text-gray-500 mt-2">Referencia: {reference}</p>
            </>
          )}

          {/* APPROVED */}
          {status === 'approved' && (
            <>
              <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: '#10b98120' }}>
                <CheckCircle className="w-8 h-8" style={{ color: '#10b981' }} />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">¡Pago exitoso!</h2>
              <p className="text-gray-400 mb-2">
                Plan: <strong style={{ color: '#00d4aa' }}>{data?.plan === 'business' ? 'Business' : 'Starter'}</strong>
              </p>
              {data?.email && (
                <div className="my-6 p-4 rounded-xl" style={{ background: '#0f3460', border: '1px solid #1e4976' }}>
                  <Mail className="w-6 h-6 mx-auto mb-2" style={{ color: '#00d4aa' }} />
                  <p className="text-sm text-gray-300">
                    Hemos enviado un email a <strong style={{ color: '#00d4aa' }}>{data.email}</strong> con el enlace para activar tu cuenta.
                  </p>
                  <p className="text-xs text-gray-500 mt-2">Revisa tu bandeja de entrada y spam.</p>
                </div>
              )}
              {data?.tokenUsed && (
                <Link href="/login" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-black" style={{ background: 'linear-gradient(135deg, #00d4aa, #10b981)' }}>
                  Ir a iniciar sesión <ArrowRight className="w-4 h-4" />
                </Link>
              )}
            </>
          )}

          {/* DECLINED / ERROR */}
          {(status === 'declined' || status === 'error' || status === 'voided') && (
            <>
              <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: '#ef444420' }}>
                <XCircle className="w-8 h-8" style={{ color: '#ef4444' }} />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">
                {status === 'declined' ? 'Pago rechazado' : status === 'voided' ? 'Pago anulado' : 'Error en el pago'}
              </h2>
              <p className="text-gray-400 mb-6">
                {status === 'declined' ? 'Tu medio de pago rechazó la transacción. Intenta con otro medio.' : 'Hubo un problema con tu transacción.'}
              </p>
              <Link href="/#pricing" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold" style={{ background: '#2a2a3e', color: '#00d4aa' }}>
                Intentar de nuevo
              </Link>
            </>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          ¿Problemas? Escríbenos a soporte@bizonne.com
        </p>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function WhatsAppPage() {
  const router = useRouter();
  const [status, setStatus] = useState<{
    connected: boolean;
    phoneNumber: string | null;
    loading: boolean;
  }>({
    connected: false,
    phoneNumber: null,
    loading: true,
  });
  
  const [formData, setFormData] = useState({
    accessToken: '',
    phoneNumberId: '',
  });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://elisa-iaagentes-production.up.railway.app';

  useEffect(() => {
    checkStatus();
  }, []);

  const getToken = () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  };

  const checkStatus = async () => {
    try {
      const token = getToken();
      if (!token) {
        router.push('/');
        return;
      }

      const response = await fetch(`${API_URL}/api/whatsapp/status`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setStatus({
          connected: data.connected,
          phoneNumber: data.phoneNumber,
          loading: false,
        });
      } else {
        setStatus(prev => ({ ...prev, loading: false }));
      }
    } catch (err) {
      console.error('Error checking status:', err);
      setStatus(prev => ({ ...prev, loading: false }));
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    setError('');
    setSuccess('');

    try {
      const token = getToken();
      if (!token) {
        router.push('/');
        return;
      }

      const response = await fetch(`${API_URL}/api/whatsapp/configure`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accessToken: formData.accessToken,
          phoneNumberId: formData.phoneNumberId,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSuccess('¡WhatsApp conectado exitosamente!');
        setStatus({
          connected: true,
          phoneNumber: data.phoneNumber,
          loading: false,
        });
        setFormData({ accessToken: '', phoneNumberId: '' });
      } else {
        setError(data.error || 'Error al conectar WhatsApp');
      }
    } catch (err: any) {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('¿Estás seguro de desconectar WhatsApp?')) return;

    try {
      const token = getToken();
      const response = await fetch(`${API_URL}/api/whatsapp/disconnect`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        setStatus({
          connected: false,
          phoneNumber: null,
          loading: false,
        });
        setSuccess('WhatsApp desconectado');
      }
    } catch (err) {
      setError('Error al desconectar');
    }
  };

  if (status.loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-8">
      <div className="max-w-2xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <Link href="/dashboard" className="text-gray-400 hover:text-white flex items-center gap-2 mb-4 transition">
            ← Volver al Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <span className="text-4xl">📱</span>
            Conectar WhatsApp Business
          </h1>
          <p className="text-gray-400 mt-2">
            Vincula tu WhatsApp para que el chatbot responda automáticamente
          </p>
        </div>

        {/* Status Card */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700 p-6 mb-6">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
              status.connected ? 'bg-green-500/20' : 'bg-red-500/20'
            }`}>
              {status.connected ? (
                <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>
            <div className="flex-1">
              <h3 className={`font-semibold text-lg ${status.connected ? 'text-green-400' : 'text-red-400'}`}>
                {status.connected ? 'Conectado' : 'No Conectado'}
              </h3>
              {status.connected && status.phoneNumber && (
                <p className="text-gray-300">Número: {status.phoneNumber}</p>
              )}
              {!status.connected && (
                <p className="text-gray-500">Conecta WhatsApp para activar el chatbot</p>
              )}
            </div>
            {status.connected && (
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 text-red-400 hover:bg-red-500/10 rounded-lg transition border border-red-500/30"
              >
                Desconectar
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-lg mb-6">
            {success}
          </div>
        )}

        {/* Connect Form */}
        {!status.connected && (
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700 p-6">
            <h2 className="text-xl font-semibold text-white mb-4">
              Configurar WhatsApp Cloud API
            </h2>
            
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
              <h3 className="font-medium text-blue-400 mb-2">📋 ¿Cómo obtener las credenciales?</h3>
              <ol className="text-blue-300 text-sm space-y-1 list-decimal list-inside">
                <li>Ve a <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-200">developers.facebook.com</a></li>
                <li>Crea una App con WhatsApp Business</li>
                <li>En "Prueba de API" genera el Access Token</li>
                <li>Copia el Phone Number ID</li>
              </ol>
            </div>

            <form onSubmit={handleConnect} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Phone Number ID
                </label>
                <input
                  type="text"
                  value={formData.phoneNumberId}
                  onChange={(e) => setFormData(prev => ({ ...prev, phoneNumberId: e.target.value }))}
                  placeholder="Ej: 933910106477757"
                  className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Lo encuentras en Meta Business → WhatsApp → Prueba de API
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Access Token
                </label>
                <textarea
                  value={formData.accessToken}
                  onChange={(e) => setFormData(prev => ({ ...prev, accessToken: e.target.value }))}
                  placeholder="EAAxxxxxxx..."
                  rows={4}
                  className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm transition"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Token temporal (24h) o permanente desde Meta Business
                </p>
              </div>

              <button
                type="submit"
                disabled={connecting}
                className="w-full bg-green-600 hover:bg-green-500 text-white font-semibold py-3 px-6 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {connecting ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Conectando...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    Conectar WhatsApp
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Info when connected */}
        {status.connected && (
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700 p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <span className="text-green-500">✓</span>
              WhatsApp Configurado
            </h2>
            <div className="space-y-4 text-gray-300">
              <p>
                Tu chatbot está listo para recibir mensajes. Cuando alguien escriba a tu número de WhatsApp Business, recibirá respuestas automáticas.
              </p>
              <div className="bg-slate-700/50 rounded-lg p-4">
                <h3 className="font-medium text-white mb-3">Próximos pasos:</h3>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start gap-3">
                    <span className="bg-green-500/20 text-green-400 w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0">1</span>
                    <span>Configura tu asistente con el contexto de tu negocio</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="bg-green-500/20 text-green-400 w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0">2</span>
                    <span>Envía un mensaje de prueba a tu número de WhatsApp</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="bg-green-500/20 text-green-400 w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0">3</span>
                    <span>¡Verifica que el bot responda correctamente!</span>
                  </li>
                </ul>
              </div>
              <div className="flex gap-3 mt-4">
                <Link
                  href="/asistentes"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-center py-2 px-4 rounded-lg transition"
                >
                  Configurar Asistente
                </Link>
                <Link
                  href="/dashboard"
                  className="flex-1 bg-slate-600 hover:bg-slate-500 text-white text-center py-2 px-4 rounded-lg transition"
                >
                  Ir al Dashboard
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Help Section */}
        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>¿Necesitas ayuda? Contacta soporte técnico</p>
        </div>
      </div>
    </div>
  );
}

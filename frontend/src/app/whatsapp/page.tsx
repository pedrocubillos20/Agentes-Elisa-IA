'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Smartphone, 
  QrCode, 
  CheckCircle, 
  XCircle, 
  RefreshCw,
  Loader2,
  AlertCircle,
  Wifi,
  WifiOff
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function WhatsAppPage() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pollingActive, setPollingActive] = useState(false);

  // Fetch initial status
  useEffect(() => {
    fetchStatus();
  }, []);

  // Poll for status updates when waiting for QR scan
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (pollingActive && !status?.connected) {
      interval = setInterval(() => {
        fetchStatus(true);
      }, 3000); // Poll every 3 seconds
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [pollingActive, status?.connected]);

  const fetchStatus = async (silent = false) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    if (!silent) setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/whatsapp/status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        
        if (data.qrCode) {
          setQrCode(data.qrCode);
        }
        
        if (data.connected) {
          setPollingActive(false);
          setQrCode(null);
        }
      }
    } catch (error) {
      console.error('Error fetching status:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleConnect = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    setConnecting(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/api/whatsapp/connect`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Error al conectar');
      }

      if (data.connected) {
        setStatus({ ...status, connected: true, phone: data.phone });
        setQrCode(null);
      } else if (data.qrCode) {
        setQrCode(data.qrCode);
        setPollingActive(true);
      }

      fetchStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    setDisconnecting(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/api/whatsapp/disconnect`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Error al desconectar');
      }

      setStatus({ connected: false, status: 'disconnected' });
      setQrCode(null);
      setPollingActive(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleRefreshQR = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    setConnecting(true);

    try {
      const res = await fetch(`${API_URL}/api/whatsapp/qr`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await res.json();

      if (data.connected) {
        setStatus({ ...status, connected: true, phone: data.phone });
        setQrCode(null);
        setPollingActive(false);
      } else if (data.qrCode) {
        setQrCode(data.qrCode);
      }
    } catch (error) {
      console.error('Error refreshing QR:', error);
    } finally {
      setConnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Smartphone className="w-8 h-8 text-emerald-400" />
          Conectar WhatsApp
        </h1>
        <p className="text-slate-400 mt-2">
          Vincula tu WhatsApp para que el chatbot responda automáticamente
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Main Card */}
      <div className="bg-slate-800/50 rounded-2xl border border-slate-700 overflow-hidden">
        {/* Status Header */}
        <div className={`p-6 border-b border-slate-700 ${
          status?.connected ? 'bg-emerald-500/10' : 'bg-slate-700/30'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
                status?.connected ? 'bg-emerald-500/20' : 'bg-slate-600'
              }`}>
                {status?.connected ? (
                  <Wifi className="w-7 h-7 text-emerald-400" />
                ) : (
                  <WifiOff className="w-7 h-7 text-slate-400" />
                )}
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">
                  {status?.connected ? 'WhatsApp Conectado' : 'WhatsApp Desconectado'}
                </h2>
                <p className="text-slate-400">
                  {status?.connected 
                    ? `Número: +${status.phone || 'Conectado'}` 
                    : 'Escanea el código QR para conectar'
                  }
                </p>
              </div>
            </div>
            
            {status?.connected ? (
              <span className="badge-success pulse-green">
                <CheckCircle className="w-4 h-4 mr-1" />
                Activo
              </span>
            ) : (
              <span className="badge-danger">
                <XCircle className="w-4 h-4 mr-1" />
                Inactivo
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-8">
          {status?.connected ? (
            /* Connected State */
            <div className="text-center">
              <div className="w-24 h-24 mx-auto bg-emerald-500/20 rounded-full flex items-center justify-center mb-6">
                <CheckCircle className="w-12 h-12 text-emerald-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">
                ¡Todo listo!
              </h3>
              <p className="text-slate-400 mb-8 max-w-md mx-auto">
                Tu WhatsApp está conectado. Cuando alguien te escriba, el bot responderá automáticamente.
              </p>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-all duration-200 flex items-center gap-2 mx-auto disabled:opacity-50"
              >
                {disconnecting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Desconectando...
                  </>
                ) : (
                  <>
                    <XCircle className="w-5 h-5" />
                    Desconectar WhatsApp
                  </>
                )}
              </button>
            </div>
          ) : qrCode ? (
            /* QR Code State */
            <div className="text-center">
              <div className="bg-white p-6 rounded-2xl inline-block mb-6 shadow-xl">
                <img 
                  src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                  alt="QR Code"
                  className="w-64 h-64"
                />
              </div>
              
              <h3 className="text-xl font-bold text-white mb-2">
                Escanea el código QR
              </h3>
              <p className="text-slate-400 mb-6 max-w-md mx-auto">
                Abre WhatsApp en tu teléfono → Menú → Dispositivos vinculados → Vincular dispositivo
              </p>

              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={handleRefreshQR}
                  disabled={connecting}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${connecting ? 'animate-spin' : ''}`} />
                  Actualizar QR
                </button>
              </div>

              {/* Polling indicator */}
              {pollingActive && (
                <div className="mt-6 flex items-center justify-center gap-2 text-slate-400">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                  <span className="text-sm">Esperando que escanees el código...</span>
                </div>
              )}
            </div>
          ) : (
            /* Initial State - No QR yet */
            <div className="text-center">
              <div className="w-24 h-24 mx-auto bg-slate-700 rounded-full flex items-center justify-center mb-6">
                <QrCode className="w-12 h-12 text-slate-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">
                Conecta tu WhatsApp
              </h3>
              <p className="text-slate-400 mb-8 max-w-md mx-auto">
                Haz clic en el botón para generar un código QR y vincular tu WhatsApp con el chatbot
              </p>
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="px-8 py-4 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold text-lg rounded-xl transition-all duration-200 flex items-center gap-3 mx-auto disabled:opacity-50 shadow-lg shadow-emerald-500/25"
              >
                {connecting ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    Generando QR...
                  </>
                ) : (
                  <>
                    <QrCode className="w-6 h-6" />
                    Generar Código QR
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          📱 Cómo conectar WhatsApp
        </h3>
        <ol className="space-y-3 text-slate-300">
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold">1</span>
            <span>Haz clic en "Generar Código QR"</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold">2</span>
            <span>Abre WhatsApp en tu teléfono</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold">3</span>
            <span>Ve a Configuración → Dispositivos vinculados → Vincular dispositivo</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold">4</span>
            <span>Escanea el código QR con tu teléfono</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold">5</span>
            <span>¡Listo! Tu chatbot responderá automáticamente</span>
          </li>
        </ol>
      </div>

      {/* Warning */}
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-yellow-400 flex-shrink-0" />
          <div>
            <h4 className="font-semibold text-yellow-400">Importante</h4>
            <p className="text-slate-300 text-sm mt-1">
              Mantén tu teléfono conectado a internet para que el bot funcione correctamente. 
              Si cierras la sesión en tu teléfono, deberás volver a escanear el código QR.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

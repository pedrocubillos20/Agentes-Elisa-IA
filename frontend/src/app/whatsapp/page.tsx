'use client';

import { useState, useEffect } from 'react';
import { Smartphone, CheckCircle, XCircle, RefreshCw, Wifi, WifiOff, QrCode } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function WhatsAppPage() {
  const [status, setStatus] = useState<any>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Efecto para obtener QR automáticamente cuando el status es 'qr'
  useEffect(() => {
    if (status?.status === 'qr' || status?.hasQR) {
      getQR();
    }
  }, [status]);

  const checkStatus = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/status`, { 
        headers: { 'Authorization': `Bearer ${token}` } 
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.connected) {
          setQrCode(null);
        }
      }
    } catch (error) { 
      console.error('Error:', error); 
    } finally { 
      setLoading(false); 
    }
  };

  const connect = async () => {
    setConnecting(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/connect`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        // Esperar un poco para que se genere el QR
        setTimeout(() => {
          getQR();
          checkStatus();
        }, 3000);
        
        // Seguir intentando obtener el QR
        const qrInterval = setInterval(async () => {
          const hasQR = await getQR();
          if (hasQR) {
            clearInterval(qrInterval);
          }
        }, 2000);
        
        // Detener después de 30 segundos
        setTimeout(() => clearInterval(qrInterval), 30000);
      }
    } catch (error) { 
      console.error('Error:', error); 
    } finally { 
      setConnecting(false); 
    }
  };

  const disconnect = async () => {
    if (!confirm('¿Desconectar WhatsApp?')) return;
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/whatsapp/disconnect`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setQrCode(null);
      checkStatus();
    } catch (error) { 
      console.error('Error:', error); 
    }
  };

  const getQR = async (): Promise<boolean> => {
    setQrLoading(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/qr`, { 
        headers: { 'Authorization': `Bearer ${token}` } 
      });
      if (res.ok) {
        const data = await res.json();
        console.log('QR Response:', data); // Debug
        
        // El backend devuelve 'qr' no 'qrCode'
        if (data.qr) {
          setQrCode(data.qr);
          setQrLoading(false);
          return true;
        }
      }
    } catch (error) { 
      console.error('Error:', error); 
    }
    setQrLoading(false);
    return false;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <img src="/elisa.png" alt="Elisa" className="w-16 h-16 rounded-xl animate-pulse" />
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <img src="/elisa.png" alt="Elisa IA" className="w-14 h-14 rounded-xl" />
        <div>
          <h1 className="text-3xl font-bold text-white">WhatsApp</h1>
          <p className="text-[var(--text-muted)]">Conecta tu WhatsApp con Elisa IA</p>
        </div>
      </div>

      {/* Status Card */}
      <div className="card">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center ${status?.connected ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
            {status?.connected ? <Wifi className="w-10 h-10 text-emerald-400" /> : <WifiOff className="w-10 h-10 text-red-400" />}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-xl font-semibold text-white">Estado de Conexión</h2>
              <span className={`badge ${status?.connected ? 'badge-success' : 'badge-danger'}`}>
                {status?.connected ? <><CheckCircle className="w-3 h-3" />Conectado</> : <><XCircle className="w-3 h-3" />Desconectado</>}
              </span>
            </div>
            {status?.connected ? (
              <p className="text-[var(--text-muted)]">
                Número conectado: <span className="text-white font-medium">+{status.phone || 'N/A'}</span>
              </p>
            ) : (
              <p className="text-[var(--text-muted)]">Escanea el código QR para conectar tu WhatsApp</p>
            )}
          </div>
          <div className="flex gap-3">
            {status?.connected ? (
              <button onClick={disconnect} className="btn-danger">
                <XCircle className="w-4 h-4" />Desconectar
              </button>
            ) : (
              <button onClick={connect} disabled={connecting} className="btn-primary">
                {connecting ? <div className="loading-spinner w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
                {connecting ? 'Conectando...' : 'Conectar'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* QR Code Section */}
      {!status?.connected && (
        <div className="card">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-white mb-4">Escanea el Código QR</h3>
            
            {qrCode ? (
              <div className="inline-block p-6 bg-white rounded-2xl mb-4">
                <img 
                  src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`} 
                  alt="QR Code" 
                  className="w-64 h-64" 
                />
              </div>
            ) : (
              <div className="inline-flex flex-col items-center justify-center w-64 h-64 bg-[var(--bg-tertiary)] rounded-2xl mb-4">
                {qrLoading ? (
                  <>
                    <div className="loading-spinner w-12 h-12 mb-4" />
                    <p className="text-[var(--text-muted)] text-sm">Generando código QR...</p>
                  </>
                ) : (
                  <>
                    <QrCode className="w-16 h-16 text-[var(--text-muted)] mb-4" />
                    <p className="text-[var(--text-muted)] text-sm">Haz clic en "Conectar" para generar el QR</p>
                  </>
                )}
              </div>
            )}

            <div className="flex justify-center gap-3">
              <button onClick={getQR} disabled={qrLoading} className="btn-secondary">
                <RefreshCw className={`w-4 h-4 ${qrLoading ? 'animate-spin' : ''}`} />
                {qrLoading ? 'Cargando...' : 'Actualizar QR'}
              </button>
            </div>

            <div className="mt-6 p-4 bg-[var(--bg-tertiary)] rounded-xl text-left">
              <h4 className="font-semibold text-white mb-2">Instrucciones:</h4>
              <ol className="text-sm text-[var(--text-muted)] space-y-2">
                <li>1. Abre WhatsApp en tu teléfono</li>
                <li>2. Ve a <strong className="text-white">Configuración → Dispositivos vinculados</strong></li>
                <li>3. Toca <strong className="text-white">"Vincular un dispositivo"</strong></li>
                <li>4. Escanea este código QR</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card text-center">
          <div className="w-14 h-14 rounded-xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <img src="/elisa.png" alt="Elisa" className="w-8 h-8 rounded-lg" />
          </div>
          <h3 className="font-semibold text-white mb-2">IA Integrada</h3>
          <p className="text-sm text-[var(--text-muted)]">Elisa responde automáticamente a tus clientes 24/7</p>
        </div>
        <div className="card text-center">
          <div className="w-14 h-14 rounded-xl bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-7 h-7 text-blue-400" />
          </div>
          <h3 className="font-semibold text-white mb-2">Multi-conversación</h3>
          <p className="text-sm text-[var(--text-muted)]">Gestiona múltiples chats simultáneamente</p>
        </div>
        <div className="card text-center">
          <div className="w-14 h-14 rounded-xl bg-purple-500/20 flex items-center justify-center mx-auto mb-4">
            <Smartphone className="w-7 h-7 text-purple-400" />
          </div>
          <h3 className="font-semibold text-white mb-2">Sin app extra</h3>
          <p className="text-sm text-[var(--text-muted)]">Usa tu WhatsApp normal, sin instalar nada más</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center py-4">
        <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
          <img src="/elisa.png" alt="Elisa" className="w-5 h-5 rounded" />
          WhatsApp powered by Elisa IA
        </div>
      </div>
    </div>
  );
}

function MessageSquare(props: any) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

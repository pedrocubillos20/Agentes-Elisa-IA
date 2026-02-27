'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bell, BellOff, BellRing, Smartphone, Check, AlertTriangle, Send } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// =============================================
// 🔔 PUSH NOTIFICATION MANAGER
// 
// Maneja la suscripción a notificaciones push.
// Se integra en Configuración o en el Navbar.
// 
// Uso:
//   <PushNotificationManager />           → Versión completa
//   <PushNotificationManager compact />   → Botón pequeño para navbar
// =============================================

type PushState = 'loading' | 'unsupported' | 'denied' | 'not-subscribed' | 'subscribed' | 'no-vapid';

export function PushNotificationManager({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<PushState>('loading');
  const [loading, setLoading] = useState(false);
  const [testSent, setTestSent] = useState(false);

  const getToken = () => localStorage.getItem('token') || '';

  // Check current push state
  const checkState = useCallback(async () => {
    try {
      // 1. Check browser support
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setState('unsupported');
        return;
      }

      // 2. Check if VAPID key is configured
      const res = await fetch(`${API_URL}/api/push/vapid-key`);
      const data = await res.json();
      if (!data.key || !data.configured) {
        setState('no-vapid');
        return;
      }

      // 3. Check notification permission
      if (Notification.permission === 'denied') {
        setState('denied');
        return;
      }

      // 4. Check if already subscribed
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      setState(subscription ? 'subscribed' : 'not-subscribed');
    } catch (e) {
      console.error('Push check error:', e);
      setState('not-subscribed');
    }
  }, []);

  useEffect(() => { checkState(); }, [checkState]);

  // Subscribe to push notifications
  const subscribe = async () => {
    setLoading(true);
    try {
      // 1. Get VAPID public key from server
      const vapidRes = await fetch(`${API_URL}/api/push/vapid-key`);
      const vapidData = await vapidRes.json();
      if (!vapidData.key) throw new Error('VAPID key not configured');

      // 2. Request notification permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('denied');
        return;
      }

      // 3. Subscribe via Push API
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.key)
      });

      // 4. Send subscription to backend
      const token = getToken();
      const res = await fetch(`${API_URL}/api/push/subscribe`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });

      if (res.ok) {
        setState('subscribed');
      } else {
        throw new Error('Failed to save subscription');
      }
    } catch (e: any) {
      console.error('Push subscribe error:', e);
      if (Notification.permission === 'denied') {
        setState('denied');
      }
    } finally {
      setLoading(false);
    }
  };

  // Unsubscribe
  const unsubscribe = async () => {
    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        // Remove from backend
        const token = getToken();
        await fetch(`${API_URL}/api/push/unsubscribe`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        });

        // Unsubscribe from browser
        await subscription.unsubscribe();
      }

      setState('not-subscribed');
    } catch (e) {
      console.error('Push unsubscribe error:', e);
    } finally {
      setLoading(false);
    }
  };

  // Send test notification
  const sendTest = async () => {
    try {
      const token = getToken();
      await fetch(`${API_URL}/api/push/test`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      setTestSent(true);
      setTimeout(() => setTestSent(false), 3000);
    } catch (e) {
      console.error('Push test error:', e);
    }
  };

  // =============================================
  // 🎛️ COMPACT VERSION (for navbar)
  // =============================================
  if (compact) {
    if (state === 'loading' || state === 'unsupported' || state === 'no-vapid') return null;

    return (
      <button
        onClick={state === 'subscribed' ? unsubscribe : subscribe}
        disabled={loading || state === 'denied'}
        className={`relative p-2 rounded-xl transition-all ${
          state === 'subscribed' 
            ? 'text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20' 
            : state === 'denied'
            ? 'text-red-400 bg-red-500/10 cursor-not-allowed'
            : 'text-gray-400 bg-white/5 hover:bg-white/10 hover:text-white'
        }`}
        title={
          state === 'subscribed' ? 'Notificaciones push activadas ✅' :
          state === 'denied' ? 'Notificaciones bloqueadas en el navegador' :
          'Activar notificaciones push'
        }
      >
        {state === 'subscribed' ? (
          <BellRing className="w-4.5 h-4.5" />
        ) : state === 'denied' ? (
          <BellOff className="w-4.5 h-4.5" />
        ) : (
          <Bell className="w-4.5 h-4.5" />
        )}
        {state === 'subscribed' && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full" />
        )}
      </button>
    );
  }

  // =============================================
  // 📱 FULL VERSION (for settings page)
  // =============================================
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-violet-400" />
          Notificaciones Push
        </h3>
        {state === 'subscribed' && (
          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full font-semibold">
            ✅ Activadas
          </span>
        )}
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Recibe notificaciones en tu celular cuando lleguen mensajes nuevos, pedidos, citas o reservas — 
        <strong className="text-white"> incluso con la app cerrada</strong>.
      </p>

      {/* Status messages */}
      {state === 'unsupported' && (
        <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs text-orange-300 font-semibold">Navegador no compatible</p>
            <p className="text-[10px] text-orange-300/70 mt-0.5">
              Usa Chrome, Edge, Firefox o Safari 16+ para recibir notificaciones push.
            </p>
          </div>
        </div>
      )}

      {state === 'denied' && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2">
          <BellOff className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs text-red-300 font-semibold">Notificaciones bloqueadas</p>
            <p className="text-[10px] text-red-300/70 mt-0.5">
              Debes habilitarlas desde la configuración de tu navegador: 
              Ajustes → Sitios → BizonneCRM → Notificaciones → Permitir
            </p>
          </div>
        </div>
      )}

      {state === 'no-vapid' && (
        <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs text-yellow-300 font-semibold">Push no configurado en el servidor</p>
            <p className="text-[10px] text-yellow-300/70 mt-0.5">
              El administrador debe configurar las claves VAPID en el servidor.
            </p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {state !== 'unsupported' && state !== 'no-vapid' && state !== 'loading' && (
        <div className="flex gap-2">
          {state === 'subscribed' ? (
            <>
              <button
                onClick={unsubscribe}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[var(--text-muted)] text-xs font-semibold hover:bg-white/10 flex items-center justify-center gap-2"
              >
                <BellOff className="w-3.5 h-3.5" />
                {loading ? 'Desactivando...' : 'Desactivar'}
              </button>
              <button
                onClick={sendTest}
                disabled={testSent}
                className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                  testSent 
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                    : 'bg-violet-600 hover:bg-violet-700 text-white'
                }`}
              >
                {testSent ? (
                  <><Check className="w-3.5 h-3.5" /> Enviada</>
                ) : (
                  <><Send className="w-3.5 h-3.5" /> Probar</>
                )}
              </button>
            </>
          ) : state === 'denied' ? (
            <button
              disabled
              className="flex-1 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold cursor-not-allowed flex items-center justify-center gap-2"
            >
              <BellOff className="w-3.5 h-3.5" />
              Bloqueadas por el navegador
            </button>
          ) : (
            <button
              onClick={subscribe}
              disabled={loading}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-emerald-600 hover:from-violet-700 hover:to-emerald-700 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <BellRing className="w-4 h-4" />
              {loading ? 'Activando...' : 'Activar Notificaciones Push'}
            </button>
          )}
        </div>
      )}

      {state === 'subscribed' && (
        <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
          <p className="text-[10px] text-[var(--text-muted)]">
            📱 Recibirás push cuando: un cliente te escriba por WhatsApp, se cree un pedido, 
            cita o reserva. Funciona <strong className="text-white">incluso con el navegador cerrado</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

// =============================================
// 🔧 UTILITY — Convert VAPID key
// =============================================
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default PushNotificationManager;

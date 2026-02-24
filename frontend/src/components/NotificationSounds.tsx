'use client';

import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { Volume2, VolumeX, Bell, DollarSign, Coins, Music, Zap, Star, ChevronDown, Check, X } from 'lucide-react';

// =============================
// 🔊 SOUND GENERATOR (Web Audio API)
// =============================

type SoundType = 'coins' | 'cash_register' | 'bell' | 'success' | 'chime' | 'pop' | 'level_up' | 'none';

interface SoundOption {
  id: SoundType;
  name: string;
  emoji: string;
  description: string;
}

export const SOUND_OPTIONS: SoundOption[] = [
  { id: 'coins', name: 'Monedas', emoji: '🪙', description: 'Sonido de monedas cayendo' },
  { id: 'cash_register', name: 'Caja registradora', emoji: '💰', description: 'Ka-ching!' },
  { id: 'bell', name: 'Campana', emoji: '🔔', description: 'Campana clásica' },
  { id: 'success', name: 'Éxito', emoji: '✨', description: 'Chime de éxito' },
  { id: 'chime', name: 'Notificación', emoji: '🎵', description: 'Doble chime suave' },
  { id: 'pop', name: 'Pop', emoji: '💫', description: 'Pop rápido' },
  { id: 'level_up', name: 'Level Up', emoji: '🚀', description: 'Subir de nivel' },
  { id: 'none', name: 'Sin sonido', emoji: '🔇', description: 'Silencioso' },
];

let audioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext => {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
};

const playNote = (ctx: AudioContext, freq: number, startTime: number, duration: number, volume: number = 0.3, type: OscillatorType = 'sine') => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
};

const playNoise = (ctx: AudioContext, startTime: number, duration: number, volume: number = 0.1) => {
  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  source.buffer = buffer;
  filter.type = 'highpass';
  filter.frequency.value = 6000;
  gain.gain.setValueAtTime(volume, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(startTime);
  source.stop(startTime + duration);
};

export const playSound = (sound: SoundType) => {
  if (sound === 'none') return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    switch (sound) {
      case 'coins': {
        // 🪙 Monedas cayendo — múltiples chimes descendentes
        const notes = [1200, 1000, 1400, 900, 1100, 800, 1300, 700];
        notes.forEach((freq, i) => {
          playNote(ctx, freq, now + i * 0.06, 0.15, 0.2, 'sine');
          playNoise(ctx, now + i * 0.06, 0.04, 0.05); // Clink metálico
        });
        // Chime final
        playNote(ctx, 1500, now + 0.5, 0.4, 0.25, 'sine');
        playNote(ctx, 2000, now + 0.55, 0.35, 0.15, 'sine');
        break;
      }
      case 'cash_register': {
        // 💰 Ka-ching — golpe + campana
        playNoise(ctx, now, 0.08, 0.3); // Golpe mecánico
        playNote(ctx, 2000, now + 0.08, 0.6, 0.3, 'sine');
        playNote(ctx, 2500, now + 0.1, 0.5, 0.2, 'sine');
        playNote(ctx, 3000, now + 0.12, 0.4, 0.15, 'triangle');
        // Campana
        playNote(ctx, 1500, now + 0.15, 0.8, 0.25, 'sine');
        break;
      }
      case 'bell': {
        // 🔔 Campana clásica
        playNote(ctx, 830, now, 1.2, 0.3, 'sine');
        playNote(ctx, 1660, now, 0.8, 0.15, 'sine');
        playNote(ctx, 2490, now, 0.5, 0.08, 'sine');
        break;
      }
      case 'success': {
        // ✨ Chime ascendente de éxito
        playNote(ctx, 523, now, 0.2, 0.25, 'sine');
        playNote(ctx, 659, now + 0.12, 0.2, 0.25, 'sine');
        playNote(ctx, 784, now + 0.24, 0.2, 0.25, 'sine');
        playNote(ctx, 1047, now + 0.36, 0.5, 0.3, 'sine');
        playNote(ctx, 1047, now + 0.36, 0.5, 0.1, 'triangle');
        break;
      }
      case 'chime': {
        // 🎵 Doble chime suave
        playNote(ctx, 880, now, 0.3, 0.25, 'sine');
        playNote(ctx, 1320, now, 0.3, 0.12, 'sine');
        playNote(ctx, 1100, now + 0.2, 0.4, 0.25, 'sine');
        playNote(ctx, 1650, now + 0.2, 0.4, 0.12, 'sine');
        break;
      }
      case 'pop': {
        // 💫 Pop rápido
        playNote(ctx, 400, now, 0.05, 0.3, 'sine');
        playNote(ctx, 800, now + 0.03, 0.15, 0.25, 'sine');
        playNote(ctx, 1200, now + 0.06, 0.2, 0.15, 'sine');
        break;
      }
      case 'level_up': {
        // 🚀 Level up — escala rápida ascendente
        const scale = [523, 587, 659, 698, 784, 880, 988, 1047];
        scale.forEach((freq, i) => {
          playNote(ctx, freq, now + i * 0.06, 0.12, 0.2, 'square');
          playNote(ctx, freq, now + i * 0.06, 0.12, 0.1, 'sine');
        });
        // Acorde final
        playNote(ctx, 1047, now + 0.5, 0.6, 0.25, 'sine');
        playNote(ctx, 1318, now + 0.52, 0.55, 0.2, 'sine');
        playNote(ctx, 1568, now + 0.54, 0.5, 0.15, 'sine');
        break;
      }
    }
  } catch (e) {
    console.warn('Audio error:', e);
  }
};

// =============================
// 🔔 NOTIFICATION CONTEXT
// =============================

interface NotificationToast {
  id: string;
  type: 'appointment' | 'order' | 'reservation' | 'message';
  title: string;
  subtitle: string;
  emoji: string;
  timestamp: number;
}

interface NotificationContextType {
  selectedSound: SoundType;
  setSelectedSound: (s: SoundType) => void;
  enabled: boolean;
  setEnabled: (e: boolean) => void;
  triggerNotification: (toast: Omit<NotificationToast, 'id' | 'timestamp'>) => void;
  toasts: NotificationToast[];
}

const NotificationContext = createContext<NotificationContextType>({
  selectedSound: 'coins',
  setSelectedSound: () => {},
  enabled: true,
  setEnabled: () => {},
  triggerNotification: () => {},
  toasts: []
});

export const useNotifications = () => useContext(NotificationContext);

// =============================
// 🎯 PROVIDER COMPONENT
// =============================

export function NotificationProvider({ children, userId }: { children: React.ReactNode; userId?: string }) {
  const [selectedSound, setSelectedSoundState] = useState<SoundType>('coins');
  const [enabled, setEnabledState] = useState(true);
  const [toasts, setToasts] = useState<NotificationToast[]>([]);
  const [initialized, setInitialized] = useState(false);
  const apptSnapshotRef = useRef<Map<string, string>>(new Map()); // id → updatedAt
  const firstLoadRef = useRef(true);

  // Cargar preferencias
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bizonne_notif_sound');
      if (saved) setSelectedSoundState(saved as SoundType);
      const enabledSaved = localStorage.getItem('bizonne_notif_enabled');
      if (enabledSaved === 'false') setEnabledState(false);
    } catch {}
    setInitialized(true);
  }, []);

  const setSelectedSound = useCallback((s: SoundType) => {
    setSelectedSoundState(s);
    localStorage.setItem('bizonne_notif_sound', s);
  }, []);

  const setEnabled = useCallback((e: boolean) => {
    setEnabledState(e);
    localStorage.setItem('bizonne_notif_enabled', String(e));
  }, []);

  const triggerNotification = useCallback((toast: Omit<NotificationToast, 'id' | 'timestamp'>) => {
    if (!enabled) return;
    const id = Date.now().toString() + Math.random();
    const newToast: NotificationToast = { ...toast, id, timestamp: Date.now() };
    setToasts(prev => [newToast, ...prev].slice(0, 5));
    playSound(selectedSound);

    // Auto-remove después de 6s
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 6000);

    // Browser notification (si tiene permiso)
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`${toast.emoji} ${toast.title}`, { body: toast.subtitle, icon: '/bizonne.png' });
    }
  }, [enabled, selectedSound]);

  // 🔄 POLLING: Detectar nuevas citas/pedidos/reservas Y actualizaciones
  useEffect(() => {
    if (!userId || !initialized) return;

    const checkAppointments = async () => {
      try {
        const token = localStorage.getItem('token');
        const lineId = localStorage.getItem('selectedLineId') || '';
        if (!token) return;

        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/appointments?lineId=${lineId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        const appts: any[] = data.appointments || [];

        // Construir snapshot actual: id → updatedAt
        const currentSnapshot = new Map<string, string>();
        appts.forEach((a: any) => currentSnapshot.set(a.id, a.updatedAt || a.createdAt));

        if (firstLoadRef.current) {
          apptSnapshotRef.current = currentSnapshot;
          firstLoadRef.current = false;
          return;
        }

        const prevSnapshot = apptSnapshotRef.current;
        
        // Leer IDs ya notificados de localStorage para no repetir
        let notifiedIds: Set<string>;
        try {
          notifiedIds = new Set(JSON.parse(localStorage.getItem('bizonne_notified_appts') || '[]'));
        } catch { notifiedIds = new Set(); }

        const typeMap: Record<string, { emoji: string; newLabel: string; updateLabel: string; type: 'appointment' | 'order' | 'reservation' }> = {
          appointment: { emoji: '📅', newLabel: 'Nueva Cita', updateLabel: 'Cita Actualizada', type: 'appointment' },
          order: { emoji: '🛒', newLabel: 'Nuevo Pedido', updateLabel: 'Pedido Actualizado', type: 'order' },
          reservation: { emoji: '🏨', newLabel: 'Nueva Reserva', updateLabel: 'Reserva Actualizada', type: 'reservation' },
        };

        let didNotify = false;

        // Detectar NUEVOS (IDs que no existían antes)
        for (const appt of appts) {
          const notifKey = `new_${appt.id}`;
          if (!prevSnapshot.has(appt.id) && !notifiedIds.has(notifKey) && !didNotify) {
            const info = typeMap[appt.type] || typeMap.appointment;
            triggerNotification({
              type: info.type,
              title: info.newLabel,
              subtitle: `${appt.clientName || 'Cliente'} — ${appt.date ? new Date(appt.date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) : ''} ${appt.time || ''}`,
              emoji: info.emoji
            });
            notifiedIds.add(notifKey);
            didNotify = true;
            break;
          }
        }

        // Detectar ACTUALIZADOS (mismo ID pero diferente updatedAt)
        if (!didNotify) {
          for (const appt of appts) {
            const prevUpdated = prevSnapshot.get(appt.id);
            const currentUpdated = appt.updatedAt || appt.createdAt;
            const notifKey = `upd_${appt.id}_${currentUpdated}`;
            if (prevUpdated && prevUpdated !== currentUpdated && !notifiedIds.has(notifKey)) {
              const info = typeMap[appt.type] || typeMap.appointment;
              triggerNotification({
                type: info.type,
                title: `🔄 ${info.updateLabel}`,
                subtitle: `${appt.clientName || 'Cliente'} — ${appt.date ? new Date(appt.date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) : ''} ${appt.time || ''}`,
                emoji: '🔄'
              });
              notifiedIds.add(notifKey);
              didNotify = true;
              break;
            }
          }
        }

        // Guardar IDs notificados (máx 100 para no crecer indefinido)
        const notifiedArr = Array.from(notifiedIds).slice(-100);
        try { localStorage.setItem('bizonne_notified_appts', JSON.stringify(notifiedArr)); } catch {}

        // Actualizar snapshot
        apptSnapshotRef.current = currentSnapshot;
      } catch {}
    };

    checkAppointments();
    const interval = setInterval(checkAppointments, 15000);
    return () => clearInterval(interval);
  }, [userId, initialized, triggerNotification]);

  // Pedir permiso de notificaciones browser
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      // Se pide al primer click del usuario
      const handler = () => {
        Notification.requestPermission();
        document.removeEventListener('click', handler);
      };
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  }, []);

  return (
    <NotificationContext.Provider value={{ selectedSound, setSelectedSound, enabled, setEnabled, triggerNotification, toasts }}>
      {children}
      {/* 🔔 Toast Container */}
      <div className="fixed top-20 right-4 z-[200] flex flex-col gap-3 pointer-events-none" style={{ maxWidth: '380px' }}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto animate-fade-in"
            style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(6, 214, 160, 0.08) 100%)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '16px',
              padding: '16px 20px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 20px rgba(16, 185, 129, 0.2)',
              animation: 'slideInRight 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0 text-xl">
                {toast.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">{toast.title}</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{toast.subtitle}</p>
              </div>
              <button
                onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                className="flex-shrink-0 p-1 text-gray-500 hover:text-white rounded-lg hover:bg-white/10 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <style jsx global>{`
        @keyframes slideInRight {
          from { transform: translateX(100px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </NotificationContext.Provider>
  );
}

// =============================
// 🎛️ SOUND PICKER COMPONENT
// =============================

export function SoundPicker({ compact = false }: { compact?: boolean }) {
  const { selectedSound, setSelectedSound, enabled, setEnabled } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const current = SOUND_OPTIONS.find(s => s.id === selectedSound) || SOUND_OPTIONS[0];

  if (compact) {
    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-[var(--border-primary)] hover:bg-white/10 transition-all text-sm"
        >
          {enabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-gray-500" />}
          <span className="text-white">{current.emoji}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute top-full right-0 mt-2 w-72 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-2xl z-50 overflow-hidden animate-fade-in">
            {/* Header */}
            <div className="p-3 border-b border-[var(--border-primary)] flex items-center justify-between">
              <p className="text-xs font-semibold text-white flex items-center gap-2">
                <Bell className="w-3.5 h-3.5 text-emerald-400" />
                Sonido de Notificación
              </p>
              <button
                onClick={() => setEnabled(!enabled)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                  enabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-500 border border-white/10'
                }`}
              >
                {enabled ? 'ON' : 'OFF'}
              </button>
            </div>

            {/* Options */}
            <div className="p-2 max-h-64 overflow-y-auto">
              {SOUND_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setSelectedSound(opt.id);
                    if (opt.id !== 'none') playSound(opt.id);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                    selectedSound === opt.id
                      ? 'bg-emerald-500/15 text-white'
                      : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="text-lg">{opt.emoji}</span>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium">{opt.name}</p>
                    <p className="text-[10px] text-gray-500">{opt.description}</p>
                  </div>
                  {selectedSound === opt.id && <Check className="w-4 h-4 text-emerald-400" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Full version (for settings page)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Bell className="w-4 h-4 text-emerald-400" />
          Sonido de Notificaciones
        </h3>
        <button
          onClick={() => setEnabled(!enabled)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            enabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-500 border border-white/10'
          }`}
        >
          {enabled ? '🔊 Activado' : '🔇 Desactivado'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SOUND_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => {
              setSelectedSound(opt.id);
              if (opt.id !== 'none') playSound(opt.id);
            }}
            className={`flex items-center gap-3 px-3 py-3 rounded-xl border transition-all ${
              selectedSound === opt.id
                ? 'bg-emerald-500/15 border-emerald-500/30 text-white'
                : 'bg-white/3 border-[var(--border-primary)] text-gray-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            <span className="text-xl">{opt.emoji}</span>
            <div className="text-left flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{opt.name}</p>
              <p className="text-[10px] text-gray-500 truncate">{opt.description}</p>
            </div>
            {selectedSound === opt.id && <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// =============================
// 🔔 BELL BADGE (for navbar)
// =============================

export function NotificationBellBadge() {
  const { toasts } = useNotifications();
  if (toasts.length === 0) return null;
  return (
    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[var(--accent-primary)] text-white text-[10px] font-bold rounded-full animate-pulse">
      {toasts.length}
    </span>
  );
}

'use client';
import { useState, useEffect } from 'react';
import { Download, X, Smartphone, Monitor, Apple, Chrome, Share, Plus, MoreVertical, ArrowDown } from 'lucide-react';

type Platform = 'android' | 'ios' | 'windows' | 'mac' | 'unknown';

const detectPlatform = (): Platform => {
  if (typeof window === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (/android/.test(ua)) return 'android';
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/macintosh|mac os/.test(ua) && !(/iphone|ipad/.test(ua))) return 'mac';
  if (/windows/.test(ua)) return 'windows';
  return 'unknown';
};

const isStandalone = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;
};

interface InstallAppProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function InstallApp({ isOpen, onClose }: InstallAppProps) {
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [activeTab, setActiveTab] = useState<Platform>('android');

  useEffect(() => {
    const p = detectPlatform();
    setPlatform(p);
    setActiveTab(p === 'unknown' ? 'android' : p);
    setInstalled(isStandalone());

    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleNativeInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      setInstalled(true);
    }
    setDeferredPrompt(null);
  };

  if (!isOpen) return null;
  if (installed) return null;

  const tabs = [
    { id: 'android' as Platform, label: 'Android', icon: Smartphone },
    { id: 'ios' as Platform, label: 'iPhone/iPad', icon: Apple },
    { id: 'windows' as Platform, label: 'Windows', icon: Monitor },
    { id: 'mac' as Platform, label: 'Mac', icon: Monitor },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#12121a] rounded-2xl border border-white/10 w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Download className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Instalar BizonneCRM</h3>
              <p className="text-xs text-gray-400">Acceso directo desde tu dispositivo</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Benefits */}
        <div className="px-5 pt-4 pb-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/15">
              <p className="text-lg">🚀</p>
              <p className="text-[10px] text-emerald-400 font-medium">Acceso rápido</p>
            </div>
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/15">
              <p className="text-lg">📱</p>
              <p className="text-[10px] text-cyan-400 font-medium">Como una app</p>
            </div>
            <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/15">
              <p className="text-lg">🔔</p>
              <p className="text-[10px] text-purple-400 font-medium">Notificaciones</p>
            </div>
          </div>
        </div>

        {/* Platform Tabs */}
        <div className="px-5 pt-3">
          <div className="flex rounded-xl bg-white/5 p-1 gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Instructions per platform */}
        <div className="p-5">
          {/* Native install (Chrome/Edge on Android/Windows) */}
          {deferredPrompt && (activeTab === 'android' || activeTab === 'windows') && (
            <div className="mb-4">
              <button
                onClick={handleNativeInstall}
                className="w-full py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:brightness-110 transition-all flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />
                Instalar Ahora
              </button>
              <p className="text-[10px] text-gray-500 text-center mt-2">Instalación directa desde el navegador</p>
            </div>
          )}

          {/* Android steps */}
          {activeTab === 'android' && !deferredPrompt && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-white mb-3">📱 Desde Chrome en Android:</p>
              <Step n={1} icon={<MoreVertical className="w-4 h-4" />}>
                Toca el menú <strong className="text-white">⋮</strong> (tres puntos) arriba a la derecha
              </Step>
              <Step n={2} icon={<Download className="w-4 h-4" />}>
                Selecciona <strong className="text-white">&quot;Instalar app&quot;</strong> o <strong className="text-white">&quot;Agregar a pantalla de inicio&quot;</strong>
              </Step>
              <Step n={3} icon={<Plus className="w-4 h-4" />}>
                Confirma tocando <strong className="text-white">&quot;Instalar&quot;</strong>
              </Step>
            </div>
          )}

          {/* iOS steps */}
          {activeTab === 'ios' && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-white mb-3">🍎 Desde Safari en iPhone/iPad:</p>
              <Step n={1} icon={<Share className="w-4 h-4" />}>
                Toca el botón <strong className="text-white">Compartir</strong> <span className="text-cyan-400">(⬆️ cuadrado con flecha)</span> en la barra inferior
              </Step>
              <Step n={2} icon={<ArrowDown className="w-4 h-4" />}>
                Desliza hacia abajo y toca <strong className="text-white">&quot;Agregar a pantalla de inicio&quot;</strong>
              </Step>
              <Step n={3} icon={<Plus className="w-4 h-4" />}>
                Toca <strong className="text-white">&quot;Agregar&quot;</strong> arriba a la derecha
              </Step>
              <div className="mt-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <p className="text-[11px] text-amber-300">⚠️ Debe ser Safari. Chrome en iOS no soporta instalación de apps web.</p>
              </div>
            </div>
          )}

          {/* Windows steps */}
          {activeTab === 'windows' && !deferredPrompt && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-white mb-3">🖥️ Desde Chrome o Edge en Windows:</p>
              <Step n={1} icon={<Chrome className="w-4 h-4" />}>
                Abre <strong className="text-white">BizonneCRM</strong> en Chrome o Edge
              </Step>
              <Step n={2} icon={<Download className="w-4 h-4" />}>
                Haz click en el ícono <strong className="text-white">⊕</strong> en la barra de dirección, o ve a <strong className="text-white">⋮ → Instalar BizonneCRM</strong>
              </Step>
              <Step n={3} icon={<Monitor className="w-4 h-4" />}>
                Confirma haciendo click en <strong className="text-white">&quot;Instalar&quot;</strong>
              </Step>
              <div className="mt-3 p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                <p className="text-[11px] text-cyan-300">💡 Se creará un acceso directo en tu escritorio y menú de inicio.</p>
              </div>
            </div>
          )}

          {/* Mac steps */}
          {activeTab === 'mac' && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-white mb-3">🍎 Desde Chrome o Edge en Mac:</p>
              <Step n={1} icon={<Chrome className="w-4 h-4" />}>
                Abre <strong className="text-white">BizonneCRM</strong> en Chrome o Edge
              </Step>
              <Step n={2} icon={<Download className="w-4 h-4" />}>
                Haz click en el ícono de <strong className="text-white">instalación ⊕</strong> en la barra de dirección
              </Step>
              <Step n={3} icon={<Monitor className="w-4 h-4" />}>
                Confirma haciendo click en <strong className="text-white">&quot;Instalar&quot;</strong>. Se agregará al Dock y Launchpad.
              </Step>
              <div className="mt-3 p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                <p className="text-[11px] text-cyan-300">💡 En Safari: Archivo → Agregar al Dock (macOS Sonoma+)</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <div className="p-3 rounded-xl bg-white/5 text-center">
            <p className="text-[11px] text-gray-400">
              No ocupa espacio • Sin descargas de App Store • Siempre actualizado
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-xs font-bold text-emerald-400">{n}</span>
      </div>
      <div className="flex-1">
        <p className="text-sm text-gray-300 leading-relaxed">{children}</p>
      </div>
      <div className="text-gray-500 flex-shrink-0 mt-0.5">{icon}</div>
    </div>
  );
}

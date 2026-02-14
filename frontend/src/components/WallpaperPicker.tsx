'use client';

import { useState, useEffect } from 'react';
import { Paintbrush, X, Check, Image, Palette } from 'lucide-react';

// ===== FONDOS DISPONIBLES =====
const SOLID_COLORS = [
  { id: 'default', name: 'Predeterminado', value: '#0a0e17', preview: '#0a0e17' },
  { id: 'midnight', name: 'Medianoche', value: '#0d1117', preview: '#0d1117' },
  { id: 'charcoal', name: 'Carbón', value: '#1a1a2e', preview: '#1a1a2e' },
  { id: 'navy', name: 'Marino', value: '#0a192f', preview: '#0a192f' },
  { id: 'forest', name: 'Bosque', value: '#0d1912', preview: '#0d1912' },
  { id: 'wine', name: 'Vino', value: '#1a0a14', preview: '#1a0a14' },
  { id: 'slate', name: 'Pizarra', value: '#1e293b', preview: '#1e293b' },
  { id: 'obsidian', name: 'Obsidiana', value: '#111111', preview: '#111111' },
];

const GRADIENTS = [
  { id: 'g-ocean', name: 'Océano', value: 'linear-gradient(135deg, #0a0e17 0%, #0c2340 50%, #0a192f 100%)', preview: 'linear-gradient(135deg, #0a0e17, #0c2340, #0a192f)' },
  { id: 'g-aurora', name: 'Aurora', value: 'linear-gradient(135deg, #0d1117 0%, #0d2818 50%, #0a0e17 100%)', preview: 'linear-gradient(135deg, #0d1117, #0d2818, #0a0e17)' },
  { id: 'g-nebula', name: 'Nebulosa', value: 'linear-gradient(135deg, #0a0a1a 0%, #1a0a2a 50%, #0a0e17 100%)', preview: 'linear-gradient(135deg, #0a0a1a, #1a0a2a, #0a0e17)' },
  { id: 'g-ember', name: 'Brasa', value: 'linear-gradient(135deg, #0a0e17 0%, #1a0f0a 50%, #0d1117 100%)', preview: 'linear-gradient(135deg, #0a0e17, #1a0f0a, #0d1117)' },
  { id: 'g-cosmic', name: 'Cósmico', value: 'linear-gradient(180deg, #0a0e17 0%, #111827 40%, #1f1f3a 70%, #0a0e17 100%)', preview: 'linear-gradient(180deg, #0a0e17, #111827, #1f1f3a, #0a0e17)' },
  { id: 'g-deep', name: 'Profundo', value: 'linear-gradient(135deg, #000000 0%, #0a0a0a 50%, #111111 100%)', preview: 'linear-gradient(135deg, #000, #0a0a0a, #111)' },
];

const PATTERNS = [
  { id: 'p-dots', name: 'Puntos', css: 'radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)', size: '20px 20px', bg: '#0a0e17' },
  { id: 'p-grid', name: 'Cuadrícula', css: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', size: '40px 40px', bg: '#0a0e17' },
  { id: 'p-diagonal', name: 'Diagonal', css: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.02) 10px, rgba(255,255,255,0.02) 11px)', size: 'auto', bg: '#0d1117' },
  { id: 'p-hexagon', name: 'Hexagonal', css: 'radial-gradient(circle, rgba(255,255,255,0.04) 2px, transparent 2px)', size: '30px 52px', bg: '#0a192f' },
];

const IMAGE_WALLPAPERS = [
  { id: 'w-mountain', name: 'Montañas', url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=60' },
  { id: 'w-night', name: 'Noche estrellada', url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1920&q=60' },
  { id: 'w-ocean', name: 'Océano', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=60' },
  { id: 'w-forest', name: 'Bosque', url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1920&q=60' },
  { id: 'w-city', name: 'Ciudad', url: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1920&q=60' },
  { id: 'w-sunset', name: 'Atardecer', url: 'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=1920&q=60' },
];

export interface WallpaperConfig {
  type: 'solid' | 'gradient' | 'pattern' | 'image' | 'custom';
  id: string;
  value: string;
  overlay?: number; // 0-100 opacity of dark overlay for images
}

const DEFAULT_CONFIG: WallpaperConfig = { type: 'solid', id: 'default', value: '#0a0e17' };
const STORAGE_KEY = 'bizonne_wallpaper';

// ===== APLICAR FONDO =====
export function applyWallpaper(config: WallpaperConfig) {
  const main = document.getElementById('bizonne-main');
  if (!main) return;
  
  // Reset
  main.style.backgroundColor = '';
  main.style.backgroundImage = '';
  main.style.backgroundSize = '';
  main.style.backgroundPosition = '';
  main.style.backgroundRepeat = '';
  main.style.backgroundAttachment = '';
  
  switch (config.type) {
    case 'solid':
      main.style.backgroundColor = config.value;
      break;
    case 'gradient':
      main.style.backgroundImage = config.value;
      break;
    case 'pattern': {
      const pat = PATTERNS.find(p => p.id === config.id);
      if (pat) {
        main.style.backgroundColor = pat.bg;
        main.style.backgroundImage = pat.css;
        main.style.backgroundSize = pat.size;
      }
      break;
    }
    case 'image':
    case 'custom': {
      const overlay = config.overlay ?? 70;
      main.style.backgroundImage = `linear-gradient(rgba(10,14,23,${overlay / 100}), rgba(10,14,23,${overlay / 100})), url(${config.value})`;
      main.style.backgroundSize = 'cover';
      main.style.backgroundPosition = 'center';
      main.style.backgroundAttachment = 'fixed';
      break;
    }
  }
}

// ===== CARGAR FONDO GUARDADO =====
export function loadSavedWallpaper(): WallpaperConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_CONFIG;
}

// ===== COMPONENTE PICKER =====
interface WallpaperPickerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WallpaperPicker({ isOpen, onClose }: WallpaperPickerProps) {
  const [config, setConfig] = useState<WallpaperConfig>(loadSavedWallpaper());
  const [tab, setTab] = useState<'solid' | 'gradient' | 'pattern' | 'image'>('solid');
  const [customUrl, setCustomUrl] = useState('');
  const [overlay, setOverlay] = useState(config.overlay ?? 70);

  useEffect(() => {
    if (isOpen) {
      setConfig(loadSavedWallpaper());
    }
  }, [isOpen]);

  const select = (newConfig: WallpaperConfig) => {
    setConfig(newConfig);
    applyWallpaper(newConfig);
  };

  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    onClose();
  };

  const reset = () => {
    const def = DEFAULT_CONFIG;
    setConfig(def);
    applyWallpaper(def);
    localStorage.removeItem(STORAGE_KEY);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="w-full max-w-lg mx-4 rounded-2xl bg-[#0d1117] border border-white/10 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Paintbrush className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-white">Fondo de Pantalla</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-4 flex gap-1">
          {[
            { key: 'solid', icon: '🎨', label: 'Colores' },
            { key: 'gradient', icon: '🌈', label: 'Gradientes' },
            { key: 'pattern', icon: '🔲', label: 'Patrones' },
            { key: 'image', icon: '🖼️', label: 'Imágenes' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as any)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                tab === t.key 
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-5 py-4 max-h-[400px] overflow-y-auto">
          {/* Solid Colors */}
          {tab === 'solid' && (
            <div className="grid grid-cols-4 gap-3">
              {SOLID_COLORS.map(c => (
                <button
                  key={c.id}
                  onClick={() => select({ type: 'solid', id: c.id, value: c.value })}
                  className={`group relative aspect-[4/3] rounded-xl border-2 transition-all overflow-hidden ${
                    config.id === c.id ? 'border-cyan-400 scale-105 shadow-lg shadow-cyan-500/20' : 'border-white/10 hover:border-white/30'
                  }`}
                  style={{ backgroundColor: c.preview }}
                >
                  {config.id === c.id && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Check className="w-5 h-5 text-cyan-400" />
                    </div>
                  )}
                  <span className="absolute bottom-1 left-0 right-0 text-center text-[9px] text-gray-400 group-hover:text-white">
                    {c.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Gradients */}
          {tab === 'gradient' && (
            <div className="grid grid-cols-3 gap-3">
              {GRADIENTS.map(g => (
                <button
                  key={g.id}
                  onClick={() => select({ type: 'gradient', id: g.id, value: g.value })}
                  className={`group relative aspect-[3/2] rounded-xl border-2 transition-all overflow-hidden ${
                    config.id === g.id ? 'border-cyan-400 scale-105 shadow-lg shadow-cyan-500/20' : 'border-white/10 hover:border-white/30'
                  }`}
                  style={{ backgroundImage: g.preview }}
                >
                  {config.id === g.id && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Check className="w-5 h-5 text-cyan-400" />
                    </div>
                  )}
                  <span className="absolute bottom-1 left-0 right-0 text-center text-[9px] text-gray-400 group-hover:text-white">
                    {g.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Patterns */}
          {tab === 'pattern' && (
            <div className="grid grid-cols-2 gap-3">
              {PATTERNS.map(p => (
                <button
                  key={p.id}
                  onClick={() => select({ type: 'pattern', id: p.id, value: p.css })}
                  className={`group relative aspect-[2/1] rounded-xl border-2 transition-all overflow-hidden ${
                    config.id === p.id ? 'border-cyan-400 scale-105 shadow-lg shadow-cyan-500/20' : 'border-white/10 hover:border-white/30'
                  }`}
                  style={{ backgroundColor: p.bg, backgroundImage: p.css, backgroundSize: p.size }}
                >
                  {config.id === p.id && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Check className="w-5 h-5 text-cyan-400" />
                    </div>
                  )}
                  <span className="absolute bottom-1.5 left-0 right-0 text-center text-[10px] text-gray-400 group-hover:text-white">
                    {p.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Images */}
          {tab === 'image' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {IMAGE_WALLPAPERS.map(w => (
                  <button
                    key={w.id}
                    onClick={() => select({ type: 'image', id: w.id, value: w.url, overlay })}
                    className={`group relative aspect-[3/2] rounded-xl border-2 transition-all overflow-hidden ${
                      config.id === w.id ? 'border-cyan-400 scale-105 shadow-lg shadow-cyan-500/20' : 'border-white/10 hover:border-white/30'
                    }`}
                  >
                    <div 
                      className="absolute inset-0 bg-cover bg-center" 
                      style={{ backgroundImage: `linear-gradient(rgba(10,14,23,${overlay / 100}), rgba(10,14,23,${overlay / 100})), url(${w.url})` }}
                    />
                    {config.id === w.id && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Check className="w-5 h-5 text-cyan-400" />
                      </div>
                    )}
                    <span className="absolute bottom-1 left-0 right-0 text-center text-[9px] text-white/70 group-hover:text-white z-10">
                      {w.name}
                    </span>
                  </button>
                ))}
              </div>

              {/* Overlay slider */}
              {config.type === 'image' && (
                <div className="px-1">
                  <label className="text-[10px] text-gray-400 block mb-1">Oscuridad del fondo: {overlay}%</label>
                  <input 
                    type="range" 
                    min="30" 
                    max="90" 
                    value={overlay}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setOverlay(val);
                      select({ ...config, overlay: val });
                    }}
                    className="w-full accent-cyan-500"
                  />
                </div>
              )}

              {/* Custom URL */}
              <div className="border-t border-white/5 pt-3">
                <label className="text-[10px] text-gray-400 block mb-1.5">URL personalizada:</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={customUrl}
                    onChange={e => setCustomUrl(e.target.value)}
                    placeholder="https://example.com/mi-fondo.jpg"
                    className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
                  />
                  <button 
                    onClick={() => {
                      if (customUrl.trim()) {
                        select({ type: 'custom', id: 'custom', value: customUrl.trim(), overlay });
                      }
                    }}
                    disabled={!customUrl.trim()}
                    className="px-3 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 text-xs font-medium hover:bg-cyan-500/30 disabled:opacity-30"
                  >
                    Aplicar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between">
          <button onClick={reset} className="text-xs text-gray-400 hover:text-white transition-colors">
            Restaurar predeterminado
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5">
              Cancelar
            </button>
            <button onClick={save} className="px-4 py-2 rounded-lg bg-cyan-500 text-white text-xs font-bold hover:bg-cyan-600 transition-colors">
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

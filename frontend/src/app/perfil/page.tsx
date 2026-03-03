'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  User, Camera, Lock, Globe, Phone, Mail, Save, 
  ChevronLeft, Check, X, Loader, Eye, EyeOff, Trash2, Clock
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const TIMEZONES = [
  { value: 'America/Bogota', label: 'Colombia (GMT-5)', flag: '🇨🇴' },
  { value: 'America/Mexico_City', label: 'México Central (GMT-6)', flag: '🇲🇽' },
  { value: 'America/Lima', label: 'Perú (GMT-5)', flag: '🇵🇪' },
  { value: 'America/Santiago', label: 'Chile (GMT-4)', flag: '🇨🇱' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Argentina (GMT-3)', flag: '🇦🇷' },
  { value: 'America/Sao_Paulo', label: 'Brasil (GMT-3)', flag: '🇧🇷' },
  { value: 'America/Caracas', label: 'Venezuela (GMT-4)', flag: '🇻🇪' },
  { value: 'America/Guayaquil', label: 'Ecuador (GMT-5)', flag: '🇪🇨' },
  { value: 'America/Panama', label: 'Panamá (GMT-5)', flag: '🇵🇦' },
  { value: 'America/Costa_Rica', label: 'Costa Rica (GMT-6)', flag: '🇨🇷' },
  { value: 'America/New_York', label: 'Este EEUU (GMT-5)', flag: '🇺🇸' },
  { value: 'America/Los_Angeles', label: 'Pacífico EEUU (GMT-8)', flag: '🇺🇸' },
  { value: 'Europe/Madrid', label: 'España (GMT+1)', flag: '🇪🇸' },
  { value: 'UTC', label: 'UTC (GMT+0)', flag: '🌐' },
];

const apiFetch = async (path: string, opts: any = {}) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error de servidor' }));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json();
};

export default function PerfilPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Form states
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('America/Bogota');

  // Password states
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  useEffect(() => { loadProfile(); }, []);

  const showMsg = (text: string, type: 'success' | 'error') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  };

  const loadProfile = async () => {
    try {
      const data = await apiFetch('/api/auth/me');
      const u = data.user;
      setUser(u);
      setName(u.name || '');
      setPhone(u.phone || '');
      setTimezone(u.timezone || 'America/Bogota');
    } catch (e: any) {
      showMsg(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      const data = await apiFetch('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ name, phone, timezone }),
      });
      setUser((prev: any) => ({ ...prev, ...data.user }));
      showMsg('Perfil actualizado', 'success');
    } catch (e: any) {
      showMsg(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showMsg('Imagen muy grande. Máximo 2MB.', 'error'); return; }
    if (!file.type.startsWith('image/')) { showMsg('Solo imágenes (JPG, PNG)', 'error'); return; }

    setSavingPhoto(true);
    try {
      // Resize image to max 200x200 for profile pic
      const resized = await resizeImage(file, 200);
      const data = await apiFetch('/api/auth/profile/photo', {
        method: 'PUT',
        body: JSON.stringify({ photo: resized }),
      });
      setUser((prev: any) => ({ ...prev, profilePic: data.profilePic }));
      showMsg('Foto actualizada', 'success');
    } catch (e: any) {
      showMsg(e.message, 'error');
    } finally {
      setSavingPhoto(false);
    }
  };

  const removePhoto = async () => {
    setSavingPhoto(true);
    try {
      await apiFetch('/api/auth/profile/photo', {
        method: 'PUT',
        body: JSON.stringify({ photo: null }),
      });
      setUser((prev: any) => ({ ...prev, profilePic: null }));
      showMsg('Foto eliminada', 'success');
    } catch (e: any) {
      showMsg(e.message, 'error');
    } finally {
      setSavingPhoto(false);
    }
  };

  const changePassword = async () => {
    if (newPw !== confirmPw) { showMsg('Las contraseñas no coinciden', 'error'); return; }
    if (newPw.length < 6) { showMsg('Mínimo 6 caracteres', 'error'); return; }
    setSavingPassword(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      showMsg('Contraseña actualizada', 'success');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (e: any) {
      showMsg(e.message, 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  const resizeImage = (file: File, maxSize: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > h) { if (w > maxSize) { h = h * maxSize / w; w = maxSize; } }
          else { if (h > maxSize) { w = w * maxSize / h; h = maxSize; } }
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Loader className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    );
  }

  const initial = (name || user?.email || 'U')[0].toUpperCase();
  const roleLabel = user?.role === 'admin' ? 'Administrador' : user?.role === 'manager' ? 'Gerente' : user?.role === 'agent' ? 'Vendedor' : user?.role === 'support' ? 'Soporte' : 'Observador';
  const currentTz = TIMEZONES.find(t => t.value === timezone);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0a0a0f]/90 backdrop-blur-md border-b border-white/5">
        <div className="max-w-2xl mx-auto px-3 sm:px-4 py-3 sm:py-4 flex items-center gap-3">
          <button onClick={() => window.history.back()} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
            <ChevronLeft className="w-5 h-5 text-gray-400" />
          </button>
          <h1 className="text-lg font-bold">Mi Perfil</h1>
        </div>
      </div>

      {/* Toast */}
      {msg && (
        <div className={`fixed top-4 left-4 right-4 sm:left-auto sm:right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-2xl flex items-center gap-2 animate-in slide-in-from-right ${
          msg.type === 'success' ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400' : 'bg-red-500/20 border border-red-500/30 text-red-400'
        }`}>
          {msg.type === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          {msg.text}
        </div>
      )}

      <div className="max-w-2xl mx-auto px-3 sm:px-4 md:px-6 py-6 md:py-8 space-y-6 md:space-y-8">

        {/* ========= FOTO DE PERFIL ========= */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative group">
            {user?.profilePic ? (
              <img src={user.profilePic} alt="Perfil" className="w-20 h-20 sm:w-28 sm:h-28 rounded-full object-cover ring-4 ring-emerald-500/20" />
            ) : (
              <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-full bg-gradient-to-br from-emerald-500/30 to-cyan-600/20 flex items-center justify-center ring-4 ring-emerald-500/20">
                <span className="text-2xl sm:text-4xl font-bold text-emerald-400">{initial}</span>
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={savingPhoto}
              className="absolute bottom-0 right-0 p-2.5 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg transition-all hover:scale-110 disabled:opacity-50"
            >
              {savingPhoto ? <Loader className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
          </div>
          <div className="text-center">
            <h2 className="text-lg sm:text-xl font-bold">{name || 'Sin nombre'}</h2>
            <p className="text-sm text-gray-500">{user?.email}</p>
            <span className="inline-block mt-1 text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">{roleLabel}</span>
          </div>
          {user?.profilePic && (
            <button onClick={removePhoto} disabled={savingPhoto} className="text-xs text-red-400/60 hover:text-red-400 flex items-center gap-1 transition-colors">
              <Trash2 className="w-3 h-3" /> Eliminar foto
            </button>
          )}
        </div>

        {/* ========= DATOS PERSONALES ========= */}
        <div className="bg-white/[0.03] rounded-2xl border border-white/5 overflow-hidden">
          <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-white/5">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <User className="w-4 h-4 text-emerald-400" /> Datos Personales
            </h3>
          </div>
          <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
            {/* Nombre */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Nombre completo</label>
              <input
                value={name} onChange={e => setName(e.target.value)}
                placeholder="Tu nombre"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:border-emerald-500/50 focus:outline-none transition-colors"
              />
            </div>

            {/* Email (readonly) */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Email</label>
              <div className="flex items-center gap-2 bg-white/[0.02] border border-white/5 rounded-xl px-4 py-2.5">
                <Mail className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-gray-400">{user?.email}</span>
                <span className="ml-auto text-[10px] text-gray-600">No editable</span>
              </div>
            </div>

            {/* Teléfono */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Teléfono</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                <input
                  value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="+57 300 000 0000"
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:border-emerald-500/50 focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Timezone */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Zona horaria</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600 z-10" />
                <select
                  value={timezone} onChange={e => setTimezone(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white appearance-none focus:border-emerald-500/50 focus:outline-none transition-colors cursor-pointer"
                  style={{ WebkitAppearance: 'none' }}
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz.value} value={tz.value} className="bg-[#1a1a2e] text-white">
                      {tz.flag} {tz.label}
                    </option>
                  ))}
                </select>
                <Clock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
              </div>
              {currentTz && (
                <p className="text-[11px] text-gray-600 mt-1.5 flex items-center gap-1">
                  {currentTz.flag} {new Date().toLocaleTimeString('es-CO', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: true })} — {currentTz.label}
                </p>
              )}
            </div>

            {/* Save button */}
            <button
              onClick={saveProfile} disabled={saving}
              className="w-full py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white text-sm font-semibold hover:from-emerald-600 hover:to-cyan-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </div>

        {/* ========= CAMBIAR CONTRASEÑA ========= */}
        <div className="bg-white/[0.03] rounded-2xl border border-white/5 overflow-hidden">
          <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-white/5">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400" /> Cambiar Contraseña
            </h3>
          </div>
          <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
            {/* Current password */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Contraseña actual</label>
              <div className="relative">
                <input
                  type={showCurrentPw ? 'text' : 'password'}
                  value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder-gray-600 focus:border-amber-500/50 focus:outline-none transition-colors"
                />
                <button onClick={() => setShowCurrentPw(!showCurrentPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
                  {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* New password */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Nueva contraseña</label>
              <div className="relative">
                <input
                  type={showNewPw ? 'text' : 'password'}
                  value={newPw} onChange={e => setNewPw(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder-gray-600 focus:border-amber-500/50 focus:outline-none transition-colors"
                />
                <button onClick={() => setShowNewPw(!showNewPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
                  {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {newPw && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className={`h-1 flex-1 rounded-full ${newPw.length >= 8 ? 'bg-emerald-500' : newPw.length >= 6 ? 'bg-amber-500' : 'bg-red-500'}`} />
                  <span className={`text-[10px] ${newPw.length >= 8 ? 'text-emerald-400' : newPw.length >= 6 ? 'text-amber-400' : 'text-red-400'}`}>
                    {newPw.length >= 8 ? 'Fuerte' : newPw.length >= 6 ? 'Aceptable' : 'Débil'}
                  </span>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Confirmar nueva contraseña</label>
              <input
                type="password"
                value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                placeholder="Repite la nueva contraseña"
                className={`w-full bg-white/5 border rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors ${
                  confirmPw && confirmPw !== newPw ? 'border-red-500/50' : 'border-white/10 focus:border-amber-500/50'
                }`}
              />
              {confirmPw && confirmPw !== newPw && (
                <p className="text-[11px] text-red-400 mt-1">Las contraseñas no coinciden</p>
              )}
            </div>

            {/* Change password button */}
            <button
              onClick={changePassword}
              disabled={savingPassword || !currentPw || !newPw || newPw !== confirmPw || newPw.length < 6}
              className="w-full py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold hover:from-amber-600 hover:to-orange-600 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {savingPassword ? <Loader className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              {savingPassword ? 'Cambiando...' : 'Cambiar contraseña'}
            </button>
          </div>
        </div>

        {/* ========= INFO DE CUENTA ========= */}
        <div className="bg-white/[0.03] rounded-2xl border border-white/5 overflow-hidden">
          <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-white/5">
            <h3 className="text-sm font-semibold text-gray-400">Información de cuenta</h3>
          </div>
          <div className="p-3 sm:p-5 space-y-2 sm:space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Plan</span>
              <span className="text-emerald-400 font-medium capitalize">{user?.plan || 'trial'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Rol</span>
              <span className="text-white">{roleLabel}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Registrado</span>
              <span className="text-gray-400">{user?.createdAt ? new Date(user.createdAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</span>
            </div>
            {user?.subscriptionStatus && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Estado</span>
                <span className={user.subscriptionStatus === 'active' ? 'text-emerald-400' : 'text-red-400'}>
                  {user.subscriptionStatus === 'active' ? '✅ Activo' : user.subscriptionStatus === 'expired' ? '❌ Expirado' : user.subscriptionStatus}
                </span>
              </div>
            )}
            {user?.daysRemaining > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Días restantes</span>
                <span className="text-white">{user.daysRemaining}d</span>
              </div>
            )}
          </div>
        </div>

        <div className="h-8" />
      </div>
    </div>
  );
}

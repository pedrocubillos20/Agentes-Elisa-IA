'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, KeyRound, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://elisa-iaagentes-production.up.railway.app';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code' | 'password' | 'success'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { setError('Ingresa tu correo electrónico'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (res.ok) {
        setStep('code');
        setCountdown(60);
        const timer = setInterval(() => {
          setCountdown(prev => { if (prev <= 1) { clearInterval(timer); return 0; } return prev - 1; });
        }, 1000);
      } else {
        setError(data.error || 'Error al enviar código');
      }
    } catch { setError('Error de conexión'); }
    finally { setLoading(false); }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || code.length !== 6) { setError('Ingresa el código de 6 dígitos'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/verify-reset-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code })
      });
      const data = await res.json();
      if (res.ok && data.resetToken) {
        setResetToken(data.resetToken);
        setStep('password');
      } else {
        setError(data.error || 'Código incorrecto');
      }
    } catch { setError('Error de conexión'); }
    finally { setLoading(false); }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) { setError('La contraseña debe tener al menos 6 caracteres'); return; }
    if (newPassword !== confirmPassword) { setError('Las contraseñas no coinciden'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken, newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        setStep('success');
        setTimeout(() => router.push('/login'), 3000);
      } else {
        setError(data.error || 'Error al cambiar contraseña');
      }
    } catch { setError('Error de conexión'); }
    finally { setLoading(false); }
  };

  const handleResendCode = async () => {
    if (countdown > 0) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (res.ok) {
        setCountdown(60);
        const timer = setInterval(() => {
          setCountdown(prev => { if (prev <= 1) { clearInterval(timer); return 0; } return prev - 1; });
        }, 1000);
      }
    } catch {}
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <span className="text-3xl">🤖</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Elisa IA</h1>
        </div>

        <div className="bg-[#111111] border border-gray-800 rounded-2xl p-8">
          
          {step === 'email' && (
            <>
              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">¿Olvidaste tu contraseña?</h2>
                <p className="text-gray-400 text-sm">Ingresa tu correo y te enviaremos un código de verificación</p>
              </div>
              <form onSubmit={handleSendCode} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">EMAIL</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com"
                      className="w-full bg-[#1a1a1a] border border-gray-700 rounded-xl py-3 pl-11 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors" />
                  </div>
                </div>
                {error && <p className="text-red-400 text-sm text-center">{error}</p>}
                <button type="submit" disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                  Enviar Código →
                </button>
              </form>
            </>
          )}

          {step === 'code' && (
            <>
              <div className="text-center mb-6">
                <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <KeyRound className="w-7 h-7 text-emerald-500" />
                </div>
                <h2 className="text-xl font-semibold text-white mb-2">Ingresa el código</h2>
                <p className="text-gray-400 text-sm">Enviamos un código de 6 dígitos a <span className="text-emerald-400">{email}</span></p>
              </div>
              <form onSubmit={handleVerifyCode} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">CÓDIGO DE VERIFICACIÓN</label>
                  <input type="text" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" maxLength={6}
                    className="w-full bg-[#1a1a1a] border border-gray-700 rounded-xl py-4 px-4 text-white text-center text-2xl tracking-[0.5em] font-mono placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors" />
                </div>
                {error && <p className="text-red-400 text-sm text-center">{error}</p>}
                <button type="submit" disabled={loading || code.length !== 6}
                  className="w-full py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                  Verificar Código
                </button>
                <div className="text-center">
                  {countdown > 0 ? (
                    <p className="text-gray-500 text-sm">Reenviar código en {countdown}s</p>
                  ) : (
                    <button type="button" onClick={handleResendCode} className="text-emerald-400 text-sm hover:underline">
                      ¿No recibiste el código? Reenviar
                    </button>
                  )}
                </div>
              </form>
              <button onClick={() => setStep('email')} className="mt-4 w-full py-2 text-gray-400 text-sm hover:text-white transition-colors flex items-center justify-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Volver
              </button>
            </>
          )}

          {step === 'password' && (
            <>
              <div className="text-center mb-6">
                <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <Lock className="w-7 h-7 text-emerald-500" />
                </div>
                <h2 className="text-xl font-semibold text-white mb-2">Crea tu nueva contraseña</h2>
                <p className="text-gray-400 text-sm">Ingresa una contraseña segura de al menos 6 caracteres</p>
              </div>
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">NUEVA CONTRASEÑA</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                    <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••"
                      className="w-full bg-[#1a1a1a] border border-gray-700 rounded-xl py-3 pl-11 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">CONFIRMAR CONTRASEÑA</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                    <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••"
                      className="w-full bg-[#1a1a1a] border border-gray-700 rounded-xl py-3 pl-11 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors" />
                  </div>
                </div>
                {error && <p className="text-red-400 text-sm text-center">{error}</p>}
                <button type="submit" disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                  Cambiar Contraseña
                </button>
              </form>
            </>
          )}

          {step === 'success' && (
            <div className="text-center py-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-emerald-500" />
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">¡Contraseña actualizada!</h2>
              <p className="text-gray-400 text-sm mb-6">Ya puedes iniciar sesión con tu nueva contraseña</p>
              <p className="text-gray-500 text-sm">Redirigiendo al login...</p>
            </div>
          )}
        </div>

        {step !== 'success' && (
          <div className="text-center mt-6">
            <button onClick={() => router.push('/login')} className="text-gray-400 hover:text-white transition-colors text-sm flex items-center justify-center gap-2 mx-auto">
              <ArrowLeft className="w-4 h-4" /> Volver al inicio de sesión
            </button>
          </div>
        )}

        <div className="text-center mt-8">
          <p className="text-gray-600 text-xs flex items-center justify-center gap-2">
            <span>🤖</span> Powered by <span className="text-emerald-500">Elisa IA</span> • v5.0
          </p>
        </div>
      </div>
    </div>
  );
}
```

4. **Guarda el archivo**

La estructura debe quedar:
```
frontend/src/app/forgot-password/page.tsx
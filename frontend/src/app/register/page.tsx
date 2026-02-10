'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, Lock, User, Eye, EyeOff, ArrowRight, CheckCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem('token', data.token);
        router.push('/dashboard');
      } else {
        setError(data.error || 'Error al registrar');
      }
    } catch (err) {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const features = [
    'Chatbot WhatsApp con IA',
    'CRM para gestionar clientes',
    'Sistema de agendamiento',
    '7 días de prueba gratis'
  ];

  return (
    <div className="min-h-screen flex">
      {/* Left Side */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-400" />
        <div className="absolute inset-0 opacity-10">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="dots" x="0" y="0" width="30" height="30" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="2" fill="white"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dots)"/>
          </svg>
        </div>

        <div className="absolute top-20 left-20 w-72 h-72 bg-white/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-white/10 rounded-full blur-3xl animate-float" style={{animationDelay: '2s'}} />

        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <div className="flex items-center gap-4 mb-8">
            <img src="/bizonne.png" alt="Bizonne" className="w-24 h-24 rounded-3xl shadow-2xl animate-float" />
            <div>
              <h1 className="text-5xl font-bold">Bizonne</h1>
              <p className="text-white/80 text-lg mt-1">Únete hoy</p>
            </div>
          </div>
          
          <p className="text-xl text-white/90 mb-10 max-w-md leading-relaxed">
            Crea tu cuenta gratis y comienza a automatizar tu negocio con inteligencia artificial.
          </p>

          <div className="space-y-4">
            {features.map((feature, index) => (
              <div key={index} className="flex items-center gap-3 animate-fade-in" style={{animationDelay: `${index * 100}ms`}}>
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                  <CheckCircle className="w-4 h-4" />
                </div>
                <span className="text-lg">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Side */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex flex-col items-center mb-10">
            <img src="/bizonne.png" alt="Bizonne" className="w-20 h-20 rounded-2xl shadow-lg mb-4" />
            <h1 className="text-3xl font-bold text-white">
              Bizonne <span className="text-[var(--accent-primary)] font-light">IA</span>
            </h1>
          </div>

          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-white mb-2">Crear Cuenta</h2>
            <p className="text-[var(--text-muted)]">Completa tus datos para comenzar</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-5">
            {error && (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="input-label">Nombre Completo</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-muted)]" />
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Tu nombre" className="input pl-12" required />
              </div>
            </div>

            <div>
              <label className="input-label">Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-muted)]" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com" className="input pl-12" required />
              </div>
            </div>

            <div>
              <label className="input-label">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-muted)]" />
                <input type={showPassword ? 'text' : 'password'} value={password}
                  onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                  className="input pl-12 pr-12" required minLength={6} />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white">
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="input-label">Confirmar Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-muted)]" />
                <input type={showPassword ? 'text' : 'password'} value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••"
                  className="input pl-12" required />
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-4">
              {loading ? <div className="loading-spinner w-5 h-5" /> : <>Crear Cuenta<ArrowRight className="w-5 h-5" /></>}
            </button>
          </form>

          <p className="text-center mt-8 text-[var(--text-muted)]">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="text-[var(--accent-primary)] hover:text-[var(--accent-secondary)] font-medium">
              Inicia sesión
            </Link>
          </p>

          <div className="mt-12 pt-8 border-t border-[var(--border-primary)]">
            <div className="flex items-center justify-center gap-2">
              <img src="/bizonne.png" alt="Bizonne" className="w-6 h-6 rounded-lg" />
              <span className="text-xs text-[var(--text-muted)]">
                Powered by <span className="text-white">Bizonne</span> • v5.0
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

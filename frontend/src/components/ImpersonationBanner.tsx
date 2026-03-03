'use client';
import { useState, useEffect } from 'react';
import { Shield, ArrowLeft, Clock } from 'lucide-react';

export default function ImpersonationBanner() {
  const [impersonation, setImpersonation] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const check = () => {
      const data = localStorage.getItem('bizonne_impersonating');
      if (data) {
        try { setImpersonation(JSON.parse(data)); } catch { setImpersonation(null); }
      } else {
        setImpersonation(null);
      }
    };
    check();
    window.addEventListener('storage', check);
    return () => window.removeEventListener('storage', check);
  }, []);

  useEffect(() => {
    if (!impersonation) return;
    const interval = setInterval(() => {
      const started = new Date(impersonation.startedAt).getTime();
      const expires = started + 2 * 60 * 60 * 1000;
      const remaining = expires - Date.now();
      if (remaining <= 0) {
        handleReturn();
        return;
      }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setTimeLeft(`${mins}m ${secs}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, [impersonation]);

  const handleReturn = () => {
    const adminToken = localStorage.getItem('bizonne_admin_token');
    if (adminToken) {
      localStorage.setItem('token', adminToken);
      localStorage.removeItem('bizonne_admin_token');
      localStorage.removeItem('bizonne_impersonating');
      localStorage.removeItem('bizonne_user_cache');
      window.location.href = '/admin';
    }
  };

  if (!impersonation) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999]" style={{ background: 'linear-gradient(90deg, #ea580c, #f59e0b)' }}>
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between text-white">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.2)' }}>
            <Shield className="w-4 h-4" />
          </div>
          <div className="text-sm">
            <span className="font-bold">MODO IMPLEMENTACIÓN</span>
            <span className="ml-2 opacity-80">
              Trabajando como: <strong>{impersonation.userName}</strong>
            </span>
            <span className="ml-1 opacity-60 text-xs hidden md:inline">({impersonation.userEmail})</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.15)' }}>
            <Clock className="w-3.5 h-3.5" />
            <span style={{ fontFamily: 'monospace' }}>{timeLeft}</span>
          </div>
          <button
            onClick={handleReturn}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold transition hover:opacity-90"
            style={{ background: '#fff', color: '#ea580c' }}
          >
            <ArrowLeft className="w-4 h-4" />
            Volver a Admin
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { Settings, Key, User, Shield, Save, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react';
import { PushNotificationManager } from '../../components/PushNotificationManager';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function ConfiguracionPage() {
  const [user, setUser] = useState<any>(null);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    fetchUser();
  }, []);

  const fetchUser = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setUser((await res.json()).user);
    } catch (error) { console.error('Error:', error); }
    finally { setLoading(false); }
  };

  const testApiKey = async () => {
    if (!apiKey) return;
    setTesting(true);
    setMessage({ type: '', text: '' });
    const token = localStorage.getItem('token');

    try {
      const res = await fetch(`${API_URL}/api/auth/test-api-key`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'API Key válida ✓' });
      } else {
        setMessage({ type: 'error', text: 'API Key inválida o sin créditos' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error al probar la API Key' });
    } finally { setTesting(false); }
  };

  const saveApiKey = async () => {
    if (!apiKey) return;
    setSaving(true);
    setMessage({ type: '', text: '' });
    const token = localStorage.getItem('token');

    try {
      const res = await fetch(`${API_URL}/api/auth/api-key`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'API Key guardada correctamente' });
        setApiKey('');
        fetchUser();
      } else {
        setMessage({ type: 'error', text: 'Error al guardar la API Key' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error de conexión' });
    } finally { setSaving(false); }
  };

  const deleteApiKey = async () => {
    if (!confirm('¿Eliminar la API Key?')) return;
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/auth/api-key`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setMessage({ type: 'success', text: 'API Key eliminada' });
      fetchUser();
    } catch (error) {
      setMessage({ type: 'error', text: 'Error al eliminar' });
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <img src="/bizonne.png" alt="Bizonne" className="w-16 h-16 rounded-xl animate-pulse" />
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <img src="/bizonne.png" alt="Bizonne" className="w-14 h-14 rounded-xl" />
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Configuración</h1>
          <p className="text-[var(--text-muted)]">Personaliza tu cuenta</p>
        </div>
      </div>

      {/* Profile Card */}
      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <User className="w-5 h-5 text-[var(--accent-primary)]" />
          <h2 className="text-lg font-semibold text-white">Perfil</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="input-label">Nombre</label>
            <input type="text" value={user?.name || ''} className="input" disabled />
          </div>
          <div>
            <label className="input-label">Email</label>
            <input type="email" value={user?.email || ''} className="input" disabled />
          </div>
        </div>
      </div>

      {/* API Key Card */}
      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <Key className="w-5 h-5 text-[var(--accent-primary)]" />
          <h2 className="text-lg font-semibold text-white">API Key de OpenAI</h2>
        </div>

        {/* Status */}
        <div className="flex items-center gap-3 mb-6 p-4 rounded-xl bg-[var(--bg-tertiary)]">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${user?.apiKeyConnected ? 'bg-emerald-500/20' : 'bg-yellow-500/20'}`}>
            {user?.apiKeyConnected ? <CheckCircle className="w-5 h-5 text-emerald-400" /> : <Key className="w-5 h-5 text-yellow-400" />}
          </div>
          <div className="flex-1">
            <p className="font-medium text-white">
              {user?.apiKeyConnected ? 'API Key configurada' : 'Sin API Key'}
            </p>
            <p className="text-sm text-[var(--text-muted)]">
              {user?.apiKeyConnected ? 'Tu asistente IA está listo' : 'Agrega tu API Key para activar el asistente'}
            </p>
          </div>
          {user?.apiKeyConnected && (
            <button onClick={deleteApiKey} className="btn-danger text-sm py-2">
              <XCircle className="w-4 h-4" />Eliminar
            </button>
          )}
        </div>

        {/* Message */}
        {message.text && (
          <div className={`mb-4 p-4 rounded-xl ${message.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
            {message.text}
          </div>
        )}

        {/* Input */}
        <div className="space-y-4">
          <div>
            <label className="input-label">Nueva API Key</label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="input pr-12"
                placeholder="sk-..."
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white"
              >
                {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={testApiKey} disabled={!apiKey || testing} className="btn-secondary">
              {testing ? <div className="loading-spinner w-4 h-4" /> : <Shield className="w-4 h-4" />}
              Probar
            </button>
            <button onClick={saveApiKey} disabled={!apiKey || saving} className="btn-primary">
              {saving ? <div className="loading-spinner w-4 h-4" /> : <Save className="w-4 h-4" />}
              Guardar API Key
            </button>
          </div>
        </div>

        {/* Help */}
        <div className="mt-6 p-4 bg-[var(--bg-tertiary)] rounded-xl">
          <h4 className="font-medium text-white mb-2">¿Cómo obtener tu API Key?</h4>
          <ol className="text-sm text-[var(--text-muted)] space-y-1">
            <li>1. Ve a <a href="https://platform.openai.com/api-keys" target="_blank" className="text-[var(--accent-primary)] hover:underline">platform.openai.com/api-keys</a></li>
            <li>2. Inicia sesión o crea una cuenta</li>
            <li>3. Crea una nueva API Key</li>
            <li>4. Copia y pega aquí</li>
          </ol>
        </div>
      </div>

      {/* Push Notifications Card */}
      <div className="card">
        <PushNotificationManager />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center py-4">
        <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
          <img src="/bizonne.png" alt="Bizonne" className="w-5 h-5 rounded" />
          Configuración powered by Bizonne
        </div>
      </div>
    </div>
  );
}

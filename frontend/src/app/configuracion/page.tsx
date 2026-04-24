'use client';

import { useState, useEffect } from 'react';
import { Settings, Key, User, Shield, Save, CheckCircle, XCircle, Eye, EyeOff, Zap, Bot } from 'lucide-react';
import { PushNotificationManager } from '../../components/PushNotificationManager';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function ConfiguracionPage() {
  const [user, setUser] = useState<any>(null);

  // OpenAI
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingOpenAI, setSavingOpenAI] = useState(false);
  const [testingOpenAI, setTestingOpenAI] = useState(false);
  const [msgOpenAI, setMsgOpenAI] = useState({ type: '', text: '' });

  // Groq
  const [groqKey, setGroqKey] = useState('');
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [savingGroq, setSavingGroq] = useState(false);
  const [testingGroq, setTestingGroq] = useState(false);
  const [msgGroq, setMsgGroq] = useState({ type: '', text: '' });

  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchUser(); }, []);

  const fetchUser = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setUser((await res.json()).user);
    } catch {}
    finally { setLoading(false); }
  };

  const getToken = () => localStorage.getItem('token');

  // ===== OPENAI =====
  const testOpenAI = async () => {
    if (!apiKey) return;
    setTestingOpenAI(true); setMsgOpenAI({ type: '', text: '' });
    try {
      const res = await fetch(`${API_URL}/api/auth/test-api-key`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      });
      setMsgOpenAI(res.ok
        ? { type: 'success', text: '✓ API Key de OpenAI válida' }
        : { type: 'error', text: 'API Key inválida o sin créditos' });
    } catch { setMsgOpenAI({ type: 'error', text: 'Error al probar' }); }
    finally { setTestingOpenAI(false); }
  };

  const saveOpenAI = async () => {
    if (!apiKey) return;
    setSavingOpenAI(true); setMsgOpenAI({ type: '', text: '' });
    try {
      const res = await fetch(`${API_URL}/api/auth/api-key`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      });
      if (res.ok) {
        setMsgOpenAI({ type: 'success', text: 'API Key de OpenAI guardada ✓' });
        setApiKey('');
        await fetchUser();
      } else {
        setMsgOpenAI({ type: 'error', text: 'Error al guardar' });
      }
    } catch { setMsgOpenAI({ type: 'error', text: 'Error al guardar' }); }
    finally { setSavingOpenAI(false); }
  };

  const deleteOpenAI = async () => {
    if (!confirm('¿Eliminar la API Key de OpenAI?')) return;
    try {
      await fetch(`${API_URL}/api/auth/api-key`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${getToken()}` } });
      setMsgOpenAI({ type: 'success', text: 'API Key eliminada' });
      await fetchUser();
    } catch {}
  };

  // ===== GROQ =====
  const testGroq = async () => {
    if (!groqKey) return;
    setTestingGroq(true); setMsgGroq({ type: '', text: '' });
    try {
      const res = await fetch(`${API_URL}/api/auth/groq-api-key/validate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ groqApiKey: groqKey })
      });
      const data = await res.json();
      setMsgGroq(data.valid
        ? { type: 'success', text: `✓ ${data.message}` }
        : { type: 'error', text: data.message || 'API Key inválida' });
    } catch { setMsgGroq({ type: 'error', text: 'Error al probar' }); }
    finally { setTestingGroq(false); }
  };

  const saveGroq = async () => {
    if (!groqKey) return;
    setSavingGroq(true); setMsgGroq({ type: '', text: '' });
    try {
      const res = await fetch(`${API_URL}/api/auth/groq-api-key`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ groqApiKey: groqKey })
      });
      if (res.ok) {
        setMsgGroq({ type: 'success', text: 'API Key de Groq guardada ✓' });
        setGroqKey('');
        await fetchUser();
      } else {
        const d = await res.json();
        setMsgGroq({ type: 'error', text: d.error || 'Error al guardar' });
      }
    } catch { setMsgGroq({ type: 'error', text: 'Error al guardar' }); }
    finally { setSavingGroq(false); }
  };

  const deleteGroq = async () => {
    if (!confirm('¿Eliminar la API Key de Groq?')) return;
    try {
      await fetch(`${API_URL}/api/auth/groq-api-key`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${getToken()}` } });
      setMsgGroq({ type: 'success', text: 'API Key de Groq eliminada' });
      await fetchUser();
    } catch {}
  };

  if (loading) return <div className="h-[calc(100vh-120px)] flex items-center justify-center"><div className="loading-spinner w-8 h-8" /></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <img src="/bizonne.png" alt="Bizonne" className="w-14 h-14 rounded-xl" />
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Configuración</h1>
          <p className="text-[var(--text-muted)]">Personaliza tu cuenta y proveedores de IA</p>
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

      {/* Banner comparativo */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl p-4 bg-green-500/5 border border-green-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Bot className="w-4 h-4 text-green-400" />
            <span className="text-green-400 font-semibold text-sm">OpenAI</span>
            <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">GPT-4o, GPT-3.5</span>
          </div>
          <p className="text-xs text-[var(--text-muted)]">El más poderoso. Ideal para flujos complejos y ventas avanzadas.</p>
        </div>
        <div className="rounded-xl p-4 bg-purple-500/5 border border-purple-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-purple-400" />
            <span className="text-purple-400 font-semibold text-sm">Groq</span>
            <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">Llama 3, Mixtral</span>
          </div>
          <p className="text-xs text-[var(--text-muted)]">10x más rápido que OpenAI. Respuestas en milisegundos. Gratis para empezar.</p>
        </div>
      </div>

      {/* OpenAI API Key */}
      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <Bot className="w-5 h-5 text-green-400" />
          <h2 className="text-lg font-semibold text-white">API Key de OpenAI</h2>
          {user?.apiKeyConnected && (
            <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-full">Activa</span>
          )}
        </div>

        <div className="flex items-center gap-3 mb-6 p-4 rounded-xl bg-[var(--bg-tertiary)]">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${user?.apiKeyConnected ? 'bg-emerald-500/20' : 'bg-yellow-500/20'}`}>
            {user?.apiKeyConnected ? <CheckCircle className="w-5 h-5 text-emerald-400" /> : <Key className="w-5 h-5 text-yellow-400" />}
          </div>
          <div className="flex-1">
            <p className="font-medium text-white">{user?.apiKeyConnected ? 'OpenAI configurado' : 'Sin API Key de OpenAI'}</p>
            <p className="text-sm text-[var(--text-muted)]">{user?.apiKeyConnected ? 'Modelos GPT disponibles en tus asistentes' : 'Agrega tu clave para usar GPT-4o y GPT-3.5'}</p>
          </div>
          {user?.apiKeyConnected && (
            <button onClick={deleteOpenAI} className="btn-danger text-sm py-2">
              <XCircle className="w-4 h-4" />Eliminar
            </button>
          )}
        </div>

        {msgOpenAI.text && (
          <div className={`mb-4 p-4 rounded-xl ${msgOpenAI.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
            {msgOpenAI.text}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="input-label">API Key de OpenAI</label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="input pr-12"
                placeholder="sk-..."
              />
              <button onClick={() => setShowApiKey(!showApiKey)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white">
                {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={testOpenAI} disabled={!apiKey || testingOpenAI} className="btn-secondary">
              {testingOpenAI ? <div className="loading-spinner w-4 h-4" /> : <Shield className="w-4 h-4" />}
              Probar
            </button>
            <button onClick={saveOpenAI} disabled={!apiKey || savingOpenAI} className="btn-primary">
              {savingOpenAI ? <div className="loading-spinner w-4 h-4" /> : <Save className="w-4 h-4" />}
              Guardar
            </button>
          </div>
        </div>

        <div className="mt-6 p-4 bg-[var(--bg-tertiary)] rounded-xl">
          <h4 className="font-medium text-white mb-2">¿Cómo obtener tu API Key de OpenAI?</h4>
          <ol className="text-sm text-[var(--text-muted)] space-y-1">
            <li>1. Ve a <a href="https://platform.openai.com/api-keys" target="_blank" className="text-[var(--accent-primary)] hover:underline">platform.openai.com/api-keys</a></li>
            <li>2. Inicia sesión o crea una cuenta</li>
            <li>3. Crea una nueva API Key y cópiala aquí</li>
          </ol>
        </div>
      </div>

      {/* Groq API Key */}
      <div className="card border-purple-500/20">
        <div className="flex items-center gap-3 mb-2">
          <Zap className="w-5 h-5 text-purple-400" />
          <h2 className="text-lg font-semibold text-white">API Key de Groq</h2>
          <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">10x más rápido</span>
          {user?.groqApiKeyConnected && (
            <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-full">Activa</span>
          )}
        </div>
        <p className="text-sm text-[var(--text-muted)] mb-6">Usa modelos Llama 3.3, Mixtral y Gemma. Mucho más rápidos y con capa gratuita generosa.</p>

        <div className="flex items-center gap-3 mb-6 p-4 rounded-xl bg-[var(--bg-tertiary)]">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${user?.groqApiKeyConnected ? 'bg-purple-500/20' : 'bg-gray-500/20'}`}>
            {user?.groqApiKeyConnected ? <CheckCircle className="w-5 h-5 text-purple-400" /> : <Zap className="w-5 h-5 text-gray-400" />}
          </div>
          <div className="flex-1">
            <p className="font-medium text-white">{user?.groqApiKeyConnected ? 'Groq configurado' : 'Sin API Key de Groq'}</p>
            <p className="text-sm text-[var(--text-muted)]">
              {user?.groqApiKeyConnected
                ? 'Llama 3.3, Mixtral y Gemma disponibles en tus asistentes'
                : 'Agrega tu clave para respuestas ultrarrápidas con Llama y Mixtral'}
            </p>
          </div>
          {user?.groqApiKeyConnected && (
            <button onClick={deleteGroq} className="btn-danger text-sm py-2">
              <XCircle className="w-4 h-4" />Eliminar
            </button>
          )}
        </div>

        {msgGroq.text && (
          <div className={`mb-4 p-4 rounded-xl ${msgGroq.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
            {msgGroq.text}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="input-label">API Key de Groq</label>
            <div className="relative">
              <input
                type={showGroqKey ? 'text' : 'password'}
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                className="input pr-12"
                placeholder="gsk_..."
              />
              <button onClick={() => setShowGroqKey(!showGroqKey)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white">
                {showGroqKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={testGroq} disabled={!groqKey || testingGroq} className="btn-secondary">
              {testingGroq ? <div className="loading-spinner w-4 h-4" /> : <Shield className="w-4 h-4" />}
              Probar
            </button>
            <button onClick={saveGroq} disabled={!groqKey || savingGroq} className="btn-primary" style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
              {savingGroq ? <div className="loading-spinner w-4 h-4" /> : <Save className="w-4 h-4" />}
              Guardar Groq
            </button>
          </div>
        </div>

        <div className="mt-6 p-4 bg-purple-500/5 border border-purple-500/20 rounded-xl">
          <h4 className="font-medium text-white mb-2">¿Cómo obtener tu API Key de Groq? (es gratis)</h4>
          <ol className="text-sm text-[var(--text-muted)] space-y-1">
            <li>1. Ve a <a href="https://console.groq.com/keys" target="_blank" className="text-purple-400 hover:underline">console.groq.com/keys</a></li>
            <li>2. Crea una cuenta gratuita (no requiere tarjeta)</li>
            <li>3. Crea una nueva API Key — empieza con <strong className="text-white">gsk_</strong></li>
            <li>4. Cópiala y pégala aquí</li>
          </ol>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[
              { name: 'Llama 3.3 70B', desc: 'Mejor calidad', speed: 'Ultra rápido' },
              { name: 'Llama 3.1 8B', desc: 'Más ligero', speed: 'El más rápido' },
              { name: 'Mixtral 8x7B', desc: 'Excelente español', speed: 'Muy rápido' },
              { name: 'Gemma 2 9B', desc: 'Preciso', speed: 'Rápido' },
            ].map(m => (
              <div key={m.name} className="bg-purple-500/10 rounded-lg p-2">
                <p className="text-xs font-medium text-purple-300">{m.name}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{m.desc} · {m.speed}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Push Notifications */}
      <div className="card">
        <PushNotificationManager />
      </div>

      <div className="flex items-center justify-center py-4">
        <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
          <img src="/bizonne.png" alt="Bizonne" className="w-5 h-5 rounded" />
          Configuración powered by Bizonne
        </div>
      </div>
    </div>
  );
}

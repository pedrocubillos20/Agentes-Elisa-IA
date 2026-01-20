'use client';

import { useState, useEffect } from 'react';
import { 
  Key, 
  CheckCircle, 
  XCircle, 
  Loader2,
  ExternalLink,
  AlertCircle,
  Eye,
  EyeOff,
  Trash2
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function ConfiguracionPage() {
  const [user, setUser] = useState<any>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchUser();
  }, []);

  const fetchUser = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setError('Ingresa una API Key válida');
      return;
    }

    if (!apiKey.startsWith('sk-')) {
      setError('La API Key debe comenzar con "sk-"');
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`${API_URL}/api/auth/api-key`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ apiKey })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Error al guardar');
      }

      setSuccess('¡API Key guardada correctamente!');
      setApiKey('');
      setUser({ ...user, apiKeyConnected: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!apiKey.trim()) {
      setError('Ingresa una API Key para probar');
      return;
    }

    setTesting(true);
    setError('');
    setSuccess('');

    try {
      // Simple validation by checking format
      if (!apiKey.startsWith('sk-')) {
        throw new Error('Formato de API Key inválido');
      }
      
      setSuccess('Formato de API Key válido. Guárdala para verificar con OpenAI.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('¿Estás seguro de eliminar tu API Key?')) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    setDeleting(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`${API_URL}/api/auth/api-key`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Error al eliminar');
      }

      setSuccess('API Key eliminada');
      setUser({ ...user, apiKeyConnected: false });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Key className="w-8 h-8 text-yellow-400" />
          Configurar API Key de OpenAI
        </h1>
        <p className="text-slate-400 mt-2">
          Conecta tu cuenta de OpenAI. Tú eres responsable de tus créditos.
        </p>
      </div>

      {/* Current Status */}
      <div className={`rounded-xl border p-6 ${
        user?.apiKeyConnected 
          ? 'bg-emerald-500/10 border-emerald-500/30' 
          : 'bg-slate-800/50 border-slate-700'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              user?.apiKeyConnected ? 'bg-emerald-500/20' : 'bg-slate-600'
            }`}>
              <Key className={`w-6 h-6 ${user?.apiKeyConnected ? 'text-emerald-400' : 'text-slate-400'}`} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                {user?.apiKeyConnected ? 'API Key Conectada' : 'Sin API Key'}
              </h2>
              <p className="text-slate-400 text-sm">
                {user?.apiKeyConnected 
                  ? 'Tu API Key está configurada y lista' 
                  : 'Configura tu API Key para activar el bot'
                }
              </p>
            </div>
          </div>
          {user?.apiKeyConnected ? (
            <span className="badge-success">
              <CheckCircle className="w-4 h-4 mr-1" />
              Conectada
            </span>
          ) : (
            <span className="badge-danger">
              <XCircle className="w-4 h-4 mr-1" />
              Pendiente
            </span>
          )}
        </div>

        {user?.apiKeyConnected && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="mt-4 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Eliminar API Key
          </button>
        )}
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-emerald-500/20 border border-emerald-500/50 rounded-lg p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <p className="text-emerald-400">{success}</p>
        </div>
      )}

      {/* API Key Form */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          {user?.apiKeyConnected ? 'Cambiar API Key' : 'Agregar API Key'}
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              API Key de OpenAI
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent pr-12"
                placeholder="sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleTest}
              disabled={testing || !apiKey.trim()}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
            >
              {testing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Probar'
              )}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !apiKey.trim()}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                'Guardar'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          📝 ¿Cómo obtener tu API Key?
        </h3>
        <ol className="space-y-3 text-slate-300">
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold">1</span>
            <span>
              Ve a{' '}
              <a 
                href="https://platform.openai.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-emerald-400 hover:underline inline-flex items-center gap-1"
              >
                platform.openai.com
                <ExternalLink className="w-3 h-3" />
              </a>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold">2</span>
            <span>Inicia sesión o crea una cuenta</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold">3</span>
            <span>Ve a "API Keys" en el menú</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold">4</span>
            <span>Crea una nueva API Key</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold">5</span>
            <span>Copia la clave y pégala aquí</span>
          </li>
        </ol>
      </div>

      {/* Pricing Info */}
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-yellow-400 flex-shrink-0" />
          <div>
            <h4 className="font-semibold text-yellow-400">Sobre los costos</h4>
            <p className="text-slate-300 text-sm mt-1">
              OpenAI cobra por uso. GPT-3.5-turbo cuesta aproximadamente $0.002 por 1000 tokens 
              (aproximadamente 750 palabras). Monitorea tu uso en el dashboard de OpenAI.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

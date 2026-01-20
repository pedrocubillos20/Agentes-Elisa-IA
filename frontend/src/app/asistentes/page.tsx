'use client';

import { useState, useEffect } from 'react';
import { 
  Bot, 
  Plus, 
  Edit2, 
  Trash2, 
  CheckCircle, 
  Loader2,
  Save,
  X,
  Zap
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Assistant {
  id: string;
  name: string;
  personality?: string;
  context?: string;
  businessInfo?: string;
  instructions?: string;
  welcomeMessage?: string;
  isActive: boolean;
  model: string;
  temperature: number;
  maxTokens: number;
}

export default function AsistentesPage() {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '',
    personality: '',
    context: '',
    businessInfo: '',
    instructions: '',
    welcomeMessage: '',
    model: 'gpt-3.5-turbo',
    temperature: 0.7,
    maxTokens: 500
  });

  useEffect(() => {
    fetchAssistants();
  }, []);

  const fetchAssistants = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/assistants`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        setAssistants(data.assistants);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!form.name.trim()) {
      setError('El nombre es requerido');
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) return;

    setSaving(true);
    setError('');

    try {
      const url = editingId 
        ? `${API_URL}/api/assistants/${editingId}`
        : `${API_URL}/api/assistants`;
      
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(form)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Error al guardar');
      }

      fetchAssistants();
      resetForm();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (assistant: Assistant) => {
    setForm({
      name: assistant.name,
      personality: assistant.personality || '',
      context: assistant.context || '',
      businessInfo: assistant.businessInfo || '',
      instructions: assistant.instructions || '',
      welcomeMessage: assistant.welcomeMessage || '',
      model: assistant.model,
      temperature: assistant.temperature,
      maxTokens: assistant.maxTokens
    });
    setEditingId(assistant.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este asistente?')) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/assistants/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        fetchAssistants();
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleActivate = async (id: string) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/assistants/${id}/activate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        fetchAssistants();
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const resetForm = () => {
    setForm({
      name: '',
      personality: '',
      context: '',
      businessInfo: '',
      instructions: '',
      welcomeMessage: '',
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 500
    });
    setEditingId(null);
    setShowForm(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Bot className="w-8 h-8 text-emerald-400" />
            Asistentes
          </h1>
          <p className="text-slate-400 mt-2">
            Configura cómo responde tu chatbot
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-all duration-200 flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Crear Asistente
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white">
              {editingId ? 'Editar Asistente' : 'Nuevo Asistente'}
            </h2>
            <button
              onClick={resetForm}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Nombre del Asistente *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input-dark"
                placeholder="Ej: Asistente de Ventas"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Personalidad
              </label>
              <textarea
                value={form.personality}
                onChange={(e) => setForm({ ...form, personality: e.target.value })}
                className="input-dark min-h-[80px]"
                placeholder="Ej: Amigable, profesional, entusiasta"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Contexto / Información del Negocio
              </label>
              <textarea
                value={form.businessInfo}
                onChange={(e) => setForm({ ...form, businessInfo: e.target.value })}
                className="input-dark min-h-[100px]"
                placeholder="Describe tu negocio, productos, servicios, horarios, etc."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Instrucciones Especiales
              </label>
              <textarea
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                className="input-dark min-h-[80px]"
                placeholder="Instrucciones específicas para el bot"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Mensaje de Bienvenida
              </label>
              <textarea
                value={form.welcomeMessage}
                onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })}
                className="input-dark"
                placeholder="Mensaje que enviará cuando alguien escribe por primera vez"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Modelo
                </label>
                <select
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  className="input-dark"
                >
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo (Económico)</option>
                  <option value="gpt-4">GPT-4 (Mejor calidad)</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo (Rápido)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Temperatura: {form.temperature}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={form.temperature}
                  onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })}
                  className="w-full"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Menor = más preciso, Mayor = más creativo
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Max Tokens: {form.maxTokens}
                </label>
                <input
                  type="range"
                  min="100"
                  max="2000"
                  step="100"
                  value={form.maxTokens}
                  onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value) })}
                  className="w-full"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Longitud máxima de respuesta
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all duration-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Guardar
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Assistants List */}
      {assistants.length === 0 ? (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-12 text-center">
          <Bot className="w-16 h-16 text-slate-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            No tienes asistentes
          </h3>
          <p className="text-slate-400 mb-6">
            Crea tu primer asistente para personalizar las respuestas del chatbot
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-all duration-200 inline-flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Crear mi primer asistente
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {assistants.map((assistant) => (
            <div
              key={assistant.id}
              className={`bg-slate-800/50 rounded-xl border p-6 transition-all duration-200 ${
                assistant.isActive 
                  ? 'border-emerald-500/50 bg-emerald-500/5' 
                  : 'border-slate-700 hover:border-slate-600'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    assistant.isActive ? 'bg-emerald-500/20' : 'bg-slate-600'
                  }`}>
                    <Bot className={`w-6 h-6 ${assistant.isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                      {assistant.name}
                      {assistant.isActive && (
                        <span className="badge-success text-xs">
                          <Zap className="w-3 h-3 mr-1" />
                          Activo
                        </span>
                      )}
                    </h3>
                    <p className="text-slate-400 text-sm mt-1">
                      {assistant.personality || 'Sin personalidad definida'}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                      <span>Modelo: {assistant.model}</span>
                      <span>Temp: {assistant.temperature}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!assistant.isActive && (
                    <button
                      onClick={() => handleActivate(assistant.id)}
                      className="px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-sm rounded-lg transition-all duration-200"
                    >
                      Activar
                    </button>
                  )}
                  <button
                    onClick={() => handleEdit(assistant)}
                    className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-all duration-200"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(assistant.id)}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all duration-200"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

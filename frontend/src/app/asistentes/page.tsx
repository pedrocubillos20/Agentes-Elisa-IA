'use client';

import { useState, useEffect } from 'react';
import { 
  Bot, 
  Plus, 
  Edit2, 
  Trash2, 
  Loader2,
  Save,
  X,
  Zap,
  FileText,
  Code,
  Eye,
  Pause,
  Play,
  Info,
  Copy,
  Check,
  EyeOff
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Assistant {
  id: string;
  name: string;
  context?: string;
  isActive: boolean;
  model: string;
  temperature: number;
  maxTokens: number;
}

// Plantilla de ejemplo en Markdown
const MARKDOWN_TEMPLATE = `# Información del Negocio

## Nombre
Mi Restaurante

## Descripción
Restaurante de comida típica colombiana

## Horario de Atención
- Lunes a Viernes: 7:00 AM - 5:00 PM
- Sábados: 8:00 AM - 3:00 PM
- Domingos: Cerrado

## Menú / Productos
- Chorizo: $8.000
- Chicharrón: $12.000
- Almuerzo Paisa: $15.000
- Bandeja Paisa: $25.000

## Ubicación
Calle 123 #45-67, Medellín

## Contacto
- WhatsApp: +57 300 123 4567
- Instagram: @mirestaurante

## Métodos de Pago
- Efectivo
- Nequi
- Daviplata
- Transferencia Bancrofé

## Personalidad del Asistente
- Ser amigable y profesional
- Responder en español
- Usar emojis ocasionalmente 😊

## Reglas Importantes
- NO salir del tema del negocio
- NO inventar productos que no están en el menú
- Si no sabes algo, indica que un humano se comunicará pronto
- Siempre ofrecer ayuda adicional al final
`;

// Plantilla de ejemplo en JSON
const JSON_TEMPLATE = `{
  "negocio": {
    "nombre": "Mi Restaurante",
    "descripcion": "Restaurante de comida típica colombiana",
    "horario": {
      "lunes_viernes": "7:00 AM - 5:00 PM",
      "sabados": "8:00 AM - 3:00 PM",
      "domingos": "Cerrado"
    }
  },
  "menu": [
    { "nombre": "Chorizo", "precio": 8000 },
    { "nombre": "Chicharrón", "precio": 12000 },
    { "nombre": "Almuerzo Paisa", "precio": 15000 },
    { "nombre": "Bandeja Paisa", "precio": 25000 }
  ],
  "contacto": {
    "telefono": "+57 300 123 4567",
    "direccion": "Calle 123 #45-67, Medellín",
    "instagram": "@mirestaurante"
  },
  "pagos": ["Efectivo", "Nequi", "Daviplata", "Transferencia"],
  "personalidad": {
    "tono": "amigable y profesional",
    "idioma": "español",
    "emojis": true
  },
  "reglas": [
    "NO salir del tema del negocio",
    "NO inventar productos",
    "Ofrecer ayuda adicional al final"
  ]
}`;

export default function AsistentesPage() {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Form simplificado
  const [name, setName] = useState('');
  const [context, setContext] = useState('');
  const [editorMode, setEditorMode] = useState<'markdown' | 'json'>('markdown');
  const [showPreview, setShowPreview] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

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
    
    if (!name.trim()) {
      setError('El nombre es requerido');
      return;
    }

    if (!context.trim()) {
      setError('El contexto es requerido');
      return;
    }

    // Validar JSON si está en modo JSON
    if (editorMode === 'json') {
      try {
        JSON.parse(context);
      } catch (e) {
        setError('El JSON no es válido');
        return;
      }
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
        body: JSON.stringify({
          name,
          context,
          model: 'gpt-4-turbo-preview',
          temperature: 0.3,
          maxTokens: 500
        })
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
    setName(assistant.name);
    setContext(assistant.context || '');
    
    try {
      if (assistant.context) {
        JSON.parse(assistant.context);
        setEditorMode('json');
      }
    } catch {
      setEditorMode('markdown');
    }
    
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
    setName('');
    setContext('');
    setEditorMode('markdown');
    setShowPreview(false);
    setEditingId(null);
    setShowForm(false);
    setError('');
  };

  const loadTemplate = () => {
    setContext(editorMode === 'markdown' ? MARKDOWN_TEMPLATE : JSON_TEMPLATE);
  };

  const copyTemplate = () => {
    navigator.clipboard.writeText(context);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const validateJson = () => {
    if (editorMode !== 'json' || !context) return true;
    try {
      JSON.parse(context);
      return true;
    } catch {
      return false;
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
    <div className="max-w-5xl mx-auto space-y-8">
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

      {/* Comandos de Control Info - ACTUALIZADO */}
      {!showForm && (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <EyeOff className="w-5 h-5 text-purple-400" />
            <span className="text-sm font-medium text-slate-300">Comandos de Control en Chat</span>
            <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded-full">Silenciosos</span>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Escribe estos comandos desde tu WhatsApp para controlar el bot. El cliente NO ve estos comandos ni sabe que existe un bot.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-3 bg-slate-900/50 p-3 rounded-lg">
              <div className="flex items-center justify-center w-10 h-10 bg-yellow-500/20 rounded-lg">
                <Pause className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <code className="text-yellow-400 font-mono text-lg">..</code>
                <p className="text-slate-400">Pausar IA → Tú tomas el control</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-slate-900/50 p-3 rounded-lg">
              <div className="flex items-center justify-center w-10 h-10 bg-green-500/20 rounded-lg">
                <Play className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <code className="text-green-400 font-mono text-lg">.</code>
                <p className="text-slate-400">Reanudar IA → El bot responde</p>
              </div>
            </div>
          </div>
        </div>
      )}

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

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Nombre */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Nombre del Asistente *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                placeholder="Ej: Asistente de Ventas, Soporte, etc."
                required
              />
            </div>

            {/* Comandos de Control en Form - ACTUALIZADO */}
            <div className="bg-purple-900/20 border border-purple-700/50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <EyeOff className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium text-slate-300">Comandos Silenciosos</span>
              </div>
              <p className="text-xs text-slate-500 mb-3">El cliente nunca ve estos comandos ni sabe que hay un bot</p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-3">
                  <Pause className="w-4 h-4 text-yellow-400" />
                  <span><code className="text-yellow-400 font-mono">..</code> = Pausar IA</span>
                </div>
                <div className="flex items-center gap-3">
                  <Play className="w-4 h-4 text-green-400" />
                  <span><code className="text-green-400 font-mono">.</code> = Reanudar IA</span>
                </div>
              </div>
            </div>

            {/* Editor de Contexto */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-300">
                  Configuración del Negocio *
                </label>
                <div className="flex items-center gap-2">
                  {/* Toggle Markdown/JSON */}
                  <div className="flex bg-slate-900 rounded-lg p-1">
                    <button
                      type="button"
                      onClick={() => setEditorMode('markdown')}
                      className={`flex items-center gap-1 px-3 py-1 rounded text-sm transition-colors ${
                        editorMode === 'markdown'
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <FileText className="w-4 h-4" />
                      Markdown
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorMode('json')}
                      className={`flex items-center gap-1 px-3 py-1 rounded text-sm transition-colors ${
                        editorMode === 'json'
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Code className="w-4 h-4" />
                      JSON
                    </button>
                  </div>
                  
                  {/* Preview Toggle */}
                  <button
                    type="button"
                    onClick={() => setShowPreview(!showPreview)}
                    className={`flex items-center gap-1 px-3 py-1 rounded text-sm transition-colors ${
                      showPreview
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Eye className="w-4 h-4" />
                  </button>

                  {/* Copy */}
                  <button
                    type="button"
                    onClick={copyTemplate}
                    className="flex items-center gap-1 px-3 py-1 bg-slate-900 text-slate-400 hover:text-white rounded text-sm transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>

                  {/* Load Template */}
                  <button
                    type="button"
                    onClick={loadTemplate}
                    className="px-3 py-1 bg-slate-900 text-slate-400 hover:text-white rounded text-sm transition-colors"
                  >
                    📝 Plantilla
                  </button>
                </div>
              </div>

              {/* Help */}
              <button
                type="button"
                onClick={() => setShowHelp(!showHelp)}
                className="text-sm text-blue-400 hover:text-blue-300 mb-2"
              >
                {showHelp ? '▼ Ocultar ayuda' : '▶ ¿Cómo escribir la configuración?'}
              </button>

              {showHelp && (
                <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-4 mb-3 text-sm text-slate-300">
                  <p className="font-medium text-blue-400 mb-2">Tips para una buena configuración:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Incluye toda la información de tu negocio</li>
                    <li>Agrega precios, horarios y datos de contacto</li>
                    <li>Define la personalidad (formal, amigable, etc.)</li>
                    <li>Especifica qué NO debe hacer el asistente</li>
                    <li>Markdown es más legible, JSON es más estructurado</li>
                  </ul>
                </div>
              )}

              <div className={`grid gap-4 ${showPreview ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {/* Editor */}
                <div>
                  <textarea
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder={editorMode === 'markdown' 
                      ? '# Mi Negocio\n\nEscribe aquí toda la información...'
                      : '{\n  "negocio": "Mi Negocio"\n}'
                    }
                    className={`w-full h-96 px-4 py-3 bg-slate-900/50 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm resize-none ${
                      editorMode === 'json' && context && !validateJson()
                        ? 'border-red-500'
                        : 'border-slate-600'
                    }`}
                  />
                  {editorMode === 'json' && context && !validateJson() && (
                    <p className="text-red-400 text-sm mt-1">⚠️ JSON inválido</p>
                  )}
                </div>

                {/* Preview */}
                {showPreview && (
                  <div className="h-96 overflow-y-auto bg-slate-900/50 border border-slate-600 rounded-lg p-4">
                    <p className="text-xs text-slate-500 mb-2">Vista previa:</p>
                    <pre className="whitespace-pre-wrap text-slate-300 text-sm font-mono">
                      {editorMode === 'json' && context && validateJson()
                        ? JSON.stringify(JSON.parse(context), null, 2)
                        : context
                      }
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {/* Buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all duration-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || !name.trim() || !context.trim() || (editorMode === 'json' && !validateJson())}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-all duration-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
      {!showForm && assistants.length === 0 ? (
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
      ) : !showForm && (
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
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400">
                          <Zap className="w-3 h-3 mr-1" />
                          Activo
                        </span>
                      )}
                    </h3>
                    <p className="text-slate-400 text-sm mt-1 line-clamp-2">
                      {assistant.context?.substring(0, 150) || 'Sin contexto definido'}...
                    </p>
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

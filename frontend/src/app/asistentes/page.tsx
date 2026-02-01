'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Bot, Save, Play, Pause, Upload, Image, Video, Music, FileText, 
  Sparkles, Brain, MessageSquare, Settings, Trash2, Plus, X, 
  ChevronDown, ChevronUp, Volume2, Key, RefreshCw, CheckCircle,
  AlertCircle, Eye, Code, FileJson, Mic, Zap, TrendingUp
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function AsistentesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'context' | 'media' | 'learning' | 'voice'>('context');
  const [viewMode, setViewMode] = useState<'markdown' | 'json'>('markdown');
  const [message, setMessage] = useState({ type: '', text: '' });

  // Context/Knowledge
  const [context, setContext] = useState('');
  const [knowledgeItems, setKnowledgeItems] = useState<any[]>([]);

  // Media
  const [mediaItems, setMediaItems] = useState<any[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // Voice (ElevenLabs)
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [elevenLabsVoices, setElevenLabsVoices] = useState<any[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);

  // Learning
  const [learningHistory, setLearningHistory] = useState<any[]>([]);
  const [autoLearn, setAutoLearn] = useState(true);

  useEffect(() => {
    fetchAssistant();
  }, []);

  const fetchAssistant = async () => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    try {
      const res = await fetch(`${API_URL}/api/assistants`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        // FIX: Soportar AMBOS formatos del backend
        // data.assistant (singular) o data.assistants (array)
        const active = data.assistant || 
                       data.assistants?.find((a: any) => a.isActive) || 
                       data.assistants?.[0] || 
                       null;
        if (active) {
          console.log(`📋 Asistente cargado: "${active.name}" - context: ${active.context?.length || 0} chars`);
          setContext(active.context || '');
          setKnowledgeItems(
            Array.isArray(active.knowledgeItems) ? active.knowledgeItems : []
          );
          setMediaItems(
            Array.isArray(active.mediaItems) ? active.mediaItems : []
          );
          setElevenLabsKey(active.elevenLabsKey || '');
          setSelectedVoice(active.selectedVoice || '');
          setVoiceEnabled(active.voiceEnabled || false);
          setAutoLearn(active.autoLearn !== false);
          setLearningHistory(
            Array.isArray(active.learningHistory) ? active.learningHistory : []
          );
        }
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage({ type: '', text: '' });
    const token = localStorage.getItem('token');

    try {
      const res = await fetch(`${API_URL}/api/assistants`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Asistente Principal',
          context,
          knowledgeItems,
          mediaItems,
          elevenLabsKey,
          selectedVoice,
          voiceEnabled,
          autoLearn,
          isActive: true
        })
      });

      if (res.ok) {
        setMessage({ type: 'success', text: '¡Configuración guardada correctamente!' });
      } else {
        setMessage({ type: 'error', text: 'Error al guardar' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error de conexión' });
    } finally {
      setSaving(false);
    }
  };

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Simular upload local (en producción sería a un storage)
    const reader = new FileReader();
    reader.onload = () => {
      const newMedia = {
        id: Date.now().toString(),
        name: file.name,
        type,
        url: reader.result as string,
        trigger: '',
        size: file.size
      };
      setMediaItems([...mediaItems, newMedia]);
      setMessage({ type: 'success', text: 'Archivo agregado correctamente' });
    };
    reader.readAsDataURL(file);
  };

  const removeMedia = (index: number) => {
    setMediaItems(mediaItems.filter((_, i) => i !== index));
  };

  const testElevenLabs = async () => {
    if (!elevenLabsKey) return;
    setTestingVoice(true);

    try {
      // Llamar directamente a ElevenLabs API
      const res = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': elevenLabsKey }
      });

      if (res.ok) {
        const data = await res.json();
        setElevenLabsVoices(data.voices || []);
        setMessage({ type: 'success', text: `¡Conectado! ${data.voices?.length || 0} voces disponibles` });
      } else {
        setMessage({ type: 'error', text: 'API Key de ElevenLabs inválida' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error al conectar con ElevenLabs' });
    } finally {
      setTestingVoice(false);
    }
  };

  const addKnowledgeItem = () => {
    setKnowledgeItems([...knowledgeItems, { 
      id: Date.now().toString(),
      title: '', 
      content: '', 
      triggers: ''
    }]);
  };

  const updateKnowledgeItem = (index: number, field: string, value: any) => {
    const updated = [...knowledgeItems];
    updated[index] = { ...updated[index], [field]: value };
    setKnowledgeItems(updated);
  };

  const removeKnowledgeItem = (index: number) => {
    setKnowledgeItems(knowledgeItems.filter((_, i) => i !== index));
  };

  const markdownTemplate = `# 🤖 Asistente de [Tu Negocio]

## 📋 Información General
- **Nombre:** [Nombre del negocio]
- **Tipo:** [Tienda/Restaurante/Servicios/etc]
- **Horario:** Lunes a Viernes 9am - 6pm
- **Ubicación:** [Dirección]
- **WhatsApp:** [Número]

## 💬 Personalidad
Soy un asistente amable, profesional y eficiente. 
Respondo de forma clara y concisa.
Siempre busco ayudar al cliente.

## 🛍️ Productos/Servicios

### Producto 1
- **Descripción:** Descripción detallada
- **Precio:** $XX.XXX
- **Disponible:** Sí

### Producto 2
- **Descripción:** Descripción detallada
- **Precio:** $XX.XXX
- **Disponible:** Sí

## ❓ Preguntas Frecuentes

**¿Cuáles son los métodos de pago?**
Aceptamos efectivo, tarjeta, transferencia y Nequi.

**¿Hacen envíos?**
Sí, hacemos envíos a toda la ciudad. El costo depende de la zona.

**¿Tienen garantía?**
Todos nuestros productos tienen garantía de 30 días.

## 📝 Instrucciones Especiales
- Si preguntan por precio, dar el precio con impuestos incluidos
- Si no hay stock, ofrecer alternativas similares
- Siempre preguntar si necesitan algo más al final
- Si es urgente, proporcionar número directo de atención

## 🔄 Flujo de Conversación
1. Saludar cordialmente
2. Preguntar en qué puedo ayudar
3. Dar información clara y completa
4. Ofrecer productos/servicios relacionados
5. Despedirse amablemente
`;

  const jsonTemplate = `{
  "negocio": {
    "nombre": "Tu Negocio",
    "tipo": "Tienda",
    "horario": "Lunes a Viernes 9am - 6pm",
    "ubicacion": "Tu dirección",
    "whatsapp": "+57 300 123 4567"
  },
  "personalidad": {
    "tono": "amable",
    "estilo": "profesional",
    "idioma": "español"
  },
  "productos": [
    {
      "nombre": "Producto 1",
      "descripcion": "Descripción del producto",
      "precio": 50000,
      "disponible": true
    }
  ],
  "preguntas_frecuentes": [
    {
      "pregunta": "¿Cuáles son los métodos de pago?",
      "respuesta": "Aceptamos efectivo, tarjeta, transferencia y Nequi."
    }
  ],
  "instrucciones": [
    "Siempre saludar amablemente",
    "Ofrecer alternativas si no hay stock",
    "Preguntar si necesitan algo más"
  ]
}`;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <img src="/elisa.png" alt="Elisa" className="w-16 h-16 rounded-xl animate-pulse" />
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/elisa.png" alt="Elisa IA" className="w-14 h-14 rounded-xl shadow-lg" />
          <div>
            <h1 className="text-3xl font-bold text-white">Asistente IA</h1>
            <p className="text-[var(--text-muted)]">Configura el cerebro de Elisa</p>
          </div>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <div className="loading-spinner w-4 h-4" /> : <Save className="w-4 h-4" />}
          Guardar Todo
        </button>
      </div>

      {/* Message */}
      {message.text && (
        <div className={`p-4 rounded-xl flex items-center gap-3 animate-fade-in ${
          message.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' : 
          'bg-red-500/10 border border-red-500/30 text-red-400'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {message.text}
          <button onClick={() => setMessage({ type: '', text: '' })} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 p-1.5 bg-[var(--bg-tertiary)] rounded-xl overflow-x-auto">
        {[
          { id: 'context', label: 'Contexto', icon: Brain },
          { id: 'media', label: 'Multimedia', icon: Image },
          { id: 'learning', label: 'Auto-Aprendizaje', icon: TrendingUp },
          { id: 'voice', label: 'Voz (ElevenLabs)', icon: Volume2 },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-5 py-3 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === tab.id 
                ? 'bg-[var(--accent-primary)] text-white shadow-lg' 
                : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ==================== CONTEXT TAB ==================== */}
      {activeTab === 'context' && (
        <div className="space-y-6">
          {/* Format Toggle & Template */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-muted)]">Formato:</span>
              <div className="flex gap-1 p-1 bg-[var(--bg-tertiary)] rounded-lg">
                <button
                  onClick={() => setViewMode('markdown')}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-all flex items-center gap-1 ${
                    viewMode === 'markdown' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)]'
                  }`}
                >
                  <FileText className="w-3 h-3" />Markdown
                </button>
                <button
                  onClick={() => setViewMode('json')}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-all flex items-center gap-1 ${
                    viewMode === 'json' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)]'
                  }`}
                >
                  <FileJson className="w-3 h-3" />JSON
                </button>
              </div>
            </div>
            <button
              onClick={() => setContext(viewMode === 'json' ? jsonTemplate : markdownTemplate)}
              className="btn-secondary text-sm py-2"
            >
              <Sparkles className="w-4 h-4" />Usar Plantilla
            </button>
          </div>

          {/* Main Editor */}
          <div className="card p-0 overflow-hidden">
            <div className="p-4 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-tertiary)]">
              <div className="flex items-center gap-3">
                <img src="/elisa.png" alt="Elisa" className="w-8 h-8 rounded-lg" />
                <div>
                  <span className="font-medium text-white">Base de Conocimiento</span>
                  <p className="text-xs text-[var(--text-muted)]">Escribe toda la información de tu negocio aquí</p>
                </div>
              </div>
              <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-primary)] px-3 py-1 rounded-full">
                {context.length} caracteres
              </span>
            </div>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={viewMode === 'json' 
                ? '{\n  "negocio": {\n    "nombre": "Tu negocio",\n    ...\n  }\n}' 
                : '# Tu Negocio\n\nEscribe aquí toda la información...\n\n## Productos\n- Producto 1: $10.000\n- Producto 2: $20.000'
              }
              className="w-full min-h-[450px] p-6 bg-[var(--bg-primary)] text-white text-sm resize-none focus:outline-none leading-relaxed"
              style={{ fontFamily: viewMode === 'json' ? 'JetBrains Mono, Consolas, monospace' : 'Plus Jakarta Sans, sans-serif' }}
            />
          </div>

          {/* Knowledge Items (Quick Responses) */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-white">Respuestas Rápidas</h3>
                <p className="text-sm text-[var(--text-muted)]">Respuestas específicas para palabras clave</p>
              </div>
              <button onClick={addKnowledgeItem} className="btn-secondary text-sm py-2">
                <Plus className="w-4 h-4" />Agregar
              </button>
            </div>
            
            <div className="space-y-4">
              {knowledgeItems.map((item, index) => (
                <div key={item.id} className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => updateKnowledgeItem(index, 'title', e.target.value)}
                          placeholder="Título (ej: Horarios)"
                          className="input text-sm"
                        />
                        <input
                          type="text"
                          value={item.triggers || ''}
                          onChange={(e) => updateKnowledgeItem(index, 'triggers', e.target.value)}
                          placeholder="Palabras clave: horario, abren, cuando..."
                          className="input text-sm"
                        />
                      </div>
                      <textarea
                        value={item.content}
                        onChange={(e) => updateKnowledgeItem(index, 'content', e.target.value)}
                        placeholder="Respuesta que dará Elisa cuando detecte estas palabras..."
                        className="input min-h-[80px] text-sm"
                      />
                    </div>
                    <button onClick={() => removeKnowledgeItem(index)} className="btn-icon text-red-400 hover:bg-red-500/20">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              
              {knowledgeItems.length === 0 && (
                <div className="text-center py-8 text-[var(--text-muted)] border-2 border-dashed border-[var(--border-primary)] rounded-xl">
                  <Brain className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">Sin respuestas rápidas</p>
                  <p className="text-sm">Agrega respuestas para palabras clave específicas</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== MEDIA TAB ==================== */}
      {activeTab === 'media' && (
        <div className="space-y-6">
          <div className="card">
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-white mb-2">Biblioteca Multimedia</h3>
              <p className="text-[var(--text-muted)]">
                Agrega imágenes, videos y audios que Elisa puede enviar automáticamente.
              </p>
            </div>

            {/* Upload Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <label className="card glass-hover cursor-pointer text-center py-8 border-2 border-dashed border-[var(--border-primary)] hover:border-blue-500/50">
                <input type="file" accept="image/*" className="hidden" onChange={(e) => handleMediaUpload(e, 'image')} />
                <div className="w-16 h-16 rounded-2xl bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
                  <Image className="w-8 h-8 text-blue-400" />
                </div>
                <h4 className="font-semibold text-white mb-1">Imágenes</h4>
                <p className="text-xs text-[var(--text-muted)]">Catálogo, productos, local</p>
              </label>

              <label className="card glass-hover cursor-pointer text-center py-8 border-2 border-dashed border-[var(--border-primary)] hover:border-purple-500/50">
                <input type="file" accept="video/*" className="hidden" onChange={(e) => handleMediaUpload(e, 'video')} />
                <div className="w-16 h-16 rounded-2xl bg-purple-500/20 flex items-center justify-center mx-auto mb-4">
                  <Video className="w-8 h-8 text-purple-400" />
                </div>
                <h4 className="font-semibold text-white mb-1">Videos</h4>
                <p className="text-xs text-[var(--text-muted)]">Tutoriales, demos, tours</p>
              </label>

              <label className="card glass-hover cursor-pointer text-center py-8 border-2 border-dashed border-[var(--border-primary)] hover:border-orange-500/50">
                <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleMediaUpload(e, 'audio')} />
                <div className="w-16 h-16 rounded-2xl bg-orange-500/20 flex items-center justify-center mx-auto mb-4">
                  <Music className="w-8 h-8 text-orange-400" />
                </div>
                <h4 className="font-semibold text-white mb-1">Audios</h4>
                <p className="text-xs text-[var(--text-muted)]">Mensajes de voz pregrabados</p>
              </label>
            </div>

            {/* Media Grid */}
            {mediaItems.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {mediaItems.map((item, index) => (
                  <div key={item.id} className="relative group rounded-xl overflow-hidden bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                    {item.type === 'image' && (
                      <img src={item.url} alt={item.name} className="w-full h-32 object-cover" />
                    )}
                    {item.type === 'video' && (
                      <div className="w-full h-32 flex items-center justify-center bg-purple-500/10">
                        <Video className="w-10 h-10 text-purple-400" />
                      </div>
                    )}
                    {item.type === 'audio' && (
                      <div className="w-full h-32 flex items-center justify-center bg-orange-500/10">
                        <Music className="w-10 h-10 text-orange-400" />
                      </div>
                    )}
                    <div className="p-3">
                      <p className="text-xs text-white truncate font-medium">{item.name}</p>
                      <input
                        type="text"
                        placeholder="Trigger: catalogo, menu..."
                        value={item.trigger || ''}
                        onChange={(e) => {
                          const updated = [...mediaItems];
                          updated[index].trigger = e.target.value;
                          setMediaItems(updated);
                        }}
                        className="w-full mt-2 px-2 py-1.5 text-xs bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg focus:border-[var(--accent-primary)] focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={() => removeMedia(index)}
                      className="absolute top-2 right-2 p-1.5 bg-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {mediaItems.length === 0 && (
              <div className="text-center py-12 text-[var(--text-muted)] border-2 border-dashed border-[var(--border-primary)] rounded-xl">
                <Image className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Sin archivos multimedia</p>
                <p className="text-sm">Sube archivos para que Elisa los envíe automáticamente</p>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="card bg-blue-500/5 border-blue-500/20">
            <h4 className="font-semibold text-blue-400 mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4" />Cómo funciona
            </h4>
            <ul className="text-sm text-[var(--text-muted)] space-y-2">
              <li>• <strong className="text-white">Trigger:</strong> Palabra clave que activa el envío del archivo</li>
              <li>• Si el cliente dice "envíame el catálogo" y tienes una imagen con trigger "catalogo", se enviará automáticamente</li>
              <li>• Puedes usar múltiples triggers separados por coma: "menu, carta, precios"</li>
              <li>• Los audios son ideales para respuestas personalizadas de voz</li>
            </ul>
          </div>
        </div>
      )}

      {/* ==================== LEARNING TAB ==================== */}
      {activeTab === 'learning' && (
        <div className="space-y-6">
          {/* Auto-learning Card */}
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--accent-primary)] to-teal-400 flex items-center justify-center">
                  <Brain className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">Auto-Aprendizaje</h3>
                  <p className="text-[var(--text-muted)]">Elisa analiza conversaciones y mejora sus respuestas</p>
                </div>
              </div>
              <button
                onClick={() => setAutoLearn(!autoLearn)}
                className={`relative w-16 h-8 rounded-full transition-all ${autoLearn ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-tertiary)]'}`}
              >
                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all ${autoLearn ? 'left-9' : 'left-1'}`} />
              </button>
            </div>
          </div>

          {/* How it works */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card text-center">
              <div className="w-14 h-14 rounded-xl bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-7 h-7 text-blue-400" />
              </div>
              <h4 className="font-semibold text-white mb-2">1. Analiza</h4>
              <p className="text-sm text-[var(--text-muted)]">Detecta preguntas sin respuesta y patrones frecuentes</p>
            </div>
            <div className="card text-center">
              <div className="w-14 h-14 rounded-xl bg-purple-500/20 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-7 h-7 text-purple-400" />
              </div>
              <h4 className="font-semibold text-white mb-2">2. Sugiere</h4>
              <p className="text-sm text-[var(--text-muted)]">Propone nuevas respuestas y mejoras al contexto</p>
            </div>
            <div className="card text-center">
              <div className="w-14 h-14 rounded-xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                <TrendingUp className="w-7 h-7 text-emerald-400" />
              </div>
              <h4 className="font-semibold text-white mb-2">3. Mejora</h4>
              <p className="text-sm text-[var(--text-muted)]">Aplica mejoras para respuestas más precisas</p>
            </div>
          </div>

          {/* Learning History */}
          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4">Sugerencias de Mejora</h3>
            
            {learningHistory.length > 0 ? (
              <div className="space-y-3">
                {learningHistory.map((item, index) => (
                  <div key={index} className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`badge text-xs ${item.applied ? 'badge-success' : 'badge-warning'}`}>
                            {item.applied ? 'Aplicado' : 'Pendiente'}
                          </span>
                          <span className="text-xs text-[var(--text-muted)]">{item.date}</span>
                        </div>
                        <p className="text-white">{item.suggestion}</p>
                        <p className="text-sm text-[var(--text-muted)] mt-1">{item.reason}</p>
                      </div>
                      {!item.applied && (
                        <button className="btn-primary text-sm py-2 px-4">Aplicar</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-[var(--text-muted)] border-2 border-dashed border-[var(--border-primary)] rounded-xl">
                <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Sin sugerencias aún</p>
                <p className="text-sm">Las sugerencias aparecerán después de algunas conversaciones</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== VOICE TAB ==================== */}
      {activeTab === 'voice' && (
        <div className="space-y-6">
          <div className="card">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <Mic className="w-8 h-8 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">ElevenLabs Text-to-Speech</h3>
                <p className="text-[var(--text-muted)]">Elisa puede responder con audios de voz natural</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="input-label">Tu API Key de ElevenLabs</label>
                <div className="flex gap-3">
                  <input
                    type="password"
                    value={elevenLabsKey}
                    onChange={(e) => setElevenLabsKey(e.target.value)}
                    placeholder="Pega tu API Key aquí..."
                    className="input flex-1 font-mono"
                  />
                  <button onClick={testElevenLabs} disabled={!elevenLabsKey || testingVoice} className="btn-secondary">
                    {testingVoice ? <div className="loading-spinner w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                    Conectar
                  </button>
                </div>
              </div>

              {elevenLabsVoices.length > 0 && (
                <div>
                  <label className="input-label">Selecciona una Voz</label>
                  <select
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value)}
                    className="input"
                  >
                    <option value="">-- Selecciona una voz --</option>
                    {elevenLabsVoices.map((voice) => (
                      <option key={voice.voice_id} value={voice.voice_id}>
                        {voice.name} {voice.labels?.accent && `(${voice.labels.accent})`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {selectedVoice && (
                <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                  <div>
                    <h4 className="font-medium text-white">Activar respuestas de voz</h4>
                    <p className="text-sm text-[var(--text-muted)]">Elisa enviará audios en cada respuesta</p>
                  </div>
                  <button
                    onClick={() => setVoiceEnabled(!voiceEnabled)}
                    className={`relative w-16 h-8 rounded-full transition-all ${voiceEnabled ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-primary)]'}`}
                  >
                    <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all ${voiceEnabled ? 'left-9' : 'left-1'}`} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Instructions */}
          <div className="card bg-purple-500/5 border-purple-500/20">
            <h4 className="font-semibold text-purple-400 mb-3 flex items-center gap-2">
              <Key className="w-4 h-4" />Cómo obtener tu API Key
            </h4>
            <ol className="text-sm text-[var(--text-muted)] space-y-2">
              <li>1. Crea una cuenta gratis en <a href="https://elevenlabs.io" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">elevenlabs.io</a></li>
              <li>2. Ve a tu perfil → API Keys</li>
              <li>3. Copia tu API Key y pégala arriba</li>
              <li>4. Cada usuario usa sus propios créditos de ElevenLabs</li>
            </ol>
          </div>

          {/* Pricing Note */}
          <div className="card bg-yellow-500/5 border-yellow-500/20">
            <h4 className="font-semibold text-yellow-400 mb-2 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />Sobre los costos
            </h4>
            <p className="text-sm text-[var(--text-muted)]">
              ElevenLabs tiene un plan gratuito con 10,000 caracteres/mes. Los planes pagos empiezan en $5/mes.
              Cada audio generado consume caracteres de tu cuenta.
            </p>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-center py-6">
        <div className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white/5 border border-white/10">
          <img src="/elisa.png" alt="Elisa IA" className="w-8 h-8 rounded-lg" />
          <span className="text-sm text-[var(--text-muted)]">
            Powered by <span className="text-white font-semibold">Elisa IA</span>
          </span>
        </div>
      </div>
    </div>
  );
}

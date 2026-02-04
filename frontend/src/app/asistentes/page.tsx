'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Bot, Save, Play, Pause, Upload, Image, Video, Music, FileText, 
  Sparkles, Brain, MessageSquare, Settings, Trash2, Plus, X, 
  ChevronDown, ChevronUp, Volume2, Key, RefreshCw, CheckCircle,
  AlertCircle, Eye, Code, FileJson, Mic, Zap, TrendingUp, Loader2, Check, XCircle
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function AsistentesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'context' | 'media' | 'learning' | 'voice'>('context');
  const [viewMode, setViewMode] = useState<'markdown' | 'json'>('markdown');
  const [message, setMessage] = useState({ type: '', text: '' });

  // Context
  const [context, setContext] = useState('');
  const [knowledgeItems, setKnowledgeItems] = useState<any[]>([]);

  // Media
  const [mediaItems, setMediaItems] = useState<any[]>([]);

  // Voice
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [elevenLabsVoices, setElevenLabsVoices] = useState<any[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);

  // Learning
  const [learningHistory, setLearningHistory] = useState<any[]>([]);
  const [autoLearn, setAutoLearn] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  // === WORKSPACE: leer línea seleccionada ===
  const getLineId = () => localStorage.getItem('selectedLineId') || '';

  useEffect(() => {
    fetchAssistant();
    const onLineChanged = () => { setLoading(true); fetchAssistant(); };
    window.addEventListener('lineChanged', onLineChanged);
    return () => window.removeEventListener('lineChanged', onLineChanged);
  }, []);

  const fetchAssistant = async () => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    try {
      const res = await fetch(`${API_URL}/api/assistants?lineId=${getLineId()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        // Handle both singular and plural response formats
        const active = data.assistant || data.assistants?.find((a: any) => a.isActive) || data.assistants?.[0];
        if (active) {
          setContext(active.context || '');
          setKnowledgeItems(
            Array.isArray(active.knowledgeItems) ? active.knowledgeItems : 
            typeof active.knowledgeItems === 'string' ? JSON.parse(active.knowledgeItems || '[]') : []
          );
          setMediaItems(
            Array.isArray(active.mediaItems) ? active.mediaItems :
            typeof active.mediaItems === 'string' ? JSON.parse(active.mediaItems || '[]') : []
          );
          setElevenLabsKey(active.elevenLabsKey || '');
          setSelectedVoice(active.selectedVoice || '');
          setVoiceEnabled(active.voiceEnabled || false);
          setAutoLearn(active.autoLearn !== false);
          setLearningHistory(
            Array.isArray(active.learningHistory) ? active.learningHistory :
            typeof active.learningHistory === 'string' ? JSON.parse(active.learningHistory || '[]') : []
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
          learningHistory,
          isActive: true,
          lineId: getLineId()
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
      setTimeout(() => setMessage({ type: '', text: '' }), 4000);
    }
  };

  // ===== MULTIMEDIA =====
  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Limit: 5MB
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Archivo muy grande (máx 5MB)' });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const newMedia = {
        id: Date.now().toString(),
        name: file.name,
        type,
        url: reader.result as string,
        trigger: '',
        caption: '',
        size: file.size
      };
      setMediaItems(prev => [...prev, newMedia]);
      setMessage({ type: 'success', text: `${type === 'image' ? 'Imagen' : type === 'video' ? 'Video' : 'Audio'} "${file.name}" agregado. Define un trigger y guarda.` });
    };
    reader.readAsDataURL(file);
    // Reset input
    e.target.value = '';
  };

  const updateMediaItem = (index: number, field: string, value: string) => {
    setMediaItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const removeMedia = (index: number) => {
    setMediaItems(prev => prev.filter((_, i) => i !== index));
  };

  // ===== AUTO-APRENDIZAJE =====
  const analyzeConversations = async () => {
    setAnalyzing(true);
    setMessage({ type: '', text: '' });
    const token = localStorage.getItem('token');

    try {
      const res = await fetch(`${API_URL}/api/assistants/learn`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });

      if (res.ok) {
        const data = await res.json();
        if (data.suggestions?.length > 0) {
          setLearningHistory(prev => [...data.suggestions, ...prev].slice(0, 50));
          setMessage({ type: 'success', text: `✨ ${data.suggestions.length} sugerencias generadas del análisis` });
        } else {
          setMessage({ type: 'success', text: 'Análisis completado. No se encontraron sugerencias nuevas.' });
        }
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error || 'Error al analizar' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error de conexión' });
    } finally {
      setAnalyzing(false);
    }
  };

  const applySuggestion = async (item: any) => {
    setApplyingId(item.id);
    const token = localStorage.getItem('token');

    try {
      const res = await fetch(`${API_URL}/api/assistants/learn/apply`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: item.id, suggestion: item.suggestion })
      });

      if (res.ok) {
        // Actualizar contexto local
        setContext(prev => prev + '\n\n' + item.suggestion);
        // Marcar como aplicada
        setLearningHistory(prev => prev.map(h => h.id === item.id ? { ...h, applied: true } : h));
        setMessage({ type: 'success', text: '✅ Sugerencia aplicada al contexto' });
      } else {
        setMessage({ type: 'error', text: 'Error al aplicar' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Error de conexión' });
    } finally {
      setApplyingId(null);
    }
  };

  const dismissSuggestion = async (item: any) => {
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/assistants/learn/dismiss`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: item.id })
      });
      setLearningHistory(prev => prev.map(h => h.id === item.id ? { ...h, dismissed: true } : h));
    } catch {}
  };

  // ===== ELEVENLABS =====
  const testElevenLabs = async () => {
    if (!elevenLabsKey) return;
    setTestingVoice(true);
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': elevenLabsKey } });
      if (res.ok) {
        const data = await res.json();
        setElevenLabsVoices(data.voices || []);
        setMessage({ type: 'success', text: `¡Conectado! ${data.voices?.length || 0} voces disponibles` });
      } else {
        setMessage({ type: 'error', text: 'API Key de ElevenLabs inválida' });
      }
    } catch { setMessage({ type: 'error', text: 'Error de conexión' }); }
    finally { setTestingVoice(false); }
  };

  // ===== KNOWLEDGE =====
  const addKnowledgeItem = () => {
    setKnowledgeItems(prev => [...prev, { id: Date.now().toString(), title: '', content: '', triggers: '' }]);
  };
  const updateKnowledgeItem = (index: number, field: string, value: any) => {
    setKnowledgeItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };
  const removeKnowledgeItem = (index: number) => {
    setKnowledgeItems(prev => prev.filter((_, i) => i !== index));
  };

  const markdownTemplate = `# 🤖 Asistente de [Tu Negocio]\n\n## 📋 Información General\n- **Nombre:** [Nombre del negocio]\n- **Horario:** Lunes a Viernes 9am - 6pm\n- **WhatsApp:** [Número]\n\n## 💬 Personalidad\nSoy un asistente amable, profesional y eficiente.\n\n## 🛍️ Productos/Servicios\n### Producto 1\n- **Precio:** $XX.XXX\n- **Disponible:** Sí\n\n## ❓ Preguntas Frecuentes\n**¿Métodos de pago?** Efectivo, tarjeta, Nequi.\n**¿Hacen envíos?** Sí, a toda la ciudad.\n\n## 📝 Instrucciones\n- Siempre preguntar si necesitan algo más\n- Ofrecer alternativas si no hay stock`;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const pendingSuggestions = learningHistory.filter(h => !h.applied && !h.dismissed);
  const appliedSuggestions = learningHistory.filter(h => h.applied);

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
          {message.type === 'success' ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
          <span className="flex-1">{message.text}</span>
          <button onClick={() => setMessage({ type: '', text: '' })}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 p-1.5 bg-[var(--bg-tertiary)] rounded-xl overflow-x-auto">
        {[
          { id: 'context', label: 'Contexto', icon: Brain },
          { id: 'media', label: 'Multimedia', icon: Image, badge: mediaItems.length || undefined },
          { id: 'learning', label: 'Auto-Aprendizaje', icon: TrendingUp, badge: pendingSuggestions.length || undefined },
          { id: 'voice', label: 'Voz (ElevenLabs)', icon: Volume2 },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-5 py-3 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === tab.id ? 'bg-[var(--accent-primary)] text-white shadow-lg' : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'
            }`}>
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.badge && tab.badge > 0 && (
              <span className="w-5 h-5 rounded-full bg-white/20 text-[10px] flex items-center justify-center font-bold">{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ==================== CONTEXT TAB ==================== */}
      {activeTab === 'context' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-muted)]">Formato:</span>
              <div className="flex gap-1 p-1 bg-[var(--bg-tertiary)] rounded-lg">
                <button onClick={() => setViewMode('markdown')}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-all flex items-center gap-1 ${viewMode === 'markdown' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)]'}`}>
                  <FileText className="w-3 h-3" />Markdown
                </button>
                <button onClick={() => setViewMode('json')}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-all flex items-center gap-1 ${viewMode === 'json' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)]'}`}>
                  <FileJson className="w-3 h-3" />JSON
                </button>
              </div>
            </div>
            <button onClick={() => setContext(markdownTemplate)} className="btn-secondary text-sm py-2">
              <Sparkles className="w-4 h-4" />Usar Plantilla
            </button>
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="p-4 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-tertiary)]">
              <div className="flex items-center gap-3">
                <img src="/elisa.png" alt="Elisa" className="w-8 h-8 rounded-lg" />
                <div>
                  <span className="font-medium text-white">Base de Conocimiento</span>
                  <p className="text-xs text-[var(--text-muted)]">Escribe toda la información de tu negocio aquí</p>
                </div>
              </div>
              <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-primary)] px-3 py-1 rounded-full">{context.length} caracteres</span>
            </div>
            <textarea value={context} onChange={(e) => setContext(e.target.value)}
              placeholder={viewMode === 'json' ? '{\n  "negocio": {...}\n}' : '# Tu Negocio\n\nEscribe aquí...'}
              className="w-full min-h-[450px] p-6 bg-[var(--bg-primary)] text-white text-sm resize-none focus:outline-none leading-relaxed"
              style={{ fontFamily: viewMode === 'json' ? 'JetBrains Mono, Consolas, monospace' : 'inherit' }} />
          </div>

          {/* Knowledge Items */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-white">Respuestas Rápidas</h3>
                <p className="text-sm text-[var(--text-muted)]">Respuestas específicas para palabras clave</p>
              </div>
              <button onClick={addKnowledgeItem} className="btn-secondary text-sm py-2"><Plus className="w-4 h-4" />Agregar</button>
            </div>
            <div className="space-y-4">
              {knowledgeItems.map((item, index) => (
                <div key={item.id} className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input type="text" value={item.title} onChange={(e) => updateKnowledgeItem(index, 'title', e.target.value)} placeholder="Título (ej: Horarios)" className="input text-sm" />
                        <input type="text" value={item.triggers || ''} onChange={(e) => updateKnowledgeItem(index, 'triggers', e.target.value)} placeholder="Palabras clave: horario, abren..." className="input text-sm" />
                      </div>
                      <textarea value={item.content} onChange={(e) => updateKnowledgeItem(index, 'content', e.target.value)} placeholder="Respuesta..." className="input min-h-[80px] text-sm" />
                    </div>
                    <button onClick={() => removeKnowledgeItem(index)} className="btn-icon text-red-400 hover:bg-red-500/20"><Trash2 className="w-4 h-4" /></button>
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
              <p className="text-[var(--text-muted)]">Sube archivos que Elisa enviará automáticamente cuando detecte el trigger en la conversación.</p>
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
                <p className="text-xs text-blue-400 mt-2">Máx 5MB</p>
              </label>

              <label className="card glass-hover cursor-pointer text-center py-8 border-2 border-dashed border-[var(--border-primary)] hover:border-purple-500/50">
                <input type="file" accept="video/*" className="hidden" onChange={(e) => handleMediaUpload(e, 'video')} />
                <div className="w-16 h-16 rounded-2xl bg-purple-500/20 flex items-center justify-center mx-auto mb-4">
                  <Video className="w-8 h-8 text-purple-400" />
                </div>
                <h4 className="font-semibold text-white mb-1">Videos</h4>
                <p className="text-xs text-[var(--text-muted)]">Tutoriales, demos, tours</p>
                <p className="text-xs text-purple-400 mt-2">Máx 5MB</p>
              </label>

              <label className="card glass-hover cursor-pointer text-center py-8 border-2 border-dashed border-[var(--border-primary)] hover:border-orange-500/50">
                <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleMediaUpload(e, 'audio')} />
                <div className="w-16 h-16 rounded-2xl bg-orange-500/20 flex items-center justify-center mx-auto mb-4">
                  <Music className="w-8 h-8 text-orange-400" />
                </div>
                <h4 className="font-semibold text-white mb-1">Audios</h4>
                <p className="text-xs text-[var(--text-muted)]">Mensajes de voz</p>
                <p className="text-xs text-orange-400 mt-2">Máx 5MB</p>
              </label>
            </div>

            {/* Media Grid */}
            {mediaItems.length > 0 ? (
              <div className="space-y-4">
                {mediaItems.map((item, index) => (
                  <div key={item.id} className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)] flex items-start gap-4">
                    {/* Preview */}
                    <div className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-[var(--bg-primary)] flex items-center justify-center">
                      {item.type === 'image' && item.url ? (
                        <img src={item.url} alt={item.name} className="w-full h-full object-cover" />
                      ) : item.type === 'video' ? (
                        <Video className="w-8 h-8 text-purple-400" />
                      ) : (
                        <Music className="w-8 h-8 text-orange-400" />
                      )}
                    </div>

                    {/* Info + Trigger */}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{item.name}</span>
                        <span className="text-[10px] text-[var(--text-muted)] bg-white/5 px-2 py-0.5 rounded">{formatSize(item.size || 0)}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded ${
                          item.type === 'image' ? 'bg-blue-500/20 text-blue-400' :
                          item.type === 'video' ? 'bg-purple-500/20 text-purple-400' : 'bg-orange-500/20 text-orange-400'
                        }`}>{item.type}</span>
                      </div>
                      <input type="text" placeholder="🔑 Triggers: catalogo, menu, productos (separados por coma)"
                        value={item.trigger || ''} onChange={(e) => updateMediaItem(index, 'trigger', e.target.value)}
                        className="input text-sm w-full" />
                      <input type="text" placeholder="💬 Caption opcional (texto que acompaña al archivo)"
                        value={item.caption || ''} onChange={(e) => updateMediaItem(index, 'caption', e.target.value)}
                        className="input text-sm w-full" />
                      {!item.trigger && (
                        <p className="text-xs text-yellow-400 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />Define un trigger para activar el envío automático
                        </p>
                      )}
                    </div>

                    {/* Delete */}
                    <button onClick={() => removeMedia(index)} className="btn-icon text-red-400 hover:bg-red-500/20 flex-shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-[var(--text-muted)] border-2 border-dashed border-[var(--border-primary)] rounded-xl">
                <Image className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Sin archivos multimedia</p>
                <p className="text-sm">Sube archivos para que Elisa los envíe automáticamente</p>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="card bg-blue-500/5 border-blue-500/20">
            <h4 className="font-semibold text-blue-400 mb-3 flex items-center gap-2"><Zap className="w-4 h-4" />Cómo funciona</h4>
            <ul className="text-sm text-[var(--text-muted)] space-y-2">
              <li>• <strong className="text-white">Trigger:</strong> Palabra clave que activa el envío del archivo</li>
              <li>• Si el cliente dice "envíame el catálogo" y tienes una imagen con trigger "catalogo", se enviará automáticamente</li>
              <li>• Múltiples triggers separados por coma: "menu, carta, precios"</li>
              <li>• <strong className="text-white">Caption:</strong> Texto opcional que acompaña al archivo</li>
              <li>• La IA responderá primero con texto, y luego enviará el archivo</li>
              <li>• <strong className="text-yellow-400">Importante:</strong> Haz clic en "Guardar Todo" después de agregar/editar archivos</li>
            </ul>
          </div>
        </div>
      )}

      {/* ==================== LEARNING TAB ==================== */}
      {activeTab === 'learning' && (
        <div className="space-y-6">
          {/* Header */}
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--accent-primary)] to-teal-400 flex items-center justify-center">
                  <Brain className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">Auto-Aprendizaje</h3>
                  <p className="text-[var(--text-muted)]">Elisa analiza conversaciones reales y sugiere mejoras</p>
                </div>
              </div>
              <button onClick={() => setAutoLearn(!autoLearn)}
                className={`relative w-16 h-8 rounded-full transition-all ${autoLearn ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-tertiary)]'}`}>
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
              <p className="text-sm text-[var(--text-muted)]">Revisa las últimas 20 conversaciones reales</p>
            </div>
            <div className="card text-center">
              <div className="w-14 h-14 rounded-xl bg-purple-500/20 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-7 h-7 text-purple-400" />
              </div>
              <h4 className="font-semibold text-white mb-2">2. Sugiere</h4>
              <p className="text-sm text-[var(--text-muted)]">OpenAI genera mejoras concretas al contexto</p>
            </div>
            <div className="card text-center">
              <div className="w-14 h-14 rounded-xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                <TrendingUp className="w-7 h-7 text-emerald-400" />
              </div>
              <h4 className="font-semibold text-white mb-2">3. Aplica</h4>
              <p className="text-sm text-[var(--text-muted)]">Tú decides qué mejoras agregar al contexto</p>
            </div>
          </div>

          {/* Analyze Button */}
          <div className="card text-center">
            <button onClick={analyzeConversations} disabled={analyzing} className="btn-primary px-8 py-3 text-base">
              {analyzing ? (
                <><Loader2 className="w-5 h-5 animate-spin" />Analizando conversaciones...</>
              ) : (
                <><Brain className="w-5 h-5" />Analizar Conversaciones Ahora</>
              )}
            </button>
            <p className="text-xs text-[var(--text-muted)] mt-3">Usa tu API Key de OpenAI para analizar patrones y generar sugerencias</p>
          </div>

          {/* Pending Suggestions */}
          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              Sugerencias Pendientes
              {pendingSuggestions.length > 0 && (
                <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded-full">{pendingSuggestions.length}</span>
              )}
            </h3>
            
            {pendingSuggestions.length > 0 ? (
              <div className="space-y-3">
                {pendingSuggestions.map((item) => (
                  <div key={item.id} className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                    <div className="flex items-start gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">Pendiente</span>
                          <span className="text-xs text-[var(--text-muted)] bg-white/5 px-2 py-0.5 rounded">{item.type?.replace('_', ' ')}</span>
                        </div>
                        <p className="text-sm font-medium text-white mb-1">{item.title}</p>
                        <p className="text-sm text-emerald-400 bg-emerald-500/5 p-3 rounded-lg border border-emerald-500/20 mb-2 font-mono text-xs whitespace-pre-wrap">{item.suggestion}</p>
                        <p className="text-xs text-[var(--text-muted)]">💡 {item.reason}</p>
                      </div>
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <button onClick={() => applySuggestion(item)} disabled={applyingId === item.id}
                          className="btn-primary text-xs py-2 px-3">
                          {applyingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Aplicar
                        </button>
                        <button onClick={() => dismissSuggestion(item)} className="btn-secondary text-xs py-2 px-3">
                          <X className="w-3 h-3" />Descartar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-[var(--text-muted)] border-2 border-dashed border-[var(--border-primary)] rounded-xl">
                <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Sin sugerencias pendientes</p>
                <p className="text-sm">Haz clic en "Analizar Conversaciones" para generar sugerencias</p>
              </div>
            )}
          </div>

          {/* Applied History */}
          {appliedSuggestions.length > 0 && (
            <div className="card">
              <h3 className="text-lg font-semibold text-white mb-4">Historial Aplicado</h3>
              <div className="space-y-2">
                {appliedSuggestions.slice(0, 10).map((item) => (
                  <div key={item.id} className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 flex items-center gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{item.title}</p>
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">{item.appliedAt ? new Date(item.appliedAt).toLocaleDateString() : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                  <input type="password" value={elevenLabsKey} onChange={(e) => setElevenLabsKey(e.target.value)}
                    placeholder="Pega tu API Key aquí..." className="input flex-1 font-mono" />
                  <button onClick={testElevenLabs} disabled={!elevenLabsKey || testingVoice} className="btn-secondary">
                    {testingVoice ? <div className="loading-spinner w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                    Conectar
                  </button>
                </div>
              </div>

              {elevenLabsVoices.length > 0 && (
                <div>
                  <label className="input-label">Selecciona una Voz</label>
                  <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} className="input">
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
                  <button onClick={() => setVoiceEnabled(!voiceEnabled)}
                    className={`relative w-16 h-8 rounded-full transition-all ${voiceEnabled ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-primary)]'}`}>
                    <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all ${voiceEnabled ? 'left-9' : 'left-1'}`} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="card bg-purple-500/5 border-purple-500/20">
            <h4 className="font-semibold text-purple-400 mb-3 flex items-center gap-2"><Key className="w-4 h-4" />Cómo obtener tu API Key</h4>
            <ol className="text-sm text-[var(--text-muted)] space-y-2">
              <li>1. Crea una cuenta gratis en <a href="https://elevenlabs.io" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">elevenlabs.io</a></li>
              <li>2. Ve a tu perfil → API Keys</li>
              <li>3. Copia tu API Key y pégala arriba</li>
              <li>4. Cada usuario usa sus propios créditos</li>
            </ol>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-center py-6">
        <div className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white/5 border border-white/10">
          <img src="/elisa.png" alt="Elisa IA" className="w-8 h-8 rounded-lg" />
          <span className="text-sm text-[var(--text-muted)]">Powered by <span className="text-white font-semibold">Elisa IA</span></span>
        </div>
      </div>
    </div>
  );
}

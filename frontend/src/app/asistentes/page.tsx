'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Bot, Save, Play, Pause, Upload, Image, Video, Music, FileText, 
  Sparkles, Brain, MessageSquare, Settings, Trash2, Plus, X, 
  ChevronDown, ChevronUp, Volume2, Key, RefreshCw, CheckCircle,
  AlertCircle, Eye, Code, FileJson, Mic, Zap, TrendingUp, Loader2, Check, XCircle, Wand2
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
  const [assistantName, setAssistantName] = useState('Asistente Principal');
  const [knowledgeItems, setKnowledgeItems] = useState<any[]>([]);

  // Media
  const [mediaItems, setMediaItems] = useState<any[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [storageInfo, setStorageInfo] = useState<any>(null);

  // Voice
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [elevenLabsVoices, setElevenLabsVoices] = useState<any[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  // 📍 Cobertura de domicilio
  const [coverageLat, setCoverageLat] = useState('');
  const [coverageLon, setCoverageLon] = useState('');
  const [coverageRadiusKm, setCoverageRadiusKm] = useState('');

  // Learning
  const [learningHistory, setLearningHistory] = useState<any[]>([]);
  const [autoLearn, setAutoLearn] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [hasAiConfig, setHasAiConfig] = useState<boolean | null>(null);

  // === WORKSPACE: leer línea seleccionada ===
  const getLineId = () => localStorage.getItem('selectedLineId') || '';

  useEffect(() => {
    fetchAssistant();
    fetchStorage();
    fetchAiConfigStatus();
    const onLineChanged = () => { setLoading(true); fetchAssistant(); };
    window.addEventListener('lineChanged', onLineChanged);
    return () => window.removeEventListener('lineChanged', onLineChanged);
  }, []);

  const fetchAiConfigStatus = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/ai-config/status`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) { const d = await res.json(); setHasAiConfig(d.hasAccess || false); }
    } catch {}
  };

  const fetchStorage = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/media/storage`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setStorageInfo(await res.json());
    } catch {}
  };

  const fetchAssistant = async () => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    try {
      const res = await fetch(`${API_URL}/api/assistants?lineId=${getLineId()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const active = data.assistant || data.assistants?.find((a: any) => a.isActive) || data.assistants?.[0];
        
        if (active) {
          // Cargar datos del asistente existente
          setAssistantName(active.name || 'Asistente Principal');
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
          setCoverageLat(active.coverageLat?.toString() || '');
          setCoverageLon(active.coverageLon?.toString() || '');
          setCoverageRadiusKm(active.coverageRadiusKm?.toString() || '');
          setAutoLearn(active.autoLearn !== false);
          setLearningHistory(
            Array.isArray(active.learningHistory) ? active.learningHistory :
            typeof active.learningHistory === 'string' ? JSON.parse(active.learningHistory || '[]') : []
          );
        } else {
          // ✅ Línea nueva sin asistente: limpiar TODO
          setContext('');
          setKnowledgeItems([]);
          setMediaItems([]);
          setElevenLabsKey('');
          setSelectedVoice('');
          setVoiceEnabled(false);
          setCoverageLat('');
          setCoverageLon('');
          setCoverageRadiusKm('');
          setAutoLearn(true);
          setLearningHistory([]);
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const res = await fetch(`${API_URL}/api/assistants`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          name: assistantName,
          context,
          knowledgeItems,
          mediaItems,
          elevenLabsKey,
          selectedVoice,
          voiceEnabled,
          coverageLat: coverageLat ? parseFloat(coverageLat) : null,
          coverageLon: coverageLon ? parseFloat(coverageLon) : null,
          coverageRadiusKm: coverageRadiusKm ? parseFloat(coverageRadiusKm) : null,
          autoLearn,
          learningHistory,
          isActive: true,
          lineId: getLineId()
        })
      });

      clearTimeout(timeout);

      if (res.ok) {
        setMessage({ type: 'success', text: '¡Configuración guardada correctamente!' });
        fetchStorage(); // Actualizar info de storage
      } else {
        const data = await res.json().catch(() => ({}));
        setMessage({ type: 'error', text: data.error || `Error al guardar (${res.status})` });
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setMessage({ type: 'error', text: 'Tiempo agotado. Intenta de nuevo.' });
      } else {
        setMessage({ type: 'error', text: 'Error de conexión. Verifica tu internet e intenta de nuevo.' });
      }
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ type: '', text: '' }), 8000);
    }
  };

  // ===== MULTIMEDIA =====
  // ===== MULTIMEDIA: Upload via API (compresión en backend) =====
  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Límites por tipo
    const maxSize = type === 'video' ? 15 * 1024 * 1024 : 5 * 1024 * 1024;
    const maxLabel = type === 'video' ? '15MB' : '5MB';
    if (file.size > maxSize) {
      setMessage({ type: 'error', text: `Archivo muy grande (máx ${maxLabel})` });
      return;
    }

    setUploadingMedia(true);
    setMessage({ type: '', text: '' });

    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('files', file);
      formData.append('category', 'assistant');

      const res = await fetch(`${API_URL}/api/media/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.storage?.fileTooLarge) {
          setMessage({ type: 'error', text: `Sin espacio. ${data.error}` });
        } else {
          setMessage({ type: 'error', text: data.error || 'Error al subir archivo' });
        }
        return;
      }

      const data = await res.json();
      const uploaded = data.files[0];

      const newMedia = {
        id: Date.now().toString(),
        name: file.name,
        type,
        url: uploaded.url,
        key: uploaded.key,
        trigger: '',
        caption: '',
        size: uploaded.fileSize
      };
      setMediaItems(prev => [...prev, newMedia]);

      const savedPct = uploaded.savedPercent > 0 ? ` (comprimido ${uploaded.savedPercent}%)` : '';
      const typeLabel = type === 'image' ? 'Imagen' : type === 'video' ? 'Video' : 'Audio';
      setMessage({ type: 'success', text: `${typeLabel} "${file.name}" subido${savedPct}. Define un trigger y guarda.` });
      fetchStorage(); // Actualizar barra de storage
    } catch (error: any) {
      setMessage({ type: 'error', text: 'Error de conexión al subir archivo' });
    } finally {
      setUploadingMedia(false);
      e.target.value = '';
    }
  };

  // 📏 Storage info from backend (real)
  const storageUsedMB = storageInfo ? parseFloat(storageInfo.usedMB) : 0;
  const storageLimitMB = storageInfo ? parseFloat(storageInfo.limitMB) : 250;
  const storagePercent = storageInfo ? storageInfo.percent : 0;

  // 📂 CATÁLOGO: Crear nuevo catálogo vacío
  const createCatalog = () => {
    const newCatalog = {
      id: Date.now().toString(),
      name: 'Nuevo Catálogo',
      type: 'catalog',
      trigger: '',
      caption: '',
      images: [] as { id: string; name: string; url: string; size: number }[]
    };
    setMediaItems(prev => [...prev, newCatalog]);
    setMessage({ type: 'success', text: 'Catálogo creado. Agrega imágenes, define trigger y guarda.' });
  };

  // 📂 CATÁLOGO: Agregar imagen(es) via API upload
  const addImageToCatalog = async (catalogIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const catalog = mediaItems[catalogIndex];
    if (!catalog || catalog.type !== 'catalog') return;

    const currentImages = catalog.images || [];
    const remaining = 10 - currentImages.length;
    
    if (remaining <= 0) {
      setMessage({ type: 'error', text: 'Máximo 10 imágenes por catálogo' });
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remaining);
    setUploadingMedia(true);
    let processed = 0;

    try {
      const token = localStorage.getItem('token');

      for (const file of filesToProcess) {
        if (file.size > 5 * 1024 * 1024) {
          setMessage({ type: 'error', text: `"${file.name}" es muy grande (máx 5MB)` });
          continue;
        }

        const formData = new FormData();
        formData.append('files', file);
        formData.append('category', 'assistant');

        const res = await fetch(`${API_URL}/api/media/upload`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setMessage({ type: 'error', text: data.error || `Error subiendo ${file.name}` });
          continue;
        }

        const data = await res.json();
        const uploaded = data.files[0];

        processed++;
        setMediaItems(prev => prev.map((item, i) => {
          if (i !== catalogIndex) return item;
          const imgs = [...(item.images || []), {
            id: `${Date.now()}-${processed}`,
            name: file.name,
            url: uploaded.url,
            key: uploaded.key,
            size: uploaded.fileSize
          }];
          return { ...item, images: imgs };
        }));
      }

      if (processed > 0) {
        setMessage({ type: 'success', text: `${processed} imagen(es) subida(s) y comprimida(s) al catálogo` });
        fetchStorage();
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error de conexión al subir imágenes' });
    } finally {
      setUploadingMedia(false);
      e.target.value = '';
    }
  };

  // 📂 CATÁLOGO: Eliminar imagen del catálogo
  const removeImageFromCatalog = async (catalogIndex: number, imageId: string) => {
    const catalog = mediaItems[catalogIndex];
    const image = catalog?.images?.find((img: any) => img.id === imageId);
    const token = localStorage.getItem('token');

    // Eliminar del backend si tiene key
    if (image?.key && token) {
      try {
        const storageRes = await fetch(`${API_URL}/api/media/files`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (storageRes.ok) {
          const { files } = await storageRes.json();
          const mediaFile = files.find((f: any) => f.key === image.key);
          if (mediaFile) {
            await fetch(`${API_URL}/api/media/${mediaFile.id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` }
            });
          }
        }
      } catch (e) { console.error('Error eliminando imagen:', e); }
    }

    setMediaItems(prev => prev.map((item, i) => {
      if (i !== catalogIndex) return item;
      return { ...item, images: (item.images || []).filter((img: any) => img.id !== imageId) };
    }));
    fetchStorage();
  };

  const updateMediaItem = (index: number, field: string, value: string) => {
    setMediaItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const removeMedia = async (index: number) => {
    const item = mediaItems[index];
    const token = localStorage.getItem('token');

    // Si tiene key, eliminar del backend (R2 + MediaFile)
    if (item?.key && token) {
      try {
        // Buscar el MediaFile por key para obtener su ID
        const storageRes = await fetch(`${API_URL}/api/media/files`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (storageRes.ok) {
          const { files } = await storageRes.json();
          const mediaFile = files.find((f: any) => f.key === item.key);
          if (mediaFile) {
            await fetch(`${API_URL}/api/media/${mediaFile.id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` }
            });
          }
        }
      } catch (e) { console.error('Error eliminando archivo:', e); }
    }

    setMediaItems(prev => prev.filter((_, i) => i !== index));
    fetchStorage();
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
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/assistants/elevenlabs/voices`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: elevenLabsKey })
      });
      if (res.ok) {
        const data = await res.json();
        setElevenLabsVoices(data.voices || []);
        setMessage({ type: 'success', text: `¡Conectado! ${data.voices?.length || 0} voces disponibles` });
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage({ type: 'error', text: err.error || 'API Key de ElevenLabs inválida' });
      }
    } catch { setMessage({ type: 'error', text: 'Error de conexión con ElevenLabs' }); }
    finally { setTestingVoice(false); }
  };

  const previewVoice = async (voiceId: string) => {
    if (!elevenLabsKey || !voiceId) return;
    setTestingVoice(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/assistants/elevenlabs/preview`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: elevenLabsKey, voiceId })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.audio) {
        const audio = new Audio(data.audio);
        audio.play();
        setMessage({ type: 'success', text: `🔊 Reproduciendo (modelo: ${data.model || 'default'})` });
      } else {
        setMessage({ type: 'error', text: data.error || `Error preview (${res.status})` });
      }
    } catch (e: any) { setMessage({ type: 'error', text: 'Error de conexión: ' + e.message }); }
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

  const markdownTemplate = `# 🤖 [NOMBRE DEL ASISTENTE]\n\n---\n\n## 🎭 IDENTIDAD\n\nSoy el asistente virtual de **[NOMBRE DEL NEGOCIO]**\n[Descripción breve: qué hace el negocio, ciudad] 📍\n\n---\n\n## 💬 PERSONALIDAD Y TONO\n\n- Tono: [profesional / cercano / formal / dinámico]\n- Idioma: español colombiano, natural como WhatsApp\n- Emojis: usarlos con moderación para ser más cercano\n- Mensajes cortos: máximo 4-5 líneas por mensaje\n- NUNCA enviar un bloque largo de texto\n\n---\n\n## 🚫 ANTI-REPETICIÓN (OBLIGATORIO)\n\n- NUNCA repitas un mensaje ya enviado\n- Si ya mostraste opciones → NO las repitas, pregunta directo\n- Si ya saludaste → NO saludes de nuevo\n- Si ya pediste un dato → NO lo pidas otra vez\n- Cada respuesta debe AVANZAR la conversación\n\n---\n\n## 📋 SERVICIOS / PRODUCTOS\n\n### [Servicio o Producto 1]\n- **Descripción:** [Qué incluye]\n- **Precio:** $[precio]\n- **Duración:** [si aplica]\n- **Requisitos:** [si aplica]\n\n### [Servicio o Producto 2]\n- **Descripción:** [Qué incluye]\n- **Precio:** $[precio]\n\n*(Agrega todos los servicios o productos que ofreces)*\n\n---\n\n## 📋 ETAPAS DEL PIPELINE\n\n*(Estas deben coincidir EXACTAMENTE con las etapas configuradas en tu pipeline)*\n\n1. [Etapa 1 — ej: Nuevo Contacto]\n2. [Etapa 2 — ej: Consultando Servicio]\n3. [Etapa 3 — ej: Eligiendo Fecha]\n4. [Etapa 4 — ej: Confirmado]\n5. [Etapa 5 — ej: Atendido]\n6. [Etapa 6 — ej: Perdido]\n\n---\n\n## 🔄 FLUJO DE ATENCIÓN PASO A PASO\n\n### PASO 1 → Saludo (etapa: [Etapa 1])\nSaluda con el nombre del negocio y pregunta el nombre del cliente.\n\n> ¡Hola! 👋 Bienvenido/a a *[Nombre del negocio]*\n> ¿Cuál es tu nombre?\n\n### PASO 2 → Identificar necesidad (etapa: [Etapa 2])\nMuestra las opciones de servicio disponibles.\n\n> ¡Hola [Nombre]! ¿En qué te puedo ayudar? 😊\n>\n> 1️⃣ [Servicio 1]\n> 2️⃣ [Servicio 2]\n> 3️⃣ [Servicio 3]\n> 4️⃣ Hablar con un asesor\n\n### PASO 3 → Recoger datos necesarios (etapa: [Etapa 3])\n*(Lista los datos OBLIGATORIOS antes de continuar)*\n- Pedir uno por uno:\n  1. [Dato 1 — ej: Nombre completo]\n  2. [Dato 2 — ej: Teléfono]\n  3. [Dato 3 — ej: Dirección / Placa / Cédula]\n\n❌ NO agendar ni cotizar sin estos datos\n\n### PASO 4 → Fecha y hora (si aplica)\nEl sistema inyecta disponibilidad real. Reformularla bonito al cliente.\nNUNCA copies el bloque técnico del sistema al cliente.\n✅ Solo ofrece horarios marcados como libres.\n\n### PASO 5 → Resumen antes de confirmar (etapa: Confirmando)\n\n> 📋 *Resumen:*\n>\n> 👤 [Nombre del cliente]\n> 🔧 [Servicio elegido]\n> 📅 [Fecha y hora — si aplica]\n> 💰 [Precio]\n> [Otros datos relevantes]\n>\n> ¿Todo correcto? *SÍ* para confirmar o *NO* para corregir 😊\n\n### PASO 6 → Confirmado (etapa: [Etapa confirmada])\nCuando el cliente dice SÍ → accion: **"crear_cita"** o **"crear_pedido"** o **"crear_reserva"** según el negocio.\n\n> ✅ *¡[Cita/Pedido/Reserva] confirmada exitosamente!*\n> [Mensaje de cierre con instrucciones, dirección, o próximos pasos]\n\n---\n\n## 🔄 MODIFICAR / REAGENDAR / CANCELAR\n\n### Reagendar:\nConfirmar → mostrar disponibilidad → accion: **"actualizar_cita"** o **"actualizar_reserva"**\n\n### Cancelar:\nConfirmar primero → accion: **"cancelar_cita"** o **"cancelar_reserva"** o **"cancelar_pedido"**\n\n---\n\n## 📍 INFORMACIÓN DEL NEGOCIO\n\n**Dirección:** [Dirección completa]\n**WhatsApp:** [Número]\n**Web/Instagram:** [Link si aplica]\n\n| Día | Horario |\n|-----|---------|\n| Lunes - Viernes | [Horario] |\n| Sábados | [Horario] |\n| Domingos | [Horario o CERRADO] |\n\n---\n\n## 💰 MÉTODOS DE PAGO\n\n✅ [Método 1] | ✅ [Método 2] | ✅ [Método 3]\n[Condiciones especiales si aplica]\n\n---\n\n## ❓ PREGUNTAS FRECUENTES\n\n| Pregunta | Respuesta |\n|----------|-----------|\n| [Pregunta 1] | [Respuesta 1] |\n| [Pregunta 2] | [Respuesta 2] |\n| [Pregunta 3] | [Respuesta 3] |\n\n---\n\n## 🧠 CAMPOS DE MEMORIA (MEMORY_JSON)\n\nEl sistema guarda automáticamente estos datos del cliente:\n\n- **nombre** → Nombre del cliente\n- **telefono** → Teléfono\n- **producto_servicio** → Servicio o producto elegido\n- **detalles_producto** → Especificaciones (talla, color, modelo, etc.)\n- **cantidad** → Cantidad de unidades\n- **precio** → Precio unitario\n- **total** → Total a pagar\n- **ciudad** → Ciudad del cliente\n- **direccion** → Dirección de entrega o del cliente\n- **metodo_pago** → Método de pago elegido\n- **notas** → Datos extra (cédula, placa, observaciones)\n- **etapa_actual** → Etapa actual del pipeline (EXACTA)\n- **accion** → Acción a ejecutar (ver tabla abajo)\n- **fecha_cita / hora_cita** → Para citas (YYYY-MM-DD / HH:MM)\n- **tipo_cita** → Tipo de cita o servicio\n- **fecha_reserva / hora_reserva** → Para reservas\n- **tipo_reserva / num_personas** → Para reservas\n- **fecha_entrega** → Para pedidos\n\n### TABLA DE ACCIONES\n\n| Situación | accion | Cuándo usarla |\n|-----------|--------|---------------|\n| Cliente confirma **cita** | \`crear_cita\` | Cuando dice SÍ al resumen |\n| Cliente confirma **pedido/compra** | \`crear_pedido\` | Cuando confirma compra con datos completos |\n| Cliente confirma **reserva** | \`crear_reserva\` | Cuando confirma reserva (mesa, espacio, turno) |\n| Quiere **cambiar** fecha/hora | \`actualizar_cita\` o \`actualizar_reserva\` | Reagendando |\n| Quiere **cancelar** | \`cancelar_cita\` / \`cancelar_reserva\` / \`cancelar_pedido\` | Después de confirmar cancelación |\n| Ya está creado | *(vacío)* | NO repetir crear si ya dice "creada" en memoria |\n\n⚠️ NUNCA pongas \`crear_*\` si la memoria ya muestra que está creado\n⚠️ Siempre incluye fecha y hora al crear o actualizar\n⚠️ Actualiza \`etapa_actual\` en CADA respuesta con la etapa correcta\n\n---\n\n## ⚠️ REGLAS CRÍTICAS\n\n### ❌ NUNCA:\n- Inventar precios, horarios o disponibilidad\n- Confirmar sin tener todos los datos obligatorios\n- Copiar el bloque técnico de disponibilidad al cliente\n- Agendar en días cerrados (verifica el horario configurado)\n- Repetir \`crear_*\` si ya está creado en memoria\n- Enviar mensajes de más de 5 líneas\n\n### ✅ SIEMPRE:\n- Reformular disponibilidad de forma bonita y clara\n- Seguir el flujo paso a paso en orden\n- Pedir datos ANTES de mostrar disponibilidad\n- Confirmar antes de cancelar o reagendar\n- Actualizar \`etapa_actual\` en cada respuesta\n- Incluir el bloque \`<<MEMORY_JSON>>...<<END_MEMORY>>\` al final\n`;

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
        <img src="/bizonne.png" alt="Bizonne" className="w-16 h-16 rounded-xl animate-pulse" />
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/bizonne.png" alt="Bizonne" className="w-14 h-14 rounded-xl shadow-lg" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">Asistente IA</h1>
            <p className="text-[var(--text-muted)]">Configura tu asistente IA</p>
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
            <a href="/ai-config" className="btn-secondary text-sm py-2 flex items-center gap-1.5 bg-violet-500/10 border-violet-500/30 text-violet-400 hover:bg-violet-500/20">
              <Wand2 className="w-4 h-4" />{hasAiConfig ? 'Configurar con IA' : '🔒 Config IA'}
            </a>
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="p-4 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-tertiary)]">
              <div className="flex items-center gap-3">
                <img src="/bizonne.png" alt="Bizonne" className="w-8 h-8 rounded-lg" />
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


          {/* 📍 Cobertura de Domicilio */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-white flex items-center gap-2">
                  📍 Cobertura de Domicilio
                  <span className="text-xs font-normal text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full">Opcional</span>
                </h3>
                <p className="text-sm text-[var(--text-muted)] mt-0.5">
                  Si tu negocio tiene servicio a domicilio, configura el radio de cobertura. La IA detectará automáticamente si el cliente está dentro del área cuando comparta su ubicación por WhatsApp.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Latitud del negocio</label>
                <input
                  type="number" step="0.0001"
                  value={coverageLat}
                  onChange={(e) => setCoverageLat(e.target.value)}
                  placeholder="ej: 4.6189"
                  className="input w-full text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Longitud del negocio</label>
                <input
                  type="number" step="0.0001"
                  value={coverageLon}
                  onChange={(e) => setCoverageLon(e.target.value)}
                  placeholder="ej: -74.1289"
                  className="input w-full text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Radio de cobertura (km)</label>
                <input
                  type="number" step="0.5" min="0.5" max="50"
                  value={coverageRadiusKm}
                  onChange={(e) => setCoverageRadiusKm(e.target.value)}
                  placeholder="ej: 3"
                  className="input w-full text-sm"
                />
              </div>
            </div>
            {(coverageLat || coverageLon || coverageRadiusKm) && (
              <div className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400 flex items-start gap-2">
                <span>✅</span>
                <span>
                  Cobertura activa — Radio de <strong>{coverageRadiusKm || '?'} km</strong> desde ({coverageLat || '?'}, {coverageLon || '?'}).
                  Cuando un cliente comparta su ubicación por WhatsApp, el sistema calculará automáticamente si está dentro del área.
                  {' '}<a href={"https://maps.google.com/?q=" + coverageLat + "," + coverageLon} target="_blank" rel="noreferrer" className="underline hover:text-emerald-300">Ver en Google Maps ↗</a>
                </span>
              </div>
            )}
            {!coverageLat && !coverageLon && (
              <p className="text-xs text-[var(--text-muted)] mt-3 flex items-center gap-1.5">
                <span>💡</span> Para obtener las coordenadas: abre Google Maps, haz clic derecho en la ubicación del negocio y copia las coordenadas.
              </p>
            )}
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
              <p className="text-[var(--text-muted)]">Sube archivos que el asistente enviará automáticamente cuando detecte el trigger en la conversación.</p>
              {/* 📏 Storage indicator — from backend */}
              {(mediaItems.length > 0 || storageInfo) && (
                <div className="mt-3 p-2.5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-[var(--text-muted)]">
                      {mediaItems.length} archivo{mediaItems.length !== 1 ? 's' : ''} · {storageUsedMB.toFixed(1)}MB / {storageLimitMB}MB
                    </span>
                    <span className={`text-xs font-medium ${storagePercent > 80 ? 'text-red-400' : storagePercent > 50 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {storagePercent > 90 ? '🚨 Casi lleno' : storagePercent > 80 ? '⚠️ Poco espacio' : storagePercent > 50 ? '⚡ Moderado' : '✓ OK'}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${storagePercent > 80 ? 'bg-red-500' : storagePercent > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(storagePercent, 100)}%` }} />
                  </div>
                </div>
              )}
              {uploadingMedia && (
                <div className="mt-2 flex items-center gap-2 text-xs text-blue-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Subiendo y comprimiendo...
                </div>
              )}
            </div>

            {/* Upload Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <label className="card glass-hover cursor-pointer text-center py-8 border-2 border-dashed border-[var(--border-primary)] hover:border-blue-500/50">
                <input type="file" accept="image/*" className="hidden" onChange={(e) => handleMediaUpload(e, 'image')} />
                <div className="w-16 h-16 rounded-2xl bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
                  <Image className="w-8 h-8 text-blue-400" />
                </div>
                <h4 className="font-semibold text-white mb-1">Imágenes</h4>
                <p className="text-xs text-[var(--text-muted)]">Catálogo, productos, local</p>
                <p className="text-xs text-blue-400 mt-2">Máx 5MB</p>
              </label>

              {/* 📂 CATÁLOGO: Múltiples imágenes por trigger */}
              <div onClick={createCatalog} className="card glass-hover cursor-pointer text-center py-8 border-2 border-dashed border-[var(--border-primary)] hover:border-emerald-500/50">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-8 h-8 text-emerald-400" />
                </div>
                <h4 className="font-semibold text-white mb-1">Catálogo</h4>
                <p className="text-xs text-[var(--text-muted)]">Hasta 10 imágenes</p>
                <p className="text-xs text-emerald-400 mt-2">Envío múltiple</p>
              </div>

              <label className="card glass-hover cursor-pointer text-center py-8 border-2 border-dashed border-[var(--border-primary)] hover:border-purple-500/50">
                <input type="file" accept="video/*" className="hidden" onChange={(e) => handleMediaUpload(e, 'video')} />
                <div className="w-16 h-16 rounded-2xl bg-purple-500/20 flex items-center justify-center mx-auto mb-4">
                  <Video className="w-8 h-8 text-purple-400" />
                </div>
                <h4 className="font-semibold text-white mb-1">Videos</h4>
                <p className="text-xs text-[var(--text-muted)]">Tutoriales, demos, tours</p>
                <p className="text-xs text-purple-400 mt-2">Máx 15MB</p>
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

            {/* 🛒 Order Bump: Productos del catálogo */}
            <div className="p-3 rounded-xl border border-emerald-500/15 bg-emerald-500/5 mb-4">
              <div className="flex items-center gap-3">
                <span className="text-lg">📦</span>
                <div className="flex-1">
                  <p className="text-xs text-gray-400">¿Necesitas más productos en tu catálogo? Amplía tu límite.</p>
                </div>
                <a href="/subscription#addons" className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all whitespace-nowrap">
                  +10 Productos — $20 USD
                </a>
              </div>
            </div>

            {/* Media Grid */}
            {mediaItems.length > 0 ? (
              <div className="space-y-4">
                {mediaItems.map((item, index) => (
                  <div key={item.id} className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                    {item.type === 'catalog' ? (
                      /* ===== 📂 CATÁLOGO: Múltiples imágenes ===== */
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                              <FileText className="w-4 h-4 text-emerald-400" />
                            </div>
                            <input type="text" value={item.name || ''} 
                              onChange={(e) => updateMediaItem(index, 'name', e.target.value)}
                              className="bg-transparent border-none text-white font-medium text-sm focus:outline-none" 
                              placeholder="Nombre del catálogo" />
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                              catálogo · {(item.images || []).length}/10 imgs
                            </span>
                          </div>
                          <button onClick={() => removeMedia(index)} className="btn-icon text-red-400 hover:bg-red-500/20">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Imágenes del catálogo */}
                        <div className="flex flex-wrap gap-2">
                          {(item.images || []).map((img: any) => (
                            <div key={img.id} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-[var(--border-primary)]">
                              <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                              <button onClick={() => removeImageFromCatalog(index, img.id)}
                                className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <X className="w-3 h-3 text-white" />
                              </button>
                              <p className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] text-white text-center py-0.5 truncate px-1">{img.name}</p>
                            </div>
                          ))}
                          {(item.images || []).length < 10 && (
                            <label className="w-20 h-20 rounded-lg border-2 border-dashed border-[var(--border-primary)] hover:border-emerald-500/50 flex flex-col items-center justify-center cursor-pointer transition-all">
                              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addImageToCatalog(index, e)} />
                              <Plus className="w-5 h-5 text-[var(--text-muted)]" />
                              <span className="text-[8px] text-[var(--text-muted)] mt-0.5">Agregar</span>
                            </label>
                          )}
                        </div>

                        {/* Trigger + Caption */}
                        <input type="text" placeholder="🔑 Triggers: catalogo, colores, productos (separados por coma)"
                          value={item.trigger || ''} onChange={(e) => updateMediaItem(index, 'trigger', e.target.value)}
                          className="input text-sm w-full" />
                        <input type="text" placeholder="💬 Caption opcional (texto que acompaña las imágenes)"
                          value={item.caption || ''} onChange={(e) => updateMediaItem(index, 'caption', e.target.value)}
                          className="input text-sm w-full" />
                        {!item.trigger && (
                          <p className="text-xs text-yellow-400 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />Define un trigger para activar el envío automático
                          </p>
                        )}
                        {(item.images || []).length === 0 && (
                          <p className="text-xs text-yellow-400 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />Agrega al menos una imagen al catálogo
                          </p>
                        )}
                      </div>
                    ) : (
                      /* ===== ARCHIVO INDIVIDUAL (imagen, video, audio) ===== */
                      <div className="flex items-start gap-4">
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
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-[var(--text-muted)] border-2 border-dashed border-[var(--border-primary)] rounded-xl">
                <Image className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Sin archivos multimedia</p>
                <p className="text-sm">Sube archivos para que el asistente los envíe automáticamente</p>
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
              <li>• <strong className="text-emerald-400">Catálogo:</strong> Agrupa hasta 10 imágenes con un solo trigger. Se envían todas en secuencia cuando el cliente activa la palabra clave</li>
              <li>• La IA responderá primero con texto, y luego enviará el archivo o catálogo</li>
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
                  <p className="text-[var(--text-muted)]">El asistente analiza conversaciones reales y sugiere mejoras</p>
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
                <p className="text-[var(--text-muted)]">El asistente responde con notas de voz de IA</p>
              </div>
            </div>

            <div className="space-y-4">
              {/* API Key */}
              <div>
                <label className="input-label">Tu API Key de ElevenLabs</label>
                <input type="password" value={elevenLabsKey} onChange={(e) => setElevenLabsKey(e.target.value)}
                  placeholder="sk_..." className="input w-full font-mono" />
              </div>

              {/* Voice ID - MANUAL (principal) */}
              <div>
                <label className="input-label">Voice ID</label>
                <div className="flex gap-3">
                  <input type="text" value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)}
                    placeholder="Pega tu Voice ID... (ej: EXAVITQu4vr4xnSDxMaL)" className="input flex-1 font-mono text-sm" />
                  {selectedVoice && elevenLabsKey && (
                    <button onClick={() => previewVoice(selectedVoice)} disabled={testingVoice} className="btn-secondary"
                      title="Escuchar vista previa">
                      {testingVoice ? <div className="loading-spinner w-4 h-4" /> : <Play className="w-4 h-4" />}
                      Probar
                    </button>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Ve a <a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">ElevenLabs → Voices</a> → 
                  clic en la voz → "Copy Voice ID"
                </p>
              </div>

              {/* O cargar voces automáticamente */}
              <div className="border-t border-[var(--border-primary)] pt-4">
                <button onClick={testElevenLabs} disabled={!elevenLabsKey || testingVoice} className="btn-secondary w-full">
                  {testingVoice ? <div className="loading-spinner w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                  O cargar mis voces automáticamente
                </button>
              </div>

              {elevenLabsVoices.length > 0 && (
                <div>
                  <label className="input-label">Selecciona de tus voces</label>
                  <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} className="input w-full">
                    <option value="">-- Selecciona una voz --</option>
                    {elevenLabsVoices.map((voice) => (
                      <option key={voice.voice_id} value={voice.voice_id}>
                        {voice.name} {voice.labels?.accent ? `(${voice.labels.accent})` : ''} {voice.labels?.gender ? `- ${voice.labels.gender}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Toggle activar */}
              {selectedVoice && elevenLabsKey && (
                <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                  <div>
                    <h4 className="font-medium text-white">Activar respuestas de voz</h4>
                    <p className="text-sm text-[var(--text-muted)]">La IA decidirá cuándo responder con voz según el contexto</p>
                  </div>
                  <button onClick={() => setVoiceEnabled(!voiceEnabled)}
                    className={`relative w-16 h-8 rounded-full transition-all ${voiceEnabled ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-primary)]'}`}>
                    <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all ${voiceEnabled ? 'left-9' : 'left-1'}`} />
                  </button>
                </div>
              )}

              {voiceEnabled && selectedVoice && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <h4 className="font-medium text-emerald-400 mb-2">🔊 Voz IA Activa</h4>
                  <p className="text-sm text-[var(--text-muted)] mb-3">
                    Controla cuándo la IA responde con voz desde tu contexto:
                  </p>
                  <div className="space-y-2 text-xs text-[var(--text-muted)] bg-black/20 rounded-lg p-3 font-mono">
                    <p className="text-emerald-400">// Ejemplo en tu contexto:</p>
                    <p>- Saluda siempre con nota de voz</p>
                    <p>- Usa voz al confirmar pedidos</p>
                    <p>- NO uses voz para datos técnicos o links</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card bg-purple-500/5 border-purple-500/20">
            <h4 className="font-semibold text-purple-400 mb-3 flex items-center gap-2"><Key className="w-4 h-4" />Cómo configurar</h4>
            <ol className="text-sm text-[var(--text-muted)] space-y-2">
              <li>1. Ve a <a href="https://elevenlabs.io/app/developers/api-keys" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">elevenlabs.io → API Keys</a> y copia tu clave</li>
              <li>2. Ve a <a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">elevenlabs.io → Voices</a> y copia el Voice ID</li>
              <li>3. Pégalos arriba, activa el toggle y dale "Guardar Todo"</li>
              <li>4. Plan gratis: 10,000 caracteres/mes (~10 min de audio)</li>
            </ol>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-center py-6">
        <div className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white/5 border border-white/10">
          <img src="/bizonne.png" alt="Bizonne" className="w-8 h-8 rounded-lg" />
          <span className="text-sm text-[var(--text-muted)]">Powered by <span className="text-white font-semibold">Bizonne</span></span>
        </div>
      </div>
    </div>
  );
}

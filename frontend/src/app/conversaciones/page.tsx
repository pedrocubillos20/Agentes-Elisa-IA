'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, Search, Send, X,
  Megaphone, PauseCircle, PlayCircle, Paperclip, Image, Mic, FileText, Zap, Trash2
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// Helper: Validar si un recipientId es un número real de WhatsApp (7-13 dígitos)
const isValidWhatsAppPhone = (recipientId: string): boolean => {
  if (!recipientId) return false;
  const clean = recipientId.replace(/@c\.us|@g\.us/g, '').replace(/\D/g, '');
  return clean.length >= 7 && clean.length <= 13;
};

const STAGE_COLORS: Record<string, string> = {
  blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  cyan: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  green: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  orange: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  red: 'bg-red-500/20 text-red-400 border-red-500/30',
  purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  pink: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
};

// ❌ Sin etapas por defecto — se cargan de la base de conocimiento de cada línea
const DEFAULT_STAGES: any[] = [];

export default function ConversacionesPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStage, setFilterStage] = useState('all');
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [funnelStages, setFunnelStages] = useState<any[]>(DEFAULT_STAGES);
  const [showMassMessage, setShowMassMessage] = useState(false);
  const [massText, setMassText] = useState('');
  const [sendingMass, setSendingMass] = useState(false);
  const [massSentCount, setMassSentCount] = useState(0);
  const [massTotal, setMassTotal] = useState(0);
  const [massMediaFile, setMassMediaFile] = useState<File | null>(null);
  const [massMediaPreview, setMassMediaPreview] = useState<string | null>(null);
  const [groupSettingsLocal, setGroupSettingsLocal] = useState<any>(null);
  const [fixingLids, setFixingLids] = useState(false);
  const [lidFixResult, setLidFixResult] = useState<any>(null);
  // 📎 Chat media
  const [chatMediaFile, setChatMediaFile] = useState<File | null>(null);
  const [chatMediaPreview, setChatMediaPreview] = useState<string | null>(null);
  // ⚡ Quick replies
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [editingQuickReplies, setEditingQuickReplies] = useState(false);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [newQuickReply, setNewQuickReply] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const massFileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const selectedConvRef = useRef<any>(null); // Ref para polling de mensajes
  const lastMessageCountRef = useRef<number>(0);

  const getLineId = () => localStorage.getItem('selectedLineId') || '';

  const getStageColor = (stageId: string) => {
    const stage = funnelStages.find(s => s.id === stageId);
    return STAGE_COLORS[stage?.color || 'blue'] || STAGE_COLORS.blue;
  };

  // Mantener ref sincronizado con state
  useEffect(() => {
    selectedConvRef.current = selectedConv;
  }, [selectedConv]);

  // 🔥 CARGA INICIAL: stages + quick-stage-sync (solo una vez)
  const initialLoadDone = useRef(false);
  const isFetchingRef = useRef(false);
  
  useEffect(() => {
    // ⚡ INSTANT LOAD: Mostrar conversaciones cacheadas mientras carga
    try {
      const cachedConvs = localStorage.getItem('bizonne_convs_cache');
      if (cachedConvs) {
        const parsed = JSON.parse(cachedConvs);
        if (parsed?.length) { setConversations(parsed); setLoading(false); }
      }
    } catch {}

    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      // Stage sync y stages solo al montar (NO en polling)
      const token = localStorage.getItem('token');
      const lineId = getLineId();
      fetch(`${API_URL}/api/whatsapp/quick-stage-sync`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId })
      }).catch(() => {});
      fetch(`${API_URL}/api/stages?lineId=${lineId}`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.stages?.length) setFunnelStages(d.stages); })
        .catch(() => {});
    }
    // Polling de conversaciones (solo lista, sin stages ni sync)
    fetchConversations();
    const interval = setInterval(fetchConversations, 5000); // 5s en vez de 2s
    return () => clearInterval(interval);
  }, []);

  // Re-cargar stages cuando cambia la línea
  useEffect(() => {
    const onLineChanged = () => {
      setLoading(true);
      setConversations([]);
      setSelectedConv(null);
      setMessages([]);
      const token = localStorage.getItem('token');
      const lineId = getLineId();
      fetch(`${API_URL}/api/stages?lineId=${lineId}`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.stages?.length) setFunnelStages(d.stages); })
        .catch(() => {});
      fetchConversations();
    };
    window.addEventListener('lineChanged', onLineChanged);
    return () => window.removeEventListener('lineChanged', onLineChanged);
  }, []);

  // Cargar mensajes cuando se selecciona una conversación
  useEffect(() => {
    if (selectedConv) {
      setMessages([]); // ✅ Limpiar mensajes inmediatamente al cambiar de conversación
      setLoadingMessages(true); // ✅ Mostrar loading
      lastMessageCountRef.current = 0;
      fetchMessages(selectedConv.id);
    }
    // Load group settings if it's a group
    if (selectedConv?.isGroup) {
      const gs = (selectedConv.groupSettings as any) || { aiEnabled: true, respondTo: 'all', triggerWords: [] };
      setGroupSettingsLocal(gs);
    } else {
      setGroupSettingsLocal(null);
    }
  }, [selectedConv?.id]);

  // 🔥 POLLING DE MENSAJES — refresca cada 3s la conversación activa
  useEffect(() => {
    const pollMessages = async () => {
      const conv = selectedConvRef.current;
      if (!conv) return;
      
      const convIdBefore = conv.id; // ✅ Guardar ID antes del fetch
      const token = localStorage.getItem('token');
      try {
        const res = await fetch(`${API_URL}/api/conversations/${conv.id}/messages?limit=100`, { 
          headers: { 'Authorization': `Bearer ${token}` } 
        });
        // ✅ Verificar que no cambió de conversación durante el fetch
        if (selectedConvRef.current?.id !== convIdBefore) return;
        if (res.ok) {
          const data = await res.json();
          const newMsgs = data.messages || [];
          setMessages(prev => {
            const prevLast = prev[prev.length - 1];
            const newLast = newMsgs[newMsgs.length - 1];
            if (prev.length !== newMsgs.length || 
                prevLast?.id !== newLast?.id || 
                prevLast?.content !== newLast?.content) {
              lastMessageCountRef.current = newMsgs.length;
              return newMsgs;
            }
            return prev;
          });
        }
      } catch {}
    };

    const msgInterval = setInterval(pollMessages, 3000);
    return () => clearInterval(msgInterval);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 📋 Fetch SOLO conversaciones (sin stages ni sync)
  const fetchConversations = async () => {
    if (isFetchingRef.current) return; // Guard: no concurrent fetches
    isFetchingRef.current = true;
    const token = localStorage.getItem('token');
    try {
      const lineId = getLineId();
      const res = await fetch(`${API_URL}/api/conversations?lineId=${lineId}`, { 
        headers: { 'Authorization': `Bearer ${token}` } 
      });
      if (res.ok) {
        const data = await res.json();
        const convs = data.conversations || [];
        setConversations(convs);
        // ⚡ Cache para instant load
        try { localStorage.setItem('bizonne_convs_cache', JSON.stringify(convs.slice(0, 50))); } catch {}
        
        // Mantener selectedConv sincronizado
        const currentSelected = selectedConvRef.current;
        if (currentSelected) {
          const updated = convs.find((c: any) => c.id === currentSelected.id);
          if (updated) {
            if (updated.lastMessage !== currentSelected.lastMessage || 
                updated.aiPaused !== currentSelected.aiPaused ||
                updated.stageId !== currentSelected.stageId ||
                updated.recipientName !== currentSelected.recipientName) {
              setSelectedConv(updated);
            }
          }
        }
      }
    } catch {}
    finally { 
      setLoading(false); 
      isFetchingRef.current = false;
    }
  };

  const fetchMessages = async (convId: string) => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/conversations/${convId}/messages?limit=100`, { headers: { 'Authorization': `Bearer ${token}` } });
      // ✅ Verificar que seguimos en la misma conversación
      if (selectedConvRef.current?.id !== convId) return;
      if (res.ok) setMessages((await res.json()).messages || []);
    } catch {}
    finally { setLoadingMessages(false); }
  };

  // ====================================================
  // ✉️ ENVIAR MENSAJE — Con whatsappLineId correcto + media + optimistic
  // ====================================================
  const sendMessage = async () => {
    if (!selectedConv || (!newMessage.trim() && !chatMediaFile) || sending) return;
    setSending(true);
    const token = localStorage.getItem('token');
    const messageText = newMessage;
    
    // Convertir archivo a base64 si hay media
    let mediaUrl: string | null = null;
    let mediaType: string | null = null;
    
    if (chatMediaFile) {
      mediaUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(chatMediaFile);
      });
      if (chatMediaFile.type.startsWith('image/')) mediaType = 'image';
      else if (chatMediaFile.type.startsWith('audio/')) mediaType = 'audio';
      else if (chatMediaFile.type.startsWith('video/')) mediaType = 'video';
      else mediaType = 'document';
    }

    // 🔥 MOSTRAR MENSAJE INMEDIATAMENTE en el chat (optimistic update)
    const optimisticMsg = {
      id: `temp-${Date.now()}`,
      content: messageText || (mediaType === 'image' ? '📷 [Imagen]' : mediaType === 'audio' ? '🎤 [Audio]' : '📎 [Archivo]'),
      fromMe: true,
      timestamp: new Date().toISOString(),
      role: 'assistant',
      ...(mediaType === 'image' && chatMediaPreview ? { mediaType: 'image', mediaUrl: chatMediaPreview } : {}),
      ...(mediaType && mediaType !== 'image' ? { mediaType } : {})
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setNewMessage('');
    setChatMediaFile(null);
    setChatMediaPreview(null);
    if (chatFileInputRef.current) chatFileInputRef.current.value = '';

    try {
      const res = await fetch(`${API_URL}/api/whatsapp/send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          to: selectedConv.recipientId, 
          message: messageText || null, 
          whatsappLineId: getLineId(),
          ...(mediaUrl && { mediaUrl, mediaType })
        })
      });
      if (res.ok) {
        setTimeout(() => fetchMessages(selectedConv.id), 1500);
      } else {
        setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
        setNewMessage(messageText);
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
      setNewMessage(messageText);
    }
    finally { setSending(false); }
  };

  // 📎 Chat media handlers
  const handleChatFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setChatMediaFile(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setChatMediaPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setChatMediaPreview(null);
    }
  };

  const removeChatMedia = () => {
    setChatMediaFile(null);
    setChatMediaPreview(null);
    if (chatFileInputRef.current) chatFileInputRef.current.value = '';
  };

  // ⚡ Quick Replies — Guardadas en localStorage por línea
  const qrKey = `quickReplies_${getLineId() || 'default'}`;
  
  useEffect(() => {
    try {
      const saved = localStorage.getItem(qrKey);
      if (saved) setQuickReplies(JSON.parse(saved));
      else setQuickReplies(['¡Hola! ¿En qué puedo ayudarte?', 'Gracias por tu compra 🎉', 'Déjame verificar y te confirmo', 'Listo, tu pedido ha sido enviado ✅', '¿Necesitas algo más?']);
    } catch { setQuickReplies([]); }
  }, [qrKey]);

  const saveQuickReplies = (replies: string[]) => {
    setQuickReplies(replies);
    localStorage.setItem(qrKey, JSON.stringify(replies));
  };

  const addQuickReply = () => {
    if (!newQuickReply.trim()) return;
    saveQuickReplies([...quickReplies, newQuickReply.trim()]);
    setNewQuickReply('');
  };

  const removeQuickReply = (index: number) => {
    saveQuickReplies(quickReplies.filter((_, i) => i !== index));
  };

  const useQuickReply = (text: string) => {
    setNewMessage(text);
    setShowQuickReplies(false);
  };

  const toggleAIPause = async () => {
    if (!selectedConv) return;
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/conversations/${selectedConv.id}/ai-pause`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: !selectedConv.aiPaused })
      });
      setSelectedConv({ ...selectedConv, aiPaused: !selectedConv.aiPaused });
      fetchConversations();
    } catch {}
  };

  // 🗑️ Eliminar conversación
  const deleteConversation = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/conversations/${deleteConfirm.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setConversations(prev => prev.filter(c => c.id !== deleteConfirm.id));
        if (selectedConv?.id === deleteConfirm.id) {
          setSelectedConv(null);
          setMessages([]);
        }
        setDeleteConfirm(null);
      }
    } catch {} finally { setDeleting(false); }
  };

  // 👥 Actualizar configuración de grupo
  const updateGroupSettings = async (updates: any) => {
    if (!selectedConv?.isGroup) return;
    const token = localStorage.getItem('token');
    const newSettings = { ...groupSettingsLocal, ...updates };
    setGroupSettingsLocal(newSettings);
    try {
      await fetch(`${API_URL}/api/conversations/${selectedConv.id}/group-settings`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
      setSelectedConv({ ...selectedConv, groupSettings: newSettings });
    } catch {}
  };

  // ====================================================
  // 📢 ENVÍO MASIVO — Usa /send-bulk con delays en backend + media
  // ====================================================
  const sendMassMessage = async () => {
    if ((!massText.trim() && !massMediaFile) || filterStage === 'all') return;
    setSendingMass(true);
    const token = localStorage.getItem('token');
    const targets = conversations.filter(c => c.stage === filterStage);
    setMassTotal(targets.length);
    setMassSentCount(0);

    try {
      // Convertir archivo a base64 si hay media
      let mediaUrl: string | null = null;
      let mediaType: string | null = null;
      
      if (massMediaFile) {
        mediaUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(massMediaFile);
        });
        
        if (massMediaFile.type.startsWith('image/')) mediaType = 'image';
        else if (massMediaFile.type.startsWith('audio/')) mediaType = 'audio';
        else if (massMediaFile.type.startsWith('video/')) mediaType = 'video';
        else mediaType = 'document';
      }

      const contacts = targets.map(c => ({
        phone: c.recipientId,
        name: c.recipientName || c.recipientId,
        conversationId: c.id
      }));

      // 🚀 ENVIAR TODO AL BACKEND — El backend maneja delays de 3s entre cada envío
      const res = await fetch(`${API_URL}/api/whatsapp/send-bulk`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contacts,
          message: massText || null,
          whatsappLineId: getLineId(),  // ✅ FIX: whatsappLineId correcto
          ...(mediaUrl && { mediaUrl, mediaType })
        })
      });

      if (res.ok) {
        // Simular progreso mientras el backend envía en background
        let count = 0;
        const progressInterval = setInterval(() => {
          count += 1;
          setMassSentCount(Math.min(count, targets.length));
          if (count >= targets.length) clearInterval(progressInterval);
        }, 3500);

        // Esperar tiempo estimado y cerrar
        setTimeout(() => {
          clearInterval(progressInterval);
          setMassSentCount(targets.length);
          alert(`✅ Mensaje masivo enviado a ${targets.length} contactos`);
          setSendingMass(false);
          setShowMassMessage(false);
          setMassText('');
          setMassMediaFile(null);
          setMassMediaPreview(null);
          setMassSentCount(0);
          setMassTotal(0);
          fetchConversations();
        }, targets.length * 3500 + 2000);
      } else {
        throw new Error('Error al enviar');
      }
    } catch (e) {
      alert('❌ Error al enviar mensaje masivo');
      setSendingMass(false);
    }
  };

  // 📎 Manejar selección de archivo para masivo
  const handleMassFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMassMediaFile(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setMassMediaPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setMassMediaPreview(null);
    }
  };

  const removeMassMedia = () => {
    setMassMediaFile(null);
    setMassMediaPreview(null);
    if (massFileInputRef.current) massFileInputRef.current.value = '';
  };

  // 🔑 Fix LID numbers - migrate to real phone numbers via WAHA
  const invalidCount = conversations.filter(c => !c.isGroup && !isValidWhatsAppPhone(c.recipientId)).length;

  const fixLidNumbers = async () => {
    setFixingLids(true);
    setLidFixResult(null);
    try {
      const token = localStorage.getItem('token');
      const r = await fetch(`${API_URL}/api/whatsapp/fix-lid-numbers`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      const data = await r.json();
      setLidFixResult(data);
      if (data.fixed > 0) {
        // Reload conversations after fix
        setTimeout(() => window.location.reload(), 2000);
      }
    } catch (e: any) {
      setLidFixResult({ error: e.message });
    }
    setFixingLids(false);
  };

  const filteredConversations = conversations.filter(c => {
    const matchSearch = !searchTerm || c.recipientName?.toLowerCase().includes(searchTerm.toLowerCase()) || c.recipientId?.includes(searchTerm);
    const matchStage = filterStage === 'all' || c.stage === filterStage;
    return matchSearch && matchStage;
  });

  const stageStats = funnelStages.map(s => ({
    ...s,
    count: conversations.filter(c => c.stage === s.id).length
  }));

  if (loading) {
    return (
      <div className="h-[calc(100vh-120px)] flex items-center justify-center">
        <div className="loading-spinner w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col gap-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-6 h-6 text-[var(--accent-primary)]" />
          <div>
            <h1 className="text-xl font-bold text-white">Conversaciones</h1>
            <p className="text-xs text-[var(--text-muted)]">{conversations.length} chats{invalidCount > 0 ? ` · ${invalidCount} con número inválido` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {invalidCount > 0 && (
            <button 
              onClick={fixLidNumbers} 
              disabled={fixingLids}
              className="flex items-center gap-1.5 py-1.5 px-3 text-xs rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30 transition-all disabled:opacity-50"
              title="Corregir números inválidos consultando WAHA Plus"
            >
              {fixingLids ? <span className="w-3.5 h-3.5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" /> : <span>⚠️</span>}
              {fixingLids ? 'Consultando WAHA...' : `Reparar ${invalidCount} números`}
            </button>
          )}
          {lidFixResult && (
            <div className={`text-xs px-2 py-1 rounded ${lidFixResult.fixed > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
              {lidFixResult.error ? `Error: ${lidFixResult.error}` : `${lidFixResult.fixed}/${lidFixResult.invalid} corregidos`}
            </div>
          )}
          <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)} className="input py-1.5 px-3 text-sm bg-[var(--bg-secondary)]">
            <option value="all">📊 Todas ({conversations.length})</option>
            {stageStats.map(stage => (
              <option key={stage.id} value={stage.id}>{stage.label} ({stage.count})</option>
            ))}
          </select>
          <button onClick={() => setShowMassMessage(true)} disabled={filterStage === 'all'} className="btn-secondary py-1.5 px-3 text-sm disabled:opacity-50" title={filterStage === 'all' ? 'Selecciona una etapa primero' : 'Mensaje masivo'}>
            <Megaphone className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex gap-3 min-h-0 overflow-hidden">
        {/* Lista */}
        <div className="w-64 flex-shrink-0 flex flex-col bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] overflow-hidden">
          <div className="p-2 border-b border-[var(--border-primary)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input type="text" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-1.5 pl-8 pr-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredConversations.map((conv) => (
              <div key={conv.id} onClick={() => setSelectedConv(conv)} className={`p-2.5 border-b border-[var(--border-primary)] cursor-pointer hover:bg-white/5 transition-all ${selectedConv?.id === conv.id ? 'bg-[var(--accent-primary)]/10 border-l-2 border-l-[var(--accent-primary)]' : ''}`}>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-[var(--accent-primary)]/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-[var(--accent-primary)]">{conv.recipientName?.[0] || '?'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="font-medium text-white text-sm truncate">{conv.recipientName || conv.groupName || 'Sin nombre'}</p>
                      {conv.isGroup && <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1 rounded">👥</span>}
                      {!conv.isGroup && !isValidWhatsAppPhone(conv.recipientId) && <span title="Número inválido - no puede recibir mensajes masivos" className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1 rounded">⚠️</span>}
                      {conv.aiPaused && <PauseCircle className="w-3 h-3 text-yellow-400 flex-shrink-0" />}
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)] truncate">{conv.lastMessage || 'Sin mensajes'}</p>
                    {conv.stage && (
                      <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] border ${getStageColor(conv.stage)}`}>
                        {funnelStages.find(s => s.id === conv.stage)?.label || conv.stage}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {filteredConversations.length === 0 && <div className="p-4 text-center text-[var(--text-muted)] text-sm">No hay conversaciones</div>}
          </div>
        </div>

        {/* Chat */}
        <div className="flex-1 flex flex-col bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] overflow-hidden min-w-0">
          {selectedConv ? (
            <>
              <div className="p-3 border-b border-[var(--border-primary)] flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-[var(--accent-primary)]/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-[var(--accent-primary)]">{selectedConv.recipientName?.[0] || '?'}</span>
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-white text-sm truncate">{selectedConv.recipientName || selectedConv.recipientId}</h3>
                    <p className="text-[10px] text-[var(--text-muted)]">+{selectedConv.recipientId?.replace('@c.us', '')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {selectedConv.stage && (
                    <span className={`px-2 py-1 rounded text-xs border ${getStageColor(selectedConv.stage)}`}>
                      {funnelStages.find(s => s.id === selectedConv.stage)?.label || selectedConv.stage}
                    </span>
                  )}
                  <button onClick={toggleAIPause} className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${selectedConv.aiPaused ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                    {selectedConv.aiPaused ? <PauseCircle className="w-3 h-3" /> : <PlayCircle className="w-3 h-3" />}
                    {selectedConv.aiPaused ? 'Pausada' : 'Activa'}
                  </button>
                  <button onClick={() => setDeleteConfirm(selectedConv)} className="px-2 py-1 rounded text-xs flex items-center gap-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors" title="Eliminar conversación">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {loadingMessages && messages.length === 0 && (
                  <div className="flex-1 flex items-center justify-center h-full">
                    <div className="loading-spinner w-6 h-6" />
                  </div>
                )}
                {messages.map((msg, idx) => (
                  <div key={msg.id || idx} className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${msg.fromMe ? 'bg-[var(--accent-primary)] text-white rounded-br-sm' : 'bg-[var(--bg-tertiary)] text-white rounded-bl-sm'}`}>
                      {msg.mediaType === 'image' && msg.mediaUrl && <img src={msg.mediaUrl} alt="" className="max-w-[200px] rounded-lg mb-1" />}
                      {msg.mediaType === 'audio' && (
                        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-black/20 mb-1">
                          <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs">🎤</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <div className="flex gap-[2px] items-end h-3">
                                {[3,5,7,4,6,8,5,7,3,5,6,4,7,5,3].map((h,i) => (
                                  <div key={i} className="w-[2px] rounded-full bg-emerald-400/60" style={{height: `${h * 1.5}px`}} />
                                ))}
                              </div>
                              <span className="text-[9px] opacity-60 ml-1">Audio</span>
                            </div>
                            {msg.content && !msg.content.includes('[Audio') && (
                              <p className="text-[9px] text-emerald-400/80 mt-0.5">✨ Transcrito por IA</p>
                            )}
                          </div>
                        </div>
                      )}
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      <p className={`text-[9px] mt-1 ${msg.fromMe ? 'text-white/60' : 'text-[var(--text-muted)]'}`}>
                        {new Date(msg.timestamp).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-3 border-t border-[var(--border-primary)] flex-shrink-0">
                <input ref={chatFileInputRef} type="file" accept="image/*,audio/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx" onChange={handleChatFileSelect} className="hidden" />
                
                {/* 📎 Media preview */}
                {chatMediaFile && (
                  <div className="flex items-center gap-2 p-2 mb-2 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-primary)]">
                    {chatMediaPreview ? (
                      <img src={chatMediaPreview} alt="" className="w-12 h-12 rounded object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-[var(--accent-primary)]/20 flex items-center justify-center">
                        {chatMediaFile.type.startsWith('audio/') ? <Mic className="w-4 h-4 text-[var(--accent-primary)]" /> : <FileText className="w-4 h-4 text-[var(--accent-primary)]" />}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white truncate">{chatMediaFile.name}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">{(chatMediaFile.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <button onClick={removeChatMedia} className="p-1 hover:bg-white/10 rounded"><X className="w-4 h-4 text-red-400" /></button>
                  </div>
                )}

                {/* ⚡ Quick Replies dropdown */}
                {showQuickReplies && (
                  <div className="mb-2 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg p-2 max-h-[200px] overflow-y-auto">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-[var(--text-muted)]">⚡ Respuestas rápidas</span>
                      <button onClick={() => setEditingQuickReplies(!editingQuickReplies)} className="text-[10px] text-[var(--accent-primary)] hover:underline">
                        {editingQuickReplies ? 'Listo' : 'Editar'}
                      </button>
                    </div>
                    {quickReplies.map((qr, i) => (
                      <div key={i} className="flex items-center gap-1 group">
                        <button onClick={() => useQuickReply(qr)} className="flex-1 text-left text-xs text-white px-2 py-1.5 rounded hover:bg-white/10 transition truncate">
                          {qr}
                        </button>
                        {editingQuickReplies && (
                          <button onClick={() => removeQuickReply(i)} className="p-0.5 hover:bg-red-500/20 rounded"><X className="w-3 h-3 text-red-400" /></button>
                        )}
                      </div>
                    ))}
                    {editingQuickReplies && (
                      <div className="flex gap-1 mt-2 pt-2 border-t border-[var(--border-primary)]">
                        <input value={newQuickReply} onChange={(e) => setNewQuickReply(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && addQuickReply()}
                          placeholder="Nueva respuesta..." className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded px-2 py-1 text-xs text-white placeholder-[var(--text-muted)] focus:outline-none" />
                        <button onClick={addQuickReply} className="px-2 py-1 bg-[var(--accent-primary)] rounded text-xs text-white">+</button>
                      </div>
                    )}
                  </div>
                )}

                {/* Input row: media buttons + quick replies + text + send */}
                <div className="flex items-center gap-1.5">
                  {/* Media buttons */}
                  <button onClick={() => { if (chatFileInputRef.current) { chatFileInputRef.current.accept = 'image/*'; chatFileInputRef.current.click(); } }}
                    className="p-2 hover:bg-white/10 rounded-lg transition" title="Imagen">
                    <Image className="w-4 h-4 text-[var(--text-muted)]" />
                  </button>
                  <button onClick={() => { if (chatFileInputRef.current) { chatFileInputRef.current.accept = 'audio/*'; chatFileInputRef.current.click(); } }}
                    className="p-2 hover:bg-white/10 rounded-lg transition" title="Audio">
                    <Mic className="w-4 h-4 text-[var(--text-muted)]" />
                  </button>
                  <button onClick={() => { if (chatFileInputRef.current) { chatFileInputRef.current.accept = '*/*'; chatFileInputRef.current.click(); } }}
                    className="p-2 hover:bg-white/10 rounded-lg transition" title="Archivo">
                    <Paperclip className="w-4 h-4 text-[var(--text-muted)]" />
                  </button>
                  <button onClick={() => setShowQuickReplies(!showQuickReplies)}
                    className={`p-2 hover:bg-white/10 rounded-lg transition ${showQuickReplies ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' : ''}`} title="Respuestas rápidas">
                    <Zap className="w-4 h-4 text-[var(--text-muted)]" />
                  </button>

                  <div className="h-5 w-px bg-[var(--border-primary)]" />

                  {/* Text input */}
                  <input type="text" placeholder="Escribe un mensaje..." value={newMessage} onChange={(e) => setNewMessage(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && sendMessage()} className="flex-1 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
                  <button onClick={sendMessage} disabled={sending || (!newMessage.trim() && !chatMediaFile)} className="btn-primary px-4 py-2 disabled:opacity-50">
                    {sending ? <div className="loading-spinner w-4 h-4" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)]">
              <MessageSquare className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">Selecciona una conversación</p>
            </div>
          )}
        </div>

        {/* Panel info */}
        {selectedConv && (
          <div className="w-56 flex-shrink-0 hidden xl:flex flex-col bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] p-3 gap-3 overflow-y-auto">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-[var(--accent-primary)]/20 flex items-center justify-center mb-2">
                <span className="text-lg font-bold text-[var(--accent-primary)]">{selectedConv.recipientName?.[0] || selectedConv.groupName?.[0] || '?'}</span>
              </div>
              <h4 className="font-semibold text-white text-sm">{selectedConv.groupName || selectedConv.recipientName}</h4>
              <p className="text-[10px] text-[var(--text-muted)]">
                {selectedConv.isGroup ? '👥 Grupo' : `+${selectedConv.recipientId?.replace('@c.us', '')}`}
              </p>
            </div>

            {/* 👥 GRUPO: Configuración de IA */}
            {selectedConv.isGroup && groupSettingsLocal && (
              <div className="space-y-2">
                <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                  <p className="text-[10px] text-[var(--text-muted)] mb-2">🤖 IA en grupo</p>
                  
                  {/* Toggle IA */}
                  <button
                    onClick={() => updateGroupSettings({ aiEnabled: !groupSettingsLocal.aiEnabled })}
                    className={`w-full px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between ${
                      groupSettingsLocal.aiEnabled 
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                        : 'bg-red-500/20 text-red-400 border border-red-500/30'
                    }`}
                  >
                    <span>{groupSettingsLocal.aiEnabled ? '✅ IA Activa' : '❌ IA Desactivada'}</span>
                  </button>
                </div>

                {/* Modo de respuesta */}
                {groupSettingsLocal.aiEnabled && (
                  <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                    <p className="text-[10px] text-[var(--text-muted)] mb-2">Responder a</p>
                    <div className="space-y-1">
                      {[
                        { id: 'all', label: 'Todos los mensajes', desc: 'Responde a todo' },
                        { id: 'mentions', label: 'Solo menciones', desc: 'Cuando mencionan al bot' },
                        { id: 'keywords', label: 'Palabras clave', desc: 'Solo si usan una keyword' },
                      ].map(mode => (
                        <button
                          key={mode.id}
                          onClick={() => updateGroupSettings({ respondTo: mode.id })}
                          className={`w-full text-left px-2 py-1.5 rounded text-[10px] transition-all ${
                            groupSettingsLocal.respondTo === mode.id
                              ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30'
                              : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <p className="font-medium">{mode.label}</p>
                          <p className="text-[9px] opacity-70">{mode.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Palabras clave */}
                {groupSettingsLocal.aiEnabled && groupSettingsLocal.respondTo === 'keywords' && (
                  <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                    <p className="text-[10px] text-[var(--text-muted)] mb-1.5">Palabras clave</p>
                    <input
                      type="text"
                      value={(groupSettingsLocal.triggerWords || []).join(', ')}
                      onChange={(e) => {
                        const words = e.target.value.split(',').map((w: string) => w.trim()).filter(Boolean);
                        updateGroupSettings({ triggerWords: words });
                      }}
                      placeholder="bizonne, ayuda, info"
                      className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded py-1 px-2 text-[10px] text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
                    />
                    <p className="text-[9px] text-[var(--text-muted)] mt-1">Separar con comas</p>
                  </div>
                )}
              </div>
            )}

            {/* Etapa (no-grupo) */}
            {!selectedConv.isGroup && (
              <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                <p className="text-[10px] text-[var(--text-muted)] mb-1">Etapa actual</p>
                <div className={`px-2 py-1 rounded text-xs text-center border ${getStageColor(selectedConv.stage || '')}`}>
                  {funnelStages.find(s => s.id === selectedConv.stage)?.label || selectedConv.stage || 'Sin etapa'}
                </div>
                <p className="text-[9px] text-emerald-400 text-center mt-1">✨ Auto-detectada</p>
              </div>
            )}

            {selectedConv.contextData && Object.keys(selectedConv.contextData).length > 0 && (
              <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                <p className="text-[10px] text-[var(--text-muted)] mb-1">📋 Datos</p>
                <div className="space-y-1">
                  {Object.entries(selectedConv.contextData as Record<string, any>)
                    .filter(([k, v]) => v && v !== '' && !['etapa_actual', 'paso_actual', 'accion', 'pedido', 'cita'].includes(k))
                    .slice(0, 8)
                    .map(([key, value]) => (
                      <div key={key} className="flex justify-between text-[10px]">
                        <span className="text-[var(--text-muted)] capitalize">{key.replace(/_/g, ' ')}</span>
                        <span className="text-white font-medium truncate ml-2 max-w-[70px]">{String(value)}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ====================================================
          📢 MODAL MENSAJE MASIVO — Con media + barra de progreso
          ==================================================== */}
      {showMassMessage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !sendingMass && setShowMassMessage(false)}>
          <div className="bg-[var(--bg-secondary)] rounded-xl p-4 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Mensaje Masivo</h3>
              <button onClick={() => !sendingMass && setShowMassMessage(false)} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-[var(--text-muted)] mb-3">
              Enviar a: <strong className="text-white">{funnelStages.find(s => s.id === filterStage)?.label}</strong> ({conversations.filter(c => c.stage === filterStage).length} contactos)
            </p>
            <textarea 
              value={massText} onChange={(e) => setMassText(e.target.value)}
              placeholder="Escribe tu mensaje..." disabled={sendingMass}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg p-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] min-h-[100px] resize-none mb-3 disabled:opacity-50"
            />

            {/* 📎 Adjuntar media */}
            <div className="mb-3">
              <input ref={massFileInputRef} type="file" accept="image/*,audio/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx" onChange={handleMassFileSelect} className="hidden" />
              
              {massMediaFile ? (
                <div className="flex items-center gap-2 p-2 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-primary)]">
                  {massMediaPreview ? (
                    <img src={massMediaPreview} alt="" className="w-12 h-12 rounded object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded bg-[var(--accent-primary)]/20 flex items-center justify-center">
                      {massMediaFile.type.startsWith('audio/') ? <Mic className="w-5 h-5 text-[var(--accent-primary)]" /> : <FileText className="w-5 h-5 text-[var(--accent-primary)]" />}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white truncate">{massMediaFile.name}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{(massMediaFile.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button onClick={removeMassMedia} className="p-1 hover:bg-white/10 rounded" disabled={sendingMass}>
                    <X className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => { if (massFileInputRef.current) { massFileInputRef.current.accept = 'image/*'; massFileInputRef.current.click(); } }} className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg text-xs text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-all border border-[var(--border-primary)]" disabled={sendingMass}>
                    <Image className="w-3.5 h-3.5" /> Imagen
                  </button>
                  <button onClick={() => { if (massFileInputRef.current) { massFileInputRef.current.accept = 'audio/*'; massFileInputRef.current.click(); } }} className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg text-xs text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-all border border-[var(--border-primary)]" disabled={sendingMass}>
                    <Mic className="w-3.5 h-3.5" /> Audio
                  </button>
                  <button onClick={() => { if (massFileInputRef.current) { massFileInputRef.current.accept = '*/*'; massFileInputRef.current.click(); } }} className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg text-xs text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-all border border-[var(--border-primary)]" disabled={sendingMass}>
                    <Paperclip className="w-3.5 h-3.5" /> Archivo
                  </button>
                </div>
              )}
            </div>

            {/* Progreso de envío */}
            {sendingMass && massTotal > 0 && (
              <div className="mb-3">
                <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                  <span>Enviando...</span>
                  <span>{massSentCount}/{massTotal}</span>
                </div>
                <div className="w-full bg-[var(--bg-tertiary)] rounded-full h-2">
                  <div className="bg-[var(--accent-primary)] h-2 rounded-full transition-all duration-500" style={{ width: `${(massSentCount / massTotal) * 100}%` }} />
                </div>
                <p className="text-[10px] text-[var(--text-muted)] mt-1 text-center">
                  ⏱️ ~{Math.ceil((massTotal - massSentCount) * 3.5)}s restantes
                </p>
              </div>
            )}

            <button onClick={sendMassMessage} disabled={sendingMass || (!massText.trim() && !massMediaFile)} className="btn-primary w-full py-2 disabled:opacity-50">
              {sendingMass ? `Enviando ${massSentCount}/${massTotal}...` : `Enviar a ${conversations.filter(c => c.stage === filterStage).length} contactos`}
            </button>
          </div>
        </div>
      )}

      {/* 🗑️ Modal Confirmar Eliminación */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--bg-secondary)] border border-red-500/30 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center justify-center mb-4">
              <div className="w-14 h-14 rounded-full bg-red-500/10 border-2 border-red-500/30 flex items-center justify-center">
                <Trash2 className="w-7 h-7 text-red-400" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-white text-center mb-2">¿Eliminar conversación?</h3>
            <p className="text-sm text-[var(--text-muted)] text-center mb-1">
              <span className="text-white font-semibold">{deleteConfirm.recipientName || deleteConfirm.recipientId?.replace('@c.us', '')}</span>
            </p>
            <p className="text-xs text-red-400/80 text-center mb-6">
              Se eliminarán todos los mensajes de forma permanente. Si vuelve a escribir, la conversación iniciará desde cero.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} disabled={deleting} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors">
                Cancelar
              </button>
              <button onClick={deleteConversation} disabled={deleting} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors flex items-center justify-center gap-2">
                {deleting ? <div className="loading-spinner w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

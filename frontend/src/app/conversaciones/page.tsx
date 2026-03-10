'use client';

import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
  MessageSquare, Search, Send, X, Trash2,
  Megaphone, PauseCircle, PlayCircle, Paperclip, Image, Mic, FileText, Zap,
  Download, Upload, ChevronLeft, StickyNote, Calendar, UserPlus, Check, Clock, Save, User
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// Helper: Validar si un recipientId es un número real de WhatsApp (7-13 dígitos)
const isValidWhatsAppPhone = (recipientId: string): boolean => {
  if (!recipientId) return false;
  const clean = recipientId.replace(/@c\.us|@g\.us/g, '').replace(/\D/g, '');
  return clean.length >= 7 && clean.length <= 13;
};

// Helper: Detectar si es un LID (Linked ID) de NOWEB engine
const isLidNumber = (recipientId: string): boolean => {
  if (!recipientId) return false;
  const clean = recipientId.replace(/\D/g, '');
  return clean.length > 13;
};

// Helper: Formatear número para mostrar
const formatPhoneDisplay = (recipientId: string): string => {
  if (!recipientId) return '';
  if (isLidNumber(recipientId)) return ''; // No mostrar LIDs largos
  return `+${recipientId.replace(/@c\.us|@s\.whatsapp\.net/g, '')}`;
};

// Helper: Ocultar primeros 6 dígitos del número para roles sin permiso
const maskPhone = (phone: string): string => {
  if (!phone) return '';
  const clean = phone.replace(/\+/g, '');
  if (clean.length <= 6) return '••••••';
  return '••••••' + clean.substring(6);
};

// Helper: Obtener rol del usuario actual
const getCurrentUserRole = (): { role: string; isSubUser: boolean } => {
  try {
    const cached = localStorage.getItem('bizonne_user_cache');
    if (cached) {
      const u = JSON.parse(cached);
      return { role: u.role || 'admin', isSubUser: !!u.isSubUser };
    }
  } catch {}
  return { role: 'admin', isSubUser: false };
};

// Helper: Verificar si el usuario puede ver números completos
const canSeeFullPhone = (): boolean => {
  const { role, isSubUser } = getCurrentUserRole();
  if (!isSubUser) return true; // Admin (dueño) siempre ve todo
  return role === 'manager' || role === 'admin';
};

// Helper: Verificar si el usuario puede eliminar conversaciones (solo admin/gerente)
const canDeleteConversation = (): boolean => {
  const { role, isSubUser } = getCurrentUserRole();
  if (!isSubUser) return true; // Admin (dueño) siempre puede
  return role === 'manager' || role === 'admin';
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
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null); // conversation to delete
  const [filterStage, setFilterStage] = useState('all');
  const [filterType, setFilterType] = useState<'all' | 'chats' | 'groups'>('all');
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
  
  // 📎 Chat media
  const [chatMediaFile, setChatMediaFile] = useState<File | null>(null);
  const [chatMediaPreview, setChatMediaPreview] = useState<string | null>(null);
  // ⚡ Quick replies
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [editingQuickReplies, setEditingQuickReplies] = useState(false);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [newQuickReply, setNewQuickReply] = useState('');
  const [showFullPhone] = useState(() => canSeeFullPhone());
  
  // 📝 NOTAS + 👤 ASIGNACIÓN + 📅 CITA RÁPIDA
  const [convNotes, setConvNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // ✏️ EDICIÓN DE NOMBRE Y DATOS
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editFieldValue, setEditFieldValue] = useState('');
  const [showContactDetails, setShowContactDetails] = useState(false);

  // 💾 Guardar nombre del contacto
  const saveContactName = async (newName: string) => {
    if (!selectedConv || !newName.trim()) return;
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/api/whatsapp/conversations/${selectedConv.id}/update-contact`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientName: newName.trim() })
      });
      setSelectedConv((prev: any) => prev ? { ...prev, recipientName: newName.trim() } : prev);
      setConversations((prev: any[]) => prev.map(c => c.id === selectedConv.id ? { ...c, recipientName: newName.trim() } : c));
      setEditingName(false);
    } catch (e) { console.error('Error actualizando nombre:', e); }
  };

  // 💾 Guardar campo de contextData
  const saveContextField = async (key: string, value: string) => {
    if (!selectedConv) return;
    try {
      const token = localStorage.getItem('token');
      const updatedContext = { ...(selectedConv.contextData || {}), [key]: value };
      await fetch(`${API_URL}/api/whatsapp/conversations/${selectedConv.id}/update-contact`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextData: updatedContext })
      });
      setSelectedConv((prev: any) => prev ? { ...prev, contextData: updatedContext } : prev);
      setEditingField(null);
    } catch (e) { console.error('Error actualizando campo:', e); }
  };

  // 💾 Guardar etapa manualmente
  const saveStage = async (newStage: string) => {
    if (!selectedConv) return;
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/api/whatsapp/conversations/${selectedConv.id}/update-contact`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage })
      });
      setSelectedConv((prev: any) => prev ? { ...prev, stage: newStage } : prev);
      setConversations((prev: any[]) => prev.map(c => c.id === selectedConv.id ? { ...c, stage: newStage } : c));
    } catch (e) { console.error('Error actualizando etapa:', e); }
  };

  // 🔥 Lead temperature helpers
  const getLeadTemp = (conv: any) => {
    const ctx = (conv?.contextData as any) || {};
    return ctx._leadTemp || 'frio';
  };
  const leadTempOptions = [
    { id: 'caliente', label: '🔥 Caliente', color: 'text-red-400 bg-red-500/15 border-red-500/30' },
    { id: 'tibio', label: '🟡 Tibio', color: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30' },
    { id: 'frio', label: '🔵 Frío', color: 'text-blue-400 bg-blue-500/15 border-blue-500/30' },
  ];
  const saveLeadTemp = async (temp: string) => {
    if (!selectedConv) return;
    const updatedContext = { ...(selectedConv.contextData || {}), _leadTemp: temp };
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/api/whatsapp/conversations/${selectedConv.id}/update-contact`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextData: updatedContext })
      });
      setSelectedConv((prev: any) => prev ? { ...prev, contextData: updatedContext } : prev);
      setConversations((prev: any[]) => prev.map(c => c.id === selectedConv.id ? { ...c, contextData: updatedContext } : c));
    } catch (e) { console.error('Error actualizando temperatura:', e); }
  };
  const [notesSaved, setNotesSaved] = useState(false);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [assigningChat, setAssigningChat] = useState(false);
  const [showAppointment, setShowAppointment] = useState(false);
  const [appointmentData, setAppointmentData] = useState({ date: '', time: '', type: 'appointment', notes: '' });
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [userRole, setUserRole] = useState('admin'); // rol del usuario actual
  
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
      // 👤 Cargar miembros del equipo (para asignar chats)
      fetch(`${API_URL}/api/team`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.members) setTeamMembers(d.members); })
        .catch(() => {});
      // 🔑 Obtener rol del usuario actual
      try { 
        const decoded = JSON.parse(atob(token!.split('.')[1]));
        if (decoded.role) setUserRole(decoded.role);
      } catch {}
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
      // 📝 Cargar notas del contextData
      const ctx = (selectedConv.contextData as any) || {};
      setConvNotes(ctx._userNotes || '');
      setNotesSaved(false);
      // ✏️ Reset editing states
      setEditingName(false);
      setEditingField(null);
      setShowContactDetails(false);
      // 📅 Reset appointment form
      setShowAppointment(false);
      setAppointmentData({ date: '', time: '', type: 'appointment', notes: '' });
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

  // ====================================================
  // 📝 GUARDAR NOTAS
  // ====================================================
  const saveNotes = async () => {
    if (!selectedConv) return;
    setSavingNotes(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/conversations/${selectedConv.id}/notes`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: convNotes })
      });
      if (res.ok) {
        setNotesSaved(true);
        setTimeout(() => setNotesSaved(false), 2000);
        // Actualizar contextData local
        setSelectedConv((prev: any) => prev ? { 
          ...prev, 
          contextData: { ...(prev.contextData || {}), _userNotes: convNotes } 
        } : prev);
      }
    } catch (e) { console.error('Error guardando notas:', e); }
    finally { setSavingNotes(false); }
  };

  // ====================================================
  // 👤 ASIGNAR CHAT A MIEMBRO
  // ====================================================
  const assignChat = async (memberId: string | null) => {
    if (!selectedConv) return;
    setAssigningChat(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/conversations/${selectedConv.id}/assign`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTo: memberId })
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedConv((prev: any) => prev ? { 
          ...prev, 
          assignedTo: data.assignedTo, 
          assignedName: data.assignedName 
        } : prev);
        // Actualizar en la lista de conversaciones
        setConversations(prev => prev.map(c => 
          c.id === selectedConv.id ? { ...c, assignedTo: data.assignedTo, assignedName: data.assignedName } : c
        ));
      }
    } catch (e) { console.error('Error asignando chat:', e); }
    finally { setAssigningChat(false); }
  };

  // ====================================================
  // 📅 CREAR CITA RÁPIDA
  // ====================================================
  const createQuickAppointment = async () => {
    if (!selectedConv || !appointmentData.date || !appointmentData.time) return;
    setSavingAppointment(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/conversations/${selectedConv.id}/quick-appointment`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(appointmentData)
      });
      if (res.ok) {
        setShowAppointment(false);
        setAppointmentData({ date: '', time: '', type: 'appointment', notes: '' });
        // Mini toast de éxito
        alert('✅ Cita agendada correctamente');
      }
    } catch (e) { console.error('Error creando cita:', e); }
    finally { setSavingAppointment(false); }
  };

  const canAssign = userRole === 'admin' || userRole === 'manager' || !localStorage.getItem('parentUserId');

  // 📋 Fetch SOLO conversaciones (sin stages ni sync)
  const fetchConversations = async () => {
    if (isFetchingRef.current) return; // Guard: no concurrent fetches
    isFetchingRef.current = true;
    const token = localStorage.getItem('token');
    try {
      const lineId = getLineId();
      const res = await fetch(`${API_URL}/api/conversations?lineId=${lineId}&limit=200`, { 
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
  // 📤 Exportar contactos de conversaciones como XLSX
  const exportContacts = async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
      const lineId = getLineId();
      const res  = await fetch(`${API_URL}/api/conversations/export-contacts?lineId=${lineId}`, { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      if (!data?.length) { alert('No hay contactos para exportar'); return; }

      const rows = data.map((r: any) => ({
        'Nombre':         r.nombre   || r.name || '',
        'Teléfono':       r.telefono || r.phone || '',
        'Etapa':          r.etapa    || r.stage || '',
        'Último mensaje': r.ultimoMensaje || r.lastMessage || '',
        'Fecha':          r.fecha    || r.lastActivity || '',
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [{wch:30},{wch:18},{wch:20},{wch:50},{wch:18}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Contactos');
      XLSX.writeFile(wb, `Conversaciones_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch { alert('Error al exportar'); }
  };

    // 📥 Importar contactos desde Excel/CSV al CRM
  const importContacts = async (file: File) => {
    try {
      let contacts: any[] = [];
      if (file.name.match(/\.xlsx?$/i)) {
        const buffer = await file.arrayBuffer();
        const wb   = XLSX.read(new Uint8Array(buffer), { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        contacts = rows.map((row: any) => {
          const n: any = {};
          Object.keys(row).forEach(k => { n[k.toLowerCase().trim().replace(/\s+/g,'_')] = row[k]; });
          return n;
        }).filter((c: any) => c.telefono || c.phone || c.celular || c.movil || c.whatsapp || c.numero);
      } else {
        const text = await file.text();
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) { alert('Archivo vacío'); return; }
        const headers = lines[0].split(',').map(h => h.replace(/"/g,'').trim().toLowerCase());
        contacts = lines.slice(1).map(line => {
          const vals = line.split(',').map(v => v.replace(/^"|"$/g,'').trim());
          const obj: any = {};
          headers.forEach((h,i) => { obj[h] = vals[i]||''; });
          return obj;
        }).filter(c => c.telefono || c.phone || c.celular);
      }
      if (!contacts.length) { alert('No se encontraron contactos.\nAsegúrate de tener columnas: nombre, telefono'); return; }
      const token  = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
      const lineId = getLineId();
      const res    = await fetch(`${API_URL}/api/clients/import`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts, lineId })
      });
      const result = await res.json();
      if (res.ok) alert(`✅ Importados: ${result.imported} nuevos, ${result.skipped} duplicados`);
      else        alert(result.error || 'Error al importar');
    } catch (e: any) { alert('Error: ' + (e?.message || 'desconocido')); }
  };

    // 🛡️ REF-BASED LOCK: Prevents re-sends even if state has race conditions
  const bulkSendLockRef = useRef(false);
  const bulkJobIdRef = useRef<string | null>(null);

  const sendMassMessage = async () => {
    if ((!massText.trim() && !massMediaFile) || filterStage === 'all') return;
    
    // 🛡️ LOCK: Absolutely prevent double-sends
    if (bulkSendLockRef.current) {
      console.warn('🛡️ Envío masivo bloqueado: ya hay uno en curso');
      return;
    }
    bulkSendLockRef.current = true;
    
    setSendingMass(true);
    const token = localStorage.getItem('token');
    const targets = conversations.filter(c => c.stage === filterStage);
    
    // ===== 🛡️ DEDUPLICAR POR TELÉFONO EN FRONTEND =====
    const seenPhones = new Set<string>();
    const uniqueTargets = targets.filter(c => {
      const phone = (c.recipientId || '').replace(/\D/g, '');
      const normalized = phone.length >= 10 ? phone.slice(-10) : phone;
      if (!normalized || seenPhones.has(normalized)) return false;
      seenPhones.add(normalized);
      return true;
    });
    
    const duplicatesRemoved = targets.length - uniqueTargets.length;
    if (duplicatesRemoved > 0) {
      console.log(`🛡️ Deduplicación frontend: ${duplicatesRemoved} duplicados removidos`);
    }
    
    setMassTotal(uniqueTargets.length);
    setMassSentCount(0);
    
    // 🛡️ Generar ID único para este batch
    const jobId = `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    bulkJobIdRef.current = jobId;

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

      const contacts = uniqueTargets.map(c => ({
        phone: c.recipientId,
        name: c.recipientName || c.recipientId,
        conversationId: c.id
      }));

      // 🚀 ENVIAR TODO AL BACKEND
      const res = await fetch(`${API_URL}/api/whatsapp/send-bulk`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contacts,
          message: massText || null,
          whatsappLineId: getLineId(),
          bulkJobId: jobId,
          ...(mediaUrl && { mediaUrl, mediaType })
        })
      });

      const resData = await res.json();
      
      // 🛡️ Check if backend rejected (duplicate batch)
      if (resData.alreadyRunning || resData.alreadyProcessed) {
        alert('⚠️ Ya hay un envío masivo en curso. Espera a que termine.');
        setSendingMass(false);
        bulkSendLockRef.current = false;
        return;
      }

      if (res.ok && resData.success) {
        const actualTotal = resData.total || uniqueTargets.length;
        setMassTotal(actualTotal);
        
        // 🛡️ Estimación de tiempo REAL basada en delays del backend
        // Backend: 5-18s por mensaje + 30-60s pausa cada 15 mensajes
        const avgDelayPerMsg = actualTotal <= 20 ? 7 : actualTotal <= 50 ? 10 : 14;
        const batchPauses = Math.floor(actualTotal / 15);
        const totalEstimatedMs = (actualTotal * avgDelayPerMsg * 1000) + (batchPauses * 45000) + 5000;
        const progressStepMs = totalEstimatedMs / actualTotal;
        
        // Simular progreso con timing realista
        let count = 0;
        const progressInterval = setInterval(() => {
          count += 1;
          setMassSentCount(Math.min(count, actualTotal));
          if (count >= actualTotal) clearInterval(progressInterval);
        }, progressStepMs);

        // Esperar tiempo estimado y cerrar
        setTimeout(() => {
          clearInterval(progressInterval);
          setMassSentCount(actualTotal);
          alert(`✅ Mensaje masivo enviado a ${actualTotal} contactos` + 
                (duplicatesRemoved > 0 ? ` (${duplicatesRemoved} duplicados omitidos)` : ''));
          setSendingMass(false);
          setShowMassMessage(false);
          setMassText('');
          setMassMediaFile(null);
          setMassMediaPreview(null);
          setMassSentCount(0);
          setMassTotal(0);
          
          // 🛡️ Mantener lock 15s adicionales después de "completar" para evitar re-envíos
          setTimeout(() => {
            bulkSendLockRef.current = false;
            bulkJobIdRef.current = null;
          }, 15000);
          
          fetchConversations();
        }, totalEstimatedMs);
      } else {
        throw new Error(resData.error || 'Error al enviar');
      }
    } catch (e) {
      alert('❌ Error al enviar mensaje masivo');
      setSendingMass(false);
      bulkSendLockRef.current = false;
      bulkJobIdRef.current = null;
    }
  };

  // 🛡️ Contar contactos ÚNICOS por etapa (sin duplicados por teléfono)
  const getUniqueStageCount = (stage: string) => {
    const targets = conversations.filter(c => c.stage === stage);
    const seen = new Set<string>();
    return targets.filter(c => {
      const phone = (c.recipientId || '').replace(/\D/g, '');
      const norm = phone.length >= 10 ? phone.slice(-10) : phone;
      if (!norm || seen.has(norm)) return false;
      seen.add(norm);
      return true;
    }).length;
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

  // 🗑️ Eliminar conversación (solo admin/gerente)
  const deleteConversation = async (conv: any) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/conversations/${conv.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setConversations(prev => prev.filter(c => c.id !== conv.id));
        if (selectedConv?.id === conv.id) {
          setSelectedConv(null);
          setMessages([]);
        }
        setDeleteConfirm(null);
      } else {
        const err = await res.json();
        alert(err.error || 'Error al eliminar');
        setDeleteConfirm(null);
      }
    } catch (e) {
      console.error('Error eliminando:', e);
      alert('Error al eliminar conversación');
      setDeleteConfirm(null);
    }
  };

  const filteredConversations = conversations.filter(c => {
    const matchSearch = !searchTerm || c.recipientName?.toLowerCase().includes(searchTerm.toLowerCase()) || c.recipientId?.includes(searchTerm);
    const matchStage = filterStage === 'all' || c.stage === filterStage;
    const matchType = filterType === 'all' || (filterType === 'groups' ? c.isGroup : !c.isGroup);
    return matchSearch && matchStage && matchType;
  });

  const groupCount = conversations.filter(c => c.isGroup).length;
  const chatCount = conversations.filter(c => !c.isGroup).length;

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
    <div className="h-[calc(100vh-120px)] md:h-[calc(100vh-120px)] flex flex-col gap-2 md:gap-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2 md:gap-3">
          <MessageSquare className="w-5 h-5 md:w-6 md:h-6 text-[var(--accent-primary)]" />
          <div>
            <h1 className="text-base md:text-xl font-bold text-white">Conversaciones</h1>
            <p className="text-[10px] md:text-xs text-[var(--text-muted)]">{conversations.length} chats</p>
          </div>
        </div>
        <div className="flex items-center gap-1 md:gap-2">
          <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)} className="input py-1.5 px-2 md:px-3 text-xs md:text-sm bg-[var(--bg-secondary)] max-w-[140px] md:max-w-none">
            <option value="all">Todas ({conversations.length})</option>
            {stageStats.map(stage => (
              <option key={stage.id} value={stage.id}>{stage.label} ({stage.count})</option>
            ))}
          </select>
          <button onClick={() => setShowMassMessage(true)} disabled={filterStage === 'all'} className="btn-secondary py-1.5 px-3 text-sm disabled:opacity-50" title={filterStage === 'all' ? 'Selecciona una etapa primero' : 'Mensaje masivo'}>
            <Megaphone className="w-4 h-4" />
          </button>
          <button onClick={exportContacts} className="hidden md:block p-2 rounded-lg hover:bg-white/10 text-[var(--text-muted)] hover:text-emerald-400 transition-all" title="Exportar contactos Excel">
            <Download className="w-4 h-4" />
          </button>
          <label className="hidden md:block p-2 rounded-lg hover:bg-white/10 text-[var(--text-muted)] hover:text-cyan-400 transition-all cursor-pointer" title="Importar contactos CSV">
            <Upload className="w-4 h-4" />
            <input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => { if (e.target.files?.[0]) importContacts(e.target.files[0]); e.target.value = ''; }} />
          </label>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex gap-3 min-h-0 overflow-hidden">
        {/* Lista */}
        <div className={`conv-list-panel w-full lg:w-64 lg:flex-shrink-0 flex flex-col bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] overflow-hidden ${selectedConv ? 'hidden lg:flex' : 'flex'}`}>
          <div className="p-2 border-b border-[var(--border-primary)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input type="text" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-1.5 pl-8 pr-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
            </div>
            {/* 🔀 Filtro: Todas | Chats | Grupos */}
            <div className="flex mt-2 bg-[var(--bg-tertiary)] rounded-lg p-0.5 gap-0.5">
              {([
                { id: 'all' as const, label: 'Todas', count: conversations.length },
                { id: 'chats' as const, label: '💬 Chats', count: chatCount },
                { id: 'groups' as const, label: '👥 Grupos', count: groupCount },
              ]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setFilterType(tab.id)}
                  className={`flex-1 py-1 px-1.5 rounded-md text-[10px] font-medium transition-all ${
                    filterType === tab.id
                      ? 'bg-[var(--accent-primary)] text-white shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'
                  }`}
                >
                  {tab.label} <span className="opacity-70">({tab.count})</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredConversations.map((conv) => (
              <div key={conv.id} onClick={() => setSelectedConv(conv)} className={`group p-2.5 border-b border-[var(--border-primary)] cursor-pointer hover:bg-white/5 transition-all ${selectedConv?.id === conv.id ? 'bg-[var(--accent-primary)]/10 border-l-2 border-l-[var(--accent-primary)]' : ''}`}>
                <div className="flex items-center gap-2.5">
                  <div className={`w-9 h-9 rounded-full ${conv.isGroup ? 'bg-blue-500/20' : 'bg-[var(--accent-primary)]/20'} flex items-center justify-center flex-shrink-0`}>
                    <span className={`text-sm font-bold ${conv.isGroup ? 'text-blue-400' : 'text-[var(--accent-primary)]'}`}>{conv.isGroup ? '👥' : (conv.recipientName?.[0] || '?')}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="font-semibold text-white text-[13px] truncate">{conv.isGroup ? (conv.groupName || conv.recipientName || 'Grupo') : (conv.recipientName || 'Sin nombre')}</p>
                      {conv.isGroup && <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1 rounded">👥</span>}
                      
                      {conv.aiPaused && <PauseCircle className="w-3 h-3 text-yellow-400 flex-shrink-0" />}
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">{conv.lastMessage || 'Sin mensajes'}</p>
                    {conv.stage && (
                      <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium border ${getStageColor(conv.stage)}`}>
                        {funnelStages.find(s => s.id === conv.stage)?.label || conv.stage}
                      </span>
                    )}
                    {conv.assignedName && (
                      <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] bg-cyan-500/15 text-cyan-400 border border-cyan-500/20">
                        👤 {conv.assignedName.split(' ')[0]}
                      </span>
                    )}
                  </div>
                  {/* 🗑️ Delete button - solo admin/gerente */}
                  {canDeleteConversation() && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm(conv); }}
                      className="p-1.5 rounded-lg opacity-40 hover:opacity-100 hover:bg-red-500/20 transition-all flex-shrink-0"
                      title="Eliminar conversación"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {filteredConversations.length === 0 && <div className="p-4 text-center text-[var(--text-muted)] text-sm">No hay conversaciones</div>}
          </div>
        </div>

        {/* Chat */}
        <div className={`conv-chat-panel flex-1 flex flex-col bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] overflow-hidden min-w-0 ${selectedConv ? 'flex' : 'hidden lg:flex'}`}>
          {selectedConv ? (
            <>
              <div className="p-3 border-b border-[var(--border-primary)] flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <button onClick={() => setSelectedConv(null)} className="lg:hidden p-1.5 -ml-1 mr-1 rounded-lg hover:bg-white/10 text-[var(--text-muted)]">
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <div className={`w-9 h-9 rounded-full ${selectedConv.isGroup ? 'bg-blue-500/20' : 'bg-[var(--accent-primary)]/20'} flex items-center justify-center flex-shrink-0`}>
                    <span className={`text-sm font-bold ${selectedConv.isGroup ? 'text-blue-400' : 'text-[var(--accent-primary)]'}`}>{selectedConv.isGroup ? '👥' : (selectedConv.recipientName?.[0] || '?')}</span>
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-white text-[15px] truncate">{selectedConv.isGroup ? (selectedConv.groupName || selectedConv.recipientName || 'Grupo') : (selectedConv.recipientName || selectedConv.recipientId)}</h3>
                    <p className="text-[11px] text-[var(--text-muted)]">{selectedConv.isGroup ? '👥 Grupo' : (showFullPhone ? (formatPhoneDisplay(selectedConv.recipientId) || 'WhatsApp') : (maskPhone(formatPhoneDisplay(selectedConv.recipientId)) || 'WhatsApp'))}</p>
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
                    <div className={`${msg.mediaType === 'image' ? 'max-w-[85%]' : 'max-w-[75%]'} px-3 py-2 rounded-2xl text-sm ${msg.fromMe ? 'bg-[var(--accent-primary)] text-white rounded-br-sm' : 'bg-[var(--bg-tertiary)] text-white rounded-bl-sm'}`}>
                      {/* 💬 QUOTED MESSAGE — muestra el mensaje al que respondió */}
                      
                      {msg.mediaType === 'image' && msg.mediaUrl && (() => {
                        const t = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
                        const imgSrc = msg.mediaUrl.startsWith('data:') ? msg.mediaUrl 
                          : msg.mediaUrl.startsWith('/api/') ? `${API_URL}${msg.mediaUrl}?token=${t}`
                          : msg.mediaUrl.startsWith('http') ? msg.mediaUrl
                          : `${API_URL}/api/media-proxy/${msg.id}?token=${t}`;
                        return (
                          <img 
                            src={imgSrc}
                            alt="" 
                            className="max-w-full w-full rounded-lg mb-1 cursor-pointer hover:opacity-90 transition" 
                            style={{ maxWidth: '420px', imageRendering: 'auto' }}
                            onClick={() => window.open(imgSrc, '_blank')}
                            onError={(e) => { 
                              const el = e.target as HTMLImageElement;
                              if (!el.dataset.retried) {
                                el.dataset.retried = '1';
                                el.src = `${API_URL}/api/media-proxy/${msg.id}?token=${t}`;
                              } else {
                                el.style.display = 'none';
                              }
                            }}
                            loading="lazy"
                          />
                        );
                      })()}
                      {msg.mediaType === 'image' && !msg.mediaUrl && (
                        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-black/20 mb-1">
                          <Image className="w-4 h-4 opacity-60" />
                          <span className="text-xs opacity-60">Imagen recibida</span>
                        </div>
                      )}
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
                      <p className="whitespace-pre-wrap break-words">
                        {msg.mediaType === 'image' && msg.mediaUrl && (msg.content === '📷 [Imagen]' || msg.content === '📷 [Imagen enviada por el cliente]' || msg.content?.startsWith('📷 [Imagen'))
                          ? '' 
                          : msg.mediaType === 'image' && msg.content?.startsWith('[El cliente envió una imagen')
                            ? msg.content.replace(/^\[El cliente envió una imagen[^.]*\.\s*Contenido(?:\s*de la imagen)?:\s*/, '👁️ ').replace(/\]$/, '')
                            : msg.content
                        }
                      </p>
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

        {/* Panel info — ENHANCED: Notas + Asignar + Cita */}
        {selectedConv && (
          <div className="w-64 flex-shrink-0 hidden xl:flex flex-col bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] p-3 gap-2.5 overflow-y-auto">
            {/* Header: Avatar + Name (editable) + Phone */}
            <div className="text-center">
              <div className="w-14 h-14 mx-auto rounded-full bg-[var(--accent-primary)]/20 flex items-center justify-center mb-2">
                <span className="text-xl font-bold text-[var(--accent-primary)]">{selectedConv.recipientName?.[0] || selectedConv.groupName?.[0] || '?'}</span>
              </div>
              {/* Editable Name */}
              {editingName && !selectedConv.isGroup ? (
                <div className="flex items-center gap-1 justify-center mb-1">
                  <input
                    autoFocus
                    value={editNameValue}
                    onChange={(e) => setEditNameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveContactName(editNameValue); if (e.key === 'Escape') setEditingName(false); }}
                    className="bg-[var(--bg-tertiary)] border border-[var(--accent-primary)] rounded px-2 py-1 text-sm text-white text-center focus:outline-none w-40"
                  />
                  <button onClick={() => saveContactName(editNameValue)} className="text-emerald-400 hover:text-emerald-300"><Check className="w-4 h-4" /></button>
                  <button onClick={() => setEditingName(false)} className="text-red-400 hover:text-red-300"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <h4
                  className="font-bold text-white text-base cursor-pointer hover:text-[var(--accent-primary)] transition-colors"
                  onClick={() => { if (!selectedConv.isGroup) { setEditNameValue(selectedConv.recipientName || ''); setEditingName(true); } }}
                  title="Clic para editar nombre"
                >
                  {selectedConv.groupName || selectedConv.recipientName || 'Sin nombre'}
                  {!selectedConv.isGroup && <span className="inline-block ml-1 text-[var(--text-muted)] text-[10px]">✏️</span>}
                </h4>
              )}
              <p className="text-xs text-[var(--text-muted)]">
                {selectedConv.isGroup ? '👥 Grupo' : (showFullPhone ? (formatPhoneDisplay(selectedConv.recipientId) || 'WhatsApp') : (maskPhone(formatPhoneDisplay(selectedConv.recipientId)) || 'WhatsApp'))}
              </p>
              {/* Lead Temperature */}
              {!selectedConv.isGroup && (
                <div className="flex items-center justify-center gap-1 mt-2">
                  {leadTempOptions.map(opt => (
                    <button key={opt.id} onClick={() => saveLeadTemp(opt.id)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${getLeadTemp(selectedConv) === opt.id ? opt.color : 'text-[var(--text-muted)] bg-white/5 border-transparent hover:border-white/10'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 👤 ASIGNAR CHAT — Solo admin/manager */}
            {canAssign && teamMembers.length > 0 && !selectedConv.isGroup && (
              <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                <p className="text-[10px] text-[var(--text-muted)] mb-1.5 flex items-center gap-1">
                  <UserPlus className="w-3 h-3" /> Asignar a
                </p>
                <select
                  value={selectedConv.assignedTo || ''}
                  onChange={(e) => assignChat(e.target.value || null)}
                  disabled={assigningChat}
                  className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded py-1.5 px-2 text-[11px] text-white focus:outline-none focus:border-[var(--accent-primary)] disabled:opacity-50 appearance-none cursor-pointer"
                >
                  <option value="">Sin asignar</option>
                  {teamMembers.filter(m => m.isActive !== false).map(m => (
                    <option key={m.id} value={m.id}>
                      {m.role === 'admin' ? '👑' : m.role === 'manager' ? '📊' : m.role === 'agent' ? '🛒' : m.role === 'support' ? '🎧' : '👁️'} {m.name || m.email}
                    </option>
                  ))}
                </select>
                {selectedConv.assignedName && (
                  <p className="text-[9px] text-emerald-400 mt-1 text-center">✅ {selectedConv.assignedName}</p>
                )}
              </div>
            )}

            {/* Asignado badge (para roles que no pueden cambiar) */}
            {!canAssign && selectedConv.assignedName && (
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <p className="text-[10px] text-emerald-400 text-center flex items-center justify-center gap-1">
                  <User className="w-3 h-3" /> Asignado a: <strong>{selectedConv.assignedName}</strong>
                </p>
              </div>
            )}

            {/* 👥 GRUPO: Configuración de IA */}
            {selectedConv.isGroup && groupSettingsLocal && (
              <div className="space-y-2">
                <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                  <p className="text-[10px] text-[var(--text-muted)] mb-2">🤖 IA en grupo</p>
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
                {groupSettingsLocal.aiEnabled && (
                  <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                    <p className="text-[10px] text-[var(--text-muted)] mb-2">Responder a</p>
                    <div className="space-y-1">
                      {[
                        { id: 'all', label: 'Todos', desc: 'Responde a todo' },
                        { id: 'mentions', label: 'Menciones', desc: 'Cuando mencionan al bot' },
                        { id: 'keywords', label: 'Keywords', desc: 'Solo si usan una keyword' },
                      ].map(mode => (
                        <button key={mode.id} onClick={() => updateGroupSettings({ respondTo: mode.id })}
                          className={`w-full text-left px-2 py-1 rounded text-[10px] transition-all ${
                            groupSettingsLocal.respondTo === mode.id
                              ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30'
                              : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <p className="font-medium">{mode.label}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {groupSettingsLocal.aiEnabled && groupSettingsLocal.respondTo === 'keywords' && (
                  <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                    <p className="text-[10px] text-[var(--text-muted)] mb-1.5">Palabras clave</p>
                    <input type="text" value={(groupSettingsLocal.triggerWords || []).join(', ')}
                      onChange={(e) => { const words = e.target.value.split(',').map((w: string) => w.trim()).filter(Boolean); updateGroupSettings({ triggerWords: words }); }}
                      placeholder="bizonne, ayuda, info"
                      className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded py-1 px-2 text-[10px] text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
                    />
                  </div>
                )}
              </div>
            )}

            {/* 🤖 Asistente Personal toggle — solo admin/manager */}
            {!selectedConv.isGroup && (userRole === 'admin' || userRole === 'manager') && (
              <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                <p className="text-[10px] text-[var(--text-muted)] mb-2">🤖 Copiloto IA</p>
                <button
                  onClick={async () => {
                    const current = (selectedConv.contextData as any)?._isPersonalAssistant || false;
                    if (!current) {
                      const confirmed = window.confirm(`¿Seguro deseas activar el Copiloto IA en este número?\n\n${selectedConv.recipientName || selectedConv.recipientId}\n\nLa IA te enviará notificaciones automáticas de pedidos, citas y reservas a este WhatsApp.`);
                      if (!confirmed) return;
                    }
                    try {
                      const token = localStorage.getItem('token');
                      await fetch(`${API_URL}/api/conversations/${selectedConv.id}/personal-assistant`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ enabled: !current })
                      });
                      setSelectedConv((prev: any) => ({
                        ...prev,
                        contextData: { ...(prev.contextData || {}), _isPersonalAssistant: !current }
                      }));
                    } catch {}
                  }}
                  className={`w-full px-2 py-1.5 rounded-lg text-xs flex items-center gap-2 transition-all ${
                    (selectedConv.contextData as any)?._isPersonalAssistant
                      ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                      : 'bg-white/5 text-[var(--text-muted)] border border-[var(--border-primary)]'
                  }`}
                >
                  <span>{(selectedConv.contextData as any)?._isPersonalAssistant ? '🧠' : '💤'}</span>
                  <span>{(selectedConv.contextData as any)?._isPersonalAssistant ? 'Asistente Activo' : 'Activar Asistente'}</span>
                </button>
                {(selectedConv.contextData as any)?._isPersonalAssistant && (
                  <p className="text-[9px] text-purple-400 mt-1.5">
                    ✨ Pregunta: resumen, citas, pedidos, ventas, reservas...
                  </p>
                )}
              </div>
            )}

            {/* Etapa (editable) */}
            {!selectedConv.isGroup && (
              <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                <p className="text-[10px] text-[var(--text-muted)] mb-1">Etapa actual</p>
                <select
                  value={selectedConv.stage || ''}
                  onChange={(e) => saveStage(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs text-center font-medium border cursor-pointer focus:outline-none focus:border-[var(--accent-primary)] bg-[var(--bg-secondary)] ${getStageColor(selectedConv.stage || '')}`}
                >
                  <option value="">Sin etapa</option>
                  {funnelStages.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* 📋 Datos del cliente — Expandable + Editable */}
            {selectedConv.contextData && Object.keys(selectedConv.contextData).length > 0 && (
              <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                <button
                  onClick={() => setShowContactDetails(!showContactDetails)}
                  className="w-full flex items-center justify-between text-[11px] text-[var(--text-muted)] hover:text-white transition-colors"
                >
                  <span className="flex items-center gap-1">📋 Datos del cliente</span>
                  <span className={`transition-transform ${showContactDetails ? 'rotate-180' : ''}`}>▼</span>
                </button>
                {showContactDetails && (
                  <div className="space-y-1.5 mt-2">
                    {Object.entries(selectedConv.contextData as Record<string, any>)
                      .filter(([k, v]) => v && v !== '' && !['etapa_actual', 'paso_actual', 'accion', 'pedido', 'cita', 'reserva', '_userNotes', '_isPersonalAssistant', '_leadTemp'].includes(k))
                      .map(([key, value]) => (
                        <div key={key} className="group/field">
                          {editingField === key ? (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-[var(--text-muted)] capitalize w-16 flex-shrink-0">{key.replace(/_/g, ' ')}</span>
                              <input
                                autoFocus
                                value={editFieldValue}
                                onChange={(e) => setEditFieldValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveContextField(key, editFieldValue); if (e.key === 'Escape') setEditingField(null); }}
                                className="flex-1 bg-[var(--bg-secondary)] border border-[var(--accent-primary)] rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none"
                              />
                              <button onClick={() => saveContextField(key, editFieldValue)} className="text-emerald-400"><Check className="w-3 h-3" /></button>
                              <button onClick={() => setEditingField(null)} className="text-red-400"><X className="w-3 h-3" /></button>
                            </div>
                          ) : (
                            <div
                              className="flex justify-between text-[11px] cursor-pointer hover:bg-white/5 rounded px-1 py-0.5 transition-colors"
                              onClick={() => { setEditingField(key); setEditFieldValue(String(value)); }}
                              title="Clic para editar"
                            >
                              <span className="text-[var(--text-muted)] capitalize">{key.replace(/_/g, ' ')}</span>
                              <span className="text-white font-medium truncate ml-2 max-w-[100px]">
                                {(!showFullPhone && (key.toLowerCase() === 'telefono' || key.toLowerCase() === 'phone' || key.toLowerCase() === 'celular'))
                                  ? maskPhone(String(value))
                                  : String(value)}
                              </span>
                            </div>
                          )}
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            )}

            {/* 📝 NOTAS MANUALES */}
            {!selectedConv.isGroup && (
              <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                    <StickyNote className="w-3 h-3" /> Notas
                  </p>
                  {convNotes !== ((selectedConv.contextData as any)?._userNotes || '') && (
                    <button
                      onClick={saveNotes}
                      disabled={savingNotes}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 transition-all disabled:opacity-50 flex items-center gap-0.5"
                    >
                      {savingNotes ? <Clock className="w-2.5 h-2.5 animate-spin" /> : <Save className="w-2.5 h-2.5" />}
                      Guardar
                    </button>
                  )}
                  {notesSaved && (
                    <span className="text-[9px] text-emerald-400 flex items-center gap-0.5">
                      <Check className="w-2.5 h-2.5" /> Guardado
                    </span>
                  )}
                </div>
                <textarea
                  value={convNotes}
                  onChange={(e) => setConvNotes(e.target.value)}
                  placeholder="Escribir notas sobre este cliente..."
                  rows={3}
                  className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded py-1.5 px-2 text-[10px] text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] resize-none leading-relaxed"
                />
              </div>
            )}

            {/* 📅 AGENDAR CITA RÁPIDA */}
            {!selectedConv.isGroup && (
              <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                {!showAppointment ? (
                  <button
                    onClick={() => setShowAppointment(true)}
                    className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20 hover:bg-amber-500/25 transition-all"
                  >
                    <Calendar className="w-3 h-3" />
                    Agendar cita
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-amber-400 font-medium flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> Nueva cita
                      </p>
                      <button onClick={() => setShowAppointment(false)} className="text-[var(--text-muted)] hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      <input
                        type="date"
                        value={appointmentData.date}
                        onChange={(e) => setAppointmentData(prev => ({ ...prev, date: e.target.value }))}
                        className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded py-1 px-2 text-[10px] text-white focus:outline-none focus:border-amber-400"
                      />
                      <input
                        type="time"
                        value={appointmentData.time}
                        onChange={(e) => setAppointmentData(prev => ({ ...prev, time: e.target.value }))}
                        className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded py-1 px-2 text-[10px] text-white focus:outline-none focus:border-amber-400"
                      />
                      <select
                        value={appointmentData.type}
                        onChange={(e) => setAppointmentData(prev => ({ ...prev, type: e.target.value }))}
                        className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded py-1 px-2 text-[10px] text-white focus:outline-none focus:border-amber-400 appearance-none"
                      >
                        <option value="appointment">📅 Cita</option>
                        <option value="order">📦 Pedido/Entrega</option>
                        <option value="followup">📞 Seguimiento</option>
                      </select>
                      <input
                        type="text"
                        value={appointmentData.notes}
                        onChange={(e) => setAppointmentData(prev => ({ ...prev, notes: e.target.value }))}
                        placeholder="Notas de la cita..."
                        className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded py-1 px-2 text-[10px] text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-amber-400"
                      />
                      <button
                        onClick={createQuickAppointment}
                        disabled={savingAppointment || !appointmentData.date || !appointmentData.time}
                        className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-medium bg-amber-500 text-black hover:bg-amber-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {savingAppointment ? <Clock className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        Agendar
                      </button>
                    </div>
                  </div>
                )}
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
              Enviar a: <strong className="text-white">{funnelStages.find(s => s.id === filterStage)?.label}</strong> ({getUniqueStageCount(filterStage)} contactos únicos)
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
                  ⏱️ ~{(() => {
                    const remaining = massTotal - massSentCount;
                    const avgDelay = massTotal <= 20 ? 7 : massTotal <= 50 ? 10 : 14;
                    const batchPauses = Math.floor(remaining / 15) * 45;
                    const totalSecs = remaining * avgDelay + batchPauses;
                    return totalSecs > 60 ? `${Math.ceil(totalSecs / 60)}min` : `${totalSecs}s`;
                  })()}  restantes
                </p>
              </div>
            )}

            <button onClick={sendMassMessage} disabled={sendingMass || bulkSendLockRef.current || (!massText.trim() && !massMediaFile)} className="btn-primary w-full py-2 disabled:opacity-50">
              {sendingMass ? `Enviando ${massSentCount}/${massTotal}...` : `Enviar a ${getUniqueStageCount(filterStage)} contactos`}
            </button>
          </div>
        </div>
      )}

      {/* 🗑️ Modal de confirmación de eliminación */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-[var(--bg-secondary)] rounded-xl p-6 w-full max-w-sm border border-red-500/30" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-white">¿Eliminar conversación?</h3>
                <p className="text-xs text-[var(--text-muted)]">Esta acción no se puede deshacer</p>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] mb-4">
              <p className="text-sm text-white font-medium">{deleteConfirm.recipientName || deleteConfirm.groupName || 'Sin nombre'}</p>
              <p className="text-xs text-[var(--text-muted)]">{deleteConfirm.recipientId}</p>
              <p className="text-xs text-red-400 mt-1">Se eliminarán todos los mensajes de esta conversación.</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setDeleteConfirm(null)} 
                className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-white/5 text-[var(--text-muted)] hover:bg-white/10 border border-[var(--border-primary)]"
              >
                Cancelar
              </button>
              <button 
                onClick={() => deleteConversation(deleteConfirm)} 
                className="flex-1 py-2.5 rounded-lg text-sm font-bold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
              >
                🗑️ Sí, eliminar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

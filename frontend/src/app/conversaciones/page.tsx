'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, Search, Send, User, Phone, Mail, MapPin,
  Tag, ShoppingCart, Calendar, Plus, X, Check, ChevronRight,
  Filter, Users, Package, Clock, DollarSign, AlertCircle,
  Megaphone, RefreshCw, MoreVertical, Edit2, Trash2,
  UserPlus, CalendarPlus, ArrowRight, Star, Eye, 
  CheckCircle, XCircle, PauseCircle, PlayCircle
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// Etiquetas del embudo de ventas
const FUNNEL_STAGES = [
  { id: 'new', label: 'Nuevo', color: 'blue', description: 'Solo escribió/preguntó' },
  { id: 'interested', label: 'Interesado', color: 'cyan', description: 'Mostró interés en productos' },
  { id: 'quoting', label: 'En Cotización', color: 'yellow', description: 'Pidiendo precios/info' },
  { id: 'negotiating', label: 'Negociando', color: 'orange', description: 'Discutiendo términos' },
  { id: 'pending_confirm', label: 'Por Confirmar', color: 'purple', description: 'Falta confirmación de pago' },
  { id: 'converted', label: 'Convertido', color: 'green', description: 'Realizó compra' },
  { id: 'follow_up', label: 'Seguimiento', color: 'pink', description: 'Requiere seguimiento' },
  { id: 'lost', label: 'Perdido', color: 'red', description: 'No compró' },
];

const getStageColor = (stageId: string) => {
  const colors: any = {
    new: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    interested: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    quoting: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    negotiating: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    pending_confirm: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    converted: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    follow_up: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
    lost: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return colors[stageId] || colors.new;
};

export default function ConversacionesPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStage, setFilterStage] = useState('all');
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);

  // Modales
  const [showAddClient, setShowAddClient] = useState(false);
  const [showCreateOrder, setShowCreateOrder] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showMassMessage, setShowMassMessage] = useState(false);
  const [showStageSelector, setShowStageSelector] = useState(false);

  // Datos
  const [products, setProducts] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);

  // Formularios
  const [clientForm, setClientForm] = useState({ name: '', phone: '', email: '', address: '', notes: '' });
  const [orderForm, setOrderForm] = useState({ products: [] as any[], notes: '', total: 0 });
  const [scheduleForm, setScheduleForm] = useState({ type: 'order', date: '', time: '', address: '', notes: '' });
  const [massMessageForm, setMassMessageForm] = useState({ stage: '', message: '' });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (selectedConv) {
      fetchMessages(selectedConv.id);
      setClientForm({
        name: selectedConv.recipientName || '',
        phone: selectedConv.recipientId?.replace('@c.us', '') || '',
        email: '', address: '', notes: ''
      });
    }
  }, [selectedConv]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchData = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const [convRes, prodRes, clientRes] = await Promise.all([
        fetch(`${API_URL}/api/conversations`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/products`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null),
        fetch(`${API_URL}/api/clients`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null),
      ]);

      if (convRes.ok) setConversations((await convRes.json()).conversations || []);
      if (prodRes?.ok) setProducts((await prodRes.json()).products || []);
      if (clientRes?.ok) setClients((await clientRes.json()).clients || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (id: string) => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/conversations/${id}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setMessages((await res.json()).messages || []);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConv) return;
    setSending(true);
    const token = localStorage.getItem('token');

    try {
      await fetch(`${API_URL}/api/whatsapp/send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selectedConv.recipientId, message: newMessage })
      });
      setNewMessage('');
      fetchMessages(selectedConv.id);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setSending(false);
    }
  };

  const updateConversationStage = async (convId: string, stage: string) => {
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/conversations/${convId}/stage`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage })
      });
      
      setConversations(convs => convs.map(c => c.id === convId ? { ...c, stage } : c));
      if (selectedConv?.id === convId) setSelectedConv({ ...selectedConv, stage });
      setShowStageSelector(false);
    } catch (error) {
      console.error('Error:', error);
    }
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
      fetchData();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const saveClient = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/clients`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(clientForm)
      });
      if (res.ok) {
        setShowAddClient(false);
        fetchData();
        alert('✅ Cliente guardado correctamente');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const createOrder = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/appointments`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'order',
          clientName: selectedConv?.recipientName || clientForm.name,
          clientPhone: selectedConv?.recipientId?.replace('@c.us', '') || '',
          date: scheduleForm.date || new Date().toISOString(),
          time: scheduleForm.time || '12:00',
          products: orderForm.products,
          total: orderForm.total,
          notes: orderForm.notes,
          address: scheduleForm.address
        })
      });
      
      if (res.ok) {
        setShowCreateOrder(false);
        setOrderForm({ products: [], notes: '', total: 0 });
        updateConversationStage(selectedConv.id, 'converted');
        alert('✅ Pedido creado correctamente');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const scheduleAppointment = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/appointments`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: scheduleForm.type,
          clientName: selectedConv?.recipientName || clientForm.name,
          clientPhone: selectedConv?.recipientId?.replace('@c.us', '') || '',
          date: scheduleForm.date,
          time: scheduleForm.time,
          notes: scheduleForm.notes,
          address: scheduleForm.address
        })
      });
      
      if (res.ok) {
        setShowSchedule(false);
        setScheduleForm({ type: 'order', date: '', time: '', address: '', notes: '' });
        alert('✅ ' + (scheduleForm.type === 'order' ? 'Entrega programada' : 'Cita agendada'));
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const sendMassMessage = async () => {
    const token = localStorage.getItem('token');
    const targetConvs = conversations.filter(c => c.stage === massMessageForm.stage);
    
    if (targetConvs.length === 0) {
      alert('No hay conversaciones en esta etapa');
      return;
    }

    if (!confirm(`¿Enviar mensaje a ${targetConvs.length} conversaciones?`)) return;

    try {
      for (const conv of targetConvs) {
        await fetch(`${API_URL}/api/whatsapp/send`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: conv.recipientId, message: massMessageForm.message })
        });
      }
      setShowMassMessage(false);
      setMassMessageForm({ stage: '', message: '' });
      alert(`✅ Mensaje enviado a ${targetConvs.length} contactos`);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const addProductToOrder = (product: any) => {
    const existing = orderForm.products.find((p: any) => p.id === product.id);
    if (existing) {
      setOrderForm({
        ...orderForm,
        products: orderForm.products.map((p: any) => 
          p.id === product.id ? { ...p, quantity: p.quantity + 1 } : p
        ),
        total: orderForm.total + product.price
      });
    } else {
      setOrderForm({
        ...orderForm,
        products: [...orderForm.products, { ...product, quantity: 1 }],
        total: orderForm.total + product.price
      });
    }
  };

  const removeProductFromOrder = (productId: string) => {
    const product = orderForm.products.find((p: any) => p.id === productId);
    if (!product) return;
    
    setOrderForm({
      ...orderForm,
      products: orderForm.products.filter((p: any) => p.id !== productId),
      total: orderForm.total - (product.price * product.quantity)
    });
  };

  const filteredConversations = conversations.filter(c => {
    const matchSearch = c.recipientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       c.recipientId?.includes(searchTerm);
    const matchStage = filterStage === 'all' || c.stage === filterStage;
    return matchSearch && matchStage;
  });

  const stageStats = FUNNEL_STAGES.map(stage => ({
    ...stage,
    count: conversations.filter(c => c.stage === stage.id).length
  }));

  const existingClient = clients.find(c => 
    c.phone === selectedConv?.recipientId?.replace('@c.us', '')
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <img src="/elisa.png" alt="Elisa" className="w-16 h-16 rounded-xl animate-pulse" />
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/elisa.png" alt="Elisa" className="w-10 h-10 rounded-xl" />
          <div>
            <h1 className="text-2xl font-bold text-white">Conversaciones</h1>
            <p className="text-sm text-[var(--text-muted)]">{conversations.length} chats activos</p>
          </div>
        </div>
        <button onClick={() => setShowMassMessage(true)} className="btn-secondary">
          <Megaphone className="w-4 h-4" />Mensaje Masivo
        </button>
      </div>

      {/* Embudo Stats */}
      <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
        <button
          onClick={() => setFilterStage('all')}
          className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
            filterStage === 'all' ? 'bg-[var(--accent-primary)] text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
          }`}
        >
          Todos ({conversations.length})
        </button>
        {stageStats.map(stage => (
          <button
            key={stage.id}
            onClick={() => setFilterStage(stage.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all border ${
              filterStage === stage.id ? getStageColor(stage.id) : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border-transparent'
            }`}
          >
            {stage.label} ({stage.count})
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Lista */}
        <div className="w-80 flex flex-col card p-0 overflow-hidden">
          <div className="p-4 border-b border-[var(--border-primary)]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input type="text" placeholder="Buscar..." value={searchTerm} 
                onChange={(e) => setSearchTerm(e.target.value)} className="input pl-10 py-2 text-sm" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar">
            {filteredConversations.map((conv) => (
              <div key={conv.id} onClick={() => setSelectedConv(conv)}
                className={`p-4 border-b border-[var(--border-primary)] cursor-pointer transition-all hover:bg-white/5 ${
                  selectedConv?.id === conv.id ? 'bg-[var(--accent-primary)]/10 border-l-2 border-l-[var(--accent-primary)]' : ''
                }`}>
                <div className="flex items-center gap-3">
                  <div className="avatar flex-shrink-0">{conv.recipientName?.[0] || '?'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-white truncate">{conv.recipientName || conv.recipientId}</p>
                      {conv.aiPaused && <PauseCircle className="w-4 h-4 text-yellow-400 flex-shrink-0" />}
                    </div>
                    <p className="text-sm text-[var(--text-muted)] truncate">{conv.lastMessage || 'Sin mensajes'}</p>
                    {conv.stage && (
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs border ${getStageColor(conv.stage)}`}>
                        {FUNNEL_STAGES.find(s => s.id === conv.stage)?.label}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {filteredConversations.length === 0 && (
              <div className="text-center py-12 text-[var(--text-muted)]">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No hay conversaciones</p>
              </div>
            )}
          </div>
        </div>

        {/* Chat */}
        <div className="flex-1 flex flex-col card p-0 overflow-hidden">
          {selectedConv ? (
            <>
              <div className="p-4 border-b border-[var(--border-primary)] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="avatar-lg">{selectedConv.recipientName?.[0] || '?'}</div>
                  <div>
                    <h3 className="font-semibold text-white">{selectedConv.recipientName || selectedConv.recipientId}</h3>
                    <p className="text-sm text-[var(--text-muted)]">+{selectedConv.recipientId?.replace('@c.us', '')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowStageSelector(true)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${getStageColor(selectedConv.stage || 'new')}`}>
                    {FUNNEL_STAGES.find(s => s.id === selectedConv.stage)?.label || 'Nuevo'}
                    <ChevronRight className="w-4 h-4 inline ml-1" />
                  </button>
                  <button onClick={toggleAIPause}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 ${
                      selectedConv.aiPaused ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400'
                    }`}>
                    {selectedConv.aiPaused ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
                    {selectedConv.aiPaused ? 'IA Pausada' : 'IA Activa'}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg, index) => (
                  <div key={msg.id || index} className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`bubble ${msg.fromMe ? 'bubble-outgoing' : 'bubble-incoming'}`}>
                      {msg.content}
                      <div className={`text-xs mt-1 ${msg.fromMe ? 'text-white/70' : 'text-[var(--text-muted)]'}`}>
                        {new Date(msg.timestamp).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-3 border-t border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
                <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar">
                  {!existingClient ? (
                    <button onClick={() => setShowAddClient(true)} className="btn-secondary text-xs py-2 whitespace-nowrap">
                      <UserPlus className="w-3 h-3" />Agregar CRM
                    </button>
                  ) : (
                    <span className="px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />En CRM
                    </span>
                  )}
                  <button onClick={() => setShowCreateOrder(true)} className="btn-secondary text-xs py-2 whitespace-nowrap">
                    <ShoppingCart className="w-3 h-3" />Pedido
                  </button>
                  <button onClick={() => setShowSchedule(true)} className="btn-secondary text-xs py-2 whitespace-nowrap">
                    <CalendarPlus className="w-3 h-3" />Agendar
                  </button>
                </div>
                <div className="flex gap-3">
                  <input type="text" placeholder="Escribe un mensaje..." value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()} className="input flex-1" />
                  <button onClick={sendMessage} disabled={sending || !newMessage.trim()} className="btn-primary px-4">
                    {sending ? <div className="loading-spinner w-5 h-5" /> : <Send className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)]">
              <img src="/elisa.png" alt="Elisa" className="w-24 h-24 rounded-2xl mb-6 opacity-50" />
              <h3 className="text-xl font-semibold text-white mb-2">Selecciona una conversación</h3>
              <p>Elige un chat de la lista</p>
            </div>
          )}
        </div>

        {/* Panel Info */}
        {selectedConv && (
          <div className="w-72 card p-4 space-y-4 overflow-y-auto no-scrollbar hidden xl:block">
            <div className="text-center">
              <div className="avatar-lg mx-auto mb-3">{selectedConv.recipientName?.[0] || '?'}</div>
              <h4 className="font-semibold text-white">{selectedConv.recipientName}</h4>
              <p className="text-sm text-[var(--text-muted)]">+{selectedConv.recipientId?.replace('@c.us', '')}</p>
            </div>

            <div className="p-3 rounded-xl bg-[var(--bg-tertiary)]">
              <p className="text-xs text-[var(--text-muted)] mb-2">Etapa del embudo</p>
              <div className={`px-3 py-2 rounded-lg text-sm font-medium border ${getStageColor(selectedConv.stage || 'new')}`}>
                {FUNNEL_STAGES.find(s => s.id === selectedConv.stage)?.label || 'Nuevo'}
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-2">
                {FUNNEL_STAGES.find(s => s.id === selectedConv.stage)?.description}
              </p>
            </div>

            {existingClient && (
              <div className="p-3 rounded-xl bg-[var(--bg-tertiary)] space-y-2">
                <p className="text-xs text-[var(--text-muted)]">Cliente en CRM</p>
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-[var(--accent-primary)]" />
                  <span className="text-sm text-white">{existingClient.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm text-emerald-400">${existingClient.totalPurchases?.toLocaleString() || 0}</span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <button onClick={() => setShowStageSelector(true)} className="btn-secondary w-full text-sm py-2">
                <Tag className="w-4 h-4" />Cambiar etiqueta
              </button>
              {!existingClient && (
                <button onClick={() => setShowAddClient(true)} className="btn-secondary w-full text-sm py-2">
                  <UserPlus className="w-4 h-4" />Agregar a CRM
                </button>
              )}
              <button onClick={() => setShowCreateOrder(true)} className="btn-primary w-full text-sm py-2">
                <ShoppingCart className="w-4 h-4" />Crear Pedido
              </button>
              <button onClick={() => setShowSchedule(true)} className="btn-secondary w-full text-sm py-2">
                <Calendar className="w-4 h-4" />Agendar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODALES */}
      
      {/* Selector de Etapa */}
      {showStageSelector && (
        <div className="modal-overlay" onClick={() => setShowStageSelector(false)}>
          <div className="modal-content max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Cambiar Etapa</h3>
              <button onClick={() => setShowStageSelector(false)} className="btn-icon"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-2">
              {FUNNEL_STAGES.map(stage => (
                <button key={stage.id} onClick={() => updateConversationStage(selectedConv.id, stage.id)}
                  className={`w-full p-4 rounded-xl border transition-all text-left ${
                    selectedConv?.stage === stage.id ? getStageColor(stage.id) : 'bg-[var(--bg-tertiary)] border-[var(--border-primary)] hover:border-[var(--accent-primary)]'
                  }`}>
                  <div className="font-medium text-white">{stage.label}</div>
                  <div className="text-sm text-[var(--text-muted)]">{stage.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Agregar Cliente */}
      {showAddClient && (
        <div className="modal-overlay" onClick={() => setShowAddClient(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Agregar al CRM</h3>
              <button onClick={() => setShowAddClient(false)} className="btn-icon"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div><label className="input-label">Nombre</label>
                <input type="text" value={clientForm.name} onChange={e => setClientForm({...clientForm, name: e.target.value})} className="input" /></div>
              <div><label className="input-label">Teléfono</label>
                <input type="text" value={clientForm.phone} onChange={e => setClientForm({...clientForm, phone: e.target.value})} className="input" /></div>
              <div><label className="input-label">Email</label>
                <input type="email" value={clientForm.email} onChange={e => setClientForm({...clientForm, email: e.target.value})} className="input" /></div>
              <div><label className="input-label">Dirección</label>
                <input type="text" value={clientForm.address} onChange={e => setClientForm({...clientForm, address: e.target.value})} className="input" /></div>
              <div><label className="input-label">Notas</label>
                <textarea value={clientForm.notes} onChange={e => setClientForm({...clientForm, notes: e.target.value})} className="input min-h-[80px]" /></div>
              <button onClick={saveClient} className="btn-primary w-full"><UserPlus className="w-4 h-4" />Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Crear Pedido */}
      {showCreateOrder && (
        <div className="modal-overlay" onClick={() => setShowCreateOrder(false)}>
          <div className="modal-content max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Crear Pedido</h3>
              <button onClick={() => setShowCreateOrder(false)} className="btn-icon"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-[var(--text-muted)] mb-3">Productos</p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {products.map(product => (
                    <div key={product.id} onClick={() => addProductToOrder(product)}
                      className="p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)] cursor-pointer hover:border-[var(--accent-primary)]">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-white">{product.name}</span>
                        <span className="text-[var(--accent-primary)]">${product.price?.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                  {products.length === 0 && <p className="text-center py-4 text-[var(--text-muted)]">No hay productos</p>}
                </div>
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)] mb-3">Pedido</p>
                <div className="space-y-2 max-h-48 overflow-y-auto mb-4">
                  {orderForm.products.map((p: any) => (
                    <div key={p.id} className="p-3 rounded-xl bg-[var(--accent-primary)]/10 flex items-center justify-between">
                      <span className="text-white">{p.name} x{p.quantity}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--accent-primary)]">${(p.price * p.quantity).toLocaleString()}</span>
                        <button onClick={() => removeProductFromOrder(p.id)} className="text-red-400"><X className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] mb-4">
                  <div className="flex justify-between"><span className="text-white">Total:</span>
                    <span className="text-2xl font-bold text-[var(--accent-primary)]">${orderForm.total.toLocaleString()}</span>
                  </div>
                </div>
                <button onClick={createOrder} disabled={orderForm.products.length === 0} className="btn-primary w-full">
                  <ShoppingCart className="w-4 h-4" />Crear Pedido
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Agendar */}
      {showSchedule && (
        <div className="modal-overlay" onClick={() => setShowSchedule(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Agendar</h3>
              <button onClick={() => setShowSchedule(false)} className="btn-icon"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="flex gap-2 p-1 bg-[var(--bg-tertiary)] rounded-xl">
                <button onClick={() => setScheduleForm({...scheduleForm, type: 'order'})}
                  className={`flex-1 py-2 rounded-lg font-medium ${scheduleForm.type === 'order' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)]'}`}>
                  <Package className="w-4 h-4 inline mr-2" />Entrega
                </button>
                <button onClick={() => setScheduleForm({...scheduleForm, type: 'appointment'})}
                  className={`flex-1 py-2 rounded-lg font-medium ${scheduleForm.type === 'appointment' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)]'}`}>
                  <Calendar className="w-4 h-4 inline mr-2" />Cita
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="input-label">Fecha</label>
                  <input type="date" value={scheduleForm.date} onChange={e => setScheduleForm({...scheduleForm, date: e.target.value})} className="input" /></div>
                <div><label className="input-label">Hora</label>
                  <input type="time" value={scheduleForm.time} onChange={e => setScheduleForm({...scheduleForm, time: e.target.value})} className="input" /></div>
              </div>
              <div><label className="input-label">Dirección</label>
                <input type="text" value={scheduleForm.address} onChange={e => setScheduleForm({...scheduleForm, address: e.target.value})} className="input" /></div>
              <div><label className="input-label">Notas</label>
                <textarea value={scheduleForm.notes} onChange={e => setScheduleForm({...scheduleForm, notes: e.target.value})} className="input min-h-[80px]" /></div>
              <button onClick={scheduleAppointment} className="btn-primary w-full">
                <CalendarPlus className="w-4 h-4" />{scheduleForm.type === 'order' ? 'Programar Entrega' : 'Agendar Cita'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mensaje Masivo */}
      {showMassMessage && (
        <div className="modal-overlay" onClick={() => setShowMassMessage(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Mensaje Masivo</h3>
              <button onClick={() => setShowMassMessage(false)} className="btn-icon"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
                <AlertCircle className="w-4 h-4 inline mr-2" />
                Se enviará a todos los contactos de la etapa seleccionada
              </div>
              <div><label className="input-label">Etapa</label>
                <select value={massMessageForm.stage} onChange={e => setMassMessageForm({...massMessageForm, stage: e.target.value})} className="input">
                  <option value="">-- Selecciona --</option>
                  {FUNNEL_STAGES.map(stage => (
                    <option key={stage.id} value={stage.id}>{stage.label} ({conversations.filter(c => c.stage === stage.id).length})</option>
                  ))}
                </select>
              </div>
              <div><label className="input-label">Mensaje</label>
                <textarea value={massMessageForm.message} onChange={e => setMassMessageForm({...massMessageForm, message: e.target.value})} 
                  className="input min-h-[120px]" placeholder="Escribe el mensaje..." /></div>
              <button onClick={sendMassMessage} disabled={!massMessageForm.stage || !massMessageForm.message} className="btn-primary w-full">
                <Megaphone className="w-4 h-4" />Enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

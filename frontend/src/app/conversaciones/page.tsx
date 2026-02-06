'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, Search, Send, X,
  Megaphone, PauseCircle, PlayCircle
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

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

const DEFAULT_STAGES = [
  { id: 'Saludo', label: 'Saludo', color: 'blue' },
  { id: 'Interesado', label: 'Interesado', color: 'cyan' },
  { id: 'En Cotización', label: 'En Cotización', color: 'yellow' },
  { id: 'Pendiente Info', label: 'Pendiente Info', color: 'orange' },
  { id: 'Realizó Pedido', label: 'Realizó Pedido', color: 'green' },
  { id: 'Confirmado', label: 'Confirmado', color: 'purple' },
  { id: 'Perdido', label: 'Perdido', color: 'red' },
];

export default function ConversacionesPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStage, setFilterStage] = useState('all');
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [funnelStages, setFunnelStages] = useState<any[]>(DEFAULT_STAGES);
  const [showMassMessage, setShowMassMessage] = useState(false);
  const [massText, setMassText] = useState('');
  const [sendingMass, setSendingMass] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const getLineId = () => localStorage.getItem('selectedLineId') || '';

  const getStageColor = (stageId: string) => {
    const stage = funnelStages.find(s => s.id === stageId);
    return STAGE_COLORS[stage?.color || 'blue'] || STAGE_COLORS.blue;
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    const onLineChanged = () => { setLoading(true); fetchData(); };
    window.addEventListener('lineChanged', onLineChanged);
    return () => { clearInterval(interval); window.removeEventListener('lineChanged', onLineChanged); };
  }, []);

  useEffect(() => {
    if (selectedConv) fetchMessages(selectedConv.id);
  }, [selectedConv]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchData = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const lineId = getLineId();
      const [convRes, stagesRes] = await Promise.all([
        fetch(`${API_URL}/api/conversations?lineId=${lineId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/stages?lineId=${lineId}`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      if (convRes.ok) {
        const data = await convRes.json();
        setConversations(data.conversations || []);
        if (selectedConv) {
          const updated = data.conversations?.find((c: any) => c.id === selectedConv.id);
          if (updated) setSelectedConv(updated);
        }
      }
      if (stagesRes.ok) {
        const data = await stagesRes.json();
        if (data.stages?.length) setFunnelStages(data.stages);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const fetchMessages = async (convId: string) => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/conversations/${convId}/messages`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setMessages((await res.json()).messages || []);
    } catch {}
  };

  const sendMessage = async () => {
    if (!selectedConv || !newMessage.trim() || sending) return;
    setSending(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selectedConv.recipientId, message: newMessage, lineId: getLineId() })
      });
      if (res.ok) {
        setNewMessage('');
        setTimeout(() => fetchMessages(selectedConv.id), 1000);
      }
    } catch {}
    finally { setSending(false); }
  };

  const toggleAIPause = async () => {
    if (!selectedConv) return;
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/conversations/${selectedConv.id}/pause`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: !selectedConv.aiPaused })
      });
      setSelectedConv({ ...selectedConv, aiPaused: !selectedConv.aiPaused });
      fetchData();
    } catch {}
  };

  const sendMassMessage = async () => {
    if (!massText.trim() || filterStage === 'all') return;
    setSendingMass(true);
    const token = localStorage.getItem('token');
    const targets = conversations.filter(c => c.stage === filterStage);
    for (const conv of targets) {
      try {
        await fetch(`${API_URL}/api/whatsapp/send`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: conv.recipientId, message: massText, lineId: getLineId() })
        });
        await new Promise(r => setTimeout(r, 1500));
      } catch {}
    }
    setSendingMass(false);
    setShowMassMessage(false);
    setMassText('');
    alert(`✅ Enviado a ${targets.length} contactos`);
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
      {/* Header compacto */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-6 h-6 text-[var(--accent-primary)]" />
          <div>
            <h1 className="text-xl font-bold text-white">Conversaciones</h1>
            <p className="text-xs text-[var(--text-muted)]">{conversations.length} chats</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select 
            value={filterStage} 
            onChange={(e) => setFilterStage(e.target.value)}
            className="input py-1.5 px-3 text-sm bg-[var(--bg-secondary)]"
          >
            <option value="all">📊 Todas ({conversations.length})</option>
            {stageStats.map(stage => (
              <option key={stage.id} value={stage.id}>
                {stage.label} ({stage.count})
              </option>
            ))}
          </select>
          <button 
            onClick={() => setShowMassMessage(true)} 
            disabled={filterStage === 'all'}
            className="btn-secondary py-1.5 px-3 text-sm disabled:opacity-50"
            title={filterStage === 'all' ? 'Selecciona una etapa primero' : 'Mensaje masivo'}
          >
            <Megaphone className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Contenido principal */}
      <div className="flex-1 flex gap-3 min-h-0 overflow-hidden">
        {/* Lista de conversaciones */}
        <div className="w-64 flex-shrink-0 flex flex-col bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] overflow-hidden">
          <div className="p-2 border-b border-[var(--border-primary)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input 
                type="text" 
                placeholder="Buscar..." 
                value={searchTerm} 
                onChange={(e) => setSearchTerm(e.target.value)} 
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-1.5 pl-8 pr-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" 
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredConversations.map((conv) => (
              <div 
                key={conv.id} 
                onClick={() => setSelectedConv(conv)}
                className={`p-2.5 border-b border-[var(--border-primary)] cursor-pointer hover:bg-white/5 transition-all ${
                  selectedConv?.id === conv.id ? 'bg-[var(--accent-primary)]/10 border-l-2 border-l-[var(--accent-primary)]' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-[var(--accent-primary)]/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-[var(--accent-primary)]">{conv.recipientName?.[0] || '?'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="font-medium text-white text-sm truncate">{conv.recipientName || 'Sin nombre'}</p>
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
            {filteredConversations.length === 0 && (
              <div className="p-4 text-center text-[var(--text-muted)] text-sm">
                No hay conversaciones
              </div>
            )}
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
                  <button 
                    onClick={toggleAIPause}
                    className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${
                      selectedConv.aiPaused ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400'
                    }`}
                  >
                    {selectedConv.aiPaused ? <PauseCircle className="w-3 h-3" /> : <PlayCircle className="w-3 h-3" />}
                    {selectedConv.aiPaused ? 'Pausada' : 'Activa'}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {messages.map((msg, idx) => (
                  <div key={msg.id || idx} className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
                      msg.fromMe 
                        ? 'bg-[var(--accent-primary)] text-white rounded-br-sm' 
                        : 'bg-[var(--bg-tertiary)] text-white rounded-bl-sm'
                    }`}>
                      {msg.mediaType === 'image' && msg.mediaUrl && (
                        <img src={msg.mediaUrl} alt="" className="max-w-[200px] rounded-lg mb-1" />
                      )}
                      {msg.mediaType === 'audio' && <div className="text-xs opacity-80">🎵 Audio</div>}
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
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Escribe un mensaje..." 
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()} 
                    className="flex-1 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" 
                  />
                  <button onClick={sendMessage} disabled={sending || !newMessage.trim()} className="btn-primary px-4 py-2 disabled:opacity-50">
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
          <div className="w-52 flex-shrink-0 hidden xl:flex flex-col bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] p-3 gap-3 overflow-y-auto">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-[var(--accent-primary)]/20 flex items-center justify-center mb-2">
                <span className="text-lg font-bold text-[var(--accent-primary)]">{selectedConv.recipientName?.[0] || '?'}</span>
              </div>
              <h4 className="font-semibold text-white text-sm">{selectedConv.recipientName}</h4>
              <p className="text-[10px] text-[var(--text-muted)]">+{selectedConv.recipientId?.replace('@c.us', '')}</p>
            </div>

            <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Etapa actual</p>
              <div className={`px-2 py-1 rounded text-xs text-center border ${getStageColor(selectedConv.stage || 'Saludo')}`}>
                {funnelStages.find(s => s.id === selectedConv.stage)?.label || selectedConv.stage || 'Saludo'}
              </div>
              <p className="text-[9px] text-emerald-400 text-center mt-1">✨ Auto-detectada</p>
            </div>

            {selectedConv.contextData && Object.keys(selectedConv.contextData).length > 0 && (
              <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                <p className="text-[10px] text-[var(--text-muted)] mb-1">📋 Datos</p>
                <div className="space-y-1">
                  {Object.entries(selectedConv.contextData as Record<string, any>)
                    .filter(([k, v]) => v && v !== '' && !['etapa_actual', 'paso_actual', 'accion', 'pedido', 'cita'].includes(k))
                    .slice(0, 5)
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

      {/* Modal mensaje masivo */}
      {showMassMessage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowMassMessage(false)}>
          <div className="bg-[var(--bg-secondary)] rounded-xl p-4 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Mensaje Masivo</h3>
              <button onClick={() => setShowMassMessage(false)} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-[var(--text-muted)] mb-3">
              Enviar a: <strong className="text-white">{funnelStages.find(s => s.id === filterStage)?.label}</strong> ({conversations.filter(c => c.stage === filterStage).length} contactos)
            </p>
            <textarea 
              value={massText}
              onChange={(e) => setMassText(e.target.value)}
              placeholder="Escribe tu mensaje..."
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg p-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] min-h-[100px] resize-none mb-3"
            />
            <button 
              onClick={sendMassMessage} 
              disabled={sendingMass || !massText.trim()}
              className="btn-primary w-full py-2 disabled:opacity-50"
            >
              {sendingMass ? 'Enviando...' : `Enviar a ${conversations.filter(c => c.stage === filterStage).length} contactos`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

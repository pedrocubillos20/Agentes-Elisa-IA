'use client';

import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Search, Send, User, Bot, PauseCircle, PlayCircle, Trash2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function ConversacionesPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConversations();
  }, []);

  useEffect(() => {
    if (selectedConv) fetchMessages(selectedConv.id);
  }, [selectedConv]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchConversations = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/conversations`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setConversations((await res.json()).conversations || []);
    } catch (error) { console.error('Error:', error); }
    finally { setLoading(false); }
  };

  const fetchMessages = async (id: string) => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/conversations/${id}/messages`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setMessages((await res.json()).messages || []);
    } catch (error) { console.error('Error:', error); }
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
    } catch (error) { console.error('Error:', error); }
    finally { setSending(false); }
  };

  const filteredConversations = conversations.filter(c =>
    c.recipientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.recipientId?.includes(searchTerm)
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
    <div className="h-[calc(100vh-140px)] flex gap-6">
      {/* Sidebar - Lista de conversaciones */}
      <div className="w-80 flex flex-col card p-0 overflow-hidden">
        <div className="p-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3 mb-4">
            <img src="/elisa.png" alt="Elisa" className="w-10 h-10 rounded-xl" />
            <h2 className="text-lg font-semibold text-white">Conversaciones</h2>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input type="text" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="input pl-10 py-2 text-sm" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar">
          {filteredConversations.map((conv) => (
            <div key={conv.id} onClick={() => setSelectedConv(conv)}
              className={`p-4 border-b border-[var(--border-primary)] cursor-pointer transition-all hover:bg-white/5 ${selectedConv?.id === conv.id ? 'bg-[var(--accent-primary)]/10 border-l-2 border-l-[var(--accent-primary)]' : ''}`}>
              <div className="flex items-center gap-3">
                <div className="avatar">{conv.recipientName?.[0] || '?'}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white truncate">{conv.recipientName || conv.recipientId}</p>
                  <p className="text-sm text-[var(--text-muted)] truncate">{conv.lastMessage || 'Sin mensajes'}</p>
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

      {/* Main - Chat */}
      <div className="flex-1 flex flex-col card p-0 overflow-hidden">
        {selectedConv ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-[var(--border-primary)] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="avatar-lg">{selectedConv.recipientName?.[0] || '?'}</div>
                <div>
                  <h3 className="font-semibold text-white">{selectedConv.recipientName || selectedConv.recipientId}</h3>
                  <p className="text-sm text-[var(--text-muted)]">+{selectedConv.recipientId}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge badge-success">IA Activa</span>
              </div>
            </div>

            {/* Messages */}
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

            {/* Input */}
            <div className="p-4 border-t border-[var(--border-primary)]">
              <div className="flex gap-3">
                <input type="text" placeholder="Escribe un mensaje..." value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  className="input flex-1" />
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
            <p>Elige una conversación de la lista para ver los mensajes</p>
          </div>
        )}
      </div>
    </div>
  );
}

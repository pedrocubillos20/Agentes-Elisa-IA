'use client';

import { useState, useEffect } from 'react';
import { 
  MessageSquare, 
  User, 
  Clock, 
  ChevronRight,
  Search,
  Trash2,
  Pause,
  Play,
  Bot,
  Send
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Conversation {
  id: string;
  recipientId: string;
  recipientName?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  aiPaused?: boolean;
  _count: { messages: number };
}

interface Message {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  fromMe: boolean;
}

export default function ConversacionesPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/conversations?limit=50`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (conversationId: string) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    setLoadingMessages(true);

    try {
      const res = await fetch(`${API_URL}/api/conversations/${conversationId}/messages?limit=100`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSelectConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    fetchMessages(conversation.id);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('¿Eliminar esta conversación?')) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/conversations/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        setConversations(conversations.filter(c => c.id !== id));
        if (selectedConversation?.id === id) {
          setSelectedConversation(null);
          setMessages([]);
        }
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  // Pausar o reanudar IA
  const toggleAiPause = async (conversationId: string, pause: boolean) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/conversations/${conversationId}/ai-pause`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ paused: pause })
      });

      if (res.ok) {
        // Actualizar estado local
        setConversations(convs => 
          convs.map(c => c.id === conversationId ? { ...c, aiPaused: pause } : c)
        );
        if (selectedConversation?.id === conversationId) {
          setSelectedConversation(prev => prev ? { ...prev, aiPaused: pause } : null);
        }
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  // Enviar mensaje manual (como humano)
  const sendManualMessage = async () => {
    if (!newMessage.trim() || !selectedConversation) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    setSending(true);

    try {
      const res = await fetch(`${API_URL}/api/conversations/${selectedConversation.id}/send`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: newMessage })
      });

      if (res.ok) {
        setNewMessage('');
        // Recargar mensajes
        fetchMessages(selectedConversation.id);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setSending(false);
    }
  };

  const filteredConversations = conversations.filter(c => 
    c.recipientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.recipientId.includes(searchTerm)
  );

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Ayer';
    } else if (days < 7) {
      return date.toLocaleDateString('es', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('es', { day: '2-digit', month: 'short' });
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
    <div className="h-[calc(100vh-8rem)] flex gap-6">
      {/* Conversations List */}
      <div className="w-full md:w-96 flex flex-col bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-700">
          <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-4">
            <MessageSquare className="w-5 h-5 text-emerald-400" />
            Conversaciones
          </h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center">
              <MessageSquare className="w-12 h-12 text-slate-500 mx-auto mb-3" />
              <p className="text-slate-400">No hay conversaciones</p>
            </div>
          ) : (
            filteredConversations.map((conversation) => (
              <div
                key={conversation.id}
                onClick={() => handleSelectConversation(conversation)}
                className={`p-4 border-b border-slate-700/50 cursor-pointer transition-all duration-200 group ${
                  selectedConversation?.id === conversation.id
                    ? 'bg-emerald-500/10'
                    : 'hover:bg-slate-700/30'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center flex-shrink-0">
                      <User className="w-5 h-5 text-slate-300" />
                    </div>
                    {/* Indicador de estado IA */}
                    {conversation.aiPaused && (
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-yellow-500 rounded-full flex items-center justify-center">
                        <Pause className="w-3 h-3 text-black" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-white truncate flex items-center gap-2">
                        {conversation.recipientName || `+${conversation.recipientId}`}
                        {conversation.aiPaused && (
                          <span className="text-xs px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
                            Humano
                          </span>
                        )}
                      </h3>
                      <span className="text-xs text-slate-400">
                        {formatDate(conversation.lastMessageAt)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400 truncate mt-1">
                      {conversation.lastMessage || 'Sin mensajes'}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-500">
                        {conversation._count.messages} mensajes
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(conversation.id, e)}
                    className="p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Messages Panel */}
      <div className="hidden md:flex flex-1 flex-col bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
        {selectedConversation ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center">
                  <User className="w-5 h-5 text-slate-300" />
                </div>
                <div>
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    {selectedConversation.recipientName || `+${selectedConversation.recipientId}`}
                    {selectedConversation.aiPaused ? (
                      <span className="text-xs px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full flex items-center gap-1">
                        <Pause className="w-3 h-3" />
                        Modo Humano
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center gap-1">
                        <Bot className="w-3 h-3" />
                        IA Activa
                      </span>
                    )}
                  </h3>
                  <p className="text-sm text-slate-400">
                    +{selectedConversation.recipientId}
                  </p>
                </div>
              </div>
              
              {/* Botón para pausar/reanudar IA */}
              <button
                onClick={() => toggleAiPause(selectedConversation.id, !selectedConversation.aiPaused)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                  selectedConversation.aiPaused
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400'
                }`}
              >
                {selectedConversation.aiPaused ? (
                  <>
                    <Play className="w-4 h-4" />
                    Reanudar IA
                  </>
                ) : (
                  <>
                    <Pause className="w-4 h-4" />
                    Pausar IA
                  </>
                )}
              </button>
            </div>

            {/* Aviso de modo humano */}
            {selectedConversation.aiPaused && (
              <div className="px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/30">
                <p className="text-sm text-yellow-400 flex items-center gap-2">
                  <Pause className="w-4 h-4" />
                  <span>
                    <strong>Modo Humano activo:</strong> La IA no responderá. Escribe <code className="bg-yellow-500/20 px-1 rounded">.</code> en el chat para reactivarla.
                  </span>
                </p>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loadingMessages ? (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center text-slate-400 py-8">
                  No hay mensajes
                </div>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.fromMe ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                        message.fromMe
                          ? 'bg-emerald-600 text-white rounded-br-sm'
                          : 'bg-slate-700 text-white rounded-bl-sm'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{message.content}</p>
                      <p className={`text-xs mt-1 ${
                        message.fromMe ? 'text-emerald-200' : 'text-slate-400'
                      }`}>
                        {message.role === 'assistant' && '🤖 '}
                        {new Date(message.timestamp).toLocaleTimeString('es', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Input para enviar mensaje manual */}
            {selectedConversation.aiPaused && (
              <div className="p-4 border-t border-slate-700">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendManualMessage()}
                    placeholder="Escribe un mensaje como humano..."
                    className="flex-1 px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    onClick={sendManualMessage}
                    disabled={sending || !newMessage.trim()}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-all duration-200 flex items-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Tip: Escribe <code className="bg-slate-700 px-1 rounded">.</code> para reactivar la IA
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-400">
                Selecciona una conversación
              </h3>
              <p className="text-slate-500 mt-2">
                Elige una conversación de la lista para ver los mensajes
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

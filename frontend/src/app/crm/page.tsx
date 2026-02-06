'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Users, Package, Plus, Search, Edit2, Trash2, Phone, Mail, X, 
  Send, MessageSquare, LayoutGrid, Sparkles
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Stage { id: string; label: string; color: string; }
interface Conversation { id: string; recipientId: string; recipientName: string; lastMessage: string; stage: string; updatedAt: string; aiPaused: boolean; }

const DEFAULT_STAGES: Stage[] = [
  { id: 'Saludo', label: 'Saludo', color: 'blue' },
  { id: 'Interesado', label: 'Interesado', color: 'cyan' },
  { id: 'En Cotización', label: 'En Cotización', color: 'yellow' },
  { id: 'Pendiente Color', label: 'Pendiente Color', color: 'orange' },
  { id: 'Pendiente Talla', label: 'Pendiente Talla', color: 'orange' },
  { id: 'Pendiente Calidad', label: 'Pendiente Calidad', color: 'orange' },
  { id: 'Realizó Pedido', label: 'Realizó Pedido', color: 'green' },
  { id: 'Pendiente Pago', label: 'Pendiente Pago', color: 'pink' },
  { id: 'Confirmado', label: 'Confirmado', color: 'purple' },
  { id: 'Perdido', label: 'Perdido', color: 'red' },
];

const STAGE_COLORS: Record<string, string> = {
  blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  cyan: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  orange: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  green: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  pink: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  red: 'bg-red-500/20 text-red-400 border-red-500/30',
};

export default function CRMPage() {
  const [activeTab, setActiveTab] = useState<'pipeline' | 'clients' | 'products'>('pipeline');
  const [stages, setStages] = useState<Stage[]>(DEFAULT_STAGES);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStage, setSelectedStage] = useState('');
  
  const [showMassMessage, setShowMassMessage] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  
  const [massMessageText, setMassMessageText] = useState('');
  const [sendingMass, setSendingMass] = useState(false);

  const [editingItem, setEditingItem] = useState<any>(null);
  const [clientForm, setClientForm] = useState({ name: '', phone: '', email: '', status: 'lead', tags: '' });
  const [productForm, setProductForm] = useState({ name: '', description: '', price: '', stock: '', category: '' });

  const getLineId = () => localStorage.getItem('selectedLineId') || '';

  // Guardar referencia de la línea actual para evitar parpadeo
  const currentLineIdRef = useRef<string>('');

  useEffect(() => {
    fetchAll();
    const onLineChanged = () => { 
      // Limpiar etapas anteriores antes de cargar las nuevas
      currentLineIdRef.current = getLineId();
      setLoading(true); 
      fetchAll(); 
    };
    window.addEventListener('lineChanged', onLineChanged);
    
    // 🔄 AUTO-REFRESH: Actualizar conversaciones cada 2 segundos
    const autoRefreshInterval = setInterval(() => {
      fetchConversationsOnly();
    }, 2000);
    
    // 🎯 AUTO-SYNC ETAPAS: Sincronizar etapas cada 5 segundos
    const stageSyncInterval = setInterval(() => {
      // Solo sincronizar si la línea no ha cambiado
      if (currentLineIdRef.current === getLineId()) {
        syncStages();
      }
    }, 5000);
    
    return () => {
      window.removeEventListener('lineChanged', onLineChanged);
      clearInterval(autoRefreshInterval);
      clearInterval(stageSyncInterval);
    };
  }, []);

  // Sincronizar etapas basándose en datos guardados (sin IA, rápido)
  const syncStages = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      await fetch(`${API_URL}/api/whatsapp/quick-stage-sync`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId: getLineId() })
      });
    } catch (e) { /* silencioso */ }
  };

  // 🎯 DETECTAR ETAPAS MANUALMENTE (con IA)
  const [detecting, setDetecting] = useState(false);
  const detectStages = async () => {
    const token = localStorage.getItem('token');
    if (!token || detecting) return;
    
    setDetecting(true);
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/analyze-stages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId: getLineId() })
      });
      
      if (res.ok) {
        const data = await res.json();
        alert(`✅ Detección completada!\n\n📊 Analizadas: ${data.analyzed}\n🔄 Actualizadas: ${data.updated}`);
        fetchConversationsOnly(); // Refrescar lista
      } else {
        const err = await res.json();
        alert(`❌ Error: ${err.error || 'Error desconocido'}`);
      }
    } catch (e: any) {
      alert(`❌ Error: ${e.message}`);
    } finally {
      setDetecting(false);
    }
  };

  // Función ligera que solo actualiza conversaciones (para auto-refresh)
  const fetchConversationsOnly = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/conversations?lineId=${getLineId()}`, { 
        headers: { 'Authorization': `Bearer ${token}` } 
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (e) { /* silencioso para no llenar consola */ }
  };

  const fetchAll = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    // Capturar lineId al inicio de la petición
    const requestLineId = getLineId();
    currentLineIdRef.current = requestLineId;
    
    try {
      const [userRes, stagesRes, convsRes, clientsRes, productsRes] = await Promise.all([
        fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/stages?lineId=${requestLineId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/conversations?lineId=${requestLineId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/clients?lineId=${requestLineId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/products?lineId=${requestLineId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
      ]);
      
      // Solo actualizar si la línea no cambió durante la carga
      if (currentLineIdRef.current !== requestLineId) {
        console.log('⚠️ Línea cambió durante carga, ignorando respuesta');
        return;
      }
      
      if (userRes.ok) setUser((await userRes.json()).user);
      if (stagesRes.ok) { const d = await stagesRes.json(); if (d.stages?.length) setStages(d.stages); }
      if (convsRes.ok) setConversations((await convsRes.json()).conversations || []);
      if (clientsRes.ok) setClients((await clientsRes.json()).clients || []);
      if (productsRes.ok) setProducts((await productsRes.json()).products || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const getConvsByStage = (stageId: string) => conversations.filter(c => c.stage === stageId);

  const sendMassMessage = async () => {
    if (!selectedStage || !massMessageText.trim()) return;
    setSendingMass(true);
    const token = localStorage.getItem('token');
    const stageConvs = getConvsByStage(selectedStage);
    let sent = 0;
    for (const conv of stageConvs) {
      try {
        const res = await fetch(`${API_URL}/api/whatsapp/send`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: conv.recipientId, message: massMessageText, lineId: getLineId() })
        });
        if (res.ok) sent++;
        await new Promise(r => setTimeout(r, 1500));
      } catch {}
    }
    alert(`✅ Enviado a ${sent} contactos`);
    setSendingMass(false);
    setShowMassMessage(false);
    setMassMessageText('');
  };

  const handleSaveClient = async () => {
    const token = localStorage.getItem('token');
    const method = editingItem ? 'PUT' : 'POST';
    const url = editingItem ? `${API_URL}/api/clients/${editingItem.id}` : `${API_URL}/api/clients`;
    try {
      const res = await fetch(url, {
        method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...clientForm, tags: clientForm.tags ? clientForm.tags.split(',').map(t => t.trim()) : [], lineId: getLineId() })
      });
      if (res.ok) { fetchAll(); setShowClientModal(false); resetForms(); }
    } catch (e) { console.error(e); }
  };

  const handleSaveProduct = async () => {
    const token = localStorage.getItem('token');
    const method = editingItem ? 'PUT' : 'POST';
    const url = editingItem ? `${API_URL}/api/products/${editingItem.id}` : `${API_URL}/api/products`;
    try {
      const res = await fetch(url, {
        method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...productForm, price: parseFloat(productForm.price) || 0, stock: parseInt(productForm.stock) || 0, lineId: getLineId() })
      });
      if (res.ok) { fetchAll(); setShowProductModal(false); resetForms(); }
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (type: 'client' | 'product', id: string) => {
    if (!confirm('¿Eliminar?')) return;
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/api/${type === 'client' ? 'clients' : 'products'}/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    fetchAll();
  };

  const resetForms = () => {
    setEditingItem(null);
    setClientForm({ name: '', phone: '', email: '', status: 'lead', tags: '' });
    setProductForm({ name: '', description: '', price: '', stock: '', category: '' });
  };

  const stats = {
    total: conversations.length,
    clients: clients.length,
    revenue: clients.reduce((sum, c) => sum + (c.totalPurchases || 0), 0),
    products: products.length
  };

  // Verificar plan
  if (user && user.plan === 'starter' && !user.parentUserId) {
    return (
      <div className="h-[calc(100vh-120px)] flex items-center justify-center">
        <div className="text-center p-8 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] max-w-md">
          <Users className="w-12 h-12 mx-auto mb-4 text-[var(--accent-primary)]" />
          <h2 className="text-xl font-bold text-white mb-2">CRM en Plan Business</h2>
          <p className="text-[var(--text-muted)] mb-4">Gestiona tu pipeline con vista completa.</p>
          <a href="/subscription" className="btn-primary inline-flex items-center gap-2"><Sparkles className="w-4 h-4" /> Actualizar</a>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-[calc(100vh-120px)] flex items-center justify-center">
        <div className="loading-spinner w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col gap-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <LayoutGrid className="w-6 h-6 text-[var(--accent-primary)]" />
          <div>
            <h1 className="text-xl font-bold text-white">CRM Pipeline</h1>
            <p className="text-xs text-[var(--text-muted)]">{stats.total} en pipeline • {stats.clients} clientes</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => activeTab === 'products' ? setShowProductModal(true) : setShowClientModal(true)} className="btn-primary py-1.5 px-3 text-sm">
            <Plus className="w-4 h-4" /> Nuevo
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[var(--border-primary)] pb-3 flex-shrink-0">
        {(['pipeline', 'clients', 'products'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'
            }`}>
            {tab === 'pipeline' ? <LayoutGrid className="w-4 h-4" /> : tab === 'clients' ? <Users className="w-4 h-4" /> : <Package className="w-4 h-4" />}
            {tab === 'pipeline' ? 'Pipeline' : tab === 'clients' ? 'Clientes' : 'Productos'}
          </button>
        ))}
        {activeTab === 'pipeline' && (
          <>
            <button 
              onClick={detectStages}
              disabled={detecting}
              className={`ml-auto text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1.5 transition-all ${
                detecting 
                  ? 'text-gray-400 bg-gray-500/10 border-gray-500/30 cursor-wait' 
                  : 'text-purple-400 bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20'
              }`}
            >
              {detecting ? (
                <>
                  <div className="w-3 h-3 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin"></div>
                  Detectando...
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" />
                  Detectar etapas
                </>
              )}
            </button>
            <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/30 flex items-center gap-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Auto-refresh
            </span>
          </>
        )}
      </div>

      {/* PIPELINE */}
      {activeTab === 'pipeline' && (
        <div className="flex-1 flex flex-col gap-3 overflow-hidden">
          {/* Filtros */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar..." className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg py-1.5 pl-9 pr-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
            </div>
            <select 
              value={selectedStage} 
              onChange={(e) => setSelectedStage(e.target.value)}
              className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg py-1.5 px-3 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)]"
            >
              <option value="">📊 Todas las etapas</option>
              {stages.map(stage => (
                <option key={stage.id} value={stage.id}>{stage.label} ({getConvsByStage(stage.id).length})</option>
              ))}
            </select>
            <button 
              onClick={() => setShowMassMessage(true)} 
              disabled={!selectedStage}
              className="btn-secondary py-1.5 px-3 text-sm disabled:opacity-50"
              title={!selectedStage ? 'Selecciona una etapa' : 'Mensaje masivo'}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

          {/* Chips de etapas */}
          <div className="flex flex-wrap gap-2 flex-shrink-0">
            {stages.map(stage => {
              const count = getConvsByStage(stage.id).length;
              return (
                <button
                  key={stage.id}
                  onClick={() => setSelectedStage(selectedStage === stage.id ? '' : stage.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                    selectedStage === stage.id 
                      ? STAGE_COLORS[stage.color] || STAGE_COLORS.blue
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border-transparent hover:border-[var(--border-primary)]'
                  }`}
                >
                  {stage.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Grid de conversaciones */}
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {(selectedStage ? getConvsByStage(selectedStage) : conversations)
                .filter(c => !searchTerm || c.recipientName?.toLowerCase().includes(searchTerm.toLowerCase()) || c.recipientId?.includes(searchTerm))
                .map((conv) => {
                  const stage = stages.find(s => s.id === conv.stage);
                  return (
                    <div key={conv.id} className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] hover:border-[var(--accent-primary)]/50 transition-all">
                      <div className="flex items-start gap-2">
                        <div className="w-9 h-9 rounded-full bg-[var(--accent-primary)]/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-semibold text-[var(--accent-primary)]">{conv.recipientName?.[0] || '?'}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-white text-sm truncate">{conv.recipientName || conv.recipientId}</p>
                          <p className="text-[10px] text-[var(--text-muted)] truncate">{conv.lastMessage || 'Sin mensajes'}</p>
                          <div className="flex items-center justify-between mt-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${STAGE_COLORS[stage?.color || 'blue']}`}>
                              {stage?.label || conv.stage}
                            </span>
                            <a href={`/conversaciones?id=${conv.id}`} className="text-[10px] text-[var(--accent-primary)] hover:underline">Ver →</a>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
            {conversations.length === 0 && (
              <div className="text-center py-12 text-[var(--text-muted)]">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No hay conversaciones</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CLIENTES */}
      {activeTab === 'clients' && (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {clients.filter(c => !searchTerm || c.name?.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone?.includes(searchTerm))
              .map((client) => (
                <div key={client.id} className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
                        <span className="text-sm font-semibold text-cyan-400">{client.name?.[0] || '?'}</span>
                      </div>
                      <div>
                        <p className="font-medium text-white">{client.name}</p>
                        <p className="text-xs text-[var(--text-muted)] flex items-center gap-1"><Phone className="w-3 h-3" />{client.phone}</p>
                        {client.email && <p className="text-xs text-[var(--text-muted)] flex items-center gap-1"><Mail className="w-3 h-3" />{client.email}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditingItem(client); setClientForm({ ...client, tags: client.tags?.join(', ') || '' }); setShowClientModal(true); }} className="p-1.5 hover:bg-white/10 rounded-lg"><Edit2 className="w-3.5 h-3.5 text-[var(--text-muted)]" /></button>
                      <button onClick={() => handleDelete('client', client.id)} className="p-1.5 hover:bg-red-500/10 rounded-lg"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                    </div>
                  </div>
                  {client.totalPurchases > 0 && (
                    <p className="mt-2 text-xs text-emerald-400">💰 ${client.totalPurchases.toLocaleString()}</p>
                  )}
                </div>
              ))}
          </div>
          {clients.length === 0 && (
            <div className="text-center py-12 text-[var(--text-muted)]">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay clientes</p>
              <button onClick={() => setShowClientModal(true)} className="btn-primary mt-4"><Plus className="w-4 h-4" /> Agregar</button>
            </div>
          )}
        </div>
      )}

      {/* PRODUCTOS */}
      {activeTab === 'products' && (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {products.filter(p => !searchTerm || p.name?.toLowerCase().includes(searchTerm.toLowerCase()))
              .map((product) => (
                <div key={product.id} className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white truncate">{product.name}</p>
                      <p className="text-lg font-bold text-emerald-400">${product.price?.toLocaleString()}</p>
                      <p className="text-xs text-[var(--text-muted)]">Stock: {product.stock}</p>
                      {product.category && <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-400">{product.category}</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditingItem(product); setProductForm({ ...product, price: product.price?.toString() || '', stock: product.stock?.toString() || '' }); setShowProductModal(true); }} className="p-1.5 hover:bg-white/10 rounded-lg"><Edit2 className="w-3.5 h-3.5 text-[var(--text-muted)]" /></button>
                      <button onClick={() => handleDelete('product', product.id)} className="p-1.5 hover:bg-red-500/10 rounded-lg"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
          {products.length === 0 && (
            <div className="text-center py-12 text-[var(--text-muted)]">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay productos</p>
              <button onClick={() => setShowProductModal(true)} className="btn-primary mt-4"><Plus className="w-4 h-4" /> Agregar</button>
            </div>
          )}
        </div>
      )}

      {/* MODALES */}
      
      {/* Modal Mensaje Masivo */}
      {showMassMessage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowMassMessage(false)}>
          <div className="bg-[var(--bg-secondary)] rounded-xl p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Mensaje Masivo</h3>
              <button onClick={() => setShowMassMessage(false)} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-[var(--text-muted)] mb-3">
              Enviar a: <strong className="text-white">{stages.find(s => s.id === selectedStage)?.label}</strong> ({getConvsByStage(selectedStage).length} contactos)
            </p>
            <textarea value={massMessageText} onChange={(e) => setMassMessageText(e.target.value)} placeholder="Escribe tu mensaje..." className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg p-3 text-sm text-white placeholder-[var(--text-muted)] min-h-[100px] resize-none mb-3 focus:outline-none focus:border-[var(--accent-primary)]" />
            <button onClick={sendMassMessage} disabled={sendingMass || !massMessageText.trim()} className="btn-primary w-full py-2 disabled:opacity-50">
              {sendingMass ? 'Enviando...' : `Enviar a ${getConvsByStage(selectedStage).length} contactos`}
            </button>
          </div>
        </div>
      )}

      {/* Modal Cliente */}
      {showClientModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowClientModal(false)}>
          <div className="bg-[var(--bg-secondary)] rounded-xl p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">{editingItem ? 'Editar' : 'Nuevo'} Cliente</h3>
              <button onClick={() => { setShowClientModal(false); resetForms(); }} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <input type="text" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} placeholder="Nombre *" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              <input type="text" value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} placeholder="Teléfono *" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              <input type="email" value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} placeholder="Email" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              <input type="text" value={clientForm.tags} onChange={(e) => setClientForm({ ...clientForm, tags: e.target.value })} placeholder="Etiquetas (VIP, Frecuente)" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              <button onClick={handleSaveClient} className="btn-primary w-full py-2">{editingItem ? 'Actualizar' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Producto */}
      {showProductModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowProductModal(false)}>
          <div className="bg-[var(--bg-secondary)] rounded-xl p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">{editingItem ? 'Editar' : 'Nuevo'} Producto</h3>
              <button onClick={() => { setShowProductModal(false); resetForms(); }} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <input type="text" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} placeholder="Nombre *" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              <textarea value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} placeholder="Descripción" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] min-h-[60px] resize-none focus:outline-none focus:border-[var(--accent-primary)]" />
              <div className="grid grid-cols-2 gap-3">
                <input type="number" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} placeholder="Precio" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
                <input type="number" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })} placeholder="Stock" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              </div>
              <input type="text" value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} placeholder="Categoría" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              <button onClick={handleSaveProduct} className="btn-primary w-full py-2">{editingItem ? 'Actualizar' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

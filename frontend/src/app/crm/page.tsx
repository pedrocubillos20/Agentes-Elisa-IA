'use client';

import { useState, useEffect } from 'react';
import { 
  Users, Package, Plus, Search, Edit2, Trash2, Phone, Mail, X, Box, 
  GripVertical, Send, MessageSquare, Settings, RefreshCw, Sparkles,
  LayoutGrid, CheckCircle, AlertCircle
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Stage { id: string; label: string; color: string; description?: string; }
interface Conversation { id: string; recipientId: string; recipientName: string; lastMessage: string; stage: string; updatedAt: string; aiPaused: boolean; }

const DEFAULT_STAGES: Stage[] = [
  { id: 'Saludo', label: 'Saludo', color: 'blue' },
  { id: 'Interesado', label: 'Interesado', color: 'cyan' },
  { id: 'En Cotización', label: 'En Cotización', color: 'yellow' },
  { id: 'Pendiente Color', label: 'Pendiente Color', color: 'orange' },
  { id: 'Pendiente Talla', label: 'Pendiente Talla', color: 'purple' },
  { id: 'Realizó Pedido', label: 'Realizó Pedido', color: 'green' },
  { id: 'Pendiente Calidad', label: 'Pendiente Calidad', color: 'pink' },
  { id: 'Confirmar Perdido', label: 'Confirmar Perdido', color: 'red' },
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
  gray: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const COLUMN_BG: Record<string, string> = {
  blue: 'border-t-blue-500', cyan: 'border-t-cyan-500', yellow: 'border-t-yellow-500',
  orange: 'border-t-orange-500', purple: 'border-t-purple-500', green: 'border-t-emerald-500',
  pink: 'border-t-pink-500', red: 'border-t-red-500', gray: 'border-t-gray-500',
};

export default function CRMKanbanPage() {
  const [activeTab, setActiveTab] = useState<'pipeline' | 'clients' | 'products'>('pipeline');
  const [stages, setStages] = useState<Stage[]>(DEFAULT_STAGES);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [draggedItem, setDraggedItem] = useState<Conversation | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  
  const [showMassMessage, setShowMassMessage] = useState(false);
  const [showStageConfig, setShowStageConfig] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  
  const [selectedStage, setSelectedStage] = useState('');
  const [massMessageText, setMassMessageText] = useState('');
  const [sendingMass, setSendingMass] = useState(false);
  const [massMessageResult, setMassMessageResult] = useState<{sent: number; failed: number} | null>(null);
  const [syncingStages, setSyncingStages] = useState(false);

  const [editingItem, setEditingItem] = useState<any>(null);
  const [clientForm, setClientForm] = useState({ name: '', phone: '', email: '', status: 'lead', tags: '' });
  const [productForm, setProductForm] = useState({ name: '', description: '', price: '', stock: '', category: '' });

  const getLineId = () => localStorage.getItem('selectedLineId') || '';

  useEffect(() => {
    fetchAll();
    const onLineChanged = () => { setLoading(true); fetchAll(); };
    window.addEventListener('lineChanged', onLineChanged);
    return () => window.removeEventListener('lineChanged', onLineChanged);
  }, []);

  const fetchAll = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const [userRes, stagesRes, convsRes, clientsRes, productsRes] = await Promise.all([
        fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/stages?lineId=${getLineId()}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/conversations?lineId=${getLineId()}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/clients?lineId=${getLineId()}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/products?lineId=${getLineId()}`, { headers: { 'Authorization': `Bearer ${token}` } }),
      ]);
      if (userRes.ok) setUser((await userRes.json()).user);
      if (stagesRes.ok) { const d = await stagesRes.json(); if (d.stages?.length) setStages(d.stages); }
      if (convsRes.ok) setConversations((await convsRes.json()).conversations || []);
      if (clientsRes.ok) setClients((await clientsRes.json()).clients || []);
      if (productsRes.ok) setProducts((await productsRes.json()).products || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const syncStagesFromAssistant = async () => {
    setSyncingStages(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/assistants?lineId=${getLineId()}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) throw new Error('Error');
      const data = await res.json();
      const assistant = data.assistants?.[0];
      if (!assistant?.context) { alert('No hay base de conocimiento'); setSyncingStages(false); return; }
      const extracted = parseStagesFromContext(assistant.context);
      if (extracted.length === 0) { alert('No se encontraron etapas'); setSyncingStages(false); return; }
      const saveRes = await fetch(`${API_URL}/api/stages`, {
        method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages: extracted })
      });
      if (saveRes.ok) { setStages(extracted); alert(`✅ ${extracted.length} etapas sincronizadas`); }
    } catch (e) { alert('Error al sincronizar'); }
    finally { setSyncingStages(false); }
  };

  const parseStagesFromContext = (context: string): Stage[] => {
    const stages: Stage[] = [];
    const colors = ['blue', 'cyan', 'yellow', 'orange', 'purple', 'green', 'pink', 'red'];
    const section = context.match(/##?\s*(?:ETAPAS?|FLUJO|EMBUDO|PIPELINE)[\s\S]*?(?=##[^#]|$)/i);
    if (section) {
      const items = section[0].match(/[-•*]\s*\*?\*?([^*\n]+)\*?\*?/g);
      if (items) {
        items.forEach((item, idx) => {
          const clean = item.replace(/[-•*]/g, '').replace(/\*\*/g, '').trim();
          if (clean && clean.length > 2 && clean.length < 50) {
            stages.push({ id: clean, label: clean, color: colors[idx % colors.length] });
          }
        });
      }
    }
    if (stages.length === 0) {
      const names = context.match(/(?:Saludo|Interesado|Cotización|Pendiente|Pedido|Confirmado|Perdido|Nuevo|Calidad|Color|Talla)[^\n,]*/gi);
      if (names) {
        const uniqueNames = Array.from(new Set(names.map(s => s.trim())));
        uniqueNames.forEach((n, i) => {
          if (n.length > 2 && n.length < 50) stages.push({ id: n, label: n, color: colors[i % colors.length] });
        });
      }
    }
    return stages.slice(0, 12);
  };

  const handleDragStart = (conv: Conversation) => setDraggedItem(conv);
  const handleDragOver = (e: React.DragEvent, stageId: string) => { e.preventDefault(); setDragOverStage(stageId); };
  const handleDragLeave = () => setDragOverStage(null);

  const handleDrop = async (e: React.DragEvent, newStageId: string) => {
    e.preventDefault(); setDragOverStage(null);
    if (!draggedItem || draggedItem.stage === newStageId) { setDraggedItem(null); return; }
    const token = localStorage.getItem('token');
    setConversations(prev => prev.map(c => c.id === draggedItem.id ? { ...c, stage: newStageId } : c));
    try {
      await fetch(`${API_URL}/api/conversations/${draggedItem.id}/stage`, {
        method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStageId })
      });
    } catch { setConversations(prev => prev.map(c => c.id === draggedItem.id ? { ...c, stage: draggedItem.stage } : c)); }
    setDraggedItem(null);
  };

  const sendMassMessage = async () => {
    if (!selectedStage || !massMessageText.trim()) return;
    setSendingMass(true); setMassMessageResult(null);
    const token = localStorage.getItem('token');
    const stageConvs = conversations.filter(c => c.stage === selectedStage);
    let sent = 0, failed = 0;
    for (const conv of stageConvs) {
      try {
        const res = await fetch(`${API_URL}/api/whatsapp/send`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: conv.recipientId, message: massMessageText, lineId: getLineId() })
        });
        if (res.ok) sent++; else failed++;
        await new Promise(r => setTimeout(r, 1500));
      } catch { failed++; }
    }
    setMassMessageResult({ sent, failed }); setSendingMass(false);
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

  const handleDelete = async (id: string, type: 'client' | 'product') => {
    if (!confirm('¿Eliminar?')) return;
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/api/${type === 'client' ? 'clients' : 'products'}/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    fetchAll();
  };

  const resetForms = () => {
    setClientForm({ name: '', phone: '', email: '', status: 'lead', tags: '' });
    setProductForm({ name: '', description: '', price: '', stock: '', category: '' });
    setEditingItem(null);
  };

  const getConvsByStage = (stageId: string) => conversations.filter(c => c.stage === stageId);
  const stats = { total: conversations.length, clients: clients.length, revenue: clients.reduce((s, c) => s + (c.totalPurchases || 0), 0), products: products.length };

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <img src="/bizonne.png" alt="Bizonne" className="w-16 h-16 rounded-xl animate-pulse" />
      <div className="loading-spinner" />
    </div>
  );

  if (user?.plan === 'starter') return (
    <div className="max-w-2xl mx-auto text-center py-16">
      <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[var(--accent-primary)] to-purple-600 flex items-center justify-center">
        <Users className="w-12 h-12 text-white" />
      </div>
      <h2 className="text-2xl font-bold text-white mb-4">CRM Pipeline en Plan Business</h2>
      <p className="text-[var(--text-secondary)] mb-8">Gestiona tu pipeline con vista Kanban, mensajes masivos y sincronización con IA.</p>
      <a href="/subscription" className="btn-primary inline-flex items-center gap-2"><Sparkles className="w-5 h-5" /> Actualizar</a>
    </div>
  );

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col gap-6 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[var(--accent-primary)] to-cyan-500 flex items-center justify-center shadow-lg flex-shrink-0">
            <img src="/bizonne.png" alt="Bizonne" className="w-10 h-10 rounded-xl" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">CRM Pipeline</h1>
            <p className="text-[var(--text-muted)]">Gestiona clientes y ventas</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button onClick={() => setShowMassMessage(true)} className="btn-secondary flex items-center gap-2">
            <Send className="w-4 h-4" /> Mensaje Masivo
          </button>
          <button onClick={() => activeTab === 'products' ? setShowProductModal(true) : setShowClientModal(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Nuevo
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-[var(--border-primary)] pb-4">
        {(['pipeline', 'clients', 'products'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${activeTab === tab ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'}`}>
            {tab === 'pipeline' ? <LayoutGrid className="w-4 h-4" /> : tab === 'clients' ? <Users className="w-4 h-4" /> : <Package className="w-4 h-4" />}
            {tab === 'pipeline' ? 'Pipeline' : tab === 'clients' ? 'Clientes' : 'Productos'}
          </button>
        ))}
        {activeTab === 'pipeline' && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/30">
              <Sparkles className="w-3 h-3 inline mr-1" />
              Detección automática de etapas
            </span>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4"><span className="text-3xl font-bold text-[var(--accent-primary)]">{stats.total}</span><p className="text-sm text-[var(--text-muted)]">Pipeline</p></div>
        <div className="card p-4"><span className="text-3xl font-bold text-cyan-400">{stats.clients}</span><p className="text-sm text-[var(--text-muted)]">Clientes</p></div>
        <div className="card p-4"><span className="text-3xl font-bold text-emerald-400">${stats.revenue.toLocaleString()}</span><p className="text-sm text-[var(--text-muted)]">Ingresos</p></div>
        <div className="card p-4"><span className="text-3xl font-bold text-purple-400">{stats.products}</span><p className="text-sm text-[var(--text-muted)]">Productos</p></div>
      </div>

      {/* PIPELINE KANBAN - AUTOMÁTICO */}
      {activeTab === 'pipeline' && (
        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          <div className="relative max-w-md flex-shrink-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar..." className="input pl-11" />
          </div>
          <div className="flex-1 overflow-x-auto pb-4">
            <div className="flex gap-4 h-full" style={{ minWidth: `${stages.length * 280}px` }}>
              {stages.map((stage) => {
                const stageConvs = getConvsByStage(stage.id).filter(c => !searchTerm || c.recipientName?.toLowerCase().includes(searchTerm.toLowerCase()) || c.recipientId?.includes(searchTerm));
                return (
                  <div key={stage.id} className={`w-64 flex-shrink-0 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] border-t-4 ${COLUMN_BG[stage.color] || 'border-t-gray-500'} flex flex-col`}>
                    <div className="p-3 border-b border-[var(--border-primary)] flex-shrink-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[stage.color] || STAGE_COLORS.gray}`}>{stageConvs.length}</span>
                          <span className="font-semibold text-white text-sm">{stage.label}</span>
                        </div>
                        <button onClick={() => { setSelectedStage(stage.id); setShowMassMessage(true); }} className="p-1.5 rounded-lg hover:bg-white/10 text-[var(--text-muted)]" title="Mensaje masivo">
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="p-2 space-y-2 flex-1 overflow-y-auto">
                      {stageConvs.map((conv) => (
                        <div key={conv.id}
                          className="p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] hover:border-[var(--accent-primary)]/50 transition-all">
                          <div className="flex items-start gap-2">
                            <div className="w-8 h-8 rounded-full bg-[var(--accent-primary)]/20 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-semibold text-[var(--accent-primary)]">{conv.recipientName?.[0] || '?'}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-medium text-white text-sm truncate">{conv.recipientName || conv.recipientId}</p>
                                {conv.aiPaused && <span className="w-2 h-2 bg-amber-400 rounded-full flex-shrink-0" title="IA Pausada" />}
                              </div>
                              <p className="text-xs text-[var(--text-muted)] truncate mt-1">{conv.lastMessage || 'Sin mensajes'}</p>
                              <div className="flex items-center justify-between mt-2">
                                <span className="text-[10px] text-[var(--text-muted)]">{new Date(conv.updatedAt).toLocaleDateString()}</span>
                                <a href={`/conversaciones?id=${conv.id}`} className="text-[10px] text-[var(--accent-primary)] hover:underline">Ver chat →</a>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                      {stageConvs.length === 0 && (
                        <div className="text-center py-8 text-[var(--text-muted)]">
                          <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p className="text-xs">Sin conversaciones</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* CLIENTS */}
      {activeTab === 'clients' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar cliente..." className="input pl-11" />
            </div>
            <button onClick={() => { resetForms(); setShowClientModal(true); }} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> Nuevo</button>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead><tr className="border-b border-[var(--border-primary)]">
                <th className="text-left p-4 text-[var(--text-muted)] font-medium text-sm">Cliente</th>
                <th className="text-left p-4 text-[var(--text-muted)] font-medium text-sm">Contacto</th>
                <th className="text-left p-4 text-[var(--text-muted)] font-medium text-sm">Estado</th>
                <th className="text-left p-4 text-[var(--text-muted)] font-medium text-sm">Compras</th>
                <th className="text-left p-4 text-[var(--text-muted)] font-medium text-sm">Acciones</th>
              </tr></thead>
              <tbody>
                {clients.filter(c => c.name?.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone?.includes(searchTerm)).map((client) => (
                  <tr key={client.id} className="border-b border-[var(--border-primary)] hover:bg-white/5">
                    <td className="p-4"><div className="flex items-center gap-3"><div className="avatar">{client.name?.[0]}</div><p className="font-medium text-white">{client.name}</p></div></td>
                    <td className="p-4"><span className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><Phone className="w-3 h-3" />{client.phone}</span></td>
                    <td className="p-4"><span className={`badge ${client.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{client.status === 'active' ? 'Activo' : 'Lead'}</span></td>
                    <td className="p-4"><span className="text-[var(--accent-primary)] font-semibold">${(client.totalPurchases || 0).toLocaleString()}</span></td>
                    <td className="p-4"><div className="flex gap-2">
                      <button onClick={() => { setEditingItem(client); setClientForm({ name: client.name, phone: client.phone, email: client.email || '', status: client.status, tags: client.tags?.join(', ') || '' }); setShowClientModal(true); }} className="btn-icon"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(client.id, 'client')} className="btn-icon text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {clients.length === 0 && <div className="text-center py-12 text-[var(--text-muted)]"><Users className="w-12 h-12 mx-auto mb-4 opacity-50" /><p>No hay clientes</p></div>}
          </div>
        </div>
      )}

      {/* PRODUCTS */}
      {activeTab === 'products' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar producto..." className="input pl-11" />
            </div>
            <button onClick={() => { resetForms(); setShowProductModal(true); }} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> Nuevo</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.filter(p => p.name?.toLowerCase().includes(searchTerm.toLowerCase())).map((product) => (
              <div key={product.id} className="card glass-hover">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-14 h-14 rounded-xl bg-[var(--accent-primary)]/20 flex items-center justify-center"><Box className="w-7 h-7 text-[var(--accent-primary)]" /></div>
                  <div className="flex gap-2">
                    <button onClick={() => { setEditingItem(product); setProductForm({ name: product.name, description: product.description || '', price: product.price?.toString() || '', stock: product.stock?.toString() || '', category: product.category || '' }); setShowProductModal(true); }} className="btn-icon"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(product.id, 'product')} className="btn-icon text-red-400"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{product.name}</h3>
                <p className="text-sm text-[var(--text-muted)] mb-4 line-clamp-2">{product.description || 'Sin descripción'}</p>
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-[var(--accent-primary)]">${product.price?.toLocaleString() || 0}</span>
                  <span className={`badge ${(product.stock || 0) < 10 ? 'badge-danger' : 'badge-success'}`}>Stock: {product.stock || 0}</span>
                </div>
              </div>
            ))}
            {products.length === 0 && <div className="col-span-full text-center py-12 text-[var(--text-muted)]"><Package className="w-12 h-12 mx-auto mb-4 opacity-50" /><p>No hay productos</p></div>}
          </div>
        </div>
      )}

      {/* MODAL: MENSAJE MASIVO */}
      {showMassMessage && (
        <div className="modal-overlay" onClick={() => setShowMassMessage(false)}>
          <div className="modal-content max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2"><Send className="w-5 h-5 text-[var(--accent-primary)]" /> Mensaje Masivo</h3>
              <button onClick={() => setShowMassMessage(false)} className="btn-icon"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div><label className="input-label">Etapa</label>
                <select value={selectedStage} onChange={(e) => setSelectedStage(e.target.value)} className="input">
                  <option value="">-- Seleccionar --</option>
                  {stages.map(s => <option key={s.id} value={s.id}>{s.label} ({getConvsByStage(s.id).length})</option>)}
                </select>
              </div>
              {selectedStage && <div className="p-3 rounded-lg bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20"><p className="text-sm text-[var(--accent-primary)]">📤 Se enviará a <strong>{getConvsByStage(selectedStage).length}</strong> contactos</p></div>}
              <div><label className="input-label">Mensaje</label><textarea value={massMessageText} onChange={(e) => setMassMessageText(e.target.value)} placeholder="Escribe..." className="input min-h-[120px]" /></div>
              {massMessageResult && (
                <div className={`p-3 rounded-lg ${massMessageResult.failed > 0 ? 'bg-amber-500/10' : 'bg-emerald-500/10'} border`}>
                  <div className="flex items-center gap-2">
                    {massMessageResult.failed > 0 ? <AlertCircle className="w-5 h-5 text-amber-400" /> : <CheckCircle className="w-5 h-5 text-emerald-400" />}
                    <p className="text-sm"><span className="text-emerald-400">{massMessageResult.sent} enviados</span>{massMessageResult.failed > 0 && <span className="text-amber-400"> · {massMessageResult.failed} fallidos</span>}</p>
                  </div>
                </div>
              )}
              <button onClick={sendMassMessage} disabled={!selectedStage || !massMessageText.trim() || sendingMass} className="btn-primary w-full flex items-center justify-center gap-2">
                {sendingMass ? <><div className="loading-spinner w-4 h-4" /> Enviando...</> : <><Send className="w-4 h-4" /> Enviar</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CLIENTE */}
      {showClientModal && (
        <div className="modal-overlay" onClick={() => setShowClientModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6"><h3 className="text-xl font-bold text-white">{editingItem ? 'Editar' : 'Nuevo'} Cliente</h3><button onClick={() => setShowClientModal(false)} className="btn-icon"><X className="w-5 h-5" /></button></div>
            <div className="space-y-4">
              <div><label className="input-label">Nombre *</label><input type="text" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} className="input" placeholder="Nombre" /></div>
              <div><label className="input-label">Teléfono *</label><input type="text" value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} className="input" placeholder="+57..." /></div>
              <div><label className="input-label">Email</label><input type="email" value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} className="input" /></div>
              <div><label className="input-label">Estado</label><select value={clientForm.status} onChange={(e) => setClientForm({ ...clientForm, status: e.target.value })} className="input"><option value="lead">Lead</option><option value="active">Activo</option></select></div>
              <div><label className="input-label">Etiquetas</label><input type="text" value={clientForm.tags} onChange={(e) => setClientForm({ ...clientForm, tags: e.target.value })} className="input" placeholder="VIP, Frecuente" /></div>
              <button onClick={handleSaveClient} className="btn-primary w-full">{editingItem ? 'Actualizar' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: PRODUCTO */}
      {showProductModal && (
        <div className="modal-overlay" onClick={() => setShowProductModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6"><h3 className="text-xl font-bold text-white">{editingItem ? 'Editar' : 'Nuevo'} Producto</h3><button onClick={() => setShowProductModal(false)} className="btn-icon"><X className="w-5 h-5" /></button></div>
            <div className="space-y-4">
              <div><label className="input-label">Nombre *</label><input type="text" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} className="input" /></div>
              <div><label className="input-label">Descripción</label><textarea value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} className="input min-h-[80px]" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="input-label">Precio</label><input type="number" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} className="input" /></div>
                <div><label className="input-label">Stock</label><input type="number" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })} className="input" /></div>
              </div>
              <div><label className="input-label">Categoría</label><input type="text" value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} className="input" /></div>
              <button onClick={handleSaveProduct} className="btn-primary w-full">{editingItem ? 'Actualizar' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-center py-4">
        <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
          <img src="/bizonne.png" alt="Bizonne" className="w-5 h-5 rounded" />
          CRM powered by Bizonne
        </div>
      </div>
    </div>
  );
}

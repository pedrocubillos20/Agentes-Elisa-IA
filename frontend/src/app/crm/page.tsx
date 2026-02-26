'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Users, Package, Plus, Search, Edit2, Trash2, Phone, Mail, X, 
  Send, MessageSquare, LayoutGrid, Sparkles, Image, Mic, Paperclip, FileText,
  Flame, TrendingUp, Target, Star, ArrowUpRight, Filter
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Stage { id: string; label: string; color: string; }
interface Conversation { id: string; recipientId: string; recipientName: string; lastMessage: string; stage: string; updatedAt: string; aiPaused: boolean; contextData?: Record<string, any>; }

// ❌ Sin etapas por defecto — se cargan de la base de conocimiento de cada línea
const DEFAULT_STAGES: Stage[] = [];

// 🔥 LEAD SCORING — Calificar leads automáticamente
const ADVANCED_STAGES = ['confirmado', 'realizo_pedido', 'despachado', 'cotizado', 'en_cotizacion', 'agendamiento', 'pendiente_pago'];
const MID_STAGES = ['interesado', 'pendiente_color', 'pendiente_talla', 'pendiente_calidad', 'pendiente_ciudad', 'pendiente_datos'];
const COLD_STAGES = ['nuevo_contacto', 'saludo', 'new'];

const calculateLeadScore = (conv: any, stages: Stage[]): { score: number; label: string; color: string; emoji: string; reasons: string[] } => {
  let score = 0;
  const reasons: string[] = [];

  // 1. Stage progression (0-35 pts)
  const stageIndex = stages.findIndex(s => s.id === conv.stage);
  const stageTotal = stages.length || 1;
  if (stageIndex >= 0) {
    const stageProgress = ((stageIndex + 1) / stageTotal) * 35;
    score += stageProgress;
    if (stageProgress > 20) reasons.push('Avanzado en embudo');
  }
  // Bonus for advanced stages
  if (ADVANCED_STAGES.some(s => conv.stage?.toLowerCase().includes(s))) { score += 15; reasons.push('Etapa de cierre'); }
  else if (MID_STAGES.some(s => conv.stage?.toLowerCase().includes(s))) { score += 8; reasons.push('Etapa intermedia'); }

  // 2. Context data completeness (0-25 pts)
  const ctx = conv.contextData || {};
  const ctxKeys = Object.keys(ctx).filter(k => ctx[k] && String(ctx[k]).trim() !== '');
  if (ctxKeys.length >= 5) { score += 25; reasons.push('Datos completos'); }
  else if (ctxKeys.length >= 3) { score += 15; reasons.push(`${ctxKeys.length} datos recopilados`); }
  else if (ctxKeys.length >= 1) { score += 5; reasons.push('Datos parciales'); }

  // Key data fields bonus
  if (ctx.telefono || ctx.phone || ctx.celular) { score += 5; }
  if (ctx.nombre || ctx.name) { score += 3; }
  if (ctx.direccion || ctx.address || ctx.ciudad || ctx.city) { score += 3; }
  if (ctx.total || ctx.precio || ctx.price || ctx.cantidad || ctx.quantity) { score += 5; reasons.push('Tiene datos de compra'); }
  if (ctx.metodo_pago || ctx.payment) { score += 5; reasons.push('Método de pago definido'); }

  // 3. Recent activity (0-15 pts)
  if (conv.updatedAt) {
    const hoursAgo = (Date.now() - new Date(conv.updatedAt).getTime()) / (1000 * 60 * 60);
    if (hoursAgo < 1) { score += 15; reasons.push('Activo hace minutos'); }
    else if (hoursAgo < 6) { score += 12; }
    else if (hoursAgo < 24) { score += 8; reasons.push('Activo hoy'); }
    else if (hoursAgo < 72) { score += 4; }
  }

  // 4. Has messages (0-5 pts)
  if (conv.lastMessage && conv.lastMessage.length > 10) { score += 5; }

  // 5. AI not paused = actively being worked (0-5 pts)
  if (!conv.aiPaused) { score += 3; }

  // Cap at 100
  score = Math.min(100, Math.round(score));

  // Classify
  if (score >= 70) return { score, label: 'Caliente', color: 'text-red-400', emoji: '🔥', reasons };
  if (score >= 40) return { score, label: 'Tibio', color: 'text-amber-400', emoji: '🟡', reasons };
  return { score, label: 'Frío', color: 'text-blue-400', emoji: '🔵', reasons };
};

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
  const [activeTab, setActiveTab] = useState<'pipeline' | 'leads' | 'clients' | 'products'>('pipeline');
  const [stages, setStages] = useState<Stage[]>(DEFAULT_STAGES);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStage, setSelectedStage] = useState('');
  const [leadFilter, setLeadFilter] = useState<'all' | 'hot' | 'warm' | 'cold'>('all');
  
  const [showMassMessage, setShowMassMessage] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  
  const [massMessageText, setMassMessageText] = useState('');
  const [sendingMass, setSendingMass] = useState(false);
  const [massMediaFile, setMassMediaFile] = useState<File | null>(null);
  const [massMediaPreview, setMassMediaPreview] = useState<string | null>(null);
  const [massSentCount, setMassSentCount] = useState(0);
  const [massTotal, setMassTotal] = useState(0);
  const massFileInputRef = useRef<HTMLInputElement>(null);

  const [editingItem, setEditingItem] = useState<any>(null);
  const [clientForm, setClientForm] = useState({ name: '', phone: '', email: '', status: 'lead', tags: '' });
  const [productForm, setProductForm] = useState({ name: '', description: '', price: '', stock: '', category: '' });

  const getLineId = () => localStorage.getItem('selectedLineId') || '';

  useEffect(() => {
    // ⚡ INSTANT LOAD: Mostrar datos cacheados inmediatamente
    try {
      const cu = localStorage.getItem('bizonne_user_cache');
      if (cu) setUser(JSON.parse(cu));
      const cc = localStorage.getItem('bizonne_crm_convs');
      if (cc) { setConversations(JSON.parse(cc)); setLoading(false); }
      const cs = localStorage.getItem('bizonne_crm_stages');
      if (cs) { const parsed = JSON.parse(cs); if (parsed?.length) setStages(parsed); }
    } catch {}

    fetchAll();
    const onLineChanged = () => { setLoading(true); fetchAll(); };
    window.addEventListener('lineChanged', onLineChanged);
    
    // 🔄 AUTO-REFRESH: Actualizar conversaciones cada 15 segundos (era 10)
    const autoRefreshInterval = setInterval(() => {
      fetchConversationsOnly();
    }, 15000);
    
    // 🎯 AUTO-SYNC ETAPAS: Sincronizar etapas cada 60 segundos (era 30)
    const stageSyncInterval = setInterval(() => {
      syncStages();
    }, 60000);
    
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
    try {
      // ⚡ User from cache (layout already fetches it)
      try { const cu = localStorage.getItem('bizonne_user_cache'); if (cu) setUser(JSON.parse(cu)); } catch {}

      const [stagesRes, convsRes, clientsRes, productsRes] = await Promise.all([
        fetch(`${API_URL}/api/stages?lineId=${getLineId()}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/conversations?lineId=${getLineId()}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/clients?lineId=${getLineId()}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/products?lineId=${getLineId()}`, { headers: { 'Authorization': `Bearer ${token}` } }),
      ]);
      if (stagesRes.ok) { const d = await stagesRes.json(); if (d.stages?.length) { setStages(d.stages); try { localStorage.setItem('bizonne_crm_stages', JSON.stringify(d.stages)); } catch {} } }
      if (convsRes.ok) { const convs = (await convsRes.json()).conversations || []; setConversations(convs); try { localStorage.setItem('bizonne_crm_convs', JSON.stringify(convs.slice(0, 100))); } catch {} }
      if (clientsRes.ok) setClients((await clientsRes.json()).clients || []);
      if (productsRes.ok) setProducts((await productsRes.json()).products || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const getConvsByStage = (stageId: string) => conversations.filter(c => c.stage === stageId);

  const sendMassMessage = async () => {
    if (!selectedStage || (!massMessageText.trim() && !massMediaFile)) return;
    setSendingMass(true);
    const token = localStorage.getItem('token');
    const stageConvs = getConvsByStage(selectedStage);
    setMassTotal(stageConvs.length);
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

      const contacts = stageConvs.map(c => ({
        phone: c.recipientId,
        name: c.recipientName || c.recipientId,
        conversationId: c.id
      }));

      const res = await fetch(`${API_URL}/api/whatsapp/send-bulk`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contacts,
          message: massMessageText || null,
          whatsappLineId: getLineId(),
          ...(mediaUrl && { mediaUrl, mediaType })
        })
      });

      if (res.ok) {
        let count = 0;
        const progressInterval = setInterval(() => {
          count += 1;
          setMassSentCount(Math.min(count, stageConvs.length));
          if (count >= stageConvs.length) clearInterval(progressInterval);
        }, 3500);

        setTimeout(() => {
          clearInterval(progressInterval);
          setMassSentCount(stageConvs.length);
          alert(`✅ Mensaje masivo enviado a ${stageConvs.length} contactos`);
          setSendingMass(false);
          setShowMassMessage(false);
          setMassMessageText('');
          setMassMediaFile(null);
          setMassMediaPreview(null);
          setMassSentCount(0);
          setMassTotal(0);
          fetchAll();
        }, Math.min(stageConvs.length * 3500 + 2000, 60000));
      } else {
        throw new Error('Error');
      }
    } catch {
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
      else if (res.status === 403) {
        const err = await res.json();
        alert(err.error || 'Límite de productos alcanzado. Compra más productos en Suscripción.');
      }
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

  // Límites de productos
  const baseProdLimits: Record<string, number> = { trial: 10, starter: 10, business: 20 };
  const maxProducts = user?.effectiveLimits?.maxProducts || baseProdLimits[user?.plan || 'trial'] || 10;
  const canAddProduct = products.length < maxProducts;

  // 🔥 Lead Scoring
  const scoredLeads = conversations
    .map(conv => ({ ...conv, leadScore: calculateLeadScore(conv, stages) }))
    .sort((a, b) => b.leadScore.score - a.leadScore.score);
  const hotLeads = scoredLeads.filter(l => l.leadScore.score >= 70);
  const warmLeads = scoredLeads.filter(l => l.leadScore.score >= 40 && l.leadScore.score < 70);
  const coldLeads = scoredLeads.filter(l => l.leadScore.score < 40);
  const filteredLeads = leadFilter === 'hot' ? hotLeads : leadFilter === 'warm' ? warmLeads : leadFilter === 'cold' ? coldLeads : scoredLeads;

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
    <div className="h-[calc(100vh-120px)] flex flex-col gap-4 overflow-hidden max-w-full">
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
          <button onClick={() => {
            if (activeTab === 'products') {
              if (!canAddProduct) { alert(`Has alcanzado el límite de ${maxProducts} productos. Compra más en Suscripción.`); return; }
              setShowProductModal(true);
            } else setShowClientModal(true);
          }} className={`btn-primary py-1.5 px-3 text-sm ${activeTab === 'products' && !canAddProduct ? 'opacity-50' : ''}`}>
            <Plus className="w-4 h-4" /> Nuevo
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[var(--border-primary)] pb-3 flex-shrink-0">
        {(['pipeline', 'leads', 'clients', 'products'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'
            }`}>
            {tab === 'pipeline' ? <LayoutGrid className="w-4 h-4" /> : tab === 'leads' ? <Target className="w-4 h-4" /> : tab === 'clients' ? <Users className="w-4 h-4" /> : <Package className="w-4 h-4" />}
            {tab === 'pipeline' ? 'Pipeline' : tab === 'leads' ? `Leads (${hotLeads.length} 🔥)` : tab === 'clients' ? 'Clientes' : 'Productos'}
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
            {stages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mb-4">
                  <Sparkles className="w-8 h-8 text-purple-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Configura tus etapas</h3>
                <p className="text-[var(--text-muted)] text-sm max-w-md mb-4">
                  Las etapas del pipeline se generan automáticamente desde la base de conocimiento de tu asistente IA. 
                  Ve a <strong className="text-white">Asistentes IA</strong> y define las etapas de tu negocio en la base de conocimiento.
                </p>
                <button
                  onClick={detectStages}
                  disabled={detecting}
                  className="px-4 py-2 bg-purple-500/20 border border-purple-500/40 text-purple-300 rounded-lg hover:bg-purple-500/30 transition-all text-sm flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  {detecting ? 'Detectando...' : 'Detectar etapas ahora'}
                </button>
              </div>
            ) : (
            <>
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
            </>
            )}
          </div>
        </div>
      )}

      {/* 🔥 LEADS CALIFICADOS */}
      {activeTab === 'leads' && (
        <div className="flex-1 flex flex-col gap-3 min-h-0 w-full" style={{ maxWidth: '100%' }}>
          {/* Score Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-shrink-0">
            <button onClick={() => setLeadFilter('all')} className={`px-3 py-2 rounded-xl border text-center transition-all ${leadFilter === 'all' ? 'border-[var(--accent-primary)]/50 bg-[var(--accent-primary)]/10' : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-white/5'}`}>
              <div className="text-xl font-black text-white">{scoredLeads.length}</div>
              <div className="text-[10px] text-[var(--text-muted)]">Total</div>
            </button>
            <button onClick={() => setLeadFilter('hot')} className={`px-3 py-2 rounded-xl border text-center transition-all ${leadFilter === 'hot' ? 'border-red-500/50 bg-red-500/10' : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-white/5'}`}>
              <div className="text-xl font-black text-red-400">🔥 {hotLeads.length}</div>
              <div className="text-[10px] text-red-400/70">Calientes</div>
            </button>
            <button onClick={() => setLeadFilter('warm')} className={`px-3 py-2 rounded-xl border text-center transition-all ${leadFilter === 'warm' ? 'border-amber-500/50 bg-amber-500/10' : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-white/5'}`}>
              <div className="text-xl font-black text-amber-400">🟡 {warmLeads.length}</div>
              <div className="text-[10px] text-amber-400/70">Tibios</div>
            </button>
            <button onClick={() => setLeadFilter('cold')} className={`px-3 py-2 rounded-xl border text-center transition-all ${leadFilter === 'cold' ? 'border-blue-500/50 bg-blue-500/10' : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-white/5'}`}>
              <div className="text-xl font-black text-blue-400">🔵 {coldLeads.length}</div>
              <div className="text-[10px] text-blue-400/70">Fríos</div>
            </button>
          </div>

          {/* Leads List */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="space-y-2">
              {filteredLeads
                .filter(c => !searchTerm || c.recipientName?.toLowerCase().includes(searchTerm.toLowerCase()))
                .map((conv) => {
                  const ls = conv.leadScore;
                  const stage = stages.find(s => s.id === conv.stage);
                  const ctx = conv.contextData || {};
                  const ctxEntries = Object.entries(ctx).filter(([_, v]) => v && String(v).trim() !== '');
                  return (
                    <div key={conv.id} className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] hover:border-[var(--accent-primary)]/30 transition-all">
                      {/* Main row */}
                      <div className="flex items-center gap-3" style={{ width: '100%' }}>
                        {/* Score Badge */}
                        <div className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center flex-shrink-0 ${
                          ls.score >= 70 ? 'bg-red-500/20 border border-red-500/30' : ls.score >= 40 ? 'bg-amber-500/20 border border-amber-500/30' : 'bg-blue-500/20 border border-blue-500/30'
                        }`}>
                          <span className="text-sm">{ls.emoji}</span>
                          <span className={`text-[9px] font-black ${ls.color}`}>{ls.score}</span>
                        </div>

                        {/* Info - w-0 forces truncation */}
                        <div className="w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white text-sm truncate">{conv.recipientName || conv.recipientId}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border flex-shrink-0 whitespace-nowrap ${STAGE_COLORS[stage?.color || 'blue']}`}>
                              {stage?.label || conv.stage}
                            </span>
                          </div>
                          <p className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{conv.lastMessage || 'Sin mensajes'}</p>
                          {/* Context data inline */}
                          {ctxEntries.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {ctxEntries.slice(0, 3).map(([k, v]) => (
                                <span key={k} className="inline-block px-1.5 py-0.5 rounded bg-white/5 text-[9px] text-gray-400">
                                  {k}: <span className="text-white">{String(v).slice(0, 12)}</span>
                                </span>
                              ))}
                              {ctxEntries.length > 3 && <span className="text-[9px] text-gray-500">+{ctxEntries.length - 3}</span>}
                            </div>
                          )}
                        </div>

                        {/* Score bar */}
                        <div className="flex-shrink-0 w-16 hidden sm:block">
                          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${
                              ls.score >= 70 ? 'bg-red-500' : ls.score >= 40 ? 'bg-amber-500' : 'bg-blue-500'
                            }`} style={{ width: `${ls.score}%` }} />
                          </div>
                          <p className="text-[8px] text-gray-500 truncate mt-0.5 text-right">{ls.reasons[0]}</p>
                        </div>

                        {/* Action */}
                        <a href={`/conversaciones?id=${conv.id}`} className="p-1.5 rounded-lg hover:bg-white/10 transition-all flex-shrink-0" title="Ver conversación">
                          <ArrowUpRight className="w-4 h-4 text-[var(--accent-primary)]" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              {filteredLeads.length === 0 && (
                <div className="text-center py-12 text-[var(--text-muted)]">
                  <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No hay leads {leadFilter !== 'all' ? `${leadFilter === 'hot' ? 'calientes' : leadFilter === 'warm' ? 'tibios' : 'fríos'}` : ''}</p>
                </div>
              )}
            </div>
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
          {/* 📦 Product limit & order bump */}
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm text-[var(--text-muted)]">{products.length}/{maxProducts} productos</span>
          </div>
          
          {/* Order bump: comprar más productos */}
          {!canAddProduct ? (
            <div className="mb-4 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📦</span>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-white">Límite de productos alcanzado</h4>
                  <p className="text-xs text-gray-400">Tu plan permite hasta {maxProducts} productos. Amplía tu catálogo.</p>
                </div>
                <a href="/subscription#addons" className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all whitespace-nowrap">
                  +10 Productos — $20 USD
                </a>
              </div>
            </div>
          ) : products.length >= maxProducts - 3 && products.length > 0 ? (
            <div className="mb-4 p-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
              <div className="flex items-center gap-3">
                <span className="text-lg">📦</span>
                <div className="flex-1">
                  <p className="text-xs text-gray-400">Te quedan {maxProducts - products.length} productos disponibles</p>
                </div>
                <a href="/subscription#addons" className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all whitespace-nowrap">
                  +10 Productos — $20 USD
                </a>
              </div>
            </div>
          ) : null}

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
      
      {/* Modal Mensaje Masivo — Con media + barra de progreso */}
      {showMassMessage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !sendingMass && setShowMassMessage(false)}>
          <div className="bg-[var(--bg-secondary)] rounded-xl p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Mensaje Masivo</h3>
              <button onClick={() => !sendingMass && setShowMassMessage(false)} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-[var(--text-muted)] mb-3">
              Enviar a: <strong className="text-white">{stages.find(s => s.id === selectedStage)?.label}</strong> ({getConvsByStage(selectedStage).length} contactos)
            </p>
            <textarea 
              value={massMessageText} onChange={(e) => setMassMessageText(e.target.value)} 
              placeholder="Escribe tu mensaje..." disabled={sendingMass}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg p-3 text-sm text-white placeholder-[var(--text-muted)] min-h-[100px] resize-none mb-3 focus:outline-none focus:border-[var(--accent-primary)] disabled:opacity-50" 
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

            <button onClick={sendMassMessage} disabled={sendingMass || (!massMessageText.trim() && !massMediaFile)} className="btn-primary w-full py-2 disabled:opacity-50">
              {sendingMass ? `Enviando ${massSentCount}/${massTotal}...` : `Enviar a ${getConvsByStage(selectedStage).length} contactos`}
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

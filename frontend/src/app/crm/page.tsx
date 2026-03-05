'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Users, Package, Plus, Search, Edit2, Trash2, Phone, Mail, X, 
  Send, MessageSquare, LayoutGrid, Sparkles, Image, Mic, Paperclip, FileText,
  Flame, TrendingUp, Target, Star, ArrowUpRight, Filter, Download, Upload,
  ChevronDown, ChevronUp, Eye, EyeOff, List
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Stage { id: string; label: string; color: string; }
interface Conversation { id: string; recipientId: string; recipientName: string; lastMessage: string; stage: string; updatedAt: string; aiPaused: boolean; contextData?: Record<string, any>; }

const DEFAULT_STAGES: Stage[] = [];

// 🔥 LEAD SCORING — dinámico basado en posición real en el pipeline del usuario
const calculateLeadScore = (conv: any, stages: Stage[]): { score: number; label: string; color: string; emoji: string; reasons: string[] } => {
  let score = 0;
  const reasons: string[] = [];

  const stageIndex = stages.findIndex(s => s.id === conv.stage);
  const totalStages = stages.length || 1;
  if (stageIndex >= 0) {
    const stageProgress = ((stageIndex + 1) / totalStages) * 35;
    score += stageProgress;
    if (stageProgress > 20) reasons.push('Avanzado en embudo');
  }
  // Score dinámico por posición relativa en el pipeline real del usuario
  const stagePos = stageIndex >= 0 ? (stageIndex + 1) / totalStages : 0;
  if (stagePos >= 0.7) { score += 15; reasons.push('Etapa de cierre'); }
  else if (stagePos >= 0.35) { score += 8; reasons.push('Etapa intermedia'); }

  const ctx = conv.contextData || {};
  const ctxKeys = Object.keys(ctx).filter(k => ctx[k] && String(ctx[k]).trim() !== '');
  if (ctxKeys.length >= 5) { score += 25; reasons.push('Datos completos'); }
  else if (ctxKeys.length >= 3) { score += 15; reasons.push(`${ctxKeys.length} datos recopilados`); }
  else if (ctxKeys.length >= 1) { score += 5; reasons.push('Datos parciales'); }

  if (ctx.telefono || ctx.phone || ctx.celular) { score += 5; }
  if (ctx.nombre || ctx.name) { score += 3; }
  if (ctx.direccion || ctx.address || ctx.ciudad || ctx.city) { score += 3; }
  if (ctx.total || ctx.precio || ctx.price || ctx.cantidad || ctx.quantity) { score += 5; reasons.push('Tiene datos de compra'); }
  if (ctx.metodo_pago || ctx.payment) { score += 5; reasons.push('Método de pago definido'); }

  if (conv.updatedAt) {
    const hoursAgo = (Date.now() - new Date(conv.updatedAt).getTime()) / (1000 * 60 * 60);
    if (hoursAgo < 1) { score += 15; reasons.push('Activo hace minutos'); }
    else if (hoursAgo < 6) { score += 12; }
    else if (hoursAgo < 24) { score += 8; reasons.push('Activo hoy'); }
    else if (hoursAgo < 72) { score += 4; }
  }

  if (conv.lastMessage && conv.lastMessage.length > 10) { score += 5; }
  if (!conv.aiPaused) { score += 3; }

  score = Math.min(100, Math.round(score));

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
  
  // 🆕 Collapsible stages
  const [showStages, setShowStages] = useState(true);
  
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
  const [showClientMass, setShowClientMass] = useState(false);
  const [clientForm, setClientForm] = useState({ name: '', phone: '', email: '', address: '', notes: '', status: 'lead', tags: '' });
  const [productForm, setProductForm] = useState({ name: '', description: '', price: '', stock: '', category: '' });

  // 📊 Progress bar para import/export
  const [importProgress, setImportProgress] = useState<{ active: boolean; percent: number; label: string }>({ active: false, percent: 0, label: '' });
  // Filtro para masivo clientes
  const [clientMassFilter, setClientMassFilter] = useState<'all' | 'importado' | 'lead' | 'active' | 'vip'>('all');
  const [selectedMassTags, setSelectedMassTags] = useState<string[]>([]);
  const [massDateFrom, setMassDateFrom] = useState<string>('');
  const [massDateTo, setMassDateTo] = useState<string>('');

  const getLineId = () => localStorage.getItem('selectedLineId') || '';

  useEffect(() => {
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
    
    const autoRefreshInterval = setInterval(() => { fetchConversationsOnly(); }, 15000);
    const stageSyncInterval = setInterval(() => { syncStages(); }, 60000);
    
    return () => {
      window.removeEventListener('lineChanged', onLineChanged);
      clearInterval(autoRefreshInterval);
      clearInterval(stageSyncInterval);
    };
  }, []);

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
        fetchConversationsOnly();
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
    } catch (e) { /* silencioso */ }
  };

  const fetchAll = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
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
        body: JSON.stringify({ contacts, message: massMessageText || null, whatsappLineId: getLineId(), ...(mediaUrl && { mediaUrl, mediaType }) })
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
      } else { throw new Error('Error'); }
    } catch {
      alert('❌ Error al enviar mensaje masivo');
      setSendingMass(false);
    }
  };

  const handleMassFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMassMediaFile(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setMassMediaPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else { setMassMediaPreview(null); }
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
        alert(err.error || 'Límite de productos alcanzado.');
      }
    } catch (e) { console.error(e); }
  };

  const exportClients = async () => {
    try {
      setImportProgress({ active: true, percent: 10, label: 'Obteniendo clientes...' });
      const token = localStorage.getItem('token');
      const lineId = getLineId();
      const res = await fetch(`${API_URL}/api/clients/export?lineId=${lineId}`, { headers: { 'Authorization': `Bearer ${token}` } });
      const { data } = await res.json();
      if (!data?.length) { setImportProgress({ active: false, percent: 0, label: '' }); alert('No hay clientes para exportar'); return; }
      setImportProgress({ active: true, percent: 40, label: `Generando Excel (${data.length} clientes)...` });

      const columns = [
        { key: 'nombre', label: 'Nombre' },
        { key: 'telefono', label: 'Teléfono' },
        { key: 'email', label: 'Email' },
        { key: 'direccion', label: 'Dirección' },
        { key: 'estado', label: 'Estado' },
        { key: 'total_compras', label: 'Total Compras' },
        { key: 'notas', label: 'Notas' },
        { key: 'tags', label: 'Tags' },
        { key: 'fecha', label: 'Fecha' }
      ];

      const statusColors: Record<string, string> = {
        'active': '#27ae60', 'lead': '#3498db', 'inactive': '#e74c3c', 'vip': '#9b59b6'
      };
      const esc = (v: string) => v.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const colLen = columns.length;
      const dateStr = new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>Clientes</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
td,th{padding:6px 10px;font-family:Calibri,Arial;font-size:11pt;border:1px solid #d5d5d5}
th{background:#1a1a2e;color:#fff;font-weight:bold;font-size:12pt;text-align:center}
.re{background:#f8f9fa}.ro{background:#fff}
.tt td{background:#0f3460;color:#00d4aa;font-size:16pt;font-weight:bold;border:none;padding:12px}
.st td{background:#0f3460;color:#aaa;font-size:10pt;border:none;padding:4px 12px}
.sp td{border:none;height:6px}
</style></head><body><table>
<tr class="tt"><td colspan="${colLen}">👥 Clientes — BizonneCRM</td></tr>
<tr class="st"><td colspan="${colLen}">Exportado: ${dateStr} · Total: ${data.length} clientes</td></tr>
<tr class="sp"><td colspan="${colLen}"></td></tr>
<tr>${columns.map((c: any) => `<th>${c.label}</th>`).join('')}</tr>`;

      data.forEach((row: any, i: number) => {
        html += `<tr class="${i % 2 === 0 ? 're' : 'ro'}">`;
        columns.forEach((col: any) => {
          let val = esc((row[col.key] ?? '').toString());
          let s = '';
          if (col.key === 'estado' && val) {
            const bg = statusColors[val] || '#95a5a6';
            s = `background:${bg};color:#fff;font-weight:bold;text-align:center`;
          } else if (col.key === 'total_compras' && val && val !== '0') {
            s = 'font-weight:bold;color:#27ae60;text-align:right';
            val = `$${Number(val).toLocaleString('es-CO')}`;
          } else if (col.key === 'telefono') { s = 'color:#2980b9;mso-number-format:\@'; }
          else if (col.key === 'nombre') { s = 'font-weight:bold'; }
          else if (col.key === 'tags' && val) { s = 'color:#9b59b6;font-style:italic'; }
          html += `<td style="${s}">${val}</td>`;
        });
        html += '</tr>';
      });

      const totalV = data.reduce((s: number, r: any) => s + (Number(r.total_compras) || 0), 0);
      const activos = data.filter((r: any) => r.estado === 'active').length;
      const leadsCount = data.filter((r: any) => r.estado === 'lead').length;

      html += `<tr class="sp"><td colspan="${colLen}"></td></tr>
<tr><td colspan="2" style="background:#0f3460;color:#00d4aa;font-weight:bold">📊 Resumen</td>
<td style="background:#27ae60;color:#fff;font-weight:bold;text-align:center">✅ ${activos} activos</td>
<td colspan="2" style="background:#3498db;color:#fff;font-weight:bold;text-align:center">🔵 ${leadsCount} leads</td>
<td colspan="2" style="background:#0f3460;color:#aaa">Total: ${data.length} clientes</td>
<td style="background:#27ae60;color:#fff;font-weight:bold;text-align:right">$${totalV.toLocaleString('es-CO')}</td>
<td style="background:#0f3460"></td>
</tr></table></body></html>`;

      setImportProgress({ active: true, percent: 90, label: 'Descargando archivo...' });
      const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Clientes_BizonneCRM_${new Date().toISOString().split('T')[0]}.xls`;
      a.click();
      URL.revokeObjectURL(url);
      setImportProgress({ active: true, percent: 100, label: '¡Listo!' });
      setTimeout(() => setImportProgress({ active: false, percent: 0, label: '' }), 1500);
    } catch { setImportProgress({ active: false, percent: 0, label: '' }); alert('Error al exportar'); }
  };

  const importClients = async (file: File) => {
    try {
      setImportProgress({ active: true, percent: 5, label: 'Leyendo archivo...' });
      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
      let contacts: any[] = [];

      if (isExcel) {
        const XLSX: any = await new Promise((resolve, reject) => {
          if ((window as any).XLSX) { resolve((window as any).XLSX); return; }
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
          script.onload = () => resolve((window as any).XLSX);
          script.onerror = reject;
          document.head.appendChild(script);
        });
        setImportProgress({ active: true, percent: 20, label: 'Cargando librería Excel...' });
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        contacts = rows.map((row: any) => {
          const normalized: any = {};
          Object.keys(row).forEach(k => { normalized[k.toLowerCase().trim().replace(/\s+/g, '_')] = row[k]; });
          return normalized;
        }).filter((c: any) => c.telefono || c.phone || c.celular);
      } else {
        const text = await file.text();
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) { alert('Archivo vacío o sin datos'); return; }
        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
        contacts = lines.slice(1).map(line => {
          const values = line.match(/(?:"[^"]*"|[^,]*)(?:,|$)/g)?.map(v => v.replace(/^"|"$|,$/g, '').trim()) || line.split(',').map(v => v.trim());
          const obj: any = {};
          headers.forEach((h, i) => { obj[h] = values[i] || ''; });
          return obj;
        }).filter(c => c.telefono || c.phone || c.celular);
      }

      if (contacts.length === 0) { setImportProgress({ active: false, percent: 0, label: '' }); alert('No se encontraron contactos válidos.\n\nAsegúrate que el archivo tenga columnas: nombre, telefono'); return; }
      setImportProgress({ active: true, percent: 50, label: `Subiendo ${contacts.length} contactos...` });

      const token = localStorage.getItem('token');
      const lineId = getLineId();
      const res = await fetch(`${API_URL}/api/clients/import`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts, lineId })
      });
      const result = await res.json();
      if (res.ok) {
        setImportProgress({ active: true, percent: 100, label: `✅ ${result.imported} nuevos, ${result.skipped} duplicados` });
        setTimeout(() => setImportProgress({ active: false, percent: 0, label: '' }), 2500);
        fetchAll();
      } else { setImportProgress({ active: false, percent: 0, label: '' }); alert(result.error || 'Error al importar'); }
    } catch (e: any) { setImportProgress({ active: false, percent: 0, label: '' }); alert('Error al leer archivo: ' + (e?.message || 'Error desconocido')); }
  };

  const sendClientMassMessage = async () => {
    if (!massMessageText.trim() && !massMediaFile) return;
    const filteredClients = clients.filter(c => {
      const matchSearch = !searchTerm || c.name?.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone?.includes(searchTerm);
      const matchFilter = clientMassFilter === 'all' ? true
        : clientMassFilter === 'importado' ? (c.tags?.includes('importado'))
        : c.status === clientMassFilter;
      const matchTags = selectedMassTags.length === 0 ? true
        : selectedMassTags.every(tag => c.tags?.includes(tag));
      const clientDate = c.createdAt ? new Date(c.createdAt) : null;
      const matchDateFrom = !massDateFrom ? true : clientDate ? clientDate >= new Date(massDateFrom) : true;
      const matchDateTo = !massDateTo ? true : clientDate ? clientDate <= new Date(massDateTo + 'T23:59:59') : true;
      return matchSearch && matchFilter && matchTags && matchDateFrom && matchDateTo;
    });
    if (!filteredClients.length) { alert('No hay clientes para enviar'); return; }
    setSendingMass(true);
    const token = localStorage.getItem('token');
    setMassTotal(filteredClients.length);
    setMassSentCount(0);
    try {
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
      const contacts = filteredClients.map(c => ({ phone: c.phone, name: c.name }));
      const res = await fetch(`${API_URL}/api/whatsapp/send-bulk`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts, message: massMessageText || null, whatsappLineId: getLineId(), ...(mediaUrl && { mediaUrl, mediaType }) })
      });
      if (res.ok) {
        let count = 0;
        const iv = setInterval(() => { count++; setMassSentCount(Math.min(count, filteredClients.length)); if (count >= filteredClients.length) clearInterval(iv); }, 3500);
        setTimeout(() => { clearInterval(iv); setMassSentCount(filteredClients.length); alert(`✅ Enviado a ${filteredClients.length} clientes`); setSendingMass(false); setShowClientMass(false); setMassMessageText(''); setMassMediaFile(null); setMassMediaPreview(null); setMassSentCount(0); setMassTotal(0); }, Math.min(filteredClients.length * 3500 + 2000, 60000));
      } else throw new Error('Error');
    } catch { alert('❌ Error al enviar'); setSendingMass(false); }
  };

  const sendMessageToClient = async (phone: string, name: string) => {
    const message = prompt(`Enviar mensaje a ${name}:`);
    if (!message) return;
    try {
      const token = localStorage.getItem('token');
      const lineId = getLineId();
      const res = await fetch(`${API_URL}/api/whatsapp/send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, message, lineId })
      });
      if (res.ok) alert(`✅ Mensaje enviado a ${name}`);
      else alert('❌ Error al enviar mensaje');
    } catch { alert('Error de conexión'); }
  };

  const handleDelete = async (type: 'client' | 'product', id: string) => {
    if (!confirm('¿Eliminar?')) return;
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/api/${type === 'client' ? 'clients' : 'products'}/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    fetchAll();
  };

  const resetForms = () => {
    setEditingItem(null);
    setClientForm({ name: '', phone: '', email: '', address: '', notes: '', status: 'lead', tags: '' });
    setProductForm({ name: '', description: '', price: '', stock: '', category: '' });
  };

  const stats = {
    total: conversations.length,
    clients: clients.length,
    revenue: clients.reduce((sum, c) => sum + (c.totalPurchases || 0), 0),
    products: products.length
  };

  const baseProdLimits: Record<string, number> = { trial: 10, starter: 10, business: 20 };
  const maxProducts = user?.effectiveLimits?.maxProducts || baseProdLimits[user?.plan || 'trial'] || 10;
  const canAddProduct = products.length < maxProducts;

  const scoredLeads = conversations
    .map(conv => ({ ...conv, leadScore: calculateLeadScore(conv, stages) }))
    .sort((a, b) => b.leadScore.score - a.leadScore.score);
  const hotLeads = scoredLeads.filter(l => l.leadScore.score >= 70);
  const warmLeads = scoredLeads.filter(l => l.leadScore.score >= 40 && l.leadScore.score < 70);
  const coldLeads = scoredLeads.filter(l => l.leadScore.score < 40);
  const filteredLeads = leadFilter === 'hot' ? hotLeads : leadFilter === 'warm' ? warmLeads : leadFilter === 'cold' ? coldLeads : scoredLeads;

  if (user && user.plan === 'starter' && !user.parentUserId) {
    return (
      <div className="h-[calc(100vh-120px)] flex items-center justify-center p-4">
        <div className="text-center p-6 md:p-8 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] max-w-md">
          <Users className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-4 text-[var(--accent-primary)]" />
          <h2 className="text-lg md:text-xl font-bold text-white mb-2">CRM en Plan Business</h2>
          <p className="text-[var(--text-muted)] text-sm mb-4">Gestiona tu pipeline con vista completa.</p>
          <a href="/subscription" className="btn-primary inline-flex items-center gap-2"><Sparkles className="w-4 h-4" /> Actualizar</a>
        </div>
      </div>
    );
  }

  if (loading) return <div className="h-[calc(100vh-120px)] flex items-center justify-center"><div className="loading-spinner w-8 h-8" /></div>;

  return (
    <div className="h-[calc(100vh-110px)] md:h-[calc(100vh-120px)] flex flex-col gap-2 md:gap-3 overflow-hidden max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <LayoutGrid className="w-4 h-4 md:w-5 md:h-5 text-[var(--accent-primary)] flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm md:text-xl font-bold text-white truncate">CRM Pipeline</h1>
            <p className="text-[9px] md:text-xs text-[var(--text-muted)]">{stats.total} conv. • {stats.clients} clientes</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={() => {
            if (activeTab === 'products') {
              if (!canAddProduct) { alert(`Límite de ${maxProducts} productos alcanzado.`); return; }
              setShowProductModal(true);
            } else setShowClientModal(true);
          }} className={`btn-primary py-1.5 px-2 md:px-3 text-[10px] md:text-sm ${activeTab === 'products' && !canAddProduct ? 'opacity-50' : ''}`}>
            <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" /><span className="hidden sm:inline ml-1">Nuevo</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 md:gap-2 border-b border-[var(--border-primary)] pb-2 md:pb-3 flex-shrink-0 overflow-x-auto scrollbar-hide">
        {(['pipeline', 'leads', 'clients', 'products'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-1 md:gap-1.5 px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-[10px] md:text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 ${
              activeTab === tab ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'
            }`}>
            {tab === 'pipeline' ? <LayoutGrid className="w-3 h-3 md:w-4 md:h-4" /> : tab === 'leads' ? <Target className="w-3 h-3 md:w-4 md:h-4" /> : tab === 'clients' ? <Users className="w-3 h-3 md:w-4 md:h-4" /> : <Package className="w-3 h-3 md:w-4 md:h-4" />}
            {tab === 'pipeline' ? 'Pipeline' : tab === 'leads' ? `Leads (${hotLeads.length})` : tab === 'clients' ? 'Clientes' : 'Productos'}
          </button>
        ))}
        {activeTab === 'pipeline' && (
          <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
            <button 
              onClick={detectStages}
              disabled={detecting}
              className={`text-[10px] md:text-xs px-2 md:px-3 py-1 md:py-1.5 rounded-lg border flex items-center gap-1 transition-all ${
                detecting ? 'text-gray-400 bg-gray-500/10 border-gray-500/30 cursor-wait' : 'text-purple-400 bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20'
              }`}>
              {detecting ? <div className="w-2.5 h-2.5 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin"/> : <Sparkles className="w-2.5 h-2.5 md:w-3 md:h-3" />}
              <span className="hidden sm:inline">{detecting ? 'Detectando...' : 'Detectar'}</span>
            </button>
            <span className="text-[9px] md:text-xs text-emerald-400 bg-emerald-500/10 px-1.5 md:px-2 py-0.5 md:py-1 rounded-lg border border-emerald-500/30 flex items-center gap-1">
              <span className="relative flex h-1.5 w-1.5 md:h-2 md:w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 md:h-2 md:w-2 bg-emerald-500"></span>
              </span>
              <span className="hidden sm:inline">Auto-refresh</span>
            </span>
          </div>
        )}
      </div>

      {/* PIPELINE */}
      {activeTab === 'pipeline' && (
        <div className="flex-1 flex flex-col gap-2 overflow-hidden">
          {/* Search + Stage Filter + Toggle */}
          <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0 flex-wrap">
            <div className="relative flex-1 min-w-[120px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
              <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar..." className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg py-1.5 pl-8 pr-3 text-xs md:text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
            </div>
            <select 
              value={selectedStage} 
              onChange={(e) => setSelectedStage(e.target.value)}
              className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg py-1.5 px-2 md:px-3 text-xs md:text-sm text-white focus:outline-none focus:border-[var(--accent-primary)] max-w-[140px] md:max-w-none"
            >
              <option value="">Todas ({conversations.length})</option>
              {stages.map(stage => (
                <option key={stage.id} value={stage.id}>{stage.label} ({getConvsByStage(stage.id).length})</option>
              ))}
            </select>
            <button 
              onClick={() => setShowMassMessage(true)} 
              disabled={!selectedStage}
              className="btn-secondary py-1.5 px-2 md:px-3 text-xs disabled:opacity-30"
              title={!selectedStage ? 'Selecciona una etapa' : 'Mensaje masivo'}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
            {/* 🆕 Toggle stages visibility */}
            <button 
              onClick={() => setShowStages(!showStages)} 
              className={`py-1.5 px-2 rounded-lg border text-xs flex items-center gap-1 transition-all ${showStages ? 'bg-white/5 border-[var(--border-secondary)] text-white' : 'bg-[var(--bg-secondary)] border-[var(--border-primary)] text-[var(--text-muted)]'}`}
              title={showStages ? 'Ocultar etapas' : 'Mostrar etapas'}
            >
              {showStages ? <EyeOff className="w-3.5 h-3.5"/> : <Eye className="w-3.5 h-3.5"/>}
              <span className="hidden md:inline">{showStages ? 'Ocultar' : 'Etapas'}</span>
            </button>
          </div>

          {/* 🆕 Collapsible Stage Chips */}
          {showStages && stages.length > 0 && (
            <div className="flex flex-wrap gap-1.5 md:gap-2 flex-shrink-0 animate-fade-in">
              {stages.map(stage => {
                const count = getConvsByStage(stage.id).length;
                return (
                  <button
                    key={stage.id}
                    onClick={() => setSelectedStage(selectedStage === stage.id ? '' : stage.id)}
                    className={`px-2 md:px-2.5 py-0.5 md:py-1 rounded-lg text-[10px] md:text-xs font-medium transition-all border ${
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
          )}

          {/* Conversations Grid */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {stages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 md:py-16 text-center px-4">
                <div className="w-12 h-12 md:w-16 md:h-16 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mb-4">
                  <Sparkles className="w-6 h-6 md:w-8 md:h-8 text-purple-400" />
                </div>
                <h3 className="text-base md:text-lg font-semibold text-white mb-2">Configura tus etapas</h3>
                <p className="text-[var(--text-muted)] text-xs md:text-sm max-w-md mb-4">
                  Las etapas se generan desde la base de conocimiento de tu asistente IA. 
                  Ve a <strong className="text-white">Asistentes IA</strong> y define las etapas de tu negocio.
                </p>
                <button onClick={detectStages} disabled={detecting}
                  className="px-4 py-2 bg-purple-500/20 border border-purple-500/40 text-purple-300 rounded-lg hover:bg-purple-500/30 transition-all text-xs md:text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  {detecting ? 'Detectando...' : 'Detectar etapas ahora'}
                </button>
              </div>
            ) : (
            <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3">
              {(selectedStage ? getConvsByStage(selectedStage) : conversations)
                .filter(c => !searchTerm || c.recipientName?.toLowerCase().includes(searchTerm.toLowerCase()) || c.recipientId?.includes(searchTerm))
                .map((conv) => {
                  const stage = stages.find(s => s.id === conv.stage);
                  const tAgo = () => { const df=Math.floor((Date.now()-new Date(conv.updatedAt).getTime())/1000); if(df<60)return'Ahora'; if(df<3600)return`${Math.floor(df/60)}m`; if(df<86400)return`${Math.floor(df/3600)}h`; return`${Math.floor(df/86400)}d`; };
                  return (
                    <div key={conv.id} className="p-2.5 md:p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] hover:border-[var(--accent-primary)]/50 transition-all group">
                      <div className="flex items-start gap-2">
                        <div className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-[var(--accent-primary)]/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs md:text-sm font-semibold text-[var(--accent-primary)]">{conv.recipientName?.[0] || '?'}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <p className="font-medium text-white text-xs md:text-sm truncate">{conv.recipientName || conv.recipientId}</p>
                            <span className="text-[8px] md:text-[9px] text-[var(--text-muted)] flex-shrink-0">{tAgo()}</span>
                          </div>
                          <p className="text-[9px] md:text-[10px] text-[var(--text-muted)] truncate">{conv.lastMessage || 'Sin mensajes'}</p>
                          <div className="flex items-center justify-between mt-1.5 md:mt-2">
                            <span className={`px-1.5 py-0.5 rounded text-[8px] md:text-[9px] font-medium border ${STAGE_COLORS[stage?.color || 'blue']}`}>
                              {stage?.label || conv.stage}
                            </span>
                            <a href={`/conversaciones?id=${conv.id}`} className="text-[9px] md:text-[10px] text-[var(--accent-primary)] hover:underline opacity-0 group-hover:opacity-100 transition-opacity">Ver →</a>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
            {conversations.length === 0 && (
              <div className="text-center py-12 text-[var(--text-muted)]">
                <MessageSquare className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No hay conversaciones</p>
              </div>
            )}
            </>
            )}
          </div>
        </div>
      )}

      {/* 🔥 LEADS CALIFICADOS */}
      {activeTab === 'leads' && (
        <div className="flex-1 flex flex-col gap-2 md:gap-3 min-h-0 w-full" style={{ maxWidth: '100%' }}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 md:gap-2 flex-shrink-0">
            <button onClick={() => setLeadFilter('all')} className={`px-2 md:px-3 py-1.5 md:py-2 rounded-xl border text-center transition-all ${leadFilter === 'all' ? 'border-[var(--accent-primary)]/50 bg-[var(--accent-primary)]/10' : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-white/5'}`}>
              <div className="text-lg md:text-xl font-black text-white">{scoredLeads.length}</div>
              <div className="text-[9px] md:text-[10px] text-[var(--text-muted)]">Total</div>
            </button>
            <button onClick={() => setLeadFilter('hot')} className={`px-2 md:px-3 py-1.5 md:py-2 rounded-xl border text-center transition-all ${leadFilter === 'hot' ? 'border-red-500/50 bg-red-500/10' : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-white/5'}`}>
              <div className="text-lg md:text-xl font-black text-red-400">🔥 {hotLeads.length}</div>
              <div className="text-[9px] md:text-[10px] text-red-400/70">Calientes</div>
            </button>
            <button onClick={() => setLeadFilter('warm')} className={`px-2 md:px-3 py-1.5 md:py-2 rounded-xl border text-center transition-all ${leadFilter === 'warm' ? 'border-amber-500/50 bg-amber-500/10' : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-white/5'}`}>
              <div className="text-lg md:text-xl font-black text-amber-400">🟡 {warmLeads.length}</div>
              <div className="text-[9px] md:text-[10px] text-amber-400/70">Tibios</div>
            </button>
            <button onClick={() => setLeadFilter('cold')} className={`px-2 md:px-3 py-1.5 md:py-2 rounded-xl border text-center transition-all ${leadFilter === 'cold' ? 'border-blue-500/50 bg-blue-500/10' : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-white/5'}`}>
              <div className="text-lg md:text-xl font-black text-blue-400">🔵 {coldLeads.length}</div>
              <div className="text-[9px] md:text-[10px] text-blue-400/70">Fríos</div>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="space-y-1.5 md:space-y-2">
              {filteredLeads
                .filter(c => !searchTerm || c.recipientName?.toLowerCase().includes(searchTerm.toLowerCase()))
                .map((conv) => {
                  const ls = conv.leadScore;
                  const stage = stages.find(s => s.id === conv.stage);
                  const ctx = conv.contextData || {};
                  const ctxEntries = Object.entries(ctx).filter(([_, v]) => v && String(v).trim() !== '');
                  return (
                    <div key={conv.id} className="p-2.5 md:p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] hover:border-[var(--accent-primary)]/30 transition-all">
                      <div className="flex items-center gap-2 md:gap-3" style={{ width: '100%' }}>
                        <div className={`w-9 h-9 md:w-11 md:h-11 rounded-xl flex flex-col items-center justify-center flex-shrink-0 ${
                          ls.score >= 70 ? 'bg-red-500/20 border border-red-500/30' : ls.score >= 40 ? 'bg-amber-500/20 border border-amber-500/30' : 'bg-blue-500/20 border border-blue-500/30'
                        }`}>
                          <span className="text-xs md:text-sm">{ls.emoji}</span>
                          <span className={`text-[8px] md:text-[9px] font-black ${ls.color}`}>{ls.score}</span>
                        </div>
                        <div className="w-0 flex-1">
                          <div className="flex items-center gap-1.5 md:gap-2">
                            <span className="font-semibold text-white text-xs md:text-sm truncate">{conv.recipientName || conv.recipientId}</span>
                            <span className={`px-1 md:px-1.5 py-0.5 rounded text-[8px] md:text-[9px] font-medium border flex-shrink-0 whitespace-nowrap ${STAGE_COLORS[stage?.color || 'blue']}`}>
                              {stage?.label || conv.stage}
                            </span>
                          </div>
                          <p className="text-[9px] md:text-[10px] text-[var(--text-muted)] truncate mt-0.5">{conv.lastMessage || 'Sin mensajes'}</p>
                          {ctxEntries.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {ctxEntries.slice(0, 3).map(([k, v]) => (
                                <span key={k} className="inline-block px-1 md:px-1.5 py-0.5 rounded bg-white/5 text-[8px] md:text-[9px] text-gray-400">
                                  {k}: <span className="text-white">{String(v).slice(0, 10)}</span>
                                </span>
                              ))}
                              {ctxEntries.length > 3 && <span className="text-[8px] md:text-[9px] text-gray-500">+{ctxEntries.length - 3}</span>}
                            </div>
                          )}
                        </div>
                        <div className="flex-shrink-0 w-12 md:w-16 hidden sm:block">
                          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${ls.score >= 70 ? 'bg-red-500' : ls.score >= 40 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${ls.score}%` }} />
                          </div>
                          <p className="text-[7px] md:text-[8px] text-gray-500 truncate mt-0.5 text-right">{ls.reasons[0]}</p>
                        </div>
                        <a href={`/conversaciones?id=${conv.id}`} className="p-1 md:p-1.5 rounded-lg hover:bg-white/10 transition-all flex-shrink-0">
                          <ArrowUpRight className="w-3.5 h-3.5 md:w-4 md:h-4 text-[var(--accent-primary)]" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              {filteredLeads.length === 0 && (
                <div className="text-center py-12 text-[var(--text-muted)]">
                  <Target className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No hay leads {leadFilter !== 'all' ? `${leadFilter === 'hot' ? 'calientes' : leadFilter === 'warm' ? 'tibios' : 'fríos'}` : ''}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 📊 BARRA DE PROGRESO GLOBAL (import/export) */}
      {importProgress.active && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--bg-secondary)] border border-[var(--accent-primary)]/40 rounded-xl shadow-2xl p-3 w-80 animate-fade-in">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-white font-medium">{importProgress.label}</span>
            <span className="text-xs text-[var(--accent-primary)] font-bold">{importProgress.percent}%</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${importProgress.percent}%`, background: importProgress.percent === 100 ? '#10b981' : 'var(--accent-primary)' }}
            />
          </div>
        </div>
      )}

      {/* CLIENTES */}
      {activeTab === 'clients' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-1.5 md:gap-2 mb-2 md:mb-3 flex-shrink-0 flex-wrap">
            <button onClick={exportClients} className="flex items-center gap-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-[10px] md:text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all">
              <Download className="w-3 h-3 md:w-3.5 md:h-3.5" /> Excel
            </button>
            <label className="flex items-center gap-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-[10px] md:text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all cursor-pointer">
              <Upload className="w-3 h-3 md:w-3.5 md:h-3.5" /> Excel
              <input type="file" accept=".csv,.txt,.xls,.xlsx" className="hidden" onChange={(e) => { if (e.target.files?.[0]) importClients(e.target.files[0]); e.target.value = ''; }} />
            </label>
            <button onClick={() => { setShowClientMass(true); setMassMessageText(''); setMassMediaFile(null); setMassMediaPreview(null); }} className="flex items-center gap-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-[10px] md:text-xs font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-all" disabled={clients.length === 0}>
              <Send className="w-3 h-3 md:w-3.5 md:h-3.5" /> <span className="hidden sm:inline">Masivo</span> ({clients.filter(c => !searchTerm || c.name?.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone?.includes(searchTerm)).length})
            </button>
            <span className="text-[9px] md:text-[10px] text-[var(--text-muted)]">{clients.length} clientes</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
              {clients.filter(c => !searchTerm || c.name?.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone?.includes(searchTerm))
                .map((client) => (
                  <div key={client.id} className="p-3 md:p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] hover:border-[var(--accent-primary)]/30 transition-all">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 md:gap-3 min-w-0">
                        <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs md:text-sm font-semibold text-cyan-400">{client.name?.[0] || '?'}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-white text-xs md:text-sm truncate">{client.name}</p>
                          <p className="text-[10px] md:text-xs text-[var(--text-muted)] flex items-center gap-1"><Phone className="w-2.5 h-2.5 md:w-3 md:h-3 flex-shrink-0" />{client.phone}</p>
                          {client.email && <p className="text-[10px] md:text-xs text-[var(--text-muted)] flex items-center gap-1 truncate"><Mail className="w-2.5 h-2.5 md:w-3 md:h-3 flex-shrink-0" />{client.email}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => sendMessageToClient(client.phone, client.name)} className="p-1 md:p-1.5 hover:bg-emerald-500/10 rounded-lg"><Send className="w-3 h-3 md:w-3.5 md:h-3.5 text-emerald-400" /></button>
                        <button onClick={() => { setEditingItem(client); setClientForm({ ...client, address: client.address || '', notes: client.notes || '', tags: client.tags?.join(', ') || '' }); setShowClientModal(true); }} className="p-1 md:p-1.5 hover:bg-white/10 rounded-lg"><Edit2 className="w-3 h-3 md:w-3.5 md:h-3.5 text-[var(--text-muted)]" /></button>
                        <button onClick={() => handleDelete('client', client.id)} className="p-1 md:p-1.5 hover:bg-red-500/10 rounded-lg"><Trash2 className="w-3 h-3 md:w-3.5 md:h-3.5 text-red-400" /></button>
                      </div>
                    </div>
                    <div className="mt-1.5 md:mt-2 space-y-0.5 md:space-y-1">
                      {client.address && <p className="text-[10px] md:text-xs text-[var(--text-muted)] truncate">📍 {client.address}</p>}
                      {client.notes && <p className="text-[10px] md:text-xs text-amber-400/80 truncate">📝 {client.notes}</p>}
                      <div className="flex items-center gap-1.5 md:gap-2 flex-wrap">
                        {client.status && (
                          <span className={`text-[9px] md:text-[10px] px-1.5 md:px-2 py-0.5 rounded-full font-medium ${client.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : client.status === 'lead' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-400'}`}>
                            {client.status === 'active' ? '✅ Activo' : client.status === 'lead' ? '🔵 Lead' : client.status}
                          </span>
                        )}
                        {client.totalPurchases > 0 && <span className="text-[9px] md:text-[10px] px-1.5 md:px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">💰 ${client.totalPurchases.toLocaleString()}</span>}
                        {client.tags?.length > 0 && client.tags.slice(0,2).map((t: string, i: number) => (
                          <span key={i} className="text-[9px] md:text-[10px] px-1.5 md:px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400">{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
            {clients.length === 0 && (
              <div className="text-center py-12 text-[var(--text-muted)]">
                <Users className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No hay clientes</p>
                <button onClick={() => setShowClientModal(true)} className="btn-primary mt-4 text-sm"><Plus className="w-4 h-4" /> Agregar</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PRODUCTOS */}
      {activeTab === 'products' && (
        <div className="flex-1 overflow-y-auto">
          <div className="mb-3 md:mb-4 flex items-center justify-between">
            <span className="text-xs md:text-sm text-[var(--text-muted)]">{products.length}/{maxProducts} productos</span>
          </div>
          
          {!canAddProduct ? (
            <div className="mb-3 md:mb-4 p-3 md:p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
              <div className="flex items-center gap-2 md:gap-3">
                <span className="text-xl md:text-2xl">📦</span>
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs md:text-sm font-bold text-white">Límite alcanzado</h4>
                  <p className="text-[10px] md:text-xs text-gray-400">Máximo {maxProducts} productos.</p>
                </div>
                <a href="/subscription#addons" className="px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-[10px] md:text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all whitespace-nowrap">
                  +10 — $20
                </a>
              </div>
            </div>
          ) : products.length >= maxProducts - 3 && products.length > 0 ? (
            <div className="mb-3 p-2.5 md:p-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
              <div className="flex items-center gap-2 md:gap-3">
                <span className="text-base md:text-lg">📦</span>
                <div className="flex-1"><p className="text-[10px] md:text-xs text-gray-400">{maxProducts - products.length} disponibles</p></div>
                <a href="/subscription#addons" className="px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-[10px] md:text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all whitespace-nowrap">+10 — $20</a>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3">
            {products.filter(p => !searchTerm || p.name?.toLowerCase().includes(searchTerm.toLowerCase()))
              .map((product) => (
                <div key={product.id} className="p-3 md:p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white text-xs md:text-sm truncate">{product.name}</p>
                      <p className="text-base md:text-lg font-bold text-emerald-400">${product.price?.toLocaleString()}</p>
                      <p className="text-[10px] md:text-xs text-[var(--text-muted)]">Stock: {product.stock}</p>
                      {product.category && <span className="inline-block mt-1 px-1.5 md:px-2 py-0.5 rounded text-[9px] md:text-[10px] bg-purple-500/20 text-purple-400">{product.category}</span>}
                    </div>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => { setEditingItem(product); setProductForm({ ...product, price: product.price?.toString() || '', stock: product.stock?.toString() || '' }); setShowProductModal(true); }} className="p-1 md:p-1.5 hover:bg-white/10 rounded-lg"><Edit2 className="w-3 h-3 md:w-3.5 md:h-3.5 text-[var(--text-muted)]" /></button>
                      <button onClick={() => handleDelete('product', product.id)} className="p-1 md:p-1.5 hover:bg-red-500/10 rounded-lg"><Trash2 className="w-3 h-3 md:w-3.5 md:h-3.5 text-red-400" /></button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
          {products.length === 0 && (
            <div className="text-center py-12 text-[var(--text-muted)]">
              <Package className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No hay productos</p>
              <button onClick={() => setShowProductModal(true)} className="btn-primary mt-4 text-sm"><Plus className="w-4 h-4" /> Agregar</button>
            </div>
          )}
        </div>
      )}

      {/* ══════ MODALES ══════ */}
      
      {/* Modal Mensaje Masivo Pipeline */}
      {showMassMessage && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => !sendingMass && setShowMassMessage(false)}>
          <div className="bg-[var(--bg-secondary)] rounded-t-2xl sm:rounded-xl p-4 w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-white text-sm md:text-base">Mensaje Masivo</h3>
              <button onClick={() => !sendingMass && setShowMassMessage(false)} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs md:text-sm text-[var(--text-muted)] mb-3">
              Enviar a: <strong className="text-white">{stages.find(s => s.id === selectedStage)?.label}</strong> ({getConvsByStage(selectedStage).length} contactos)
            </p>
            <textarea value={massMessageText} onChange={(e) => setMassMessageText(e.target.value)} placeholder="Escribe tu mensaje..." disabled={sendingMass}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg p-3 text-sm text-white placeholder-[var(--text-muted)] min-h-[80px] md:min-h-[100px] resize-none mb-3 focus:outline-none focus:border-[var(--accent-primary)] disabled:opacity-50" />
            <div className="mb-3">
              <input ref={massFileInputRef} type="file" accept="image/*,audio/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx" onChange={handleMassFileSelect} className="hidden" />
              {massMediaFile ? (
                <div className="flex items-center gap-2 p-2 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-primary)]">
                  {massMediaPreview ? <img src={massMediaPreview} alt="" className="w-10 h-10 md:w-12 md:h-12 rounded object-cover" /> : <div className="w-10 h-10 md:w-12 md:h-12 rounded bg-[var(--accent-primary)]/20 flex items-center justify-center">{massMediaFile.type.startsWith('audio/') ? <Mic className="w-4 h-4 md:w-5 md:h-5 text-[var(--accent-primary)]" /> : <FileText className="w-4 h-4 md:w-5 md:h-5 text-[var(--accent-primary)]" />}</div>}
                  <div className="flex-1 min-w-0"><p className="text-xs text-white truncate">{massMediaFile.name}</p><p className="text-[10px] text-[var(--text-muted)]">{(massMediaFile.size / 1024).toFixed(0)} KB</p></div>
                  <button onClick={removeMassMedia} className="p-1 hover:bg-white/10 rounded" disabled={sendingMass}><X className="w-4 h-4 text-red-400" /></button>
                </div>
              ) : (
                <div className="flex gap-1.5 md:gap-2">
                  <button onClick={() => { if (massFileInputRef.current) { massFileInputRef.current.accept = 'image/*'; massFileInputRef.current.click(); } }} className="flex items-center gap-1 px-2 md:px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg text-[10px] md:text-xs text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-all border border-[var(--border-primary)]" disabled={sendingMass}><Image className="w-3 h-3 md:w-3.5 md:h-3.5" /> Imagen</button>
                  <button onClick={() => { if (massFileInputRef.current) { massFileInputRef.current.accept = 'audio/*'; massFileInputRef.current.click(); } }} className="flex items-center gap-1 px-2 md:px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg text-[10px] md:text-xs text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-all border border-[var(--border-primary)]" disabled={sendingMass}><Mic className="w-3 h-3 md:w-3.5 md:h-3.5" /> Audio</button>
                  <button onClick={() => { if (massFileInputRef.current) { massFileInputRef.current.accept = '*/*'; massFileInputRef.current.click(); } }} className="flex items-center gap-1 px-2 md:px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg text-[10px] md:text-xs text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-all border border-[var(--border-primary)]" disabled={sendingMass}><Paperclip className="w-3 h-3 md:w-3.5 md:h-3.5" /> Archivo</button>
                </div>
              )}
            </div>
            {sendingMass && massTotal > 0 && (
              <div className="mb-3"><div className="flex justify-between text-xs text-[var(--text-muted)] mb-1"><span>Enviando...</span><span>{massSentCount}/{massTotal}</span></div><div className="w-full bg-[var(--bg-tertiary)] rounded-full h-2"><div className="bg-[var(--accent-primary)] h-2 rounded-full transition-all duration-500" style={{ width: `${(massSentCount / massTotal) * 100}%` }} /></div></div>
            )}
            <button onClick={sendMassMessage} disabled={sendingMass || (!massMessageText.trim() && !massMediaFile)} className="btn-primary w-full py-2 text-sm disabled:opacity-50">
              {sendingMass ? `Enviando ${massSentCount}/${massTotal}...` : `Enviar a ${getConvsByStage(selectedStage).length} contactos`}
            </button>
          </div>
        </div>
      )}

      {/* Modal Cliente */}
      {showClientModal && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => { setShowClientModal(false); resetForms(); }}>
          <div className="bg-[var(--bg-secondary)] rounded-t-2xl sm:rounded-xl p-4 w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-white text-sm md:text-base">{editingItem ? 'Editar' : 'Nuevo'} Cliente</h3>
              <button onClick={() => { setShowClientModal(false); resetForms(); }} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-2.5 md:space-y-3">
              <input type="text" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} placeholder="Nombre *" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              <input type="text" value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} placeholder="Teléfono *" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              <input type="email" value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} placeholder="Email" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              <input type="text" value={clientForm.address} onChange={(e) => setClientForm({ ...clientForm, address: e.target.value })} placeholder="Dirección" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              <textarea value={clientForm.notes} onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })} placeholder="Notas" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] min-h-[50px] resize-none focus:outline-none focus:border-[var(--accent-primary)]" />
              <input type="text" value={clientForm.tags} onChange={(e) => setClientForm({ ...clientForm, tags: e.target.value })} placeholder="Tags (separadas por coma)" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              <select value={clientForm.status} onChange={(e) => setClientForm({ ...clientForm, status: e.target.value })} className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white focus:outline-none focus:border-[var(--accent-primary)]">
                <option value="lead">Lead</option><option value="active">Activo</option><option value="inactive">Inactivo</option><option value="vip">VIP</option>
              </select>
              <button onClick={handleSaveClient} className="btn-primary w-full py-2 text-sm">{editingItem ? 'Actualizar' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Mensaje Masivo Clientes */}
      {showClientMass && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => !sendingMass && setShowClientMass(false)}>
          <div className="bg-[var(--bg-secondary)] rounded-t-2xl sm:rounded-xl p-4 w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-white text-sm md:text-base">📩 Masivo — Clientes</h3>
              <button onClick={() => !sendingMass && setShowClientMass(false)} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
            </div>
            {/* Filtros de segmento */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {[
                { id: 'all', label: 'Todos', count: clients.length },
                { id: 'importado', label: '📥 Importados', count: clients.filter(c => c.tags?.includes('importado')).length },
                { id: 'lead', label: '🔵 Leads', count: clients.filter(c => c.status === 'lead').length },
                { id: 'active', label: '✅ Activos', count: clients.filter(c => c.status === 'active').length },
                { id: 'vip', label: '⭐ VIP', count: clients.filter(c => c.status === 'vip').length },
              ].map(f => (
                <button key={f.id} onClick={() => { setClientMassFilter(f.id as any); setSelectedMassTags([]); }}
                  className={`px-2 py-0.5 rounded-lg text-[10px] border transition-all ${clientMassFilter === f.id && selectedMassTags.length === 0 ? 'bg-violet-500/30 border-violet-500/50 text-violet-300' : 'bg-white/5 border-white/10 text-[var(--text-muted)] hover:text-white'}`}>
                  {f.label} ({f.count})
                </button>
              ))}
            </div>
            {/* Filtro por Tags — genérico para cualquier negocio */}
            {(() => {
              const allTags = Array.from(new Set(clients.flatMap(c => c.tags || []))).filter(Boolean).sort();
              if (allTags.length === 0) return null;
              return (
                <div className="mb-3 p-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                  <p className="text-[10px] text-[var(--text-muted)] mb-1.5 flex items-center gap-1">
                    🏷️ <span>Filtrar por etiqueta <span className="text-[var(--accent-primary)]">(puedes combinar varios)</span></span>
                    {selectedMassTags.length > 0 && (
                      <button onClick={() => setSelectedMassTags([])} className="ml-auto text-[9px] text-red-400 hover:text-red-300 underline">Limpiar</button>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {allTags.map(tag => (
                      <button key={tag} onClick={() => setSelectedMassTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                        className={`px-2 py-0.5 rounded-full text-[10px] border transition-all ${selectedMassTags.includes(tag) ? 'bg-[var(--accent-primary)]/30 border-[var(--accent-primary)]/60 text-white' : 'bg-white/5 border-white/10 text-[var(--text-muted)] hover:text-white hover:border-white/20'}`}>
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
            {/* Filtro por fecha de importación */}
            <div className="mb-3 p-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">📅 <span>Filtrar por fecha de importación</span></p>
                {(massDateFrom || massDateTo) && (
                  <button onClick={() => { setMassDateFrom(''); setMassDateTo(''); }} className="text-[9px] text-red-400 hover:text-red-300 underline">Limpiar</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[9px] text-[var(--text-muted)] mb-1">Desde</p>
                  <input type="date" value={massDateFrom} onChange={e => setMassDateFrom(e.target.value)}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg py-1.5 px-2 text-xs text-white focus:outline-none focus:border-[var(--accent-primary)]" />
                </div>
                <div>
                  <p className="text-[9px] text-[var(--text-muted)] mb-1">Hasta</p>
                  <input type="date" value={massDateTo} onChange={e => setMassDateTo(e.target.value)}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg py-1.5 px-2 text-xs text-white focus:outline-none focus:border-[var(--accent-primary)]" />
                </div>
              </div>
              {(massDateFrom || massDateTo) && (() => {
                const count = clients.filter(c => {
                  const d = c.createdAt ? new Date(c.createdAt) : null;
                  const from = massDateFrom ? new Date(massDateFrom) : null;
                  const to = massDateTo ? new Date(massDateTo + 'T23:59:59') : null;
                  return (!from || !d || d >= from) && (!to || !d || d <= to);
                }).length;
                return <p className="text-[10px] text-[var(--accent-primary)] mt-1.5">{count} clientes en este rango de fechas</p>;
              })()}
            </div>
            <p className="text-xs md:text-sm text-[var(--text-muted)] mb-3">
              Enviar a: <strong className="text-white">{clients.filter(c => {
                const matchSearch = !searchTerm || c.name?.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone?.includes(searchTerm);
                const matchFilter = clientMassFilter === 'all' ? true : clientMassFilter === 'importado' ? c.tags?.includes('importado') : c.status === clientMassFilter;
                const matchTags = selectedMassTags.length === 0 ? true : selectedMassTags.every(tag => c.tags?.includes(tag));
                const d = c.createdAt ? new Date(c.createdAt) : null;
                const matchFrom = !massDateFrom ? true : !d ? true : d >= new Date(massDateFrom);
                const matchTo = !massDateTo ? true : !d ? true : d <= new Date(massDateTo + 'T23:59:59');
                return matchSearch && matchFilter && matchTags && matchFrom && matchTo;
              }).length} clientes</strong>
              {(clientMassFilter !== 'all' || selectedMassTags.length > 0 || massDateFrom || massDateTo) && <span className="text-violet-400"> · filtros activos</span>}
              {searchTerm && <span className="text-amber-400"> · búsqueda: &quot;{searchTerm}&quot;</span>}
            </p>
            <textarea value={massMessageText} onChange={(e) => setMassMessageText(e.target.value)} placeholder="Escribe tu mensaje..." disabled={sendingMass}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg p-3 text-sm text-white placeholder-[var(--text-muted)] min-h-[80px] md:min-h-[100px] resize-none mb-3 focus:outline-none focus:border-[var(--accent-primary)] disabled:opacity-50" />
            <div className="mb-3">
              <input ref={massFileInputRef} type="file" accept="image/*,audio/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx" onChange={handleMassFileSelect} className="hidden" />
              {massMediaFile ? (
                <div className="flex items-center gap-2 p-2 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-primary)]">
                  {massMediaPreview ? <img src={massMediaPreview} alt="" className="w-10 h-10 md:w-12 md:h-12 rounded object-cover" /> : <div className="w-10 h-10 md:w-12 md:h-12 rounded bg-[var(--accent-primary)]/20 flex items-center justify-center">{massMediaFile.type.startsWith('audio/') ? <Mic className="w-4 h-4 md:w-5 md:h-5 text-[var(--accent-primary)]" /> : <FileText className="w-4 h-4 md:w-5 md:h-5 text-[var(--accent-primary)]" />}</div>}
                  <div className="flex-1 min-w-0"><p className="text-xs text-white truncate">{massMediaFile.name}</p><p className="text-[10px] text-[var(--text-muted)]">{(massMediaFile.size / 1024).toFixed(0)} KB</p></div>
                  <button onClick={removeMassMedia} className="p-1 hover:bg-white/10 rounded" disabled={sendingMass}><X className="w-4 h-4 text-red-400" /></button>
                </div>
              ) : (
                <div className="flex gap-1.5 md:gap-2">
                  <button onClick={() => { if (massFileInputRef.current) { massFileInputRef.current.accept = 'image/*'; massFileInputRef.current.click(); } }} className="flex items-center gap-1 px-2 md:px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg text-[10px] md:text-xs text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-all border border-[var(--border-primary)]" disabled={sendingMass}><Image className="w-3 h-3 md:w-3.5 md:h-3.5" /> Imagen</button>
                  <button onClick={() => { if (massFileInputRef.current) { massFileInputRef.current.accept = 'audio/*'; massFileInputRef.current.click(); } }} className="flex items-center gap-1 px-2 md:px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg text-[10px] md:text-xs text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-all border border-[var(--border-primary)]" disabled={sendingMass}><Mic className="w-3 h-3 md:w-3.5 md:h-3.5" /> Audio</button>
                  <button onClick={() => { if (massFileInputRef.current) { massFileInputRef.current.accept = '*/*'; massFileInputRef.current.click(); } }} className="flex items-center gap-1 px-2 md:px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg text-[10px] md:text-xs text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-all border border-[var(--border-primary)]" disabled={sendingMass}><Paperclip className="w-3 h-3 md:w-3.5 md:h-3.5" /> Archivo</button>
                </div>
              )}
            </div>
            {sendingMass && massTotal > 0 && (
              <div className="mb-3"><div className="flex justify-between text-xs text-[var(--text-muted)] mb-1"><span>Enviando...</span><span>{massSentCount}/{massTotal}</span></div><div className="w-full bg-[var(--bg-tertiary)] rounded-full h-2"><div className="bg-[var(--accent-primary)] h-2 rounded-full transition-all duration-500" style={{ width: `${(massSentCount / massTotal) * 100}%` }} /></div></div>
            )}
            <button onClick={sendClientMassMessage} disabled={sendingMass || (!massMessageText.trim() && !massMediaFile)} className="btn-primary w-full py-2 text-sm disabled:opacity-50">
              {sendingMass ? `Enviando ${massSentCount}/${massTotal}...` : `Enviar a ${clients.filter(c => { const ms = !searchTerm || c.name?.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone?.includes(searchTerm); const mf = clientMassFilter === 'all' ? true : clientMassFilter === 'importado' ? c.tags?.includes('importado') : c.status === clientMassFilter; const mt = selectedMassTags.length === 0 ? true : selectedMassTags.every(tag => c.tags?.includes(tag)); const d = c.createdAt ? new Date(c.createdAt) : null; const mdf = !massDateFrom ? true : !d ? true : d >= new Date(massDateFrom); const mdt = !massDateTo ? true : !d ? true : d <= new Date(massDateTo + 'T23:59:59'); return ms && mf && mt && mdf && mdt; }).length} clientes`}
            </button>
          </div>
        </div>
      )}

      {/* Modal Producto */}
      {showProductModal && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => setShowProductModal(false)}>
          <div className="bg-[var(--bg-secondary)] rounded-t-2xl sm:rounded-xl p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-white text-sm md:text-base">{editingItem ? 'Editar' : 'Nuevo'} Producto</h3>
              <button onClick={() => { setShowProductModal(false); resetForms(); }} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-2.5 md:space-y-3">
              <input type="text" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} placeholder="Nombre *" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              <textarea value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} placeholder="Descripción" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] min-h-[50px] resize-none focus:outline-none focus:border-[var(--accent-primary)]" />
              <div className="grid grid-cols-2 gap-2 md:gap-3">
                <input type="number" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} placeholder="Precio" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
                <input type="number" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })} placeholder="Stock" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              </div>
              <input type="text" value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} placeholder="Categoría" className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg py-2 px-3 text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]" />
              <button onClick={handleSaveProduct} className="btn-primary w-full py-2 text-sm">{editingItem ? 'Actualizar' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

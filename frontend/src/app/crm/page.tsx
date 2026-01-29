'use client';

import { useState, useEffect } from 'react';
import { Users, Package, Plus, Search, Filter, Edit2, Trash2, Phone, Mail, Tag, X, DollarSign, Box, ChevronRight } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function CRMPage() {
  const [activeTab, setActiveTab] = useState<'clients' | 'products'>('clients');
  const [clients, setClients] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const [clientForm, setClientForm] = useState({ name: '', phone: '', email: '', address: '', status: 'lead', tags: '', notes: '' });
  const [productForm, setProductForm] = useState({ name: '', description: '', price: '', stock: '', category: '' });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const [clientsRes, productsRes] = await Promise.all([
        fetch(`${API_URL}/api/clients`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null),
        fetch(`${API_URL}/api/products`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null)
      ]);

      if (clientsRes?.ok) setClients((await clientsRes.json()).clients || []);
      if (productsRes?.ok) setProducts((await productsRes.json()).products || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveClient = async () => {
    const token = localStorage.getItem('token');
    const method = editingItem ? 'PUT' : 'POST';
    const url = editingItem ? `${API_URL}/api/clients/${editingItem.id}` : `${API_URL}/api/clients`;

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...clientForm,
          tags: clientForm.tags ? clientForm.tags.split(',').map(t => t.trim()) : []
        })
      });

      if (res.ok) {
        fetchData();
        setShowModal(false);
        resetForms();
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleSaveProduct = async () => {
    const token = localStorage.getItem('token');
    const method = editingItem ? 'PUT' : 'POST';
    const url = editingItem ? `${API_URL}/api/products/${editingItem.id}` : `${API_URL}/api/products`;

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...productForm,
          price: parseFloat(productForm.price) || 0,
          stock: parseInt(productForm.stock) || 0
        })
      });

      if (res.ok) {
        fetchData();
        setShowModal(false);
        resetForms();
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleDelete = async (id: string, type: 'client' | 'product') => {
    if (!confirm('¿Estás seguro de eliminar?')) return;
    const token = localStorage.getItem('token');
    const url = type === 'client' ? `${API_URL}/api/clients/${id}` : `${API_URL}/api/products/${id}`;

    try {
      await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      fetchData();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const resetForms = () => {
    setClientForm({ name: '', phone: '', email: '', address: '', status: 'lead', tags: '', notes: '' });
    setProductForm({ name: '', description: '', price: '', stock: '', category: '' });
    setEditingItem(null);
  };

  const openEditClient = (client: any) => {
    setEditingItem(client);
    setClientForm({
      name: client.name, phone: client.phone, email: client.email || '',
      address: client.address || '', status: client.status, tags: client.tags?.join(', ') || '', notes: client.notes || ''
    });
    setShowModal(true);
  };

  const openEditProduct = (product: any) => {
    setEditingItem(product);
    setProductForm({
      name: product.name, description: product.description || '',
      price: product.price?.toString() || '', stock: product.stock?.toString() || '', category: product.category || ''
    });
    setShowModal(true);
  };

  const filteredClients = clients.filter(c => {
    const matchSearch = c.name?.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone?.includes(searchTerm);
    const matchStatus = filterStatus === 'all' || c.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const filteredProducts = products.filter(p => p.name?.toLowerCase().includes(searchTerm.toLowerCase()));

  const stats = {
    totalClients: clients.length,
    activeClients: clients.filter(c => c.status === 'active').length,
    totalRevenue: clients.reduce((sum, c) => sum + (c.totalPurchases || 0), 0),
    totalProducts: products.length
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <img src="/elisa.png" alt="Elisa" className="w-16 h-16 rounded-xl animate-pulse" />
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/elisa.png" alt="Elisa IA" className="w-14 h-14 rounded-xl hidden md:block" />
          <div>
            <h1 className="text-3xl font-bold text-white">CRM</h1>
            <p className="text-[var(--text-muted)]">Gestiona clientes y productos</p>
          </div>
        </div>
        <button onClick={() => { resetForms(); setShowModal(true); }} className="btn-primary">
          <Plus className="w-4 h-4" />Nuevo {activeTab === 'clients' ? 'Cliente' : 'Producto'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="stat-value">{stats.totalClients}</div>
          <div className="stat-label">Total Clientes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.activeClients}</div>
          <div className="stat-label">Clientes Activos</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">${stats.totalRevenue.toLocaleString()}</div>
          <div className="stat-label">Ingresos Totales</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalProducts}</div>
          <div className="stat-label">Productos</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-[var(--bg-tertiary)] rounded-xl w-fit">
        <button onClick={() => setActiveTab('clients')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${activeTab === 'clients' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)] hover:text-white'}`}>
          <Users className="w-4 h-4" />Clientes
        </button>
        <button onClick={() => setActiveTab('products')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${activeTab === 'products' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-muted)] hover:text-white'}`}>
          <Package className="w-4 h-4" />Productos
        </button>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input type="text" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="input pl-11" />
        </div>
        {activeTab === 'clients' && (
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
            className="input w-auto">
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="lead">Leads</option>
            <option value="inactive">Inactivos</option>
          </select>
        )}
      </div>

      {/* Content */}
      {activeTab === 'clients' ? (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contacto</th>
                <th>Estado</th>
                <th>Compras</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="avatar">{client.name?.[0] || 'C'}</div>
                      <div>
                        <p className="font-medium text-white">{client.name}</p>
                        {client.tags?.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {client.tags.slice(0, 2).map((tag: string, i: number) => (
                              <span key={i} className="text-xs px-2 py-0.5 bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] rounded">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col gap-1">
                      <span className="flex items-center gap-2 text-sm"><Phone className="w-3 h-3" />{client.phone}</span>
                      {client.email && <span className="flex items-center gap-2 text-sm"><Mail className="w-3 h-3" />{client.email}</span>}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${client.status === 'active' ? 'badge-success' : client.status === 'lead' ? 'badge-warning' : 'badge-danger'}`}>
                      {client.status === 'active' ? 'Activo' : client.status === 'lead' ? 'Lead' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <span className="text-[var(--accent-primary)] font-semibold">${(client.totalPurchases || 0).toLocaleString()}</span>
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <button onClick={() => openEditClient(client)} className="btn-icon"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(client.id, 'client')} className="btn-icon text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredClients.length === 0 && (
            <div className="text-center py-12 text-[var(--text-muted)]">
              <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No hay clientes</p>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProducts.map((product) => (
            <div key={product.id} className="card glass-hover">
              <div className="flex items-start justify-between mb-4">
                <div className="w-14 h-14 rounded-xl bg-[var(--accent-primary)]/20 flex items-center justify-center">
                  <Box className="w-7 h-7 text-[var(--accent-primary)]" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEditProduct(product)} className="btn-icon"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(product.id, 'product')} className="btn-icon text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{product.name}</h3>
              <p className="text-sm text-[var(--text-muted)] mb-4 line-clamp-2">{product.description || 'Sin descripción'}</p>
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-[var(--accent-primary)]">${product.price?.toLocaleString() || 0}</span>
                <span className={`badge ${(product.stock || 0) < 10 ? 'badge-danger' : 'badge-success'}`}>
                  Stock: {product.stock || 0}
                </span>
              </div>
              {product.category && (
                <div className="mt-4 pt-4 border-t border-[var(--border-primary)]">
                  <span className="text-xs text-[var(--text-muted)]">Categoría: {product.category}</span>
                </div>
              )}
            </div>
          ))}
          {filteredProducts.length === 0 && (
            <div className="col-span-full text-center py-12 text-[var(--text-muted)]">
              <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No hay productos</p>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">
                {editingItem ? 'Editar' : 'Nuevo'} {activeTab === 'clients' ? 'Cliente' : 'Producto'}
              </h3>
              <button onClick={() => setShowModal(false)} className="btn-icon"><X className="w-5 h-5" /></button>
            </div>

            {activeTab === 'clients' ? (
              <div className="space-y-4">
                <div>
                  <label className="input-label">Nombre *</label>
                  <input type="text" value={clientForm.name} onChange={(e) => setClientForm({...clientForm, name: e.target.value})}
                    className="input" placeholder="Nombre del cliente" />
                </div>
                <div>
                  <label className="input-label">Teléfono *</label>
                  <input type="text" value={clientForm.phone} onChange={(e) => setClientForm({...clientForm, phone: e.target.value})}
                    className="input" placeholder="+57 300 123 4567" />
                </div>
                <div>
                  <label className="input-label">Email</label>
                  <input type="email" value={clientForm.email} onChange={(e) => setClientForm({...clientForm, email: e.target.value})}
                    className="input" placeholder="cliente@email.com" />
                </div>
                <div>
                  <label className="input-label">Dirección</label>
                  <input type="text" value={clientForm.address} onChange={(e) => setClientForm({...clientForm, address: e.target.value})}
                    className="input" placeholder="Dirección completa" />
                </div>
                <div>
                  <label className="input-label">Estado</label>
                  <select value={clientForm.status} onChange={(e) => setClientForm({...clientForm, status: e.target.value})}
                    className="input">
                    <option value="lead">Lead</option>
                    <option value="active">Activo</option>
                    <option value="inactive">Inactivo</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Etiquetas (separadas por coma)</label>
                  <input type="text" value={clientForm.tags} onChange={(e) => setClientForm({...clientForm, tags: e.target.value})}
                    className="input" placeholder="VIP, Frecuente, Mayorista" />
                </div>
                <div>
                  <label className="input-label">Notas</label>
                  <textarea value={clientForm.notes} onChange={(e) => setClientForm({...clientForm, notes: e.target.value})}
                    className="input min-h-[80px]" placeholder="Notas adicionales..." />
                </div>
                <button onClick={handleSaveClient} className="btn-primary w-full">{editingItem ? 'Actualizar' : 'Guardar'} Cliente</button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="input-label">Nombre *</label>
                  <input type="text" value={productForm.name} onChange={(e) => setProductForm({...productForm, name: e.target.value})}
                    className="input" placeholder="Nombre del producto" />
                </div>
                <div>
                  <label className="input-label">Descripción</label>
                  <textarea value={productForm.description} onChange={(e) => setProductForm({...productForm, description: e.target.value})}
                    className="input min-h-[80px]" placeholder="Descripción del producto" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="input-label">Precio</label>
                    <input type="number" value={productForm.price} onChange={(e) => setProductForm({...productForm, price: e.target.value})}
                      className="input" placeholder="0" />
                  </div>
                  <div>
                    <label className="input-label">Stock</label>
                    <input type="number" value={productForm.stock} onChange={(e) => setProductForm({...productForm, stock: e.target.value})}
                      className="input" placeholder="0" />
                  </div>
                </div>
                <div>
                  <label className="input-label">Categoría</label>
                  <input type="text" value={productForm.category} onChange={(e) => setProductForm({...productForm, category: e.target.value})}
                    className="input" placeholder="Categoría del producto" />
                </div>
                <button onClick={handleSaveProduct} className="btn-primary w-full">{editingItem ? 'Actualizar' : 'Guardar'} Producto</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Elisa Footer */}
      <div className="flex items-center justify-center py-4">
        <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
          <img src="/elisa.png" alt="Elisa" className="w-5 h-5 rounded" />
          CRM powered by Elisa IA
        </div>
      </div>
    </div>
  );
}

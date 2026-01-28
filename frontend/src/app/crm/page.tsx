'use client';

import { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Search, 
  Filter,
  MoreVertical,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Package,
  DollarSign,
  Edit2,
  Trash2,
  Eye,
  X,
  Plus,
  ChevronDown,
  TrendingUp,
  ShoppingBag,
  MessageSquare,
  Star,
  Tag
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Client {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  notes?: string;
  tags: string[];
  totalPurchases: number;
  lastContact?: string;
  status: 'active' | 'inactive' | 'lead';
  createdAt: string;
}

interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  stock: number;
  category: string;
  image?: string;
}

export default function CRMPage() {
  const [activeTab, setActiveTab] = useState<'clients' | 'products'>('clients');
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'client' | 'product'>('client');
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      // Simulated data - Replace with actual API calls
      setClients([
        {
          id: '1',
          name: 'María García',
          phone: '+57 320 123 4567',
          email: 'maria@email.com',
          address: 'Bogotá, Colombia',
          notes: 'Cliente frecuente, prefiere buzos premium',
          tags: ['VIP', 'Frecuente'],
          totalPurchases: 450000,
          lastContact: '2026-01-28',
          status: 'active',
          createdAt: '2025-06-15'
        },
        {
          id: '2',
          name: 'Carlos López',
          phone: '+57 315 987 6543',
          email: 'carlos@email.com',
          address: 'Medellín, Colombia',
          notes: 'Interesado en productos deportivos',
          tags: ['Nuevo'],
          totalPurchases: 150000,
          lastContact: '2026-01-27',
          status: 'active',
          createdAt: '2026-01-20'
        },
        {
          id: '3',
          name: 'Ana Martínez',
          phone: '+57 310 456 7890',
          email: 'ana@email.com',
          tags: ['Lead'],
          totalPurchases: 0,
          lastContact: '2026-01-25',
          status: 'lead',
          createdAt: '2026-01-25'
        },
      ]);

      setProducts([
        {
          id: '1',
          name: 'Buzo Premium Marfil',
          description: 'Buzo de alta calidad en color marfil',
          price: 85000,
          stock: 25,
          category: 'Buzos'
        },
        {
          id: '2',
          name: 'Buzo Premium Negro',
          description: 'Buzo de alta calidad en color negro',
          price: 85000,
          stock: 30,
          category: 'Buzos'
        },
        {
          id: '3',
          name: 'Camiseta Básica',
          description: 'Camiseta de algodón básica',
          price: 45000,
          stock: 50,
          category: 'Camisetas'
        },
      ]);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const openModal = (type: 'client' | 'product', item?: any) => {
    setModalType(type);
    setSelectedItem(item || null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedItem(null);
  };

  const handleSave = async (data: any) => {
    // TODO: Implement save functionality
    console.log('Saving:', data);
    closeModal();
  };

  const handleDelete = async (id: string, type: 'client' | 'product') => {
    if (!confirm(`¿Estás seguro de eliminar este ${type === 'client' ? 'cliente' : 'producto'}?`)) return;
    // TODO: Implement delete functionality
    console.log('Deleting:', id);
  };

  const filteredClients = clients.filter(client => {
    const matchesSearch = client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         client.phone.includes(searchTerm) ||
                         client.email?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === 'all' || client.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    totalClients: clients.length,
    activeClients: clients.filter(c => c.status === 'active').length,
    totalRevenue: clients.reduce((sum, c) => sum + c.totalPurchases, 0),
    totalProducts: products.length,
    lowStock: products.filter(p => p.stock < 10).length
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Users className="w-8 h-8 text-[var(--accent-primary)]" />
            CRM
          </h1>
          <p className="text-[var(--text-muted)] mt-1">
            Gestiona tus clientes, productos y ventas
          </p>
        </div>
        <button 
          onClick={() => openModal(activeTab === 'clients' ? 'client' : 'product')}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          {activeTab === 'clients' ? 'Nuevo Cliente' : 'Nuevo Producto'}
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div className="stat-value text-2xl">{stats.totalClients}</div>
          </div>
          <div className="stat-label">Total Clientes</div>
        </div>
        
        <div className="stat-card">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="stat-value text-2xl">{stats.activeClients}</div>
          </div>
          <div className="stat-label">Clientes Activos</div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-purple-400" />
            </div>
            <div className="stat-value text-2xl">${(stats.totalRevenue / 1000).toFixed(0)}k</div>
          </div>
          <div className="stat-label">Ventas Totales</div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
              <Package className="w-5 h-5 text-orange-400" />
            </div>
            <div className="stat-value text-2xl">{stats.totalProducts}</div>
          </div>
          <div className="stat-label">Productos</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[var(--border-primary)] pb-4">
        <button
          onClick={() => setActiveTab('clients')}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            activeTab === 'clients'
              ? 'bg-[var(--accent-primary)] text-white'
              : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'
          }`}
        >
          <span className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Clientes
          </span>
        </button>
        <button
          onClick={() => setActiveTab('products')}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            activeTab === 'products'
              ? 'bg-[var(--accent-primary)] text-white'
              : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'
          }`}
        >
          <span className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4" />
            Productos
          </span>
        </button>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder={`Buscar ${activeTab === 'clients' ? 'clientes' : 'productos'}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input pl-11"
          />
        </div>
        
        {activeTab === 'clients' && (
          <div className="relative">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="input appearance-none pr-10 min-w-[150px]"
            >
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
              <option value="lead">Leads</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
          </div>
        )}
      </div>

      {/* Content */}
      {activeTab === 'clients' ? (
        /* Clients Table */
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contacto</th>
                <th>Estado</th>
                <th>Compras</th>
                <th>Último Contacto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => (
                <tr key={client.id} className="group">
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="avatar">
                        {client.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-white">{client.name}</p>
                        <div className="flex gap-1 mt-1">
                          {client.tags.map((tag, i) => (
                            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="space-y-1">
                      <p className="flex items-center gap-2 text-sm">
                        <Phone className="w-3 h-3" />
                        {client.phone}
                      </p>
                      {client.email && (
                        <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                          <Mail className="w-3 h-3" />
                          {client.email}
                        </p>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${
                      client.status === 'active' ? 'badge-success' : 
                      client.status === 'lead' ? 'badge-warning' : 'badge-danger'
                    }`}>
                      {client.status === 'active' ? 'Activo' : 
                       client.status === 'lead' ? 'Lead' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <span className="font-medium text-white">
                      ${client.totalPurchases.toLocaleString()}
                    </span>
                  </td>
                  <td>
                    <span className="text-sm">
                      {client.lastContact ? new Date(client.lastContact).toLocaleDateString('es') : '-'}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => openModal('client', client)}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4 text-[var(--text-muted)]" />
                      </button>
                      <button 
                        onClick={() => handleDelete(client.id, 'client')}
                        className="p-2 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {filteredClients.length === 0 && (
            <div className="p-12 text-center">
              <Users className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3" />
              <p className="text-[var(--text-muted)]">No se encontraron clientes</p>
            </div>
          )}
        </div>
      ) : (
        /* Products Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProducts.map((product) => (
            <div key={product.id} className="card glass-hover group">
              <div className="flex items-start justify-between mb-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center">
                  <Package className="w-7 h-7 text-purple-400" />
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => openModal('product', product)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <Edit2 className="w-4 h-4 text-[var(--text-muted)]" />
                  </button>
                  <button 
                    onClick={() => handleDelete(product.id, 'product')}
                    className="p-2 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
              
              <h3 className="text-lg font-semibold text-white mb-1">{product.name}</h3>
              <p className="text-sm text-[var(--text-muted)] mb-4">{product.description}</p>
              
              <div className="flex items-center justify-between pt-4 border-t border-[var(--border-primary)]">
                <div>
                  <p className="text-2xl font-bold text-gradient">${product.price.toLocaleString()}</p>
                  <p className="text-xs text-[var(--text-muted)]">{product.category}</p>
                </div>
                <div className={`badge ${product.stock > 10 ? 'badge-success' : 'badge-warning'}`}>
                  Stock: {product.stock}
                </div>
              </div>
            </div>
          ))}
          
          {filteredProducts.length === 0 && (
            <div className="col-span-full p-12 text-center card">
              <Package className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3" />
              <p className="text-[var(--text-muted)]">No se encontraron productos</p>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">
                {selectedItem 
                  ? `Editar ${modalType === 'client' ? 'Cliente' : 'Producto'}`
                  : `Nuevo ${modalType === 'client' ? 'Cliente' : 'Producto'}`
                }
              </h2>
              <button 
                onClick={closeModal}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[var(--text-muted)]" />
              </button>
            </div>
            
            {modalType === 'client' ? (
              <ClientForm 
                client={selectedItem} 
                onSave={handleSave} 
                onCancel={closeModal}
              />
            ) : (
              <ProductForm 
                product={selectedItem} 
                onSave={handleSave} 
                onCancel={closeModal}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Client Form Component
function ClientForm({ client, onSave, onCancel }: { client?: Client; onSave: (data: any) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    name: client?.name || '',
    phone: client?.phone || '',
    email: client?.email || '',
    address: client?.address || '',
    notes: client?.notes || '',
    status: client?.status || 'lead',
    tags: client?.tags?.join(', ') || ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean)
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="input-label">Nombre *</label>
        <input
          type="text"
          required
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="input"
          placeholder="Nombre del cliente"
        />
      </div>
      
      <div>
        <label className="input-label">Teléfono *</label>
        <input
          type="tel"
          required
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          className="input"
          placeholder="+57 300 000 0000"
        />
      </div>
      
      <div>
        <label className="input-label">Email</label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          className="input"
          placeholder="email@ejemplo.com"
        />
      </div>
      
      <div>
        <label className="input-label">Dirección</label>
        <input
          type="text"
          value={formData.address}
          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          className="input"
          placeholder="Ciudad, País"
        />
      </div>
      
      <div>
        <label className="input-label">Estado</label>
        <select
          value={formData.status}
          onChange={(e) => setFormData({ ...formData, status: e.target.value })}
          className="input"
        >
          <option value="lead">Lead</option>
          <option value="active">Activo</option>
          <option value="inactive">Inactivo</option>
        </select>
      </div>
      
      <div>
        <label className="input-label">Etiquetas</label>
        <input
          type="text"
          value={formData.tags}
          onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
          className="input"
          placeholder="VIP, Frecuente, etc. (separadas por coma)"
        />
      </div>
      
      <div>
        <label className="input-label">Notas</label>
        <textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="input min-h-[100px]"
          placeholder="Notas adicionales sobre el cliente..."
        />
      </div>
      
      <div className="flex gap-3 pt-4">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">
          Cancelar
        </button>
        <button type="submit" className="btn-primary flex-1">
          {client ? 'Guardar Cambios' : 'Crear Cliente'}
        </button>
      </div>
    </form>
  );
}

// Product Form Component
function ProductForm({ product, onSave, onCancel }: { product?: Product; onSave: (data: any) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    name: product?.name || '',
    description: product?.description || '',
    price: product?.price || 0,
    stock: product?.stock || 0,
    category: product?.category || ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="input-label">Nombre *</label>
        <input
          type="text"
          required
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="input"
          placeholder="Nombre del producto"
        />
      </div>
      
      <div>
        <label className="input-label">Descripción</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="input min-h-[80px]"
          placeholder="Descripción del producto..."
        />
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="input-label">Precio *</label>
          <input
            type="number"
            required
            min="0"
            value={formData.price}
            onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
            className="input"
            placeholder="0"
          />
        </div>
        
        <div>
          <label className="input-label">Stock</label>
          <input
            type="number"
            min="0"
            value={formData.stock}
            onChange={(e) => setFormData({ ...formData, stock: Number(e.target.value) })}
            className="input"
            placeholder="0"
          />
        </div>
      </div>
      
      <div>
        <label className="input-label">Categoría</label>
        <input
          type="text"
          value={formData.category}
          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
          className="input"
          placeholder="Ej: Buzos, Camisetas, etc."
        />
      </div>
      
      <div className="flex gap-3 pt-4">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">
          Cancelar
        </button>
        <button type="submit" className="btn-primary flex-1">
          {product ? 'Guardar Cambios' : 'Crear Producto'}
        </button>
      </div>
    </form>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { Bot, Plus, Edit2, Trash2, Check, X, Zap, Settings, Sparkles } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function AsistentesPage() {
  const [assistants, setAssistants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);

  const [form, setForm] = useState({
    name: '', context: '', personality: '', businessInfo: '', instructions: '',
    model: 'gpt-4-turbo-preview', temperature: '0.7', maxTokens: '500'
  });

  useEffect(() => {
    fetchAssistants();
  }, []);

  const fetchAssistants = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/assistants`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setAssistants((await res.json()).assistants || []);
    } catch (error) { console.error('Error:', error); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    const token = localStorage.getItem('token');
    const method = editingItem ? 'PUT' : 'POST';
    const url = editingItem ? `${API_URL}/api/assistants/${editingItem.id}` : `${API_URL}/api/assistants`;

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          temperature: parseFloat(form.temperature),
          maxTokens: parseInt(form.maxTokens)
        })
      });
      if (res.ok) {
        fetchAssistants();
        setShowModal(false);
        resetForm();
      }
    } catch (error) { console.error('Error:', error); }
  };

  const activateAssistant = async (id: string) => {
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/assistants/${id}/activate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fetchAssistants();
    } catch (error) { console.error('Error:', error); }
  };

  const deleteAssistant = async (id: string) => {
    if (!confirm('¿Eliminar este asistente?')) return;
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_URL}/api/assistants/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fetchAssistants();
    } catch (error) { console.error('Error:', error); }
  };

  const resetForm = () => {
    setForm({ name: '', context: '', personality: '', businessInfo: '', instructions: '', model: 'gpt-4-turbo-preview', temperature: '0.7', maxTokens: '500' });
    setEditingItem(null);
  };

  const openEdit = (assistant: any) => {
    setEditingItem(assistant);
    setForm({
      name: assistant.name, context: assistant.context || '', personality: assistant.personality || '',
      businessInfo: assistant.businessInfo || '', instructions: assistant.instructions || '',
      model: assistant.model, temperature: assistant.temperature?.toString() || '0.7', maxTokens: assistant.maxTokens?.toString() || '500'
    });
    setShowModal(true);
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
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/elisa.png" alt="Elisa IA" className="w-14 h-14 rounded-xl" />
          <div>
            <h1 className="text-3xl font-bold text-white">Asistentes IA</h1>
            <p className="text-[var(--text-muted)]">Configura la personalidad de Elisa</p>
          </div>
        </div>
        <button onClick={() => { resetForm(); setShowModal(true); }} className="btn-primary">
          <Plus className="w-4 h-4" />Nuevo Asistente
        </button>
      </div>

      {/* Assistants Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {assistants.map((assistant) => (
          <div key={assistant.id} className={`card ${assistant.isActive ? 'border-[var(--accent-primary)]' : ''}`}>
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${assistant.isActive ? 'bg-[var(--accent-primary)]/20' : 'bg-[var(--bg-tertiary)]'}`}>
                  <img src="/elisa.png" alt="Elisa" className="w-8 h-8 rounded-lg" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">{assistant.name}</h3>
                  <p className="text-sm text-[var(--text-muted)]">{assistant.model}</p>
                </div>
              </div>
              {assistant.isActive && <span className="badge badge-success"><Zap className="w-3 h-3" />Activo</span>}
            </div>

            <p className="text-sm text-[var(--text-muted)] mb-4 line-clamp-2">
              {assistant.context || 'Sin contexto definido'}
            </p>

            <div className="flex items-center gap-2 mb-4 text-xs text-[var(--text-muted)]">
              <span className="px-2 py-1 bg-[var(--bg-tertiary)] rounded">Temp: {assistant.temperature}</span>
              <span className="px-2 py-1 bg-[var(--bg-tertiary)] rounded">Tokens: {assistant.maxTokens}</span>
            </div>

            <div className="flex gap-2">
              {!assistant.isActive && (
                <button onClick={() => activateAssistant(assistant.id)} className="btn-primary flex-1 text-sm py-2">
                  <Check className="w-4 h-4" />Activar
                </button>
              )}
              <button onClick={() => openEdit(assistant)} className="btn-secondary flex-1 text-sm py-2">
                <Edit2 className="w-4 h-4" />Editar
              </button>
              <button onClick={() => deleteAssistant(assistant.id)} className="btn-icon text-red-400">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}

        {assistants.length === 0 && (
          <div className="col-span-full card text-center py-12">
            <Bot className="w-16 h-16 mx-auto mb-4 text-[var(--text-muted)] opacity-50" />
            <h3 className="text-lg font-semibold text-white mb-2">No hay asistentes</h3>
            <p className="text-[var(--text-muted)] mb-4">Crea tu primer asistente para personalizar a Elisa</p>
            <button onClick={() => setShowModal(true)} className="btn-primary">
              <Plus className="w-4 h-4" />Crear Asistente
            </button>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <img src="/elisa.png" alt="Elisa" className="w-10 h-10 rounded-xl" />
                <h3 className="text-xl font-bold text-white">{editingItem ? 'Editar' : 'Nuevo'} Asistente</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="btn-icon"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
              <div>
                <label className="input-label">Nombre del Asistente *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})}
                  className="input" placeholder="Ej: Asistente de Ventas" />
              </div>

              <div>
                <label className="input-label">Contexto / Instrucciones Principales</label>
                <textarea value={form.context} onChange={(e) => setForm({...form, context: e.target.value})}
                  className="input min-h-[100px]" placeholder="Describe cómo debe comportarse el asistente..." />
              </div>

              <div>
                <label className="input-label">Personalidad</label>
                <textarea value={form.personality} onChange={(e) => setForm({...form, personality: e.target.value})}
                  className="input min-h-[80px]" placeholder="Amable, profesional, informal..." />
              </div>

              <div>
                <label className="input-label">Información del Negocio</label>
                <textarea value={form.businessInfo} onChange={(e) => setForm({...form, businessInfo: e.target.value})}
                  className="input min-h-[80px]" placeholder="Horarios, productos, servicios, precios..." />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="input-label">Modelo</label>
                  <select value={form.model} onChange={(e) => setForm({...form, model: e.target.value})} className="input">
                    <option value="gpt-4-turbo-preview">GPT-4 Turbo</option>
                    <option value="gpt-4">GPT-4</option>
                    <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Temperatura</label>
                  <input type="number" step="0.1" min="0" max="2" value={form.temperature}
                    onChange={(e) => setForm({...form, temperature: e.target.value})} className="input" />
                </div>
                <div>
                  <label className="input-label">Max Tokens</label>
                  <input type="number" min="50" max="4000" value={form.maxTokens}
                    onChange={(e) => setForm({...form, maxTokens: e.target.value})} className="input" />
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-[var(--border-primary)]">
              <button onClick={handleSave} className="btn-primary w-full">
                <Sparkles className="w-4 h-4" />{editingItem ? 'Actualizar' : 'Crear'} Asistente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-center py-4">
        <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
          <img src="/elisa.png" alt="Elisa" className="w-5 h-5 rounded" />
          Asistentes powered by Elisa IA
        </div>
      </div>
    </div>
  );
}

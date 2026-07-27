import React, { useState } from 'react';
import { api } from '@/api/client';
import { X, Save } from 'lucide-react';
import ModalShell from '@/components/ModalShell';

export default function WarehouseProductForm({ product, onClose, onSave }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    sku: '', name: '', description: '', quantity: 0, min_quantity: 0, max_quantity: 0,
    unit: 'piece', location: '', unit_price: '', warehouse_name: 'Depozit Central',
    ...product,
  });

  const set = (k, val) => setForm(f => ({ ...f, [k]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        ...form,
        quantity: Number(form.quantity) || 0,
        min_quantity: Number(form.min_quantity) || 0,
        max_quantity: Number(form.max_quantity) || 0,
        unit_price: Number(form.unit_price) || 0,
      };
      if (product?.id) await api.entities.WarehouseProduct.update(product.id, data);
      else await api.entities.WarehouseProduct.create(data);
      onSave();
    } catch (e) { console.error(e); alert('Eroare: ' + (e.message || '')); }
    finally { setSaving(false); }
  };

  const inputCls = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors";
  const labelCls = "block text-xs font-medium text-slate-600 mb-1";

  return (
    <ModalShell onClose={onClose} panelClassName="max-w-lg" labelledBy="warehouse-form-title">
      <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
          <h2 id="warehouse-form-title" className="font-semibold text-[#0A2B4E]">{product ? 'Editează produs' : 'Produs nou'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelCls}>SKU *</label><input required className={inputCls} value={form.sku} onChange={e => set('sku', e.target.value)} /></div>
            <div><label className={labelCls}>Unitate</label><select className={inputCls} value={form.unit} onChange={e => set('unit', e.target.value)}><option value="piece">Bucăți</option><option value="kg">Kg</option><option value="mc">m³</option><option value="pallet">Palet</option></select></div>
          </div>
          <div><label className={labelCls}>Denumire *</label><input required className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} /></div>
          <div><label className={labelCls}>Descriere</label><textarea rows={2} className={inputCls} value={form.description} onChange={e => set('description', e.target.value)} /></div>
          <div><label className={labelCls}>Locație în depozit</label><input className={inputCls} value={form.location} onChange={e => set('location', e.target.value)} placeholder="ex: A-12-03" /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className={labelCls}>Cantitate</label><input type="number" className={inputCls} value={form.quantity} onChange={e => set('quantity', e.target.value)} /></div>
            <div><label className={labelCls}>Stoc min.</label><input type="number" className={inputCls} value={form.min_quantity} onChange={e => set('min_quantity', e.target.value)} /></div>
            <div><label className={labelCls}>Stoc max.</label><input type="number" className={inputCls} value={form.max_quantity} onChange={e => set('max_quantity', e.target.value)} /></div>
          </div>
          <div><label className={labelCls}>Preț unitar (RON)</label><input type="number" step="0.01" className={inputCls} value={form.unit_price} onChange={e => set('unit_price', e.target.value)} /></div>
          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-50 transition-colors"><Save className="w-4 h-4" /> {saving ? 'Se salvează...' : 'Salvează'}</button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">Anulează</button>
          </div>
        </form>
    </ModalShell>
  );
}
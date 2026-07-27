import React, { useState } from 'react';
import { api } from '@/api/client';
import { X, Save } from 'lucide-react';
import ModalShell from '@/components/ModalShell';

export default function ClientForm({ client, onClose, onSave }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', cui: '', address: '', phone: '', email: '', contact_person: '', notes: '', is_active: true,
    ...client,
  });

  const set = (k, val) => setForm(f => ({ ...f, [k]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (client?.id) await api.entities.Client.update(client.id, form);
      else await api.entities.Client.create(form);
      onSave();
    } catch (e) {
      console.error(e);
      alert('Eroare la salvare: ' + (e.message || 'unknown'));
    } finally { setSaving(false); }
  };

  const inputCls = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors";
  const labelCls = "block text-xs font-medium text-slate-600 mb-1";

  return (
    <ModalShell onClose={onClose} panelClassName="max-w-lg" labelledBy="client-form-title">
      <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
          <h2 id="client-form-title" className="font-semibold text-[#0A2B4E]">{client ? 'Editează client' : 'Client nou'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div><label className={labelCls}>Denumire *</label><input required className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} /></div>
          <div><label className={labelCls}>CUI</label><input className={inputCls} value={form.cui} onChange={e => set('cui', e.target.value)} /></div>
          <div><label className={labelCls}>Adresă</label><input className={inputCls} value={form.address} onChange={e => set('address', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelCls}>Telefon</label><input className={inputCls} value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
            <div><label className={labelCls}>Email</label><input type="email" className={inputCls} value={form.email} onChange={e => set('email', e.target.value)} /></div>
          </div>
          <div><label className={labelCls}>Persoană de contact</label><input className={inputCls} value={form.contact_person} onChange={e => set('contact_person', e.target.value)} /></div>
          <div><label className={labelCls}>Note</label><textarea rows={3} className={inputCls} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-50 transition-colors">
              <Save className="w-4 h-4" /> {saving ? 'Se salvează...' : 'Salvează'}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">Anulează</button>
          </div>
        </form>
    </ModalShell>
  );
}
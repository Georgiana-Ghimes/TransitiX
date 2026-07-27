import React, { useState } from 'react';
import { api } from '@/api/client';
import { X, Save } from 'lucide-react';
import ModalShell from '@/components/ModalShell';

export default function DriverForm({ driver, onClose, onSave }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', hire_date: '', birth_date: '',
    license_number: '', license_category: '', license_expiry: '',
    medical_certificate_number: '', medical_certificate_expiry: '',
    tachograph_card_number: '', tachograph_card_expiry: '',
    status: 'disponibil', is_active: true,
    ...driver,
  });

  const set = (k, val) => setForm(f => ({ ...f, [k]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (driver?.id) await api.entities.Driver.update(driver.id, form);
      else await api.entities.Driver.create(form);
      onSave();
    } catch (e) {
      console.error(e);
      alert('Eroare la salvare: ' + (e.message || 'unknown'));
    } finally { setSaving(false); }
  };

  const inputCls = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors";
  const labelCls = "block text-xs font-medium text-slate-600 mb-1";

  return (
    <ModalShell onClose={onClose} panelClassName="max-w-2xl" labelledBy="driver-form-title">
      <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
          <h2 id="driver-form-title" className="font-semibold text-[#0A2B4E]">{driver ? 'Editează șofer' : 'Șofer nou'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={labelCls}>Nume complet *</label><input required className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} /></div>
            <div><label className={labelCls}>Status</label><select className={inputCls} value={form.status} onChange={e => set('status', e.target.value)}><option value="disponibil">Disponibil</option><option value="in_cursa">În cursă</option><option value="in_concediu">În concediu</option><option value="indisponibil">Indisponibil</option></select></div>
            <div><label className={labelCls}>Telefon *</label><input required className={inputCls} value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
            <div><label className={labelCls}>Email</label><input type="email" className={inputCls} value={form.email} onChange={e => set('email', e.target.value)} /></div>
            <div><label className={labelCls}>Data angajării</label><input type="date" className={inputCls} value={form.hire_date || ''} onChange={e => set('hire_date', e.target.value)} /></div>
            <div><label className={labelCls}>Data nașterii</label><input type="date" className={inputCls} value={form.birth_date || ''} onChange={e => set('birth_date', e.target.value)} /></div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[#0A2B4E] border-l-2 border-[#F5A623] pl-2">Permis de conducere</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div><label className={labelCls}>Număr permis</label><input className={inputCls} value={form.license_number} onChange={e => set('license_number', e.target.value)} /></div>
              <div><label className={labelCls}>Categorie</label><input className={inputCls} value={form.license_category} onChange={e => set('license_category', e.target.value)} placeholder="C, C+E, etc." /></div>
              <div><label className={labelCls}>Expirare permis</label><input type="date" className={inputCls} value={form.license_expiry || ''} onChange={e => set('license_expiry', e.target.value)} /></div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[#0A2B4E] border-l-2 border-[#27AE60] pl-2">Certificat medical</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className={labelCls}>Număr</label><input className={inputCls} value={form.medical_certificate_number} onChange={e => set('medical_certificate_number', e.target.value)} /></div>
              <div><label className={labelCls}>Expirare</label><input type="date" className={inputCls} value={form.medical_certificate_expiry || ''} onChange={e => set('medical_certificate_expiry', e.target.value)} /></div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[#0A2B4E] border-l-2 border-[#1D4E89] pl-2">Card tahograf</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className={labelCls}>Număr</label><input className={inputCls} value={form.tachograph_card_number} onChange={e => set('tachograph_card_number', e.target.value)} /></div>
              <div><label className={labelCls}>Expirare</label><input type="date" className={inputCls} value={form.tachograph_card_expiry || ''} onChange={e => set('tachograph_card_expiry', e.target.value)} /></div>
            </div>
          </div>

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
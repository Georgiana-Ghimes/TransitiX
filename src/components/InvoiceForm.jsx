import React, { useState } from 'react';
import { api } from '@/api/client';
import { X, Save } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { notifyError } from '@/lib/notify';

export default function InvoiceForm({ invoice, trips, onClose, onSave }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    series: 'TRX', number: '', trip_id: '', cmr_number: '', client_id: '', client_name: '', client_cui: '', client_address: '',
    issue_date: new Date().toISOString().split('T')[0], due_date: '', payment_date: '',
    description: '', subtotal: '', vat_rate: 19, vat_amount: '', total_amount: '',
    currency: 'RON', status: 'draft', efactura_status: 'not_sent', notes: '',
    ...invoice,
  });

  const set = (k, val) => setForm(f => ({ ...f, [k]: val }));

  const onTripChange = (tripId) => {
    const trip = trips.find(t => t.id === tripId);
    if (trip) {
      const subtotal = Math.max(trip.distance_km * 2.5 || 500, 500);
      const vatAmount = Math.round(subtotal * 0.19 * 100) / 100;
      setForm(f => ({
        ...f, trip_id: tripId, cmr_number: trip.cmr_number,
        client_name: trip.consignee_name, client_address: trip.consignee_address || '',
        description: `Servicii transport - CMR ${trip.cmr_number} - ${trip.goods_description || 'marfă'} - ${trip.distance_km || ''} km`,
        subtotal, vat_amount: vatAmount, total_amount: Math.round((subtotal + vatAmount) * 100) / 100,
      }));
    } else {
      set('trip_id', '');
    }
  };

  const recalcTotals = (subtotal, vatRate) => {
    const sub = Number(subtotal) || 0;
    const rate = Number(vatRate) || 0;
    const vat = Math.round(sub * rate / 100 * 100) / 100;
    setForm(f => ({ ...f, subtotal: sub, vat_rate: rate, vat_amount: vat, total_amount: Math.round((sub + vat) * 100) / 100 }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (!form.number) {
        const count = trips.length + Math.floor(Math.random() * 100) + 1;
        form.number = String(count).padStart(4, '0');
      }
      const data = {
        ...form,
        subtotal: Number(form.subtotal) || 0,
        vat_rate: Number(form.vat_rate) || 0,
        vat_amount: Number(form.vat_amount) || 0,
        total_amount: Number(form.total_amount) || 0,
      };
      if (invoice?.id) await api.entities.Invoice.update(invoice.id, data);
      else await api.entities.Invoice.create(data);
      onSave();
    } catch (err) {
      console.error(err);
      notifyError('Salvare eșuată', err);
    } finally { setSaving(false); }
  };

  const inputCls = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors";
  const labelCls = "block text-xs font-medium text-slate-600 mb-1";

  return (
    <ModalShell onClose={onClose} panelClassName="max-w-2xl" labelledBy="invoice-form-title">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
          <h2 id="invoice-form-title" className="font-semibold text-[#0A2B4E]">{invoice ? 'Editează factură' : 'Factură nouă'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className={labelCls}>Serie</label><input className={inputCls} value={form.series} onChange={e => set('series', e.target.value)} /></div>
            <div><label className={labelCls}>Număr</label><input className={inputCls} value={form.number} onChange={e => set('number', e.target.value)} placeholder="Auto" /></div>
            <div><label className={labelCls}>Status</label><select className={inputCls} value={form.status} onChange={e => set('status', e.target.value)}><option value="draft">Ciornă</option><option value="sent">Trimisă</option><option value="paid">Plătită</option><option value="overdue">Restantă</option><option value="cancelled">Anulată</option></select></div>
          </div>

          <div>
            <label className={labelCls}>Generează din cursă</label>
            <select className={inputCls} value={form.trip_id} onChange={e => onTripChange(e.target.value)}>
              <option value="">— Selectează cursă (opțional) —</option>
              {trips.map(t => <option key={t.id} value={t.id}>{t.cmr_number} · {t.shipper_name} → {t.consignee_name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={labelCls}>Client *</label><input required className={inputCls} value={form.client_name} onChange={e => set('client_name', e.target.value)} /></div>
            <div><label className={labelCls}>CUI client</label><input className={inputCls} value={form.client_cui} onChange={e => set('client_cui', e.target.value)} /></div>
          </div>
          <div><label className={labelCls}>Adresă client</label><input className={inputCls} value={form.client_address} onChange={e => set('client_address', e.target.value)} /></div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div><label className={labelCls}>Data emiterii *</label><input required type="date" className={inputCls} value={form.issue_date} onChange={e => set('issue_date', e.target.value)} /></div>
            <div><label className={labelCls}>Scadență</label><input type="date" className={inputCls} value={form.due_date || ''} onChange={e => set('due_date', e.target.value)} /></div>
            <div><label className={labelCls}>Monedă</label><select className={inputCls} value={form.currency} onChange={e => set('currency', e.target.value)}><option>RON</option><option>EUR</option></select></div>
            <div><label className={labelCls}>Cotă TVA (%)</label><input type="number" className={inputCls} value={form.vat_rate} onChange={e => recalcTotals(form.subtotal, e.target.value)} /></div>
          </div>

          <div><label className={labelCls}>Descriere</label><textarea rows={2} className={inputCls} value={form.description} onChange={e => set('description', e.target.value)} /></div>

          <div className="grid grid-cols-3 gap-4">
            <div><label className={labelCls}>Subtotal</label><input type="number" step="0.01" className={inputCls} value={form.subtotal} onChange={e => recalcTotals(e.target.value, form.vat_rate)} /></div>
            <div><label className={labelCls}>TVA</label><input type="number" step="0.01" className={inputCls} value={form.vat_amount} disabled /></div>
            <div><label className={labelCls}>Total</label><input type="number" step="0.01" className={inputCls} value={form.total_amount} disabled /></div>
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
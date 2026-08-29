import React from 'react';
import { api } from '@/api/client';
import { X, Save } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { FieldError, FormErrorBanner, fieldInputClass } from '@/components/FormFeedback';
import { normalizeInvoice, validateInvoice } from '@/lib/entityValidation';
import { useEntityForm } from '@/lib/useEntityForm';

export default function InvoiceForm({ invoice, trips, onClose, onSave }) {
  const { form, set, patch, errors, formError, saving, fieldId, handleSubmit } = useEntityForm({
    initial: {
      series: 'TRX', number: '', trip_id: '', cmr_number: '', client_id: '', client_name: '', client_cui: '', client_address: '',
      issue_date: new Date().toISOString().split('T')[0], due_date: '', payment_date: '',
      description: '', subtotal: '', vat_rate: 19, vat_amount: '', total_amount: '',
      currency: 'RON', status: 'draft', efactura_status: 'not_sent', notes: '',
      ...invoice,
    },
    validate: validateInvoice,
    normalize: (f) => ({
      ...normalizeInvoice(f),
      subtotal: Number(f.subtotal) || 0,
      vat_rate: Number(f.vat_rate) || 0,
      vat_amount: Number(f.vat_amount) || 0,
      total_amount: Number(f.total_amount) || 0,
      // Blank means "next in series", which only the server can allocate; on an edit the existing
      // number stays, because renumbering a issued invoice is not a form's decision.
      number: String(f.number || '').trim() || (invoice?.id ? invoice.number : null),
    }),
    idPrefix: 'invoice',
    save: async (data) => {
      if (invoice?.id) await api.entities.Invoice.update(invoice.id, data);
      else await api.entities.Invoice.create(data);
      onSave();
    },
  });

  const onTripChange = (tripId) => {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) {
      set('trip_id', '');
      return;
    }
    const subtotal = Math.max(trip.distance_km * 2.5 || 500, 500);
    const vatAmount = Math.round(subtotal * 0.19 * 100) / 100;
    patch({
      trip_id: tripId,
      cmr_number: trip.cmr_number,
      client_name: trip.consignee_name,
      client_address: trip.consignee_address || '',
      description: `Servicii transport - CMR ${trip.cmr_number} - ${trip.goods_description || 'marfă'} - ${trip.distance_km || ''} km`,
      subtotal,
      vat_amount: vatAmount,
      total_amount: Math.round((subtotal + vatAmount) * 100) / 100,
    });
  };

  const recalcTotals = (subtotal, vatRate) => {
    const sub = Number(subtotal) || 0;
    const rate = Number(vatRate) || 0;
    const vat = Math.round((sub * rate) / 100 * 100) / 100;
    patch({
      subtotal,
      vat_rate: vatRate,
      vat_amount: vat,
      total_amount: Math.round((sub + vat) * 100) / 100,
    });
  };

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors';
  const labelCls = 'block text-xs font-medium text-slate-600 mb-1';

  const field = (key, props) => (
    <input
      id={fieldId(key)}
      aria-invalid={Boolean(errors[key])}
      aria-describedby={errors[key] ? `${fieldId(key)}-error` : undefined}
      className={fieldInputClass(inputCls, errors[key])}
      value={form[key] ?? ''}
      onChange={(e) => set(key, e.target.value)}
      {...props}
    />
  );

  const labelled = (key, label, props) => (
    <div>
      <label className={labelCls} htmlFor={fieldId(key)}>{label}</label>
      {field(key, props)}
      <FieldError id={`${fieldId(key)}-error`} message={errors[key]} />
    </div>
  );

  return (
    <ModalShell onClose={onClose} panelClassName="max-w-2xl" labelledBy="invoice-form-title">
      <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
        <h2 id="invoice-form-title" className="font-semibold text-[#0A2B4E]">{invoice ? 'Editează factură' : 'Factură nouă'}</h2>
        <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
      </div>
      <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
        <FormErrorBanner message={formError} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {labelled('series', 'Serie')}
          {labelled('number', 'Număr', { placeholder: 'Următorul din serie, dacă e gol' })}
          <div>
            <label className={labelCls} htmlFor={fieldId('status')}>Status</label>
            <select id={fieldId('status')} className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="draft">Ciornă</option>
              <option value="sent">Trimisă</option>
              <option value="paid">Plătită</option>
              <option value="overdue">Restantă</option>
              <option value="cancelled">Anulată</option>
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor={fieldId('trip_id')}>Generează din cursă</label>
          <select id={fieldId('trip_id')} className={inputCls} value={form.trip_id} onChange={(e) => onTripChange(e.target.value)}>
            <option value="">— Selectează cursă (opțional) —</option>
            {trips.map((t) => <option key={t.id} value={t.id}>{t.cmr_number} · {t.shipper_name} → {t.consignee_name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {labelled('client_name', 'Client *', { required: true })}
          {labelled('client_cui', 'CUI client', { placeholder: 'RO12345678' })}
        </div>
        {labelled('client_address', 'Adresă client')}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {labelled('issue_date', 'Data emiterii *', { type: 'date', required: true })}
          {labelled('due_date', 'Scadență', { type: 'date' })}
          <div>
            <label className={labelCls} htmlFor={fieldId('currency')}>Monedă</label>
            <select id={fieldId('currency')} className={inputCls} value={form.currency} onChange={(e) => set('currency', e.target.value)}>
              <option>RON</option>
              <option>EUR</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor={fieldId('vat_rate')}>Cotă TVA (%)</label>
            <input
              id={fieldId('vat_rate')}
              type="number"
              aria-invalid={Boolean(errors.vat_rate)}
              className={fieldInputClass(inputCls, errors.vat_rate)}
              value={form.vat_rate}
              onChange={(e) => recalcTotals(form.subtotal, e.target.value)}
            />
            <FieldError id={`${fieldId('vat_rate')}-error`} message={errors.vat_rate} />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor={fieldId('description')}>Descriere</label>
          <textarea
            id={fieldId('description')}
            rows={2}
            aria-invalid={Boolean(errors.description)}
            className={fieldInputClass(inputCls, errors.description)}
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
          />
          <FieldError id={`${fieldId('description')}-error`} message={errors.description} />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelCls} htmlFor={fieldId('subtotal')}>Subtotal</label>
            <input
              id={fieldId('subtotal')}
              type="number"
              step="0.01"
              aria-invalid={Boolean(errors.subtotal)}
              className={fieldInputClass(inputCls, errors.subtotal)}
              value={form.subtotal}
              onChange={(e) => recalcTotals(e.target.value, form.vat_rate)}
            />
            <FieldError id={`${fieldId('subtotal')}-error`} message={errors.subtotal} />
          </div>
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

import React from 'react';
import { api } from '@/api/client';
import { X, Save } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { FieldError, FormErrorBanner, fieldInputClass } from '@/components/FormFeedback';
import { normalizeWarehouseProduct, validateWarehouseProduct } from '@/lib/entityValidation';
import { useEntityForm } from '@/lib/useEntityForm';

function optionalNumber(value) {
  return value === '' || value == null ? null : Number(value);
}

export default function WarehouseProductForm({ product, onClose, onSave }) {
  const { form, set, errors, formError, saving, fieldId, handleSubmit } = useEntityForm({
    initial: {
      sku: '', name: '', description: '', quantity: 0, min_quantity: 0, max_quantity: 0,
      unit: 'piece', location: '', unit_price: '', warehouse_name: 'Depozit Central',
      length_m: '', width_m: '', height_m: '', unit_weight_kg: '', stackable: true,
      adr_class: '', pallet_type: '', picking_zone: '',
      ...product,
    },
    validate: validateWarehouseProduct,
    normalize: (f) => ({
      ...normalizeWarehouseProduct(f),
      quantity: Number(f.quantity) || 0,
      min_quantity: Number(f.min_quantity) || 0,
      max_quantity: Number(f.max_quantity) || 0,
      unit_price: Number(f.unit_price) || 0,
      length_m: optionalNumber(f.length_m),
      width_m: optionalNumber(f.width_m),
      height_m: optionalNumber(f.height_m),
      unit_weight_kg: optionalNumber(f.unit_weight_kg),
      stackable: f.stackable !== false,
      pallet_type: f.pallet_type || null,
    }),
    idPrefix: 'product',
    save: async (data) => {
      if (product?.id) await api.entities.WarehouseProduct.update(product.id, data);
      else await api.entities.WarehouseProduct.create(data);
      onSave();
    },
  });

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
    <ModalShell onClose={onClose} panelClassName="max-w-lg" labelledBy="warehouse-form-title">
      <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
        <h2 id="warehouse-form-title" className="font-semibold text-[#0A2B4E]">{product ? 'Editează produs' : 'Produs nou'}</h2>
        <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
      </div>
      <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
        <FormErrorBanner message={formError} />
        <div className="grid grid-cols-2 gap-4">
          {labelled('sku', 'SKU *', { required: true, placeholder: 'PAL-EUR-120' })}
          <div>
            <label className={labelCls} htmlFor={fieldId('unit')}>Unitate</label>
            <select id={fieldId('unit')} className={inputCls} value={form.unit} onChange={(e) => set('unit', e.target.value)}>
              <option value="piece">Bucăți</option>
              <option value="kg">Kg</option>
              <option value="mc">m³</option>
              <option value="pallet">Palet</option>
            </select>
          </div>
        </div>
        {labelled('name', 'Denumire *', { required: true })}
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
        {labelled('location', 'Locație în depozit', { placeholder: 'ex: A-12-03' })}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {labelled('length_m', 'Lungime (m)', { type: 'number', step: '0.001', min: 0 })}
          {labelled('width_m', 'Lățime (m)', { type: 'number', step: '0.001', min: 0 })}
          {labelled('height_m', 'Înălțime (m)', { type: 'number', step: '0.001', min: 0 })}
          {labelled('unit_weight_kg', 'Greutate unitară (kg)', { type: 'number', step: '0.01', min: 0 })}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {labelled('picking_zone', 'Zonă picking', { placeholder: 'ex: A' })}
          <div>
            <label className={labelCls} htmlFor={fieldId('pallet_type')}>Tip palet</label>
            <select id={fieldId('pallet_type')} className={inputCls} value={form.pallet_type || ''} onChange={(e) => set('pallet_type', e.target.value)}>
              <option value="">—</option>
              <option value="eur">EUR</option>
              <option value="industrial">Industrial</option>
              <option value="half">Half</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          {labelled('adr_class', 'Clasă ADR', { placeholder: 'ex: 3' })}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.stackable !== false} onChange={(e) => set('stackable', e.target.checked)} />
          Se poate stivui
        </label>
        <div className="grid grid-cols-3 gap-4">
          {labelled('quantity', 'Cantitate', { type: 'number', min: 0 })}
          {labelled('min_quantity', 'Stoc min.', { type: 'number', min: 0 })}
          {labelled('max_quantity', 'Stoc max.', { type: 'number', min: 0 })}
        </div>
        {labelled('unit_price', 'Preț unitar (RON)', { type: 'number', step: '0.01', min: 0 })}
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

import React from 'react';
import { api } from '@/api/client';
import { X, Save } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { FieldError, FormErrorBanner, fieldInputClass } from '@/components/FormFeedback';
import { normalizeDriver, validateDriver } from '@/lib/entityValidation';
import { useEntityForm } from '@/lib/useEntityForm';

export default function DriverForm({ driver, onClose, onSave }) {
  const { form, set, errors, formError, saving, fieldId, handleSubmit } = useEntityForm({
    initial: {
      name: '', email: '', phone: '', hire_date: '', birth_date: '',
      license_number: '', license_category: '', license_expiry: '',
      medical_certificate_number: '', medical_certificate_expiry: '',
      tachograph_card_number: '', tachograph_card_expiry: '',
      shift_start: '', shift_end: '',
      status: 'disponibil', is_active: true,
      ...driver,
    },
    validate: validateDriver,
    normalize: normalizeDriver,
    idPrefix: 'driver',
    save: async (data) => {
      if (driver?.id) await api.entities.Driver.update(driver.id, data);
      else await api.entities.Driver.create(data);
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

  const labelled = (key, label, props, hint) => (
    <div>
      <label className={labelCls} htmlFor={fieldId(key)}>{label}</label>
      {field(key, props)}
      <FieldError id={`${fieldId(key)}-error`} message={errors[key]} />
      {hint && !errors[key] && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );

  return (
    <ModalShell onClose={onClose} panelClassName="max-w-2xl" labelledBy="driver-form-title">
      <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
        <h2 id="driver-form-title" className="font-semibold text-[#0A2B4E]">{driver ? 'Editează șofer' : 'Șofer nou'}</h2>
        <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
      </div>
      <form onSubmit={handleSubmit} className="p-6 space-y-5" noValidate>
        <FormErrorBanner message={formError} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {labelled('name', 'Nume complet *', { required: true })}
          <div>
            <label className={labelCls} htmlFor={fieldId('status')}>Status</label>
            <select id={fieldId('status')} className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="disponibil">Disponibil</option>
              <option value="in_cursa">În cursă</option>
              <option value="in_concediu">În concediu</option>
              <option value="indisponibil">Indisponibil</option>
            </select>
          </div>
          {labelled('phone', 'Telefon *', { required: true, inputMode: 'tel', placeholder: '0722 123 456' })}
          {labelled('email', 'Email', { type: 'email' })}
          {labelled('hire_date', 'Data angajării', { type: 'date' })}
          {labelled('birth_date', 'Data nașterii', { type: 'date' })}
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[#0A2B4E] border-l-2 border-[#F5A623] pl-2">Tură</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {labelled('shift_start', 'Început tură', { type: 'time' })}
            {labelled('shift_end', 'Sfârșit tură', { type: 'time' })}
          </div>
          <p className="text-[11px] text-slate-400">Optimizatorul nu planifică în afara intervalului.</p>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[#0A2B4E] border-l-2 border-[#F5A623] pl-2">Permis de conducere</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {labelled('license_number', 'Număr permis')}
            {labelled('license_category', 'Categorie', { placeholder: 'C, C+E, etc.' })}
            {labelled('license_expiry', 'Expirare permis', { type: 'date' })}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[#0A2B4E] border-l-2 border-[#27AE60] pl-2">Certificat medical</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {labelled('medical_certificate_number', 'Număr')}
            {labelled('medical_certificate_expiry', 'Expirare', { type: 'date' })}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[#0A2B4E] border-l-2 border-[#1D4E89] pl-2">Card tahograf</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {labelled('tachograph_card_number', 'Număr')}
            {labelled('tachograph_card_expiry', 'Expirare', { type: 'date' })}
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

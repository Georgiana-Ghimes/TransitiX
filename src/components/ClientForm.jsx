import React from 'react';
import { api } from '@/api/client';
import { X, Save } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { FieldError, FormErrorBanner, fieldInputClass } from '@/components/FormFeedback';
import { normalizeClient, validateClient } from '@/lib/entityValidation';
import { useEntityForm } from '@/lib/useEntityForm';

export default function ClientForm({ client, onClose, onSave }) {
  const { form, set, errors, formError, saving, fieldId, handleSubmit } = useEntityForm({
    initial: {
      name: '', cui: '', address: '', phone: '', email: '', contact_person: '', notes: '', is_active: true,
      ...client,
    },
    validate: validateClient,
    normalize: normalizeClient,
    idPrefix: 'client',
    save: async (data) => {
      if (client?.id) await api.entities.Client.update(client.id, data);
      else await api.entities.Client.create(data);
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

  return (
    <ModalShell onClose={onClose} panelClassName="max-w-lg" labelledBy="client-form-title">
      <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
        <h2 id="client-form-title" className="font-semibold text-[#0A2B4E]">{client ? 'Editează client' : 'Client nou'}</h2>
        <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
      </div>
      <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
        <FormErrorBanner message={formError} />
        <div>
          <label className={labelCls} htmlFor={fieldId('name')}>Denumire *</label>
          {field('name', { required: true })}
          <FieldError id={`${fieldId('name')}-error`} message={errors.name} />
        </div>
        <div>
          <label className={labelCls} htmlFor={fieldId('cui')}>CUI</label>
          {field('cui', { placeholder: 'RO12345678' })}
          <FieldError id={`${fieldId('cui')}-error`} message={errors.cui} />
        </div>
        <div>
          <label className={labelCls} htmlFor={fieldId('address')}>Adresă</label>
          {field('address')}
          <FieldError id={`${fieldId('address')}-error`} message={errors.address} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor={fieldId('phone')}>Telefon</label>
            {field('phone', { inputMode: 'tel', placeholder: '0722 123 456' })}
            <FieldError id={`${fieldId('phone')}-error`} message={errors.phone} />
          </div>
          <div>
            <label className={labelCls} htmlFor={fieldId('email')}>Email</label>
            {field('email', { type: 'email' })}
            <FieldError id={`${fieldId('email')}-error`} message={errors.email} />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor={fieldId('contact_person')}>Persoană de contact</label>
          {field('contact_person')}
          <FieldError id={`${fieldId('contact_person')}-error`} message={errors.contact_person} />
        </div>
        <div>
          <label className={labelCls} htmlFor={fieldId('notes')}>Note</label>
          <textarea
            id={fieldId('notes')}
            rows={3}
            aria-invalid={Boolean(errors.notes)}
            className={fieldInputClass(inputCls, errors.notes)}
            value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
          />
          <FieldError id={`${fieldId('notes')}-error`} message={errors.notes} />
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

import React from 'react';
import ModalShell from '@/components/ModalShell';
import { AVIZ_FORM_FIELDS } from '@/lib/avizAnnex';
import { Loader2, Pencil, X } from 'lucide-react';
import AvizFilePreview from './AvizFilePreview';
import { inputCls, labelCls, lowField } from './avizeUi';

export default function AvizEditModal({
  editRow, form, setForm, trips, obsCodes, saving, onClose, onSave, onAppendObs,
}) {
  return (
    <ModalShell onClose={onClose} panelClassName="max-w-5xl" labelledBy="aviz-edit-title">
      <div className="p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 id="aviz-edit-title" className="text-lg font-semibold text-[#0A2B4E]">Editează aviz</h2>
          <button type="button" onClick={onClose} aria-label="Închide"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 min-h-[220px]">
            <AvizFilePreview fileUrl={editRow.file_url} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {AVIZ_FORM_FIELDS.map((f) => (
              <div key={f.key} className={f.key === 'ruta_transport' || f.key === 'observatii' ? 'sm:col-span-2' : ''}>
                <label className={labelCls}>{f.label}{lowField(editRow, f.key) ? ' · verifică (parser nesigur)' : ''}</label>
                <input
                  className={`${inputCls} ${lowField(editRow, f.key) ? 'border-amber-300' : ''}`}
                  type={f.type || 'text'}
                  step={f.step}
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className={labelCls}>Rută birou (nu merge în Excel)</label>
              <input className={inputCls} value={form.ruta_display ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, ruta_display: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Cursă (opțional)</label>
              <select className={inputCls} value={form.trip_id || ''} onChange={(e) => setForm((prev) => ({ ...prev, trip_id: e.target.value }))}>
                <option value="">Fără cursă</option>
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>{t.cmr_number} · {t.vehicle_plate || '—'} · {t.loading_date || ''}</option>
                ))}
              </select>
              {trips.length === 0 && (
                <p className="text-[11px] text-slate-500 mt-1">Nicio cursă pe auto + zi. Poți salva fără cursă.</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-slate-500 mb-1">Coduri observații (textul rămâne editabil)</p>
              <div className="flex flex-wrap gap-1">
                {obsCodes.map((c) => (
                  <button key={c.id} type="button" className="text-xs px-2 py-1 rounded-full border border-slate-200 hover:bg-slate-50" onClick={() => onAppendObs(c.code)}>
                    {c.code}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" className="px-4 py-2 text-sm border rounded-lg" onClick={onClose}>Anulează</button>
          <button
            type="button"
            disabled={saving}
            onClick={onSave}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
            Salvează
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

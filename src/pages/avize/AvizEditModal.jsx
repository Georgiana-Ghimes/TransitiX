import React from 'react';
import ModalShell from '@/components/ModalShell';
import { AVIZ_FORM_FIELDS } from '@/lib/avizAnnex';
import { Loader2, Pencil, X } from 'lucide-react';
import AvizFilePreview from './AvizFilePreview';
import AvizZoneTaxPanel from './AvizZoneTaxPanel';
import { inputCls, labelCls, lowField } from './avizeUi';

export default function AvizEditModal({
  editRow, form, setForm, trips, obsCodes, saving, onClose, onSave, onAppendObs,
}) {
  return (
    <ModalShell
      onClose={onClose}
      panelClassName="max-w-6xl w-full h-[min(90vh,920px)] overflow-hidden flex flex-col"
      labelledBy="aviz-edit-title"
    >
      <div className="flex flex-col min-h-0 flex-1">
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <h2 id="aviz-edit-title" className="text-lg font-semibold text-[#0A2B4E]">Editează aviz</h2>
          <button type="button" onClick={onClose} aria-label="Închide"><X className="w-5 h-5 text-slate-500" /></button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4 px-5 pb-2">
          <div className="min-h-[38vh] sm:min-h-[42vh] lg:min-h-0 flex flex-col border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
            <div className="shrink-0 px-3 py-1.5 border-b border-slate-200 bg-slate-100 text-[11px] font-medium text-slate-600 uppercase tracking-wide truncate">
              Document
              {editRow?.original_filename ? ` · ${editRow.original_filename}` : ''}
            </div>
            <div className="relative flex-1 min-h-0">
              <AvizFilePreview fileUrl={editRow.file_url} fill />
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">
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
                  {f.key === 'gross_weight_kg' && (
                    <label className="mt-1.5 flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5 rounded border-slate-300"
                        checked={form.include_gross_in_annex !== false}
                        onChange={(e) => setForm((prev) => ({
                          ...prev,
                          include_gross_in_annex: e.target.checked,
                        }))}
                      />
                      <span>
                        Include în Anexa (tone)
                        <span className="block text-slate-400 font-normal">
                          Debifat: coloana „Cantitate marfă (tone)” rămâne goală. Taxa de zonă folosește oricum bruta.
                        </span>
                      </span>
                    </label>
                  )}
                </div>
              ))}
              <AvizZoneTaxPanel editRow={editRow} form={form} setForm={setForm} />
              <div className="sm:col-span-2">
                <label className={labelCls}>Rută birou (nu merge în Excel)</label>
                <input className={inputCls} value={form.ruta_display ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, ruta_display: e.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Cursă (opțional)</label>
                <select className={inputCls} value={form.trip_id || ''} onChange={(e) => setForm((prev) => ({ ...prev, trip_id: e.target.value }))}>
                  <option value="">Fără cursă</option>
                  {trips.map((t) => (
                    <option key={t.id} value={t.id}>{t.cmr_number} · {t.vehicle_plate || 'fără auto'} · {t.loading_date || ''}</option>
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
                    <button key={c.id} type="button" className="text-xs px-2 py-1 rounded-full border border-slate-200 hover:bg-slate-50" onClick={() => onAppendObs(c.code)} title={c.label || c.code}>
                      {c.code}{c.label ? ` · ${c.label}` : ''}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 flex justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-white">
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

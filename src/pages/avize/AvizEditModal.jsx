import React, { useEffect, useState } from 'react';
import ModalShell from '@/components/ModalShell';
import RoDateField from '@/components/RoDateField';
import { api } from '@/api/client';
import { AVIZ_FORM_FIELDS } from '@/lib/avizAnnex';
import { previewKind } from '@/lib/avizOps';
import { rotateImageFile } from '@/lib/imagePreprocess';
import { notifyError, notifySuccess } from '@/lib/notify';
import { appendObservationCode } from '@/lib/observationCodes';
import { fetchUploadBlob } from '@/lib/uploadUrl';
import { Loader2, Pencil, RotateCw, X } from 'lucide-react';
import AvizFilePreview from './AvizFilePreview';
import AvizZoneTaxPanel from './AvizZoneTaxPanel';
import {
  avizEditFindings, emptyForm, findingsForField, inputCls, isLearnedRoute, labelCls, lowField,
} from './avizeUi';

/**
 * Editează owns its draft. Parent list poll / zone-tax / findings must not wipe typed values
 * by re-seeding from the saved row on every re-render.
 *
 * `formRevision` bumps only when the parent deliberately reloads the draft (Re-extrage).
 */
export default function AvizEditModal({
  editRow, formRevision = 0, obsCodes, saving, onClose, onSave, onFileReplaced,
}) {
  const [form, setForm] = useState(() => emptyForm(editRow));
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    setForm(emptyForm(editRow));
  }, [editRow?.id, formRevision]);

  const reviewFindings = avizEditFindings(editRow, { form });
  const canRotateImage = previewKind(editRow?.file_url) === 'image' && typeof onFileReplaced === 'function';

  const rotatePreview = async (degrees) => {
    if (!canRotateImage || !editRow?.id || rotating) return;
    setRotating(true);
    try {
      const blob = await fetchUploadBlob(editRow.file_url);
      if (!blob) throw new Error('Nu am putut citi fișierul.');
      const source = new File(
        [blob],
        editRow.original_filename || 'aviz.jpg',
        { type: blob.type || 'image/jpeg' },
      );
      const rotated = await rotateImageFile(source, degrees);
      const uploaded = await api.integrations.Core.UploadFile({ file: rotated });
      const saved = await api.entities.AvizDocument.update(editRow.id, {
        file_url: uploaded.file_url,
        original_filename: rotated.name || editRow.original_filename,
      });
      onFileReplaced(saved || { ...editRow, file_url: uploaded.file_url });
      notifySuccess('Imagine rotită', 'Previzualizarea e actualizată. Salvează câmpurile dacă ai modificări.');
    } catch (e) {
      notifyError('Rotirea imaginii a eșuat', e);
    } finally {
      setRotating(false);
    }
  };

  return (
    <ModalShell
      onClose={onClose}
      panelClassName="max-w-6xl w-full h-[min(90vh,100dvh-1.5rem,920px)] max-h-[min(90vh,100dvh-1.5rem)] overflow-hidden flex flex-col"
      labelledBy="aviz-edit-title"
    >
      <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <h2 id="aviz-edit-title" className="text-lg font-semibold text-[#0A2B4E]">Editează aviz</h2>
          <button type="button" onClick={onClose} aria-label="Închide"><X className="w-5 h-5 text-slate-500" /></button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4 px-5 pb-2 overflow-hidden">
          {/* Cap preview on phone so landscape photos cannot bury Salvează (#94). */}
          <div className="min-h-[160px] h-[min(28vh,240px)] max-h-[min(28vh,240px)] sm:h-[min(34vh,300px)] sm:max-h-[min(34vh,300px)] lg:h-auto lg:max-h-none lg:min-h-0 flex flex-col border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-slate-200 bg-slate-100 text-[11px] font-medium text-slate-600 uppercase tracking-wide">
              <span className="truncate min-w-0 flex-1">
                Document
                {editRow?.original_filename ? ` · ${editRow.original_filename}` : ''}
              </span>
              {canRotateImage ? (
                <span className="flex items-center gap-1 shrink-0 normal-case tracking-normal font-normal">
                  <button
                    type="button"
                    disabled={rotating || saving}
                    onClick={() => rotatePreview(90)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    title="Rotește 90° în sens orar"
                  >
                    {rotating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                    90°
                  </button>
                  <button
                    type="button"
                    disabled={rotating || saving}
                    onClick={() => rotatePreview(180)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    title="Întoarce cu capul în sus (180°)"
                  >
                    180°
                  </button>
                </span>
              ) : null}
            </div>
            <div className="relative flex-1 min-h-0">
              <AvizFilePreview fileUrl={editRow.file_url} fill />
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {AVIZ_FORM_FIELDS.map((f) => {
                const fieldFindings = findingsForField(reviewFindings, f.key);
                const needsAttention = lowField(editRow, f.key) || fieldFindings.length > 0;
                return (
                  <div key={f.key} className={f.key === 'ruta_transport' || f.key === 'observatii' ? 'sm:col-span-2' : ''}>
                    <label className={labelCls}>{f.label}</label>
                    {f.type === 'date' ? (
                      <RoDateField
                        className={`${inputCls} ${needsAttention ? 'border-amber-300' : ''}`}
                        value={form[f.key] ?? ''}
                        onChange={(iso) => setForm((prev) => ({ ...prev, [f.key]: iso }))}
                        aria-label={f.label}
                      />
                    ) : (
                      <input
                        className={`${inputCls} ${needsAttention ? 'border-amber-300' : ''}`}
                        type="text"
                        inputMode={f.inputMode || undefined}
                        autoComplete="off"
                        value={form[f.key] ?? ''}
                        onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      />
                    )}
                    {f.key === 'ruta_transport' && isLearnedRoute(editRow) ? (
                      <p className="mt-1 text-[11px] text-slate-500">Completat din regulă învățată</p>
                    ) : null}
                    {fieldFindings.map((issue) => (
                      <p
                        key={`${issue.rule}-${issue.field}`}
                        className="mt-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1"
                      >
                        <span className="font-semibold">{issue.title}</span>
                        {issue.message ? ` — ${issue.message}` : ''}
                      </p>
                    ))}
                  </div>
                );
              })}
              {reviewFindings.length > 0 && (
                <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
                  <p className="font-medium">Verificare necesară</p>
                  {reviewFindings.map((issue, idx) => (
                    <p key={`${issue.rule}-${issue.field || 'x'}-${idx}`}>
                      <span className="font-semibold">{issue.title}</span>
                      {issue.message ? ` — ${issue.message}` : ''}
                    </p>
                  ))}
                </div>
              )}
              <AvizZoneTaxPanel editRow={editRow} form={form} setForm={setForm} />
              <div className="sm:col-span-2">
                <p className="text-xs text-slate-500 mb-1">Coduri observații (textul rămâne editabil)</p>
                <div className="flex flex-wrap gap-1">
                  {obsCodes.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="text-xs px-2 py-1 rounded-full border border-slate-200 hover:bg-slate-50"
                      onClick={() => setForm((prev) => ({
                        ...prev,
                        observatii: appendObservationCode(prev.observatii, c.code),
                      }))}
                      title={c.label || c.code}
                    >
                      {c.code}{c.label ? ` · ${c.label}` : ''}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 flex justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-white pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button type="button" className="px-4 py-2.5 text-sm border rounded-lg min-h-[44px]" onClick={onClose}>Anulează</button>
          <button
            type="button"
            disabled={saving || rotating}
            onClick={() => onSave(form)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg disabled:opacity-60 min-h-[44px]"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
            Salvează
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

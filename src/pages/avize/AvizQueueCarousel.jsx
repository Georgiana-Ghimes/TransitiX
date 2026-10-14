import React, { useEffect, useMemo, useRef, useState } from 'react';
import RoDateField from '@/components/RoDateField';
import { AlertCircle, Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import AvizFilePreview from './AvizFilePreview';
import {
  consecutiveSameTpoPeers,
  emptyForm,
  inputCls,
  labelCls,
  missingRequiredCarouselFields,
  normalizeTpoKey,
  previewFileUrlsForPeers,
} from './avizeUi';

/** Essential fields for the force/export carousel (subset of AVIZ_FORM_FIELDS). */
export const CAROUSEL_EDIT_FIELDS = [
  { key: 'numar_tpo', label: 'Număr TPO', required: true },
  { key: 'data_efectuare_cursa', label: 'Data efectuare cursă', type: 'date', required: true },
  { key: 'numar_auto', label: 'Număr auto', required: true },
  { key: 'ruta_transport', label: 'Rută transport', wide: true, required: true },
  { key: 'km_parcursi', label: 'Km parcurși', inputMode: 'decimal' },
  { key: 'taxe_suplimentare', label: 'Taxe suplimentare', inputMode: 'decimal' },
  { key: 'observatii', label: 'Observații', wide: true },
];

export { missingRequiredCarouselFields };

function labelForKey(key) {
  return CAROUSEL_EDIT_FIELDS.find((f) => f.key === key)?.label || key;
}

/**
 * Prev/next over a queue of avize: preview left, essential fields right.
 * Required/missing fields are highlighted; after a successful save we advance to the next.
 * Save stays in a sticky footer so it never scrolls out of view.
 */
export default function AvizQueueCarousel({
  queue = [],
  initialId = null,
  saving = false,
  onSave,
  onCompletenessChange,
  /** Full selection (upload order) for adjacent same-TPO preview when merge is on. */
  peerRows = null,
  mergeTpoPreview = false,
}) {
  const ordered = useMemo(() => {
    const list = Array.isArray(queue) ? [...queue] : [];
    list.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    return list;
  }, [queue]);

  const peerSource = useMemo(() => {
    if (Array.isArray(peerRows) && peerRows.length) return peerRows;
    return ordered;
  }, [peerRows, ordered]);

  const orderedIds = useMemo(() => ordered.map((r) => r.id).join('|'), [ordered]);

  const startIndex = useMemo(() => {
    if (!ordered.length) return 0;
    const at = ordered.findIndex((r) => r.id === initialId);
    return at >= 0 ? at : 0;
  }, [ordered, initialId]);

  const [index, setIndex] = useState(startIndex);
  const current = ordered[index] || null;
  const [form, setForm] = useState(() => emptyForm(current));
  // Reset position only when the queue id-set changes (new modal), not after field saves.
  const queueIdsRef = useRef(orderedIds);

  useEffect(() => {
    if (queueIdsRef.current !== orderedIds) {
      queueIdsRef.current = orderedIds;
      setIndex(startIndex);
    }
  }, [orderedIds, startIndex]);

  useEffect(() => {
    setIndex((prev) => {
      if (!ordered.length) return 0;
      if (ordered[prev]) return prev;
      return Math.min(Math.max(prev, 0), ordered.length - 1);
    });
  }, [ordered.length, ordered]);

  useEffect(() => {
    setForm(emptyForm(current));
  }, [current?.id]);

  const missing = useMemo(() => missingRequiredCarouselFields(form), [form]);
  const missingSet = useMemo(() => new Set(missing), [missing]);

  const completeness = useMemo(() => ordered.map((row) => {
    const snap = row.id === current?.id ? form : row;
    return {
      id: row.id,
      missing: missingRequiredCarouselFields(snap),
      confirmed: row.status === 'confirmed',
    };
  }), [ordered, current?.id, form]);

  const allRequiredComplete = completeness.length > 0
    && completeness.every((item) => item.missing.length === 0);
  const allConfirmed = completeness.length > 0
    && completeness.every((item) => item.confirmed);

  const gluedPeers = useMemo(() => {
    if (!mergeTpoPreview || !current?.id) return current ? [current] : [];
    return consecutiveSameTpoPeers(peerSource, current.id);
  }, [mergeTpoPreview, peerSource, current]);

  const gluedUrls = useMemo(
    () => previewFileUrlsForPeers(gluedPeers),
    [gluedPeers],
  );

  const gluedLabel = useMemo(() => {
    if (!mergeTpoPreview || gluedPeers.length < 2) return null;
    const tpo = normalizeTpoKey(current?.numar_tpo) || 'TPO';
    return `${tpo} · ${gluedPeers.length} curse adiacente · ${gluedUrls.length} fișier(e) lipite în preview`;
  }, [mergeTpoPreview, gluedPeers, gluedUrls.length, current?.numar_tpo]);

  useEffect(() => {
    onCompletenessChange?.({
      allRequiredComplete,
      allConfirmed,
      items: completeness,
    });
  }, [allRequiredComplete, allConfirmed, completeness, onCompletenessChange]);

  if (!ordered.length) {
    return (
      <p className="text-sm text-slate-500 py-4 text-center">
        Nu sunt documente de verificat în coadă.
      </p>
    );
  }

  const go = (delta) => {
    setIndex((i) => Math.min(ordered.length - 1, Math.max(0, i + delta)));
  };

  const handleSave = async () => {
    if (!onSave || !current || saving) return;
    await onSave(current, form);
    if (index < ordered.length - 1) {
      setIndex((i) => i + 1);
    }
  };

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white flex flex-col min-h-0 h-full max-h-full">
      <div className="shrink-0 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-1 text-sm text-[#1D4E89] disabled:opacity-40"
            disabled={index <= 0 || saving}
            onClick={() => go(-1)}
          >
            <ChevronLeft className="w-4 h-4" /> Anterior
          </button>
          <p className="text-sm font-medium text-[#0A2B4E] text-center min-w-0 truncate px-1">
            <span className="tabular-nums">{index + 1} / {ordered.length}</span>
            {current?.original_filename ? (
              <span className="ml-2 font-normal text-slate-500">
                {current.original_filename}
              </span>
            ) : null}
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-1 text-sm text-[#1D4E89] disabled:opacity-40"
            disabled={index >= ordered.length - 1 || saving}
            onClick={() => go(1)}
          >
            Următorul <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {ordered.length > 1 ? (
          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            {completeness.map((item, i) => {
              const done = item.missing.length === 0;
              const active = i === index;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={done
                    ? `Aviz ${i + 1}: câmpuri obligatorii complete`
                    : `Aviz ${i + 1}: lipsă ${item.missing.map(labelForKey).join(', ')}`}
                  disabled={saving}
                  onClick={() => setIndex(i)}
                  className={[
                    'inline-flex items-center gap-1 min-w-[2rem] justify-center px-2 py-1 rounded-full text-xs font-medium border transition-colors',
                    active ? 'ring-2 ring-offset-1 ring-[#1D4E89]' : '',
                    done
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-amber-50 text-amber-900 border-amber-200',
                  ].join(' ')}
                >
                  {done ? <Check className="w-3 h-3" /> : null}
                  {i + 1}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/*
        Preview is height-capped on narrow viewports so landscape photos cannot push
        „Salvează” / modal footer below the fold (#94). Form fields scroll; save stays sticky.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-2 min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 h-[min(28vh,220px)] max-h-[min(28vh,220px)] lg:h-auto lg:max-h-none border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50 flex flex-col overflow-hidden">
          {gluedLabel ? (
            <p className="shrink-0 px-3 py-1.5 text-[11px] font-medium text-[#0A2B4E] bg-sky-50 border-b border-sky-100">
              {gluedLabel}
            </p>
          ) : null}
          <div className="relative flex-1 min-h-0 overflow-hidden">
            {gluedUrls.length > 0 ? (
              <AvizFilePreview
                fileUrl={gluedUrls[0]}
                fileUrls={gluedUrls.length > 1 ? gluedUrls : undefined}
                fill
              />
            ) : (
              <p className="p-4 text-sm text-slate-500">Fără fișier pe acest rând.</p>
            )}
          </div>
        </div>

        <div className="min-h-0 flex flex-col overflow-hidden bg-white">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-2 space-y-2.5">
            {missing.length > 0 ? (
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                <div className="min-w-0">
                  <p className="font-semibold">Câmpuri obligatorii lipsă</p>
                  <p className="mt-0.5 leading-snug">
                    {missing.map(labelForKey).join(' · ')}
                  </p>
                  <p className="mt-1 text-amber-800/80">
                    Poți derula liber și salva oricum; evidențierea dispare pe măsură ce completezi.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                <Check className="w-4 h-4 shrink-0" />
                Câmpurile obligatorii sunt complete pe acest aviz.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
              {CAROUSEL_EDIT_FIELDS.map((f) => {
                const needs = missingSet.has(f.key);
                return (
                  <div key={f.key} className={f.wide ? 'sm:col-span-2' : ''}>
                    <label className={`${labelCls} ${needs ? 'text-amber-800' : ''}`}>
                      {f.label}
                      {f.required ? <span className="text-amber-700"> *</span> : null}
                    </label>
                    {f.type === 'date' ? (
                      <RoDateField
                        className={`${inputCls} ${needs ? 'border-amber-400 bg-amber-50/60 focus:border-amber-500' : ''}`}
                        value={form[f.key] ?? ''}
                        onChange={(iso) => setForm((prev) => ({ ...prev, [f.key]: iso }))}
                        aria-label={f.label}
                        aria-invalid={needs || undefined}
                      />
                    ) : (
                      <input
                        className={`${inputCls} ${needs ? 'border-amber-400 bg-amber-50/60 focus:border-amber-500' : ''}`}
                        type="text"
                        inputMode={f.inputMode || undefined}
                        autoComplete="off"
                        value={form[f.key] ?? ''}
                        onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        aria-invalid={needs || undefined}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {typeof onSave === 'function' ? (
            <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-2.5 space-y-1.5">
              <button
                type="button"
                disabled={saving || !current}
                onClick={() => { void handleSave(); }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-60 shadow-sm min-h-[44px]"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {index < ordered.length - 1
                  ? 'Salvează și treci la următorul'
                  : 'Salvează acest aviz'}
              </button>
              {index < ordered.length - 1 ? (
                <p className="text-[11px] text-center text-slate-500">
                  După salvare rămâi pe coadă: poți reveni oricând la avizul {index + 1}.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

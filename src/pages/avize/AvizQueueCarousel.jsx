import React, { useEffect, useMemo, useRef, useState } from 'react';
import RoDateField from '@/components/RoDateField';
import { AlertCircle, Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import AvizFilePreview from './AvizFilePreview';
import AvizPreviewZoomBar, { usePreviewZoom } from './AvizPreviewZoomBar';
import AvizReextractBanner from './AvizReextractBanner';
import {
  CAROUSEL_EDIT_FIELDS,
  emptyForm,
  inputCls,
  isGoodsDocOnly,
  isMissingTpo,
  labelCls,
  lowField,
  missingRequiredCarouselFields,
  previewFileUrlsForPeers,
  reextractBlockedReason,
  shouldOfferReextract,
  unackedLowOcrFields,
} from './avizeUi';

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
  reextracting = false,
  onSave,
  onReextract,
  onCompletenessChange,
  /** @deprecated #109 — same-TPO peers are no longer stacked in preview; kept for call-site compat. */
  peerRows: _peerRows = null,
  /** @deprecated #109 — ignored; each aviz keeps its own preview. */
  mergeTpoPreview: _mergeTpoPreview = false,
  /** When template „Unește celulele TPO” is on — empty TPO is a hard requirement. */
  mergeTpoRequired = false,
}) {
  void _peerRows;
  void _mergeTpoPreview;
  const ordered = useMemo(() => {
    const list = Array.isArray(queue) ? [...queue] : [];
    list.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    return list;
  }, [queue]);

  const orderedIds = useMemo(() => ordered.map((r) => r.id).join('|'), [ordered]);

  const startIndex = useMemo(() => {
    if (!ordered.length) return 0;
    const at = ordered.findIndex((r) => r.id === initialId);
    return at >= 0 ? at : 0;
  }, [ordered, initialId]);

  const [index, setIndex] = useState(startIndex);
  const current = ordered[index] || null;
  const [form, setForm] = useState(() => emptyForm(current));
  const [ocrBaseline, setOcrBaseline] = useState(() => emptyForm(current));
  // Always the latest draft — Save must not use a stale closure after RoDateField blur.
  const formRef = useRef(form);
  formRef.current = form;
  // Reset position only when the queue id-set changes (new modal), not after field saves.
  const queueIdsRef = useRef(orderedIds);
  const orderedLenRef = useRef(ordered.length);
  orderedLenRef.current = ordered.length;
  // While Salvează patches the current row (new updated_at), skip reseed on that id so we
  // don't fight the advance to the next aviz (#106).
  const saveInFlightIdRef = useRef(null);

  useEffect(() => {
    if (queueIdsRef.current !== orderedIds) {
      queueIdsRef.current = orderedIds;
      setIndex(startIndex);
    }
  }, [orderedIds, startIndex]);

  useEffect(() => {
    setIndex((prev) => {
      const len = orderedLenRef.current;
      if (!len) return 0;
      if (prev >= 0 && prev < len) return prev;
      return Math.min(Math.max(prev, 0), Math.max(len - 1, 0));
    });
  }, [ordered.length]);

  useEffect(() => {
    if (saveInFlightIdRef.current && current?.id === saveInFlightIdRef.current) return;
    const next = emptyForm(current);
    setForm(next);
    setOcrBaseline(next);
    // Reseed after Re-extrage (updated_at / OCR status change), not only on id change.
  }, [current?.id, current?.updated_at, current?.status, current?.ocr_confidence]);

  const goodsDocOnly = Boolean(form.goods_doc_only);
  const missing = useMemo(() => missingRequiredCarouselFields(form), [form]);
  const missingSet = useMemo(() => new Set(missing), [missing]);

  const completeness = useMemo(() => ordered.map((row) => {
    const snap = row.id === current?.id
      ? form
      : { ...row, goods_doc_only: isGoodsDocOnly(row) };
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

  // #109 — same-TPO peers stay separate carousel steps (each with its own PSL/TRO).
  // „Unește celulele TPO” only merges in the XLSX annex, never stacks previews here.
  const previewUrls = useMemo(
    () => previewFileUrlsForPeers(current ? [current] : []),
    [current],
  );

  const previewZoomKey = `${current?.id || ''}|${previewUrls.join('|')}`;
  const {
    zoom: previewZoom, zoomAtMin, zoomAtMax, zoomIn, zoomOut,
  } = usePreviewZoom(previewZoomKey);

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
    const savedId = current.id;
    saveInFlightIdRef.current = savedId;
    try {
      await onSave(current, formRef.current);
      setIndex((i) => (i < orderedLenRef.current - 1 ? i + 1 : i));
    } catch {
      // Parent shows notifyError; stay on this aviz so the operator can retry.
    } finally {
      // Clear after paint so the post-save updated_at effect on `savedId` still skips.
      queueMicrotask(() => {
        if (saveInFlightIdRef.current === savedId) saveInFlightIdRef.current = null;
      });
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
        <div className="min-h-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50 flex flex-col overflow-hidden">
          {shouldOfferReextract(current, { form }) ? (
            <div className="shrink-0 px-2 pt-1.5 pb-1">
              <AvizReextractBanner
                onReextract={onReextract}
                row={current}
                reextracting={reextracting}
                disabled={saving}
                blockedReason={reextractBlockedReason(form, ocrBaseline)}
              />
            </div>
          ) : null}
          <div className="min-h-0 h-[min(28vh,220px)] max-h-[min(28vh,220px)] lg:h-auto lg:max-h-none flex flex-col flex-1 overflow-hidden">
          <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 border-b border-slate-200 bg-slate-100 text-[11px] font-medium text-slate-600 uppercase tracking-wide">
            <span className="truncate min-w-0">
              Document
            </span>
            {previewUrls.length > 0 ? (
              <AvizPreviewZoomBar
                zoom={previewZoom}
                onZoomOut={zoomOut}
                onZoomIn={zoomIn}
                zoomAtMin={zoomAtMin}
                zoomAtMax={zoomAtMax}
              />
            ) : null}
          </div>
          <div className="relative flex-1 min-h-0 overflow-hidden">
            {previewUrls.length > 0 ? (
              <AvizFilePreview
                fileUrl={previewUrls[0]}
                fileUrls={previewUrls.length > 1 ? previewUrls : undefined}
                fill
                zoom={previewZoom}
              />
            ) : (
              <p className="p-4 text-sm text-slate-500">Fără fișier pe acest rând.</p>
            )}
          </div>
          </div>
        </div>

        <div className="min-h-0 flex flex-col overflow-hidden bg-white">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-2 space-y-2.5">
            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={goodsDocOnly}
                disabled={saving}
                onChange={(e) => {
                  const on = e.target.checked;
                  setForm((prev) => ({
                    ...prev,
                    goods_doc_only: on,
                    ...(on ? { numar_tpo: '' } : {}),
                  }));
                }}
              />
              <span className="min-w-0 leading-snug text-pretty">
                <span className="font-medium text-[#0A2B4E]">Doar document marfă (fără TPO pe pagină)</span>
                <span className="block mt-0.5 text-xs text-slate-500">
                  Aviz de transfer / TRO-PSL fără comandă de transport. În Anexă rămâne la coada listei (după TPO-uri).
                </span>
              </span>
            </label>

            {mergeTpoRequired && isMissingTpo(form) && !goodsDocOnly ? (
              <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-950">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-700" />
                <div className="min-w-0">
                  <p className="font-semibold">Număr TPO obligatoriu pentru Unește celulele TPO</p>
                  <p className="mt-0.5 leading-snug">
                    Fără TPO pe acest aviz nu poți uni în Anexă cu bifa ON. Completează TPO, marchează „Doar document marfă”, sau oprește „Unește celulele TPO” pe șablon.
                  </p>
                </div>
              </div>
            ) : null}
            {current && unackedLowOcrFields({ ...current, goods_doc_only: goodsDocOnly }).length > 0 ? (
              <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-950">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-700" />
                <div className="min-w-0">
                  <p className="font-semibold">OCR nesigur — verifică pe poză</p>
                  <p className="mt-0.5 leading-snug">
                    Confirmă / Unește sunt blocate până salvezi aici (chiar dacă nu schimbi valorile) sau deschizi Verifică → Marchează verificat.
                  </p>
                </div>
              </div>
            ) : null}
            {missing.length > 0 ? (
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                <div className="min-w-0">
                  <p className="font-semibold">Câmpuri obligatorii lipsă</p>
                  <p className="mt-0.5 leading-snug">
                    {missing.map(labelForKey).join(' · ')}
                  </p>
                  <p className="mt-1 text-amber-800/80">
                    {goodsDocOnly && missingSet.has('numar_document_marfa')
                      ? 'Pentru „Doar document marfă” completează TRO/PSL (Număr document marfă).'
                      : mergeTpoRequired && missingSet.has('numar_tpo')
                        ? 'TPO e obligatoriu când Unește celulele TPO e activ — Unește oricum e blocat până completezi.'
                        : 'Poți derula liber și salva oricum; evidențierea dispare pe măsură ce completezi.'}
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
                const tpoDisabled = f.key === 'numar_tpo' && goodsDocOnly;
                const docRequired = f.key === 'numar_document_marfa' && goodsDocOnly;
                const showRequired = (f.required && !tpoDisabled) || docRequired;
                const ocrUnsure = f.key === 'numar_tpo' && current && lowField(current, 'numar_tpo') && !needs && !goodsDocOnly;
                const warn = needs || ocrUnsure;
                return (
                  <div key={f.key} className={f.wide ? 'sm:col-span-2' : ''}>
                    <label className={`${labelCls} ${warn ? 'text-amber-800' : ''} ${tpoDisabled ? 'text-slate-400' : ''}`}>
                      {f.label}
                      {showRequired ? <span className="text-amber-700"> *</span> : null}
                      {ocrUnsure ? (
                        <span className="ml-1.5 text-[10px] font-bold text-red-700">OCR nesigur</span>
                      ) : null}
                      {tpoDisabled ? (
                        <span className="ml-1.5 text-[10px] font-normal text-slate-400">dezactivat</span>
                      ) : null}
                    </label>
                    {f.type === 'date' ? (
                      <RoDateField
                        className={`${inputCls} ${warn ? 'border-amber-400 bg-amber-50/60 focus:border-amber-500' : ''}`}
                        value={form[f.key] ?? ''}
                        onChange={(iso) => setForm((prev) => ({ ...prev, [f.key]: iso }))}
                        aria-label={f.label}
                        aria-invalid={needs || undefined}
                      />
                    ) : (
                      <input
                        className={`${inputCls} ${warn ? 'border-amber-400 bg-amber-50/60 focus:border-amber-500' : ''} ${tpoDisabled ? 'bg-slate-100 text-slate-400' : ''}`}
                        type="text"
                        inputMode={f.inputMode || undefined}
                        autoComplete="off"
                        disabled={tpoDisabled || saving}
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
                disabled={saving || reextracting || !current}
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

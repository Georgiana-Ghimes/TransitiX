import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api/client';
import ModalShell from '@/components/ModalShell';
import RoDateField from '@/components/RoDateField';
import { notifyError, notifySuccess } from '@/lib/notify';
import { blocksForValue, isLowConfidenceBlock } from '@/lib/ocrBlocks';
import { previewKind } from '@/lib/avizOps';
import { Loader2, X } from 'lucide-react';
import AvizBlockOverlay from './AvizBlockOverlay';
import AvizFilePreview from './AvizFilePreview';
import AvizPreviewZoomBar, { usePreviewZoom } from './AvizPreviewZoomBar';
import AvizReextractBanner from './AvizReextractBanner';
import {
  inputCls, labelCls, OCR_OWNED_FIELDS, reextractBlockedReason, reviewDraftFromPayload,
  shouldOfferReextract,
} from './avizeUi';

const ISSUE_SOURCE_LABEL = {
  low_confidence: 'Încredere scăzută',
  rule_failed: 'Regulă eșuată',
  duplicate_suspect: 'Suspect de duplicat',
};

const FIELD_LABELS = {
  numar_tpo: 'Număr TPO',
  numar_auto: 'Nr. auto',
  data_efectuare_cursa: 'Data cursă',
  cantitate_marfa: 'Cantitate',
  numar_document_marfa: 'Nr. document marfă',
  ruta_transport: 'Rută transport',
  tip_marfa: 'Tip marfă',
  gross_weight_kg: 'Greutate brută (kg)',
  net_weight_kg: 'Greutate netă (kg)',
};

/** Stable display order: OCR-owned first, then any extra issue-only keys. */
function orderedDraftKeys(draft) {
  const keys = Object.keys(draft || {});
  const owned = OCR_OWNED_FIELDS.filter((k) => keys.includes(k));
  const extras = keys.filter((k) => !OCR_OWNED_FIELDS.includes(k)).sort();
  return [...owned, ...extras];
}
/**
 * HITL drawer: original scan beside problematic fields; corrections go through the API.
 */
export default function AvizReviewDrawer({
  documentId, reloadKey = 0, reextracting = false, onClose, onSaved, onReextract,
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [payload, setPayload] = useState(null);
  const [draft, setDraft] = useState({});
  const [ocrBaseline, setOcrBaseline] = useState({});
  const [activeField, setActiveField] = useState(null);
  const [showAllBlocks, setShowAllBlocks] = useState(false);
  // Parent often passes inline `() => …` — keep latest without putting them in effect deps
  // (that was remounting the load, wiping the draft, and flickering the PDF every list poll).
  const onCloseRef = useRef(onClose);
  const onSavedRef = useRef(onSaved);
  onCloseRef.current = onClose;
  onSavedRef.current = onSaved;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.documents.review(documentId)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        const next = reviewDraftFromPayload(data);
        setDraft(next);
        setOcrBaseline(next);
      })
      .catch((err) => {
        if (!cancelled) {
          notifyError('Verificare', err);
          onCloseRef.current?.();
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [documentId, reloadKey]);

  const saveCorrections = async () => {
    if (!payload) return;
    const corrections = {};
    for (const [key, value] of Object.entries(draft)) {
      const prev = payload.values?.[key];
      if (String(value ?? '') !== String(prev ?? '')) corrections[key] = value;
    }
    if (!Object.keys(corrections).length) {
      notifyError('Nicio modificare', 'Schimbă cel puțin un câmp înainte de salvare.');
      return;
    }
    setSaving(true);
    try {
      await api.documents.correct(documentId, corrections);
      notifySuccess('Corecții salvate', 'Valorile au fost înregistrate în audit.');
      // Soft refresh: keep the pane mounted (no setLoading) so the preview does not flash.
      const refreshed = await api.documents.review(documentId);
      setPayload(refreshed);
      const next = reviewDraftFromPayload(refreshed);
      setDraft(next);
      setOcrBaseline(next);
      onSavedRef.current?.();
    } catch (err) {
      notifyError('Salvare eșuată', err);
    } finally {
      setSaving(false);
    }
  };
  const approve = async () => {
    setSaving(true);
    try {
      await api.documents.approveReview(documentId);
      notifySuccess('Verificat', 'Documentul poate fi confirmat.');
      onSavedRef.current?.();
      onCloseRef.current?.();
    } catch (err) {
      notifyError('Aprobare eșuată', err);
    } finally {
      setSaving(false);
    }
  };

  const fileUrl = payload?.document?.file_url;
  const issues = payload?.issues || [];
  const routing = payload?.routing;
  const blocks = useMemo(() => (Array.isArray(payload?.ocr_blocks) ? payload.ocr_blocks : []), [payload]);
  const canOverlay = blocks.length > 0 && previewKind(fileUrl) === 'image';
  const lowBlocks = useMemo(() => blocks.filter((b) => isLowConfidenceBlock(b)).length, [blocks]);
  const {
    zoom: previewZoom, zoomAtMin, zoomAtMax, zoomIn, zoomOut,
  } = usePreviewZoom(documentId);

  // Blocks that carry the value the operator is looking at: the draft first (what they are
  // typing), the stored value as a fallback (what OCR read), only on page 0 for a photo.
  const highlight = useMemo(() => {
    if (!activeField || !canOverlay) return [];
    const typed = draft[activeField];
    const hits = blocksForValue(blocks, typed, { page: 0 });
    if (hits.length) return hits;
    return blocksForValue(blocks, payload?.values?.[activeField], { page: 0 });
  }, [activeField, canOverlay, draft, blocks, payload]);

  const pickBlock = useCallback((block) => {
    if (!activeField || !block?.text) return;
    setDraft((d) => ({ ...d, [activeField]: block.text }));
  }, [activeField]);

  const overlay = canOverlay
    ? (natural) => (
      <AvizBlockOverlay
        blocks={blocks}
        page={0}
        natural={natural}
        highlight={highlight}
        showAll={showAllBlocks}
        onPick={pickBlock}
      />
    )
    : null;

  return (
    <ModalShell onClose={onClose} panelClassName="max-w-5xl w-full" labelledBy="hitl-title">
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 id="hitl-title" className="text-lg font-semibold text-[#0A2B4E]">
            Verificare OCR
          </h2>
          <button type="button" onClick={onClose} aria-label="Închide">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            {' '}
            Se încarcă…
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[min(78vh,760px)] min-h-0">
            {/*
              Bounded height + overflow-auto so a tall aviz page is never clipped with no
              way to scroll (#91). Legend stays outside the scroll pane.
            */}
            <div className="flex flex-col gap-1.5 min-h-0 h-[min(42vh,360px)] lg:h-full">
              {shouldOfferReextract(
                payload?.document
                  ? {
                    id: documentId,
                    ...payload.document,
                    field_confidence: payload.fields || payload.document.field_confidence,
                  }
                  : { id: documentId },
                { form: draft, findings: issues },
              ) ? (
                <AvizReextractBanner
                  onReextract={onReextract}
                  row={payload?.document ? {
                    id: documentId,
                    file_url: fileUrl,
                    ...payload.document,
                  } : { id: documentId, file_url: fileUrl }}
                  reextracting={reextracting}
                  disabled={saving}
                  blockedReason={reextractBlockedReason(draft, ocrBaseline)}
                />
              ) : null}
              <div className="shrink-0 flex items-center justify-between gap-2 px-2 py-1 border border-slate-200 rounded-lg bg-slate-100 text-[11px] font-medium text-slate-600 uppercase tracking-wide">
                <span className="truncate min-w-0">Document</span>
                <AvizPreviewZoomBar
                  zoom={previewZoom}
                  onZoomOut={zoomOut}
                  onZoomIn={zoomIn}
                  zoomAtMin={zoomAtMin}
                  zoomAtMax={zoomAtMax}
                />
              </div>
              <div className="relative flex-1 min-h-0 border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                <AvizFilePreview fileUrl={fileUrl} fill zoom={previewZoom} overlay={overlay} />
              </div>
              {blocks.length > 0 ? (
                <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                  {canOverlay ? (
                    <>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded-sm border border-sky-500 bg-sky-400/20" />
                        câmpul activ
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded-sm border border-amber-500 bg-amber-300/20" />
                        citire nesigură ({lowBlocks})
                      </span>
                      <label className="inline-flex items-center gap-1 cursor-pointer ml-auto">
                        <input
                          type="checkbox"
                          checked={showAllBlocks}
                          onChange={(e) => setShowAllBlocks(e.target.checked)}
                        />
                        toate blocurile ({blocks.length})
                      </label>
                      <span className="w-full text-slate-500">
                        Apasă într-un câmp, apoi pe un bloc din poză ca să preiei textul citit acolo.
                        Derulează preview-ul ca să vezi toată pagina.
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-500">
                      Evidențierea pe pagină e disponibilă pentru poze; la PDF derulează preview-ul pentru toată pagina.
                    </span>
                  )}
                </div>
              ) : (
                <p className="shrink-0 text-[11px] text-slate-500">
                  Derulează preview-ul dacă pagina nu încape pe ecran.
                </p>
              )}
            </div>
            <div className="min-h-0 flex flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 space-y-3">
                <p className="text-xs text-slate-500">
                  Rutare:
                  {' '}
                  <span className="font-semibold text-slate-700">
                    {routing === 'hitl_required' ? 'verificare obligatorie'
                      : routing === 'hitl_optional' ? 'verificare opțională'
                        : 'auto'}
                  </span>
                  {payload?.document?.original_filename
                    ? ` · ${payload.document.original_filename}`
                    : null}
                </p>

                {issues.length > 0 && (
                  <ul className="space-y-2">
                    {issues.map((issue, idx) => (
                      <li
                        key={`${issue.rule}-${issue.field}-${idx}`}
                        onMouseEnter={issue.field ? () => setActiveField(issue.field) : undefined}
                        className={`rounded-lg border px-3 py-2 text-xs text-amber-950 ${
                          issue.field && issue.field === activeField
                            ? 'border-sky-300 bg-sky-50/70'
                            : 'border-amber-100 bg-amber-50/60'
                        }`}
                      >
                        <div className="font-semibold">{issue.title}</div>
                        <div className="opacity-90 mt-0.5">{issue.message}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-amber-800/80">
                          {ISSUE_SOURCE_LABEL[issue.source] || issue.source}
                          {issue.confidence != null
                            ? ` · ${(Number(issue.confidence) * 100).toFixed(0)}%`
                            : ''}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="space-y-3 pt-1">
                  {orderedDraftKeys(draft).map((key) => {
                    const active = key === activeField;
                    const matched = active ? highlight.length : 0;
                    const flagged = issues.some((issue) => issue.field === key);
                    return (
                      <div key={key}>
                        <label className={`${labelCls} ${flagged ? 'text-amber-800' : ''}`}>
                          {FIELD_LABELS[key] || key}
                          {flagged ? (
                            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                              de verificat
                            </span>
                          ) : null}
                          {active && canOverlay ? (
                            <span className="ml-2 font-normal text-[11px] text-slate-500">
                              {matched ? `${matched} bloc(uri) în poză` : 'nu găsesc valoarea în poză'}
                            </span>
                          ) : null}
                        </label>
                        {key === 'data_efectuare_cursa' ? (
                          <RoDateField
                            className={`${inputCls} ${active ? 'ring-2 ring-sky-300' : ''} ${flagged ? 'border-amber-400 bg-amber-50/50' : ''}`}
                            value={draft[key] ?? ''}
                            onChange={(iso) => {
                              setActiveField(key);
                              setDraft((d) => ({ ...d, [key]: iso }));
                            }}
                            aria-label={FIELD_LABELS[key] || key}
                          />
                        ) : (
                          <input
                            className={`${inputCls} ${active ? 'ring-2 ring-sky-300' : ''} ${flagged ? 'border-amber-400 bg-amber-50/50' : ''}`}
                            value={draft[key] ?? ''}
                            onFocus={() => setActiveField(key)}
                            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="shrink-0 flex flex-wrap gap-2 pt-2 border-t border-slate-100 bg-white py-2">
                <button
                  type="button"
                  disabled={saving || reextracting}
                  onClick={saveCorrections}
                  className="px-3 py-2 text-sm rounded-lg bg-[#0A2B4E] text-white disabled:opacity-50"
                >
                  Salvează corecții
                </button>
                <button
                  type="button"
                  disabled={saving || reextracting}
                  onClick={approve}
                  className="px-3 py-2 text-sm rounded-lg border border-emerald-300 text-emerald-800 bg-emerald-50 disabled:opacity-50"
                >
                  Marchează verificat
                </button>
              </div>
            </div>
          </div>
        )}      </div>
    </ModalShell>
  );
}

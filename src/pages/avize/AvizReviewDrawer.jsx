import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';
import ModalShell from '@/components/ModalShell';
import RoDateField from '@/components/RoDateField';
import { notifyError, notifySuccess } from '@/lib/notify';
import { blocksForValue, isLowConfidenceBlock } from '@/lib/ocrBlocks';
import { previewKind } from '@/lib/avizOps';
import { toDateIso } from '@/lib/utils';
import { Loader2, X } from 'lucide-react';
import AvizBlockOverlay from './AvizBlockOverlay';
import AvizFilePreview from './AvizFilePreview';
import { inputCls, labelCls } from './avizeUi';

const ISSUE_SOURCE_LABEL = {
  low_confidence: 'Încredere scăzută',
  rule_failed: 'Regulă eșuată',
  duplicate_suspect: 'Suspect de duplicat',
};

const FIELD_LABELS = {
  numar_tpo: 'TPO',
  numar_auto: 'Nr. auto',
  data_efectuare_cursa: 'Data cursă',
  cantitate_marfa: 'Cantitate',
  numar_document_marfa: 'Nr. document',
  ruta_transport: 'Rută',
  tip_marfa: 'Tip marfă',
  gross_weight_kg: 'Greutate brută',
  net_weight_kg: 'Greutate netă',
};

/**
 * HITL drawer: original scan beside problematic fields; corrections go through the API.
 */
export default function AvizReviewDrawer({ documentId, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [payload, setPayload] = useState(null);
  const [draft, setDraft] = useState({});
  const [activeField, setActiveField] = useState(null);
  const [showAllBlocks, setShowAllBlocks] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.documents.review(documentId)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        const next = {};
        for (const issue of data.issues || []) {
          if (issue.field) {
            const raw = issue.value ?? '';
            next[issue.field] = issue.field === 'data_efectuare_cursa' ? toDateIso(raw) : raw;
          }
        }
        for (const key of ['numar_tpo', 'numar_auto', 'data_efectuare_cursa', 'cantitate_marfa']) {
          if (next[key] === undefined) {
            const raw = data.values?.[key] ?? '';
            next[key] = key === 'data_efectuare_cursa' ? toDateIso(raw) : raw;
          }
        }
        setDraft(next);
      })
      .catch((err) => {
        if (!cancelled) {
          notifyError('Verificare', err);
          onClose?.();
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [documentId, onClose]);

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
      onSaved?.();
      const refreshed = await api.documents.review(documentId);
      setPayload(refreshed);
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
      onSaved?.();
      onClose?.();
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[75vh]">
            <div className="flex flex-col gap-2 min-h-0">
              <div className="min-h-[260px] h-[40vh] lg:h-auto lg:flex-1 relative border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                <AvizFilePreview fileUrl={fileUrl} fill overlay={overlay} />
              </div>
              {blocks.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
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
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-500">
                      Evidențierea pe pagină e disponibilă pentru poze; la PDF rămâne lista de probleme.
                    </span>
                  )}
                </div>
              ) : null}
            </div>
            <div className="overflow-y-auto pr-1 space-y-3 max-h-[60vh] lg:max-h-[70vh]">
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
                {Object.keys(draft).map((key) => {
                  const active = key === activeField;
                  const matched = active ? highlight.length : 0;
                  return (
                    <div key={key}>
                      <label className={labelCls}>
                        {FIELD_LABELS[key] || key}
                        {active && canOverlay ? (
                          <span className="ml-2 font-normal text-[11px] text-slate-500">
                            {matched ? `${matched} bloc(uri) în poză` : 'nu găsesc valoarea în poză'}
                          </span>
                        ) : null}
                      </label>
                      {key === 'data_efectuare_cursa' ? (
                        <RoDateField
                          className={`${inputCls} ${active ? 'ring-2 ring-sky-300' : ''}`}
                          value={draft[key] ?? ''}
                          onChange={(iso) => {
                            setActiveField(key);
                            setDraft((d) => ({ ...d, [key]: iso }));
                          }}
                          aria-label={FIELD_LABELS[key] || key}
                        />
                      ) : (
                        <input
                          className={`${inputCls} ${active ? 'ring-2 ring-sky-300' : ''}`}
                          value={draft[key] ?? ''}
                          onFocus={() => setActiveField(key)}
                          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2 pt-2 sticky bottom-0 bg-white py-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={saveCorrections}
                  className="px-3 py-2 text-sm rounded-lg bg-[#0A2B4E] text-white disabled:opacity-50"
                >
                  Salvează corecții
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={approve}
                  className="px-3 py-2 text-sm rounded-lg border border-emerald-300 text-emerald-800 bg-emerald-50 disabled:opacity-50"
                >
                  Marchează verificat
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

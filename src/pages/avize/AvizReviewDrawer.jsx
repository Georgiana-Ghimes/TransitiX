import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import ModalShell from '@/components/ModalShell';
import { notifyError, notifySuccess } from '@/lib/notify';
import { Loader2, X } from 'lucide-react';
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.documents.review(documentId)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        const next = {};
        for (const issue of data.issues || []) {
          if (issue.field) next[issue.field] = issue.value ?? '';
        }
        for (const key of ['numar_tpo', 'numar_auto', 'data_efectuare_cursa', 'cantitate_marfa']) {
          if (next[key] === undefined) next[key] = data.values?.[key] ?? '';
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
            <div className="min-h-[260px] h-[40vh] lg:h-auto relative border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
              <AvizFilePreview fileUrl={fileUrl} fill />
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
                      className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs text-amber-950"
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
                {Object.keys(draft).map((key) => (
                  <div key={key}>
                    <label className={labelCls}>{FIELD_LABELS[key] || key}</label>
                    <input
                      className={inputCls}
                      value={draft[key] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                    />
                  </div>
                ))}
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

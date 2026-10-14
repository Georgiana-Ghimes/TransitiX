import React, { useCallback, useState } from 'react';
import ModalShell from '@/components/ModalShell';
import { Loader2, X } from 'lucide-react';
import AvizQueueCarousel from './AvizQueueCarousel';

/**
 * Disclaimer + carousel before force-confirm or unverified export.
 * When every required field in the queue is filled (or the edit queue is empty because
 * nothing had gaps), the footer switches from „Da / Nu oricum” to Unește / Confirmă.
 */
export default function AvizForceGateModal({
  mode = 'export',
  queue = [],
  initialId = null,
  busy = false,
  onConfirm,
  onCancel,
  onSaveItem,
  peerRows = null,
  mergeTpoPreview = false,
}) {
  const [savingItem, setSavingItem] = useState(false);
  const [completeness, setCompleteness] = useState({
    allRequiredComplete: false,
    allConfirmed: false,
  });

  const handleCompleteness = useCallback((next) => {
    setCompleteness((prev) => {
      if (
        prev.allRequiredComplete === next.allRequiredComplete
        && prev.allConfirmed === next.allConfirmed
      ) {
        return prev;
      }
      return {
        allRequiredComplete: Boolean(next.allRequiredComplete),
        allConfirmed: Boolean(next.allConfirmed),
      };
    });
  }, []);

  const handleSave = async (row, form) => {
    if (!onSaveItem) return;
    setSavingItem(true);
    try {
      await onSaveItem(row, form);
    } finally {
      setSavingItem(false);
    }
  };

  const isExport = mode === 'export';
  // Empty edit queue = blocked only by HITL/status, nothing left to type → treat as ready.
  const noEditNeeded = !queue.length;
  const ready = noEditNeeded || completeness.allRequiredComplete;
  const cleanExport = ready && (noEditNeeded
    ? false
    : completeness.allConfirmed);

  let title;
  let description;
  let confirmLabel;
  let cancelLabel = 'Anulează';

  if (isExport) {
    if (ready) {
      title = cleanExport
        ? 'Gata de unire în Anexa XLSX'
        : 'Câmpurile sunt complete: poți uni';
      description = noEditNeeded
        ? 'Nu lipsește niciun câmp obligatoriu pe selecție. Documentele sunt încă neverificate / neconfirmate pentru anexă: poți uni oricum.'
        : cleanExport
          ? 'Toate avizele din coadă au câmpurile obligatorii și sunt confirmate. Poți genera Anexa.'
          : 'Toate câmpurile obligatorii sunt complete. Poți uni în XLSX; dacă unele nu sunt încă Confirmat, le marcăm la export.';
      confirmLabel = 'Unește în XLSX';
    } else {
      title = 'Sigur unești și avize neverificate / neconfirmate?';
      description = 'Selecția include documente cu câmpuri obligatorii goale. Completează-le în carousel sau unește oricum: responsabilitatea e a ta.';
      confirmLabel = 'Da, unește oricum';
      cancelLabel = 'Nu';
    }
  } else if (ready) {
    title = 'Gata de confirmare';
    description = noEditNeeded
      ? 'Nu lipsește niciun câmp obligatoriu. Poți confirma selecția (inclusiv documente marcate pentru verificare OCR).'
      : 'Câmpurile obligatorii sunt complete pe avizele din coadă. Poți confirma selecția.';
    confirmLabel = 'Confirmă';
  } else {
    title = 'Sigur confirmi și avize cu câmpuri de verificat?';
    description = 'Există câmpuri obligatorii goale. Poți edita în carousel, apoi Da confirmă oricum: îți asumi datele incomplete.';
    confirmLabel = 'Da, confirmă oricum';
    cancelLabel = 'Nu';
  }

  return (
    <ModalShell
      onClose={busy ? undefined : onCancel}
      panelClassName="max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col"
      labelledBy="force-gate-title"
    >
      <div className="flex flex-col min-h-0 flex-1">
        <div className="shrink-0 flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id="force-gate-title" className="text-lg font-semibold text-[#0A2B4E]">{title}</h2>
            {description ? (
              <p className="mt-1.5 text-sm text-slate-600 leading-snug">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Închide"
            className="shrink-0 disabled:opacity-40"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {queue.length > 0 ? (
          <div className="min-h-0 flex-1 px-5 pb-3">
            <AvizQueueCarousel
              queue={queue}
              initialId={initialId}
              saving={savingItem || busy}
              onSave={onSaveItem ? handleSave : undefined}
              onCompletenessChange={handleCompleteness}
              peerRows={peerRows}
              mergeTpoPreview={mergeTpoPreview}
            />
          </div>
        ) : (
          <div className="px-5 pb-2">
            <p className="text-sm text-slate-600 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              Nimic de completat pe câmpurile obligatorii (TPO, dată, auto, rută).
              Rămâne doar acțiunea din josul ferestrei.
            </p>
          </div>
        )}

        <div className="shrink-0 flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-white">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm?.({ ready, cleanExport })}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

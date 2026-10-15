import React, { useCallback, useMemo, useState } from 'react';
import ModalShell from '@/components/ModalShell';
import { Loader2, X } from 'lucide-react';
import AvizQueueCarousel from './AvizQueueCarousel';
import { rowsMissingTpo, rowsNeedingOcrVerify } from './avizeUi';

/**
 * Disclaimer + carousel before force-confirm or unverified export.
 * Empty TPO with merge ON, and unacked OCR-low TPO/auto/rută, hard-block Confirm/Unește.
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
  mergeTpoRequired = false,
}) {
  const [savingItem, setSavingItem] = useState(false);
  const [ackRisk, setAckRisk] = useState(false);
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

  const selectionRows = useMemo(() => {
    if (Array.isArray(peerRows) && peerRows.length) return peerRows;
    return queue || [];
  }, [peerRows, queue]);

  const missingTpoCount = useMemo(() => {
    if (!mergeTpoRequired) return 0;
    return rowsMissingTpo(selectionRows).length;
  }, [mergeTpoRequired, selectionRows]);

  const ocrVerifyCount = useMemo(
    () => rowsNeedingOcrVerify(selectionRows).length,
    [selectionRows],
  );

  const isExport = mode === 'export';
  // Empty edit queue = blocked only by HITL/status, nothing left to type → treat as ready.
  const noEditNeeded = !queue.length;
  const ready = noEditNeeded || completeness.allRequiredComplete;
  const cleanExport = ready && (noEditNeeded
    ? false
    : completeness.allConfirmed);
  // Merge-TPO ON + blank TPO on selection: never allow Confirmă / Unește oricum.
  const mergeBlocksForce = mergeTpoRequired && missingTpoCount > 0;
  // OCR nesigur (unacked): hard block Confirm / Unește until Verifică or Salvează.
  const ocrBlocksForce = ocrVerifyCount > 0;
  const hardBlocked = mergeBlocksForce || ocrBlocksForce;
  const needsAck = !ready && !hardBlocked;

  let title;
  let description;
  let confirmLabel;
  let cancelLabel = 'Anulează';

  if (mergeBlocksForce) {
    title = isExport
      ? 'Completează Număr TPO înainte de unire'
      : 'Completează Număr TPO înainte de confirmare';
    description = missingTpoCount === 1
      ? (isExport
        ? '„Unește celulele TPO” e activ: un aviz din selecție nu are Număr TPO. Completează-l în carousel (sau oprește bifa pe șablon). Nu poți uni oricum — un TPO gol nu intră în grup, iar unul greșit ajunge în cursa greșită din Excel.'
        : '„Unește celulele TPO” e activ: un aviz din selecție nu are Număr TPO. Completează-l în carousel (sau marchează „Doar document marfă”, sau oprește bifa pe șablon). Nu poți confirma oricum.')
      : (isExport
        ? `„Unește celulele TPO” e activ: ${missingTpoCount} avize din selecție nu au Număr TPO. Completează-le în carousel (sau oprește bifa pe șablon). Nu poți uni oricum.`
        : `„Unește celulele TPO” e activ: ${missingTpoCount} avize din selecție nu au Număr TPO. Completează-le în carousel (sau oprește bifa pe șablon). Nu poți confirma oricum.`);
    confirmLabel = 'Completează TPO';
  } else if (ocrBlocksForce) {
    title = 'Verifică pe document (OCR nesigur)';
    description = ocrVerifyCount === 1
      ? 'Un aviz are TPO / auto / rută cu OCR nesigur (ex. ștampilă). Confirmă și Unește sunt blocate până verifici pe poză: Salvează în carusel sau deschide Verifică → Marchează verificat.'
      : `${ocrVerifyCount} avize au TPO / auto / rută cu OCR nesigur. Confirmă și Unește sunt blocate până verifici pe document (Salvează în carusel sau Verifică).`;
    confirmLabel = 'Verifică pe document';
  } else if (isExport) {
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
      description = 'Selecția include documente cu câmpuri obligatorii goale. Completează în carousel sau unește oricum — doar după ce îți asumi mai jos.';
      confirmLabel = 'Da, unește oricum';
      cancelLabel = 'Nu';
    }
  } else if (ready) {
    title = 'Gata de confirmare';
    description = noEditNeeded
      ? 'Nu lipsește niciun câmp obligatoriu. Poți confirma selecția.'
      : 'Câmpurile obligatorii sunt complete pe avizele din coadă. Poți confirma selecția.';
    confirmLabel = 'Confirmă';
  } else {
    title = 'Sigur confirmi și avize cu câmpuri de verificat?';
    description = 'Există câmpuri obligatorii goale. Poți edita în carousel, apoi confirmă oricum — doar după ce îți asumi mai jos.';
    confirmLabel = 'Da, confirmă oricum';
    cancelLabel = 'Nu';
  }

  const confirmDisabled = busy
    || hardBlocked
    || (needsAck && !ackRisk);

  const panelWidth = queue.length > 0
    ? 'max-w-5xl w-full'
    : 'max-w-md w-full';

  const panelHeight = queue.length > 0
    ? 'max-h-[min(92vh,100dvh-1.5rem)] h-[min(92vh,100dvh-1.5rem)]'
    : 'max-h-[min(92vh,100dvh-1.5rem)]';

  return (
    <ModalShell
      onClose={busy ? undefined : onCancel}
      panelClassName={`${panelWidth} ${panelHeight} overflow-hidden flex flex-col`}
      labelledBy="force-gate-title"
    >
      <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
        <div className="shrink-0 flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 id="force-gate-title" className="text-lg font-semibold text-[#0A2B4E] text-balance">
              {title}
            </h2>
            {description ? (
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed text-pretty">
                {description}
              </p>
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
          <div className="min-h-0 flex-1 overflow-hidden px-5 pb-2 flex flex-col">
            <AvizQueueCarousel
              queue={queue}
              initialId={initialId}
              saving={savingItem || busy}
              onSave={onSaveItem ? handleSave : undefined}
              onCompletenessChange={handleCompleteness}
              peerRows={peerRows}
              mergeTpoPreview={mergeTpoPreview}
              mergeTpoRequired={mergeTpoRequired}
            />
          </div>
        ) : (
          <div className="px-5 pb-2 shrink-0">
            <p className="text-sm text-slate-700 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 leading-relaxed text-pretty">
              Nimic de completat pe câmpurile obligatorii (TPO, dată, auto, rută).
              {' '}
              Rămâne doar acțiunea din josul ferestrei.
            </p>
          </div>
        )}

        <div className="shrink-0 px-5 py-3 border-t border-slate-200 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2.5">
          {needsAck ? (
            <label className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={ackRisk}
                disabled={busy}
                onChange={(e) => setAckRisk(e.target.checked)}
              />
              <span className="leading-snug text-pretty">
                Am verificat pe document / îmi asum datele incomplete sau nesigure.
              </span>
            </label>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="px-4 py-2.5 text-sm border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-60 min-h-[44px]"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              disabled={confirmDisabled}
              onClick={() => {
                if (hardBlocked) return;
                onConfirm?.({ ready, cleanExport });
              }}
              title={
                mergeBlocksForce
                  ? 'Completează Număr TPO pe fiecare aviz din selecție'
                  : ocrBlocksForce
                    ? 'Salvează în carusel sau Verifică → Marchează verificat'
                    : undefined
              }
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-60 min-h-[44px]"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

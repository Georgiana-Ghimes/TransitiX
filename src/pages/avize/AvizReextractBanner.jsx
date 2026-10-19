import React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

/**
 * Compact Re-extrage call-out above the document preview — one line + small button.
 * Greys out when the operator has typed / saved OCR edits (`blockedReason`).
 */
export default function AvizReextractBanner({
  onReextract,
  row = null,
  reextracting = false,
  disabled = false,
  blockedReason = null,
}) {
  if (typeof onReextract !== 'function') return null;
  const blocked = Boolean(blockedReason);
  const inactive = disabled || reextracting || !row || blocked;
  return (
    <div
      className={[
        'shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1',
        blocked ? 'border-slate-200 bg-slate-50' : 'border-emerald-300 bg-emerald-50',
      ].join(' ')}
    >
      <p
        className={[
          'text-[11px] font-medium leading-snug min-w-0 flex-1',
          blocked ? 'text-slate-600' : 'text-emerald-900',
        ].join(' ')}
      >
        {blocked
          ? 'Re-extrage e dezactivat: ai modificări pe câmpuri.'
          : 'Re-extragerea poate repara valorile greșite.'}
      </p>
      <button
        type="button"
        disabled={inactive}
        onClick={() => { if (!inactive && row) onReextract(row); }}
        title={blockedReason || 'Citește din nou câmpurile din poză / PDF'}
        className={[
          'inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-semibold rounded shrink-0',
          blocked || inactive
            ? 'text-slate-500 bg-slate-300 cursor-not-allowed'
            : 'text-white bg-emerald-700 hover:bg-emerald-800',
          'disabled:opacity-70',
        ].join(' ')}
      >
        {reextracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        Re-extrage
      </button>
    </div>
  );
}

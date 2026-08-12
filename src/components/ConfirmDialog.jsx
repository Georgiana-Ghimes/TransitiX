import React from 'react';
import ModalShell from '@/components/ModalShell';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * In-app confirm dialog (replaces window.confirm).
 */
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmă',
  cancelLabel = 'Anulează',
  variant = 'danger',
  busy = false,
}) {
  if (!open) return null;

  const confirmCls =
    variant === 'warning'
      ? 'bg-amber-600 hover:bg-amber-700'
      : 'bg-red-600 hover:bg-red-700';

  return (
    <ModalShell onClose={busy ? undefined : onClose} panelClassName="max-w-md" labelledBy="confirm-dialog-title">
      <div className="p-6">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
              variant === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
            )}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-dialog-title" className="text-lg font-semibold text-[#0A2B4E]">
              {title}
            </h2>
            {description ? (
              <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{description}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={cn(
              'px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50',
              confirmCls
            )}
          >
            {busy ? 'Se procesează…' : confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

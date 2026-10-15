import React from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Compact row menu for Avize list (card + table).
 * Visibility rules match the previous stacked text links.
 */
export default function AvizRowActions({
  row,
  locked = false,
  ocrDown = false,
  reextracting = false,
  onEdit,
  onReview,
  onConfirm,
  onReextract,
  onDelete,
  align = 'end',
}) {
  const showVerify = row?.status !== 'confirmed'
    && (row?.needs_review
      || row?.validation_routing === 'hitl_required'
      || row?.validation_routing === 'hitl_optional');
  const showConfirm = row?.status !== 'confirmed';
  const reextractDisabled = locked || ocrDown || reextracting;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={locked}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#0A2B4E] border border-slate-200 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 min-h-[32px]"
          aria-label="Acțiuni aviz"
        >
          {reextracting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Re-extrag…
            </>
          ) : (
            <>
              Acțiuni
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-[11rem]">
        <DropdownMenuItem
          disabled={locked}
          className="text-[#1D4E89] focus:text-[#1D4E89] cursor-pointer"
          onSelect={() => onEdit?.(row)}
        >
          Editează
        </DropdownMenuItem>
        {showVerify ? (
          <DropdownMenuItem
            disabled={locked}
            className="text-amber-700 focus:text-amber-800 cursor-pointer"
            onSelect={() => onReview?.(row)}
          >
            Verifică
          </DropdownMenuItem>
        ) : null}
        {showConfirm ? (
          <DropdownMenuItem
            disabled={locked}
            className="text-emerald-700 focus:text-emerald-800 cursor-pointer"
            onSelect={() => onConfirm?.(row)}
          >
            Confirmă
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          disabled={reextractDisabled}
          title={ocrDown ? 'OCR indisponibil' : undefined}
          className="text-slate-700 focus:text-slate-900 cursor-pointer"
          onSelect={() => {
            if (reextractDisabled) return;
            onReextract?.(row);
          }}
        >
          {reextracting ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Re-extrag…
            </span>
          ) : (
            'Re-extrage'
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={locked}
          className="text-red-600 focus:text-red-700 cursor-pointer"
          onSelect={() => onDelete?.(row)}
        >
          Șterge
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

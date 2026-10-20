import React from 'react';
import { X } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { APP_BUILD, formatAppVersion } from '@/lib/appVersion';
import { markWhatsNewSeen, releasesForModal } from '@/lib/whatsNew';

/**
 * „Ce este nou?” for the documents companion (office).
 * Compact on phones: short panel, scrollable body, large close / Gata — never a full-screen wall.
 */
export default function WhatsNewModal({ open, onClose, showAll = false, clientIp = null }) {
  if (!open) return null;

  // Auto-open: only the newest unseen note (phones). Sidebar "Ce este nou?": full keep list.
  const releases = releasesForModal({
    all: showAll,
    currentIp: clientIp,
    limit: showAll ? null : 1,
  });
  const list = releases.length > 0
    ? releases
    : releasesForModal({ all: true, currentIp: clientIp, limit: 1 });

  const handleClose = () => {
    markWhatsNewSeen(APP_BUILD, clientIp);
    onClose?.();
  };

  return (
    <ModalShell
      onClose={handleClose}
      panelClassName="max-w-lg max-h-[min(78dvh,34rem)] flex flex-col overflow-hidden"
      labelledBy="whats-new-title"
    >
      <div className="relative shrink-0 border-b border-slate-100 bg-white rounded-t-xl">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h2 id="whats-new-title" className="text-base sm:text-lg font-semibold text-[#0A2B4E] leading-tight">
              Ce este nou?
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
              {formatAppVersion()}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Închide"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5 sm:py-4 space-y-4">
        {list.length === 0 ? (
          <p className="text-sm text-slate-500">
            De data asta nu e nimic nou de spus. Ne vedem la următoarea actualizare.
          </p>
        ) : (
          <ul className="space-y-3">
            {list.map((release) => (
              <li
                key={release.build}
                className="rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-3"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-1.5">
                  <h3 className="text-sm font-semibold text-[#0A2B4E]">
                    {release.title}
                  </h3>
                  <span className="text-[11px] font-medium text-slate-500 tabular-nums">
                    {release.version ? `v${String(release.version).replace(/^v/, '')}` : null}
                    {release.version ? ' · ' : null}
                    build {release.build}
                    {release.dateLabel ? ` · ${release.dateLabel}` : null}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {(release.highlights || []).map((line) => (
                    <li key={line} className="flex gap-2 text-sm text-slate-700 leading-snug">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F5A623]" aria-hidden="true" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-slate-500 leading-relaxed border-l-2 border-[#0A2B4E]/25 pl-3">
          Dacă tot ceva se comportă ciudat, lasă un tichet. Citim.
        </p>
      </div>

      <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-3 sm:px-5 rounded-b-xl flex justify-end">
        <button
          type="button"
          onClick={handleClose}
          className="inline-flex w-full sm:w-auto items-center justify-center rounded-lg bg-[#0A2B4E] px-4 py-3 sm:py-2.5 text-sm font-semibold text-white hover:bg-[#1D4E89] transition-colors min-h-11"
        >
          Gata
        </button>
      </div>
    </ModalShell>
  );
}

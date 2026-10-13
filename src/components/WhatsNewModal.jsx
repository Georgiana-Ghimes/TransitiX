import React from 'react';
import { X } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { APP_BUILD, formatAppVersion } from '@/lib/appVersion';
import { markWhatsNewSeen, releasesForModal } from '@/lib/whatsNew';

/**
 * „Ce este nou?” for the documents companion.
 * Auto-opens on a new build; also reopened from the sidebar.
 */
export default function WhatsNewModal({ open, onClose, showAll = false, clientIp = null }) {
  if (!open) return null;

  const releases = releasesForModal({ all: showAll, currentIp: clientIp });
  const list = releases.length > 0
    ? releases
    : releasesForModal({ all: true, currentIp: clientIp });

  const handleClose = () => {
    markWhatsNewSeen(APP_BUILD, clientIp);
    onClose?.();
  };

  return (
    <ModalShell onClose={handleClose} panelClassName="max-w-lg" labelledBy="whats-new-title">
      <div className="relative sticky top-0 z-[1] overflow-hidden rounded-t-xl border-b border-slate-100 bg-white">
        {/* Sidebar-blue corner ribbon */}
        <div
          className="pointer-events-none absolute -right-10 top-3 z-[2] w-36 rotate-45 bg-[#0A2B4E] py-1.5 text-center shadow-sm"
          aria-hidden="true"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/95">
            Noutăți
          </span>
        </div>

        <div className="flex items-start justify-between gap-3 px-5 py-4 pr-14">
          <div className="min-w-0">
            <h2 id="whats-new-title" className="text-lg font-semibold text-[#0A2B4E] leading-tight">
              Ce este nou?
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
              {formatAppVersion()}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="relative z-[3] rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Închide"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="px-5 py-4 space-y-5">
        {list.length === 0 ? (
          <p className="text-sm text-slate-500">
            De data asta nu e nimic nou de spus. Ne vedem la următoarea actualizare.
          </p>
        ) : (
          <ul className="space-y-4">
            {list.map((release) => (
              <li
                key={release.build}
                className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3.5"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-2">
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
                <ul className="space-y-2">
                  {(release.highlights || []).map((line) => (
                    <li key={line} className="flex gap-2 text-sm text-slate-700 leading-relaxed">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F5A623]" aria-hidden="true" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[13px] text-slate-500 leading-relaxed border-l-2 border-[#0A2B4E]/25 pl-3">
          Dacă tot ceva se comportă ciudat, lasă un tichet. Citim. Nu e formular de formalitate.
        </p>
      </div>

      <div className="sticky bottom-0 border-t border-slate-100 bg-white px-5 py-3.5 rounded-b-xl flex justify-end">
        <button
          type="button"
          onClick={handleClose}
          className="inline-flex items-center justify-center rounded-lg bg-[#0A2B4E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4E89] transition-colors"
        >
          Gata
        </button>
      </div>
    </ModalShell>
  );
}

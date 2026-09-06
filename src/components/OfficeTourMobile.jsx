import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight, HelpCircle, Menu } from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  OFFICE_TOUR_STEPS,
  clampTourStep,
  tourMobileMenuStep,
  tourStepMobileBody,
  tourStepMobileHint,
} from '@/lib/officeTour';

/** Mobile-only full-width bottom sheet — no sidebar drawer required. */
export default function OfficeTourMobile({ step, steps, onStepChange, onClose }) {
  const script = steps?.length ? steps : OFFICE_TOUR_STEPS;
  const total = script.length;
  const index = clampTourStep(step, total);
  const current = script[index];
  const last = index === total - 1;
  const showMenuCue = tourMobileMenuStep(current) || current.highlightTarget === 'ghid';

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[115] bg-[#0A2B4E]/55 backdrop-blur-[1px]"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        className="fixed inset-x-0 bottom-0 z-[120] flex flex-col max-h-[min(82dvh,560px)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="office-tour-mobile-title"
        style={{
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
      >
        <div
          className="mx-3 mb-3 flex flex-col min-h-0 bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shrink-0 px-4 pt-3 pb-2 border-b border-slate-100">
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mb-3" aria-hidden="true" />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-[#F5A623] flex items-center justify-center shrink-0">
                  <HelpCircle className="w-4 h-4 text-[#0A2B4E]" />
                </span>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Ghid · {index + 1}/{total}
                </p>
              </div>
              <button
                type="button"
                className="text-xs text-slate-500 px-2 py-1 -mr-1"
                onClick={onClose}
              >
                Sari peste
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3">
            {showMenuCue ? (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#0A2B4E] text-white mb-3">
                <span className="shrink-0 w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center">
                  <Menu className="w-5 h-5" />
                </span>
                <div className="min-w-0 text-sm leading-snug">
                  <p className="font-medium">Meniul e sus-stânga (☰)</p>
                  <p className="text-white/80 text-xs mt-1">
                    {current.highlightTarget === 'ghid'
                      ? 'Deschide meniul → jos găsești Ghid, lângă Setări.'
                      : `Deschide meniul → alege ${current.cta || 'pagina evidențiată'}.`}
                  </p>
                </div>
              </div>
            ) : null}

            {tourStepMobileHint(current) ? (
              <p className="text-xs font-medium text-[#1D4E89] bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 leading-relaxed mb-3">
                {tourStepMobileHint(current)}
              </p>
            ) : null}

            <h2 id="office-tour-mobile-title" className="text-base font-semibold text-[#0A2B4E] leading-snug">
              {current.title}
            </h2>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              {tourStepMobileBody(current)}
            </p>

            {current.demo ? (
              <p className="mt-3 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Pagină demo — nu folosi pentru date reale.
              </p>
            ) : null}

            {tourMobileMenuStep(current) && current.cta ? (
              <div className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg px-3 py-2">
                <span className="w-2 h-2 rounded-full bg-[#F5A623]" aria-hidden="true" />
                Pagina din spate: {current.cta}
              </div>
            ) : null}
          </div>

          <div className="shrink-0 px-4 py-3 border-t border-slate-100 bg-white">
            <div className="flex items-center justify-center gap-1 mb-3" aria-hidden="true">
              {script.map((s, i) => (
                <span
                  key={s.id}
                  className={
                    i === index
                      ? 'h-1.5 w-4 rounded-full bg-[#0A2B4E]'
                      : 'h-1.5 w-1.5 rounded-full bg-slate-300'
                  }
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => onStepChange(clampTourStep(index - 1, total))}
                className="inline-flex h-11 items-center justify-center gap-1 text-sm border border-slate-200 rounded-xl disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
                Înapoi
              </button>
              <button
                type="button"
                onClick={() => {
                  if (last) onClose();
                  else onStepChange(clampTourStep(index + 1, total));
                }}
                className="inline-flex h-11 items-center justify-center gap-1 text-sm font-medium text-white bg-[#0A2B4E] rounded-xl"
              >
                {last ? 'Am înțeles' : 'Următorul'}
                {last ? null : <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

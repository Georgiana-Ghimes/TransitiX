import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight, HelpCircle } from 'lucide-react';
import { OFFICE_TOUR_STEPS, clampTourStep } from '@/lib/officeTour';

/** Desktop coach panel — sidebar stays visible; main content dimmed by Layout. */
export default function OfficeTourDesktop({ step, steps, onStepChange, onClose }) {
  const script = steps?.length ? steps : OFFICE_TOUR_STEPS;
  const total = script.length;
  const index = clampTourStep(step, total);
  const current = script[index];
  const last = index === total - 1;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed z-[110] bottom-4 left-3 right-3 sm:left-auto sm:right-6 sm:max-w-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="office-tour-title"
    >
      <div className="bg-white rounded-xl shadow-xl border border-slate-200/80 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-9 h-9 rounded-lg bg-[#F5A623] flex items-center justify-center shrink-0">
              <HelpCircle className="w-5 h-5 text-[#0A2B4E]" />
            </span>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Ghid · {index + 1} / {total}
            </p>
          </div>
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-[#0A2B4E] shrink-0"
            onClick={onClose}
          >
            Sari peste
          </button>
        </div>

        {current.hint ? (
          <p className="mt-3 text-xs font-medium text-[#1D4E89] bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 leading-relaxed">
            {current.hint}
          </p>
        ) : null}

        <h2 id="office-tour-title" className="text-lg font-semibold text-[#0A2B4E] mt-4 tracking-tight">
          {current.title}
        </h2>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">{current.body}</p>

        {current.demo ? (
          <p className="mt-3 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Pagină etichetată demo în meniu.
          </p>
        ) : null}

        <div className="flex items-center justify-center gap-1.5 mt-6" aria-hidden="true">
          {script.map((s, i) => (
            <span
              key={s.id}
              className={
                i === index
                  ? 'h-1.5 w-5 rounded-full bg-[#0A2B4E]'
                  : 'h-1.5 w-1.5 rounded-full bg-slate-300'
              }
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 mt-5">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onStepChange(clampTourStep(index - 1, total))}
            className="inline-flex h-10 items-center gap-1 px-3 text-sm border border-slate-200 rounded-lg disabled:opacity-40"
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
            className="inline-flex h-10 items-center gap-1 px-4 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89]"
          >
            {last ? 'Am înțeles' : 'Următorul'}
            {last ? null : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

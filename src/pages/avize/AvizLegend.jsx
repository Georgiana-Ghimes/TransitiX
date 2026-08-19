import React from 'react';
import { HelpCircle } from 'lucide-react';

export default function AvizLegend({ title, items }) {
  return (
    <details className="bg-sky-50/80 rounded-xl border border-sky-100 group" open>
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[#0A2B4E] flex items-center justify-between gap-2 list-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 min-w-0">
          <HelpCircle className="w-4 h-4 text-sky-700 shrink-0" />
          <span className="truncate">{title}</span>
        </span>
        <span className="text-xs font-normal text-sky-800/70 shrink-0 group-open:hidden">Arată</span>
        <span className="text-xs font-normal text-sky-800/70 shrink-0 hidden group-open:inline">Ascunde</span>
      </summary>
      <dl className="grid gap-3 sm:grid-cols-2 px-4 pb-4 pt-1 border-t border-sky-100/80">
        {items.map((item) => (
          <div key={item.name} className="min-w-0">
            <dt className="text-xs font-semibold text-[#0A2B4E]">{item.name}</dt>
            <dd className="text-xs text-slate-600 mt-0.5 leading-relaxed">{item.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

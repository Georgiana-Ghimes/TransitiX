import React from 'react';
import { Check, FileSpreadsheet, Plus } from 'lucide-react';
import AvizLegend from './AvizLegend';
import { TEMPLATE_ACTION_LEGEND, inputCls, isLockedRai } from './avizeUi';

export default function AvizTemplatesTab({
  templates, obsCodes, newCode, setNewCode,
  onNewTemplate, onEdit, onDelete, onAddCode, onDeleteCode,
  activeTemplateId, onUseForExport,
}) {
  return (
    <div className="space-y-4">
      <AvizLegend title="Legendă șabloane" items={TEMPLATE_ACTION_LEGEND} />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNewTemplate}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89]"
        >
          <Plus className="w-4 h-4" /> Șablon nou
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((t) => {
          const active = t.id === activeTemplateId;
          const columnCount = Array.isArray(t.columns) ? t.columns.length : 0;
          return (
            <div
              key={t.id}
              className={`bg-white rounded-xl border shadow-sm p-4 ${active ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-slate-200/80'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-[#0A2B4E]">{t.name}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {columnCount} coloane
                    {t.is_default ? ' · implicit' : ''}
                    {isLockedRai(t) ? ' · blocat' : ''}
                  </p>
                </div>
                <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
              </div>
              {active ? (
                <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1">
                  <Check className="w-3.5 h-3.5" /> Folosit la export
                </p>
              ) : (
                <button
                  type="button"
                  className="mt-3 text-xs font-medium text-emerald-700 border border-emerald-200 rounded-full px-2.5 py-1 hover:bg-emerald-50"
                  onClick={() => onUseForExport?.(t.id)}
                >
                  Folosește la export
                </button>
              )}
              <div className="flex gap-3 mt-4 text-xs">
                {isLockedRai(t) ? (
                  <span className="text-slate-400">Nu se poate modifica</span>
                ) : (
                  <>
                    <button type="button" className="text-[#1D4E89]" onClick={() => onEdit({ ...t, columns: t.columns || [] })}>Editează</button>
                    <button type="button" className="text-red-500" onClick={() => onDelete(t)}>Șterge</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="bg-white rounded-xl border border-slate-200/80 p-4">
        <p className="text-sm font-medium text-[#0A2B4E] mb-2">Coduri observații</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {obsCodes.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-100">
              {c.code}
              <button type="button" className="text-red-500" onClick={() => onDeleteCode(c)} aria-label={`Șterge ${c.code}`}>×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input className={inputCls} value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="ex. Z:B*" />
          <button type="button" className="px-3 py-2 text-sm border rounded-lg" onClick={onAddCode}>Adaugă</button>
        </div>
      </div>
    </div>
  );
}

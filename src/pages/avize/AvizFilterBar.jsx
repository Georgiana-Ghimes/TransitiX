import React from 'react';
import { inputCls, labelCls } from './avizeUi';

export default function AvizFilterBar({
  filters,
  setFilters,
  qInput,
  setQInput,
  onPreset,
  onReset,
  activePreset,
  refreshing,
}) {
  const presetBtnClass = (id) => {
    const isActive = Boolean(activePreset) && activePreset === id;
    if (isActive) return 'px-2.5 py-1 text-xs rounded-full border border-[#0A2B4E] bg-[#0A2B4E] text-white';
    return 'px-2.5 py-1 text-xs rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700';
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 bg-white rounded-xl border border-slate-200/80 p-3">
      <div className="flex flex-wrap gap-1 lg:col-span-6">
        {[['today', 'Azi'], ['week', 'Săptămâna asta'], ['month', 'Luna asta']].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onPreset(id)}
            className={presetBtnClass(id)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onReset?.()}
          className="px-2.5 py-1 text-xs rounded-full text-slate-500 hover:underline"
        >
          Resetează
        </button>
        {refreshing && <span className="text-xs text-slate-500 self-center">Se actualizează lista…</span>}
      </div>
      <div>
        <label className={labelCls}>De la</label>
        <input className={inputCls} type="date" value={filters.from} onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))} />
      </div>
      <div>
        <label className={labelCls}>Până la</label>
        <input className={inputCls} type="date" value={filters.to} onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))} />
      </div>
      <div>
        <label className={labelCls}>Status</label>
        <select className={inputCls} value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
          <option value="">Toate</option>
          <option value="uploaded">Încărcat</option>
          <option value="extracted">Extras</option>
          <option value="confirmed">Confirmat</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Proveniență</label>
        <select
          className={inputCls}
          value={filters.uploaded_from || ''}
          onChange={(e) => setFilters((p) => ({ ...p, uploaded_from: e.target.value }))}
        >
          <option value="">Toate</option>
          <option value="driver">De la șofer</option>
          <option value="office">Din birou</option>
        </select>
      </div>
      <div className="sm:col-span-2 lg:col-span-2">
        <label className={labelCls}>Caută TPO / auto / document / fișier</label>
        <input
          className={inputCls}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="TPO-00…"
        />
      </div>
    </div>
  );
}

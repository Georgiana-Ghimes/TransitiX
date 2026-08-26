/**
 * The trail, read.
 *
 * Grouped by day rather than shown as a flat table: the question people actually arrive with is
 * "what happened around the time this went wrong", and a wall of identical timestamps answers it
 * badly. Each entry opens to show the fields that moved, because the summary line is the index
 * and the diff is the answer.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown, ChevronRight, History, Info, Loader2, RefreshCw, Search,
} from 'lucide-react';
import { api } from '@/api/client';
import { notifyError } from '@/lib/notify';
import {
  actionMeta,
  changeRows,
  entityLabel,
  formatDay,
  formatTime,
  formatValue,
  groupByDay,
} from '@/lib/auditUi';

const PAGE_SIZE = 50;

function ActionBadge({ action }) {
  const meta = actionMeta(action);
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${meta.badge}`}>
      {meta.label}
    </span>
  );
}

/** The fields that moved, from → to. */
function Changes({ event }) {
  const rows = changeRows(event);
  if (rows.length === 0) {
    return <p className="text-[12px] text-slate-400 px-4 py-2">Fără detalii pe câmpuri.</p>;
  }
  return (
    <div className="px-4 py-2 overflow-x-auto">
      <table className="text-[12px] w-full">
        <tbody>
          {rows.map((row) => (
            <tr key={row.field} className="align-top">
              <td className="py-1 pr-4 text-slate-500 whitespace-nowrap">{row.label}</td>
              {row.paired ? (
                <>
                  <td className="py-1 pr-2 text-slate-400 line-through tabular-nums">
                    {formatValue(row.from)}
                  </td>
                  <td className="py-1 pr-2 text-slate-300">→</td>
                  <td className="py-1 text-slate-700 font-medium tabular-nums">
                    {formatValue(row.to)}
                  </td>
                </>
              ) : (
                <td className="py-1 text-slate-700 tabular-nums" colSpan={3}>
                  {formatValue(row.to)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventRow({ event }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  const hasDetail = changeRows(event).length > 0 || event.detail;

  return (
    <li className="border-t border-slate-100 first:border-t-0">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`w-full flex items-start gap-3 px-4 py-2.5 text-left ${hasDetail ? 'hover:bg-slate-50' : 'cursor-default'}`}
      >
        <span className="text-[11px] text-slate-400 tabular-nums w-11 shrink-0 mt-0.5">
          {formatTime(event.created_at)}
        </span>
        {hasDetail
          ? <Chevron className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          : <span className="w-4 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <ActionBadge action={event.action} />
            <span className="text-[12px] text-slate-500">{entityLabel(event.entity)}</span>
            {event.label && (
              <span className="text-sm font-medium text-[#0A2B4E] truncate">{event.label}</span>
            )}
          </span>
          <span className="block text-[12px] text-slate-500 mt-0.5 truncate">
            {event.user.name || event.user.email || 'Utilizator șters'}
            {event.user.role ? ` · ${event.user.role}` : ''}
            {event.ip ? ` · ${event.ip}` : ''}
          </span>
        </span>
      </button>
      {open && (
        <div className="bg-slate-50/70 border-t border-slate-100">
          <Changes event={event} />
          {event.detail && (
            <pre className="text-[11px] text-slate-500 px-4 pb-2 whitespace-pre-wrap break-all">
              {JSON.stringify(event.detail)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

/** What the log does not cover, and why — so a gap reads as a decision, not a bug. */
function Coverage({ meta }) {
  const [open, setOpen] = useState(false);
  if (!meta) return null;
  const notAudited = Object.entries(meta.not_audited || {});
  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-50"
      >
        <Info className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="text-sm text-slate-600 flex-1">Ce se înregistrează și ce nu</span>
        {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 grid gap-4 md:grid-cols-2 text-[12px]">
          <div>
            <p className="font-medium text-slate-600 mb-1">Se înregistrează</p>
            <ul className="space-y-1">
              {Object.entries(meta.audited || {}).map(([entity, reason]) => (
                <li key={entity} className="text-slate-500">
                  <span className="text-slate-700">{entityLabel(entity)}</span> — {reason}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium text-slate-600 mb-1">Nu se înregistrează, intenționat</p>
            <ul className="space-y-1">
              {notAudited.map(([entity, reason]) => (
                <li key={entity} className="text-slate-500">
                  <span className="text-slate-700">{entityLabel(entity)}</span> — {reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Audit() {
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState(null);
  const [filters, setFilters] = useState({ entity: '', action: '', user_id: '', q: '', from: '', to: '' });

  const load = useCallback(async (nextOffset = 0, append = false) => {
    setLoading(true);
    try {
      const res = await api.audit.list({ ...filters, limit: PAGE_SIZE, offset: nextOffset });
      setEvents((prev) => (append ? [...prev, ...res.events] : res.events));
      setTotal(res.total);
      setOffset(nextOffset);
    } catch (err) {
      notifyError(err.message || 'Jurnalul nu a putut fi încărcat');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(0, false); }, [load]);

  useEffect(() => {
    api.audit.meta().then(setMeta).catch(() => setMeta(null));
  }, []);

  const days = useMemo(() => groupByDay(events), [events]);
  const set = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const hasMore = events.length < total;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <header className="flex flex-wrap items-center gap-3">
        <History className="w-6 h-6 text-[#1D4E89]" />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-[#0A2B4E]">Jurnal modificări</h1>
          <p className="text-[12px] text-slate-500">
            Cine ce a schimbat. Valorile sensibile nu se salvează niciodată aici.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(0, false)}
          disabled={loading}
          className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-white inline-flex items-center gap-2 disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Reîncarcă
        </button>
      </header>

      <div className="bg-white rounded-xl border border-slate-200 p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <label className="relative lg:col-span-2">
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={filters.q}
            onChange={set('q')}
            placeholder="Caută după nume sau utilizator"
            className="w-full text-sm pl-8 pr-2 py-2 rounded-lg border border-slate-200"
          />
        </label>
        <select value={filters.entity} onChange={set('entity')} className="text-sm px-2 py-2 rounded-lg border border-slate-200">
          <option value="">Toate tipurile</option>
          {(meta?.present || []).map((row) => (
            <option key={row.entity} value={row.entity}>{entityLabel(row.entity)} ({row.c})</option>
          ))}
        </select>
        <select value={filters.action} onChange={set('action')} className="text-sm px-2 py-2 rounded-lg border border-slate-200">
          <option value="">Toate acțiunile</option>
          {['create', 'update', 'delete', 'login', 'login_failed', 'logout', 'sessions_revoked'].map((a) => (
            <option key={a} value={a}>{actionMeta(a).label}</option>
          ))}
        </select>
        <select value={filters.user_id} onChange={set('user_id')} className="text-sm px-2 py-2 rounded-lg border border-slate-200">
          <option value="">Toți utilizatorii</option>
          {(meta?.users || []).map((u) => (
            <option key={u.id} value={u.id}>{u.name || u.email}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <input type="date" value={filters.from} onChange={set('from')} className="text-sm px-2 py-2 rounded-lg border border-slate-200 w-full" />
          <input type="date" value={filters.to} onChange={set('to')} className="text-sm px-2 py-2 rounded-lg border border-slate-200 w-full" />
        </div>
      </div>

      <Coverage meta={meta} />

      {loading && events.length === 0 ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Se încarcă…
        </div>
      ) : days.length === 0 ? (
        <p className="text-sm text-slate-500 bg-white rounded-xl border border-slate-200 px-4 py-10 text-center">
          Nicio înregistrare pentru filtrele alese.
        </p>
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <section key={day.day} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <h2 className="text-[12px] font-medium text-slate-500 px-4 py-2 bg-slate-50 border-b border-slate-100">
                {formatDay(day.day)}
              </h2>
              <ul>
                {day.events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => load(offset + PAGE_SIZE, true)}
            disabled={loading}
            className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40"
          >
            Încarcă încă {Math.min(PAGE_SIZE, total - events.length)} din {total}
          </button>
        </div>
      )}
    </div>
  );
}

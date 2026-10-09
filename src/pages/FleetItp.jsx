/**
 * Companion Flotă → ITP: expiry board + quick edit (number + date).
 * Autoturisme stays on MTMA; this screen owns document dates.
 * Periodicity: RNTR 1 — companion default transport marfă = +1 an.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, CalendarClock, Pencil, X, Check, Search, RefreshCw } from 'lucide-react';
import { api } from '@/api/client';
import RoDateField from '@/components/RoDateField';
import { notifyError, notifySuccess } from '@/lib/notify';
import { expiryHorizonDays } from '@/lib/documentExpiry';
import { toDateIso } from '@/lib/utils';
import {
  filterItpVehicles,
  itpStatusFor,
  summariseItpFleet,
} from '@/lib/fleetItpUi';
import { nextItpExpiry, rollItpExpiry } from '@/lib/itpSchedule';

const cardCls = 'bg-white rounded-xl border border-slate-200/80 shadow-sm';
const inputCls = 'w-full h-10 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4E89]/30';

const FILTERS = [
  { key: 'all', label: 'Toate' },
  { key: 'expired', label: 'Expirate' },
  { key: 'soon', label: 'Expiră curând' },
  { key: 'missing', label: 'Fără dată' },
];

const STATUS_TONE = {
  expired: 'bg-red-50 text-red-800 border-red-200',
  soon: 'bg-amber-50 text-amber-900 border-amber-200',
  missing: 'bg-slate-100 text-slate-700 border-slate-200',
  ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

function formatRo(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return '—';
  return `${d}.${m}.${y}`;
}

function intervalHint(months) {
  if (months === 6) return 'la 6 luni';
  if (months === 24) return 'la 2 ani';
  if (months === 12) return 'la 1 an';
  return `la ${months} luni`;
}

export default function FleetItp() {
  const [vehicles, setVehicles] = useState([]);
  const [horizonDays, setHorizonDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ itp_number: '', itp_expiry: '' });
  const [saving, setSaving] = useState(false);

  const now = useMemo(() => new Date(), []);
  const opts = useMemo(() => ({ now, horizonDays }), [now, horizonDays]);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [fleetPage, company] = await Promise.all([
        api.fleet.list({ limit: 500, offset: 0 }),
        api.company.get().catch(() => null),
      ]);
      const items = Array.isArray(fleetPage?.items) ? fleetPage.items : (Array.isArray(fleetPage) ? fleetPage : []);
      setVehicles(items);
      setHorizonDays(expiryHorizonDays(company));
    } catch (err) {
      notifyError('Lista ITP nu a putut fi încărcată', err);
    } finally {
      setLoading(false);
    }
  };

  const summary = useMemo(() => summariseItpFleet(vehicles, opts), [vehicles, opts]);

  const rows = useMemo(() => {
    let list = filterItpVehicles(vehicles, filter, opts);
    const term = q.trim().toLowerCase();
    if (term) {
      list = list.filter((v) => String(v.plate || '').toLowerCase().includes(term));
    }
    return [...list].sort((a, b) => {
      const sa = itpStatusFor(a.itp_expiry, opts);
      const sb = itpStatusFor(b.itp_expiry, opts);
      const rank = { expired: 0, soon: 1, missing: 2, ok: 3 };
      const d = (rank[sa.status] ?? 9) - (rank[sb.status] ?? 9);
      if (d !== 0) return d;
      return String(a.plate || '').localeCompare(String(b.plate || ''), 'ro');
    });
  }, [vehicles, filter, q, opts]);

  const openEdit = (v) => {
    setEditing(v);
    setForm({
      itp_number: v.itp_number || '',
      itp_expiry: toDateIso(v.itp_expiry) || '',
    });
  };

  const proposedAfterForm = useMemo(() => {
    if (!editing) return null;
    const from = form.itp_expiry || null;
    if (!from) return nextItpExpiry(editing, null);
    return nextItpExpiry(editing, from);
  }, [editing, form.itp_expiry]);

  const applyRoll = () => {
    if (!editing) return;
    const rolled = rollItpExpiry({ ...editing, itp_expiry: form.itp_expiry || editing.itp_expiry });
    if (!rolled.iso) return;
    setForm((p) => ({ ...p, itp_expiry: rolled.iso }));
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await api.entities.Vehicle.update(editing.id, {
        itp_number: String(form.itp_number || '').trim() || null,
        itp_expiry: form.itp_expiry || null,
      });
      setVehicles((prev) => prev.map((v) => (v.id === editing.id ? { ...v, ...updated } : v)));
      notifySuccess('ITP salvat', editing.plate || 'Vehicul');
      setEditing(null);
    } catch (err) {
      notifyError('ITP nu a putut fi salvat', err);
    } finally {
      setSaving(false);
    }
  };

  const saveRolled = async () => {
    if (!editing) return;
    const rolled = rollItpExpiry({ ...editing, itp_expiry: form.itp_expiry || editing.itp_expiry });
    if (!rolled.iso) {
      notifyError('Nu pot derula ITP', new Error('Lipsește data de pornire'));
      return;
    }
    setSaving(true);
    try {
      const updated = await api.entities.Vehicle.update(editing.id, {
        itp_number: String(form.itp_number || '').trim() || null,
        itp_expiry: rolled.iso,
      });
      setVehicles((prev) => prev.map((v) => (v.id === editing.id ? { ...v, ...updated } : v)));
      notifySuccess(
        `ITP derulat ${intervalHint(rolled.months)}`,
        `${editing.plate || 'Vehicul'} → ${formatRo(rolled.iso)}`,
      );
      setEditing(null);
    } catch (err) {
      notifyError('ITP nu a putut fi derulat', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#0A2B4E] flex items-center gap-2">
            <CalendarClock className="w-6 h-6" />
            ITP
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Expirări pe flota activă. Implicit transport marfă: următoarea = expirare + 1 an (RNTR 1).
            Orizont alerte: {horizonDays} zile
            {' · '}
            <Link to="/fleet" className="text-[#1D4E89] hover:underline">Autoturisme (MTMA)</Link>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { key: 'expired', label: 'Expirate', n: summary.expired, tone: 'text-red-700' },
          { key: 'soon', label: 'Expiră curând', n: summary.soon, tone: 'text-amber-800' },
          { key: 'missing', label: 'Fără dată', n: summary.missing, tone: 'text-slate-700' },
          { key: 'ok', label: 'OK', n: summary.ok, tone: 'text-emerald-800' },
        ].map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => setFilter(k.key === filter ? 'all' : k.key)}
            className={`${cardCls} px-3 py-2.5 text-left hover:border-[#1D4E89]/40 ${filter === k.key ? 'ring-2 ring-[#1D4E89]/30' : ''}`}
          >
            <p className="text-[11px] text-slate-500 uppercase tracking-wide">{k.label}</p>
            <p className={`text-xl font-semibold tabular-nums ${k.tone}`}>{k.n}</p>
          </button>
        ))}
      </div>

      <div className={`${cardCls} p-3 flex flex-col sm:flex-row gap-2 sm:items-center`}>
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Caută după plăcuță…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`text-xs px-2.5 py-1.5 rounded-full border ${
                filter === f.key
                  ? 'bg-[#0A2B4E] text-white border-[#0A2B4E]'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Se încarcă…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">Niciun vehicul pe acest filtru.</p>
        ) : (
          <>
            <div className="md:hidden divide-y divide-slate-100">
              {rows.map((v) => {
                const st = itpStatusFor(v.itp_expiry, opts);
                const nxt = nextItpExpiry(v, v.itp_expiry);
                return (
                  <div key={v.id} className="p-3 flex gap-3 items-start">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[#0A2B4E] truncate">{v.plate || '—'}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Nr. {v.itp_number || '—'} · expiră {formatRo(toDateIso(v.itp_expiry))}
                      </p>
                      {nxt.iso ? (
                        <p className="text-xs text-slate-500 mt-0.5">
                          Apoi (est.): {formatRo(nxt.iso)} · {intervalHint(nxt.months)}
                        </p>
                      ) : null}
                      <span className={`inline-block mt-1.5 text-[11px] px-2 py-0.5 rounded-full border ${STATUS_TONE[st.status]}`}>
                        {st.label}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                      onClick={() => openEdit(v)}
                      aria-label={`Editează ITP ${v.plate || ''}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-4 py-2.5 font-medium">Plăcuță</th>
                    <th className="px-4 py-2.5 font-medium">Nr. ITP</th>
                    <th className="px-4 py-2.5 font-medium">Expirare</th>
                    <th className="px-4 py-2.5 font-medium">Următoarea (est.)</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium w-20" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((v) => {
                    const st = itpStatusFor(v.itp_expiry, opts);
                    const nxt = nextItpExpiry(v, v.itp_expiry);
                    return (
                      <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50/80">
                        <td className="px-4 py-2.5 font-medium text-[#0A2B4E]">{v.plate || '—'}</td>
                        <td className="px-4 py-2.5 text-slate-700">{v.itp_number || '—'}</td>
                        <td className="px-4 py-2.5 tabular-nums">{formatRo(toDateIso(v.itp_expiry))}</td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {nxt.iso ? (
                            <span className="tabular-nums">
                              {formatRo(nxt.iso)}
                              <span className="text-[11px] text-slate-400 ml-1.5">{intervalHint(nxt.months)}</span>
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${STATUS_TONE[st.status]}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs text-[#1D4E89] hover:underline"
                            onClick={() => openEdit(v)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Editează
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Închide"
            onClick={() => !saving && setEditing(null)}
          />
          <div className={`${cardCls} relative w-full sm:max-w-md p-5 space-y-3`}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[#0A2B4E]">
                ITP · {editing.plate || 'Vehicul'}
              </h2>
              <button type="button" disabled={saving} onClick={() => setEditing(null)} aria-label="Închide">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              {proposedAfterForm?.label || 'Transport marfă (1 an)'}.
              Data de pe talon rămâne referința — poți corecta manual.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Număr ITP</label>
              <input
                className={inputCls}
                value={form.itp_number}
                onChange={(e) => setForm((p) => ({ ...p, itp_number: e.target.value }))}
                placeholder="opțional"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Expirare ITP (valabil până la)</label>
              <RoDateField
                className={inputCls}
                value={form.itp_expiry}
                onChange={(iso) => setForm((p) => ({ ...p, itp_expiry: iso || '' }))}
                aria-label="Expirare ITP"
              />
            </div>
            {proposedAfterForm?.iso ? (
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs text-slate-600">
                După această expirare, următoarea estimată:{' '}
                <strong className="text-[#0A2B4E]">{formatRo(proposedAfterForm.iso)}</strong>
                {' '}({intervalHint(proposedAfterForm.months)})
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Introdu o dată o singură dată — sistemul calculează următoarea ({intervalHint(proposedAfterForm?.months || 12)}).
              </p>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={applyRoll}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className="w-4 h-4" />
              Completează derulare ({intervalHint(proposedAfterForm?.months || 12)}) în câmp
            </button>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
              <button
                type="button"
                className="px-3 py-2 text-sm border rounded-lg"
                disabled={saving}
                onClick={() => setEditing(null)}
              >
                Anulează
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={saveRolled}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium border border-[#0A2B4E] text-[#0A2B4E] rounded-lg hover:bg-slate-50 disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                ITP făcut — derulează și salvează
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={save}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Salvează
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

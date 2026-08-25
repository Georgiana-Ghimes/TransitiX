import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Brain, Check, Loader2, Play, Trash2, Upload, AlertTriangle, Coffee, Moon,
} from 'lucide-react';
import { api } from '@/api/client';
import { notifyError, notifySuccess } from '@/lib/notify';
import {
  compareScenarioKpis,
  formatHours,
  formatKm,
  formatLei,
  scenarioStatusLabel,
  todayIso,
} from '@/lib/planningUi';

function HealthPill({ label, ok, configured, message }) {
  const tone = !configured ? 'slate' : ok ? 'emerald' : 'amber';
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border ${colors[tone]}`}
      title={message || undefined}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : configured ? 'bg-amber-500' : 'bg-slate-400'}`} />
      {label}
      {!configured ? ' — neconfigurat' : ok ? ' — ok' : ' — indisponibil'}
    </span>
  );
}

export default function PlanningAI() {
  const [date, setDate] = useState(todayIso);
  const [health, setHealth] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [ordersCount, setOrdersCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async (forDate = date) => {
    setLoading(true);
    try {
      const [h, list, orders] = await Promise.all([
        api.planning.health().catch(() => null),
        api.planning.scenarios(forDate).catch(() => []),
        api.entities.Order.filter({ requested_date: forDate }, '-created_date', 500)
          .then((rows) => rows.filter((o) => ['nou', 'planificat'].includes(o.status)))
          .catch(() => []),
      ]);
      setHealth(h);
      setScenarios(list);
      setOrdersCount(Array.isArray(orders) ? orders.length : null);
    } catch (err) {
      notifyError('Nu am putut încărca scenariile', err);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(date); }, [date, load]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    api.planning.scenario(selectedId)
      .then((row) => { if (!cancelled) setDetail(row); })
      .catch((err) => {
        if (!cancelled) notifyError('Nu am putut încărca scenariul', err);
      });
    return () => { cancelled = true; };
  }, [selectedId]);

  const run = async () => {
    setBusy('solve');
    try {
      const row = await api.planning.solve({ routeDate: date });
      notifySuccess(
        row.status === 'rulat' ? 'Scenariu rulat' : 'Scenariu salvat',
        row.status === 'esuat'
          ? row.error_message
          : `${row.kpis?.routes ?? 0} rute · ${formatKm(row.kpis?.distance_km)}`
      );
      setSelectedId(row.id);
      await load(date);
    } catch (err) {
      notifyError('Optimizarea a eșuat', err);
    } finally {
      setBusy(null);
    }
  };

  const promote = async (id) => {
    setBusy(`promote-${id}`);
    try {
      const result = await api.planning.promote(id);
      notifySuccess(
        'Scenariu promovat în plan',
        `${result.routes?.length ?? 0} rute pe ${result.route_date}`
      );
      await load(date);
      setSelectedId(id);
    } catch (err) {
      notifyError('Promovarea a eșuat', err);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id) => {
    setBusy(`del-${id}`);
    try {
      await api.planning.deleteScenario(id);
      if (selectedId === id) setSelectedId(null);
      await load(date);
    } catch (err) {
      notifyError('Ștergerea a eșuat', err);
    } finally {
      setBusy(null);
    }
  };

  const comparison = compareScenarioKpis(scenarios.filter((s) => s.status === 'rulat' || s.status === 'promovat'));
  const ready = health?.configured && health?.ok;

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight flex items-center gap-2">
            <Brain className="w-6 h-6 text-[#F5A623]" /> Optimizare rute
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Rulează scenarii pe comenzile zilei, compară-le, apoi promovează unul în planul de dispecerat.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89]"
          />
          <button
            type="button"
            onClick={run}
            disabled={Boolean(busy) || !ready}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-50"
          >
            {busy === 'solve'
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Optimizez…</>
              : <><Play className="w-4 h-4" /> Rulează scenariu</>}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <HealthPill
          label="Rutare"
          configured={health?.routing?.configured}
          ok={health?.routing?.ok}
          message={health?.routing?.message}
        />
        <HealthPill
          label="Optimizator"
          configured={health?.solver?.configured}
          ok={health?.solver?.ok}
          message={health?.solver?.message}
        />
        {ordersCount != null && (
          <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600">
            {ordersCount} comenzi deschise
          </span>
        )}
        <Link
          to="/dispatch"
          className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 bg-white text-[#1D4E89] hover:bg-slate-50"
        >
          Deschide dispeceratul
        </Link>
      </div>

      {!ready && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Optimizatorul nu e gata de rulare</p>
            <p className="text-amber-800/90 mt-0.5">
              Pornește OSRM și VROOM (vezi <code className="text-xs">docker-compose.osrm.yml</code> și
              {' '}<code className="text-xs">docker-compose.vroom.yml</code>), apoi setează
              {' '}<code className="text-xs">OSRM_URL</code> și <code className="text-xs">VROOM_URL</code> în
              {' '}<code className="text-xs">server/.env</code>.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 text-[#0A2B4E] animate-spin" />
        </div>
      ) : (
        <>
          {comparison.length > 1 && (
            <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-[#0A2B4E]">Comparație scenarii</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[640px] w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Scenariu</th>
                      <th className="px-4 py-2 font-medium">Rute</th>
                      <th className="px-4 py-2 font-medium">Distanță</th>
                      <th className="px-4 py-2 font-medium">Durată</th>
                      <th className="px-4 py-2 font-medium">Cost</th>
                      <th className="px-4 py-2 font-medium">Nealocate</th>
                      <th className="px-4 py-2 font-medium">561/2006</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.map((row) => (
                      <tr
                        key={row.id}
                        className={`border-t border-slate-100 ${row.is_committed ? 'bg-emerald-50/40' : ''}`}
                      >
                        <td className="px-4 py-2.5 font-medium text-[#0A2B4E]">
                          {row.name}
                          {row.is_committed && (
                            <span className="ml-2 text-xs text-emerald-700">în plan</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">{row.routes ?? '—'}</td>
                        <td className="px-4 py-2.5">{formatKm(row.distance_km)}</td>
                        <td className="px-4 py-2.5">{formatHours(row.duration_min)}</td>
                        <td className="px-4 py-2.5">{formatLei(row.cost)}</td>
                        <td className="px-4 py-2.5">{row.unassigned ?? '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          {(row.breaks_inserted || 0) > 0 && (
                            <span className="inline-flex items-center gap-1 mr-2">
                              <Coffee className="w-3.5 h-3.5" /> {row.breaks_inserted} pauze
                            </span>
                          )}
                          {(row.rests_inserted || 0) > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Moon className="w-3.5 h-3.5" /> {row.rests_inserted} repaus
                            </span>
                          )}
                          {!row.breaks_inserted && !row.rests_inserted && '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-2 space-y-3">
              <h2 className="text-sm font-semibold text-[#0A2B4E]">Scenarii · {date}</h2>
              {scenarios.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200/80 p-8 text-center text-slate-400 shadow-sm">
                  <Brain className="w-9 h-9 mx-auto mb-2 opacity-40" />
                  <p className="text-sm text-slate-500">Niciun scenariu pentru această zi</p>
                  <p className="text-xs mt-1">Rulează unul pe comenzile deschise</p>
                </div>
              ) : scenarios.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full text-left bg-white rounded-xl border shadow-sm p-4 transition-colors ${
                    selectedId === s.id ? 'border-[#1D4E89] ring-1 ring-[#1D4E89]/40' : 'border-slate-200/80 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#0A2B4E] truncate">{s.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {scenarioStatusLabel(s.status)}
                        {s.kpis?.routes != null && ` · ${s.kpis.routes} rute`}
                        {s.kpis?.distance_km != null && ` · ${formatKm(s.kpis.distance_km)}`}
                      </p>
                    </div>
                    {s.is_committed && (
                      <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <Check className="w-3 h-3" /> Plan
                      </span>
                    )}
                  </div>
                  {s.status === 'esuat' && s.error_message && (
                    <p className="text-xs text-red-600 mt-2 line-clamp-2">{s.error_message}</p>
                  )}
                </button>
              ))}
            </div>

            <div className="lg:col-span-3">
              {!selectedId || !detail ? (
                <div className="bg-white rounded-xl border border-slate-200/80 p-10 text-center text-slate-400 shadow-sm h-full min-h-[220px] flex flex-col items-center justify-center">
                  <p className="text-sm text-slate-500">Selectează un scenariu pentru detalii</p>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-[#0A2B4E]">{detail.name}</h2>
                      <p className="text-xs text-slate-500 mt-0.5">{scenarioStatusLabel(detail.status)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(detail.status === 'rulat' || detail.status === 'promovat') && !detail.is_committed && (
                        <button
                          type="button"
                          onClick={() => promote(detail.id)}
                          disabled={Boolean(busy)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#27AE60] rounded-lg hover:bg-emerald-600 disabled:opacity-50"
                        >
                          {busy === `promote-${detail.id}`
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Upload className="w-3.5 h-3.5" />}
                          Promovează în plan
                        </button>
                      )}
                      {!detail.is_committed && (
                        <button
                          type="button"
                          onClick={() => remove(detail.id)}
                          disabled={Boolean(busy)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50"
                        >
                          {busy === `del-${detail.id}`
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                          Șterge
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-slate-100">
                    {[
                      { label: 'Rute', value: detail.kpis?.routes ?? '—' },
                      { label: 'Distanță', value: formatKm(detail.kpis?.distance_km) },
                      { label: 'Durată', value: formatHours(detail.kpis?.duration_min) },
                      { label: 'Nealocate', value: detail.kpis?.unassigned ?? '—' },
                      { label: 'Cost', value: formatLei(detail.kpis?.cost) },
                      { label: 'Pauze 45′', value: detail.kpis?.breaks_inserted ?? 0 },
                      { label: 'Repaus zilnic', value: detail.kpis?.rests_inserted ?? 0 },
                      { label: 'Ferestre încălcate', value: detail.kpis?.window_violations ?? 0 },
                    ].map((kpi) => (
                      <div key={kpi.label} className="rounded-lg bg-slate-50 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">{kpi.label}</p>
                        <p className="text-sm font-semibold text-[#0A2B4E] mt-0.5">{kpi.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto">
                    {(detail.solution?.routes || []).length === 0 ? (
                      <p className="text-sm text-slate-500">Nicio rută în acest scenariu.</p>
                    ) : detail.solution.routes.map((route, idx) => (
                      <div key={`${route.vehicle_id}-${idx}`} className="rounded-lg border border-slate-100 p-3">
                        <p className="text-sm font-medium text-[#0A2B4E]">
                          Rută {idx + 1}
                          <span className="text-slate-500 font-normal">
                            {' · '}{formatKm(route.distance_km)} · {formatHours(route.duration_min)}
                            {(route.breaks_inserted || 0) > 0 && ` · ${route.breaks_inserted} pauze`}
                            {(route.rests_inserted || 0) > 0 && ` · ${route.rests_inserted} repaus`}
                          </span>
                        </p>
                        <ol className="mt-2 space-y-1 text-xs text-slate-600">
                          {(route.stops || []).map((stop) => (
                            <li key={stop.seq} className="flex gap-2">
                              <span className="text-slate-400 w-5 shrink-0">{stop.seq}.</span>
                              <span className="capitalize">{stop.kind.replace('_', ' ')}</span>
                              {stop.kind === 'pauza' && <Coffee className="w-3.5 h-3.5 text-amber-600" />}
                              {stop.kind === 'repaus' && <Moon className="w-3.5 h-3.5 text-indigo-600" />}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}

                    {(detail.solution?.unassigned || []).length > 0 && (
                      <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3">
                        <p className="text-xs font-medium text-amber-900 mb-1">Nealocate</p>
                        <ul className="text-xs text-amber-800 space-y-0.5">
                          {detail.solution.unassigned.map((u, i) => (
                            <li key={u.order_id || i}>
                              {u.order_number || u.order_id || 'comandă'} — {u.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

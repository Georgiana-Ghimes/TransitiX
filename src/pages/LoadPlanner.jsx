import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes, Loader2, Package, PackageX, Scale, Search, Truck, TriangleAlert,
} from 'lucide-react';
import { api } from '@/api/client';
import { notifyError } from '@/lib/notify';
import LoadingSideView from '@/components/LoadingSideView';
import TruckProfile from '@/components/TruckProfile';
import {
  filterVehicles,
  formatKg,
  formatMeters,
  formatPct,
  groupByStop,
  itemRows,
  loadWarnings,
  stopColor,
  vehicleModelLabel,
} from '@/lib/loadPlannerUi';

const STRATEGIES = [
  { key: 'lifo', label: 'Ordine șofer', hint: 'Ultima oprire se încarcă prima — se descarcă în ordinea livrării.' },
  { key: 'warehouse', label: 'Ordine depozit', hint: 'Grupat pe SKU și zonă de picking — mai rapid la încărcare.' },
];

function Panel({ title, icon: Icon, count, children, className = '' }) {
  return (
    <section className={`bg-white rounded-xl border border-slate-200/80 shadow-sm flex flex-col ${className}`}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        {Icon && <Icon className="w-4 h-4 text-slate-400" />}
        <h2 className="text-sm font-semibold text-[#0A2B4E]">{title}</h2>
        {count != null && (
          <span className="ml-auto text-xs font-medium text-slate-400 tabular-nums">{count}</span>
        )}
      </header>
      {children}
    </section>
  );
}

export default function LoadPlanner() {
  const [vehicles, setVehicles] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [plan, setPlan] = useState(null);
  const [strategy, setStrategy] = useState('lifo');
  const [segmentIndex, setSegmentIndex] = useState(null);
  const [loading, setLoading] = useState(true);
  const [packing, setPacking] = useState(false);

  useEffect(() => {
    api.loading.vehicles()
      .then((res) => setVehicles(res.vehicles || []))
      .catch((e) => notifyError('Nu am putut încărca flota', e))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => filterVehicles(vehicles, search), [vehicles, search]);

  const pickVehicle = useCallback(async (vehicle) => {
    setSelectedVehicle(vehicle);
    setPlan(null);
    setSelectedRouteId(null);
    setSegmentIndex(null);
    try {
      const res = await api.loading.vehicleRoutes(vehicle.id);
      setRoutes(res.routes || []);
    } catch (e) {
      setRoutes([]);
      notifyError('Nu am putut încărca rutele vehiculului', e);
    }
  }, []);

  const pack = useCallback(async (routeId, nextStrategy = strategy) => {
    setPacking(true);
    setSelectedRouteId(routeId);
    setSegmentIndex(null);
    try {
      setPlan(await api.loading.packRoute(routeId, { strategy: nextStrategy }));
    } catch (e) {
      setPlan(null);
      notifyError('Planul de încărcare a eșuat', e);
    } finally {
      setPacking(false);
    }
  }, [strategy]);

  const changeStrategy = (next) => {
    setStrategy(next);
    if (selectedRouteId) pack(selectedRouteId, next);
  };

  const placements = plan?.placements || [];
  const shownPlacements = useMemo(() => {
    if (segmentIndex == null || !plan?.segments) return placements;
    const segment = plan.segments[segmentIndex];
    if (!segment) return placements;
    // A pallet counts as being in the compartment if it overlaps it at all.
    return placements.filter((p) => p.x < segment.to_m && (p.x + p.length_m) > segment.from_m);
  }, [placements, plan, segmentIndex]);

  const stopGroups = useMemo(() => groupByStop(shownPlacements), [shownPlacements]);
  const rows = useMemo(() => itemRows(shownPlacements), [shownPlacements]);
  const warnings = useMemo(() => loadWarnings(plan), [plan]);
  const bay = plan?.bay || selectedVehicle?.bay || null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight flex items-center gap-2">
            <Boxes className="w-6 h-6 text-[#F5A623]" /> Plan de încărcare
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {selectedVehicle
              ? `${selectedVehicle.plate} · ${vehicleModelLabel(selectedVehicle)}`
              : 'Caută un vehicul după număr sau model'}
            {plan && ` · ${formatKg(plan.fill?.used_weight_kg)} · ${plan.fill?.placed_count} colete`}
          </p>
        </div>
        {selectedVehicle && (
          <div className="flex gap-1.5">
            {STRATEGIES.map((s) => (
              <button
                key={s.key}
                onClick={() => changeStrategy(s.key)}
                title={s.hint}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  strategy === s.key
                    ? 'bg-[#0A2B4E] text-white border-[#0A2B4E]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Fleet, searchable by model code */}
        <Panel title="Flotă" icon={Truck} count={visible.length} className="lg:col-span-3">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Număr, marcă, model sau șasiu"
                aria-label="Caută vehicul"
                className="w-full pl-8 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89]"
              />
            </div>
          </div>
          <div className="p-2 space-y-1 max-h-[240px] lg:max-h-[300px] overflow-y-auto">
            {visible.length ? visible.map((v) => (
              <button
                key={v.id}
                onClick={() => pickVehicle(v)}
                className={`w-full text-left p-2 rounded-lg transition-colors ${
                  selectedVehicle?.id === v.id ? 'bg-[#0A2B4E] text-white' : 'hover:bg-slate-50'
                }`}
              >
                <p className="text-sm font-medium truncate">{v.plate}</p>
                <p className={`text-xs truncate ${selectedVehicle?.id === v.id ? 'text-white/70' : 'text-slate-400'}`}>
                  {vehicleModelLabel(v)}
                  {v.bay?.assumed ? ' · dimensiuni presupuse' : ''}
                </p>
              </button>
            )) : (
              <p className="text-center py-8 text-xs text-slate-400">Niciun vehicul pe această căutare</p>
            )}
          </div>

          {selectedVehicle && (
            <div className="border-t border-slate-100 p-2">
              <p className="px-1 pb-1 text-[11px] font-medium text-slate-500">Rute cu acest vehicul</p>
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {routes.length ? routes.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => pack(r.id)}
                    className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors ${
                      selectedRouteId === r.id ? 'bg-sky-50 text-[#0A2B4E] font-medium' : 'hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    <span className="font-medium">{r.code}</span>
                    <span className="text-slate-400"> · {String(r.route_date).slice(0, 10)} · {r.stop_count} opriri</span>
                  </button>
                )) : (
                  <p className="px-2 py-3 text-xs text-slate-400">Nicio rută alocată acestui vehicul</p>
                )}
              </div>
            </div>
          )}
        </Panel>

        {/* Truck profile + side view */}
        <div className="lg:col-span-6 space-y-4">
          <Panel title="Profil vehicul" icon={Truck}>
            <div className="p-3">
              {packing ? (
                <div className="flex items-center justify-center h-40 text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Calculez încărcarea…
                </div>
              ) : plan ? (
                <>
                  <TruckProfile
                    segments={plan.segments || []}
                    bay={bay}
                    selectedIndex={segmentIndex}
                    onSelect={setSegmentIndex}
                  />
                  {segmentIndex != null && (
                    <p className="mt-2 text-xs text-[#1D4E89]">
                      Filtrat pe compartimentul {plan.segments[segmentIndex]?.label}.{' '}
                      <button onClick={() => setSegmentIndex(null)} className="underline">Arată tot</button>
                    </p>
                  )}
                  <LoadingSideView bay={bay} sideView={plan.side_view || []} className="mt-3" />
                </>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <Truck className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm font-medium text-slate-500">
                    {selectedVehicle ? 'Alege o rută ca să vezi încărcarea' : 'Alege un vehicul din listă'}
                  </p>
                </div>
              )}
            </div>

            {plan && (
              <div className="border-t border-slate-100 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <p className="text-slate-400">Umplere</p>
                  <p className="font-semibold text-slate-700 tabular-nums">{formatPct(plan.fill?.volume_pct)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <p className="text-slate-400">Greutate</p>
                  <p className="font-semibold text-slate-700 tabular-nums">{formatKg(plan.fill?.used_weight_kg)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <p className="text-slate-400">Axă față</p>
                  <p className="font-semibold text-slate-700 tabular-nums">{formatKg(plan.axle?.front_kg)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <p className="text-slate-400">Axă spate</p>
                  <p className="font-semibold text-slate-700 tabular-nums">{formatKg(plan.axle?.rear_kg)}</p>
                </div>
              </div>
            )}

            {plan?.balance && (
              <div className="border-t border-slate-100 px-3 py-2 flex items-center gap-3 flex-wrap text-xs">
                <Scale className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-500">
                  Șofer <strong className="text-slate-700 tabular-nums">{formatKg(plan.balance.driver_kg)}</strong>
                </span>
                <span className="text-slate-500">
                  Pasager <strong className="text-slate-700 tabular-nums">{formatKg(plan.balance.passenger_kg)}</strong>
                </span>
                <span className="text-slate-400">
                  diferență {formatKg(plan.balance.imbalance_kg)} ({formatPct(plan.balance.imbalance_pct)})
                </span>
                {bay && (
                  <span className="ml-auto text-slate-400">
                    cutie {formatMeters(bay.length_m)} × {formatMeters(bay.width_m)} × {formatMeters(bay.height_m)}
                  </span>
                )}
              </div>
            )}

            {warnings.map((w, i) => (
              <p
                key={i}
                className={`px-3 pb-2 flex items-start gap-1.5 text-[11px] ${
                  w.level === 'error' ? 'text-red-600' : 'text-amber-600'
                }`}
              >
                <TriangleAlert className="w-3 h-3 shrink-0 mt-0.5" /> {w.text}
              </p>
            ))}
          </Panel>

          {/* Article grid */}
          <Panel title="Articole încărcate" icon={Package} count={rows.length}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="text-left font-medium px-3 py-2">Oprire</th>
                    <th className="text-left font-medium px-3 py-2">Articol</th>
                    <th className="text-left font-medium px-3 py-2">Comandă</th>
                    <th className="text-right font-medium px-3 py-2">Cant.</th>
                    <th className="text-right font-medium px-3 py-2">Greutate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? rows.map((row) => (
                    <tr key={row.key} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <span
                          className="inline-flex w-5 h-5 rounded-full text-white text-[10px] font-semibold items-center justify-center"
                          style={{ background: stopColor(row.stop_seq) }}
                        >
                          {row.stop_seq}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-700">{row.sku || 'Palet'}</td>
                      <td className="px-3 py-2 text-slate-500">{row.order_number || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatKg(row.weight_kg)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">Nimic încărcat</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        {/* Layer view by stop + unplaced */}
        <div className="lg:col-span-3 space-y-4">
          <Panel title="Pe opriri" icon={Boxes} count={stopGroups.length}>
            <div className="p-2 space-y-1.5 max-h-[420px] overflow-y-auto">
              {stopGroups.length ? stopGroups.map((group) => (
                <article key={group.stop_seq} className="rounded-lg border border-slate-200 p-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-5 h-5 rounded-full text-white text-[10px] font-semibold flex items-center justify-center shrink-0"
                      style={{ background: stopColor(group.stop_seq) }}
                    >
                      {group.stop_seq}
                    </span>
                    <span className="text-xs font-medium text-slate-700 truncate">
                      {group.order_number || `Oprirea ${group.stop_seq}`}
                    </span>
                    <span className="ml-auto text-[11px] text-slate-400 tabular-nums shrink-0">
                      {group.item_count} × · {formatKg(group.weight_kg)}
                    </span>
                  </div>
                </article>
              )) : (
                <p className="text-center py-8 text-xs text-slate-400">Nicio oprire încărcată</p>
              )}
            </div>
          </Panel>

          <Panel title="Nealocate" icon={PackageX} count={plan?.unplaced?.length ?? 0}>
            <div className="p-2 space-y-1 max-h-[220px] overflow-y-auto">
              {plan?.unplaced?.length ? plan.unplaced.map((item, i) => (
                <div key={item.id || i} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5">
                  <p className="text-xs font-medium text-red-700 truncate">{item.sku || 'Palet'}</p>
                  <p className="text-[11px] text-red-500">
                    Oprirea {item.stop_seq} · {formatKg(item.weight_kg)}
                  </p>
                </div>
              )) : (
                <p className="text-center py-6 text-xs text-slate-400">
                  {plan ? 'Totul a încăput' : '—'}
                </p>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

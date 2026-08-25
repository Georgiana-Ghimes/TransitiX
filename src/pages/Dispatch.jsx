import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, Clock, Loader2, Package,
  Plus, RefreshCw, Route as RouteIcon, Search, Trash2, TriangleAlert, Truck, X,
} from 'lucide-react';
import { api } from '@/api/client';
import { notifyError, notifySuccess } from '@/lib/notify';
import {
  canDropOnRoute,
  dayTotals,
  formatDuration,
  formatEta,
  formatKm,
  nextRouteCode,
  parseDragPayload,
  previewFit,
  routeStatusMeta,
  routeWarnings,
  stopMarkerColor,
  unplannedOrders,
} from '@/lib/dispatchUi';

const ROMANIA_CENTER = [45.9432, 24.9668];

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function seqIcon(color, seq) {
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<div style="width:24px;height:24px;border-radius:50%;background:${color};color:#fff;
      display:flex;align-items:center;justify-content:center;font:600 11px/1 system-ui;
      border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${seq}</div>`,
  });
}

function FitBounds({ points }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  const lastKey = useRef(null);
  useEffect(() => {
    if (!points.length || lastKey.current === key) return;
    lastKey.current = key;
    if (points.length === 1) map.flyTo(points[0], 12, { duration: 0.5 });
    else map.fitBounds(L.latLngBounds(points).pad(0.2), { animate: true });
  }, [key, points, map]);
  return null;
}

export default function Dispatch() {
  const [date, setDate] = useState(todayIso());
  const [orders, setOrders] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [plans, setPlans] = useState({});
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({});
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [geometry, setGeometry] = useState(null);
  const [dragPayload, setDragPayload] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [routingReady, setRoutingReady] = useState(false);

  const loadPlans = useCallback(async (routeList) => {
    const entries = await Promise.all(routeList.map(async (route) => {
      try {
        return [route.id, await api.routes.plan(route.id)];
      } catch {
        return [route.id, null];
      }
    }));
    setPlans(Object.fromEntries(entries));
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [orderRows, routeRows, vehicleRows, driverRows] = await Promise.all([
        api.entities.Order.list('-created_date', 500),
        api.entities.Route.filter({ route_date: date }, 'code', 200),
        api.entities.Vehicle.list(),
        api.entities.Driver.list(),
      ]);
      setOrders(orderRows);
      setRoutes(routeRows);
      setVehicles(vehicleRows.filter((v) => v.is_active));
      setDrivers(driverRows.filter((d) => d.is_active));
      await loadPlans(routeRows);
    } catch (e) {
      notifyError('Nu am putut încărca panoul', e);
    } finally {
      setLoading(false);
    }
  }, [date, loadPlans]);

  useEffect(() => { setLoading(true); loadData(); }, [loadData]);

  // Ask once whether OSRM is available, so we never fire a request we know will 503.
  useEffect(() => {
    api.geo.health()
      .then((h) => setRoutingReady(Boolean(h?.configured && h?.ok)))
      .catch(() => setRoutingReady(false));
  }, []);

  const pending = useMemo(() => unplannedOrders(orders, { date, search }), [orders, date, search]);
  const totals = useMemo(() => dayTotals(
    orders.filter((o) => String(o.requested_date).slice(0, 10) === date),
    routes
  ), [orders, routes, date]);

  const selectedPlan = selectedRouteId ? plans[selectedRouteId] : null;

  /** Road geometry for the selected route only — one OSRM call, not one per route. */
  useEffect(() => {
    const stops = (selectedPlan?.stops || []).filter((s) => s.latitude != null && s.longitude != null);
    if (!routingReady || stops.length < 2) { setGeometry(null); return; }
    let cancelled = false;
    api.geo.route(stops.map((s) => ({ latitude: Number(s.latitude), longitude: Number(s.longitude) })), { overview: 'full' })
      .then((res) => {
        if (cancelled) return;
        const coords = res?.geometry?.coordinates;
        setGeometry(Array.isArray(coords) ? coords.map(([lng, lat]) => [lat, lng]) : null);
      })
      .catch(() => { if (!cancelled) setGeometry(null); });
    return () => { cancelled = true; };
  }, [selectedPlan, routingReady]);

  const applyPlan = (routeId, plan) => {
    setPlans((prev) => ({ ...prev, [routeId]: plan }));
    if (plan?.route) {
      setRoutes((prev) => prev.map((r) => (r.id === routeId ? { ...r, ...plan.route } : r)));
    }
  };

  const run = async (key, fn, { reloadOrders = true } = {}) => {
    setBusy(key);
    try {
      await fn();
      if (reloadOrders) {
        setOrders(await api.entities.Order.list('-created_date', 500));
      }
    } catch (e) {
      notifyError('Operația a eșuat', e);
    } finally {
      setBusy(null);
    }
  };

  const assignOrder = (routeId, orderId, atIndex) => run(`assign-${orderId}`, async () => {
    applyPlan(routeId, await api.routes.addStop(routeId, { order_id: orderId, at_index: atIndex }));
    setExpanded((prev) => ({ ...prev, [routeId]: true }));
    setSelectedRouteId(routeId);
  });

  const moveStop = (routeId, stopId, toIndex) => run(`move-${stopId}`, async () => {
    applyPlan(routeId, await api.routes.reorder(routeId, { stop_id: stopId, to_index: toIndex }));
  }, { reloadOrders: false });

  const detachStop = (routeId, stopId) => run(`detach-${stopId}`, async () => {
    applyPlan(routeId, await api.routes.removeStop(routeId, stopId));
  });

  const recompute = (routeId) => run(`recompute-${routeId}`, async () => {
    applyPlan(routeId, await api.routes.recompute(routeId));
  }, { reloadOrders: false });

  const createRoute = () => run('create-route', async () => {
    const route = await api.entities.Route.create({
      route_date: date,
      code: nextRouteCode(routes.map((r) => r.code)),
      starts_at: '08:00',
    });
    setRoutes((prev) => [...prev, route]);
    setExpanded((prev) => ({ ...prev, [route.id]: true }));
    setSelectedRouteId(route.id);
    applyPlan(route.id, await api.routes.plan(route.id));
    notifySuccess('Rută creată', route.code);
  }, { reloadOrders: false });

  const updateRoute = (routeId, patch) => run(`route-${routeId}`, async () => {
    const updated = await api.entities.Route.update(routeId, patch);
    setRoutes((prev) => prev.map((r) => (r.id === routeId ? { ...r, ...updated } : r)));
    applyPlan(routeId, await api.routes.recompute(routeId));
  }, { reloadOrders: false });

  const deleteRoute = (routeId) => run(`delete-${routeId}`, async () => {
    await api.entities.Route.delete(routeId);
    setRoutes((prev) => prev.filter((r) => r.id !== routeId));
    setPlans((prev) => { const next = { ...prev }; delete next[routeId]; return next; });
    if (selectedRouteId === routeId) setSelectedRouteId(null);
  });

  // --- drag and drop (desktop enhancement; every action also has a button) ---
  const onDragStartOrder = (order) => (e) => {
    const payload = { kind: 'order', orderId: order.id };
    setDragPayload(payload);
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragStartStop = (routeId, stop) => (e) => {
    const payload = { kind: 'stop', stopId: stop.id, routeId };
    setDragPayload(payload);
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDropOnRoute = (routeId, atIndex) => (e) => {
    e.preventDefault();
    setDropTarget(null);
    setDragPayload(null);
    const payload = parseDragPayload(e.dataTransfer.getData('text/plain')) || dragPayload;
    if (!canDropOnRoute(payload, routeId)) return;
    if (payload.kind === 'order') assignOrder(routeId, payload.orderId, atIndex);
    else moveStop(routeId, payload.stopId, atIndex);
  };

  const allowDrop = (routeId, key) => (e) => {
    if (!canDropOnRoute(dragPayload, routeId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(key);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" />
      </div>
    );
  }

  const mapStops = (selectedPlan?.stops || []).filter((s) => s.latitude != null && s.longitude != null);
  const mapPoints = mapStops.map((s) => [Number(s.latitude), Number(s.longitude)]);

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight flex items-center gap-2">
            <RouteIcon className="w-6 h-6 text-[#F5A623]" /> Dispecerat
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {totals.unplanned} neplanificate · {totals.routes} rute · {formatKm(totals.distance_km)} · {formatDuration(totals.duration_min)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89]"
          />
          <button
            onClick={createRoute}
            disabled={busy === 'create-route'}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-50"
          >
            {busy === 'create-route' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Rută nouă
          </button>
        </div>
      </div>

      {!routingReady && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <TriangleAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900">
            <span className="font-medium">Rutarea nu este configurată.</span>{' '}
            Poți planifica opriri și le poți ordona, dar distanțele, ETA-urile și traseul pe hartă
            rămân goale până setezi <code className="px-1 bg-amber-100 rounded">OSRM_URL</code> în{' '}
            <code className="px-1 bg-amber-100 rounded">server/.env</code>.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Unplanned orders */}
        <section className="lg:col-span-3 bg-white rounded-xl border border-slate-200/80 shadow-sm flex flex-col">
          <header className="p-3 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-2">
              <Package className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-[#0A2B4E]">Comenzi neplanificate</h2>
              <span className="ml-auto text-xs font-medium text-slate-400 tabular-nums">{pending.length}</span>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Caută comandă sau client"
                className="w-full pl-8 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89]"
              />
            </div>
          </header>
          <div className="p-2 space-y-1.5 max-h-[300px] lg:max-h-[640px] overflow-y-auto">
            {pending.length ? pending.map((order) => (
              <article
                key={order.id}
                draggable
                onDragStart={onDragStartOrder(order)}
                onDragEnd={() => { setDragPayload(null); setDropTarget(null); }}
                className="p-2.5 rounded-lg border border-slate-200 hover:border-[#1D4E89] bg-white lg:cursor-grab active:cursor-grabbing"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-700 truncate">{order.order_number}</span>
                  <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                    {order.weight_kg ? `${Number(order.weight_kg).toLocaleString('ro-RO')} kg` : ''}
                  </span>
                </div>
                <p className="text-xs text-slate-400 truncate">{order.goods_description || 'Fără descriere'}</p>
                {(order.window_start || order.window_end) && (
                  <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {String(order.window_start || '').slice(0, 5)}–{String(order.window_end || '').slice(0, 5)}
                  </p>
                )}
                {routes.length > 0 && (
                  <select
                    aria-label={`Planifică ${order.order_number}`}
                    value=""
                    disabled={busy === `assign-${order.id}`}
                    onChange={(e) => e.target.value && assignOrder(e.target.value, order.id)}
                    className="mt-2 w-full px-2 py-1 text-xs border border-slate-200 rounded-md bg-slate-50 focus:outline-none focus:border-[#1D4E89]"
                  >
                    <option value="">Planifică pe ruta…</option>
                    {routes.map((r) => {
                      const warn = previewFit(order, plans[r.id]?.totals, vehicles.find((v) => v.id === r.vehicle_id));
                      return (
                        <option key={r.id} value={r.id}>
                          {r.code}{warn.length ? `  (depășire ${warn[0].label})` : ''}
                        </option>
                      );
                    })}
                  </select>
                )}
              </article>
            )) : (
              <div className="text-center py-10 text-slate-400">
                <Package className="w-7 h-7 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-medium text-slate-500">Nicio comandă de planificat</p>
                <p className="text-xs mt-1">
                  {totals.orders === 0
                    ? 'Nicio comandă pentru această zi'
                    : search ? 'Nimic pe această căutare' : 'Toate comenzile zilei sunt pe rute'}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Routes */}
        <section className="lg:col-span-4 space-y-3 lg:max-h-[720px] lg:overflow-y-auto lg:pr-1">
          {routes.length ? routes.map((route) => {
            const plan = plans[route.id];
            const stops = plan?.stops || [];
            const warnings = routeWarnings(plan);
            const meta = routeStatusMeta(route.status);
            const open = expanded[route.id] !== false;
            const isSelected = selectedRouteId === route.id;

            return (
              <article
                key={route.id}
                onClick={() => setSelectedRouteId(route.id)}
                onDragOver={allowDrop(route.id, `${route.id}-end`)}
                onDragLeave={() => setDropTarget(null)}
                onDrop={onDropOnRoute(route.id, stops.length)}
                className={`bg-white rounded-xl border shadow-sm transition-colors ${
                  isSelected ? 'border-[#1D4E89] ring-1 ring-[#1D4E89]/20' : 'border-slate-200/80'
                } ${dropTarget === `${route.id}-end` ? 'ring-2 ring-[#F5A623]' : ''}`}
              >
                <header className="p-3 border-b border-slate-100">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={(e) => { e.stopPropagation(); setExpanded((p) => ({ ...p, [route.id]: !open })); }}
                      className="p-0.5 text-slate-400 hover:text-slate-600"
                      aria-label={open ? 'Restrânge ruta' : 'Extinde ruta'}
                    >
                      {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <h3 className="font-semibold text-[#0A2B4E]">{route.code}</h3>
                    <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full border ${meta.badge}`}>
                      {meta.label}
                    </span>
                    <span className="ml-auto text-xs text-slate-400 tabular-nums">
                      {stops.length} opriri · {formatKm(plan?.totals?.distance_km)} · {formatDuration(plan?.totals?.duration_min)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <select
                      aria-label="Vehicul"
                      value={route.vehicle_id || ''}
                      onChange={(e) => updateRoute(route.id, { vehicle_id: e.target.value || null })}
                      onClick={(e) => e.stopPropagation()}
                      className="px-2 py-1 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-[#1D4E89]"
                    >
                      <option value="">Fără vehicul</option>
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.id}>{v.plate}{v.capacity_kg ? ` (${v.capacity_kg} kg)` : ''}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Șofer"
                      value={route.driver_id || ''}
                      onChange={(e) => updateRoute(route.id, { driver_id: e.target.value || null })}
                      onClick={(e) => e.stopPropagation()}
                      className="px-2 py-1 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-[#1D4E89]"
                    >
                      <option value="">Fără șofer</option>
                      {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <input
                      type="time"
                      aria-label="Ora de start"
                      value={String(route.starts_at || '08:00').slice(0, 5)}
                      onChange={(e) => updateRoute(route.id, { starts_at: e.target.value })}
                      onClick={(e) => e.stopPropagation()}
                      className="px-2 py-1 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-[#1D4E89]"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); recompute(route.id); }}
                      disabled={busy === `recompute-${route.id}`}
                      title="Recalculează distanțele și ETA-urile"
                      className="p-1.5 text-slate-400 hover:text-[#1D4E89] disabled:opacity-50"
                    >
                      {busy === `recompute-${route.id}`
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteRoute(route.id); }}
                      disabled={busy === `delete-${route.id}`}
                      title="Șterge ruta"
                      className="p-1.5 text-slate-400 hover:text-red-500 disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {warnings.map((w, i) => (
                    <p
                      key={i}
                      className={`flex items-start gap-1.5 text-[11px] mt-1.5 ${
                        w.level === 'error' ? 'text-red-600' : 'text-amber-600'
                      }`}
                    >
                      <TriangleAlert className="w-3 h-3 shrink-0 mt-0.5" /> {w.text}
                    </p>
                  ))}
                </header>

                {open && (
                  <ol className="p-2 space-y-1">
                    {stops.length ? stops.map((stop, index) => (
                      <li
                        key={stop.id}
                        draggable
                        onDragStart={onDragStartStop(route.id, stop)}
                        onDragEnd={() => { setDragPayload(null); setDropTarget(null); }}
                        onDragOver={allowDrop(route.id, stop.id)}
                        onDrop={(e) => { e.stopPropagation(); onDropOnRoute(route.id, index)(e); }}
                        className={`flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 lg:cursor-grab active:cursor-grabbing ${
                          dropTarget === stop.id ? 'ring-2 ring-[#F5A623]' : ''
                        }`}
                      >
                        <span
                          className="w-6 h-6 rounded-full text-white text-[11px] font-semibold flex items-center justify-center shrink-0"
                          style={{ background: stopMarkerColor(stop, plan?.windowViolations) }}
                        >
                          {stop.seq}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-700 truncate">
                            {stop.location_name || stop.client_name || 'Oprire'}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {stop.order_number ? `${stop.order_number} · ` : ''}{stop.city || stop.address || ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[11px] font-medium text-slate-600 tabular-nums">{formatEta(stop.planned_arrival)}</p>
                          <p className="text-[10px] text-slate-400 tabular-nums">{formatKm(stop.leg_distance_km)}</p>
                        </div>
                        <div className="flex flex-col shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); moveStop(route.id, stop.id, index - 1); }}
                            disabled={index === 0 || busy === `move-${stop.id}`}
                            aria-label="Mută mai sus"
                            className="p-0.5 text-slate-300 hover:text-[#1D4E89] disabled:opacity-30"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); moveStop(route.id, stop.id, index + 1); }}
                            disabled={index === stops.length - 1 || busy === `move-${stop.id}`}
                            aria-label="Mută mai jos"
                            className="p-0.5 text-slate-300 hover:text-[#1D4E89] disabled:opacity-30"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); detachStop(route.id, stop.id); }}
                          disabled={busy === `detach-${stop.id}`}
                          aria-label="Scoate de pe rută"
                          className="p-1 text-slate-300 hover:text-red-500 disabled:opacity-30 shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    )) : (
                      <li className="text-center py-6 text-xs text-slate-400">
                        Trage o comandă aici sau folosește lista „Planifică pe ruta…”
                      </li>
                    )}
                  </ol>
                )}
              </article>
            );
          }) : (
            <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-10 text-center text-slate-400">
              <Truck className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium text-slate-500">Nicio rută pentru {date}</p>
              <p className="text-xs mt-1">Apasă „Rută nouă” ca să începi planificarea</p>
            </div>
          )}
        </section>

        {/* Map */}
        <section className="lg:col-span-5 bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <MapContainer center={ROMANIA_CENTER} zoom={7} className="z-0 h-[45vh] min-h-[300px] w-full lg:h-[720px]">
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
            <FitBounds points={mapPoints} />
            {geometry && <Polyline positions={geometry} pathOptions={{ color: '#1D4E89', weight: 4, opacity: 0.75 }} />}
            {!geometry && mapPoints.length > 1 && (
              <Polyline positions={mapPoints} pathOptions={{ color: '#94A3B8', weight: 2, dashArray: '6 6' }} />
            )}
            {mapStops.map((stop) => (
              <Marker
                key={stop.id}
                position={[Number(stop.latitude), Number(stop.longitude)]}
                icon={seqIcon(stopMarkerColor(stop, selectedPlan?.windowViolations), stop.seq)}
              >
                <Tooltip>
                  <span className="text-xs">
                    <strong>{stop.seq}. {stop.location_name || stop.city}</strong>
                    <br />{formatEta(stop.planned_arrival)} · {formatKm(stop.leg_distance_km)}
                  </span>
                </Tooltip>
              </Marker>
            ))}
          </MapContainer>
          {!selectedRouteId && (
            <p className="p-3 text-xs text-slate-400 border-t border-slate-100">
              Selectează o rută ca să-i vezi traseul pe hartă.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

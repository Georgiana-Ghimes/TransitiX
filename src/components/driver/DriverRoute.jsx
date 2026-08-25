import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Clock, Loader2, MapPin, Navigation, Package, Phone, Route as RouteIcon,
} from 'lucide-react';
import { api } from '@/api/client';
import { notifyError } from '@/lib/notify';
import { openNavigation } from '@/lib/utils';
import {
  currentStop,
  dayLabel,
  formatClock,
  formatStopLoad,
  formatWindow,
  isStopClosed,
  routeProgress,
  shiftDay,
  stopActions,
  stopAddress,
  stopPhone,
  stopStatusMeta,
} from '@/lib/driverRoute';
import DriverLocationReporter from '@/components/driver/DriverLocationReporter';
import DriverPodModal from '@/components/driver/DriverPodModal';

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * The driver's route for one day.
 *
 * Every stop is a card with its own action button — no drag, no menus, and touch targets
 * sized for a hand in a truck. Marking a stop re-reads the route from the response instead
 * of guessing locally: the server also moves the order and the route status, and the screen
 * must not disagree with it.
 */
export default function DriverRoute() {
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [pod, setPod] = useState(null); // { routeId, stop, outcome }

  const load = useCallback(async (day) => {
    setLoading(true);
    try {
      setData(await api.routes.mine(day));
    } catch (e) {
      notifyError('Nu am putut încărca ruta', e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const mark = async (routeId, stop, status) => {
    const needsPod = ['livrare', 'ridicare', 'schimb'].includes(stop.kind)
      || (!stop.kind && stop.order_id);
    if (needsPod && (status === 'finalizat' || status === 'esuat')) {
      setPod({ routeId, stop, outcome: status === 'esuat' ? 'refuzat' : 'livrat' });
      return;
    }
    setBusy(stop.id);
    try {
      const result = await api.routes.setStopStatus(routeId, stop.id, status);
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          routes: prev.routes.map((entry) => (
            entry.route.id === routeId
              ? { ...entry, route: { ...entry.route, ...result.route }, stops: result.stops }
              : entry
          )),
        };
      });
    } catch (e) {
      notifyError('Nu am putut actualiza oprirea', e);
    } finally {
      setBusy(null);
    }
  };

  const onPodSaved = (result) => {
    if (!pod) return;
    const routeId = pod.routeId;
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        routes: prev.routes.map((entry) => (
          entry.route.id === routeId
            ? { ...entry, route: { ...entry.route, ...result.route }, stops: result.stops }
            : entry
        )),
      };
    });
    setPod(null);
  };

  const routes = data?.routes || [];
  const trackingRoute = routes.find((entry) => (
    entry.route?.vehicle_id
    && ['planificata', 'lansata', 'in_executie'].includes(entry.route.status)
  )) || routes.find((entry) => entry.route?.vehicle_id) || null;

  return (
    <div className="space-y-4">
      <DriverLocationReporter
        enabled={Boolean(trackingRoute) && !data?.preview}
        routeId={trackingRoute?.route?.id || null}
        vehicleId={trackingRoute?.route?.vehicle_id || null}
      />
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm p-2">
        <button
          onClick={() => setDate((d) => shiftDay(d, -1))}
          aria-label="Ziua anterioară"
          className="p-2.5 text-slate-500 hover:text-[#0A2B4E] min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-[#0A2B4E]">{dayLabel(date)}</p>
          <p className="text-[11px] text-slate-400 tabular-nums">{date}</p>
        </div>
        <button
          onClick={() => setDate((d) => shiftDay(d, 1))}
          aria-label="Ziua următoare"
          className="p-2.5 text-slate-500 hover:text-[#0A2B4E] min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {data?.preview && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Mod previzualizare dispecer — vezi rutele alocate din firmă, așa cum le vede șoferul.
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-[#1D4E89]" />
        </div>
      ) : routes.length ? (
        routes.map(({ route, stops, totals }) => {
          const progress = routeProgress(stops);
          const active = currentStop(stops);

          return (
            <section key={route.id} className="space-y-3">
              <header className="bg-[#0A2B4E] text-white rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-white/60">Ruta</p>
                    <p className="font-bold text-lg">{route.code}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-white/60">Plecare</p>
                    <p className="font-semibold">{String(route.starts_at || '08:00').slice(0, 5)}</p>
                  </div>
                </div>
                <p className="text-xs text-white/70 mt-2">
                  {route.vehicle_plate || 'Fără vehicul'} · {progress.done}/{progress.total} opriri
                  {totals?.distance_km ? ` · ${Number(totals.distance_km).toLocaleString('ro-RO')} km` : ''}
                </p>
                <div className="mt-2 h-1.5 rounded-full bg-white/20 overflow-hidden">
                  <div className="h-full bg-[#F5A623] transition-all" style={{ width: `${progress.percent}%` }} />
                </div>
              </header>

              {stops.length ? (
                <ol className="space-y-3">
                  {stops.map((stop) => {
                    const meta = stopStatusMeta(stop.status);
                    const actions = stopActions(stop);
                    const isActive = active?.id === stop.id;
                    const address = stopAddress(stop);
                    const phone = stopPhone(stop);
                    const load = formatStopLoad(stop);
                    const window = formatWindow(stop);

                    return (
                      <li
                        key={stop.id}
                        className={`bg-white rounded-xl border shadow-sm p-4 ${
                          isActive ? 'border-[#1D4E89] ring-1 ring-[#1D4E89]/20' : 'border-slate-200'
                        } ${isStopClosed(stop) ? 'opacity-70' : ''}`}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`w-8 h-8 rounded-full text-sm font-semibold flex items-center justify-center shrink-0 ${
                              isStopClosed(stop) ? 'bg-slate-200 text-slate-500' : 'bg-[#0A2B4E] text-white'
                            }`}
                          >
                            {stop.seq}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-[#0A2B4E] truncate">
                                {stop.location_name || stop.client_name || 'Oprire'}
                              </p>
                              <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full border shrink-0 ${meta.badge}`}>
                                {meta.label}
                              </span>
                            </div>
                            {address && (
                              <p className="text-xs text-slate-500 mt-0.5 flex items-start gap-1">
                                <MapPin className="w-3 h-3 shrink-0 mt-0.5" /> {address}
                              </p>
                            )}
                            <p className="text-xs text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {formatClock(stop.planned_arrival)}
                                {window ? ` (${window})` : ''}
                              </span>
                              {load && (
                                <span className="flex items-center gap-1">
                                  <Package className="w-3 h-3" /> {load}
                                </span>
                              )}
                            </p>
                            {stop.order_number && (
                              <p className="text-[11px] text-slate-400 mt-0.5">{stop.order_number}</p>
                            )}
                            {stop.access_notes && (
                              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1 mt-2">
                                {stop.access_notes}
                              </p>
                            )}
                            {stop.actual_arrival && (
                              <p className="text-[11px] text-slate-400 mt-1">
                                Sosire reală {formatClock(stop.actual_arrival)}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 mt-3">
                          <button
                            onClick={() => openNavigation(address)}
                            disabled={!address}
                            className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-[#1D4E89] bg-blue-50 rounded-lg hover:bg-blue-100 disabled:opacity-40 min-h-[44px]"
                          >
                            <Navigation className="w-4 h-4" /> Navigare
                          </button>
                          {phone && (
                            <a
                              href={`tel:${phone}`}
                              className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 min-h-[44px]"
                            >
                              <Phone className="w-4 h-4" /> Sună
                            </a>
                          )}
                          {actions.map((action) => (
                            <button
                              key={action.status}
                              onClick={() => mark(route.id, stop, action.status)}
                              disabled={busy === stop.id}
                              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold rounded-lg disabled:opacity-50 min-h-[44px] ml-auto ${
                                action.tone === 'danger'
                                  ? 'text-red-600 bg-red-50 hover:bg-red-100'
                                  : 'text-white bg-[#27AE60] hover:bg-emerald-600'
                              }`}
                            >
                              {busy === stop.id && <Loader2 className="w-4 h-4 animate-spin" />}
                              {action.label}
                            </button>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-400">
                  Ruta nu are opriri încă.
                </p>
              )}
            </section>
          );
        })
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 shadow-sm">
          <RouteIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium text-slate-600">Nicio rută pentru {dayLabel(date).toLowerCase()}</p>
          <p className="text-xs mt-2 max-w-xs mx-auto">
            {data?.driver
              ? 'Când dispeceratul îți alocă o rută, opririle apar aici în ordinea de parcurs.'
              : 'Contul tău nu e legat de un profil de șofer. Contactează dispeceratul.'}
          </p>
        </div>
      )}

      <DriverPodModal
        open={Boolean(pod)}
        routeId={pod?.routeId}
        stop={pod?.stop}
        outcome={pod?.outcome || 'livrat'}
        onClose={() => setPod(null)}
        onSaved={onPodSaved}
      />
    </div>
  );
}

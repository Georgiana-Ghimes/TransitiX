import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { History, KeyRound, Loader2, RefreshCw, Truck, X } from 'lucide-react';
import { notifyError, notifySuccess } from '@/lib/notify';
import { useAuth } from '@/lib/AuthContext';
import RouteExceptionsPanel from '@/components/RouteExceptionsPanel';
import { useTelematicsStream } from '@/hooks/useTelematicsStream';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

function truckIconFor(severity) {
  const bg = severity === 'critical' ? '#DC2626' : severity === 'warning' ? '#D97706' : '#0A2B4E';
  return L.divIcon({
    html: `<div style="background:${bg};width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3)"><span style="font-size:14px">🚛</span></div>`,
    iconSize: [32, 32], iconAnchor: [16, 16], className: '',
  });
}

function stopIcon(seq, done) {
  const bg = done ? '#27AE60' : '#1D4E89';
  return L.divIcon({
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font:600 10px/1 system-ui;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)">${seq}</div>`,
  });
}

const BUCHAREST = [44.4268, 26.1025];

const SOURCE_LABELS = {
  driver_app: 'App șofer',
  simulate: 'Simulare',
  webhook: 'Webhook',
  webfleet: 'Webfleet',
  frotcom: 'Frotcom',
  teltonika: 'Teltonika',
  other: 'Altă sursă',
};

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function FitBounds({ points }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  const lastKey = useRef(null);
  useEffect(() => {
    if (!points.length || lastKey.current === key) return;
    lastKey.current = key;
    if (points.length === 1) map.flyTo(points[0], 12, { duration: 0.4 });
    else map.fitBounds(L.latLngBounds(points).pad(0.2), { animate: true });
  }, [key, points, map]);
  return null;
}

export default function GPSMap() {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [gpsLogs, setGpsLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState(null);
  const [alertByVehicle, setAlertByVehicle] = useState({});

  const [replayOpen, setReplayOpen] = useState(false);
  const [replayDate, setReplayDate] = useState(todayIso());
  const [replayRoutes, setReplayRoutes] = useState([]);
  const [replayRouteId, setReplayRouteId] = useState('');
  const [replay, setReplay] = useState(null);
  const [replayLoading, setReplayLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [vehs, logs, company, exceptions] = await Promise.all([
        api.entities.Vehicle.list(),
        api.telematics.live().catch(() => api.entities.GPSLog.filter({ is_current: true })),
        api.company.get().catch(() => null),
        api.telematics.exceptions({ open: true, limit: 100 }).catch(() => []),
      ]);
      setVehicles(vehs.filter((v) => v.is_active));
      setGpsLogs(logs);
      if (company) setKeyConfigured(Boolean(company.telematics_key_configured));
      const map = {};
      for (const ex of exceptions || []) {
        if (!ex.vehicle_id) continue;
        const prev = map[ex.vehicle_id];
        if (!prev || (ex.severity === 'critical') || (ex.severity === 'warning' && prev !== 'critical')) {
          map[ex.vehicle_id] = ex.severity;
        }
      }
      setAlertByVehicle(map);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const { connected } = useTelematicsStream({
    enabled: !replayOpen,
    onEvent: (packet) => {
      if (packet.type === 'position' && packet.data?.vehicle_id) {
        setGpsLogs((prev) => {
          const rest = prev.filter((l) => l.vehicle_id !== packet.data.vehicle_id);
          return [{
            ...packet.data,
            is_current: true,
            telematics_source: packet.data.source,
            telematics_recorded_at: packet.data.recorded_at,
          }, ...rest];
        });
      }
      if (packet.type === 'exception' && packet.data?.vehicle_id) {
        setAlertByVehicle((prev) => ({
          ...prev,
          [packet.data.vehicle_id]: packet.data.severity || 'warning',
        }));
      }
      if (packet.type === 'exception_resolved') {
        loadData();
      }
    },
  });

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, connected && !replayOpen ? 90_000 : 30_000);
    return () => clearInterval(timer);
  }, [loadData, connected, replayOpen]);

  useEffect(() => {
    if (!replayOpen) return undefined;
    let cancelled = false;
    setReplayLoading(true);
    api.telematics.replayList(replayDate)
      .then((rows) => {
        if (cancelled) return;
        setReplayRoutes(Array.isArray(rows) ? rows : []);
        setReplayRouteId((prev) => {
          if (prev && rows?.some((r) => r.id === prev)) return prev;
          return rows?.[0]?.id || '';
        });
      })
      .catch((e) => {
        if (!cancelled) {
          notifyError('Nu am putut încărca rutele zilei', e);
          setReplayRoutes([]);
        }
      })
      .finally(() => { if (!cancelled) setReplayLoading(false); });
    return () => { cancelled = true; };
  }, [replayOpen, replayDate]);

  useEffect(() => {
    if (!replayOpen || !replayRouteId) {
      setReplay(null);
      return undefined;
    }
    let cancelled = false;
    setReplayLoading(true);
    api.telematics.replay(replayRouteId)
      .then((data) => { if (!cancelled) setReplay(data); })
      .catch((e) => {
        if (!cancelled) {
          notifyError('Reluarea a eșuat', e);
          setReplay(null);
        }
      })
      .finally(() => { if (!cancelled) setReplayLoading(false); });
    return () => { cancelled = true; };
  }, [replayOpen, replayRouteId]);

  const simulateMovement = async () => {
    setSimulating(true);
    try {
      const activeVehicles = vehicles.filter((v) => v.status === 'in_trip' || v.status === 'available');
      const newLogs = activeVehicles.map((v) => ({
        vehicle_id: v.id,
        vehicle_plate: v.plate,
        latitude: BUCHAREST[0] + (Math.random() - 0.5) * 4,
        longitude: BUCHAREST[1] + (Math.random() - 0.5) * 6,
        speed: Math.floor(Math.random() * 80) + 10,
        heading: Math.floor(Math.random() * 360),
      }));
      await api.integrations.Core.SimulateGps(newLogs);
      await loadData();
    } catch (e) {
      notifyError('Simularea a eșuat', e);
    } finally {
      setSimulating(false);
    }
  };

  const rotateKey = async () => {
    if (!window.confirm('Generezi o cheie nouă? Cheia veche nu va mai funcționa.')) return;
    setRotating(true);
    try {
      const result = await api.telematics.rotateKey();
      setKeyConfigured(true);
      window.prompt('Copiază cheia acum (nu o mai afișăm):', result.api_key);
      notifySuccess('Cheie telematics generată', 'Folosește header-ul X-Telematics-Key pe /api/telematics/ingest');
    } catch (e) {
      notifyError('Nu am putut genera cheia', e);
    } finally {
      setRotating(false);
    }
  };

  const getVehicleLog = (vehicleId) => gpsLogs.find((l) => l.vehicle_id === vehicleId);

  const fitPoints = useMemo(() => {
    if (replayOpen && replay) {
      const pts = [
        ...(replay.planned?.coordinates || []),
        ...(replay.actual?.coordinates || []),
        ...(replay.stops || [])
          .filter((s) => s.latitude != null)
          .map((s) => [Number(s.latitude), Number(s.longitude)]),
      ];
      return pts;
    }
    return vehicles
      .map((v) => getVehicleLog(v.id))
      .filter(Boolean)
      .map((l) => [Number(l.latitude), Number(l.longitude)]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- getVehicleLog is trivial
  }, [replayOpen, replay, vehicles, gpsLogs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" />
      </div>
    );
  }

  const positions = vehicles.map((v) => ({ vehicle: v, log: getVehicleLog(v.id) })).filter((p) => p.log);
  const liveCount = positions.filter((p) => p.log.telematics_source && p.log.telematics_source !== 'simulate').length;
  const kpis = replay?.kpis;

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Tracking GPS</h1>
          <p className="text-sm text-slate-500 mt-1">
            {replayOpen
              ? (replay?.route?.code ? `Reluare ${replay.route.code}` : 'Reluare istorică')
              : `${positions.length} poziții pe hartă${liveCount > 0 ? ` · ${liveCount} din telematică reală` : ''} · ${connected ? 'flux live' : 'reîmprospătare la 30–90s'}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setReplayOpen((v) => !v)}
            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border ${
              replayOpen
                ? 'bg-[#0A2B4E] text-white border-[#0A2B4E]'
                : 'text-[#0A2B4E] bg-white border-slate-200 hover:bg-slate-50'
            }`}
          >
            {replayOpen ? <X className="w-4 h-4" /> : <History className="w-4 h-4" />}
            {replayOpen ? 'Închide reluarea' : 'Reluare'}
          </button>
          {!replayOpen && (
            <>
              <button
                type="button"
                onClick={loadData}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-[#0A2B4E] bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                <RefreshCw className="w-4 h-4" /> Actualizează
              </button>
              {user?.role === 'admin' && (
                <button
                  type="button"
                  onClick={rotateKey}
                  disabled={rotating}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-[#0A2B4E] bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  {rotating ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  {keyConfigured ? 'Rotește cheia webhook' : 'Generează cheie webhook'}
                </button>
              )}
              <button
                type="button"
                onClick={simulateMovement}
                disabled={simulating}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-50 transition-colors"
              >
                {simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {simulating ? 'Simulez…' : 'Simulează (demo)'}
              </button>
            </>
          )}
        </div>
      </div>

      {replayOpen ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-3 flex flex-wrap gap-3 items-end">
          <label className="text-xs text-slate-600">
            Ziua
            <input
              type="date"
              value={replayDate}
              onChange={(e) => setReplayDate(e.target.value)}
              className="mt-1 block px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89]"
            />
          </label>
          <label className="text-xs text-slate-600 flex-1 min-w-[180px]">
            Rută
            <select
              value={replayRouteId}
              onChange={(e) => setReplayRouteId(e.target.value)}
              className="mt-1 block w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89]"
            >
              {!replayRoutes.length && <option value="">Nicio rută cu vehicul</option>}
              {replayRoutes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {r.vehicle_plate || '—'}
                  {r.trail_points ? ` · ${r.trail_points} puncte GPS` : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-3 text-xs text-slate-600 pb-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-6 h-0.5 bg-[#1D4E89]" /> Planificat
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-6 h-0.5 bg-[#E67E22] border-t-2 border-dashed border-[#E67E22]" /> Realizat
            </span>
            {replayLoading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>
          {kpis && (
            <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-slate-400">Planificat</p>
                <p className="font-semibold text-slate-700 tabular-nums">
                  {kpis.planned_km != null ? `${kpis.planned_km} km` : '—'}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-slate-400">Realizat (GPS)</p>
                <p className="font-semibold text-slate-700 tabular-nums">
                  {kpis.actual_km != null ? `${kpis.actual_km} km` : '—'}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-slate-400">Diferență</p>
                <p className={`font-semibold tabular-nums ${kpis.delta_km > 0 ? 'text-amber-700' : 'text-slate-700'}`}>
                  {kpis.delta_km != null ? `${kpis.delta_km > 0 ? '+' : ''}${kpis.delta_km} km` : '—'}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-slate-400">Opriri</p>
                <p className="font-semibold text-slate-700 tabular-nums">
                  {kpis.stops_done}/{kpis.stops_total}
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Pozițiile vin din app-ul de șofer sau din webhook-ul furnizorului
          ({keyConfigured ? 'cheie activă' : 'generează o cheie webhook'}).
          Simularea rămâne doar pentru demo. Folosește <span className="font-medium">Reluare</span> ca să
          superpui traseul planificat peste cel GPS dintr-o zi.
        </div>
      )}

      {!replayOpen && <RouteExceptionsPanel />}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-3 space-y-2 max-h-56 lg:max-h-[600px] overflow-y-auto order-2 lg:order-1">
          {replayOpen ? (
            (replay?.stops || []).length ? (replay.stops.map((stop) => (
              <div key={stop.id} className="p-3 rounded-lg border border-slate-100 text-sm">
                <p className="font-medium text-[#0A2B4E] truncate">
                  #{stop.seq} · {stop.location_name || stop.client_name || stop.kind || 'Oprire'}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">{stop.status}</p>
              </div>
            ))) : (
              <p className="text-center py-8 text-sm text-slate-400">
                {replayLoading ? 'Încarc…' : 'Alege o rută cu opriri'}
              </p>
            )
          ) : positions.length > 0 ? positions.map(({ vehicle, log }) => (
            <button
              type="button"
              key={vehicle.id}
              onClick={() => setSelected(vehicle.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left ${selected === vehicle.id ? 'bg-[#0A2B4E] text-white' : 'hover:bg-slate-50'}`}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${selected === vehicle.id ? 'bg-white/20' : 'bg-[#0A2B4E]'}`}>
                <Truck className="w-4.5 h-4.5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{vehicle.plate}</p>
                <p className={`text-xs ${selected === vehicle.id ? 'text-white/70' : 'text-slate-400'}`}>
                  {log.speed != null ? `${log.speed} km/h` : '—'}
                  {log.telematics_source ? ` · ${SOURCE_LABELS[log.telematics_source] || log.telematics_source}` : ''}
                </p>
              </div>
            </button>
          )) : (
            <div className="text-center py-8 text-slate-400">
              <Truck className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nicio poziție încă</p>
              <p className="text-xs mt-1">Șoferul pe rută sau simularea demo</p>
            </div>
          )}
        </div>

        <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden order-1 lg:order-2">
          <MapContainer center={BUCHAREST} zoom={6} className="z-0 h-[50vh] min-h-[280px] max-h-[600px] w-full lg:h-[600px]">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap"
            />
            <FitBounds points={fitPoints} />

            {replayOpen && replay?.planned?.coordinates?.length > 1 && (
              <Polyline
                positions={replay.planned.coordinates}
                pathOptions={{ color: '#1D4E89', weight: 4, opacity: 0.85 }}
              />
            )}
            {replayOpen && replay?.actual?.coordinates?.length > 1 && (
              <Polyline
                positions={replay.actual.coordinates}
                pathOptions={{ color: '#E67E22', weight: 4, opacity: 0.9, dashArray: '8 10' }}
              />
            )}
            {replayOpen && (replay?.stops || []).filter((s) => s.latitude != null).map((stop) => (
              <Marker
                key={stop.id}
                position={[Number(stop.latitude), Number(stop.longitude)]}
                icon={stopIcon(stop.seq, ['finalizat', 'esuat', 'sarit'].includes(stop.status))}
              >
                <Popup>
                  <p className="font-semibold text-[#0A2B4E]">
                    #{stop.seq} · {stop.location_name || stop.client_name || 'Oprire'}
                  </p>
                  <p className="text-xs">{stop.status}</p>
                </Popup>
              </Marker>
            ))}

            {!replayOpen && positions.map(({ vehicle, log }) => (
              <Marker
                key={vehicle.id}
                position={[Number(log.latitude), Number(log.longitude)]}
                icon={truckIconFor(alertByVehicle[vehicle.id])}
                eventHandlers={{ click: () => setSelected(vehicle.id) }}
              >
                <Popup>
                  <div className="space-y-1">
                    <p className="font-bold text-[#0A2B4E]">{vehicle.plate}</p>
                    <p className="text-xs">{vehicle.brand} {vehicle.model}</p>
                    <p className="text-xs">
                      {log.speed != null ? `${log.speed} km/h` : '—'}
                      {' · '}
                      {log.ignition === false ? 'Motor oprit' : 'Motor pornit'}
                    </p>
                    {log.telematics_source && (
                      <p className="text-xs text-slate-500">
                        Sursă: {SOURCE_LABELS[log.telematics_source] || log.telematics_source}
                      </p>
                    )}
                    <Link to="/trips" className="text-xs text-blue-600">Vezi cursele</Link>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>

      {!replayOpen && selected && (() => {
        const sel = positions.find((p) => p.vehicle.id === selected);
        if (!sel) return null;
        return (
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-[#0A2B4E] flex items-center justify-center">
                <Truck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-[#0A2B4E]">{sel.vehicle.plate}</h3>
                <p className="text-xs text-slate-500">{sel.vehicle.brand} {sel.vehicle.model}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400">Viteză</p>
                <p className="font-semibold text-slate-700">{sel.log.speed != null ? `${sel.log.speed} km/h` : '—'}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400">Direcție</p>
                <p className="font-semibold text-slate-700">{sel.log.heading != null ? `${sel.log.heading}°` : '—'}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400">Sursă</p>
                <p className="font-semibold text-slate-700">
                  {SOURCE_LABELS[sel.log.telematics_source] || sel.log.telematics_source || '—'}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400">Kilometraj</p>
                <p className="font-semibold text-slate-700">
                  {sel.vehicle.mileage?.toLocaleString('ro-RO') || '—'} km
                </p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

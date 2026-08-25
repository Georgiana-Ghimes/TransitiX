import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polygon, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Loader2, Map, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { api } from '@/api/client';
import { notifyError, notifySuccess } from '@/lib/notify';

const ROMANIA_CENTER = [45.9432, 24.9668];

function FitPolygons({ features }) {
  const map = useMap();
  useEffect(() => {
    const latlngs = [];
    for (const f of features || []) {
      const ring = f?.geometry?.coordinates?.[0];
      if (!ring) continue;
      for (const [lon, lat] of ring) latlngs.push([lat, lon]);
    }
    if (latlngs.length >= 2) {
      map.fitBounds(L.latLngBounds(latlngs).pad(0.15), { animate: true });
    }
  }, [features, map]);
  return null;
}

function ringToLatLngs(feature) {
  const ring = feature?.geometry?.coordinates?.[0];
  if (!Array.isArray(ring)) return [];
  return ring.map(([lon, lat]) => [lat, lon]);
}

export default function Territories() {
  const [territories, setTerritories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [k, setK] = useState(5);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [terr, locs, bal] = await Promise.all([
        api.territories.list(),
        api.entities.Location.list('-created_date', 500),
        api.territories.balance().catch(() => null),
      ]);
      setTerritories(terr);
      setLocations(locs.filter((l) => l.latitude != null && l.longitude != null));
      setBalance(bal?.balance || null);
    } catch (e) {
      notifyError('Nu am putut încărca teritoriile', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const generate = async (apply) => {
    setBusy(true);
    try {
      const result = await api.territories.generate({ k: Number(k) || 5, apply });
      if (!apply) {
        notifySuccess(
          `Previzualizare ${result.drafts?.length || 0} teritorii`,
          result.balance?.balanced
            ? `Abatere max ${result.balance.max_deviation_pct}% (sub 15%)`
            : `Abatere max ${result.balance?.max_deviation_pct}%`
        );
        // Show preview polygons without persisting — replace local state temporarily.
        setTerritories((result.drafts || []).map((d, i) => ({
          id: `preview-${i}`,
          name: d.name,
          color: d.color,
          polygon: d.polygon,
          location_count: d.location_ids?.length || 0,
          preview: true,
        })));
        setBalance(result.balance);
        return;
      }
      notifySuccess(
        `${result.territories?.length || 0} teritorii generate`,
        result.balance?.balanced
          ? `Echilibru OK · abatere ${result.balance.max_deviation_pct}%`
          : `Abatere ${result.balance?.max_deviation_pct}% — poți ajusta manual`
      );
      await load();
    } catch (e) {
      notifyError('Generarea a eșuat', e);
    } finally {
      setBusy(false);
    }
  };

  const features = useMemo(
    () => territories.map((t) => t.polygon).filter((p) => p?.geometry?.type === 'Polygon'),
    [territories]
  );

  const colorById = useMemo(() => {
    const map = {};
    for (const t of territories) map[t.id] = t.color || '#1D4E89';
    return map;
  }, [territories]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight flex items-center gap-2">
            <Map className="w-6 h-6 text-[#F5A623]" /> Teritorii
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Clustering pe locațiile geocodate, ponderat pe volum / kg / comenzi deschise.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            Număr
            <input
              type="number"
              min={2}
              max={20}
              value={k}
              onChange={(e) => setK(e.target.value)}
              className="mt-1 block w-20 px-2 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </label>
          <button
            type="button"
            onClick={() => generate(false)}
            disabled={busy}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-[#0A2B4E] bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Previzualizează
          </button>
          <button
            type="button"
            onClick={() => generate(true)}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Generează & aplică
          </button>
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-[#0A2B4E] bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <RefreshCw className="w-4 h-4" /> Actualizează
          </button>
        </div>
      </div>

      {balance && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          balance.balanced ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-950'
        }`}>
          <p className="flex items-start gap-2">
            {!balance.balanced && <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />}
            Abatere maximă față de medie: <strong className="tabular-nums">{balance.max_deviation_pct}%</strong>
            {balance.balanced ? ' — în ținta de 15%.' : ' — peste 15%; redistribuie sau regenerază.'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <section className="lg:col-span-4 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <header className="px-3 py-2 border-b border-slate-100 text-sm font-semibold text-[#0A2B4E]">
            Echilibru
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[280px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Teritoriu</th>
                  <th className="text-right px-3 py-2 font-medium">Loc.</th>
                  <th className="text-right px-3 py-2 font-medium">kg</th>
                  <th className="text-right px-3 py-2 font-medium">mc</th>
                  <th className="text-right px-3 py-2 font-medium">Δ%</th>
                </tr>
              </thead>
              <tbody>
                {(balance?.rows || territories.map((t) => ({
                  name: t.name,
                  color: t.color,
                  stop_count: t.location_count,
                  weight_kg: 0,
                  volume_mc: 0,
                  deviation_pct: 0,
                  index: t.id,
                }))).map((row) => (
                  <tr
                    key={row.index ?? row.name}
                    className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${
                      selectedId === territories.find((t) => t.name === row.name)?.id ? 'bg-blue-50/50' : ''
                    }`}
                    onClick={() => {
                      const t = territories.find((x) => x.name === row.name);
                      if (t) setSelectedId(t.id);
                    }}
                  >
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: row.color }} />
                        {row.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.stop_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.weight_kg}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.volume_mc}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.deviation_pct}%</td>
                  </tr>
                ))}
                {!territories.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                      Niciun teritoriu încă — generează din locațiile geocodate.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lg:col-span-8 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <MapContainer center={ROMANIA_CENTER} zoom={7} className="z-0 h-[50vh] min-h-[320px] w-full lg:h-[560px]">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap"
            />
            <FitPolygons features={features} />
            {territories.map((t) => {
              const latlngs = ringToLatLngs(t.polygon);
              if (latlngs.length < 3) return null;
              const active = selectedId === t.id;
              return (
                <Polygon
                  key={t.id}
                  positions={latlngs}
                  pathOptions={{
                    color: t.color || '#1D4E89',
                    weight: active ? 3 : 1.5,
                    fillColor: t.color || '#1D4E89',
                    fillOpacity: active ? 0.35 : 0.18,
                  }}
                  eventHandlers={{ click: () => setSelectedId(t.id) }}
                >
                  <Tooltip sticky>{t.name} · {t.location_count ?? 0} locații</Tooltip>
                </Polygon>
              );
            })}
            {locations.map((loc) => (
              <CircleMarker
                key={loc.id}
                center={[Number(loc.latitude), Number(loc.longitude)]}
                radius={5}
                pathOptions={{
                  color: '#fff',
                  weight: 1,
                  fillColor: colorById[loc.territory_id] || '#94A3B8',
                  fillOpacity: 0.95,
                }}
              >
                <Tooltip>{loc.name}</Tooltip>
              </CircleMarker>
            ))}
          </MapContainer>
        </section>
      </div>
    </div>
  );
}
